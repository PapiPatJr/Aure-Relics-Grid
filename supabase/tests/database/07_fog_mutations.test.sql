-- Issue #10 Task 2 RED: DM-only atomic fog mutations, reset defaults, and realtime storm prevention.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,is_anonymous) values
('0b000000-0000-0000-0000-000000000001',false),
('0b000000-0000-0000-0000-000000000002',true),
('0b000000-0000-0000-0000-000000000003',false);

insert into campaigns(id,owner_id,name,fog_enabled) values
('0b100000-0000-0000-0000-000000000001','0b000000-0000-0000-0000-000000000001','Fog Mutations',true),
('0b100000-0000-0000-0000-000000000002','0b000000-0000-0000-0000-000000000003','Other Campaign',true);
insert into locations(id,campaign_id,name) values
('0b200000-0000-0000-0000-000000000001','0b100000-0000-0000-0000-000000000001','Dungeon'),
('0b200000-0000-0000-0000-000000000002','0b100000-0000-0000-0000-000000000002','Foreign');
insert into levels(id,campaign_id,location_id,name,grid_width,grid_height) values
('0b300000-0000-0000-0000-000000000001','0b100000-0000-0000-0000-000000000001','0b200000-0000-0000-0000-000000000001','Active',4,4),
('0b300000-0000-0000-0000-000000000002','0b100000-0000-0000-0000-000000000001','0b200000-0000-0000-0000-000000000001','Prepared',200,200),
('0b300000-0000-0000-0000-000000000003','0b100000-0000-0000-0000-000000000002','0b200000-0000-0000-0000-000000000002','Foreign',4,4);
insert into sessions(id,campaign_id,name,status,active_level_id) values
('0b400000-0000-0000-0000-000000000001','0b100000-0000-0000-0000-000000000001','Fog Live','active','0b300000-0000-0000-0000-000000000001');
insert into campaign_members(campaign_id,user_id,status) values
('0b100000-0000-0000-0000-000000000001','0b000000-0000-0000-0000-000000000002','approved');
insert into session_players(campaign_id,session_id,user_id,status) values
('0b100000-0000-0000-0000-000000000001','0b400000-0000-0000-0000-000000000001','0b000000-0000-0000-0000-000000000002','approved');
insert into tokens(id,campaign_id,level_id,kind,label,x,y,is_visible) values
('0b600000-0000-0000-0000-000000000001','0b100000-0000-0000-0000-000000000001','0b300000-0000-0000-0000-000000000001','enemy','Secret Enemy',0,0,false);

-- Browser roles must not bypass the command layer.
select ok(not has_table_privilege('authenticated','public.fog_cells','INSERT'),'authenticated cannot insert fog cells directly');
select ok(not has_table_privilege('authenticated','public.fog_cells','UPDATE'),'authenticated cannot update fog cells directly');
select ok(not has_table_privilege('authenticated','public.fog_cells','DELETE'),'authenticated cannot delete fog cells directly');
select ok(not has_table_privilege('authenticated','private.fog_areas','INSERT'),'authenticated cannot insert private fog areas directly');
select ok(not has_table_privilege('authenticated','private.fog_level_state','UPDATE'),'authenticated cannot update private fog revision state directly');

-- A participant may hydrate but never mutate fog.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0b000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok(
  $$select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
    'schemaVersion',1,'type','fog.paint','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',
    'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','mode','reveal','cells',jsonb_build_array(jsonb_build_array(0,0)))))$$,
  '42501',null,'participant cannot mutate fog'
);
reset role;

-- Manager command validation and scope.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0b000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok(
  $$select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
    'schemaVersion',1,'type','fog.paint','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',
    'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000003','mode','reveal','cells',jsonb_build_array(jsonb_build_array(0,0)))))$$,
  '42501',null,'fog command rejects cross-campaign level'
);
select throws_ok(
  $$select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
    'schemaVersion',1,'type','fog.paint','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',
    'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','mode','reveal','cells',jsonb_build_array(jsonb_build_array(4,0)))))$$,
  '22023',null,'fog paint rejects out-of-bounds cells'
);
select throws_ok(
  $$select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
    'schemaVersion',1,'type','fog.paint','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',
    'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','mode','reveal','cells','[[0.5,0]]'::jsonb)))$$,
  '22023',null,'fog paint rejects non-integer coordinates'
);

-- One stroke canonicalizes duplicates and establishes current state.
select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.paint','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',
  'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','mode','reveal','cells','[[0,0],[0,0],[1,0]]'::jsonb)));
select is((select count(*)::int from fog_cells where level_id='0b300000-0000-0000-0000-000000000001' and is_revealed),2,'duplicate stroke cells canonicalize to two revealed cells');
select is((select initialized from private.fog_level_state where level_id='0b300000-0000-0000-0000-000000000001'),true,'paint marks level fog initialized');

-- Stale manager state must fail before any write.
select set_config('test.stale_fog_revision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',true);
select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.paint','expectedRevision',current_setting('test.stale_fog_revision'),
  'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','mode','hide','cells','[[0,0]]'::jsonb)));
select throws_ok(
  $$select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
    'schemaVersion',1,'type','fog.paint','expectedRevision',current_setting('test.stale_fog_revision'),
    'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','mode','reveal','cells','[[2,0]]'::jsonb)))$$,
  '40001',null,'stale fog mutation is rejected'
);
select is((select count(*)::int from fog_cells where level_id='0b300000-0000-0000-0000-000000000001' and x=2 and y=0),0,'stale rejection leaves canonical fog unchanged');

-- Area definition edits do not change live fog.
select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.area.create','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',
  'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','name','Starting Room','cells','[[0,0],[1,0],[2,0]]'::jsonb,'revealedByDefault',true)));
select is((select count(*)::int from fog_cells where level_id='0b300000-0000-0000-0000-000000000001' and x=2 and y=0),0,'area create changes definition only, not live fog');
select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.area.setVisibility','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',
  'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','areaId',(select id from private.fog_areas where name='Starting Room'),'revealed',true)));
select is((select count(*)::int from fog_cells where level_id='0b300000-0000-0000-0000-000000000001' and is_revealed),3,'Reveal Area writes selected canonical cells in one logical operation');

-- Hidden-by-default wins overlapping reset defaults.
select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.area.create','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',
  'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','name','Secret Alcove','cells','[[1,0]]'::jsonb,'revealedByDefault',false)));
select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.resetDefaults','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision','payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001')));
select is((select count(*)::int from fog_cells where level_id='0b300000-0000-0000-0000-000000000001' and is_revealed),2,'reset reveals default-Revealed cells except Hidden-default overlap');
select ok(not exists(select 1 from fog_cells where level_id='0b300000-0000-0000-0000-000000000001' and x=1 and y=0 and is_revealed),'Hidden-default overlap wins reset precedence');

-- Broad actions are set-based, preserve disclosure, and advance manager projection once.
select set_config('test.before_reveal_all',(get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision'),true);
select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.revealAll','expectedRevision',current_setting('test.before_reveal_all'),'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001')));
select is((select count(*)::int from fog_cells where level_id='0b300000-0000-0000-0000-000000000001' and is_revealed),16,'Reveal All reveals every active-level cell');
select is((get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision')::bigint,current_setting('test.before_reveal_all')::bigint+1,'Reveal All advances manager projection exactly once');
select is((select is_visible from tokens where id='0b600000-0000-0000-0000-000000000001'),false,'fog actions do not alter hidden-object disclosure');

select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.hideAll','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision','payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001')));
select is((select count(*)::int from fog_cells where level_id='0b300000-0000-0000-0000-000000000001'),0,'Hide All stores Hidden sparsely as no rows');

-- Preserve stored mask when fog is disabled/re-enabled.
select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.paint','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',
  'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','mode','reveal','cells','[[3,3]]'::jsonb)));
select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.setLevelOverride','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',
  'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','enabled',false)));
select ok(exists(select 1 from fog_cells where level_id='0b300000-0000-0000-0000-000000000001' and x=3 and y=3 and is_revealed),'Disable Fog preserves stored revealed cells');
select is((select is_visible from tokens where id='0b600000-0000-0000-0000-000000000001'),false,'Disable Fog does not disclose hidden token');
select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.setLevelOverride','expectedRevision',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',
  'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000001','enabled',true)));
select ok(exists(select 1 from fog_cells where level_id='0b300000-0000-0000-0000-000000000001' and x=3 and y=3 and is_revealed),'re-enable restores exact stored mask');

-- Non-presented 200x200 level: player watermark stays put while manager level revision advances.
select set_config('test.manager_before_offscreen',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',true);
select set_config('request.jwt.claims','{"sub":"0b000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select set_config('test.player_before_offscreen',get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',true);
select set_config('request.jwt.claims','{"sub":"0b000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select mutate_session('0b400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','fog.revealAll','expectedRevision',current_setting('test.manager_before_offscreen'),'payload',jsonb_build_object('levelId','0b300000-0000-0000-0000-000000000002')));
select is((select count(*)::int from fog_cells where level_id='0b300000-0000-0000-0000-000000000002' and is_revealed),40000,'Reveal All handles maximum 200x200 level set-wise');
select ok((select revision>0 from private.fog_level_state where level_id='0b300000-0000-0000-0000-000000000002'),'offscreen edit advances level fog revision');
select set_config('request.jwt.claims','{"sub":"0b000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is(get_session_snapshot('0b400000-0000-0000-0000-000000000001')->>'revision',current_setting('test.player_before_offscreen'),'offscreen fog edit does not advance real player active-level projection');
reset role;

select * from finish();
rollback;
