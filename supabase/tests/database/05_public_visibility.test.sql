-- Issue #9 independent-review corrective pass: authoritative `publicVisible` metadata on
-- private.session_projection's token/character/initiative entries. This is the backend half of
-- the fix for the DM "Preview as Player" defect where a manager's own snapshot (which legitimately
-- contains hidden tokens, fog-hidden tokens and unapproved characters) was rendered through the
-- player-facing renderer with no filtering at all. These tests prove the flag distinguishes public
-- from non-public entities using the exact predicates the function already used to decide whether
-- a non-manager recipient may see that entity, and that real (non-manager) recipient behavior is
-- unchanged by this migration.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,is_anonymous) values
('09000000-0000-0000-0000-000000000001',false), -- owner/manager
('09000000-0000-0000-0000-000000000002',true),  -- approved player, owns the public character
('09000000-0000-0000-0000-000000000003',true);  -- approved player, owns the non-public character

insert into campaigns(id,owner_id,name,fog_enabled) values
('09100000-0000-0000-0000-000000000001','09000000-0000-0000-0000-000000000001','Visibility',false);
insert into locations(id,campaign_id,name) values
('09200000-0000-0000-0000-000000000001','09100000-0000-0000-0000-000000000001','L');
insert into levels(id,campaign_id,location_id,name,fog_enabled) values
('09300000-0000-0000-0000-000000000001','09100000-0000-0000-0000-000000000001','09200000-0000-0000-0000-000000000001','L',false);
insert into sessions(id,campaign_id,name,status,active_level_id) values
('09400000-0000-0000-0000-000000000001','09100000-0000-0000-0000-000000000001','S','active','09300000-0000-0000-0000-000000000001');
insert into campaign_members(campaign_id,user_id,status) values
('09100000-0000-0000-0000-000000000001','09000000-0000-0000-0000-000000000002','approved'),
('09100000-0000-0000-0000-000000000001','09000000-0000-0000-0000-000000000003','approved');
insert into characters(id,campaign_id,name,approved,hp) values
('09500000-0000-0000-0000-000000000001','09100000-0000-0000-0000-000000000001','Public Hero',true,12),
('09500000-0000-0000-0000-000000000002','09100000-0000-0000-0000-000000000001','Unapproved Hero',false,9);
insert into session_players(campaign_id,session_id,user_id,status,character_id) values
('09100000-0000-0000-0000-000000000001','09400000-0000-0000-0000-000000000001','09000000-0000-0000-0000-000000000002','approved','09500000-0000-0000-0000-000000000001'),
('09100000-0000-0000-0000-000000000001','09400000-0000-0000-0000-000000000001','09000000-0000-0000-0000-000000000003','approved','09500000-0000-0000-0000-000000000002');
insert into tokens(id,campaign_id,level_id,kind,label,x,y,is_visible) values
('09600000-0000-0000-0000-000000000001','09100000-0000-0000-0000-000000000001','09300000-0000-0000-0000-000000000001','enemy','Visible',0,0,true),
('09600000-0000-0000-0000-000000000002','09100000-0000-0000-0000-000000000001','09300000-0000-0000-0000-000000000001','boss','Hidden',1,0,false);
insert into initiative_entries(id,campaign_id,session_id,token_id,initiative,position,is_active) values
('09700000-0000-0000-0000-000000000001','09100000-0000-0000-0000-000000000001','09400000-0000-0000-0000-000000000001','09600000-0000-0000-0000-000000000001',10,0,true),
('09700000-0000-0000-0000-000000000002','09100000-0000-0000-0000-000000000001','09400000-0000-0000-0000-000000000001','09600000-0000-0000-0000-000000000002',5,1,false);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"09000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select set_config('test.manager_snapshot',get_session_snapshot('09400000-0000-0000-0000-000000000001')::text,true);

-- Case 1 & 2: is_visible alone (fog disabled at the level).
select is((select t->>'publicVisible' from jsonb_array_elements(current_setting('test.manager_snapshot')::jsonb->'tokens') t
  where t->>'id'='09600000-0000-0000-0000-000000000001'),'true','visible public token is publicVisible: true');
select is((select t->>'publicVisible' from jsonb_array_elements(current_setting('test.manager_snapshot')::jsonb->'tokens') t
  where t->>'id'='09600000-0000-0000-0000-000000000002'),'false','is_visible: false token is publicVisible: false');

-- Case 4 & 5: character approval + session/campaign-member approval state.
select is((select c->>'publicVisible' from jsonb_array_elements(current_setting('test.manager_snapshot')::jsonb->'characters') c
  where c->>'id'='09500000-0000-0000-0000-000000000001'),'true','approved public session character is publicVisible: true');
select is((select c->>'publicVisible' from jsonb_array_elements(current_setting('test.manager_snapshot')::jsonb->'characters') c
  where c->>'id'='09500000-0000-0000-0000-000000000002'),'false','unapproved character is publicVisible: false');

-- Case 6 & 7: initiative publicVisible tracks its token's publicVisible.
select is((select i->>'publicVisible' from jsonb_array_elements(current_setting('test.manager_snapshot')::jsonb->'initiative') i
  where i->>'tokenId'='09600000-0000-0000-0000-000000000001'),'true','initiative for a visible token is publicVisible: true');
select is((select i->>'publicVisible' from jsonb_array_elements(current_setting('test.manager_snapshot')::jsonb->'initiative') i
  where i->>'tokenId'='09600000-0000-0000-0000-000000000002'),'false','initiative for a non-public token is publicVisible: false');

-- Case 3: canonical fog visibility, isolated from is_visible. Enable fog on the level with the
-- visible token still is_visible=true; with no revealed fog cell at all, fog must block it.
reset role;
update levels set fog_enabled=true where id='09300000-0000-0000-0000-000000000001';
set local role authenticated;
select is((select t->>'publicVisible' from jsonb_array_elements(get_session_snapshot('09400000-0000-0000-0000-000000000001')->'tokens') t
  where t->>'id'='09600000-0000-0000-0000-000000000001'),'false','an is_visible token blocked by fog (no revealed cell) is publicVisible: false');

reset role;
insert into fog_cells(campaign_id,level_id,x,y,is_revealed) values
('09100000-0000-0000-0000-000000000001','09300000-0000-0000-0000-000000000001',0,0,true);
set local role authenticated;
select is((select t->>'publicVisible' from jsonb_array_elements(get_session_snapshot('09400000-0000-0000-0000-000000000001')->'tokens') t
  where t->>'id'='09600000-0000-0000-0000-000000000001'),'true','revealing the token''s own cell restores publicVisible: true');
reset role;
update levels set fog_enabled=false where id='09300000-0000-0000-0000-000000000001';

-- Existing recipient-specific (non-manager) behavior must be unchanged by this migration: a real
-- player still only ever receives publicly-visible tokens/approved characters, and every token
-- they do receive is (trivially, since non-public ones are absent) publicVisible: true.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"09000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select set_config('test.player_snapshot',get_session_snapshot('09400000-0000-0000-0000-000000000001')::text,true);
select is(jsonb_array_length(current_setting('test.player_snapshot')::jsonb->'tokens'),1,'approved player still receives only the one visible token');
select is((select t->>'publicVisible' from jsonb_array_elements(current_setting('test.player_snapshot')::jsonb->'tokens') t limit 1),
  'true','every token a real player receives is publicVisible: true');
select is(current_setting('test.player_snapshot')::jsonb->'dm','null'::jsonb,'player snapshot still carries no DM state');
select is(current_setting('test.player_snapshot')::jsonb->'authority'->'canManage','false'::jsonb,'player snapshot still reports canManage: false');

-- The own-character exception: U3's own character is not publicly approved, so it must still
-- appear in U3's own recipient array (existing own-character rule, unchanged) while its
-- publicVisible flag truthfully reports it is not part of the generic public projection — this is
-- exactly what lets a client distinguish "shown to me because it's mine" from "shown to everyone".
select set_config('request.jwt.claims','{"sub":"09000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select set_config('test.own_unapproved_snapshot',get_session_snapshot('09400000-0000-0000-0000-000000000001')::text,true);
select is(current_setting('test.own_unapproved_snapshot')::jsonb->'authority'->>'ownCharacterId','09500000-0000-0000-0000-000000000002','U3''s own (unapproved) character id is reported as authority.ownCharacterId');
select is((select c->>'publicVisible' from jsonb_array_elements(current_setting('test.own_unapproved_snapshot')::jsonb->'characters') c
  where c->>'id'='09500000-0000-0000-0000-000000000002'),'false','U3''s own unapproved character is still present via the own-character rule but reports publicVisible: false');
reset role;

select * from finish();
rollback;
