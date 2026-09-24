// Deterministic PostgreSQL overlap: no scheduling sleep is used as a lock barrier.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {localTestStack} from './local-test-stack.mjs';
localTestStack(); // Enforce fixed local project and URL before invoking local Docker.
const container=process.env.AURE_TEST_STACK==='08a'?'supabase_db_aure-relics-08a-security':'supabase_db_aure-relics-v09-foundation';
function connection(){
  const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],
    {windowsHide:true,stdio:['pipe','pipe','pipe']});
  let buffer='',errors='',active=null;
  child.stdout.on('data',chunk=>{
    buffer+=chunk.toString();
    if(active && buffer.includes(active.marker)){
      const {resolve,marker,timer}=active;active=null;clearTimeout(timer);
      const [result,rest]=buffer.split(marker);buffer=rest.trimStart();resolve(result.trim());
    }
  });
  child.stderr.on('data',chunk=>{errors+=chunk.toString();});
  child.on('error',error=>{if(active){clearTimeout(active.timer);active.reject(error);active=null;}});
  child.on('exit',code=>{if(active){clearTimeout(active.timer);active.reject(new Error(`psql exited ${code}: ${errors}`));active=null;}});
  return {
    query(sql){
      assert.equal(active,null,'one query per connection');
      const marker='done_'+crypto.randomUUID();
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{active=null;reject(new Error('psql barrier timeout: '+errors));},20000);
        active={marker,resolve,reject,timer};child.stdin.write(sql+'\n\\echo '+marker+'\n');
      });
    },
    async close(){child.stdin.end('rollback;\n\\q\n');}
  };
}
const a=connection(),b=connection(),observer=connection();
const owner=crypto.randomUUID(),player=crypto.randomUUID(),campaign=crypto.randomUUID(),session=crypto.randomUUID();
const app='8a-race-'+crypto.randomUUID();
let setup=false;
try{
  await observer.query(`begin;
    insert into auth.users(id,is_anonymous) values('${owner}',false),('${player}',true);
    insert into public.campaigns(id,owner_id,name) values('${campaign}','${owner}','8A race');
    insert into public.sessions(id,campaign_id,name,status) values('${session}','${campaign}','Race','active');
    insert into public.session_state(session_id,campaign_id,round_number) values('${session}','${campaign}',1);
    insert into public.campaign_members(campaign_id,user_id,status) values('${campaign}','${player}','approved');
    insert into public.session_players(campaign_id,session_id,user_id,status) values('${campaign}','${session}','${player}','pending');
    commit;`);setup=true;
  await b.query(`set application_name='${app}';`);
  const grantedRevision=await a.query(`begin;
    update public.session_players set status='approved' where session_id='${session}' and user_id='${player}';
    select revision from private.session_sync where session_id='${session}' and user_id='${player}';`);
  // This legacy write enumerates recipients while the approval is still uncommitted.
  const pending=b.query(`begin; update public.session_state set round_number=2 where session_id='${session}'; commit;`);
  // Attach a rejection handler immediately while the observer checks lock metadata.
  pending.catch(()=>{});
  const end=Date.now()+10000;
  while(await observer.query(`select exists(select 1 from pg_stat_activity where application_name='${app}' and wait_event_type='Lock');`)!=='t'){
    assert.ok(Date.now()<end,'legacy writer must be blocked before approval commits');await delay(20);
  }
  await a.query('commit;');
  await pending;
  const current=JSON.parse(await observer.query(`set role authenticated;
    select set_config('request.jwt.claims','{"sub":"${player}","role":"authenticated"}',false) is not null;
    select public.get_session_snapshot('${session}');
    reset role;`).then(output=>output.split('\n').at(-1)));
  assert.equal(current.roundNumber,2);
  assert.ok(BigInt(current.revision)>BigInt(grantedRevision),'concurrent approval followed by legacy write advances new recipient watermark');
  const notified=await observer.query(`select exists(select 1 from public.session_events e
    join private.session_event_access x on x.event_id=e.id where e.session_id='${session}'
    and x.user_id='${player}' and e.revision='${current.revision}');`);
  assert.equal(notified,'t','new recipient has an invalidation for the overlapping legacy write');
  console.log('PASS deterministic concurrent enrollment/legacy-write watermark and notification');
}finally{
  await a.close();await b.close();
  if(setup)await observer.query(`reset role; delete from public.campaigns where id='${campaign}'; delete from auth.users where id in ('${owner}','${player}');`);
  await observer.close();
}
