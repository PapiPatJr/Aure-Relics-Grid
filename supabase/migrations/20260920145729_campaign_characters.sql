-- Issue #7: bounded guest submissions, explicit DM recovery, persistent private portraits.
alter table public.characters
  add column public_notes text not null default '',
  add column image_path text,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

create function private.owns_character_assignment(p_character uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.session_players p
    where p.character_id=p_character and p.user_id=auth.uid() and private.in_session(p.session_id)
  )
$$;
create policy character_own_pending on public.characters for select to authenticated
using (private.owns_character_assignment(id));

-- RPC field validation leaves existing legacy DM records intact. No guest table writes.
create function private.validate_character_fields(p_name text,p_player_name text,p_hp integer,p_max_hp integer,
  p_temp_hp integer,p_ac integer,p_speed integer,p_statuses text[],p_notes text) returns void
language plpgsql set search_path='' as $$
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 80
    or p_player_name is null or length(btrim(p_player_name)) not between 1 and 80
    or p_hp is null or p_hp not between -999 and 9999
    or p_max_hp is null or p_max_hp not between 0 and 9999
    or p_temp_hp is null or p_temp_hp not between 0 and 9999
    or p_ac is null or p_ac not between 0 and 99
    or p_speed is null or p_speed not between 0 and 999
    or p_statuses is null or cardinality(p_statuses)>20 or coalesce(array_ndims(p_statuses),1)>1
    or exists(select 1 from unnest(p_statuses) x where x is null or length(btrim(x)) not between 1 and 60 or length(x)>60)
    or p_notes is null or length(p_notes)>2000 then
    raise exception 'Invalid character fields' using errcode='22023';
  end if;
end $$;

-- All character assignment/code RPCs serialize by campaign before taking row locks.
-- Session and membership locks also serialize guest mutations with closure/revocation.
create function private.create_session_character(p_session uuid,p_name text,p_player_name text,p_hp integer,p_max_hp integer,
  p_temp_hp integer,p_ac integer,p_speed integer,p_statuses text[],p_notes text) returns uuid
language plpgsql security definer set search_path='' as $$
declare campaign uuid; ch uuid;
begin
  select campaign_id into campaign from public.sessions where id=p_session;
  -- Campaign/session approval defines participation, independently of account type.
  if campaign is null or auth.uid() is null then
    raise exception 'Character unavailable' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(campaign::text,7));
  perform 1 from public.sessions where id=p_session for update;
  perform 1 from public.campaign_members where campaign_id=campaign and user_id=auth.uid() for update;
  perform 1 from public.session_players where session_id=p_session and user_id=auth.uid() for update;
  if not private.in_session(p_session) or exists(select 1 from public.session_players
    where campaign_id=campaign and user_id=auth.uid() and character_id is not null) then
    raise exception 'Character already assigned or session unavailable' using errcode='42501';
  end if;
  perform private.validate_character_fields(p_name,p_player_name,p_hp,p_max_hp,p_temp_hp,p_ac,p_speed,p_statuses,p_notes);
  insert into public.characters(campaign_id,name,player_name,hp,max_hp,temp_hp,ac,speed,statuses,public_notes)
  values(campaign,btrim(p_name),btrim(p_player_name),p_hp,p_max_hp,p_temp_hp,p_ac,p_speed,p_statuses,p_notes) returning id into ch;
  update public.session_players set character_id=ch where session_id=p_session and user_id=auth.uid();
  insert into private.activity_feed(campaign_id,session_id,actor_id,event_type,details)
  values(campaign,p_session,auth.uid(),'character_submitted',jsonb_build_object('character_id',ch));
  return ch;
end $$;

create function private.update_session_character(p_session uuid,p_character uuid,p_name text,p_player_name text,p_hp integer,p_max_hp integer,
  p_temp_hp integer,p_ac integer,p_speed integer,p_statuses text[],p_notes text) returns void
language plpgsql security definer set search_path='' as $$
declare campaign uuid;
begin
  select campaign_id into campaign from public.sessions where id=p_session;
  if campaign is null or auth.uid() is null then raise exception 'Character unavailable' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(campaign::text,7));
  perform 1 from public.sessions where id=p_session for update;
  perform 1 from public.campaign_members where campaign_id=campaign and user_id=auth.uid() for update;
  perform 1 from public.characters where id=p_character and campaign_id=campaign for update;
  if not found or not (private.is_dm(campaign) or (private.in_session(p_session) and exists(
    select 1 from public.session_players where session_id=p_session and user_id=auth.uid() and character_id=p_character))) then
    raise exception 'Character unavailable' using errcode='42501';
  end if;
  perform private.validate_character_fields(p_name,p_player_name,p_hp,p_max_hp,p_temp_hp,p_ac,p_speed,p_statuses,p_notes);
  update public.characters set name=btrim(p_name),player_name=btrim(p_player_name),hp=p_hp,max_hp=p_max_hp,
    temp_hp=p_temp_hp,ac=p_ac,speed=p_speed,statuses=p_statuses,public_notes=p_notes,updated_at=clock_timestamp()
    where id=p_character;
end $$;

create function private.review_character(p_character uuid,p_approved boolean) returns void
language plpgsql security definer set search_path='' as $$
declare campaign uuid;
begin
  select campaign_id into campaign from public.characters where id=p_character;
  if campaign is null or not private.is_dm(campaign) then raise exception 'Character unavailable' using errcode='42501'; end if;
  if p_approved is null then raise exception 'Approval required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(campaign::text,7));
  perform 1 from public.characters where id=p_character for update;
  update public.characters set approved=p_approved,updated_at=clock_timestamp() where id=p_character;
  if not p_approved then update private.character_codes set revoked_at=clock_timestamp() where character_id=p_character; end if;
  insert into private.activity_feed(campaign_id,actor_id,event_type,details)
  values(campaign,auth.uid(),'character_reviewed',jsonb_build_object('character_id',p_character,'approved',p_approved));
end $$;

create function private.assign_character(p_session uuid,p_character uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare campaign uuid;
begin
  select campaign_id into campaign from public.sessions where id=p_session;
  if campaign is null or not private.is_dm(campaign) then raise exception 'Character unavailable' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(campaign::text,7));
  perform 1 from public.sessions where id=p_session and status in ('lobby','active') for update;
  if not found then raise exception 'Session unavailable' using errcode='42501'; end if;
  perform 1 from public.campaign_members where campaign_id=campaign and user_id=p_user and status='approved' for update;
  if not found then raise exception 'Player unavailable' using errcode='42501'; end if;
  perform 1 from public.characters where id=p_character and campaign_id=campaign and approved for update;
  if not found then raise exception 'Character unavailable' using errcode='42501'; end if;
  perform 1 from public.session_players where session_id=p_session and user_id=p_user and status='approved' for update;
  if not found then raise exception 'Player unavailable' using errcode='42501'; end if;
  -- Recovery replaces the target's campaign assignment, including closed sessions.
  update public.session_players set character_id=null where campaign_id=campaign
    and (character_id=p_character or user_id=p_user);
  update public.session_players set character_id=p_character where session_id=p_session and user_id=p_user;
  update private.character_codes set revoked_at=clock_timestamp() where character_id=p_character;
  insert into private.activity_feed(campaign_id,session_id,actor_id,event_type,details)
  values(campaign,p_session,auth.uid(),'character_assigned',jsonb_build_object('character_id',p_character,'user_id',p_user));
end $$;

create or replace function private.issue_character_code(ch uuid) returns text
language plpgsql security definer set search_path='' as $$
declare c uuid; secret text;
begin
  select campaign_id into c from public.characters where id=ch;
  if c is null or not private.is_dm(c) then raise exception 'Not authorized' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c::text,7));
  perform 1 from public.characters where id=ch and approved for update;
  if not found then raise exception 'Not authorized' using errcode='42501'; end if;
  secret:=encode(extensions.gen_random_bytes(32),'hex');
  insert into private.character_codes(character_id,campaign_id,code_hash,expires_at)
  values(ch,c,extensions.digest(secret,'sha256'),clock_timestamp()+interval '30 days')
  on conflict(character_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,revoked_at=null;
  return secret;
end $$;

create function private.revoke_character_code(p_character uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
  select campaign_id into c from public.characters where id=p_character;
  -- Preserve the original invoker API's unauthorized no-op without disclosing existence.
  if c is null or not private.is_dm(c) then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c::text,7));
  perform 1 from public.characters where id=p_character for update;
  update private.character_codes set revoked_at=clock_timestamp() where character_id=p_character;
end $$;
create or replace function public.revoke_character_code(p_character uuid) returns void
language sql security invoker set search_path='' as $$ select private.revoke_character_code(p_character) $$;

create or replace function private.reclaim_character(s uuid,ch uuid,secret text) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid; code private.character_codes;
begin
  select campaign_id into c from public.sessions where id=s;
  if c is null or auth.uid() is null then raise exception 'Not authorized' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(c::text,7));
  perform 1 from public.sessions where id=s for update;
  perform 1 from public.campaign_members where campaign_id=c and user_id=auth.uid() for update;
  if not private.in_session(s) then raise exception 'Not authorized' using errcode='42501'; end if;
  perform 1 from public.characters where id=ch and campaign_id=c and approved for update;
  if not found then raise exception 'Invalid or expired character code' using errcode='42501'; end if;
  select * into code from private.character_codes where character_id=ch and campaign_id=c for update;
  if not found or code.revoked_at is not null or code.expires_at<=clock_timestamp()
    or secret is null or secret !~ '^[0-9a-f]{64}$' or code.code_hash<>extensions.digest(secret,'sha256') then
    raise exception 'Invalid or expired character code' using errcode='42501';
  end if;
  perform 1 from public.session_players where session_id=s and user_id=auth.uid() for update;
  if exists(select 1 from public.session_players where campaign_id=c and user_id=auth.uid()
    and character_id is not null and character_id<>ch) then
    raise exception 'A different character is already assigned' using errcode='42501';
  end if;
  update public.session_players set character_id=null where campaign_id=c and character_id=ch;
  update public.session_players set character_id=ch where session_id=s and user_id=auth.uid();
  insert into private.activity_feed(campaign_id,session_id,actor_id,event_type,details)
  values(c,s,auth.uid(),'character_reclaimed',jsonb_build_object('character_id',ch));
end $$;

create function private.get_character_panel(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare campaign uuid; owner boolean; own_id uuid; cards jsonb; players jsonb;
begin
  select campaign_id into campaign from public.sessions where id=p_session;
  owner:=private.is_dm(campaign);
  if campaign is null or auth.uid() is null or not (owner or private.in_session(p_session)) then
    raise exception 'Session unavailable' using errcode='42501';
  end if;
  select character_id into own_id from public.session_players
    where session_id=p_session and user_id=auth.uid() and private.in_session(p_session);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',ch.id,'campaign_id',ch.campaign_id,'name',ch.name,'player_name',ch.player_name,'approved',ch.approved,
    'hp',ch.hp,'max_hp',ch.max_hp,'temp_hp',ch.temp_hp,'ac',ch.ac,'speed',ch.speed,'statuses',ch.statuses,
    'public_notes',ch.public_notes,'image_path',ch.image_path,'created_at',ch.created_at,'updated_at',ch.updated_at,
    'assignments',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'session_id',p.session_id,'display_name',p.display_name)
      order by p.session_id,p.user_id),'[]'::jsonb)
      from public.session_players p join public.sessions s on s.id=p.session_id
      join public.campaign_members m on m.campaign_id=p.campaign_id and m.user_id=p.user_id
      where p.character_id=ch.id and p.status='approved' and m.status='approved' and s.status in ('lobby','active')
        and (owner or p.user_id=auth.uid()))
    ) order by ch.created_at,ch.id),'[]'::jsonb) into cards
  from public.characters ch where ch.campaign_id=campaign and (owner or ch.id=own_id);
  select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'display_name',p.display_name)
    order by p.display_name,p.user_id),'[]'::jsonb) into players
    from public.session_players p join public.campaign_members m on m.campaign_id=p.campaign_id and m.user_id=p.user_id
    join public.sessions s on s.id=p.session_id
    where owner and p.session_id=p_session and p.status='approved' and m.status='approved' and s.status in ('lobby','active');
  return jsonb_build_object('campaign_id',campaign,'characters',cards,'players',players,'own_character_id',own_id);
end $$;

create function private.set_character_image(p_session uuid,p_character uuid) returns void
language plpgsql security definer set search_path='' as $$
declare campaign uuid; ch public.characters; path text; owner boolean;
begin
  select campaign_id into campaign from public.sessions where id=p_session;
  if campaign is null or auth.uid() is null then raise exception 'Character unavailable' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(campaign::text,7));
  perform 1 from public.sessions where id=p_session for update;
  perform 1 from public.campaign_members where campaign_id=campaign and user_id=auth.uid() for update;
  select * into ch from public.characters where id=p_character and campaign_id=campaign for update;
  owner:=private.is_dm(campaign);
  if ch.id is null or not (owner or (private.in_session(p_session) and exists(
    select 1 from public.session_players where session_id=p_session and user_id=auth.uid() and character_id=p_character)))
    or (not owner and ch.image_path is not null) then
    raise exception 'Character unavailable' using errcode='42501';
  end if;
  path:=campaign::text||'/'||p_character::text||'/portrait.png';
  if not exists(select 1 from storage.objects where bucket_id='character-images' and name=path) then
    raise exception 'Portrait not uploaded' using errcode='22023';
  end if;
  update public.characters set image_path=path,updated_at=clock_timestamp() where id=p_character;
end $$;

-- Add three-part canonical paths without weakening the existing four-part rules.
create function private.persistent_character_image_access(object_name text,own_only boolean,dm_only boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and array_length(string_to_array(object_name,'/'),1)=3
    and split_part(object_name,'/',3)='portrait.png' and exists(
      select 1 from public.characters ch where ch.campaign_id::text=split_part(object_name,'/',1)
      and ch.id::text=split_part(object_name,'/',2)
      and (private.is_dm(ch.campaign_id) or (not dm_only and (not own_only or ch.image_path is null) and (
        private.owns_character_assignment(ch.id) or (not own_only and private.can_view_character(ch.id)))))
    )
$$;
create policy aure_persistent_portrait_read on storage.objects for select to authenticated
using (bucket_id='character-images' and private.persistent_character_image_access(name,false));
create policy aure_persistent_portrait_insert on storage.objects for insert to authenticated
with check (bucket_id='character-images' and private.persistent_character_image_access(name,true));
create policy aure_persistent_portrait_update on storage.objects for update to authenticated
using (bucket_id='character-images' and private.persistent_character_image_access(name,true,true))
with check (bucket_id='character-images' and private.persistent_character_image_access(name,true,true));
create policy aure_persistent_portrait_delete on storage.objects for delete to authenticated
using (bucket_id='character-images' and private.persistent_character_image_access(name,true,true));

create function public.create_session_character(p_session uuid,p_name text,p_player_name text,p_hp integer,p_max_hp integer,
  p_temp_hp integer,p_ac integer,p_speed integer,p_statuses text[],p_notes text) returns uuid
language sql security invoker set search_path='' as $$
  select private.create_session_character(p_session,p_name,p_player_name,p_hp,p_max_hp,p_temp_hp,p_ac,p_speed,p_statuses,p_notes)
$$;
create function public.update_session_character(p_session uuid,p_character uuid,p_name text,p_player_name text,p_hp integer,p_max_hp integer,
  p_temp_hp integer,p_ac integer,p_speed integer,p_statuses text[],p_notes text) returns void
language sql security invoker set search_path='' as $$
  select private.update_session_character(p_session,p_character,p_name,p_player_name,p_hp,p_max_hp,p_temp_hp,p_ac,p_speed,p_statuses,p_notes)
$$;
create function public.review_character(p_character uuid,p_approved boolean) returns void
language sql security invoker set search_path='' as $$ select private.review_character(p_character,p_approved) $$;
create function public.assign_character(p_session uuid,p_character uuid,p_user uuid) returns void
language sql security invoker set search_path='' as $$ select private.assign_character(p_session,p_character,p_user) $$;
create function public.get_character_panel(p_session uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.get_character_panel(p_session) $$;
create function public.set_character_image(p_session uuid,p_character uuid) returns void
language sql security invoker set search_path='' as $$ select private.set_character_image(p_session,p_character) $$;

do $$ declare ns text; signature text; begin
  foreach ns in array array['public','private'] loop
    foreach signature in array array[
      'create_session_character(uuid,text,text,integer,integer,integer,integer,integer,text[],text)',
      'update_session_character(uuid,uuid,text,text,integer,integer,integer,integer,integer,text[],text)',
      'review_character(uuid,boolean)','assign_character(uuid,uuid,uuid)',
      'get_character_panel(uuid)','set_character_image(uuid,uuid)','revoke_character_code(uuid)'] loop
      execute format('revoke all on function %I.%s from public,anon,authenticated',ns,signature);
      execute format('grant execute on function %I.%s to authenticated',ns,signature);
    end loop;
  end loop;
end $$;
revoke all on function private.validate_character_fields(text,text,integer,integer,integer,integer,integer,text[],text) from public,anon,authenticated;
revoke all on function private.owns_character_assignment(uuid),private.persistent_character_image_access(text,boolean,boolean) from public,anon,authenticated;
grant execute on function private.owns_character_assignment(uuid),private.persistent_character_image_access(text,boolean,boolean) to authenticated;
