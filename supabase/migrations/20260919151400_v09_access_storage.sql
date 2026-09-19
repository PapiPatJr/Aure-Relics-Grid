-- Helpers are unexposed, identity-bound and use a fixed empty search path.
-- Definer is needed only for non-recursive authorization lookups / code redemption.
create function private.is_registered() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from auth.users u where u.id=auth.uid() and not coalesce(u.is_anonymous,true)
  )
$$;
create function private.is_dm(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.is_registered() and exists (
    select 1 from public.campaigns where id=c and owner_id=auth.uid()
  )
$$;
create function private.in_session(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.session_players p
    join public.campaign_members m on m.campaign_id=p.campaign_id and m.user_id=p.user_id
    join public.sessions ss on ss.id=p.session_id and ss.campaign_id=p.campaign_id
    where p.session_id=s and p.user_id=auth.uid() and p.status='approved'
      and m.status='approved' and ss.status in ('lobby','active')
  )
$$;
create function private.in_campaign(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.sessions s where s.campaign_id=c and private.in_session(s.id)
  )
$$;
create function private.can_view_level(l uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.sessions s where s.active_level_id=l and s.status='active' and private.in_session(s.id)
  )
$$;
create function private.can_view_character(ch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.session_players p
    join public.characters c on c.id=p.character_id and c.campaign_id=p.campaign_id
    join public.campaign_members m on m.campaign_id=p.campaign_id and m.user_id=p.user_id
    where c.id=ch and c.approved and p.status='approved' and m.status='approved'
      and private.in_session(p.session_id)
  )
$$;
create function private.visible_rect(p_level uuid, p_x numeric, p_y numeric, p_width numeric, p_height numeric) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.can_view_level(p_level) and exists (
    select 1 from public.levels lv
    join public.locations loc on loc.id=lv.location_id
    join public.campaigns c on c.id=lv.campaign_id
    where lv.id=p_level and p_x>=0 and p_y>=0 and p_width>0 and p_height>0
      and p_x+p_width<=lv.grid_width and p_y+p_height<=lv.grid_height
      and (not coalesce(lv.fog_enabled,loc.fog_enabled,c.fog_enabled)
        or (select count(*) from public.fog_cells f
            where f.level_id=p_level and f.is_revealed
              and f.x>=floor(p_x) and f.x<ceil(p_x+p_width)
              and f.y>=floor(p_y) and f.y<ceil(p_y+p_height)) =
            (ceil(p_x+p_width)-floor(p_x))*(ceil(p_y+p_height)-floor(p_y)))
  )
$$;

-- No implicit API grants or table ownership privileges for anon/authenticated.
do $$ declare t record; begin
  for t in select schemaname,tablename from pg_tables where schemaname in ('public','private') loop
    execute format('alter table %I.%I enable row level security',t.schemaname,t.tablename);
    execute format('revoke all on %I.%I from public, anon, authenticated',t.schemaname,t.tablename);
    execute format('grant select, insert, update, delete on %I.%I to authenticated',t.schemaname,t.tablename);
    if t.tablename not in ('profiles','campaigns') then
      execute format('create policy dm_owner on %I.%I for all to authenticated using (private.is_dm(campaign_id)) with check (private.is_dm(campaign_id))',t.schemaname,t.tablename);
    end if;
  end loop;
end $$;
create policy self_profile on public.profiles for all to authenticated
using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy campaign_owner on public.campaigns for all to authenticated
using (owner_id=(select auth.uid()) and (select private.is_registered()))
with check (owner_id=(select auth.uid()) and (select private.is_registered()));
create policy campaign_guest on public.campaigns for select to authenticated using (private.in_campaign(id));
create policy member_self on public.campaign_members for select to authenticated
using (user_id=(select auth.uid()) and private.in_campaign(campaign_id));
create policy session_guest on public.sessions for select to authenticated using (private.in_session(id));
create policy session_player_self on public.session_players for select to authenticated
using (user_id=(select auth.uid()) and private.in_session(session_id));
create policy character_guest on public.characters for select to authenticated using (private.can_view_character(id));
create policy session_state_guest on public.session_state for select to authenticated using (private.in_session(session_id));
create policy level_guest on public.levels for select to authenticated using (private.can_view_level(id));
create policy location_guest on public.locations for select to authenticated using (
  exists(select 1 from public.levels l where l.location_id=locations.id and private.can_view_level(l.id))
);
create policy token_guest on public.tokens for select to authenticated
using (is_visible and private.visible_rect(level_id,x,y,width,height));
create policy terrain_guest on public.terrain_objects for select to authenticated
using (is_visible and rotation=0 and private.visible_rect(level_id,x,y,width,height));
create policy effect_guest on public.map_effects for select to authenticated
using (is_visible and private.visible_rect(level_id,x,y,width,height));
create policy fog_guest on public.fog_cells for select to authenticated
using (is_revealed and private.can_view_level(level_id));
create policy initiative_guest on public.initiative_entries for select to authenticated using (
  private.in_session(session_id) and exists (
    select 1 from public.tokens t where t.id=initiative_entries.token_id
  )
);

-- A typed safe API for exact HP. Invoker uses the private table's DM-only RLS.
create function public.get_token_details(token uuid) returns setof private.token_details
language sql stable security invoker set search_path = '' as $$
  select * from private.token_details where token_id=token
$$;
create function public.save_token_details(campaign uuid, token uuid, hp integer, maximum_hp integer, notes text)
returns void language sql security invoker set search_path = '' as $$
  insert into private.token_details(campaign_id,token_id,actual_hp,max_hp,dm_notes)
  values (campaign,token,hp,maximum_hp,notes)
  on conflict (token_id) do update set actual_hp=excluded.actual_hp,
    max_hp=excluded.max_hp,dm_notes=excluded.dm_notes
$$;

create function private.issue_character_code(ch uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c uuid; secret text;
begin
  select campaign_id into c from public.characters where id=ch and approved;
  if auth.uid() is null or not private.is_dm(c) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  secret := encode(extensions.gen_random_bytes(32),'hex');
  insert into private.character_codes(character_id,campaign_id,code_hash,expires_at)
  values(ch,c,extensions.digest(secret,'sha256'),now()+interval '30 days')
  on conflict(character_id) do update set code_hash=excluded.code_hash,
    expires_at=excluded.expires_at,revoked_at=null;
  return secret;
end $$;
create function public.issue_character_code(p_character uuid) returns text
language sql security invoker set search_path = '' as $$ select private.issue_character_code(p_character) $$;

create function private.reclaim_character(s uuid, ch uuid, secret text) returns void
language plpgsql security definer set search_path = '' as $$
declare c uuid; code private.character_codes;
begin
  -- This RPC cannot join a campaign or approve a guest. DM approval is prerequisite.
  if auth.uid() is null or not private.in_session(s) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select campaign_id into c from public.sessions where id=s;
  select * into code from private.character_codes where character_id=ch and campaign_id=c for update;
  if not found or code.revoked_at is not null or code.expires_at<=now()
    or secret is null or length(secret)<>64 or code.code_hash<>extensions.digest(secret,'sha256')
    or not exists(select 1 from public.characters where id=ch and campaign_id=c and approved) then
    raise exception 'Invalid or expired character code' using errcode='42501';
  end if;
  -- Reclaim revokes previous assignments across sessions in the same campaign.
  update public.session_players set character_id=null where campaign_id=c and character_id=ch;
  update public.session_players set character_id=ch where session_id=s and user_id=auth.uid();
  insert into private.activity_feed(campaign_id,session_id,actor_id,event_type,details)
  values(c,s,auth.uid(),'character_reclaimed',jsonb_build_object('character_id',ch));
end $$;
create function public.reclaim_character(p_session uuid, p_character uuid, p_code text) returns void
language sql security invoker set search_path = '' as $$ select private.reclaim_character(p_session,p_character,p_code) $$;

create function public.revoke_character_code(p_character uuid) returns void
language sql security invoker set search_path = '' as $$
  update private.character_codes set revoked_at=now() where character_id=p_character
$$;

-- Explicit function grants: no public/anon RPC access, no private schema in API.
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on all functions in schema private to authenticated;
revoke all on function public.get_token_details(uuid), public.save_token_details(uuid,uuid,integer,integer,text),
  public.issue_character_code(uuid),public.reclaim_character(uuid,uuid,text),public.revoke_character_code(uuid) from public,anon,authenticated;
grant execute on function public.get_token_details(uuid), public.save_token_details(uuid,uuid,integer,integer,text),
  public.issue_character_code(uuid),public.reclaim_character(uuid,uuid,text),public.revoke_character_code(uuid) to authenticated;

-- Private image buckets. Terrain/map images are DM-only until a safe publication service exists.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('character-images','character-images',false,5242880,array['image/png','image/jpeg','image/webp']),
 ('terrain-assets','terrain-assets',false,10485760,array['image/png','image/jpeg','image/webp']),
 ('map-assets','map-assets',false,20971520,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create function private.character_image_access(object_name text, own_only boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and array_length(string_to_array(object_name,'/'),1)=4
    and split_part(object_name,'/',4)='portrait.png'
    and exists (
      select 1 from public.sessions s
      join public.characters ch on ch.campaign_id=s.campaign_id
      where s.campaign_id::text=split_part(object_name,'/',1)
        and s.id::text=split_part(object_name,'/',2) and ch.id::text=split_part(object_name,'/',3)
        and (private.is_dm(s.campaign_id) or (
          ch.approved and private.in_session(s.id) and exists (
            select 1 from public.session_players p
            join public.campaign_members m on m.campaign_id=p.campaign_id and m.user_id=p.user_id
            where p.session_id=s.id and p.character_id=ch.id and p.status='approved' and m.status='approved'
              and (not own_only or p.user_id=auth.uid())
          )
        ))
    )
$$;
create function private.asset_owner(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and array_length(string_to_array(object_name,'/'),1)=2
    and split_part(object_name,'/',2) ~ '^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$'
    and exists(select 1 from public.campaigns c where c.id::text=split_part(object_name,'/',1) and private.is_dm(c.id))
$$;
create function private.image_owner(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.campaigns c where c.id::text=split_part(object_name,'/',1) and private.is_dm(c.id)
  ) and private.character_image_access(object_name,false)
$$;
revoke all on function private.character_image_access(text,boolean),private.asset_owner(text),private.image_owner(text) from public,anon;
grant execute on function private.character_image_access(text,boolean),private.asset_owner(text),private.image_owner(text) to authenticated;

create policy aure_images_read on storage.objects for select to authenticated using (
  (bucket_id='character-images' and private.character_image_access(name,false)) or
  (bucket_id in ('terrain-assets','map-assets') and private.asset_owner(name))
);
create policy aure_images_insert on storage.objects for insert to authenticated with check (
  (bucket_id='character-images' and private.character_image_access(name,true)) or
  (bucket_id in ('terrain-assets','map-assets') and private.asset_owner(name))
);
-- Players have one insert-only portrait slot per session/character. Only DM can replace/delete.
create policy aure_images_update on storage.objects for update to authenticated using (
  (bucket_id='character-images' and private.image_owner(name)) or
  (bucket_id in ('terrain-assets','map-assets') and private.asset_owner(name))
) with check (
  (bucket_id='character-images' and private.image_owner(name)) or
  (bucket_id in ('terrain-assets','map-assets') and private.asset_owner(name))
);
create policy aure_images_delete on storage.objects for delete to authenticated using (
  (bucket_id='character-images' and private.image_owner(name)) or
  (bucket_id in ('terrain-assets','map-assets') and private.asset_owner(name))
);

-- No publication changes: future realtime must use SELECT RLS or sanitized private Broadcast.
