-- Tuesday Online Playability Package 1: authoritative gameplay commands.
-- Canonical-table assertions run only as the pgTAP database owner; application actors mutate
-- exclusively through public.mutate_session.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,is_anonymous) values
('0c000000-0000-0000-0000-000000000001',false),
('0c000000-0000-0000-0000-000000000002',true),
('0c000000-0000-0000-0000-000000000003',true),
('0c000000-0000-0000-0000-000000000004',false);
insert into campaigns(id,owner_id,name,fog_enabled) values
('0c100000-0000-0000-0000-000000000001','0c000000-0000-0000-0000-000000000001','Prepare Campaign',true),
('0c100000-0000-0000-0000-000000000002','0c000000-0000-0000-0000-000000000004','Foreign Campaign',true),
('0c100000-0000-0000-0000-000000000003','0c000000-0000-0000-0000-000000000001','Gameplay Campaign',true);
insert into locations(id,campaign_id,name) values
('0c200000-0000-0000-0000-000000000001','0c100000-0000-0000-0000-000000000003','Gameplay Location'),
('0c200000-0000-0000-0000-000000000002','0c100000-0000-0000-0000-000000000002','Foreign Location');
insert into levels(id,campaign_id,location_id,name,grid_width,grid_height,theme) values
('0c300000-0000-0000-0000-000000000001','0c100000-0000-0000-0000-000000000003','0c200000-0000-0000-0000-000000000001','Active Board',4,4,'relic'),
('0c300000-0000-0000-0000-000000000002','0c100000-0000-0000-0000-000000000003','0c200000-0000-0000-0000-000000000001','Other Board',4,4,'relic'),
('0c300000-0000-0000-0000-000000000003','0c100000-0000-0000-0000-000000000002','0c200000-0000-0000-0000-000000000002','Foreign Board',4,4,'relic');
insert into sessions(id,campaign_id,name,status,active_level_id) values
('0c400000-0000-0000-0000-000000000001','0c100000-0000-0000-0000-000000000001','Prepare Session','lobby',null),
('0c400000-0000-0000-0000-000000000002','0c100000-0000-0000-0000-000000000003','Gameplay Session','active','0c300000-0000-0000-0000-000000000001'),
('0c400000-0000-0000-0000-000000000003','0c100000-0000-0000-0000-000000000002','Foreign Session','active','0c300000-0000-0000-0000-000000000003');
insert into campaign_members(campaign_id,user_id,status) values
('0c100000-0000-0000-0000-000000000001','0c000000-0000-0000-0000-000000000002','approved'),
('0c100000-0000-0000-0000-000000000001','0c000000-0000-0000-0000-000000000003','pending'),
('0c100000-0000-0000-0000-000000000003','0c000000-0000-0000-0000-000000000002','approved'),
('0c100000-0000-0000-0000-000000000003','0c000000-0000-0000-0000-000000000003','pending');
insert into characters(id,campaign_id,name,approved) values
('0c500000-0000-0000-0000-000000000001','0c100000-0000-0000-0000-000000000003','Assigned Hero',true),
('0c500000-0000-0000-0000-000000000002','0c100000-0000-0000-0000-000000000003','Unassigned Hero',true),
('0c500000-0000-0000-0000-000000000003','0c100000-0000-0000-0000-000000000003','Pending Hero',false),
('0c500000-0000-0000-0000-000000000004','0c100000-0000-0000-0000-000000000002','Foreign Hero',true);
insert into session_players(campaign_id,session_id,user_id,status,character_id) values
('0c100000-0000-0000-0000-000000000001','0c400000-0000-0000-0000-000000000001','0c000000-0000-0000-0000-000000000002','approved',null),
('0c100000-0000-0000-0000-000000000001','0c400000-0000-0000-0000-000000000001','0c000000-0000-0000-0000-000000000003','pending',null),
('0c100000-0000-0000-0000-000000000003','0c400000-0000-0000-0000-000000000002','0c000000-0000-0000-0000-000000000002','approved','0c500000-0000-0000-0000-000000000001'),
('0c100000-0000-0000-0000-000000000003','0c400000-0000-0000-0000-000000000002','0c000000-0000-0000-0000-000000000003','pending','0c500000-0000-0000-0000-000000000003');
insert into tokens(id,campaign_id,level_id,kind,label,x,y,is_visible) values
('0c600000-0000-0000-0000-000000000001','0c100000-0000-0000-0000-000000000003','0c300000-0000-0000-0000-000000000001','enemy','Mover',0,0,true),
('0c600000-0000-0000-0000-000000000002','0c100000-0000-0000-0000-000000000003','0c300000-0000-0000-0000-000000000001','npc','Delete Me',3,3,false),
('0c600000-0000-0000-0000-000000000003','0c100000-0000-0000-0000-000000000003','0c300000-0000-0000-0000-000000000001','boss','Third Combatant',2,2,false),
('0c600000-0000-0000-0000-000000000004','0c100000-0000-0000-0000-000000000003','0c300000-0000-0000-0000-000000000002','enemy','Wrong Level',0,0,false),
('0c600000-0000-0000-0000-000000000005','0c100000-0000-0000-0000-000000000002','0c300000-0000-0000-0000-000000000003','enemy','Foreign Token',0,0,false),
('0c600000-0000-0000-0000-000000000006','0c100000-0000-0000-0000-000000000003','0c300000-0000-0000-0000-000000000001','npc','Fourth Combatant',3,2,false);
insert into initiative_entries(id,campaign_id,session_id,token_id,initiative,position,is_active) values
('0c700000-0000-0000-0000-000000000001','0c100000-0000-0000-0000-000000000003','0c400000-0000-0000-0000-000000000002','0c600000-0000-0000-0000-000000000002',5,99,false);
insert into fog_cells(campaign_id,level_id,x,y,is_revealed) values
('0c100000-0000-0000-0000-000000000003','0c300000-0000-0000-0000-000000000001',0,0,true);

-- session.prepareBoard.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('test.prepare_stale',get_session_snapshot('0c400000-0000-0000-0000-000000000001')->>'revision',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000001',jsonb_build_object('schemaVersion',1,'type','session.prepareBoard','expectedRevision',current_setting('test.prepare_stale'),'payload','{}'::jsonb))$$,'manager prepares a missing board through mutate_session');
reset role;
select is((select count(*)::integer from locations where campaign_id='0c100000-0000-0000-0000-000000000001'),1,'prepare creates one default location');
select is((select count(*)::integer from levels where campaign_id='0c100000-0000-0000-0000-000000000001'),1,'prepare creates one default level');
select is((select status from sessions where id='0c400000-0000-0000-0000-000000000001'),'active','prepare activates the session');
select ok((select active_level_id is not null from sessions where id='0c400000-0000-0000-0000-000000000001'),'prepare assigns the active level');
select results_eq($$select grid_width,grid_height,theme from levels where campaign_id='0c100000-0000-0000-0000-000000000001'$$,$$values (20,20,'relic'::text)$$,'prepare uses the fixed 20 by 20 relic board contract');
select set_config('test.prepared_level',(select active_level_id::text from sessions where id='0c400000-0000-0000-0000-000000000001'),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000001',jsonb_build_object('schemaVersion',1,'type','session.prepareBoard','expectedRevision',current_setting('test.prepare_stale'),'payload','{}'::jsonb))$$,'PT409','Stale revision; hydrate before retrying','prepare rejects a stale revision');
-- True idempotence: a repeat prepare against an already-valid, already-active board must be a
-- genuine no-op — no new activity entry, and therefore no avoidable revision/invalidation bump.
select set_config('test.prepare_revision_before',get_session_snapshot('0c400000-0000-0000-0000-000000000001')->>'revision',true);
select set_config('test.prepare_activity_before',(select count(*)::text from private.activity_feed where session_id='0c400000-0000-0000-0000-000000000001'),true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000001',jsonb_build_object('schemaVersion',1,'type','session.prepareBoard','expectedRevision',current_setting('test.prepare_revision_before'),'payload','{}'::jsonb))$$,'repeating prepare on an existing valid board succeeds');
reset role;
select is((select count(*)::integer from locations where campaign_id='0c100000-0000-0000-0000-000000000001'),1,'repeat prepare creates no duplicate location');
select is((select count(*)::integer from levels where campaign_id='0c100000-0000-0000-0000-000000000001'),1,'repeat prepare creates no duplicate level');
select is((select active_level_id::text from sessions where id='0c400000-0000-0000-0000-000000000001'),current_setting('test.prepared_level'),'repeat prepare retains the valid active level');
select is(get_session_snapshot('0c400000-0000-0000-0000-000000000001')->>'revision',current_setting('test.prepare_revision_before'),'repeat prepare on a valid active board never advances the manager revision');
select is((select count(*)::integer from private.activity_feed where session_id='0c400000-0000-0000-0000-000000000001'),current_setting('test.prepare_activity_before')::integer,'repeat prepare on a valid active board logs no activity entry');

-- Existing valid level, but the session still needs activating: a real state change, so it may
-- (and here, must) be logged — this is not the same case as the true no-op above.
insert into sessions(id,campaign_id,name,status,active_level_id) values
  ('0c400000-0000-0000-0000-000000000004','0c100000-0000-0000-0000-000000000001','Prepared Not Active','lobby',current_setting('test.prepared_level')::uuid);
select set_config('test.prepare2_locations_before',(select count(*)::text from locations where campaign_id='0c100000-0000-0000-0000-000000000001'),true);
select set_config('test.prepare2_levels_before',(select count(*)::text from levels where campaign_id='0c100000-0000-0000-0000-000000000001'),true);
select set_config('test.prepare2_activity_before',(select count(*)::text from private.activity_feed where session_id='0c400000-0000-0000-0000-000000000004'),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000004',jsonb_build_object('schemaVersion',1,'type','session.prepareBoard','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000004')->>'revision','payload','{}'::jsonb))$$,'prepare on a valid level with an inactive session only activates the session');
reset role;
select is((select status from sessions where id='0c400000-0000-0000-0000-000000000004'),'active','prepare activates a session that already has a valid level');
select is((select active_level_id::text from sessions where id='0c400000-0000-0000-0000-000000000004'),current_setting('test.prepared_level'),'prepare preserves the existing valid level rather than creating another');
select is((select count(*)::integer from locations where campaign_id='0c100000-0000-0000-0000-000000000001'),current_setting('test.prepare2_locations_before')::integer,'prepare with an existing valid level creates no additional location');
select is((select count(*)::integer from levels where campaign_id='0c100000-0000-0000-0000-000000000001'),current_setting('test.prepare2_levels_before')::integer,'prepare with an existing valid level creates no additional level');
select is((select count(*)::integer from private.activity_feed where session_id='0c400000-0000-0000-0000-000000000004'),current_setting('test.prepare2_activity_before')::integer+1,'prepare logs exactly one activity entry for the real status change');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000001',jsonb_build_object('schemaVersion',1,'type','session.prepareBoard','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000001')->>'revision','payload','{}'::jsonb))$$,'42501',null,'player cannot prepare a board');
reset role;

-- token.create.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','player','characterId','0c500000-0000-0000-0000-000000000001','label','Assigned Hero','x',0,'y',0,'isVisible',true)))$$,'manager creates an assigned player token');
-- Synchronization bounds: one token.create is one canonical insert plus one activity entry —
-- the manager's own revision must advance by a small, bounded amount, never a storm.
select set_config('test.sync_revision_before',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','enemy','characterId',null,'label','Hidden Enemy','x',1,'y',1,'isVisible',false)))$$,'manager creates a hidden enemy atomically');
select cmp_ok((get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision')::bigint-current_setting('test.sync_revision_before')::bigint,'<=',2::bigint,'token.create advances the manager revision by a small bounded amount, not a storm');
select cmp_ok((get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision')::bigint-current_setting('test.sync_revision_before')::bigint,'>=',1::bigint,'token.create advances the manager revision at least once');
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','npc','characterId',null,'label','Guide','x',2,'y',1,'isVisible',false)))$$,'manager creates an NPC token');
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','boss','characterId',null,'label','Final Boss','x',3,'y',1,'isVisible',false)))$$,'manager creates a boss token');
reset role;
select results_eq($$select kind,x,y,width,height,condition_label,is_visible from tokens where label='Assigned Hero'$$,$$values ('player'::text,0,0,1,1,'Unknown'::text,true)$$,'created player coordinates and canonical defaults persist');
select is((select count(*)::integer from tokens where level_id='0c300000-0000-0000-0000-000000000001' and kind in ('player','enemy','npc','boss')),8,'all four required token kinds exist on the active level');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select ok(get_session_snapshot('0c400000-0000-0000-0000-000000000002')::text not like '%Hidden Enemy%','atomically hidden token is absent from player projection');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','enemy','characterId',null,'label','Player Attempt','x',0,'y',0,'isVisible',true)))$$,'42501',null,'player cannot create a token');
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','enemy','characterId',null,'label','Out of Bounds','x',4,'y',0,'isVisible',false)))$$,'22023',null,'create rejects a token outside active-level bounds');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','player','characterId','0c500000-0000-0000-0000-000000000001','label','Duplicate Hero','x',0,'y',0,'isVisible',true)))$$,'22023',null,'create rejects a duplicate active-level player character');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','player','characterId','0c500000-0000-0000-0000-000000000002','label','Unassigned Hero','x',0,'y',0,'isVisible',true)))$$,'42501',null,'create rejects an unassigned character');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','player','characterId','0c500000-0000-0000-0000-000000000004','label','Foreign Hero','x',0,'y',0,'isVisible',true)))$$,'42501',null,'create rejects a cross-campaign character without disclosure');
reset role;

-- token.move.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select ok(get_session_snapshot('0c400000-0000-0000-0000-000000000002')::text like '%Mover%','visible token begins in revealed fog for the player');
reset role;
select set_config('test.fog_before',(select coalesce(jsonb_agg(jsonb_build_array(x,y,is_revealed) order by y,x),'[]'::jsonb)::text from fog_cells where level_id='0c300000-0000-0000-0000-000000000001'),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('test.sync_revision_before',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.move','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000001','x',1,'y',1)))$$,'manager moves an active-level token');
reset role;
select results_eq($$select x,y,is_visible,label,condition_label,width,height from tokens where id='0c600000-0000-0000-0000-000000000001'$$,$$values (1,1,true,'Mover'::text,'Unknown'::text,1,1)$$,'move changes only position');
select cmp_ok((get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision')::bigint-current_setting('test.sync_revision_before')::bigint,'<=',2::bigint,'token.move advances the manager revision by a small bounded amount, not a storm');
select is((select coalesce(jsonb_agg(jsonb_build_array(x,y,is_revealed) order by y,x),'[]'::jsonb)::text from fog_cells where level_id='0c300000-0000-0000-0000-000000000001'),current_setting('test.fog_before'),'move changes no fog cell');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select ok(get_session_snapshot('0c400000-0000-0000-0000-000000000002')::text not like '%Mover%','moving into hidden fog removes token from player projection');
reset role;
insert into fog_cells(campaign_id,level_id,x,y,is_revealed) values ('0c100000-0000-0000-0000-000000000003','0c300000-0000-0000-0000-000000000001',2,2,true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.move','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000001','x',2,'y',2)))$$,'manager moves the token into exposed fog');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.move','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000001','x',4,'y',0)))$$,'22023',null,'move rejects an out-of-bounds destination');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.move','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000004','x',1,'y',1)))$$,'42501',null,'move denies a token from another level');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.move','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000005','x',1,'y',1)))$$,'42501',null,'move denies a cross-campaign token without disclosure');
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select ok(get_session_snapshot('0c400000-0000-0000-0000-000000000002')::text like '%Mover%','moving into exposed fog restores existing player projection behavior');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.move','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000001','x',0,'y',0)))$$,'42501',null,'player cannot move a token');
reset role;

-- token.delete.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('test.sync_revision_before',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.delete','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000002')))$$,'manager deletes an active-level token');
select cmp_ok((get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision')::bigint-current_setting('test.sync_revision_before')::bigint,'<=',3::bigint,'token.delete (which cascades to its initiative entry) still advances the manager revision by a small bounded amount, not a storm');
reset role;
select is((select count(*)::integer from tokens where id='0c600000-0000-0000-0000-000000000002'),0,'delete removes the canonical token');
select is((select count(*)::integer from initiative_entries where token_id='0c600000-0000-0000-0000-000000000002'),0,'delete cascades its initiative entry');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.delete','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000004')))$$,'42501',null,'delete denies a token from another level');
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.delete','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000003')))$$,'42501',null,'player cannot delete a token');
reset role;

-- initiative.advance.
delete from initiative_entries where session_id='0c400000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','initiative.advance','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload','{}'::jsonb))$$,'22023',null,'advance rejects empty initiative');
reset role;
insert into initiative_entries(id,campaign_id,session_id,token_id,initiative,position,is_active) values
('0c700000-0000-0000-0000-000000000011','0c100000-0000-0000-0000-000000000003','0c400000-0000-0000-0000-000000000002','0c600000-0000-0000-0000-000000000001',17,0,false),
('0c700000-0000-0000-0000-000000000012','0c100000-0000-0000-0000-000000000003','0c400000-0000-0000-0000-000000000002','0c600000-0000-0000-0000-000000000003',11,1,false),
('0c700000-0000-0000-0000-000000000013','0c100000-0000-0000-0000-000000000003','0c400000-0000-0000-0000-000000000002','0c600000-0000-0000-0000-000000000006',7,2,false);
select set_config('test.initiative_before',(select jsonb_agg(jsonb_build_array(id,token_id,initiative,position) order by position,id)::text from initiative_entries where session_id='0c400000-0000-0000-0000-000000000002'),true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','initiative.advance','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload','{}'::jsonb))$$,'zero-active initiative activates the first entry');
reset role;
select is((select token_id::text from initiative_entries where session_id='0c400000-0000-0000-0000-000000000002' and is_active),'0c600000-0000-0000-0000-000000000001','zero-active selects first by position and id');
select is(coalesce((select round_number from session_state where session_id='0c400000-0000-0000-0000-000000000002'),1),1,'zero-active does not increment round');
select is((select jsonb_agg(jsonb_build_array(id,token_id,initiative,position) order by position,id)::text from initiative_entries where session_id='0c400000-0000-0000-0000-000000000002'),current_setting('test.initiative_before'),'advance preserves IDs, tokens, values, and positions');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('test.sync_revision_before',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','initiative.advance','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload','{}'::jsonb))$$,'middle advance activates exactly the next entry');
select cmp_ok((get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision')::bigint-current_setting('test.sync_revision_before')::bigint,'<=',2::bigint,'initiative.advance advances the manager revision by a small bounded amount, not a storm');
reset role;
select is((select token_id::text from initiative_entries where session_id='0c400000-0000-0000-0000-000000000002' and is_active),'0c600000-0000-0000-0000-000000000003','middle advance selects the next entry');
select is((select count(*)::integer from initiative_entries where session_id='0c400000-0000-0000-0000-000000000002' and is_active),1,'middle advance leaves exactly one active entry');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','initiative.advance','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload','{}'::jsonb))$$,'advance reaches the last entry before wrap');
select set_config('test.advance_stale',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','initiative.advance','expectedRevision',current_setting('test.advance_stale'),'payload','{}'::jsonb))$$,'last entry wraps to first atomically');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','initiative.advance','expectedRevision',current_setting('test.advance_stale'),'payload','{}'::jsonb))$$,'PT409','Stale revision; hydrate before retrying','two advances from the same revision cannot both succeed');
reset role;
select is((select token_id::text from initiative_entries where session_id='0c400000-0000-0000-0000-000000000002' and is_active),'0c600000-0000-0000-0000-000000000001','wrap activates first entry');
select is((select round_number from session_state where session_id='0c400000-0000-0000-0000-000000000002'),2,'wrap increments round exactly once');
update initiative_entries set is_active=true where id in ('0c700000-0000-0000-0000-000000000011','0c700000-0000-0000-0000-000000000012');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','initiative.advance','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload','{}'::jsonb))$$,'22023',null,'advance fails closed on multiple active entries');
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','initiative.advance','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload','{}'::jsonb))$$,'42501',null,'player cannot advance initiative');
reset role;

-- initiative.advance: wrap must increment an EXISTING higher round, not just create round 2 —
-- the earlier wrap above only ever exercised the no-row -> round-2 path.
insert into locations(id,campaign_id,name) values
  ('0c200000-0000-0000-0000-000000000003','0c100000-0000-0000-0000-000000000003','Round Location');
insert into levels(id,campaign_id,location_id,name,grid_width,grid_height,theme) values
  ('0c300000-0000-0000-0000-000000000004','0c100000-0000-0000-0000-000000000003','0c200000-0000-0000-0000-000000000003','Round Board',4,4,'relic');
insert into sessions(id,campaign_id,name,status,active_level_id) values
  ('0c400000-0000-0000-0000-000000000005','0c100000-0000-0000-0000-000000000003','Round Session','active','0c300000-0000-0000-0000-000000000004');
insert into tokens(id,campaign_id,level_id,kind,label,x,y,is_visible) values
  ('0c600000-0000-0000-0000-000000000010','0c100000-0000-0000-0000-000000000003','0c300000-0000-0000-0000-000000000004','enemy','Round A',0,0,true),
  ('0c600000-0000-0000-0000-000000000011','0c100000-0000-0000-0000-000000000003','0c300000-0000-0000-0000-000000000004','enemy','Round B',1,0,true);
insert into initiative_entries(id,campaign_id,session_id,token_id,initiative,position,is_active) values
  ('0c700000-0000-0000-0000-000000000020','0c100000-0000-0000-0000-000000000003','0c400000-0000-0000-0000-000000000005','0c600000-0000-0000-0000-000000000010',10,0,true),
  ('0c700000-0000-0000-0000-000000000021','0c100000-0000-0000-0000-000000000003','0c400000-0000-0000-0000-000000000005','0c600000-0000-0000-0000-000000000011',5,1,false);
insert into session_state(session_id,campaign_id,round_number) values
  ('0c400000-0000-0000-0000-000000000005','0c100000-0000-0000-0000-000000000003',5);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000005',jsonb_build_object('schemaVersion',1,'type','initiative.advance','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000005')->>'revision','payload','{}'::jsonb))$$,'advance from an existing higher round moves to the last entry');
select lives_ok($$select mutate_session('0c400000-0000-0000-0000-000000000005',jsonb_build_object('schemaVersion',1,'type','initiative.advance','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000005')->>'revision','payload','{}'::jsonb))$$,'wrap from an existing round 5 advances to round 6, not a reset to 2');
reset role;
select is((select round_number from session_state where session_id='0c400000-0000-0000-0000-000000000005'),6,'wrap increments an existing higher round by exactly one, never resetting it');
select is((select token_id::text from initiative_entries where session_id='0c400000-0000-0000-0000-000000000005' and is_active),'0c600000-0000-0000-0000-000000000010','wrap re-activates the first entry by position');

-- Malformed input: bad UUIDs, wrong JSON types, missing/extra keys never leak PostgreSQL
-- implementation details or entity existence — only the existing generic error conventions.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.move','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','not-a-uuid','x',1,'y',1)))$$,'22023',null,'move rejects a malformed tokenId UUID');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.move','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000001','x','0','y',1)))$$,'22023',null,'move rejects a string x coordinate instead of a number');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.move','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000001','x',1)))$$,'22023',null,'move rejects a payload missing the required y key');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.move','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','0c600000-0000-0000-0000-000000000001','x',1,'y',1,'extra','nope')))$$,'22023',null,'move rejects an unexpected extra payload key');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.delete','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId','not-a-uuid')))$$,'22023',null,'delete rejects a malformed tokenId UUID');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.delete','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('tokenId',42)))$$,'22023',null,'delete rejects a non-string tokenId value');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','player','characterId','not-a-uuid','label','X','x',0,'y',0,'isVisible',true)))$$,'22023',null,'create rejects a malformed characterId UUID');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','enemy','characterId',null,'label','X','x','0','y',0,'isVisible',true)))$$,'22023',null,'create rejects a string x coordinate instead of a number');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','dragon','characterId',null,'label','X','x',0,'y',0,'isVisible',true)))$$,'22023',null,'create rejects an unrecognized token kind');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002',jsonb_build_object('schemaVersion',1,'type','token.create','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000002')->>'revision','payload',jsonb_build_object('kind','enemy','characterId',null,'label','X','x',0,'y',0)))$$,'22023',null,'create rejects a payload missing the required isVisible key');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000005',jsonb_build_object('schemaVersion',1,'type','initiative.advance','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000005')->>'revision','payload',jsonb_build_object('unexpected',true)))$$,'22023',null,'advance rejects an unexpected payload on a command that takes none');
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000001',jsonb_build_object('schemaVersion',1,'type','session.prepareBoard','expectedRevision',get_session_snapshot('0c400000-0000-0000-0000-000000000001')->>'revision','payload',jsonb_build_object('unexpected',true)))$$,'22023',null,'prepareBoard rejects an unexpected payload on a command that takes none');
reset role;

-- Unapproved, unrelated, and anonymous actors fail before targets can leak.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002','{"schemaVersion":1,"type":"token.delete","expectedRevision":"0","payload":{"tokenId":"0c600000-0000-0000-0000-000000000005"}}')$$,'42501',null,'unapproved member cannot invoke a new command');
select set_config('request.jwt.claims','{"sub":"0c000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002','{"schemaVersion":1,"type":"token.delete","expectedRevision":"0","payload":{"tokenId":"0c600000-0000-0000-0000-000000000005"}}')$$,'42501',null,'unrelated authenticated caller cannot probe a target');
reset role;
set local role anon;
select throws_ok($$select mutate_session('0c400000-0000-0000-0000-000000000002','{"schemaVersion":1,"type":"initiative.advance","expectedRevision":"0","payload":{}}')$$,'42501',null,'anonymous caller cannot invoke a new command');
reset role;
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='session_events' and column_name not in ('id','session_id','revision','schema_version','type')),'new commands add no payload fields to sanitized invalidations');

select * from finish();
rollback;
