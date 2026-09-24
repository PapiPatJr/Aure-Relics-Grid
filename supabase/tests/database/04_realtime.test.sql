begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select has_function('public','get_session_snapshot',array['uuid']);
select has_function('public','mutate_session',array['uuid','jsonb']);
select has_table('public','session_events','sanitized notification table exists');
insert into auth.users(id,is_anonymous) values
('08000000-0000-0000-0000-000000000001',false),
('08000000-0000-0000-0000-000000000002',false),
('08000000-0000-0000-0000-000000000003',true),
('08000000-0000-0000-0000-000000000004',true);
insert into campaigns(id,owner_id,name,fog_enabled) values
('08100000-0000-0000-0000-000000000001','08000000-0000-0000-0000-000000000001','A',false),
('08100000-0000-0000-0000-000000000002','08000000-0000-0000-0000-000000000002','B',false);
insert into locations(id,campaign_id,name) values
('08200000-0000-0000-0000-000000000001','08100000-0000-0000-0000-000000000001','L');
insert into levels(id,campaign_id,location_id,name) values
('08300000-0000-0000-0000-000000000001','08100000-0000-0000-0000-000000000001','08200000-0000-0000-0000-000000000001','L');
insert into sessions(id,campaign_id,name,status,active_level_id) values
('08400000-0000-0000-0000-000000000001','08100000-0000-0000-0000-000000000001','S','active','08300000-0000-0000-0000-000000000001'),
('08400000-0000-0000-0000-000000000002','08100000-0000-0000-0000-000000000001','Other S','active','08300000-0000-0000-0000-000000000001');
insert into campaign_members(campaign_id,user_id,status) values
('08100000-0000-0000-0000-000000000001','08000000-0000-0000-0000-000000000003','approved'),
('08100000-0000-0000-0000-000000000001','08000000-0000-0000-0000-000000000004','approved');
insert into characters(id,campaign_id,name,approved,hp) values
('08500000-0000-0000-0000-000000000001','08100000-0000-0000-0000-000000000001','Hero',true,12),
('08500000-0000-0000-0000-000000000002','08100000-0000-0000-0000-000000000001','Pending sentinel',false,9);
insert into session_players(campaign_id,session_id,user_id,status,character_id) values
('08100000-0000-0000-0000-000000000001','08400000-0000-0000-0000-000000000001','08000000-0000-0000-0000-000000000003','approved','08500000-0000-0000-0000-000000000001'),
('08100000-0000-0000-0000-000000000001','08400000-0000-0000-0000-000000000001','08000000-0000-0000-0000-000000000004','approved','08500000-0000-0000-0000-000000000002');
insert into tokens(id,campaign_id,level_id,kind,label,x,y,is_visible) values
('08600000-0000-0000-0000-000000000001','08100000-0000-0000-0000-000000000001','08300000-0000-0000-0000-000000000001','enemy','Visible',0,0,true),
('08600000-0000-0000-0000-000000000002','08100000-0000-0000-0000-000000000001','08300000-0000-0000-0000-000000000001','boss','HIDDEN_SENTINEL',1,0,false);
insert into private.token_details(token_id,campaign_id,actual_hp,max_hp,dm_notes) values
('08600000-0000-0000-0000-000000000001','08100000-0000-0000-0000-000000000001',77,100,'PRIVATE_SENTINEL');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"08000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select set_config('test.snapshot',get_session_snapshot('08400000-0000-0000-0000-000000000001')::text,true);
select is(jsonb_typeof(current_setting('test.snapshot')::jsonb->'revision'),'string','revision is decimal text');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'tokens'),1,'only visible token projected');
select is(jsonb_array_length(current_setting('test.snapshot')::jsonb->'characters'),1,'other pending character absent');
select ok(current_setting('test.snapshot') not like '%SENTINEL%','private and hidden sentinel absent');
select is(current_setting('test.snapshot')::jsonb->'dm','null'::jsonb,'player has no DM state');
select throws_ok($$select get_session_snapshot('08400000-0000-0000-0000-000000000002')$$,'42501',null,'same campaign unjoined session denied');
select throws_ok($$select mutate_session('08400000-0000-0000-0000-000000000001',jsonb_build_object('schemaVersion',1,'type','session.setRound','expectedRevision',current_setting('test.snapshot')::jsonb->>'revision','payload',jsonb_build_object('roundNumber',2)))$$,'42501',null,'participant cannot change round');
select throws_ok($$insert into session_events(session_id,revision) values('08400000-0000-0000-0000-000000000001','999')$$,'42501',null,'client cannot forge notification');
reset role;
update tokens set label='HIDDEN_EDIT' where id='08600000-0000-0000-0000-000000000002';
update private.token_details set actual_hp=76,dm_notes='PRIVATE_EDIT' where token_id='08600000-0000-0000-0000-000000000001';
set local role authenticated;
select is(get_session_snapshot('08400000-0000-0000-0000-000000000001')->>'revision',current_setting('test.snapshot')::jsonb->>'revision','hidden/private edits do not advance player revision');
select set_config('request.jwt.claims','{"sub":"08000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok($$select get_session_snapshot('08400000-0000-0000-0000-000000000001')$$,'42501',null,'DM B cannot inspect DM A');
select is((select count(*)::int from session_events),0,'unrelated owner has no events');
select set_config('request.jwt.claims','{"sub":"08000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select ok(get_session_snapshot('08400000-0000-0000-0000-000000000001')::text like '%PRIVATE_EDIT%','owner receives own private token details');
select set_config('test.dm_snapshot',get_session_snapshot('08400000-0000-0000-0000-000000000001')::text,true);
select is(mutate_session('08400000-0000-0000-0000-000000000001',jsonb_build_object('schemaVersion',1,'type','session.setRound','commandId','correlation-1','expectedRevision',current_setting('test.dm_snapshot')::jsonb->>'revision','payload',jsonb_build_object('roundNumber',2)))->>'roundNumber','2','owner sets official round');
select throws_ok($$select mutate_session('08400000-0000-0000-0000-000000000001',jsonb_build_object('schemaVersion',1,'type','session.setRound','expectedRevision',current_setting('test.dm_snapshot')::jsonb->>'revision','payload',jsonb_build_object('roundNumber',3)))$$,'40001',null,'stale watermark fails');
select throws_ok($$select mutate_session('08400000-0000-0000-0000-000000000001','{"schemaVersion":1,"type":"unknown","expectedRevision":"0","payload":{}}')$$,'22023',null,'unknown command rejected');
select throws_ok($$select mutate_session('08400000-0000-0000-0000-000000000001','{"schemaVersion":1,"type":"session.setRound","expectedRevision":42,"payload":{"roundNumber":2}}')$$,'22023',null,'numeric revision rejected');
select throws_ok($$select mutate_session('08400000-0000-0000-0000-000000000001','{"schemaVersion":1,"type":"session.setRound","expectedRevision":"0","payload":{"roundNumber":2},"secret":"x"}')$$,'22023',null,'unknown command key rejected');
select ok(not exists(select 1 from session_events e where to_jsonb(e)::text like '%correlation-1%'),'command ID absent from notifications');
update tokens set is_visible=false where id='08600000-0000-0000-0000-000000000001';
select set_config('request.jwt.claims','{"sub":"08000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select is(jsonb_array_length(get_session_snapshot('08400000-0000-0000-0000-000000000001')->'tokens'),0,'hide transition removes formerly visible token');
select isnt(get_session_snapshot('08400000-0000-0000-0000-000000000001')->>'revision',current_setting('test.snapshot')::jsonb->>'revision','visible change advances watermark');
reset role;
update private.session_sync set revision=9007199254740993 where session_id='08400000-0000-0000-0000-000000000001' and user_id='08000000-0000-0000-0000-000000000003';
set local role authenticated;
select is(get_session_snapshot('08400000-0000-0000-0000-000000000001')->>'revision','9007199254740993','watermark above JS safe integer stays exact');
reset role;
update session_players set status='revoked' where user_id='08000000-0000-0000-0000-000000000003';
set local role authenticated;
select throws_ok($$select get_session_snapshot('08400000-0000-0000-0000-000000000001')$$,'42501',null,'revoked reconnect hydration denied');
select is((select count(*)::int from session_events),0,'revocation removes even historical event reads');
reset role;
select ok(not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and (schemaname<>'public' or tablename<>'session_events')),'only sanitized table published');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='session_events' and column_name not in ('id','session_id','revision','schema_version','type')),'event envelope has no extra payload columns');
select ok(not has_function_privilege('authenticated','private.refresh_session_sync(uuid)','EXECUTE'),'clients cannot mint events through internal refresh');
set local role anon;
select throws_ok($$select get_session_snapshot('08400000-0000-0000-0000-000000000001')$$,'42501',null,'bare anon cannot hydrate');
reset role;
update tokens set is_visible=true where id='08600000-0000-0000-0000-000000000001';
update campaigns set fog_enabled=true where id='08100000-0000-0000-0000-000000000001';
insert into fog_cells(campaign_id,level_id,x,y,is_revealed) values
('08100000-0000-0000-0000-000000000001','08300000-0000-0000-0000-000000000001',0,0,true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"08000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
select is(jsonb_array_length(get_session_snapshot('08400000-0000-0000-0000-000000000001')->'tokens'),1,'revealed cell exposes only its visible token');
reset role;
update fog_cells set is_revealed=false where level_id='08300000-0000-0000-0000-000000000001';
insert into fog_cells(campaign_id,level_id,x,y,is_revealed) values
('08100000-0000-0000-0000-000000000001','08300000-0000-0000-0000-000000000001',8,8,true);
set local role authenticated;
select is(jsonb_array_length(get_session_snapshot('08400000-0000-0000-0000-000000000001')->'tokens'),0,'a different revealed cell cannot expose a fogged token');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"08000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select mutate_session('08400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','initiative.set','expectedRevision',get_session_snapshot('08400000-0000-0000-0000-000000000001')->>'revision',
  'payload',jsonb_build_object('entries',jsonb_build_array(
    jsonb_build_object('tokenId','08600000-0000-0000-0000-000000000001','initiative',10,'position',0,'isActive',false),
    jsonb_build_object('tokenId','08600000000000000000000000000001','initiative',11,'position',1,'isActive',false)))))$$,
  '22023',null,'duplicate UUID representations rejected');
insert into initiative_entries(id,campaign_id,session_id,token_id) values
('08700000-0000-0000-0000-000000000001','08100000-0000-0000-0000-000000000001','08400000-0000-0000-0000-000000000001','08600000-0000-0000-0000-000000000001');
select mutate_session('08400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','initiative.set','expectedRevision',get_session_snapshot('08400000-0000-0000-0000-000000000001')->>'revision',
  'payload',jsonb_build_object('entries',jsonb_build_array(
    jsonb_build_object('tokenId','08600000000000000000000000000001','initiative',10,'position',0,'isActive',false)))));
select is((select id::text from initiative_entries where session_id='08400000-0000-0000-0000-000000000001'),
  '08700000-0000-0000-0000-000000000001','alternate UUID spelling preserves initiative entry ID');
reset role;
insert into levels(id,campaign_id,location_id,name) values
('08300000-0000-0000-0000-000000000002','08100000-0000-0000-0000-000000000001','08200000-0000-0000-0000-000000000001','Other level');
insert into tokens(id,campaign_id,level_id,kind,label,x,y) values
('08600000-0000-0000-0000-000000000003','08100000-0000-0000-0000-000000000001','08300000-0000-0000-0000-000000000002','enemy','Out of scope',0,0);
set local role authenticated;
select throws_ok($$select mutate_session('08400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','token.setPublicState','expectedRevision',get_session_snapshot('08400000-0000-0000-0000-000000000001')->>'revision',
  'payload',jsonb_build_object('tokenId','08600000-0000-0000-0000-000000000003','label','Out of scope','conditionLabel','Unknown','isVisible',true)))$$,
  '42501',null,'official token command cannot mutate another level');
select throws_ok($$select mutate_session('08400000-0000-0000-0000-000000000001',jsonb_build_object(
  'schemaVersion',1,'type','initiative.set','expectedRevision',get_session_snapshot('08400000-0000-0000-0000-000000000001')->>'revision',
  'payload',jsonb_build_object('entries',jsonb_build_array(jsonb_build_object('tokenId','08600000-0000-0000-0000-000000000003','initiative',10,'position',0,'isActive',false)))))$$,
  '42501',null,'initiative command cannot reference another level');
select throws_ok($$select private.session_projection('08400000-0000-0000-0000-000000000001','08000000-0000-0000-0000-000000000001')$$,
  '42501',null,'internal recipient override cannot be called directly');
select throws_ok($$select * from private.session_sync$$,'42501',null,'private projections inaccessible even to direct authenticated SQL');
reset role;
insert into campaign_members(campaign_id,user_id,status) values
('08100000-0000-0000-0000-000000000001','08000000-0000-0000-0000-000000000002','approved');
insert into session_players(campaign_id,session_id,user_id,status) values
('08100000-0000-0000-0000-000000000001','08400000-0000-0000-0000-000000000001','08000000-0000-0000-0000-000000000002','approved');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"08000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is(get_session_snapshot('08400000-0000-0000-0000-000000000001')->'authority'->'canManage','false'::jsonb,'owner of B is only an approved player in A');
select is(get_session_snapshot('08400000-0000-0000-0000-000000000001')->'dm','null'::jsonb,'registered participant receives no owner private state');
reset role;
delete from session_players where session_id='08400000-0000-0000-0000-000000000001' and user_id='08000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok($$select get_session_snapshot('08400000-0000-0000-0000-000000000001')$$,'42501',null,'removed participant cannot hydrate');
select is((select count(*)::int from session_events),0,'removed participant cannot read historical notifications');
reset role;
select * from finish();
rollback;
