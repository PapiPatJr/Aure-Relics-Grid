// Local-only integration checks: actual Auth JWTs, PostgREST, RPC and Storage API.
// Administrative credentials are read in memory solely to create/delete test users.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

assert.match(readFileSync('supabase/config.toml','utf8'), /project_id = "aure-relics-v09-foundation"/);
const status = JSON.parse(execFileSync(process.execPath,
  ['node_modules/supabase/dist/supabase.js','status','--output','json'],
  { encoding:'utf8', windowsHide:true, stdio:['ignore','pipe','pipe'] }));
assert.equal(status.API_URL, 'http://127.0.0.1:56321', 'Refuse to test any other stack or hosted project');
const options = { auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } };
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const makeClient = () => createClient(status.API_URL,status.ANON_KEY,options);
const users = [];
const campaigns = [];
const images = [];
let assertions = 0;
function ok(condition,label) { assert.ok(condition,label); assertions++; console.log(`PASS ${label}`); }
function data(result) { if(result.error) throw new Error(result.error.message); return result.data; }
async function insert(client,table,row) { return data(await client.from(table).insert(row).select().single()); }
async function dm() {
  const email = `issue5-${crypto.randomUUID()}@example.test`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const user = data(await admin.auth.admin.createUser({email,password,email_confirm:true})).user;
  users.push(user.id);
  const client = makeClient();
  data(await client.auth.signInWithPassword({email,password}));
  return {client,id:user.id};
}

try {
  const a = await dm();
  const b = await dm();
  const guest = makeClient();
  const guestId = data(await guest.auth.signInAnonymously()).user.id;
  users.push(guestId);
  const c = await insert(a.client,'campaigns',{owner_id:a.id,name:'API A'});
  campaigns.push({id:c.id,client:a.client});
  const other = await insert(b.client,'campaigns',{owner_id:b.id,name:'API B'});
  campaigns.push({id:other.id,client:b.client});
  ok(data(await a.client.from('campaigns').select('id')).length===1,'DM only reads own campaign');
  ok(data(await guest.from('campaigns').select('id')).length===0,'anonymous identity starts without membership');
  ok(Boolean((await guest.from('campaigns').insert({owner_id:guestId,name:'spoof'})).error),'anonymous identity cannot own campaign');
  const loc = await insert(a.client,'locations',{campaign_id:c.id,name:'Location'});
  const level = await insert(a.client,'levels',{campaign_id:c.id,location_id:loc.id,name:'Level'});
  const session = await insert(a.client,'sessions',{campaign_id:c.id,name:'Session',status:'active',active_level_id:level.id});
  const character = await insert(a.client,'characters',{campaign_id:c.id,name:'Player',approved:true,hp:20});
  await insert(a.client,'campaign_members',{campaign_id:c.id,user_id:guestId,status:'approved'});
  await insert(a.client,'session_players',{campaign_id:c.id,session_id:session.id,user_id:guestId,status:'approved'});
  await insert(a.client,'fog_cells',{campaign_id:c.id,level_id:level.id,x:0,y:0,is_revealed:true});
  const enemy = await insert(a.client,'tokens',{campaign_id:c.id,level_id:level.id,kind:'enemy',label:'Public enemy',x:0,y:0,is_visible:true,condition_label:'Hurt'});
  await insert(a.client,'tokens',{campaign_id:c.id,level_id:level.id,kind:'boss',label:'Hidden boss',x:1,y:0,is_visible:false});
  await insert(a.client,'tokens',{campaign_id:c.id,level_id:level.id,kind:'npc',label:'Fogged NPC',x:1,y:0,is_visible:true});
  data(await a.client.rpc('save_token_details',{campaign:c.id,token:enemy.id,hp:77,maximum_hp:100,notes:'private sentinel'}));
  const visible = data(await guest.from('tokens').select('*'));
  ok(visible.length===1 && visible[0].id===enemy.id,'player REST payload excludes hidden and fogged tokens');
  ok(visible[0].condition_label==='Hurt' && !('actual_hp' in visible[0]),'player REST has condition and no exact HP column');
  ok(data(await guest.rpc('get_token_details',{token:enemy.id})).length===0,'guest RPC cannot read exact HP');
  ok(data(await b.client.rpc('get_token_details',{token:enemy.id})).length===0,'other DM RPC cannot read exact HP');
  ok(data(await a.client.rpc('get_token_details',{token:enemy.id}))[0].actual_hp===77,'owner RPC reads exact HP');
  ok(Boolean((await guest.schema('private').from('dm_notes').select('*')).error),'private schema is not exposed to REST');
  ok(data(await guest.from('tokens').update({is_visible:true}).eq('id',enemy.id).select()).length===0,'guest cannot update official state through REST');
  const code = data(await a.client.rpc('issue_character_code',{p_character:character.id}));
  data(await guest.rpc('revoke_character_code',{p_character:character.id}));
  // Invoker RLS makes an unauthorized revoke a no-op, proven by successful reclaim below.
  ok(Boolean((await guest.rpc('reclaim_character',{p_session:session.id,p_character:character.id,p_code:'wrong'})).error),'wrong reclaim code fails through API');
  data(await guest.rpc('reclaim_character',{p_session:session.id,p_character:character.id,p_code:code}));
  ok(data(await guest.from('characters').select('*'))[0].hp===20,'valid reclaim makes assigned player card readable');
  data(await guest.rpc('reclaim_character',{p_session:session.id,p_character:character.id,p_code:code}));
  ok(true,'saved character code can be reused');
  data(await a.client.rpc('revoke_character_code',{p_character:character.id}));
  ok(Boolean((await guest.rpc('reclaim_character',{p_session:session.id,p_character:character.id,p_code:code})).error),'DM revocation prevents subsequent reclaim');

  const path = `${c.id}/${session.id}/${character.id}/portrait.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
  data(await guest.storage.from('character-images').upload(path,png,{contentType:'image/png'}));
  images.push(path);
  ok(true,'assigned guest uploads portrait through Storage API');
  ok(Boolean(data(await guest.storage.from('character-images').download(path))),'assigned guest downloads private portrait');
  ok(Boolean((await b.client.storage.from('character-images').download(path)).error),'other campaign DM denied portrait download');
  ok(Boolean((await makeClient().storage.from('character-images').download(path)).error),'bare anon denied portrait download');
  ok(Boolean((await guest.storage.from('character-images').upload(path,png,{contentType:'image/png',upsert:true})).error),'guest cannot overwrite one-time portrait');
  ok(Boolean((await guest.storage.from('terrain-assets').upload(`${c.id}/hack.png`,png,{contentType:'image/png'})).error),'guest denied terrain upload');
  data(await a.client.from('campaign_members').update({status:'revoked'}).eq('campaign_id',c.id).eq('user_id',guestId));
  ok(data(await guest.from('tokens').select('*')).length===0,'membership revocation removes REST board access');
  ok(Boolean((await guest.storage.from('character-images').download(path)).error),'revocation removes Storage API access');
  console.log(`${assertions} API security checks passed.`);
} finally {
  // Remove only objects/users/campaigns created by this run.
  const cleanupErrors = [];
  const cleanup = async (operation) => { try { data(await operation()); } catch (error) { cleanupErrors.push(error); } };
  if(images.length) await cleanup(() => admin.storage.from('character-images').remove(images));
  for(const campaign of campaigns) await cleanup(() => campaign.client.from('campaigns').delete().eq('id',campaign.id));
  for(const user of users) await cleanup(() => admin.auth.admin.deleteUser(user));
  if(cleanupErrors.length) throw new AggregateError(cleanupErrors,'Local API test fixture cleanup failed');
}
