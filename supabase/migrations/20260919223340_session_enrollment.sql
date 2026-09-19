-- Enrollment uses explicit, identity-bound RPCs; guest table grants/policies stay unchanged.
alter table public.session_players add column display_name text not null default 'Guest'
  check (length(btrim(display_name)) between 1 and 80);

create function private.issue_session_code(p_session uuid) returns text
language plpgsql security definer set search_path='' as $$
declare s public.sessions%rowtype; secret text;
begin
  select * into s from public.sessions where id=p_session for update;
  if not found or auth.uid() is null or not private.is_dm(s.campaign_id) or s.status='closed' then
    raise exception 'Session unavailable' using errcode='42501';
  end if;
  secret := encode(extensions.gen_random_bytes(32),'hex');
  insert into private.session_codes(session_id,campaign_id,code_hash,expires_at,revoked_at)
  values(s.id,s.campaign_id,extensions.digest(secret,'sha256'),now()+interval '24 hours',null)
  on conflict(session_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,revoked_at=null;
  insert into private.activity_feed(campaign_id,session_id,actor_id,event_type)
  values(s.campaign_id,s.id,auth.uid(),'session_code_issued');
  return secret;
end $$;

create function private.revoke_session_code(p_session uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.sessions%rowtype;
begin
  select * into s from public.sessions where id=p_session for update;
  if not found or auth.uid() is null or not private.is_dm(s.campaign_id) then
    raise exception 'Session unavailable' using errcode='42501';
  end if;
  update private.session_codes set revoked_at=now() where session_id=s.id;
  insert into private.activity_feed(campaign_id,session_id,actor_id,event_type)
  values(s.campaign_id,s.id,auth.uid(),'session_code_revoked');
end $$;

create function private.request_session_join(p_campaign uuid,p_session uuid,p_code text,p_display_name text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.sessions%rowtype; credential private.session_codes%rowtype;
  member_status text; player_status text; caller uuid := auth.uid(); guest_name text := btrim(p_display_name);
begin
  -- auth.users is authoritative; user metadata / supplied JWT anonymous flags are not.
  if caller is null or not exists(select 1 from auth.users where id=caller and is_anonymous is true) then
    raise exception 'Anonymous sign-in required' using errcode='42501';
  end if;
  if guest_name is null or length(guest_name) not between 1 and 80 then
    raise exception 'Display name must contain 1 to 80 characters' using errcode='22023';
  end if;
  -- Consistent order: session, code, campaign membership, session player.
  -- Session lock serializes rotation/revocation/closure with redemption.
  select * into s from public.sessions where id=p_session for update;
  if not found or s.campaign_id is distinct from p_campaign or s.status='closed' then
    raise exception 'Join unavailable' using errcode='42501';
  end if;
  select * into credential from private.session_codes where session_id=s.id for update;
  if not found or credential.campaign_id is distinct from p_campaign or credential.revoked_at is not null
     or credential.expires_at<=now() or p_code is null or p_code !~ '^[0-9a-f]{64}$'
     or credential.code_hash is distinct from extensions.digest(p_code,'sha256') then
    raise exception 'Join unavailable' using errcode='42501';
  end if;
  -- ON CONFLICT waits for concurrent creation. The following lock observes current status.
  insert into public.campaign_members(campaign_id,user_id,status)
  values(p_campaign,caller,'pending') on conflict(campaign_id,user_id) do nothing;
  select status into member_status from public.campaign_members
    where campaign_id=p_campaign and user_id=caller for update;
  if member_status='revoked' then
    raise exception 'Join unavailable' using errcode='42501';
  end if;
  select status into player_status from public.session_players
    where session_id=p_session and user_id=caller for update;
  if player_status='revoked' then
    raise exception 'Join unavailable' using errcode='42501';
  end if;
  insert into public.session_players(campaign_id,session_id,user_id,status,display_name)
  values(p_campaign,p_session,caller,'pending',guest_name)
  on conflict(session_id,user_id) do update set display_name=excluded.display_name;
  insert into private.activity_feed(campaign_id,session_id,actor_id,event_type)
  values(p_campaign,p_session,caller,'session_join_requested');
end $$;

create function private.review_session_guest(p_session uuid,p_user uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare s public.sessions%rowtype; member_status text; player_status text;
begin
  select * into s from public.sessions where id=p_session for update;
  if not found or auth.uid() is null or not private.is_dm(s.campaign_id) then
    raise exception 'Session unavailable' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('approve','reject','revoke') then
    raise exception 'Invalid review action' using errcode='22023';
  end if;
  select status into member_status from public.campaign_members
    where campaign_id=s.campaign_id and user_id=p_user for update;
  select status into player_status from public.session_players
    where session_id=s.id and user_id=p_user for update;
  if member_status is null or player_status is null then
    raise exception 'Request unavailable' using errcode='42501';
  end if;
  if p_action='approve' then
    if s.status='closed' or member_status='revoked' or player_status<>'pending' then
      raise exception 'Request unavailable' using errcode='42501';
    end if;
    update public.campaign_members set status='approved' where campaign_id=s.campaign_id and user_id=p_user;
    update public.session_players set status='approved' where session_id=s.id and user_id=p_user;
  else
    -- A session decision must never revoke unrelated approved session access.
    update public.session_players set status='revoked' where session_id=s.id and user_id=p_user;
  end if;
  insert into private.activity_feed(campaign_id,session_id,actor_id,event_type,details)
  values(s.campaign_id,s.id,auth.uid(),'session_guest_'||p_action,jsonb_build_object('user_id',p_user));
end $$;

create function private.get_guest_lobby(p_session uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'status',case when s.status='closed' then 'closed'
      when m.status='revoked' or p.status='revoked' then 'revoked'
      when m.status='approved' and p.status='approved' then 'approved' else 'pending' end,
    'campaign_name',c.name,'session_name',s.name,'display_name',p.display_name)
  from public.session_players p
  join public.sessions s on s.id=p.session_id and s.campaign_id=p.campaign_id
  join public.campaigns c on c.id=p.campaign_id
  join public.campaign_members m on m.campaign_id=p.campaign_id and m.user_id=p.user_id
  where auth.uid() is not null and p.user_id=auth.uid() and p.session_id=p_session
$$;

create function private.get_session_roster(p_session uuid)
returns table(user_id uuid,display_name text,status text)
language sql stable security definer set search_path='' as $$
  select p.user_id,p.display_name,
    case when m.status='revoked' then 'revoked' else p.status end
  from public.session_players p
  join public.campaign_members m on m.campaign_id=p.campaign_id and m.user_id=p.user_id
  where auth.uid() is not null and p.session_id=p_session
    and (private.is_dm(p.campaign_id) or
      (private.in_session(p_session) and p.status='approved' and m.status='approved'))
  order by p.display_name,p.user_id
$$;

create function public.issue_session_code(p_session uuid) returns text
language sql security invoker set search_path='' as $$ select private.issue_session_code(p_session) $$;
create function public.revoke_session_code(p_session uuid) returns void
language sql security invoker set search_path='' as $$ select private.revoke_session_code(p_session) $$;
create function public.request_session_join(p_campaign uuid,p_session uuid,p_code text,p_display_name text) returns void
language sql security invoker set search_path='' as $$ select private.request_session_join(p_campaign,p_session,p_code,p_display_name) $$;
create function public.review_session_guest(p_session uuid,p_user uuid,p_action text) returns void
language sql security invoker set search_path='' as $$ select private.review_session_guest(p_session,p_user,p_action) $$;
create function public.get_guest_lobby(p_session uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.get_guest_lobby(p_session) $$;
create function public.get_session_roster(p_session uuid) returns table(user_id uuid,display_name text,status text)
language sql stable security invoker set search_path='' as $$ select * from private.get_session_roster(p_session) $$;

-- Both layers are authenticated-only, including helpers callable over a direct SQL connection.
do $$
declare signature text; namespace text;
begin
  foreach namespace in array array['public','private'] loop
    foreach signature in array array['issue_session_code(uuid)','revoke_session_code(uuid)',
      'request_session_join(uuid,uuid,text,text)','review_session_guest(uuid,uuid,text)',
      'get_guest_lobby(uuid)','get_session_roster(uuid)'] loop
      execute format('revoke all on function %I.%s from public,anon,authenticated',namespace,signature);
      execute format('grant execute on function %I.%s to authenticated',namespace,signature);
    end loop;
  end loop;
end $$;
