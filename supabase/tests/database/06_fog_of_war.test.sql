-- Issue #10 Task 1 RED: authoritative fog projection primitives and compact mask output.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,is_anonymous) values
('0a000000-0000-0000-0000-000000000001',false),
('0a000000-0000-0000-0000-000000000002',true);

insert into campaigns(id,owner_id,name,fog_enabled) values
('0a100000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000001','Fog Contract',true);
insert into locations(id,campaign_id,name,fog_enabled) values
('0a200000-0000-0000-0000-000000000001','0a100000-0000-0000-0000-000000000001','Dungeon',null);
insert into levels(id,campaign_id,location_id,name,grid_width,grid_height,fog_enabled) values
('0a300000-0000-0000-0000-000000000001','0a100000-0000-0000-0000-000000000001','0a200000-0000-0000-0000-000000000001','Crypt',4,4,null),
('0a300000-0000-0000-0000-000000000002','0a100000-0000-0000-0000-000000000001','0a200000-0000-0000-0000-000000000001','Vault',4,4,false);
insert into sessions(id,campaign_id,name,status,active_level_id) values
('0a400000-0000-0000-0000-000000000001','0a100000-0000-0000-0000-000000000001','Fog Session','active','0a300000-0000-0000-0000-000000000001');
insert into campaign_members(campaign_id,user_id,status) values
('0a100000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000002','approved');
insert into session_players(campaign_id,session_id,user_id,status) values
('0a100000-0000-0000-0000-000000000001','0a400000-0000-0000-0000-000000000001','0a000000-0000-0000-0000-000000000002','approved');

insert into fog_cells(campaign_id,level_id,x,y,is_revealed) values
('0a100000-0000-0000-0000-000000000001','0a300000-0000-0000-0000-000000000001',0,0,true),
('0a100000-0000-0000-0000-000000000001','0a300000-0000-0000-0000-000000000001',1,0,true),
('0a100000-0000-0000-0000-000000000001','0a300000-0000-0000-0000-000000000001',1,1,true);

insert into private.fog_areas(id,campaign_id,level_id,name,cells,revealed_by_default) values
('0aa00000-0000-0000-0000-000000000001','0a100000-0000-0000-0000-000000000001','0a300000-0000-0000-0000-000000000001','Starting Room','[[0,0],[2,0]]'::jsonb,true);

insert into tokens(id,campaign_id,level_id,kind,label,x,y,width,height,is_visible) values
('0a600000-0000-0000-0000-000000000001','0a100000-0000-0000-0000-000000000001','0a300000-0000-0000-0000-000000000001','enemy','Partially Exposed Ogre',0,0,2,2,true),
('0a600000-0000-0000-0000-000000000002','0a100000-0000-0000-0000-000000000001','0a300000-0000-0000-0000-000000000001','enemy','DM Hidden Enemy',0,0,1,1,false);

-- Inheritance: Level -> Location -> Campaign.
select results_eq(
  $$select private.fog_effective_enabled('0a300000-0000-0000-0000-000000000001'::uuid)$$,
  $$values (true)$$,
  'effective fog inherits campaign true when level/location inherit'
);
update locations set fog_enabled=false where id='0a200000-0000-0000-0000-000000000001';
select results_eq(
  $$select private.fog_effective_enabled('0a300000-0000-0000-0000-000000000001'::uuid)$$,
  $$values (false)$$,
  'location override wins over campaign'
);
update levels set fog_enabled=true where id='0a300000-0000-0000-0000-000000000001';
select results_eq(
  $$select private.fog_effective_enabled('0a300000-0000-0000-0000-000000000001'::uuid)$$,
  $$values (true)$$,
  'level override wins over location'
);
update locations set fog_enabled=null where id='0a200000-0000-0000-0000-000000000001';
update levels set fog_enabled=null where id='0a300000-0000-0000-0000-000000000001';

-- Compact row-run output is deterministic.
select results_eq(
  $$select private.fog_revealed_runs('0a300000-0000-0000-0000-000000000001'::uuid)$$,
  $$values ('[[0, 0, 2], [1, 1, 2]]'::jsonb)$$,
  'revealed fog cells compact into deterministic [y,start,endExclusive] row runs'
);

-- Existing full-rectangle predicate stays strict, while discrete-token exposure is any occupied cell.
select is(
  private.sync_rect_visible('0a300000-0000-0000-0000-000000000001',0,0,2,2),
  false,
  'sync_rect_visible still requires every occupied cell to be revealed'
);
select results_eq(
  $$select private.sync_rect_exposed('0a300000-0000-0000-0000-000000000001'::uuid,0,0,2,2)$$,
  $$values (true)$$,
  'sync_rect_exposed allows a disclosed discrete token once any occupied cell is revealed'
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0a000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('test.manager_fog_snapshot',get_session_snapshot('0a400000-0000-0000-0000-000000000001')::text,true);
select is(current_setting('test.manager_fog_snapshot')::jsonb->'fog'->>'levelId','0a300000-0000-0000-0000-000000000001','manager snapshot carries active-level fog projection');
select is(current_setting('test.manager_fog_snapshot')::jsonb->'fog'->'revealedRuns','[[0,0,2],[1,1,2]]'::jsonb,'manager active-level fog uses compact runs');
select is(current_setting('test.manager_fog_snapshot')::jsonb->'dm'->'fog'->>'effectiveEnabled','true','manager receives DM fog management metadata');
select is((select a->>'status' from jsonb_array_elements(current_setting('test.manager_fog_snapshot')::jsonb->'dm'->'fog'->'areas') a where a->>'name'='Starting Room'),'Mixed','named area status derives Mixed from canonical cell truth');
select is((select t->>'publicVisible' from jsonb_array_elements(current_setting('test.manager_fog_snapshot')::jsonb->'tokens') t where t->>'id'='0a600000-0000-0000-0000-000000000001'),'true','partially exposed visible discrete token is publicVisible');
select is((select t->>'publicVisible' from jsonb_array_elements(current_setting('test.manager_fog_snapshot')::jsonb->'tokens') t where t->>'id'='0a600000-0000-0000-0000-000000000002'),'false','is_visible=false token remains non-public under revealed fog');

select set_config('request.jwt.claims','{"sub":"0a000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select set_config('test.player_fog_snapshot',get_session_snapshot('0a400000-0000-0000-0000-000000000001')::text,true);
select is(current_setting('test.player_fog_snapshot')::jsonb->'fog'->>'levelId','0a300000-0000-0000-0000-000000000001','player receives active-level fog projection');
select is(current_setting('test.player_fog_snapshot')::jsonb->'dm','null'::jsonb,'player receives no DM metadata');
select ok(not (current_setting('test.player_fog_snapshot')::jsonb::text ~ 'Starting Room'),'player projection contains no named-area name');
select is(jsonb_array_length(current_setting('test.player_fog_snapshot')::jsonb->'tokens'),1,'player receives only the disclosed spatially exposed token');
reset role;

select * from finish();
rollback;
