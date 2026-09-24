-- Issue #8A: notifications contain no game state. Every recipient has a private
-- projection watermark; pending/private changes cannot leak via a shared counter.
create table private.session_sync (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision>=0),
  projection jsonb not null,
  primary key(session_id,user_id)
);
create index session_sync_user on private.session_sync(user_id);
create table public.session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  revision text not null check (revision ~ '^(0|[1-9][0-9]*)$'),
  schema_version integer not null default 1 check(schema_version=1),
  type text not null default 'session.invalidated' check(type='session.invalidated')
);
create index session_events_session on public.session_events(session_id);
create table private.session_event_access (
  event_id uuid primary key references public.session_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  can_manage boolean not null,
  revision bigint not null
);
create index session_event_access_user on private.session_event_access(user_id,revision);
alter table private.session_sync enable row level security;
alter table private.session_event_access enable row level security;
alter table public.session_events enable row level security;
revoke all on private.session_sync,private.session_event_access,public.session_events from public,anon,authenticated;
grant select on public.session_events to authenticated;

-- Internal projection helpers accept an explicit recipient. They are never granted
-- to API roles. Public wrappers below bind the recipient to auth.uid().
create function private.sync_can_manage(c uuid,u uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from public.campaigns c1 join auth.users a on a.id=c1.owner_id
    where c1.id=c and a.id=u and not coalesce(a.is_anonymous,true))
$$;
create function private.sync_can_read(s uuid,u uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from public.sessions ss where ss.id=s and (
    private.sync_can_manage(ss.campaign_id,u) or (ss.status in ('lobby','active') and exists(
      select 1 from public.session_players p join public.campaign_members m
      on m.campaign_id=p.campaign_id and m.user_id=p.user_id
      where p.session_id=ss.id and p.user_id=u and p.status='approved' and m.status='approved'))))
$$;
create function private.sync_rect_visible(l uuid,x integer,y integer,w integer,h integer) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from public.levels lv join public.locations loc on loc.id=lv.location_id
    join public.campaigns c on c.id=lv.campaign_id where lv.id=l
    and x>=0 and y>=0 and w>0 and h>0 and x+w<=lv.grid_width and y+h<=lv.grid_height
    and (not coalesce(lv.fog_enabled,loc.fog_enabled,c.fog_enabled) or
      (select count(*) from public.fog_cells f where f.level_id=l and f.is_revealed
        and f.x>=$2 and f.x<$2+$4 and f.y>=$3 and f.y<$3+$5)=$4*$5))
$$;
create function private.session_projection(p_session uuid,p_user uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare s public.sessions; manager boolean; own_id uuid; token_rows jsonb; cards jsonb; turns jsonb; dm_state jsonb;
begin
  select * into s from public.sessions where id=p_session;
  if s.id is null or p_user is null or not private.sync_can_read(p_session,p_user) then
    raise exception 'Session unavailable' using errcode='42501';
  end if;
  manager:=private.sync_can_manage(s.campaign_id,p_user);
  select p.character_id into own_id from public.session_players p
    join public.campaign_members m on m.campaign_id=p.campaign_id and m.user_id=p.user_id
    where p.session_id=s.id and p.user_id=p_user and p.status='approved' and m.status='approved'
      and s.status in ('lobby','active');
  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'levelId',t.level_id,'characterId',t.character_id,
    'kind',t.kind,'label',t.label,'conditionLabel',t.condition_label,'x',t.x,'y',t.y,
    'width',t.width,'height',t.height,'isVisible',t.is_visible) order by t.id),'[]'::jsonb) into token_rows
    from public.tokens t where t.campaign_id=s.campaign_id and t.level_id=s.active_level_id
      and (manager or (s.status='active' and t.is_visible and private.sync_rect_visible(t.level_id,t.x,t.y,t.width,t.height)));
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'playerName',c.player_name,
    'approved',c.approved,'hp',c.hp,'maxHp',c.max_hp,'tempHp',c.temp_hp,'ac',c.ac,'speed',c.speed,
    'statuses',c.statuses,'publicNotes',c.public_notes,'imagePath',c.image_path,'updatedAt',c.updated_at)
    order by c.id),'[]'::jsonb) into cards from public.characters c where c.campaign_id=s.campaign_id
    and (c.id=own_id or exists(select 1 from public.session_players p join public.campaign_members m
      on m.campaign_id=p.campaign_id and m.user_id=p.user_id where p.session_id=s.id and p.character_id=c.id
      and (manager or (c.approved and p.status='approved' and m.status='approved'))));
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'tokenId',i.token_id,'initiative',i.initiative,
    'position',i.position,'isActive',i.is_active) order by i.position,i.id),'[]'::jsonb) into turns
    from public.initiative_entries i where i.session_id=s.id and i.campaign_id=s.campaign_id
    and exists(select 1 from jsonb_array_elements(token_rows) t where t->>'id'=i.token_id::text);
  if manager then
    select jsonb_build_object('tokenDetails',coalesce((select jsonb_agg(jsonb_build_object(
      'tokenId',d.token_id,'actualHp',d.actual_hp,'maxHp',d.max_hp,'dmNotes',d.dm_notes) order by d.token_id)
      from private.token_details d join public.tokens t on t.id=d.token_id
      where d.campaign_id=s.campaign_id and t.level_id=s.active_level_id),'[]'::jsonb),
      'notes',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'subject',n.subject,'body',n.body) order by n.id)
        from private.dm_notes n where n.campaign_id=s.campaign_id),'[]'::jsonb),
      'activity',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'eventType',a.event_type,
        'actorId',a.actor_id,'createdAt',a.created_at) order by a.created_at desc,a.id)
        from (select id,event_type,actor_id,created_at from private.activity_feed
          where campaign_id=s.campaign_id and session_id=s.id order by created_at desc,id limit 50) a),'[]'::jsonb)) into dm_state;
  end if;
  return jsonb_build_object('schemaVersion',1,'sessionId',s.id,'campaignId',s.campaign_id,
    'authority',jsonb_build_object('canManage',manager,'ownCharacterId',own_id),
    'session',jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'activeLevelId',s.active_level_id),
    'roundNumber',coalesce((select round_number from public.session_state where session_id=s.id),1),
    'tokens',token_rows,'characters',cards,'initiative',turns,'dm',dm_state);
end $$;

create function private.sync_event_readable(p_event uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from private.session_event_access a
    join public.session_events e on e.id=a.event_id join public.sessions s on s.id=e.session_id
    where a.event_id=p_event and a.user_id=auth.uid()
      and a.can_manage=private.sync_can_manage(s.campaign_id,auth.uid())
      and private.sync_can_read(s.id,auth.uid()))
$$;
create policy session_event_recipient on public.session_events for select to authenticated
  using (private.sync_event_readable(id));

create function private.refresh_session_sync(p_campaign uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record; body jsonb; previous jsonb; v bigint; event_id uuid;
begin
  -- Enumerate only after prior projection writers commit. Otherwise an enrollment
  -- concurrent with a legacy write can be absent from a pre-lock recipient cursor.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_campaign::text,8));
  -- Stable lock order. Projection is recomputed AFTER obtaining the clock lock.
  -- A conflicting legacy write can be aborted by PostgreSQL's deadlock detection;
  -- clocks, canonical state and notifications always roll back together.
  for r in select s.id as session_id,u.id as user_id from public.sessions s
    join public.campaigns c on c.id=s.campaign_id
    join auth.users u on (u.id=c.owner_id or exists(select 1 from public.session_players p
      where p.session_id=s.id and p.user_id=u.id))
    where s.campaign_id=p_campaign and private.sync_can_read(s.id,u.id)
    order by s.id,u.id loop
    insert into private.session_sync(session_id,user_id,projection)
      values(r.session_id,r.user_id,'null') on conflict do nothing;
    select projection,revision into previous,v from private.session_sync
      where session_id=r.session_id and user_id=r.user_id for update;
    body:=private.session_projection(r.session_id,r.user_id);
    if body is distinct from previous then
      v:=v+1;
      update private.session_sync set projection=body,revision=v
        where session_id=r.session_id and user_id=r.user_id;
      insert into public.session_events(session_id,revision) values(r.session_id,v::text) returning id into event_id;
      insert into private.session_event_access(event_id,user_id,can_manage,revision)
        values(event_id,r.user_id,(body->'authority'->>'canManage')::boolean,v);
      -- Only random notification UUIDs can appear in replication DELETE records.
      delete from public.session_events e using private.session_event_access a
        where a.event_id=e.id and a.user_id=r.user_id and e.session_id=r.session_id and a.revision<=v-256;
    end if;
  end loop;
end $$;

create function private.sync_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare c uuid; old_c uuid;
begin
  if tg_table_name='campaigns' then
    if tg_op<>'DELETE' then c:=new.id; end if;
    if tg_op<>'INSERT' then old_c:=old.id; end if;
  else
    if tg_op<>'DELETE' then c:=new.campaign_id; end if;
    if tg_op<>'INSERT' then old_c:=old.campaign_id; end if;
  end if;
  if old_c is not null and old_c is distinct from c then perform private.refresh_session_sync(old_c); end if;
  if c is not null then perform private.refresh_session_sync(c); end if;
  return null;
end $$;

-- Safe activity: explicit changed fields, never arbitrary row/command copies.
create function private.sync_character_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare changes jsonb;
begin
  changes:=jsonb_strip_nulls(jsonb_build_object(
    'hp',case when new.hp is distinct from old.hp then jsonb_build_object('from',old.hp,'to',new.hp) end,
    'ac',case when new.ac is distinct from old.ac then jsonb_build_object('from',old.ac,'to',new.ac) end,
    'statuses',case when new.statuses is distinct from old.statuses then jsonb_build_object('from',old.statuses,'to',new.statuses) end));
  if changes<>'{}' then
    insert into private.activity_feed(campaign_id,session_id,actor_id,event_type,details)
      select new.campaign_id,p.session_id,auth.uid(),'character_card_changed',
        jsonb_build_object('character_id',new.id,'changes',changes)
      from public.session_players p where p.character_id=new.id group by p.session_id;
  end if;
  return null;
end $$;
create trigger sync_character_activity after update on public.characters
  for each row execute function private.sync_character_activity();
do $$ declare t text; begin
  foreach t in array array['campaigns','sessions','session_state','session_players','campaign_members',
    'characters','tokens','initiative_entries','levels','locations','fog_cells'] loop
    execute format('create trigger sync_changed after insert or update or delete on public.%I for each row execute function private.sync_changed()',t);
  end loop;
  foreach t in array array['token_details','dm_notes','activity_feed'] loop
    execute format('create trigger sync_changed after insert or update or delete on private.%I for each row execute function private.sync_changed()',t);
  end loop;
end $$;

create function private.get_session_snapshot(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare body jsonb; v bigint;
begin
  body:=private.session_projection(p_session,auth.uid());
  select revision into v from private.session_sync where session_id=p_session and user_id=auth.uid();
  return body || jsonb_build_object('revision',coalesce(v,0)::text);
end $$;
create function public.get_session_snapshot(p_session uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.get_session_snapshot(p_session) $$;

-- Deliberately absent: generic writes, movement, fog/terrain commands and DM transfer.
create function private.mutate_session(p_session uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare campaign uuid; manager boolean; kind text; p jsonb; keys text[]; v bigint; target uuid; item jsonb;
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
  kind:=p_command->>'type'; p:=p_command->'payload';
  case kind
    when 'session.setRound' then keys:=array['roundNumber'];
    when 'token.setPublicState' then keys:=array['tokenId','label','conditionLabel','isVisible'];
    when 'initiative.set' then keys:=array['entries'];
    when 'character.update' then keys:=array['characterId','name','playerName','hp','maxHp','tempHp','ac','speed','statuses','publicNotes'];
    else raise exception 'Invalid command' using errcode='22023';
  end case;
  if not p ?& keys or exists(select 1 from jsonb_object_keys(p) k where not k=any(keys)) then
    raise exception 'Invalid payload' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(campaign::text,7));
  perform 1 from public.sessions where id=p_session for update;
  perform 1 from public.campaign_members where campaign_id=campaign and user_id=auth.uid() for update;
  perform 1 from public.session_players where session_id=p_session and user_id=auth.uid() for update;
  if not private.sync_can_read(p_session,auth.uid()) then raise exception 'Session unavailable' using errcode='42501'; end if;
  manager:=private.sync_can_manage(campaign,auth.uid());
  if kind<>'character.update' and not manager then raise exception 'Not authorized' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(campaign::text,8));
  -- Lock all existing recipient clocks in the same order as the trigger fanout.
  perform 1 from private.session_sync ss join public.sessions s on s.id=ss.session_id
    where s.campaign_id=campaign order by ss.session_id,ss.user_id for update of ss;
  select revision into v from private.session_sync where session_id=p_session and user_id=auth.uid();
  if (p_command->>'expectedRevision')::numeric<>coalesce(v,0) then
    raise exception 'Stale revision; hydrate before retrying' using errcode='40001';
  end if;
  if kind='session.setRound' then
    if jsonb_typeof(p->'roundNumber')<>'number' or (p->>'roundNumber') !~ '^[1-9][0-9]{0,8}$' then
      raise exception 'Invalid round' using errcode='22023'; end if;
    insert into public.session_state(session_id,campaign_id,round_number) values(p_session,campaign,(p->>'roundNumber')::integer)
      on conflict(session_id) do update set round_number=excluded.round_number;
  elsif kind='token.setPublicState' then
    target:=(p->>'tokenId')::uuid;
    perform 1 from public.tokens t join public.sessions s on s.active_level_id=t.level_id
      where s.id=p_session and t.id=target and t.campaign_id=campaign for update of t;
    if not found then raise exception 'Token unavailable' using errcode='42501'; end if;
    if jsonb_typeof(p->'label')<>'string' or length(btrim(p->>'label')) not between 1 and 200
      or jsonb_typeof(p->'conditionLabel')<>'string' or p->>'conditionLabel' not in ('Healthy','Hurt','Wounded','Bloodied','Near Death','Defeated','Unknown')
      or jsonb_typeof(p->'isVisible')<>'boolean' then raise exception 'Invalid token fields' using errcode='22023'; end if;
    update public.tokens set label=p->>'label',condition_label=p->>'conditionLabel',is_visible=(p->>'isVisible')::boolean where id=target;
  elsif kind='initiative.set' then
    if jsonb_typeof(p->'entries')<>'array' or jsonb_array_length(p->'entries')>200 then raise exception 'Invalid initiative' using errcode='22023'; end if;
    if (select count(*) from jsonb_array_elements(p->'entries') e where e->'isActive'='true'::jsonb)>1
      or (select count(*) from jsonb_array_elements(p->'entries'))<>(select count(distinct (e->>'tokenId')::uuid) from jsonb_array_elements(p->'entries') e) then
      raise exception 'Invalid initiative' using errcode='22023'; end if;
    for item in select value from jsonb_array_elements(p->'entries') loop
      if jsonb_typeof(item)<>'object' or not item ?& array['tokenId','initiative','position','isActive']
        or exists(select 1 from jsonb_object_keys(item) k where k not in ('tokenId','initiative','position','isActive'))
        or jsonb_typeof(item->'initiative')<>'number' or (item->>'initiative') !~ '^-?[0-9]{1,4}$'
        or jsonb_typeof(item->'position')<>'number' or (item->>'position') !~ '^[0-9]{1,4}$'
        or jsonb_typeof(item->'isActive')<>'boolean' then raise exception 'Invalid initiative' using errcode='22023'; end if;
      target:=(item->>'tokenId')::uuid;
      if not exists(select 1 from public.tokens t join public.sessions s on s.active_level_id=t.level_id
        where s.id=p_session and t.id=target and t.campaign_id=campaign) then raise exception 'Token unavailable' using errcode='42501'; end if;
    end loop;
    -- Preserve identifiers for existing token entries; remove entries absent from replacement.
    delete from public.initiative_entries i where i.session_id=p_session
      and not exists(select 1 from jsonb_array_elements(p->'entries') e where (e->>'tokenId')::uuid=i.token_id);
    for item in select value from jsonb_array_elements(p->'entries') loop
      target:=(item->>'tokenId')::uuid;
      update public.initiative_entries set initiative=(item->>'initiative')::integer,
        position=(item->>'position')::integer,is_active=(item->>'isActive')::boolean where session_id=p_session and token_id=target;
      if not found then insert into public.initiative_entries(campaign_id,session_id,token_id,initiative,position,is_active)
        values(campaign,p_session,target,(item->>'initiative')::integer,(item->>'position')::integer,(item->>'isActive')::boolean); end if;
    end loop;
  else
    target:=(p->>'characterId')::uuid;
    if not exists(select 1 from public.characters c where c.id=target and c.campaign_id=campaign)
      or (not manager and not exists(select 1 from public.session_players where session_id=p_session and user_id=auth.uid() and character_id=target)) then
      raise exception 'Character unavailable' using errcode='42501'; end if;
    if exists(select 1 from unnest(array['name','playerName','publicNotes']) k where jsonb_typeof(p->k)<>'string')
      or exists(select 1 from unnest(array['hp','maxHp','tempHp','ac','speed']) k
        where jsonb_typeof(p->k)<>'number' or (p->>k) !~ '^-?[0-9]{1,5}$')
      or jsonb_typeof(p->'statuses')<>'array'
      or exists(select 1 from jsonb_array_elements(p->'statuses') x where jsonb_typeof(x)<>'string') then
      raise exception 'Invalid character fields' using errcode='22023'; end if;
    perform private.update_session_character(p_session,target,p->>'name',p->>'playerName',(p->>'hp')::integer,
      (p->>'maxHp')::integer,(p->>'tempHp')::integer,(p->>'ac')::integer,(p->>'speed')::integer,
      array(select jsonb_array_elements_text(p->'statuses')),p->>'publicNotes');
  end if;
  if kind<>'character.update' then
    insert into private.activity_feed(campaign_id,session_id,actor_id,event_type)
      values(campaign,p_session,auth.uid(),kind);
  end if;
  return private.get_session_snapshot(p_session);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Invalid command value' using errcode='22023';
end $$;
create function public.mutate_session(p_session uuid,p_command jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.mutate_session(p_session,p_command) $$;

revoke all on function private.sync_can_manage(uuid,uuid),private.sync_can_read(uuid,uuid),
  private.sync_rect_visible(uuid,integer,integer,integer,integer),private.session_projection(uuid,uuid),
  private.refresh_session_sync(uuid),private.sync_changed(),private.sync_character_activity(),
  private.sync_event_readable(uuid),private.get_session_snapshot(uuid),private.mutate_session(uuid,jsonb),
  public.get_session_snapshot(uuid),public.mutate_session(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.sync_event_readable(uuid),private.get_session_snapshot(uuid),
  private.mutate_session(uuid,jsonb),public.get_session_snapshot(uuid),public.mutate_session(uuid,jsonb) to authenticated;

-- Bootstrap clocks before adding the only published game-owned table.
do $$ declare c record; begin
  for c in select id from public.campaigns order by id loop perform private.refresh_session_sync(c.id); end loop;
end $$;
alter publication supabase_realtime add table public.session_events;
