begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
-- Match Storage API deletion context; RLS still applies under the test role.
set local storage.allow_delete_query = 'true';
select no_plan();

-- Actual auth.users rows and Postgres roles, not mocked predicates.
insert into auth.users(id,is_anonymous) values
 ('00000000-0000-0000-0000-000000000001',false),
 ('00000000-0000-0000-0000-000000000002',false),
 ('00000000-0000-0000-0000-000000000003',true),
 ('00000000-0000-0000-0000-000000000004',true),
 ('00000000-0000-0000-0000-000000000005',true),
 ('00000000-0000-0000-0000-000000000006',false);
insert into campaigns(id,owner_id,name) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','A'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','B');
insert into campaign_members values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','approved'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','pending'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005','approved');
insert into locations(id,campaign_id,name) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','A map'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','B map');
insert into levels(id,campaign_id,location_id,name) values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','A level'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','B level');
insert into sessions(id,campaign_id,name,status,active_level_id) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','A session','active','30000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','B session','active','30000000-0000-0000-0000-000000000002');
insert into characters(id,campaign_id,name,approved,hp) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Hero',true,20),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Other hero',true,20);
insert into session_players values
 ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001','approved'),
 ('10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004',null,'pending'),
 ('10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000002','approved');
insert into fog_cells values
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,0,true),
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,0,false);
insert into tokens(id,campaign_id,level_id,kind,label,x,y,is_visible) values
 ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','enemy','Visible enemy',0,0,true),
 ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','boss','Hidden boss',0,0,false),
 ('60000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','npc','NPC in fog',1,0,true);
insert into private.token_details(token_id,campaign_id,actual_hp,dm_notes)
 select id,campaign_id,99,'secret HP/notes' from tokens;
insert into private.dm_notes(campaign_id,body) values ('10000000-0000-0000-0000-000000000001','secret');
insert into private.dm_notes(campaign_id,body) values ('10000000-0000-0000-0000-000000000002','B secret');
insert into initiative_entries(campaign_id,session_id,token_id)
 select campaign_id,'40000000-0000-0000-0000-000000000001',id from tokens;
insert into private.fog_areas(campaign_id,level_id,name) values ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Boss room');
insert into map_effects(campaign_id,level_id,kind,label,x,y,is_visible) values
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','trap','Hidden trap',0,0,false),
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','hazard','Visible fire',0,0,true),
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','difficult_terrain','Hidden mud',1,0,true);
insert into terrain_objects(campaign_id,level_id,label,x,y,width,is_visible) values
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Visible rock',0,0,1,true),
 ('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Partly in fog',0,0,2,true);

select is((select count(*)::int from pg_tables where schemaname in ('public','private') and not rowsecurity),0,'every application table has RLS');
select is((select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname in ('public','private')),0,'no sensitive tables published to Realtime');
select is((select count(*)::int from storage.buckets where id in ('character-images','terrain-assets','map-assets') and not public),3,'all buckets private');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select is((select count(*)::int from campaigns),1,'DM sees own campaign only');
select is((select count(*)::int from private.token_details),3,'DM sees exact HP');
select is((select count(*)::int from private.dm_notes),1,'DM cannot read other campaign private notes');
select lives_ok($$update campaigns set name='A changed' where name='A'$$,'DM can modify own campaign');
with changed as (update campaigns set name='stolen' where name='B' returning id) select is((select count(*)::int from changed),0,'DM cannot update other campaign');
select throws_ok($$insert into campaigns(owner_id,name) values ('00000000-0000-0000-0000-000000000002','spoof')$$,'42501',null,'DM cannot spoof owner');
select throws_ok($$insert into levels(campaign_id,location_id,name) values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','cross')$$,'23503',null,'composite FK blocks cross campaign parent');
select set_config('test.reclaim_code',public.issue_character_code('50000000-0000-0000-0000-000000000001'),true);
select is(length(current_setting('test.reclaim_code')),64,'code generated with 256 bits of random entropy');
select is((select octet_length(code_hash) from private.character_codes limit 1),32,'only SHA256 code hash stored');
select lives_ok($$select public.save_token_details('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',88,100,'private')$$,'DM private HP API writes own token');
select lives_ok($$insert into storage.objects(bucket_id,name) values ('terrain-assets','10000000-0000-0000-0000-000000000001/rock.png')$$,'DM uploads terrain to own campaign');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('map-assets','10000000-0000-0000-0000-000000000002/map.png')$$,'42501',null,'DM blocked from other campaign storage');
select throws_ok($$update storage.objects set name='10000000-0000-0000-0000-000000000002/rock.png' where bucket_id='terrain-assets'$$,'42501',null,'storage rename cannot cross campaigns');

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}',true);
select is((select count(*)::int from campaigns),1,'approved guest sees joined campaign');
select is((select count(*)::int from sessions),1,'approved guest sees joined session only');
select is((select count(*)::int from characters),1,'party player character readable');
select is((select hp from characters limit 1),20,'player HP is shared');
select is((select count(*)::int from tokens),1,'hidden boss and fogged NPC are absent');
select is((select condition_label from tokens limit 1),'Unknown','enemy condition label readable');
select is((select count(*)::int from initiative_entries),1,'initiative hides hidden and fogged tokens');
select is((select count(*)::int from private.token_details),0,'player cannot select any enemy actual HP');
select is((select count(*)::int from public.get_token_details('60000000-0000-0000-0000-000000000001')),0,'RPC cannot bypass private HP RLS');
select is((select count(*)::int from private.dm_notes),0,'player cannot read DM notes');
select is((select count(*)::int from private.character_codes),0,'player cannot query code hashes');
select throws_ok('select actual_hp from public.tokens','42703',null,'exact HP does not exist in public token payload');
select throws_ok($$select public.save_token_details('10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',1,1,'hack')$$,'42501',null,'player cannot mutate private HP via RPC');
select throws_ok($$select public.issue_character_code('50000000-0000-0000-0000-000000000001')$$,'42501',null,'guest cannot mint codes');
select throws_ok($$select public.reclaim_character('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002',current_setting('test.reclaim_code'))$$,'42501',null,'reclaim cannot cross campaign');
select throws_ok($$select public.reclaim_character('40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001',current_setting('test.reclaim_code'))$$,'42501',null,'reclaim cannot use another session');
select throws_ok($$select public.reclaim_character('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',repeat('a',64))$$,'42501',null,'wrong character code rejected');
select is((select count(*)::int from storage.objects),0,'guest cannot list private terrain/map assets');
select lives_ok($$insert into storage.objects(bucket_id,name) values ('character-images','10000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/portrait.png')$$,'guest can upload own assigned character portrait');
select is((select count(*)::int from storage.objects),1,'guest can read own portrait');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('character-images','10000000-0000-0000-0000-000000000002/40000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000002/portrait.png')$$,'42501',null,'guest cannot upload cross campaign');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('terrain-assets','10000000-0000-0000-0000-000000000001/hack.png')$$,'42501',null,'guest cannot upload terrain');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('character-images','10000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/extra.png')$$,'42501',null,'guest cannot bypass single portrait slot');
with changed as (update storage.objects set name='other.png' returning id) select is((select count(*)::int from changed),0,'guest cannot rename images');
with changed as (delete from storage.objects returning id) select is((select count(*)::int from changed),0,'guest cannot delete images');
select is((select count(*)::int from private.fog_areas),0,'private area labels and geometry absent');
select is((select count(*)::int from fog_cells),1,'only revealed fog cell is readable');
select is((select count(*)::int from terrain_objects),1,'terrain footprint crossing fog fails closed');
select is((select count(*)::int from map_effects),1,'only revealed unfogged map effect readable');
select throws_ok($$insert into campaigns(owner_id,name) values ('00000000-0000-0000-0000-000000000003','guest DM')$$,'42501',null,'anonymous guest cannot become campaign owner');
select throws_ok($$insert into campaign_members values ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','approved')$$,'42501',null,'guest cannot enroll in another campaign');
with changed as (update tokens set is_visible=true returning id) select is((select count(*)::int from changed),0,'guest cannot alter official board');
with changed as (delete from campaigns returning id) select is((select count(*)::int from changed),0,'guest cannot delete campaign');
with changed as (update session_players set character_id='50000000-0000-0000-0000-000000000002' returning user_id) select is((select count(*)::int from changed),0,'guest cannot directly reclaim character');
with changed as (update campaign_members set status='approved' returning user_id) select is((select count(*)::int from changed),0,'guest cannot self approve membership');
with changed as (update campaigns set owner_id='00000000-0000-0000-0000-000000000003' returning id) select is((select count(*)::int from changed),0,'guest cannot reassign owner');

select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}',true);
select is((select count(*)::int from campaigns),0,'pending guest has no campaign access');
select is((select count(*)::int from tokens),0,'pending guest has no board access');
select throws_ok($$select public.reclaim_character('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',current_setting('test.reclaim_code'))$$,'42501',null,'pending guest cannot reclaim even with a valid code');
select is((select count(*)::int from storage.objects),0,'pending guest cannot read portraits');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated","is_anonymous":true}',true);
select is((select count(*)::int from tokens),0,'other campaign guest has no A tokens');
select is((select count(*)::int from storage.objects),0,'other campaign guest cannot read portraits');

reset role;
-- Approve a returning identity; possession of a code still required for assignment.
update campaign_members set status='approved' where user_id='00000000-0000-0000-0000-000000000004';
update session_players set status='approved' where user_id='00000000-0000-0000-0000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}',true);
select is((select count(*)::int from storage.objects),1,'approved party member can read shared portrait');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('character-images','10000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/50000000-0000-0000-0000-000000000001/portrait.png')$$,'42501',null,'unassigned party member cannot upload another character');
select lives_ok($$select public.reclaim_character('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',current_setting('test.reclaim_code'))$$,'approved returning guest reclaims with valid code');
select is((select character_id::text from session_players limit 1),'50000000-0000-0000-0000-000000000001','reclaim assigns only requested character');
select lives_ok($$select public.reclaim_character('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',current_setting('test.reclaim_code'))$$,'saved code is reusable until revoked or expired');
reset role;
select is((select character_id from session_players where user_id='00000000-0000-0000-0000-000000000003'),null::uuid,'reclaim removes former controller assignment');
select is((select count(*)::int from private.activity_feed where event_type='character_reclaimed'),2,'reclaims emit DM-only audit events');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}',true);
select set_config('test.new_code',public.issue_character_code('50000000-0000-0000-0000-000000000001'),true);
select isnt(current_setting('test.new_code'),current_setting('test.reclaim_code'),'regeneration creates a new code');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.reclaim_character('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',current_setting('test.reclaim_code'))$$,'42501',null,'regenerated code rejects previous secret');
reset role;
update private.character_codes set expires_at=now()-interval '1 second';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.reclaim_character('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',current_setting('test.new_code'))$$,'42501',null,'expired code rejected');
reset role;
update private.character_codes set expires_at=now()+interval '1 day',revoked_at=now();
set local role authenticated;
select throws_ok($$select public.reclaim_character('40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',current_setting('test.new_code'))$$,'42501',null,'revoked code rejected');

reset role;
update campaign_members set status='revoked' where user_id='00000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}',true);
select is((select count(*)::int from tokens),0,'campaign revocation immediately removes board access');
select is((select count(*)::int from characters),0,'revocation removes shared character access');
select is((select count(*)::int from storage.objects),0,'revocation removes portrait access');
reset role;
update campaign_members set status='approved' where user_id='00000000-0000-0000-0000-000000000003';
update session_players set status='revoked' where user_id='00000000-0000-0000-0000-000000000003';
set local role authenticated;
select is((select count(*)::int from tokens),0,'session revocation denies access even with campaign approval');
reset role;
update session_players set status='approved' where user_id='00000000-0000-0000-0000-000000000003';
insert into sessions(id,campaign_id,name,status,active_level_id) values
 ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Unjoined session','active','30000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::int from sessions),1,'campaign approval does not authorize another session');
select throws_ok($$select public.reclaim_character('40000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001',current_setting('test.new_code'))$$,'42501',null,'reclaim blocked in unjoined same-campaign session');
reset role;
update sessions set status='closed' where name='A session';
set local role authenticated;
select is((select count(*)::int from tokens),0,'closed session removes board access');
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated","is_anonymous":false}',true);
select is((select count(*)::int from campaigns),0,'unaffiliated registered identity sees no campaign');
select is((select count(*)::int from tokens),0,'unaffiliated registered identity sees no board');
select is((select count(*)::int from private.dm_notes),0,'unaffiliated registered identity sees no private data');

reset role;
set local role anon;
select throws_ok('select * from public.campaigns','42501',null,'bare anon key has no campaign access');
select throws_ok('select * from private.token_details','42501',null,'bare anon has no private schema access');
reset role;
select * from finish();
rollback;
