// Local-only enrollment contract using real Auth sessions and PostgREST.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

assert.match(readFileSync('supabase/config.toml','utf8'), /project_id = "aure-relics-v09-foundation"/);
const status = JSON.parse(execFileSync(process.execPath,
  ['node_modules/supabase/dist/supabase.js','status','--output','json'],
  {encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}));
assert.equal(status.API_URL,'http://127.0.0.1:56321','Refuse another stack or hosted project');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const makeClient=()=>createClient(status.API_URL,status.ANON_KEY,options);
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options);
const users=[]; const campaigns=[]; const clients=[];
let checks=0;
function ok(value,label){assert.ok(value,label);checks++;console.log('PASS '+label);}
function data(result){if(result.error)throw new Error(result.error.message);return result.data;}
async function insert(client,table,row){return data(await client.from(table).insert(row).select().single());}
async function dm(){
  const client=makeClient(); clients.push(client);
  const email='issue6-'+crypto.randomUUID()+'@example.test';
  const password=crypto.randomUUID()+'Aa1!';
  const signed=data(await client.auth.signUp({email,password}));
  users.push(signed.user.id);
  ok(Boolean(signed.session),'real DM email signup creates session');
  data(await client.auth.signOut());
  ok(data(await client.auth.getSession()).session===null,'logout removes local DM session');
  ok(Boolean((await client.from('campaigns').select('id')).error),'signed-out client denied campaign reads');
  data(await client.auth.signInWithPassword({email,password}));
  ok(data(await client.auth.getUser()).user.id===signed.user.id,'password login restores same permanent identity');
  return {client,id:signed.user.id};
}
async function anonymous(){
  const client=makeClient();clients.push(client);
  const user=data(await client.auth.signInAnonymously()).user;users.push(user.id);
  ok(user.is_anonymous===true,'real anonymous Auth identity');
  return {client,id:user.id};
}
const rpc=(client,name,args)=>client.rpc(name,args);
try{
  const a=await dm(),b=await dm(),guest=await anonymous(),pending=await anonymous();
  const c=await insert(a.client,'campaigns',{owner_id:a.id,name:'Entry A'});campaigns.push({id:c.id,client:a.client});
  const other=await insert(b.client,'campaigns',{owner_id:b.id,name:'Entry B'});campaigns.push({id:other.id,client:b.client});
  const s=await insert(a.client,'sessions',{campaign_id:c.id,name:'Lobby A'});
  const s2=await insert(a.client,'sessions',{campaign_id:c.id,name:'Lobby A2'});
  const foreign=await insert(b.client,'sessions',{campaign_id:other.id,name:'Lobby B'});
  const args={p_campaign:c.id,p_session:s.id,p_display_name:'  Guest One  '};
  const review={p_session:s.id,p_user:guest.id,p_action:'approve'};
  const code=data(await rpc(a.client,'issue_session_code',{p_session:s.id}));
  ok(/^[0-9a-f]{64}$/.test(code),'DM gets secure session code');
  ok(Boolean((await rpc(b.client,'issue_session_code',{p_session:s.id})).error),'other DM denied code issue');
  ok(Boolean((await rpc(makeClient(),'request_session_join',{...args,p_code:code})).error),'bare anon denied redemption');
  ok(Boolean((await guest.client.from('campaigns').insert({owner_id:guest.id,name:'Spoof'})).error),'anonymous identity cannot create campaign');
  ok(Boolean((await rpc(guest.client,'request_session_join',{...args,p_code:'invalid'})).error),'invalid code rejected');
  ok(Boolean((await rpc(guest.client,'request_session_join',{...args,p_campaign:other.id,p_code:code})).error),'cross-campaign code rejected');
  ok(Boolean((await rpc(guest.client,'request_session_join',{...args,p_session:foreign.id,p_code:code})).error),'foreign-session code rejected');
  ok(data(await a.client.from('session_players').select('user_id').eq('session_id',s.id)).length===0,'failed joins leave roster unchanged');
  data(await rpc(guest.client,'request_session_join',{...args,p_code:code}));
  assert.deepEqual(data(await rpc(guest.client,'get_guest_lobby',{p_session:s.id})),
    {status:'pending',campaign_name:'Entry A',session_name:'Lobby A',display_name:'Guest One'});
  ok(true,'guest gets only safe pending lobby fields');
  ok(data(await guest.client.from('sessions').select('*')).length===0,'pending cannot read official session');
  ok(data(await rpc(guest.client,'get_session_roster',{p_session:s.id})).length===0,'pending cannot enumerate roster');
  ok(Boolean((await rpc(guest.client,'review_session_guest',review)).error),'self approval denied');
  ok(Boolean((await rpc(b.client,'review_session_guest',review)).error),'foreign DM approval denied');
  ok(data(await guest.client.from('session_players').update({status:'approved'}).eq('user_id',guest.id).select()).length===0,'direct guest self approval denied');
  ok(data(await rpc(guest.client,'get_guest_lobby',{p_session:s.id})).status==='pending','failed approvals leave status pending');
  data(await rpc(a.client,'review_session_guest',review));
  data(await rpc(pending.client,'request_session_join',{...args,p_code:code,p_display_name:'Pending Guest'}));
  const roster=data(await rpc(guest.client,'get_session_roster',{p_session:s.id}));
  assert.deepEqual(roster,[{user_id:guest.id,display_name:'Guest One',status:'approved'}]);
  ok(true,'approved guest sees only approved minimal roster');
  ok(data(await rpc(a.client,'get_session_roster',{p_session:s.id})).length===2,'owner sees pending and approved guests');
  ok(data(await rpc(b.client,'get_session_roster',{p_session:s.id})).length===0,'foreign DM cannot enumerate roster');
  const raced=await Promise.all([
    rpc(a.client,'review_session_guest',{p_session:s.id,p_user:pending.id,p_action:'approve'}),
    rpc(a.client,'review_session_guest',{p_session:s.id,p_user:pending.id,p_action:'revoke'}),
    rpc(pending.client,'request_session_join',{...args,p_code:code,p_display_name:'Pending Guest'})
  ]);
  data(raced[1]);
  ok(data(await rpc(pending.client,'get_guest_lobby',{p_session:s.id})).status==='revoked','concurrent review and redemption cannot restore revoked session');
  data(await rpc(guest.client,'request_session_join',{...args,p_code:code}));
  ok(data(await rpc(guest.client,'get_guest_lobby',{p_session:s.id})).status==='approved','repeat redemption preserves approval');
  const code2=data(await rpc(a.client,'issue_session_code',{p_session:s2.id}));
  data(await rpc(guest.client,'request_session_join',{...args,p_session:s2.id,p_code:code2}));
  data(await rpc(a.client,'review_session_guest',{...review,p_session:s2.id,p_action:'reject'}));
  ok(data(await rpc(guest.client,'get_guest_lobby',{p_session:s2.id})).status==='revoked','rejected request returns revoked');
  ok(data(await rpc(guest.client,'get_guest_lobby',{p_session:s.id})).status==='approved','rejection preserves unrelated approved session');
  ok(Boolean((await rpc(guest.client,'request_session_join',{...args,p_session:s2.id,p_code:code2})).error),'rejected guest cannot rejoin session');
  const rotated=data(await rpc(a.client,'issue_session_code',{p_session:s.id}));
  ok(rotated!==code,'rotation changes secret');
  ok(Boolean((await rpc(guest.client,'request_session_join',{...args,p_code:code})).error),'previous code denied after rotation');
  data(await rpc(a.client,'revoke_session_code',{p_session:s.id}));
  ok(Boolean((await rpc(guest.client,'request_session_join',{...args,p_code:rotated})).error),'revoked code denied');
  data(await rpc(a.client,'review_session_guest',{...review,p_action:'revoke'}));
  ok(data(await rpc(guest.client,'get_guest_lobby',{p_session:s.id})).status==='revoked','revocation changes lobby immediately');
  ok(data(await guest.client.from('sessions').select('*')).length===0,'revocation removes official session access');
  ok(data(await rpc(guest.client,'get_session_roster',{p_session:s.id})).length===0,'revoked guest sees no roster');
  data(await a.client.from('sessions').update({status:'closed'}).eq('id',s.id));
  ok(data(await rpc(pending.client,'get_guest_lobby',{p_session:s.id})).status==='closed','pending guest sees session closed');
  data(await guest.client.auth.signOut());
  ok(data(await guest.client.auth.getSession()).session===null,'guest logout removes session');
  ok(Boolean((await rpc(guest.client,'get_guest_lobby',{p_session:s.id})).error),'signed-out guest denied lobby');
  console.log(checks+' enrollment API checks passed.');
}finally{
  const errors=[];
  const cleanup=async(operation)=>{try{data(await operation());}catch(error){errors.push(error);}};
  for(const campaign of campaigns)await cleanup(()=>campaign.client.from('campaigns').delete().eq('id',campaign.id));
  for(const client of clients)await cleanup(()=>client.auth.signOut());
  for(const user of users)await cleanup(()=>admin.auth.admin.deleteUser(user));
  if(errors.length)throw new AggregateError(errors,'Local enrollment fixture cleanup failed');
}
