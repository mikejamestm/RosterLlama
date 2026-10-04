const assert=require('node:assert/strict'),database=require('./database'),{createOperations}=require('./operations');
const suffix=Date.now(),org='schedule_org_'+suffix,other='schedule_other_'+suffix,staff1='schedule_staff1_'+suffix,staff2='schedule_staff2_'+suffix,manager='schedule_manager_'+suffix,program='schedule_prog_'+suffix,program2='schedule_prog2_'+suffix,foreignProgram='schedule_foreign_prog_'+suffix,session='schedule_sess_'+suffix,session2='schedule_sess2_'+suffix,foreignSession='schedule_foreign_sess_'+suffix,family='schedule_family_'+suffix,child='schedule_child_'+suffix;let n=0;
const tz='America/Los_Angeles',formatDate=d=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const add=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10),today=formatDate(new Date()),day=add(today,2),next=add(today,3);
async function call(path,method='GET',payload={},identity='staff'){
 const isOwner=['owner','otherowner'].includes(identity),actorId=identity==='owner'?'owner_'+suffix:identity==='otherowner'?'otherowner_'+suffix:identity==='manager'?manager:identity==='staff2'?staff2:staff1;
 const actor={org:{id:identity==='otherowner'?other:org,timezone:tz},role:isOwner?'owner':identity==='manager'?'manager':'staff',...(isOwner?{owner:{id:actorId}}:{staff:{id:actorId}})};let response;
 const ops=createOperations({database,ready:()=>true,id:p=>p+'_'+suffix+'_'+(++n),json:(r,status,body)=>response={status,body},body:async()=>payload,requireAuth:()=>actor,familySession:()=>null,dateInZone:()=>today});
 await ops.handle({method},{writeHead:status=>response={status},end:s=>{response.body=s}},new URL('https://test.invalid/api/operations/'+path),{});return response;
}
const creation=(sessionId,staffId,date=day,start='10:00',end='12:00')=>({session_id:sessionId,staff_id:staffId,date,start_time:start,end_time:end});
const list=(prog=program,sid='',date=day,identity='manager')=>call('schedule?'+new URLSearchParams({program:prog,...(sid?{session:sid}:{}),date}),'GET',{},identity);
(async()=>{if(!process.env.CI&&process.env.ALLOW_INTEGRATION_TESTS!=='true')throw Error('Use a disposable test database');await database.migrate();
try{
 await database.withTransaction(async c=>{
  await c.query('insert into organizations(id,name,slug,timezone) values($1,$1,$1,$3),($2,$2,$2,$3)',[org,other,tz]);
  await c.query("insert into owners(id,organization_id,name,email,password_hash) values($1,$3,'Owner',$1,'x'),($2,$3,'Other owner',$2,'x')",['owner_'+suffix,'otherowner_'+suffix,org]);
  await c.query("insert into staff(id,organization_id,name,email,role,status) values($1,$3,'Avery Chen',$1,'staff','active'),($2,$3,'Bailey Singh',$2,'staff','active'),($4,$3,'Manager',$4,'manager','active'),($5,$6,'Foreign Staff',$5,'staff','active')",[staff1,staff2,org,manager,'foreignstaff_'+suffix,other]);
  await c.query('insert into programs(id,organization_id,name) values($1,$3,$1),($2,$3,$2),($4,$5,$4)',[program,program2,org,foreignProgram,other]);
  await c.query("insert into sessions(id,program_id,label,capacity,status) values($1,$3,'Bay morning',12,'open'),($2,$3,'Bay afternoon',12,'open'),($4,$5,'Foreign',12,'open')",[session,session2,program,foreignSession,foreignProgram]);
  await c.query('insert into families(id,organization_id,name,email) values($1,$2,$1,$1)',[family,org]);await c.query('insert into participants(id,family_id,name) values($1,$2,$1)',[child,family]);
 });
 assert.equal((await call('schedule','GET')).status,400,'Require explicit program');assert.equal((await list(program,foreignSession)).status,403,'Session must match selected program');assert.equal((await list(program,session,'2099-01-01','otherowner')).status,404,'Keep schedule organization scoped');
 assert.equal((await call('schedule','POST',creation(session,staff1),'staff')).status,403,'Staff cannot edit schedule');
 assert.equal((await call('schedule','POST',creation(session,'foreignstaff_'+suffix),'manager')).status,400,'Do not assign outside-organization staff');
 assert.equal((await call('schedule','POST',creation(session,staff1,today,'09:00','11:00'))).status,400,'Do not create a shift in the past');
 assert.equal((await call('schedule','POST',creation(session,staff1,day,'10:00','09:00'))).status,400);
 assert.equal((await call('schedule','POST',creation(session,staff1,'2026-03-08','02:30','03:30'))).status,400,'Reject nonexistent spring daylight-saving time');
 const made=await call('schedule','POST',creation(session,staff1));assert.equal(made.status,201);const id=made.body.id;let records=(await list()).body;assert.equal(records.assignments.length,1);assert.equal(records.assignments[0].start_time,'10:00');assert.equal(records.assignments[0].schedule_date,day);assert.deepEqual(records.staff_options.map(s=>s.id).sort(),[staff1,staff2,manager].sort());
 assert.equal((await call('schedule','POST',creation(session2,staff1,day,'11:00','13:00'))).status,409,'Reject overlapping sessions for same staff');
 const adjacent=await call('schedule','POST',creation(session2,staff1,day,'12:00','13:00'));assert.equal(adjacent.status,201,'Adjacent shifts may follow one another');
 assert.equal((await list(program,session)).body.assignments.length,1);assert.equal((await list(program)).body.assignments.length,2);assert.equal((await list(program,session,day,'staff')).body.assignments.length,1);assert.equal((await list(program,session,day,'staff2')).body.assignments.length,0,'Staff sees own shifts only');assert.deepEqual((await list(program,session,day,'staff')).body.staff_options,[]);
 assert.equal((await list(program,session,day,'foreign')).status,404);assert.equal((await call('schedule','POST',creation(session,staff1,day,'10:30','10:45'))).status,409,'Reject duplicate overlap');
 const changed={...creation(session,staff2,day,'10:00','12:00'),version:1};assert.equal((await call('schedule/'+id,'PATCH',{...changed,staff_id:staff1,start_time:'13:00',end_time:'14:00'},'staff')).status,403);assert.equal((await call('schedule/'+id,'PATCH',{...changed,version:99})).status,409,'Check schedule version');
 assert.equal((await call('schedule/'+id,'PATCH',changed)).status,200);records=(await list()).body;assert.equal(records.assignments.find(a=>a.id===id).staff_id,staff2);assert.equal(records.assignments.length,2);
 assert.equal((await call('schedule/'+id,'PATCH',{version:2,date:day,staff_id:staff1,session_id:session2,start_time:'12:30',end_time:'13:30'})).status,409,'Do not move schedule into an overlapping shift');
 assert.equal((await call('schedule/'+id,'DELETE',{version:2},'staff')).status,403);assert.equal((await call('schedule/'+id,'DELETE',{version:99},'manager')).status,409);
 assert.equal((await call('schedule/'+id,'DELETE',{version:2},'manager')).status,200);assert.equal((await list()).body.assignments.length,1,'Cancellation leaves an audit record and frees the time');
 await database.withTransaction(async c=>{const now=new Date();const end=new Date(now.getTime()+3600000);await c.query("insert into staff_assignments(id,organization_id,staff_id,session_id,start_at,end_at,status,created_by) values($1,$2,$3,$4,$5,$6,'scheduled',$7)",['schedule_live_'+suffix,org,staff1,session,new Date(now.getTime()-60000),end,manager]);await c.query('update programs set ratio_target=8 where id=$1',[program]);await c.query("insert into attendance(id,organization_id,session_id,participant_id,action,service_date) values($1,$2,$3,$4,'checkin',$5)",['schedule_att_'+suffix,org,session,child,today])});
 const ratio=(await call('ratios?program='+program,'GET',{},'manager')).body.sessions.find(s=>s.id===session);assert.equal(ratio.present,1);assert.equal(ratio.working_staff,0);assert.equal(ratio.scheduled_staff,1);assert.equal(ratio.status,'no_coverage','Planned staff do not count as clocked-in coverage');
 const edits=await database.withTransaction(c=>c.query("select action from audit_log where organization_id=$1 and action like 'staff.schedule_%' order by created_at",[org]));assert.ok(edits.rows.some(r=>r.action==='staff.schedule_created'));assert.ok(edits.rows.some(r=>r.action==='staff.schedule_updated'));assert.ok(edits.rows.some(r=>r.action==='staff.schedule_cancelled'));
 console.log('Schedule scoping, role permissions, timezone/DST, overlaps, staff views, edits, cancellations and separation from live coverage passed');
}finally{await database.withTransaction(async c=>{await c.query('delete from staff_assignments where organization_id=$1',[org]);await c.query('delete from attendance where organization_id=$1',[org]);await c.query('delete from participants where id=$1',[child]);await c.query('delete from organizations where id=any($1::text[])',[[org,other]])});await database.close()}
})().catch(e=>{console.error(e);process.exit(1)});
