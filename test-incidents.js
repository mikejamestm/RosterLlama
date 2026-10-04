const assert=require('node:assert/strict'),database=require('./database'),{createOperations}=require('./operations');
const suffix=Date.now(),org='incident_org_'+suffix,other='incident_other_'+suffix,staff='incident_staff_'+suffix,manager='incident_manager_'+suffix,family='incident_family_'+suffix,foreign='incident_foreign_'+suffix,child='incident_child_'+suffix,program='incident_program_'+suffix,session='incident_session_'+suffix,session2='incident_second_'+suffix;
let serial=0;
async function call(path,method='GET',payload={},role='owner'){
 const a={org:{id:role==='otherowner'?other:org},role:role==='otherowner'?'owner':role,...(['owner','otherowner'].includes(role)?{owner:{id:'owner_test'}}:{staff:{id:role==='manager'?manager:staff}})};
 let response;const ops=createOperations({database,ready:()=>true,id:p=>p+'_'+suffix+'_'+(++serial),json:(r,status,body)=>response={status,body},body:async()=>payload,requireAuth:()=>role==='anonymous'?null:a,familySession:()=>role==='family'?{family_id:family}:role==='foreign'?{family_id:foreign}:null});
 await ops.handle({method},{},new URL('https://example.test'+path),{});return response;
}
const reports='/api/operations/incidents',familyReports='/api/family/incidents';
(async()=>{if(!process.env.CI&&process.env.ALLOW_INTEGRATION_TESTS!=='true')throw Error('Use a disposable test database');await database.migrate();
try{
 await database.withTransaction(async c=>{
  await c.query('insert into organizations(id,name,slug) values($1,$1,$1),($2,$2,$2)',[org,other]);
  await c.query("insert into staff(id,organization_id,email,role,status) values($1,$3,$1,'staff','active'),($2,$3,$2,'manager','active')",[staff,manager,org]);
  await c.query('insert into families(id,organization_id,name,email) values($1,$3,$1,$1),($2,$4,$2,$2)',[family,foreign,org,other]);
  await c.query('insert into participants(id,family_id,name) values($1,$2,$1)',[child,family]);
  await c.query('insert into programs(id,organization_id,name) values($1,$2,$1)',[program,org]);
  await c.query("insert into sessions(id,program_id,label,status,capacity) values($1,$3,$1,'open',10),($2,$3,$2,'open',10)",[session,session2,program]);
  await c.query("insert into registrations(id,organization_id,session_id,participant_id,status) values($1,$2,$3,$4,'enrolled')",['incident_reg_'+suffix,org,session,child]);
 });
 const fields={session_id:session,participant_id:child,occurred_at:new Date(Date.now()-60000).toISOString(),kind:'injury',title:'Minor fall',description:'Participant tripped.',actions_taken:'Staff checked in and contacted guardian.',internal_notes:'PRIVATE WITNESS NAME'};
 assert.equal((await call(reports,'POST',{...fields,session_id:session2},'staff')).status,403);
 assert.equal((await call(reports,'POST',{...fields,occurred_at:'2099-01-01'},'staff')).status,400);
 let r=await call(reports,'POST',fields,'staff');assert.equal(r.status,201);const id=r.body.id,url=reports+'/'+id;
 assert.deepEqual((await call(familyReports,'GET',{},'family')).body.incidents,[],'Draft must stay private');assert.equal((await call(reports,'GET',{},'otherowner')).body.incidents.length,0);assert.equal((await call(url+'/submit','POST',{version:1},'otherowner')).status,404);assert.equal((await call('/api/family/incidents','GET')).status,401);
 assert.equal((await call(url,'PATCH',{...fields,version:1},'manager')).status,200);
 assert.equal((await call(url,'PATCH',{...fields,version:1},'staff')).status,409);
 assert.equal((await call(url+'/submit','POST',{version:2},'staff')).status,200);
 assert.equal((await call(url+'/approve','POST',{version:3},'staff')).status,403);
 assert.deepEqual((await call(familyReports,'GET',{},'family')).body.incidents,[],'Submitted reports must stay private');
 assert.equal((await call(url+'/return','POST',{version:3,note:'Add timing'},'manager')).status,200);
 assert.equal((await call(url+'/submit','POST',{version:4},'staff')).status,200);
 const approvals=await Promise.all([call(url+'/approve','POST',{version:5},'manager'),call(url+'/approve','POST',{version:5},'manager')]);assert.deepEqual(approvals.map(x=>x.status).sort(),[200,409]);
 assert.equal((await call(url,'PATCH',{...fields,version:6},'manager')).status,409,'Approved report must be locked');
 const shared=(await call(familyReports,'GET',{},'family')).body.incidents[0];assert.equal(shared.version,6);assert.ok(!JSON.stringify(shared).includes('PRIVATE'));for(const key of ['internal_notes','author_id','reviewer_id','notification_note'])assert.ok(!(key in shared));
 assert.deepEqual((await call(familyReports,'GET',{},'foreign')).body.incidents,[]);
 const ack=familyReports+'/'+id+'/acknowledge';assert.equal((await call(ack,'POST',{version:6,name:'Other Guardian',agree:true},'foreign')).status,404);
 assert.equal((await call(ack,'POST',{version:5,name:'Guardian',agree:true},'family')).status,409);
 assert.equal((await call(ack,'POST',{version:6,name:'Guardian',agree:false},'family')).status,400);
 for(let i=0;i<2;i++)assert.equal((await call(ack,'POST',{version:6,name:'Guardian',agree:true},'family')).status,200);
 assert.equal((await call(url+'/notify','POST',{version:6,note:'Phone call, guardian confirmed receipt'},'manager')).status,200);
 assert.equal((await call(url+'/addendum','POST',{version:6,text:'Correction: occurred at 10:15.'},'manager')).status,200);
 const updated=(await call(familyReports,'GET',{},'family')).body.incidents[0];assert.equal(updated.version,7);assert.equal(updated.acknowledged_at,null);assert.equal(updated.addenda.length,1);assert.equal(updated.description,fields.description);
 assert.equal((await call(ack,'POST',{version:6,name:'Guardian',agree:true},'family')).status,409);
 assert.equal((await call(ack,'POST',{version:7,name:'Guardian',agree:true},'family')).status,200);
 assert.equal((await call(reports+'?program=foreign')).body.incidents.length,0);assert.equal((await call(reports+'?session='+session2)).body.incidents.length,0);assert.equal((await call(reports+'?program='+program+'&session='+session)).body.incidents.length,1);
 await database.withTransaction(c=>c.query("update staff set role='staff' where id=$1",[manager]));assert.equal((await call(url+'/addendum','POST',{version:7,text:'Denied'},'manager')).status,403,'Use current database role');
 await database.withTransaction(c=>c.query("update staff set status='inactive' where id=$1",[staff]));assert.equal((await call(reports,'GET',{},'staff')).status,403);
 const audits=await database.withTransaction(c=>c.query("select action,count(*)::int n from audit_log where organization_id=$1 group by action",[org]));assert.equal(audits.rows.find(a=>a.action==='incident.acknowledged').n,2);assert.ok(audits.rows.some(a=>a.action==='incident.addendum'));
 console.log('Incident workflow, private drafts, family isolation, current roles, corrections, idempotency and concurrency passed');
}finally{await database.withTransaction(async c=>{await c.query('delete from incident_reports where organization_id=$1',[org]);await c.query('delete from registrations where organization_id=$1',[org]);await c.query('delete from participants where id=$1',[child]);await c.query('delete from organizations where id=any($1::text[])',[[org,other]])});await database.close()}
})().catch(e=>{console.error(e);process.exit(1)});

