const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const database=require('./database');
const {hashPassword}=require('./security');
const {createWorkflows,isAuthorizedAdult,isLate,eligibleAge}=require('./workflows');
const base='http://127.0.0.1:4200';
const suffix=Date.now().toString(),oid='workflow_'+suffix,fid='family_'+suffix,pid='participant_'+suffix,sid='session_'+suffix,other='other_'+suffix,prog='program_'+suffix,wait='wait_'+suffix;
async function request(path,body,cookie,method){const r=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function waitReady(){for(let i=0;i<120;i++){try{if((await fetch(base+'/health')).status===200)return}catch{}await new Promise(r=>setTimeout(r,500))}throw Error('Workflow server did not become ready')}
async function billingTests(){
  const checkout=new Map(),calls=[],subs=new Map();let n=0,response;
  const ctx={database,ready:()=>true,json:(res,status,body)=>{response={status,body}},body:async r=>r.payload||{},cookies:()=>({}),requireRole:()=>({owner:{id:'owner_'+suffix,email:'workflow@test.local'},org:{id:oid,name:'Workflow Test'}}),requireAuth:()=>null,id:p=>p+'_'+(++n),dateInZone:()=>new Date().toISOString().slice(0,10),stripeRequest:async(path,params,opt)=>{calls.push({path,params,opt});if(path==='/v1/customers')return {id:'cus_'+suffix};if(path==='/v1/checkout/sessions'){const c={id:'cs_'+suffix,status:'open',url:'https://checkout.stripe.com/test'};checkout.set(c.id,c);return c}return {url:'https://billing.stripe.com/test'}},stripeGet:async path=>path.includes('checkout')?checkout.get(path.split('/').pop()):subs.get(path.split('/').pop())};
  const workflows=createWorkflows(ctx),saved={...process.env};
  process.env.STRIPE_SECRET_KEY='test-only';process.env.STRIPE_SUBSCRIPTION_PRICE_ID='price_test';process.env.STRIPE_WEBHOOK_SECRET='test-webhook';process.env.PUBLIC_BASE_URL='https://example.test';
  const call=async(path,method='POST')=>{await workflows.handle({method,headers:{},socket:{}},{},new URL('https://example.test'+path),{});return response};
  try{
    const [a,b]=await Promise.all([call('/api/billing/subscription/start'),call('/api/billing/subscription/start')]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(calls.filter(c=>c.path==='/v1/checkout/sessions').length,1,'Concurrent checkout must reuse one session');
    assert.equal(calls.find(c=>c.path==='/v1/checkout/sessions').params.mode,'subscription');assert.equal(calls.find(c=>c.path==='/v1/checkout/sessions').opt.account,undefined);
    const sub={object:'subscription',id:'sub_'+suffix,customer:'cus_'+suffix,metadata:{organization_id:oid},status:'active',cancel_at_period_end:false,items:{data:[{current_period_end:2000000000}]}};subs.set(sub.id,sub);
    const event={id:'evt_'+suffix,type:'customer.subscription.created',created:100,data:{object:sub}};
    await workflows.webhook(event);await workflows.webhook(event);let status=await call('/api/billing/subscription','GET');assert.equal(status.body.status,'active');assert.ok(status.body.current_period_end);
    assert.equal((await call('/api/billing/subscription/start')).status,409);
    assert.equal((await call('/api/billing/subscription/portal')).body.portal_url,'https://billing.stripe.com/test');
    // Old payload delivered later must read current status from Stripe, not restore active.
    subs.set(sub.id,{...sub,status:'past_due'});await workflows.webhook({...event,id:'evt_old_'+suffix,created:99});status=await call('/api/billing/subscription','GET');assert.equal(status.body.status,'past_due');
    await assert.rejects(workflows.webhook({...event,id:'evt_bad_'+suffix,data:{object:{...sub,customer:'cus_another'}}}),/customer does not match/);
    const count=await database.withTransaction(c=>c.query('select count(*)::int as n from platform_billing_events where organization_id=$1',[oid]));assert.equal(count.rows[0].n,2);
  }finally{for(const key of ['STRIPE_SECRET_KEY','STRIPE_SUBSCRIPTION_PRICE_ID','STRIPE_WEBHOOK_SECRET','PUBLIC_BASE_URL']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key]}}
}
(async()=>{
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
  if(!process.env.CI&&process.env.ALLOW_INTEGRATION_TESTS!=='true')throw Error('Use a disposable database with ALLOW_INTEGRATION_TESTS=true');
  assert.ok(isAuthorizedAdult({authorized_pickups:[{name:'Alex Jones'}]},'Guardian',' alex   jones '));assert.ok(!isAuthorizedAdult({authorized_pickups:[]},'', 'Unknown'));assert.ok(isAuthorizedAdult({authorized_pickups:[]},'Guardian','Guardian'));
  assert.ok(isLate({end_time:'15:00'},'America/Los_Angeles',new Date('2026-07-01T23:01:00Z')));assert.ok(!isLate({end_time:'15:00'},'America/Los_Angeles',new Date('2026-07-01T21:01:00Z')));
  assert.ok(eligibleAge({birth_date:'2018-07-10'},{age_min:8},{start_date:'2026-07-10'}));assert.ok(!eligibleAge({birth_date:'2018-07-10'},{age_min:8},{start_date:'2026-07-09'}));assert.ok(!eligibleAge({age:''},{age_min:8},{}));
  await database.migrate();
  await database.withTransaction(async c=>{
    await c.query("insert into organizations(id,name,slug,timezone) values($1,'Workflow Test',$1,'America/Los_Angeles')",[oid]);
    await c.query("insert into owners(id,organization_id,email,password_hash,name) values($1,$2,$3,$4,'Owner')",['owner_'+suffix,oid,'owner-'+suffix+'@test.local',hashPassword('StrongPass123!')]);
    await c.query("insert into families(id,organization_id,name,email,password_hash) values($1,$2,'Guardian',$3,$4)",[fid,oid,'family-'+suffix+'@test.local',hashPassword('StrongPass123!')]);
    await c.query("insert into participants(id,family_id,name,age,allergies,authorized_pickups) values($1,$2,'Test Participant','8','SECRET MEDICAL',$3::jsonb)",[pid,fid,JSON.stringify([{name:'Alex Jones'}])]);
    await c.query("insert into programs(id,organization_id,name,age_min) values($1,$2,'Workflow Program',null)",[prog,oid]);
    await c.query("insert into sessions(id,program_id,label,capacity,status,end_time) values($1,$3,'First',5,'open','00:00'),($2,$3,'Second',5,'open','00:00')",[sid,other,prog]);
    await c.query("insert into registrations(id,organization_id,session_id,participant_id,status,payment_status) values($1,$2,$3,$4,'enrolled','not_required')",['reg_'+suffix,oid,sid,pid]);
    await c.query("insert into waitlist(id,organization_id,session_id,participant_id,status,offer_expires_at,amount_due,waiver_title,waiver_text,waiver_accepted_at) values($1,$2,$3,$4,'offered',now()+interval '1 hour',0,'Waiver','Original waiver',now())",[wait,oid,other,pid]);
  });
  const p=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:'4200',SESSION_SECRET:'workflow-tests-secret-at-least-32-characters'},stdio:'inherit'});
  try{
    await waitReady();
    let r=await request('/api/login',{email:'owner-'+suffix+'@test.local',password:'StrongPass123!'});assert.equal(r.status,200);const owner=r.cookie;
    assert.equal((await request('/api/kiosk/me')).status,401);
    assert.equal((await request('/api/kiosk/devices',{session_ids:['sess_june']},owner)).status,403,'Cross-organization sessions denied');
    r=await request('/api/kiosk/devices',{session_ids:[sid]},owner);assert.equal(r.status,201);const token=r.body.url.split('token=')[1];
    assert.equal((await request('/api/kiosk/activate',{token:'bad'})).status,401);
    r=await request('/api/kiosk/activate',{token});assert.equal(r.status,200);const kiosk=r.cookie;assert.match(kiosk,/rl_kiosk=/);
    assert.equal((await request('/api/me',null,kiosk)).status,401,'Kiosk cannot use staff APIs');
    assert.equal((await request('/api/kiosk/me',null,kiosk)).body.participants.length,0,'Only checked-in participants shown');
    assert.equal((await request('/api/attendance/'+pid,{action:'checkin',session_id:sid},owner)).status,201);
    r=await request('/api/kiosk/me',null,kiosk);assert.equal(r.body.participants.length,1);assert.ok(!JSON.stringify(r.body).includes('SECRET MEDICAL'));assert.deepEqual(Object.keys(r.body.participants[0]).sort(),['label','name','participant_id','program_name','session_id']);
    assert.equal((await request('/api/kiosk/signouts',{participant_id:pid,session_id:other,adult:'Alex Jones',initials:'AJ'},kiosk)).status,403);
    assert.equal((await request('/api/kiosk/signouts',{participant_id:pid,session_id:sid,adult:'Unknown',initials:'UU'},kiosk)).status,403);
    const attempt=()=>request('/api/kiosk/signouts',{participant_id:pid,session_id:sid,adult:' alex jones ',initials:'AJ'},kiosk);
    const responses=await Promise.all([attempt(),attempt()]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
    assert.equal((await request('/api/kiosk/me',null,kiosk)).body.participants.length,0);
    const rows=await database.withTransaction(c=>c.query('select * from signouts where organization_id=$1',[oid]));assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].initials,'AJ');assert.equal(rows.rows[0].authorized,true);assert.equal(rows.rows[0].late,true);
    assert.equal((await request('/api/kiosk/devices/revoke',{},owner)).status,200);assert.equal((await request('/api/kiosk/me',null,kiosk)).status,401);
    r=await request('/api/family/login',{email:'family-'+suffix+'@test.local',password:'StrongPass123!'});assert.equal(r.status,200);
    const family=r.cookie;r=await request('/api/family/waitlist/'+wait+'/accept',{},family);assert.equal(r.status,200);assert.equal(r.body.registration.payment_status,'not_required');assert.equal(r.body.registration.waiver_text,'Original waiver');assert.equal((await request('/api/family/waitlist/'+wait+'/accept',{},family)).status,409);
    r=await request('/api/programs/'+prog,{waitlist_offer_hours:6,name:'Updated Workflow'},owner,'PATCH');assert.equal(r.status,200);assert.equal(r.body.waitlist_offer_hours,6);
    assert.equal((await request('/api/programs/'+prog,{waitlist_offer_hours:0},owner,'PATCH')).status,400);
    // A session with an enrollment and a reserved offer cannot shrink to one spot.
    await database.withTransaction(c=>c.query("insert into waitlist(id,organization_id,session_id,participant_id,status,offer_expires_at) values($1,$2,$3,$4,'offered',now()+interval '1 hour')",['reserved_'+suffix,oid,sid,pid]));
    r=await request('/api/sessions/'+sid,{capacity:1},owner,'PATCH');assert.equal(r.status,409);assert.match(r.body.error,/reserved offers/);
    r=await request('/api/sessions/'+sid,{capacity:3,start_time:'09:00',end_time:'16:00'},owner,'PATCH');assert.equal(r.status,200);assert.equal(r.body.end_time,'16:00');
    await database.withTransaction(c=>c.query('update programs set age_min=12 where id=$1',[prog]));
    r=await request('/api/registrations/reg_'+suffix+'/transfer',{target_session_id:other},owner);assert.equal(r.status,409);assert.match(r.body.error,/age requirements/);
    await billingTests();console.log('RosterLlama pickup, family waitlist, transfer eligibility and subscription workflow tests passed');
  }finally{p.kill();await database.getPool().end()}
})().catch(e=>{console.error(e);process.exitCode=1;database.getPool()?.end()});
