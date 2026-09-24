// Real Auth, PostgREST and WebSocket security contract; no production adapter mocks.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import {localTestStack} from './local-test-stack.mjs';

const status=localTestStack();
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options);
const users=[],campaigns=[],clients=[];
let checks=0;
function ok(value,label){assert.ok(value,label);checks++;console.log('PASS '+label);}
function data(r){if(r.error)throw new Error(`${r.error.code}: ${r.error.message}`);return r.data;}
const client=()=>{const c=createClient(status.API_URL,status.ANON_KEY,options);clients.push(c);return c;};
async function identity(registered=false){
  const c=client();let user;
  if(registered){const email=`issue8a-${crypto.randomUUID()}@example.test`,password=crypto.randomUUID()+'Aa1!';
    user=data(await admin.auth.admin.createUser({email,password,email_confirm:true})).user;
    users.push(user.id);data(await c.auth.signInWithPassword({email,password}));
  }else {user=data(await c.auth.signInAnonymously()).user;users.push(user.id);}
  return {c,id:user.id};
}
async function insert(c,table,row){return data(await c.from(table).insert(row).select().single());}
async function snapshot(u,s){return data(await u.c.rpc('get_session_snapshot',{p_session:s}));}
const command=(type,revision,payload,extra={})=>({schemaVersion:1,type,expectedRevision:revision,payload,...extra});
const mutate=(u,s,c)=>u.c.rpc('mutate_session',{p_session:s,p_command:c});
async function denied(promise,code,label){const r=await promise;assert.equal(r.error?.code,code,label);ok(true,label);}
async function until(predicate,label,timeout=30000){
  const end=Date.now()+timeout;
  while(!predicate()){if(Date.now()>end)throw new Error('Timed out: '+label);await delay(25);}
}
async function subscribe(u,s,all=false){
  const messages=[];let state;let failure;
  const channel=u.c.channel(`8a-${crypto.randomUUID()}`,{
    config:{postgres_changes_options:{wait:true,timeout:15000}}
  }).on('system',{},event=>{
    if(event.status==='error')console.error('Realtime system error:',event.message);
  }).on('postgres_changes',{
    event:'*',schema:'public',table:'session_events',...(all?{}:{filter:`session_id=eq.${s}`})
  },e=>messages.push(e)).subscribe((value,error)=>{state=value;failure=error;});
  await until(()=>state==='SUBSCRIBED'||state==='CHANNEL_ERROR','subscription');
  assert.equal(state,'SUBSCRIBED',failure?.message);
  return {channel,messages,inserts:()=>messages.filter(e=>e.eventType==='INSERT').map(e=>e.new)};
}
async function received(stream,revision){await until(()=>stream.inserts().some(e=>e.revision===revision),'notification '+revision);}
const card=(id,hp=12)=>({characterId:id,name:'Hero',playerName:'Player',hp,maxHp:20,tempHp:0,ac:15,speed:30,statuses:['Inspired'],publicNotes:'Shared'});

try{
  const owner=await identity(true),other=await identity(true),a=await identity(),b=await identity();
  const c=await insert(owner.c,'campaigns',{owner_id:owner.id,name:'8A A',fog_enabled:false});campaigns.push({id:c.id,c:owner.c});
  const foreign=await insert(other.c,'campaigns',{owner_id:other.id,name:'8A B'});campaigns.push({id:foreign.id,c:other.c});
  const loc=await insert(owner.c,'locations',{campaign_id:c.id,name:'L'});
  const level=await insert(owner.c,'levels',{campaign_id:c.id,location_id:loc.id,name:'L'});
  const s=await insert(owner.c,'sessions',{campaign_id:c.id,name:'S',status:'active',active_level_id:level.id});
  const s2=await insert(owner.c,'sessions',{campaign_id:c.id,name:'Unjoined',status:'active',active_level_id:level.id});
  const outsiderSession=await insert(other.c,'sessions',{campaign_id:foreign.id,name:'Foreign'});
  const ch=await insert(owner.c,'characters',{campaign_id:c.id,name:'Hero',approved:true,hp:12,max_hp:20});
  const ch2=await insert(owner.c,'characters',{campaign_id:c.id,name:'PENDING_PRIVATE_SENTINEL',approved:false,hp:9});
  for(const [u,character] of [[a,ch],[b,ch2]]){
    await insert(owner.c,'campaign_members',{campaign_id:c.id,user_id:u.id,status:'approved'});
    await insert(owner.c,'session_players',{campaign_id:c.id,session_id:s.id,user_id:u.id,status:'approved',character_id:character.id});
  }
  const visible=await insert(owner.c,'tokens',{campaign_id:c.id,level_id:level.id,kind:'enemy',label:'Visible enemy',x:0,y:0,is_visible:true});
  const hidden=await insert(owner.c,'tokens',{campaign_id:c.id,level_id:level.id,kind:'boss',label:'HIDDEN_PRIVATE_SENTINEL',x:1,y:0,is_visible:false});
  data(await owner.c.rpc('save_token_details',{campaign:c.id,token:visible.id,hp:77,maximum_hp:100,notes:'DM_PRIVATE_SENTINEL'}));
  // SUBSCRIBED first, then hydration: changes during the read remain buffered.
  const streams=await Promise.all([subscribe(owner,s.id),subscribe(a,s.id),subscribe(b,s.id),subscribe(other,s.id,true)]);
  const [dmStream,aStream,bStream,outsiderStream]=streams;
  let sa=await snapshot(a,s.id),sd=await snapshot(owner,s.id);
  ok(typeof sa.revision==='string' && /^\d+$/.test(sa.revision),'snapshot revision is exact decimal text');
  ok(!JSON.stringify(sa).includes('PRIVATE_SENTINEL')&&sa.dm===null,'player snapshot excludes pending/hidden/private state');
  ok(sd.dm.tokenDetails[0].actualHp===77,'owner hydration includes own exact enemy HP');
  ok((await snapshot(b,s.id)).characters.some(x=>x.id===ch2.id),'own pending card is included without exposing it to peer');
  await denied(other.c.rpc('get_session_snapshot',{p_session:s.id}),'42501','foreign owner cannot hydrate');
  await denied(a.c.rpc('get_session_snapshot',{p_session:s2.id}),'42501','same-campaign unjoined session cannot hydrate');
  await denied(a.c.rpc('get_session_snapshot',{p_session:outsiderSession.id}),'42501','guest cannot hydrate foreign campaign');
  await denied(client().rpc('get_session_snapshot',{p_session:s.id}),'42501','bare anon cannot hydrate');
  await denied(mutate(a,s.id,command('session.setRound',sa.revision,{roundNumber:2})),'42501','player denied official command');
  await denied(mutate(a,s.id,command('character.update',sa.revision,card(ch2.id))),'42501','player denied another character');

  const changed=data(await mutate(a,s.id,command('character.update',sa.revision,card(ch.id,8),{commandId:'client-correlation'})));
  ok(changed.characters.find(x=>x.id===ch.id).hp===8,'own-character command changes authoritative state');
  await received(aStream,changed.revision);
  sd=await snapshot(owner,s.id);await received(dmStream,sd.revision);
  ok(sd.dm.activity.some(x=>x.eventType==='character_card_changed'),'character HP change appears in owner activity');
  await denied(mutate(a,s.id,command('character.update',sa.revision,card(ch.id,5))),'40001','stale own-character revision conflicts');
  for(const invalid of [null,[],{},command('unknown',sd.revision,{}),
    command('session.setRound',Number(sd.revision),{roundNumber:3}),
    command('session.setRound',sd.revision,{roundNumber:3},{unexpected:true}),
    command('session.setRound',sd.revision,{roundNumber:null}),
    command('session.setRound',sd.revision,{roundNumber:2.5}),
    command('session.setRound',sd.revision,{roundNumber:3},{commandId:{secret:'x'}}),
    command('token.setPublicState',sd.revision,{tokenId:'invalid',label:'X',conditionLabel:'Hurt',isVisible:true})]){
    await denied(mutate(owner,s.id,invalid),'22023','malformed mutation rejected');
  }
  const races=await Promise.all([mutate(owner,s.id,command('session.setRound',sd.revision,{roundNumber:2})),
    mutate(owner,s.id,command('session.setRound',sd.revision,{roundNumber:3}))]);
  ok(races.filter(r=>!r.error).length===1 && races.some(r=>r.error?.code==='40001'),'concurrent same-watermark official commands have one winner');
  sa=await snapshot(a,s.id);await received(aStream,sa.revision);

  const beforePrivate=sa.revision;
  data(await owner.c.from('tokens').update({label:'HIDDEN_PRIVATE_EDIT'}).eq('id',hidden.id));
  data(await owner.c.rpc('save_token_details',{campaign:c.id,token:visible.id,hp:66,maximum_hp:100,notes:'DM_PRIVATE_EDIT'}));
  sd=await snapshot(owner,s.id);await received(dmStream,sd.revision);
  ok((await snapshot(a,s.id)).revision===beforePrivate,'hidden/private changes do not alter player watermark');
  const pendingBefore=(await snapshot(a,s.id)).revision;
  data(await owner.c.from('characters').update({hp:7}).eq('id',ch2.id));
  const sb=await snapshot(b,s.id);await received(bStream,sb.revision);
  ok((await snapshot(a,s.id)).revision===pendingBefore,'peer pending-character edit does not alter player watermark');

  // Legacy character RPC remains a notification source.
  data(await a.c.rpc('update_session_character',{p_session:s.id,p_character:ch.id,p_name:'Hero',p_player_name:'Player',
    p_hp:11,p_max_hp:20,p_temp_hp:0,p_ac:17,p_speed:30,p_statuses:['Inspired'],p_notes:'Shared'}));
  sa=await snapshot(a,s.id);await received(aStream,sa.revision);
  ok(sa.characters.find(x=>x.id===ch.id).ac===17,'legacy RPC changes are synchronized');

  sd=await snapshot(owner,s.id);
  data(await mutate(owner,s.id,command('initiative.set',sd.revision,{entries:[
    {tokenId:visible.id,initiative:15,position:0,isActive:false},
    {tokenId:hidden.id,initiative:20,position:1,isActive:true}]})));
  sa=await snapshot(a,s.id);await received(aStream,sa.revision);
  ok(sa.initiative.length===1 && sa.initiative[0].tokenId===visible.id && !sa.initiative[0].isActive,'hidden initiative and active identity omitted');
  sd=await snapshot(owner,s.id);
  data(await mutate(owner,s.id,command('token.setPublicState',sd.revision,{tokenId:visible.id,label:'Visible enemy',conditionLabel:'Hurt',isVisible:false})));
  sa=await snapshot(a,s.id);await received(aStream,sa.revision);
  ok(sa.tokens.length===0 && sa.initiative.length===0,'hide transition removes token and initiative after hydration');
  data(await owner.c.from('tokens').update({is_visible:true}).eq('id',visible.id));
  sa=await snapshot(a,s.id);await received(aStream,sa.revision);
  const latest=sa.revision;
  await a.c.removeChannel(aStream.channel);
  data(await owner.c.from('session_state').update({round_number:10}).eq('session_id',s.id));
  const reconnected=await subscribe(a,s.id);
  sa=await snapshot(a,s.id);
  ok(sa.roundNumber===10 && BigInt(sa.revision)>BigInt(latest),'reconnect restores authoritative state without replay');

  data(await owner.c.from('session_players').update({status:'revoked'}).eq('session_id',s.id).eq('user_id',a.id));
  await denied(a.c.rpc('get_session_snapshot',{p_session:s.id}),'42501','revoked hydration fails immediately');
  await denied(mutate(a,s.id,command('character.update',sa.revision,card(ch.id,4))),'42501','revoked mutation fails immediately');
  const countAfterRevoke=reconnected.inserts().length;
  data(await owner.c.from('session_state').update({round_number:11}).eq('session_id',s.id));
  const liveB=await snapshot(b,s.id);await received(bStream,liveB.revision);
  await delay(500); // Allowed recipient delivery is the barrier; grace detects late forbidden delivery.
  ok(reconnected.inserts().length===countAfterRevoke,'connected revoked socket gets no useful subsequent event');
  ok(data(await a.c.from('session_events').select('*')).length===0,'revoked historical event reads fail closed');
  ok(outsiderStream.inserts().every(e=>e.session_id===outsiderSession.id),'hostile wildcard outsider subscription receives only its own session events');
  for(const stream of [...streams,reconnected])for(const row of stream.inserts()){
    assert.deepEqual(Object.keys(row).sort(),['id','revision','schema_version','session_id','type']);
    assert.equal(row.type,'session.invalidated');assert.equal(row.schema_version,1);
    assert.equal(typeof row.revision,'string');assert.match(row.revision,/^\d+$/);
  }
  ok(true,'actual WebSocket rows contain only the minimal invalidation envelope');
  const ids=new Set(data(await b.c.from('session_events').select('id')).map(x=>x.id));
  ok(bStream.inserts().every(x=>ids.has(x.id)),'socket receives only its own authorized event IDs');

  // Retention deletes intentionally carry only a random event UUID, never a scope key.
  // Produce enough revisions to exercise pruning without a real-time timing assumption.
  for(let round=20;round<290;round++)data(await owner.c.from('session_state').update({round_number:round}).eq('session_id',s.id));
  const lastB=await snapshot(b,s.id);await received(bStream,lastB.revision);
  const remaining=data(await b.c.from('session_events').select('id'));
  ok(remaining.length===256 && !remaining.some(x=>x.id===bStream.inserts()[0].id),'retention actually removes old events and keeps 256');
  for(const stream of [...streams,reconnected])for(const e of stream.messages.filter(x=>x.eventType==='DELETE')){
    assert.deepEqual(Object.keys(e.old),['id']);assert.deepEqual(e.new,{});
  }
  ok(true,'any replication DELETE payload has no session/entity/private metadata');

  data(await owner.c.from('campaign_members').update({status:'revoked'}).eq('campaign_id',c.id).eq('user_id',b.id));
  await denied(b.c.rpc('get_session_snapshot',{p_session:s.id}),'42501','campaign revocation blocks current hydration');
  data(await owner.c.from('sessions').update({status:'closed'}).eq('id',s.id));
  ok((await snapshot(owner,s.id)).session.status==='closed','owner retains closed-session management read');
  console.log(`${checks} realtime/API security checks passed.`);
}finally{
  const failures=[];
  for(const c of clients)try{await c.removeAllChannels();}catch(e){failures.push(e);}
  for(const campaign of campaigns)try{data(await campaign.c.from('campaigns').delete().eq('id',campaign.id));}catch(e){failures.push(e);}
  for(const id of users)try{data(await admin.auth.admin.deleteUser(id));}catch(e){failures.push(e);}
  if(failures.length)throw new AggregateError(failures,'Realtime fixture cleanup failed');
}
