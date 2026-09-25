-- Issue #10 Task 2: atomic DM-only fog mutations and realtime-storm prevention.
-- Fog cells remain canonical visibility truth. Hidden is stored sparsely as row absence.

-- Broad fog actions must not fan out one projection refresh per cell.
drop trigger if exists sync_changed on public.fog_cells;

-- Normalize legacy rows to the sparse representation used by the command layer.
delete from public.fog_cells where not is_revealed;

-- Browser clients receive fog only through authorized session snapshots and mutate it
-- only through mutate_session. Internal SECURITY DEFINER functions retain owner access.
revoke all privileges on public.fog_cells from public,anon,authenticated;
revoke all privileges on private.fog_areas from public,anon,authenticated;
revoke all privileges on private.fog_level_state from public,anon,authenticated;

create function private.fog_canonical_cells(
  p_campaign uuid,
  p_level uuid,
  p_cells jsonb
) returns jsonb
language plpgsql stable set search_path='' as $$
declare
  v_width integer;
  v_height integer;
  v_result jsonb;
begin
  select lv.grid_width,lv.grid_height
    into v_width,v_height
  from public.levels lv
  where lv.id=p_level and lv.campaign_id=p_campaign;
  if not found then
    raise exception 'Fog level unavailable' using errcode='42501';
  end if;

  if p_cells is null or jsonb_typeof(p_cells)<>'array'
    or jsonb_array_length(p_cells)<1 or jsonb_array_length(p_cells)>40000 then
    raise exception 'Invalid fog cells' using errcode='22023';
  end if;

  if exists(
    select 1
    from jsonb_array_elements(p_cells) c(cell)
    where jsonb_typeof(cell)<>'array'
      or jsonb_array_length(cell)<>2
      or jsonb_typeof(cell->0)<>'number'
      or jsonb_typeof(cell->1)<>'number'
      or (cell->>0) !~ '^[0-9]+$'
      or (cell->>1) !~ '^[0-9]+$'
  ) then
    raise exception 'Invalid fog cells' using errcode='22023';
  end if;

  if exists(
    select 1
    from jsonb_array_elements(p_cells) c(cell)
    where (cell->>0)::numeric>=v_width
       or (cell->>1)::numeric>=v_height
       or (cell->>0)::numeric>2147483647
       or (cell->>1)::numeric>2147483647
  ) then
    raise exception 'Fog cell out of bounds' using errcode='22023';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_array(x,y) order by y,x),
    '[]'::jsonb
  ) into v_result
  from (
    select distinct (cell->>0)::integer as x,(cell->>1)::integer as y
    from jsonb_array_elements(p_cells) c(cell)
  ) q;

  return v_result;
end $$;

create function private.fog_area_name(p_name text) returns text
language plpgsql immutable set search_path='' as $$
declare v_name text:=btrim(coalesce(p_name,''));
begin
  if length(v_name) not between 1 and 80 then
    raise exception 'Invalid fog area name' using errcode='22023';
  end if;
  return v_name;
end $$;

create function private.fog_bump_level(
  p_campaign uuid,
  p_level uuid,
  p_initialize boolean default false
) returns void
language plpgsql set search_path='' as $$
begin
  if not exists(
    select 1 from public.levels lv
    where lv.id=p_level and lv.campaign_id=p_campaign
  ) then
    raise exception 'Fog level unavailable' using errcode='42501';
  end if;

  insert into private.fog_level_state(campaign_id,level_id,initialized,revision)
  values(p_campaign,p_level,coalesce(p_initialize,false),1)
  on conflict(level_id) do update
    set revision=private.fog_level_state.revision+1,
        initialized=private.fog_level_state.initialized or excluded.initialized;
end $$;

revoke all on function private.fog_canonical_cells(uuid,uuid,jsonb),
  private.fog_area_name(text),
  private.fog_bump_level(uuid,uuid,boolean)
from public,anon,authenticated;

-- Extend the established optimistic session mutation contract. Existing Issue #8
-- commands are preserved; fog commands use the same locks and revision watermark.
create or replace function private.mutate_session(p_session uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  campaign uuid;
  manager boolean;
  kind text;
  p jsonb;
  keys text[];
  v bigint;
  target uuid;
  item jsonb;
  v_level uuid;
  v_location uuid;
  v_area uuid;
  v_cells jsonb;
  v_name text;
  v_revealed boolean;
  v_enabled boolean;
  v_refresh_explicit boolean:=false;
  v_initialize boolean:=false;
begin
  select campaign_id into campaign from public.sessions where id=p_session;
  if auth.uid() is null or campaign is null or not private.sync_can_read(p_session,auth.uid()) then
    raise exception 'Session unavailable' using errcode='42501';
  end if;

  if p_command is null or jsonb_typeof(p_command)<>'object'
    or p_command->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p_command->'type') is distinct from 'string'
    or jsonb_typeof(p_command->'expectedRevision') is distinct from 'string'
    or (p_command->>'expectedRevision') !~ '^(0|[1-9][0-9]{0,18})$'
    or jsonb_typeof(p_command->'payload') is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_command) k where k not in ('schemaVersion','type','expectedRevision','payload','commandId'))
    or (p_command ? 'commandId' and (jsonb_typeof(p_command->'commandId')<>'string' or length(p_command->>'commandId') not between 1 and 128)) then
    raise exception 'Invalid command' using errcode='22023';
  end if;

  kind:=p_command->>'type';
  p:=p_command->'payload';
  case kind
    when 'session.setRound' then keys:=array['roundNumber'];
    when 'token.setPublicState' then keys:=array['tokenId','label','conditionLabel','isVisible'];
    when 'initiative.set' then keys:=array['entries'];
    when 'character.update' then keys:=array['characterId','name','playerName','hp','maxHp','tempHp','ac','speed','statuses','publicNotes'];
    when 'fog.paint' then keys:=array['levelId','mode','cells'];
    when 'fog.area.create' then keys:=array['levelId','name','cells','revealedByDefault'];
    when 'fog.area.update' then keys:=array['levelId','areaId','name','cells','revealedByDefault'];
    when 'fog.area.delete' then keys:=array['levelId','areaId'];
    when 'fog.area.setVisibility' then keys:=array['levelId','areaId','revealed'];
    when 'fog.revealAll' then keys:=array['levelId'];
    when 'fog.hideAll' then keys:=array['levelId'];
    when 'fog.resetDefaults' then keys:=array['levelId'];
    when 'fog.setCampaignEnabled' then keys:=array['enabled'];
    when 'fog.setLocationOverride' then keys:=array['locationId','enabled'];
    when 'fog.setLevelOverride' then keys:=array['levelId','enabled'];
    else raise exception 'Invalid command' using errcode='22023';
  end case;

  if not p ?& keys or exists(select 1 from jsonb_object_keys(p) k where not k=any(keys)) then
    raise exception 'Invalid payload' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(campaign::text,7));
  perform 1 from public.sessions where id=p_session for update;
  perform 1 from public.campaign_members where campaign_id=campaign and user_id=auth.uid() for update;
  perform 1 from public.session_players where session_id=p_session and user_id=auth.uid() for update;
  if not private.sync_can_read(p_session,auth.uid()) then
    raise exception 'Session unavailable' using errcode='42501';
  end if;

  manager:=private.sync_can_manage(campaign,auth.uid());
  if kind<>'character.update' and not manager then
    raise exception 'Not authorized' using errcode='42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(campaign::text,8));
  perform 1 from private.session_sync ss
    join public.sessions s on s.id=ss.session_id
    where s.campaign_id=campaign
    order by ss.session_id,ss.user_id
    for update of ss;
  select revision into v from private.session_sync
    where session_id=p_session and user_id=auth.uid();
  if (p_command->>'expectedRevision')::numeric<>coalesce(v,0) then
    raise exception 'Stale revision; hydrate before retrying' using errcode='40001';
  end if;

  if kind='session.setRound' then
    if jsonb_typeof(p->'roundNumber')<>'number' or (p->>'roundNumber') !~ '^[1-9][0-9]{0,8}$' then
      raise exception 'Invalid round' using errcode='22023';
    end if;
    insert into public.session_state(session_id,campaign_id,round_number)
      values(p_session,campaign,(p->>'roundNumber')::integer)
      on conflict(session_id) do update set round_number=excluded.round_number;

  elsif kind='token.setPublicState' then
    target:=(p->>'tokenId')::uuid;
    perform 1 from public.tokens t
      join public.sessions s on s.active_level_id=t.level_id
      where s.id=p_session and t.id=target and t.campaign_id=campaign
      for update of t;
    if not found then raise exception 'Token unavailable' using errcode='42501'; end if;
    if jsonb_typeof(p->'label')<>'string' or length(btrim(p->>'label')) not between 1 and 200
      or jsonb_typeof(p->'conditionLabel')<>'string'
      or p->>'conditionLabel' not in ('Healthy','Hurt','Wounded','Bloodied','Near Death','Defeated','Unknown')
      or jsonb_typeof(p->'isVisible')<>'boolean' then
      raise exception 'Invalid token fields' using errcode='22023';
    end if;
    update public.tokens
      set label=p->>'label',condition_label=p->>'conditionLabel',is_visible=(p->>'isVisible')::boolean
      where id=target;

  elsif kind='initiative.set' then
    if jsonb_typeof(p->'entries')<>'array' or jsonb_array_length(p->'entries')>200 then
      raise exception 'Invalid initiative' using errcode='22023';
    end if;
    if (select count(*) from jsonb_array_elements(p->'entries') e where e->'isActive'='true'::jsonb)>1
      or (select count(*) from jsonb_array_elements(p->'entries'))<>(select count(distinct (e->>'tokenId')::uuid) from jsonb_array_elements(p->'entries') e) then
      raise exception 'Invalid initiative' using errcode='22023';
    end if;
    for item in select value from jsonb_array_elements(p->'entries') loop
      if jsonb_typeof(item)<>'object' or not item ?& array['tokenId','initiative','position','isActive']
        or exists(select 1 from jsonb_object_keys(item) k where k not in ('tokenId','initiative','position','isActive'))
        or jsonb_typeof(item->'initiative')<>'number' or (item->>'initiative') !~ '^-?[0-9]{1,4}$'
        or jsonb_typeof(item->'position')<>'number' or (item->>'position') !~ '^[0-9]{1,4}$'
        or jsonb_typeof(item->'isActive')<>'boolean' then
        raise exception 'Invalid initiative' using errcode='22023';
      end if;
      target:=(item->>'tokenId')::uuid;
      if not exists(select 1 from public.tokens t join public.sessions s on s.active_level_id=t.level_id
        where s.id=p_session and t.id=target and t.campaign_id=campaign) then
        raise exception 'Token unavailable' using errcode='42501';
      end if;
    end loop;
    delete from public.initiative_entries i
      where i.session_id=p_session
        and not exists(select 1 from jsonb_array_elements(p->'entries') e where (e->>'tokenId')::uuid=i.token_id);
    for item in select value from jsonb_array_elements(p->'entries') loop
      target:=(item->>'tokenId')::uuid;
      update public.initiative_entries
        set initiative=(item->>'initiative')::integer,
            position=(item->>'position')::integer,
            is_active=(item->>'isActive')::boolean
        where session_id=p_session and token_id=target;
      if not found then
        insert into public.initiative_entries(campaign_id,session_id,token_id,initiative,position,is_active)
          values(campaign,p_session,target,(item->>'initiative')::integer,(item->>'position')::integer,(item->>'isActive')::boolean);
      end if;
    end loop;

  elsif kind='character.update' then
    target:=(p->>'characterId')::uuid;
    if not exists(select 1 from public.characters c where c.id=target and c.campaign_id=campaign)
      or (not manager and not exists(select 1 from public.session_players where session_id=p_session and user_id=auth.uid() and character_id=target)) then
      raise exception 'Character unavailable' using errcode='42501';
    end if;
    if exists(select 1 from unnest(array['name','playerName','publicNotes']) k where jsonb_typeof(p->k)<>'string')
      or exists(select 1 from unnest(array['hp','maxHp','tempHp','ac','speed']) k
        where jsonb_typeof(p->k)<>'number' or (p->>k) !~ '^-?[0-9]{1,5}$')
      or jsonb_typeof(p->'statuses')<>'array'
      or exists(select 1 from jsonb_array_elements(p->'statuses') x where jsonb_typeof(x)<>'string') then
      raise exception 'Invalid character fields' using errcode='22023';
    end if;
    perform private.update_session_character(
      p_session,target,p->>'name',p->>'playerName',(p->>'hp')::integer,
      (p->>'maxHp')::integer,(p->>'tempHp')::integer,(p->>'ac')::integer,(p->>'speed')::integer,
      array(select jsonb_array_elements_text(p->'statuses')),p->>'publicNotes'
    );

  elsif kind='fog.setCampaignEnabled' then
    if jsonb_typeof(p->'enabled')<>'boolean' then
      raise exception 'Invalid fog setting' using errcode='22023';
    end if;
    insert into private.fog_level_state(campaign_id,level_id,initialized,revision)
      select campaign,lv.id,false,1 from public.levels lv where lv.campaign_id=campaign
      on conflict(level_id) do update set revision=private.fog_level_state.revision+1;
    update public.campaigns set fog_enabled=(p->>'enabled')::boolean where id=campaign;

  elsif kind='fog.setLocationOverride' then
    v_location:=(p->>'locationId')::uuid;
    perform 1 from public.locations loc where loc.id=v_location and loc.campaign_id=campaign for update;
    if not found then raise exception 'Fog location unavailable' using errcode='42501'; end if;
    if p->'enabled' is distinct from 'null'::jsonb and jsonb_typeof(p->'enabled')<>'boolean' then
      raise exception 'Invalid fog setting' using errcode='22023';
    end if;
    insert into private.fog_level_state(campaign_id,level_id,initialized,revision)
      select campaign,lv.id,false,1 from public.levels lv where lv.campaign_id=campaign and lv.location_id=v_location
      on conflict(level_id) do update set revision=private.fog_level_state.revision+1;
    update public.locations
      set fog_enabled=case when p->'enabled'='null'::jsonb then null else (p->>'enabled')::boolean end
      where id=v_location;

  elsif kind='fog.setLevelOverride' then
    v_level:=(p->>'levelId')::uuid;
    perform 1 from public.levels lv where lv.id=v_level and lv.campaign_id=campaign for update;
    if not found then raise exception 'Fog level unavailable' using errcode='42501'; end if;
    if p->'enabled' is distinct from 'null'::jsonb and jsonb_typeof(p->'enabled')<>'boolean' then
      raise exception 'Invalid fog setting' using errcode='22023';
    end if;
    perform private.fog_bump_level(campaign,v_level,false);
    update public.levels
      set fog_enabled=case when p->'enabled'='null'::jsonb then null else (p->>'enabled')::boolean end
      where id=v_level;

  else
    -- All remaining command types are level-targeted fog commands.
    v_level:=(p->>'levelId')::uuid;
    perform 1 from public.levels lv where lv.id=v_level and lv.campaign_id=campaign for update;
    if not found then raise exception 'Fog level unavailable' using errcode='42501'; end if;

    if kind='fog.paint' then
      if jsonb_typeof(p->'mode')<>'string' or p->>'mode' not in ('reveal','hide') then
        raise exception 'Invalid fog paint mode' using errcode='22023';
      end if;
      v_cells:=private.fog_canonical_cells(campaign,v_level,p->'cells');
      if p->>'mode'='reveal' then
        insert into public.fog_cells(campaign_id,level_id,x,y,is_revealed)
          select campaign,v_level,(cell->>0)::integer,(cell->>1)::integer,true
          from jsonb_array_elements(v_cells) c(cell)
          on conflict(level_id,x,y) do update set is_revealed=true;
      else
        delete from public.fog_cells f
        using jsonb_array_elements(v_cells) c(cell)
        where f.level_id=v_level
          and f.x=(cell->>0)::integer and f.y=(cell->>1)::integer;
      end if;
      v_initialize:=true;
      v_refresh_explicit:=true;

    elsif kind='fog.area.create' then
      if jsonb_typeof(p->'name')<>'string' or jsonb_typeof(p->'revealedByDefault')<>'boolean' then
        raise exception 'Invalid fog area' using errcode='22023';
      end if;
      v_name:=private.fog_area_name(p->>'name');
      v_cells:=private.fog_canonical_cells(campaign,v_level,p->'cells');
      insert into private.fog_areas(campaign_id,level_id,name,cells,revealed_by_default)
        values(campaign,v_level,v_name,v_cells,(p->>'revealedByDefault')::boolean);
      v_refresh_explicit:=true;

    elsif kind='fog.area.update' then
      v_area:=(p->>'areaId')::uuid;
      if jsonb_typeof(p->'name')<>'string' or jsonb_typeof(p->'revealedByDefault')<>'boolean' then
        raise exception 'Invalid fog area' using errcode='22023';
      end if;
      v_name:=private.fog_area_name(p->>'name');
      v_cells:=private.fog_canonical_cells(campaign,v_level,p->'cells');
      update private.fog_areas
        set name=v_name,cells=v_cells,revealed_by_default=(p->>'revealedByDefault')::boolean
        where id=v_area and campaign_id=campaign and level_id=v_level;
      if not found then raise exception 'Fog area unavailable' using errcode='42501'; end if;
      v_refresh_explicit:=true;

    elsif kind='fog.area.delete' then
      v_area:=(p->>'areaId')::uuid;
      delete from private.fog_areas
        where id=v_area and campaign_id=campaign and level_id=v_level;
      if not found then raise exception 'Fog area unavailable' using errcode='42501'; end if;
      v_refresh_explicit:=true;

    elsif kind='fog.area.setVisibility' then
      v_area:=(p->>'areaId')::uuid;
      if jsonb_typeof(p->'revealed')<>'boolean' then
        raise exception 'Invalid fog area visibility' using errcode='22023';
      end if;
      select private.fog_canonical_cells(campaign,v_level,a.cells)
        into v_cells
      from private.fog_areas a
      where a.id=v_area and a.campaign_id=campaign and a.level_id=v_level
      for update;
      if not found then raise exception 'Fog area unavailable' using errcode='42501'; end if;
      v_revealed:=(p->>'revealed')::boolean;
      if v_revealed then
        insert into public.fog_cells(campaign_id,level_id,x,y,is_revealed)
          select campaign,v_level,(cell->>0)::integer,(cell->>1)::integer,true
          from jsonb_array_elements(v_cells) c(cell)
          on conflict(level_id,x,y) do update set is_revealed=true;
      else
        delete from public.fog_cells f
        using jsonb_array_elements(v_cells) c(cell)
        where f.level_id=v_level
          and f.x=(cell->>0)::integer and f.y=(cell->>1)::integer;
      end if;
      v_initialize:=true;
      v_refresh_explicit:=true;

    elsif kind='fog.revealAll' then
      insert into public.fog_cells(campaign_id,level_id,x,y,is_revealed)
      select campaign,v_level,gx,gy,true
      from public.levels lv
      cross join lateral generate_series(0,lv.grid_width-1) gx
      cross join lateral generate_series(0,lv.grid_height-1) gy
      where lv.id=v_level and lv.campaign_id=campaign
      on conflict(level_id,x,y) do update set is_revealed=true;
      v_initialize:=true;
      v_refresh_explicit:=true;

    elsif kind='fog.hideAll' then
      delete from public.fog_cells where level_id=v_level;
      v_initialize:=true;
      v_refresh_explicit:=true;

    elsif kind='fog.resetDefaults' then
      delete from public.fog_cells where level_id=v_level;

      insert into public.fog_cells(campaign_id,level_id,x,y,is_revealed)
      select distinct campaign,v_level,(cell->>0)::integer,(cell->>1)::integer,true
      from private.fog_areas a
      cross join lateral jsonb_array_elements(a.cells) c(cell)
      join public.levels lv on lv.id=a.level_id and lv.campaign_id=a.campaign_id
      where a.campaign_id=campaign and a.level_id=v_level and a.revealed_by_default
        and jsonb_typeof(cell)='array' and jsonb_array_length(cell)=2
        and jsonb_typeof(cell->0)='number' and jsonb_typeof(cell->1)='number'
        and (cell->>0) ~ '^[0-9]+$' and (cell->>1) ~ '^[0-9]+$'
        and (cell->>0)::numeric<lv.grid_width and (cell->>1)::numeric<lv.grid_height
      on conflict(level_id,x,y) do update set is_revealed=true;

      delete from public.fog_cells f
      using private.fog_areas a,jsonb_array_elements(a.cells) c(cell)
      where a.campaign_id=campaign and a.level_id=v_level and not a.revealed_by_default
        and f.level_id=v_level
        and jsonb_typeof(cell)='array' and jsonb_array_length(cell)=2
        and jsonb_typeof(cell->0)='number' and jsonb_typeof(cell->1)='number'
        and (cell->>0) ~ '^[0-9]+$' and (cell->>1) ~ '^[0-9]+$'
        and f.x=(cell->>0)::integer and f.y=(cell->>1)::integer;
      v_initialize:=true;
      v_refresh_explicit:=true;
    end if;

    -- Every level-targeted fog command changes manager-visible fog metadata. Definition
    -- edits bump revision without initializing live fog; live actions also set initialized.
    perform private.fog_bump_level(campaign,v_level,v_initialize);
    if v_refresh_explicit then
      perform private.refresh_session_sync(campaign);
    end if;
  end if;

  -- Preserve the existing activity behavior without turning every fog action into a
  -- second realtime invalidation. Fog activity is intentionally deferred in v0.9.
  if kind in ('session.setRound','token.setPublicState','initiative.set') then
    insert into private.activity_feed(campaign_id,session_id,actor_id,event_type)
      values(campaign,p_session,auth.uid(),kind);
  end if;

  return private.get_session_snapshot(p_session);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Invalid command value' using errcode='22023';
end $$;

revoke all on function private.mutate_session(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.mutate_session(uuid,jsonb) to authenticated;
