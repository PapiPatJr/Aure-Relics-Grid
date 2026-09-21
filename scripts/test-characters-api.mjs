// Local-only real Auth / PostgREST / Storage regression contract for issue #7.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
assert.match(readFileSync('supabase/config.toml','utf8'), /project_id = "aure-relics-v09-foundation"/);
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--output','json'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}));
assert.equal(status.API_URL,'http://127.0.0.1:56321','Refuse non-Aure or hosted stack');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const client=()=>createClient(status.API_URL,status.ANON_KEY,options);
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,options);
const users=[],campaigns=[],images=[],clients=[];
let checks=0;
function ok(value,label){assert.ok(value,label);checks++;console.log('PASS '+label);}
function data(result){if(result.error)throw new Error(result.error.message);return result.data;}
async function denied(result,label){ok(Boolean((await result).error),label);}
async function insert(c,table,row){return data(await c.from(table).insert(row).select().single());}
async function identity(permanent=false){
  const c=client();clients.push(c);let user;
  if(permanent){const email=`issue7-${crypto.randomUUID()}@example.test`,password=crypto.randomUUID()+'Aa1!';
    user=data(await admin.auth.admin.createUser({email,password,email_confirm:true})).user;users.push(user.id);
    data(await c.auth.signInWithPassword({email,password}));
  }else {user=data(await c.auth.signInAnonymously()).user;users.push(user.id);}
  return {c,id:user.id};
}
const fields={p_name:'  Hero  ',p_player_name:'  Player  ',p_hp:12,p_max_hp:20,p_temp_hp:0,p_ac:15,p_speed:30,p_statuses:['Inspired'],p_notes:'Shared notes'};
const rpc=(u,name,args)=>u.c.rpc(name,args);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
try{
  const dm=await identity(true),other=await identity(true),g=await identity(),g2=await identity(),pending=await identity();
  const campaign=await insert(dm.c,'campaigns',{owner_id:dm.id,name:'Character API A'});campaigns.push({id:campaign.id,c:dm.c});
  const foreign=await insert(other.c,'campaigns',{owner_id:other.id,name:'Character API B'});campaigns.push({id:foreign.id,c:other.c});
  const s=await insert(dm.c,'sessions',{campaign_id:campaign.id,name:'A'});
  const s2=await insert(dm.c,'sessions',{campaign_id:campaign.id,name:'A2'});
  const fs=await insert(other.c,'sessions',{campaign_id:foreign.id,name:'B'});
  const foreignCharacter=await insert(other.c,'characters',{campaign_id:foreign.id,name:'Foreign hero',approved:true});
  for(const u of [g,g2,pending]){
    await insert(dm.c,'campaign_members',{campaign_id:campaign.id,user_id:u.id,status:u===pending?'pending':'approved'});
    await insert(dm.c,'session_players',{campaign_id:campaign.id,session_id:s.id,user_id:u.id,status:u===pending?'pending':'approved',display_name:u===g?'Player One':'Player Two'});
  }
  const create={p_session:s.id,...fields};
  await denied(rpc(pending,'create_session_character',create),'pending session cannot submit');
  await denied(rpc(dm,'create_session_character',create),'unjoined DM cannot use participant submission');
  await denied(rpc(g,'create_session_character',{...create,p_session:fs.id}),'foreign session cannot submit');
  for(const invalid of [{p_name:' '},{p_name:'x'.repeat(81)},{p_player_name:''},{p_hp:-1000},{p_hp:10000},{p_max_hp:-1},{p_temp_hp:10000},{p_ac:100},{p_speed:1000},{p_statuses:Array(21).fill('x')},{p_statuses:['']},{p_statuses:['x'.repeat(61)]},{p_statuses:[null]},{p_notes:'x'.repeat(2001)},{p_hp:null}])
    await denied(rpc(g,'create_session_character',{...create,...invalid}),'invalid shared fields rejected '+Object.keys(invalid)[0]);
  const raced=await Promise.all([rpc(g,'create_session_character',create),rpc(g,'create_session_character',create)]);
  ok(raced.filter(r=>!r.error).length===1,'simultaneous submissions create exactly one assignment');
  const ch=data(raced.find(r=>!r.error));
  const panel=()=>rpc(g,'get_character_panel',{p_session:s.id});
  let p=data(await panel());
  ok(p.campaign_id===campaign.id,'empty and populated panels carry server-derived campaign scope');
  ok(p.own_character_id===ch && p.characters.length===1 && p.players.length===0,'guest panel contains only current own submission');
  assert.deepEqual(Object.keys(p.characters[0]).sort(),['id','campaign_id','name','player_name','approved','hp','max_hp','temp_hp','ac','speed','statuses','public_notes','image_path','created_at','updated_at','assignments'].sort());
  ok(p.characters[0].name==='Hero' && p.characters[0].player_name==='Player' && p.characters[0].approved===false,'creation trims names and stays pending');
  ok(data(await g.c.from('characters').select('id').eq('id',ch)).length===1,'own pending record readable');
  ok(data(await g2.c.from('characters').select('id').eq('id',ch)).length===0,'other guest cannot read pending record');
  await denied(rpc(pending,'get_character_panel',{p_session:s.id}),'pending membership cannot read panel');
  await denied(rpc(other,'get_character_panel',{p_session:s.id}),'foreign DM cannot read panel');
  await denied(client().rpc('get_character_panel',{p_session:s.id}),'bare anon cannot read panel');
  await denied(rpc(g,'review_character',{p_character:ch,p_approved:true}),'guest cannot self approve');
  await denied(rpc(other,'review_character',{p_character:ch,p_approved:true}),'foreign DM cannot approve character');
  await denied(rpc(g,'assign_character',{p_session:s.id,p_character:ch,p_user:g2.id}),'guest cannot assign');
  await denied(rpc(g,'issue_character_code',{p_character:ch}),'guest cannot issue code');
  await denied(g.c.schema('private').from('character_codes').select('*'),'codes not exposed');
  ok(data(await g.c.from('characters').update({approved:true}).eq('id',ch).select()).length===0,'guest direct update denied');
  const edit={...create,p_character:ch,p_hp:-1,p_notes:'Edited'};
  data(await rpc(g,'update_session_character',edit));
  const edited=data(await panel()).characters[0];
  ok(edited.hp===-1,'assigned pending guest can edit');
  ok(new Date(edited.updated_at)>new Date(edited.created_at),'shared edit advances update timestamp');
  await denied(rpc(g,'update_session_character',{...edit,p_notes:'x'.repeat(2001)}),'update applies shared field bounds too');
  await denied(rpc(g2,'update_session_character',edit),'other guest cannot edit');
  await denied(rpc(other,'update_session_character',edit),'foreign DM cannot edit');
  await denied(rpc(dm,'update_session_character',{...edit,p_session:fs.id}),'owner cannot use mismatched session');
  await denied(rpc(g,'set_character_image',{p_session:s.id,p_character:ch}),'image pointer requires actual canonical object');
  const path=`${campaign.id}/${ch}/portrait.png`;
  data(await g.c.storage.from('character-images').upload(path,png,{contentType:'image/png'}));images.push(path);
  data(await rpc(g,'set_character_image',{p_session:s.id,p_character:ch}));
  ok(data(await panel()).characters[0].image_path===path,'pending portrait saves stable canonical path');
  ok(Boolean(data(await g.c.storage.from('character-images').download(path))),'pending owner reads portrait');
  await denied(g2.c.storage.from('character-images').download(path),'pending portrait hidden from other guests');
  await denied(g.c.storage.from('character-images').upload(path,png,{contentType:'image/png',upsert:true}),'guest cannot replace portrait');
  await denied(rpc(g,'set_character_image',{p_session:s.id,p_character:ch}),'guest cannot reset existing portrait pointer');
  ok(data(await g.c.storage.from('character-images').remove([path])).length===0,'guest cannot delete portrait');
  await denied(other.c.storage.from('character-images').download(path),'foreign DM cannot read portrait');
  await denied(g.c.storage.from('character-images').upload(`${foreign.id}/${ch}/portrait.png`,png,{contentType:'image/png'}),'cross campaign portrait denied');
  await denied(g.c.storage.from('character-images').upload(`${campaign.id}/${ch}/second.png`,png,{contentType:'image/png'}),'noncanonical portrait denied');
  data(await rpc(dm,'review_character',{p_character:ch,p_approved:true}));
  ok(data(await g2.c.from('characters').select('id').eq('id',ch)).length===1,'approved assigned party character still visible');
  ok(Boolean(data(await g2.c.storage.from('character-images').download(path))),'approved party reads portrait');
  data(await dm.c.storage.from('character-images').upload(path,png,{contentType:'image/png',upsert:true}));
  data(await rpc(dm,'set_character_image',{p_session:s.id,p_character:ch}));ok(true,'DM replaces portrait and refreshes pointer');
  data(await dm.c.storage.from('character-images').remove([path]));
  await denied(g.c.storage.from('character-images').upload(path,png,{contentType:'image/png'}),'guest cannot refill deleted portrait after pointer has been set');
  data(await dm.c.storage.from('character-images').upload(path,png,{contentType:'image/png'}));
  ok(Boolean(data(await g.c.storage.from('character-images').download(path))),'DM can restore portrait after deleting its object');
  const dmPanel=data(await rpc(dm,'get_character_panel',{p_session:s.id}));
  ok(dmPanel.players.length===2 && dmPanel.characters[0].assignments[0].user_id===g.id,'DM panel provides effective assignment and approved recovery players');
  const code=data(await rpc(dm,'issue_character_code',{p_character:ch}));
  const ch2=data(await rpc(g2,'create_session_character',{...create,p_name:'Second'}));
  await denied(rpc(g2,'reclaim_character',{p_session:s.id,p_character:ch,p_code:code}),'reclaim cannot orphan different pending character');
  await denied(rpc(dm,'assign_character',{p_session:s.id,p_character:ch,p_user:pending.id}),'cannot assign pending membership');
  await denied(rpc(other,'assign_character',{p_session:s.id,p_character:ch,p_user:g.id}),'foreign DM cannot assign');
  await denied(rpc(dm,'assign_character',{p_session:s.id,p_character:foreignCharacter.id,p_user:g.id}),'owner cannot assign foreign campaign character');
  await denied(rpc(dm,'assign_character',{p_session:s.id,p_character:ch2,p_user:g.id}),'cannot assign pending character');
  data(await rpc(dm,'assign_character',{p_session:s.id,p_character:ch,p_user:g2.id}));
  ok(data(await panel()).own_character_id===null,'DM recovery clears previous controller');
  ok(data(await rpc(g2,'get_character_panel',{p_session:s.id})).own_character_id===ch,'DM recovery replaces target old assignment');
  await denied(rpc(g,'reclaim_character',{p_session:s.id,p_character:ch,p_code:code}),'DM recovery revokes old code');
  await denied(rpc(g,'update_session_character',edit),'prior controller cannot edit');
  await denied(g.c.storage.from('character-images').upload(path,png,{contentType:'image/png',upsert:true}),'prior controller cannot write portrait');
  const nextCode=data(await rpc(dm,'issue_character_code',{p_character:ch}));
  await denied(rpc(g,'reclaim_character',{p_session:s.id,p_character:ch2,p_code:nextCode}),'code is bound to its character');
  data(await rpc(g,'reclaim_character',{p_session:s.id,p_character:ch,p_code:nextCode}));
  data(await rpc(g,'reclaim_character',{p_session:s.id,p_character:ch,p_code:nextCode}));
  ok(data(await panel()).own_character_id===ch,'valid secret transfers existing controller and remains reusable');
  await insert(dm.c,'session_players',{campaign_id:campaign.id,session_id:s2.id,user_id:g.id,status:'approved'});
  await denied(rpc(g,'create_session_character',{...create,p_session:s2.id}),'existing campaign assignment blocks another session submission');
  data(await rpc(g,'reclaim_character',{p_session:s2.id,p_character:ch,p_code:nextCode}));
  ok(data(await panel()).own_character_id===null,'reclaim in another session clears earlier assignment');
  ok(data(await rpc(g,'get_character_panel',{p_session:s2.id})).characters[0].image_path===path,'portrait persists across session reclaim');
  data(await dm.c.from('sessions').update({status:'closed'}).eq('id',s.id));
  await denied(rpc(dm,'assign_character',{p_session:s.id,p_character:ch,p_user:g2.id}),'closed session cannot receive DM assignment');
  ok(Boolean(data(await g.c.storage.from('character-images').download(path))),'current controller reads stable portrait after old session closes');
  await denied(g2.c.storage.from('character-images').download(path),'closed old session withdraws portrait read');
  const revokeRace=await Promise.all([rpc(g,'reclaim_character',{p_session:s2.id,p_character:ch,p_code:nextCode}),rpc(dm,'revoke_character_code',{p_character:ch})]);
  data(revokeRace[1]);
  await denied(rpc(g,'reclaim_character',{p_session:s2.id,p_character:ch,p_code:nextCode}),'concurrent revoke wins for all subsequent reclaims');
  const reviewCode=data(await rpc(dm,'issue_character_code',{p_character:ch}));
  data(await rpc(dm,'review_character',{p_character:ch,p_approved:false}));
  data(await rpc(g,'update_session_character',{...edit,p_session:s2.id}));
  ok(data(await rpc(g,'get_character_panel',{p_session:s2.id})).characters[0].approved===false,'revoked approval retains current submission editing');
  await denied(rpc(g,'reclaim_character',{p_session:s2.id,p_character:ch,p_code:reviewCode}),'unapproved character cannot reclaim');
  data(await rpc(dm,'review_character',{p_character:ch,p_approved:true}));
  await denied(rpc(g,'reclaim_character',{p_session:s2.id,p_character:ch,p_code:reviewCode}),'reapproval does not resurrect revoked code');
  const approvalRace=await Promise.all([
    rpc(dm,'issue_character_code',{p_character:ch}),
    rpc(dm,'review_character',{p_character:ch,p_approved:false})
  ]);
  data(approvalRace[1]);
  data(await rpc(dm,'review_character',{p_character:ch,p_approved:true}));
  if(!approvalRace[0].error)await denied(rpc(g,'reclaim_character',{p_session:s2.id,p_character:ch,p_code:approvalRace[0].data}),'concurrent code issue cannot survive approval revocation');
  else ok(approvalRace[0].error.code==='42501','code issue observes concurrent approval revocation');
  await insert(dm.c,'session_players',{campaign_id:campaign.id,session_id:s2.id,user_id:g2.id,status:'approved'});
  const recoveryCode=data(await rpc(dm,'issue_character_code',{p_character:ch}));
  const assignmentRace=await Promise.all([
    rpc(g,'reclaim_character',{p_session:s2.id,p_character:ch,p_code:recoveryCode}),
    rpc(dm,'assign_character',{p_session:s2.id,p_character:ch,p_user:g2.id})
  ]);
  data(assignmentRace[1]);
  const assignments=data(await dm.c.from('session_players').select('user_id').eq('character_id',ch));
  ok(assignments.length===1 && assignments[0].user_id===g2.id,'concurrent recovery leaves exactly the DM-selected controller');
  await denied(rpc(g,'reclaim_character',{p_session:s2.id,p_character:ch,p_code:recoveryCode}),'recovery race permanently revokes previous code');
  const finalCode=data(await rpc(dm,'issue_character_code',{p_character:ch}));
  data(await rpc(g,'reclaim_character',{p_session:s2.id,p_character:ch,p_code:finalCode}));
  data(await dm.c.from('campaign_members').update({status:'revoked'}).eq('campaign_id',campaign.id).eq('user_id',g.id));
  await denied(rpc(g,'get_character_panel',{p_session:s2.id}),'membership revocation withdraws panel');
  await denied(rpc(g,'update_session_character',{...edit,p_session:s2.id}),'membership revocation withdraws edits');
  await denied(g.c.storage.from('character-images').download(path),'membership revocation withdraws stable portrait');
  // A permanent account can own campaign B and participate in campaign A.
  await insert(dm.c,'campaign_members',{campaign_id:campaign.id,user_id:other.id,status:'approved'});
  await insert(dm.c,'session_players',{campaign_id:campaign.id,session_id:s2.id,user_id:other.id,status:'approved'});
  const registeredCreate=await rpc(other,'create_session_character',{...create,p_session:s2.id,p_name:'Registered hero'});
  ok(!registeredCreate.error,'registered approved participant can submit in another owner campaign');
  const registeredCharacter=data(registeredCreate);
  data(await rpc(other,'update_session_character',{...edit,p_session:s2.id,p_character:registeredCharacter,p_name:'Registered edit'}));
  ok(data(await rpc(other,'get_character_panel',{p_session:s2.id})).characters[0].name==='Registered edit','registered participant edits own pending character');
  await denied(rpc(other,'review_character',{p_character:registeredCharacter,p_approved:true}),'campaign ownership elsewhere does not grant character review');
  await denied(rpc(other,'issue_character_code',{p_character:registeredCharacter}),'campaign ownership elsewhere does not grant code issuance');
  await denied(rpc(other,'assign_character',{p_session:s2.id,p_character:ch,p_user:other.id}),'campaign ownership elsewhere does not grant assignment');
  const registeredPath=`${campaign.id}/${registeredCharacter}/portrait.png`;
  data(await other.c.storage.from('character-images').upload(registeredPath,png,{contentType:'image/png'}));images.push(registeredPath);
  data(await rpc(other,'set_character_image',{p_session:s2.id,p_character:registeredCharacter}));
  ok(Boolean(data(await other.c.storage.from('character-images').download(registeredPath))),'registered assigned participant uploads and reads portrait');
  await denied(other.c.storage.from('character-images').upload(registeredPath,png,{contentType:'image/png',upsert:true}),'registered participant cannot replace portrait in another owner campaign');
  data(await rpc(dm,'review_character',{p_character:registeredCharacter,p_approved:true}));
  const registeredCode=data(await rpc(dm,'issue_character_code',{p_character:registeredCharacter}));
  data(await rpc(other,'reclaim_character',{p_session:s2.id,p_character:registeredCharacter,p_code:registeredCode}));
  ok(data(await rpc(other,'get_character_panel',{p_session:s2.id})).own_character_id===registeredCharacter,'registered approved participant can reclaim');
  ok(data(await rpc(other,'get_character_panel',{p_session:fs.id})).characters[0].id===foreignCharacter.id,'same account retains ownership of its own campaign');
  console.log(`${checks} character API checks passed.`);
}finally{
  const errors=[];const clean=async(fn)=>{try{data(await fn());}catch(e){errors.push(e);}};
  if(images.length)await clean(()=>admin.storage.from('character-images').remove(images));
  for(const {id,c} of campaigns)await clean(()=>c.from('campaigns').delete().eq('id',id));
  for(const c of clients)await clean(()=>c.auth.signOut());
  for(const id of users)await clean(()=>admin.auth.admin.deleteUser(id));
  if(errors.length)throw new AggregateError(errors,'Character fixture cleanup failed');
}
