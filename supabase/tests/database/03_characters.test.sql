begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
-- These checks catch missing authenticated-only entry points and secret exposure.
select has_function('public','create_session_character',array['uuid','text','text','integer','integer','integer','integer','integer','text[]','text']);
select has_function('public','update_session_character',array['uuid','uuid','text','text','integer','integer','integer','integer','integer','text[]','text']);
select has_function('public','review_character',array['uuid','boolean']);
select has_function('public','assign_character',array['uuid','uuid','uuid']);
select has_function('public','get_character_panel',array['uuid']);
select has_function('public','set_character_image',array['uuid','uuid']);
select has_column('public','characters','public_notes','shared notes column');
select has_column('public','characters','image_path','portrait pointer column');
select has_column('public','characters','created_at','creation timestamp');
select has_column('public','characters','updated_at','update timestamp');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='characters' and column_name in ('dm_notes','code_hash','code','sheet')),'shared table excludes private fields');
insert into auth.users(id,is_anonymous) values
('00000000-0000-0000-0000-000000000001',false),
('00000000-0000-0000-0000-000000000002',true),
('00000000-0000-0000-0000-000000000003',true);
insert into campaigns(id,owner_id,name) values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Character SQL');
insert into sessions(id,campaign_id,name) values('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Session');
insert into campaign_members(campaign_id,user_id,status) values
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','approved'),
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','approved');
insert into session_players(campaign_id,session_id,user_id,status) values
('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','approved'),
('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','approved');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select set_config('test.character',create_session_character('40000000-0000-0000-0000-000000000001',' Hero ',' Player ',-999,9999,9999,99,999,array['Inspired'],'Shared')::text,true);
select is((select hp from characters where id=current_setting('test.character')::uuid),-999,'flexible HP lower bound accepted');
select is((get_character_panel('40000000-0000-0000-0000-000000000001')->>'campaign_id'),'10000000-0000-0000-0000-000000000001','panel carries authorized campaign scope');
select throws_ok($$select update_session_character('40000000-0000-0000-0000-000000000001',current_setting('test.character')::uuid,'Hero','Player',0,0,0,10,30,array[array['nested']],'')$$,'22023',null,'multidimensional statuses denied');
select throws_ok($$select update_session_character('40000000-0000-0000-0000-000000000001',current_setting('test.character')::uuid,'Hero','Player',0,0,0,10,30,array['   '],'')$$,'22023',null,'whitespace status denied');
select is((select count(*)::int from private.character_codes),0,'guest cannot enumerate code hashes');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
insert into private.character_details(character_id,campaign_id,dm_notes,sheet) values(current_setting('test.character')::uuid,'10000000-0000-0000-0000-000000000001','PRIVATE_SENTINEL','{"secret":"PRIVATE_SENTINEL"}');
select review_character(current_setting('test.character')::uuid,true);
select set_config('test.code',issue_character_code(current_setting('test.character')::uuid),true);
select ok((select code_hash=extensions.digest(current_setting('test.code'),'sha256') from private.character_codes where character_id=current_setting('test.character')::uuid),'only digest persisted');
select ok(get_character_panel('40000000-0000-0000-0000-000000000001')::text not like '%PRIVATE_SENTINEL%','DM shared panel excludes private sheet too');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select ok(get_character_panel('40000000-0000-0000-0000-000000000001')::text not like '%PRIVATE_SENTINEL%','guest panel excludes private sheet');
select ok(get_character_panel('40000000-0000-0000-0000-000000000001')::text not like '%'||current_setting('test.code')||'%','panel excludes plaintext code');
select is((select count(*)::int from private.character_codes),0,'approved guest still cannot enumerate codes');
select is((select count(*)::int from private.character_details),0,'approved guest cannot read private sheet');
reset role;
update private.character_codes set expires_at=now()-interval '1 second';
set local role authenticated;
select throws_ok($$select reclaim_character('40000000-0000-0000-0000-000000000001',current_setting('test.character')::uuid,current_setting('test.code'))$$,'42501',null,'expired code cannot reclaim');
reset role;
select ok(not exists(select 1 from private.activity_feed where details::text like '%'||current_setting('test.code')||'%'),'audit events exclude code secrets');
set local role anon;
select throws_ok($$select get_character_panel('40000000-0000-0000-0000-000000000001')$$,'42501',null,'bare anon denied panel');
select throws_ok($$select create_session_character('40000000-0000-0000-0000-000000000001','Hero','Player',0,0,0,10,30,'{}','')$$,'42501',null,'bare anon denied creation');
reset role;
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('create_session_character','update_session_character','review_character','assign_character','get_character_panel','set_character_image') and p.prosecdef),'all public character RPCs are invoker');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in ('create_session_character','update_session_character','review_character','assign_character','get_character_panel','set_character_image')
  and not coalesce(p.proconfig @> array['search_path=""'],false)),'privileged helpers have empty search paths');
-- Recovery must replace the target's assignment even in a different, closed session.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
update sessions set status='closed' where id='40000000-0000-0000-0000-000000000001';
insert into sessions(id,campaign_id,name) values('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Recovery session');
insert into session_players(campaign_id,session_id,user_id,status) values('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','approved');
insert into characters(id,campaign_id,name,approved) values('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Recovered hero',true);
select assign_character('40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002');
select is((select count(*)::int from session_players where user_id='00000000-0000-0000-0000-000000000002' and character_id is not null),1,'cross-session recovery leaves one target assignment');
select is((select count(*)::int from characters where id=current_setting('test.character')::uuid),1,'recovery preserves previous character record');
select set_config('test.recovered_code',issue_character_code('50000000-0000-0000-0000-000000000002'),true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select lives_ok($$select reclaim_character('40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002',current_setting('test.recovered_code'))$$,'fresh recovery code works despite previous closed-session assignment');
reset role;
select * from finish();
rollback;
