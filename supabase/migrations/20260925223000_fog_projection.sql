-- Issue #10 Task 1: authoritative fog projection primitives and compact mask output.
-- public.fog_cells remains canonical current visibility truth. The private state row
-- carries initialization/revision metadata only; it is not a second fog mask.

create table private.fog_level_state (
  campaign_id uuid not null,
  level_id uuid primary key,
  initialized boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  foreign key (campaign_id,level_id)
    references public.levels(campaign_id,id) on delete cascade
);
alter table private.fog_level_state enable row level security;
revoke all on private.fog_level_state from public,anon,authenticated;

-- Existing levels already have an established canonical current state: revealed rows
-- mean Revealed and every absent cell means Hidden. Future levels without a state row
-- are treated as uninitialized/fail-closed until an explicit fog action initializes them.
insert into private.fog_level_state(campaign_id,level_id,initialized)
select campaign_id,id,true from public.levels
on conflict(level_id) do nothing;

create function private.fog_effective_enabled(p_level uuid) returns boolean
language sql stable set search_path='' as $$
  select coalesce(lv.fog_enabled,loc.fog_enabled,c.fog_enabled)
  from public.levels lv
  join public.locations loc on loc.id=lv.location_id and loc.campaign_id=lv.campaign_id
  join public.campaigns c on c.id=lv.campaign_id
  where lv.id=p_level
$$;

create function private.fog_revealed_runs(p_level uuid) returns jsonb
language sql stable set search_path='' as $$
  with ordered as (
    select f.y,f.x,
      f.x-row_number() over(partition by f.y order by f.x) as run_group
    from public.fog_cells f
    where f.level_id=p_level and f.is_revealed
  ), runs as (
    select y,min(x) as x_start,max(x)+1 as x_end
    from ordered
    group by y,run_group
  )
  select coalesce(
    jsonb_agg(jsonb_build_array(y,x_start,x_end) order by y,x_start),
    '[]'::jsonb
  )
  from runs
$$;

create function private.fog_area_runs(p_cells jsonb) returns jsonb
language sql stable set search_path='' as $$
  with area_cells as (
    select distinct (cell->>1)::integer as y,(cell->>0)::integer as x
    from jsonb_array_elements(coalesce(p_cells,'[]'::jsonb)) cell
    where jsonb_typeof(cell)='array'
      and jsonb_array_length(cell)=2
      and jsonb_typeof(cell->0)='number'
      and jsonb_typeof(cell->1)='number'
      and (cell->>0) ~ '^-?[0-9]+$'
      and (cell->>1) ~ '^-?[0-9]+$'
  ), ordered as (
    select y,x,x-row_number() over(partition by y order by x) as run_group
    from area_cells
  ), runs as (
    select y,min(x) as x_start,max(x)+1 as x_end
    from ordered
    group by y,run_group
  )
  select coalesce(
    jsonb_agg(jsonb_build_array(y,x_start,x_end) order by y,x_start),
    '[]'::jsonb
  )
  from runs
$$;

create function private.fog_area_status(p_level uuid,p_cells jsonb) returns text
language sql stable set search_path='' as $$
  with area_cells as (
    select distinct (cell->>0)::integer as x,(cell->>1)::integer as y
    from jsonb_array_elements(coalesce(p_cells,'[]'::jsonb)) cell
    where jsonb_typeof(cell)='array'
      and jsonb_array_length(cell)=2
      and jsonb_typeof(cell->0)='number'
      and jsonb_typeof(cell->1)='number'
      and (cell->>0) ~ '^-?[0-9]+$'
      and (cell->>1) ~ '^-?[0-9]+$'
  ), counts as (
    select count(*) as total,
      count(*) filter(where exists(
        select 1 from public.fog_cells f
        where f.level_id=p_level and f.x=a.x and f.y=a.y and f.is_revealed
      )) as revealed
    from area_cells a
  )
  select case
    when total=0 or revealed=0 then 'Hidden'
    when revealed=total then 'Revealed'
    else 'Mixed'
  end
  from counts
$$;

-- Discrete creature/object exposure is deliberately distinct from full-area visibility.
-- A disclosed discrete token is spatially exposed once any occupied cell is revealed.
-- Existing sync_rect_visible remains unchanged for full-footprint consumers.
create function private.sync_rect_exposed(l uuid,x integer,y integer,w integer,h integer) returns boolean
language sql stable set search_path='' as $$
  select exists(
    select 1
    from public.levels lv
    where lv.id=l
      and x>=0 and y>=0 and w>0 and h>0
      and x+w<=lv.grid_width and y+h<=lv.grid_height
      and (
        not coalesce(private.fog_effective_enabled(l),true)
        or exists(
          select 1 from public.fog_cells f
          where f.level_id=l and f.is_revealed
            and f.x>=x and f.x<x+w
            and f.y>=y and f.y<y+h
        )
      )
  )
$$;

create or replace function private.session_projection(p_session uuid,p_user uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare
  s public.sessions;
  manager boolean;
  own_id uuid;
  token_rows jsonb;
  cards jsonb;
  turns jsonb;
  dm_state jsonb;
  fog_state jsonb;
  manager_fog jsonb;
begin
  select * into s from public.sessions where id=p_session;
  if s.id is null or p_user is null or not private.sync_can_read(p_session,p_user) then
    raise exception 'Session unavailable' using errcode='42501';
  end if;

  manager:=private.sync_can_manage(s.campaign_id,p_user);

  select p.character_id into own_id
  from public.session_players p
  join public.campaign_members m on m.campaign_id=p.campaign_id and m.user_id=p.user_id
  where p.session_id=s.id and p.user_id=p_user and p.status='approved' and m.status='approved'
    and s.status in ('lobby','active');

  if s.active_level_id is not null then
    select jsonb_build_object(
      'levelId',lv.id,
      'width',lv.grid_width,
      'height',lv.grid_height,
      'enabled',coalesce(private.fog_effective_enabled(lv.id),true),
      'revealedRuns',private.fog_revealed_runs(lv.id)
    ) into fog_state
    from public.levels lv
    where lv.id=s.active_level_id and lv.campaign_id=s.campaign_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'levelId',t.level_id,
    'characterId',t.character_id,
    'kind',t.kind,
    'label',t.label,
    'conditionLabel',t.condition_label,
    'x',t.x,
    'y',t.y,
    'width',t.width,
    'height',t.height,
    'isVisible',t.is_visible,
    'publicVisible',(s.status='active' and t.is_visible and private.sync_rect_exposed(t.level_id,t.x,t.y,t.width,t.height))
  ) order by t.id),'[]'::jsonb) into token_rows
  from public.tokens t
  where t.campaign_id=s.campaign_id and t.level_id=s.active_level_id
    and (manager or (s.status='active' and t.is_visible and private.sync_rect_exposed(t.level_id,t.x,t.y,t.width,t.height)));

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,
    'name',c.name,
    'playerName',c.player_name,
    'approved',c.approved,
    'hp',c.hp,
    'maxHp',c.max_hp,
    'tempHp',c.temp_hp,
    'ac',c.ac,
    'speed',c.speed,
    'statuses',c.statuses,
    'publicNotes',c.public_notes,
    'imagePath',c.image_path,
    'updatedAt',c.updated_at,
    'publicVisible',exists(
      select 1
      from public.session_players p2
      join public.campaign_members m2
        on m2.campaign_id=p2.campaign_id and m2.user_id=p2.user_id
      where p2.session_id=s.id and p2.character_id=c.id and c.approved
        and p2.status='approved' and m2.status='approved'
    )
  ) order by c.id),'[]'::jsonb) into cards
  from public.characters c
  where c.campaign_id=s.campaign_id
    and (
      c.id=own_id
      or exists(
        select 1
        from public.session_players p
        join public.campaign_members m
          on m.campaign_id=p.campaign_id and m.user_id=p.user_id
        where p.session_id=s.id and p.character_id=c.id
          and (manager or (c.approved and p.status='approved' and m.status='approved'))
      )
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,
    'tokenId',i.token_id,
    'initiative',i.initiative,
    'position',i.position,
    'isActive',i.is_active,
    'publicVisible',coalesce((
      select (t->>'publicVisible')::boolean
      from jsonb_array_elements(token_rows) t
      where t->>'id'=i.token_id::text
    ),false)
  ) order by i.position,i.id),'[]'::jsonb) into turns
  from public.initiative_entries i
  where i.session_id=s.id and i.campaign_id=s.campaign_id
    and exists(select 1 from jsonb_array_elements(token_rows) t where t->>'id'=i.token_id::text);

  if manager then
    select jsonb_build_object(
      'campaignEnabled',c.fog_enabled,
      'locationId',lv.location_id,
      'locationOverride',loc.fog_enabled,
      'levelOverride',lv.fog_enabled,
      'effectiveEnabled',coalesce(private.fog_effective_enabled(lv.id),true),
      'initialized',coalesce(fls.initialized,false),
      'areas',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',a.id,
          'levelId',a.level_id,
          'name',a.name,
          'cellRuns',private.fog_area_runs(a.cells),
          'revealedByDefault',a.revealed_by_default,
          'status',private.fog_area_status(a.level_id,a.cells)
        ) order by a.name,a.id)
        from private.fog_areas a
        where a.campaign_id=s.campaign_id and a.level_id=lv.id
      ),'[]'::jsonb),
      'levelRevisions',coalesce((
        select jsonb_agg(jsonb_build_object(
          'levelId',all_lv.id,
          'revision',coalesce(all_fls.revision,0)::text
        ) order by all_lv.id)
        from public.levels all_lv
        left join private.fog_level_state all_fls on all_fls.level_id=all_lv.id
        where all_lv.campaign_id=s.campaign_id
      ),'[]'::jsonb)
    ) into manager_fog
    from public.levels lv
    join public.locations loc on loc.id=lv.location_id and loc.campaign_id=lv.campaign_id
    join public.campaigns c on c.id=lv.campaign_id
    left join private.fog_level_state fls on fls.level_id=lv.id
    where lv.id=s.active_level_id and lv.campaign_id=s.campaign_id;

    select jsonb_build_object(
      'tokenDetails',coalesce((
        select jsonb_agg(jsonb_build_object(
          'tokenId',d.token_id,
          'actualHp',d.actual_hp,
          'maxHp',d.max_hp,
          'dmNotes',d.dm_notes
        ) order by d.token_id)
        from private.token_details d
        join public.tokens t on t.id=d.token_id
        where d.campaign_id=s.campaign_id and t.level_id=s.active_level_id
      ),'[]'::jsonb),
      'notes',coalesce((
        select jsonb_agg(jsonb_build_object('id',n.id,'subject',n.subject,'body',n.body) order by n.id)
        from private.dm_notes n
        where n.campaign_id=s.campaign_id
      ),'[]'::jsonb),
      'activity',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',a.id,
          'eventType',a.event_type,
          'actorId',a.actor_id,
          'createdAt',a.created_at
        ) order by a.created_at desc,a.id)
        from (
          select id,event_type,actor_id,created_at
          from private.activity_feed
          where campaign_id=s.campaign_id and session_id=s.id
          order by created_at desc,id
          limit 50
        ) a
      ),'[]'::jsonb),
      'fog',manager_fog
    ) into dm_state;
  end if;

  return jsonb_build_object(
    'schemaVersion',1,
    'sessionId',s.id,
    'campaignId',s.campaign_id,
    'authority',jsonb_build_object('canManage',manager,'ownCharacterId',own_id),
    'session',jsonb_build_object('id',s.id,'name',s.name,'status',s.status,'activeLevelId',s.active_level_id),
    'roundNumber',coalesce((select round_number from public.session_state where session_id=s.id),1),
    'fog',fog_state,
    'tokens',token_rows,
    'characters',cards,
    'initiative',turns,
    'dm',dm_state
  );
end $$;

revoke all on function private.fog_effective_enabled(uuid),
  private.fog_revealed_runs(uuid),
  private.fog_area_runs(jsonb),
  private.fog_area_status(uuid,jsonb),
  private.sync_rect_exposed(uuid,integer,integer,integer,integer)
from public,anon,authenticated;

-- session_projection's shape changed for every authorized recipient. Refresh the
-- recipient caches once so the existing realtime watermark lifecycle sees the new shape.
do $$
declare c record;
begin
  for c in select id from public.campaigns order by id loop
    perform private.refresh_session_sync(c.id);
  end loop;
end $$;
