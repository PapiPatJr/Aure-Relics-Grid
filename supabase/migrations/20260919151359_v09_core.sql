-- Issue #5: campaign-owned canonical records. Never store secrets in shared fields.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke create on schema public from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;
create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 100)
);
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null check (length(name) between 1 and 200),
  fog_enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index campaigns_owner on public.campaigns(owner_id);
create table public.campaign_members (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  primary key (campaign_id,user_id)
);
create index campaign_members_user on public.campaign_members(user_id,campaign_id);
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  fog_enabled boolean,
  unique (campaign_id,id)
);
create table public.levels (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  location_id uuid not null,
  name text not null,
  floor_number integer not null default 0,
  grid_width integer not null default 20 check (grid_width between 1 and 200),
  grid_height integer not null default 20 check (grid_height between 1 and 200),
  theme text not null default 'relic',
  fog_enabled boolean,
  unique (campaign_id,id),
  foreign key (campaign_id,location_id) references public.locations(campaign_id,id) on delete cascade
);
create index levels_location on public.levels(campaign_id,location_id);
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  status text not null default 'lobby' check (status in ('lobby','active','closed')),
  active_level_id uuid,
  unique (campaign_id,id),
  foreign key (campaign_id,active_level_id) references public.levels(campaign_id,id)
);
create index sessions_level on public.sessions(campaign_id,active_level_id);
-- Characters are player characters ONLY. Enemy/NPC/boss HP belongs to private.token_details.
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  player_name text not null default '',
  approved boolean not null default false,
  hp integer not null default 0,
  max_hp integer not null default 0 check (max_hp >= 0),
  temp_hp integer not null default 0 check (temp_hp >= 0),
  ac integer not null default 10,
  speed integer not null default 30 check (speed >= 0),
  statuses text[] not null default '{}',
  unique (campaign_id,id)
);
create table public.session_players (
  campaign_id uuid not null,
  session_id uuid not null,
  user_id uuid not null,
  character_id uuid,
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  primary key (session_id,user_id),
  unique (session_id,character_id),
  foreign key (campaign_id,session_id) references public.sessions(campaign_id,id) on delete cascade,
  foreign key (campaign_id,user_id) references public.campaign_members(campaign_id,user_id) on delete cascade,
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id)
);
create index session_players_user on public.session_players(user_id,campaign_id,session_id);
create index session_players_member on public.session_players(campaign_id,user_id);
create index session_players_character on public.session_players(campaign_id,character_id);
create table public.session_state (
  session_id uuid primary key,
  campaign_id uuid not null,
  round_number integer not null default 1 check (round_number > 0),
  revision bigint not null default 0 check (revision >= 0),
  foreign key (campaign_id,session_id) references public.sessions(campaign_id,id) on delete cascade
);
create index session_state_campaign on public.session_state(campaign_id,session_id);
create table public.tokens (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  level_id uuid not null,
  character_id uuid,
  kind text not null check (kind in ('player','enemy','npc','boss')),
  label text not null,
  condition_label text not null default 'Unknown' check (condition_label in ('Healthy','Hurt','Wounded','Bloodied','Near Death','Defeated','Unknown')),
  x integer not null check (x between 0 and 199),
  y integer not null check (y between 0 and 199),
  width integer not null default 1 check (width between 1 and 200),
  height integer not null default 1 check (height between 1 and 200),
  is_visible boolean not null default false,
  unique (campaign_id,id),
  check ((kind = 'player' and character_id is not null) or (kind <> 'player' and character_id is null)),
  foreign key (campaign_id,level_id) references public.levels(campaign_id,id) on delete cascade,
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id)
);
create index tokens_level on public.tokens(campaign_id,level_id);
create index tokens_character on public.tokens(campaign_id,character_id);
create table public.terrain_objects (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  level_id uuid not null,
  label text not null,
  -- Coordinates are in cells. Bounding box must be fully revealed to players.
  x numeric not null check (x between 0 and 199),
  y numeric not null check (y between 0 and 199),
  width numeric not null default 1 check (width > 0 and width <= 200),
  height numeric not null default 1 check (height > 0 and height <= 200),
  rotation numeric not null default 0 check (rotation between 0 and 360),
  z_index integer not null default 0,
  locked boolean not null default false,
  is_visible boolean not null default false,
  unique (campaign_id,id),
  foreign key (campaign_id,level_id) references public.levels(campaign_id,id) on delete cascade
);
create index terrain_level on public.terrain_objects(campaign_id,level_id);
create table public.fog_cells (
  campaign_id uuid not null,
  level_id uuid not null,
  x integer not null check (x between 0 and 199),
  y integer not null check (y between 0 and 199),
  is_revealed boolean not null default false,
  primary key (level_id,x,y),
  foreign key (campaign_id,level_id) references public.levels(campaign_id,id) on delete cascade
);
create index fog_cells_level on public.fog_cells(campaign_id,level_id);
-- Distinct effect kinds share visibility and ownership; sensitive mechanics are private.
create table public.map_effects (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  level_id uuid not null,
  kind text not null check (kind in ('hazard','trap','difficult_terrain')),
  label text not null,
  public_notes text not null default '',
  x integer not null check (x between 0 and 199),
  y integer not null check (y between 0 and 199),
  width integer not null default 1 check (width between 1 and 200),
  height integer not null default 1 check (height between 1 and 200),
  is_visible boolean not null default false,
  unique (campaign_id,id),
  foreign key (campaign_id,level_id) references public.levels(campaign_id,id) on delete cascade
);
create index map_effects_level on public.map_effects(campaign_id,level_id);
create table public.initiative_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  session_id uuid not null,
  token_id uuid not null,
  initiative integer not null default 0,
  position integer not null default 0,
  is_active boolean not null default false,
  foreign key (campaign_id,session_id) references public.sessions(campaign_id,id) on delete cascade,
  foreign key (campaign_id,token_id) references public.tokens(campaign_id,id) on delete cascade
);
create index initiative_session on public.initiative_entries(campaign_id,session_id);
create index initiative_token on public.initiative_entries(campaign_id,token_id);

create table private.token_details (
  token_id uuid primary key,
  campaign_id uuid not null,
  actual_hp integer not null default 0,
  max_hp integer not null default 0 check (max_hp >= 0),
  dm_notes text not null default '',
  foreign key (campaign_id,token_id) references public.tokens(campaign_id,id) on delete cascade
);
create table private.character_details (
  character_id uuid primary key,
  campaign_id uuid not null,
  dm_notes text not null default '',
  sheet jsonb not null default '{}',
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id) on delete cascade
);
create table private.terrain_details (
  terrain_id uuid primary key,
  campaign_id uuid not null,
  dm_notes text not null default '',
  metadata jsonb not null default '{}',
  foreign key (campaign_id,terrain_id) references public.terrain_objects(campaign_id,id) on delete cascade
);
create table private.map_effect_details (
  effect_id uuid primary key,
  campaign_id uuid not null,
  dm_notes text not null default '',
  trigger_text text,
  detection text,
  damage text,
  save_dc integer,
  duration text,
  state text not null default 'armed' check (state in ('armed','disarmed','triggered','active','inactive')),
  cells jsonb not null default '[]',
  foreign key (campaign_id,effect_id) references public.map_effects(campaign_id,id) on delete cascade
);
create table private.fog_areas (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  level_id uuid not null,
  name text not null,
  cells jsonb not null default '[]' check (jsonb_typeof(cells) = 'array'),
  revealed_by_default boolean not null default false,
  foreign key (campaign_id,level_id) references public.levels(campaign_id,id) on delete cascade
);
create table private.dm_notes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  subject text not null default '',
  body text not null default ''
);
create table private.session_snapshots (
  session_id uuid primary key,
  campaign_id uuid not null,
  schema_version integer not null default 1,
  state jsonb not null default '{}',
  foreign key (campaign_id,session_id) references public.sessions(campaign_id,id) on delete cascade
);
create table private.movement_paths (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  session_id uuid not null,
  token_id uuid not null,
  waypoints jsonb not null default '[]' check (jsonb_typeof(waypoints) = 'array'),
  status text not null default 'requested' check (status in ('requested','approved','rejected','finalized')),
  foreign key (campaign_id,session_id) references public.sessions(campaign_id,id) on delete cascade,
  foreign key (campaign_id,token_id) references public.tokens(campaign_id,id) on delete cascade
);
create table private.activity_feed (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (campaign_id,session_id) references public.sessions(campaign_id,id) on delete cascade
);
create table private.character_codes (
  character_id uuid primary key,
  campaign_id uuid not null,
  code_hash bytea not null check (octet_length(code_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (campaign_id,character_id) references public.characters(campaign_id,id) on delete cascade
);
create table private.campaign_codes (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  code_hash bytea not null check (octet_length(code_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create table private.session_codes (
  session_id uuid primary key,
  campaign_id uuid not null,
  code_hash bytea not null check (octet_length(code_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (campaign_id,session_id) references public.sessions(campaign_id,id) on delete cascade
);

-- Private tables get ownership indexes as well as PK indexes.
do $$ declare t text; begin
  foreach t in array array['token_details','character_details','terrain_details','map_effect_details',
    'fog_areas','dm_notes','session_snapshots','movement_paths','activity_feed','character_codes','session_codes'] loop
    execute format('create index %I on private.%I(campaign_id)', t || '_campaign', t);
  end loop;
end $$;
create index fog_areas_level on private.fog_areas(campaign_id,level_id);
create index movement_paths_session on private.movement_paths(campaign_id,session_id);
create index movement_paths_token on private.movement_paths(campaign_id,token_id);
create index activity_feed_session on private.activity_feed(campaign_id,session_id);
create index activity_feed_actor on private.activity_feed(actor_id);
