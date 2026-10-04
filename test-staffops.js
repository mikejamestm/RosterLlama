const assert=require('node:assert/strict'),database=require('./database'),{createOperations,shiftDurations,validDate}=require('./operations');
const suffix=Date.now(),org='ops_org_'+suffix,foreign='ops_foreign_'+suffix,staff='ops_staff_'+suffix,manager='ops_manager_'+suffix,owner='ops_owner_'+suffix,program='ops_program_'+suffix,program2='ops_program2_'+suffix,session='ops_session_'+suffix,session2='ops_session2_'+suffix,family='ops_family_'+suffix,child='ops_child_'+suffix;let serial=0;const today=new Date().toISOString().slice(0,10);
async function call(path,method='GET',payload={},role='staff'){
 const a={org:{id:role==='foreign'?foreign:org,timezone:'UTC'},role:role==='foreign'?'owner':role,...(['owner','foreign'].includes(role)?{owner:{id:owner}}:{staff:{id:role==='manager'?manager:staff}})};
 let response;const res={writeHead:status=>response={status},end:text=>response.body=text};
 const ops=createOperations({database,ready:()=>true,id:p=>p+'_'+suffix+'_'+(++serial),json:(r,status,body)=>response={status,body},body:async()=>payload,requireAuth:()=>a,familySession:()=>null,dateInZone:()=>today});
 await ops.handle({method},res,new URL('https://example.test/api/operations/'+path),{});return response;
}
async function current(role='staff'){return (await call('timeclock','GET',{},role)).body}
async function action(name,extra={},role='staff'){const c=await current(role);return call('timeclock','POST',{action:name,shift_id:c.shift?.id,version:c.shift?.version,service_date:today,...extra},role)}
(async()=>{if(!process.env.CI&&process.env.ALLOW_INTEGRATION_TESTS!=='true')throw Error('Use a disposable test database');assert.equal(validDate('2026-02-30'),false);assert.deepEqual(shiftDurations({started_at:'2026-10-01T09:00:00Z',ended_at:'2026-10-01T17:00:00Z'},[{started_at:'2026-10-01T12:00:00Z',ended_at:'2026-10-01T12:30:00Z'}]),{elapsed_minutes:480,break_minutes:30,worked_minutes:450});await database.migrate();
try{
 await database.withTransaction(async c=>{
  await c.query('insert into organizations(id,name,slug,timezone) values($1,$1,$1,\'UTC\'),($2,$2,$2,\'UTC\')',[org,foreign]);
  await c.query("insert into staff(id,organization_id,name,email,role,status) values($1,$3,'=SUM(1,1)',$1,'staff','active'),($2,$3,'Manager',$2,'manager','active')",[staff,manager,org]);
  await c.query('insert into owners(id,organization_id,name,email,password_hash) values($1,$2,$1,$1,\'test\')',[owner,org]);
  await c.query('insert into programs(id,organization_id,name) values($1,$3,$1),($2,$3,$2)',[program,program2,org]);
  await c.query("insert into sessions(id,program_id,label,capacity,status) values($1,$3,'Morning',20,'open'),($2,$4,'Afternoon',20,'open')",[session,session2,program,program2]);
  await c.query('insert into families(id,organization_id,name,email) values($1,$2,$1,$1)',[family,org]);await c.query('insert into participants(id,family_id,name) values($1,$2,$1)',[child,family]);
  await c.query("insert into attendance(id,organization_id,session_id,participant_id,action,service_date) values($1,$2,$3,$4,'checkin',$5)",['ops_att_'+suffix,org,session,child,today]);
 });
 assert.equal((await action('clock_in',{session_id:session,service_date:'2099-01-01'})).status,422);
 assert.equal((await call('timeclock','POST',{action:'clock_in',session_id:session,service_date:today},'foreign')).status,403);
 const double=await Promise.all([action('clock_in',{session_id:session}),action('clock_in',{session_id:session})]);assert.deepEqual(double.map(x=>x.status).sort(),[200,409]);let clock=await current();const first=clock.shift.id;assert.equal(clock.shift.program_name,program);
 assert.equal((await call('programs/'+program+'/ratio','PATCH',{ratio_target:8})).status,403);assert.equal((await call('programs/'+program+'/ratio','PATCH',{ratio_target:0},'manager')).status,400);assert.equal((await call('programs/'+program+'/ratio','PATCH',{ratio_target:8},'manager')).status,200);
 let ratios=(await call('ratios?program='+program)).body;assert.equal(ratios.service_date,today);assert.equal(ratios.sessions.length,1);assert.equal(ratios.sessions[0].working_staff,1);assert.equal(ratios.sessions[0].status,'within_target');
 const saved={shift_id:clock.shift.id,version:clock.shift.version};assert.equal((await action('break_start')).status,200);assert.equal((await call('timeclock','POST',{action:'clock_out',...saved})).status,409);
 ratios=(await call('ratios?session='+session)).body;assert.equal(ratios.sessions[0].working_staff,0);assert.equal(ratios.sessions[0].status,'no_coverage');assert.equal((await action('switch_session',{session_id:session2})).status,409);assert.equal((await action('break_end')).status,200);
 assert.equal((await action('switch_session',{session_id:session})).status,409);assert.equal((await action('switch_session',{session_id:session2})).status,200);clock=await current();assert.notEqual(clock.shift.id,first);assert.equal(clock.shift.session_id,session2);
 assert.equal((await call('timeclock','POST',{action:'clock_out',...saved})).status,409,'An old tablet cannot end a new segment');
 assert.equal((await action('break_start')).status,200);assert.equal((await action('clock_out')).status,200);assert.equal((await current()).shift,null);
 assert.equal((await action('clock_in',{session_id:session},'manager')).status,200);assert.equal((await action('clock_out',{},'manager')).status,200);
 let own=(await call('timesheets?from='+today+'&to='+today)).body;assert.equal(own.shifts.length,2);assert.ok(own.shifts.every(s=>s.actor_id===staff&&s.breaks.every(b=>b.ended_at)&&s.worked_minutes>=0));
 let all=(await call('timesheets?from='+today+'&to='+today,'GET',{},'manager')).body;assert.equal(all.shifts.length,3);
 assert.equal((await call('timesheets?program='+program2)).body.shifts.length,1);assert.equal((await call('timesheets?actor=staff:'+manager)).body.shifts.length,0);assert.equal((await call('timesheets?from=2026-02-30')).status,400);
 const csv=await call('timesheets.csv?program='+program2+'&actor=staff:'+staff);assert.equal(csv.status,200);assert.ok(csv.body.includes("'=SUM(1,1)"));assert.ok(!csv.body.includes('Morning'));assert.ok(csv.body.includes('Afternoon'));
 const record=own.shifts.find(s=>s.id===first),correction={version:record.version,started_at:new Date(record.started_at).toISOString(),ended_at:new Date(record.ended_at).toISOString(),note:'Confirmed original times'};
 assert.equal((await call('shifts/'+first,'PATCH',correction)).status,403);assert.equal((await call('shifts/'+first,'PATCH',correction,'foreign')).status,404);assert.equal((await call('shifts/'+first,'PATCH',correction,'manager')).status,200);assert.equal((await call('shifts/'+first,'PATCH',correction,'manager')).status,409);
 const updated=(await call('timesheets?session='+session)).body.shifts.find(s=>s.id===first);assert.equal(updated.version,record.version+1);assert.equal((await call('shifts/'+first,'PATCH',{...correction,version:updated.version,started_at:new Date(Date.now()-3600000).toISOString(),ended_at:new Date(record.started_at).toISOString()},'manager')).status,409,'Breaks must remain inside corrected shift');
 await database.withTransaction(async c=>{
  await c.query("insert into staff_shifts(id,organization_id,actor_type,actor_id,session_id,started_at,ended_at) values($1,$3,'staff',$4,$5,now()-interval '5 hours',now()-interval '4 hours'),($2,$3,'staff',$4,$5,now()-interval '3 hours',now()-interval '2 hours')",['ops_old1_'+suffix,'ops_old2_'+suffix,org,staff,session]);
 });
 const overlap={version:1,started_at:new Date(Date.now()-4.5*3600000).toISOString(),ended_at:new Date(Date.now()-2.5*3600000).toISOString(),note:'Overlap check'};
 const concurrent=await Promise.all([call('shifts/ops_old1_'+suffix,'PATCH',{...overlap,started_at:new Date(Date.now()-5*3600000).toISOString(),ended_at:new Date(Date.now()-3.5*3600000).toISOString()},'manager'),call('shifts/ops_old2_'+suffix,'PATCH',{...overlap,started_at:new Date(Date.now()-4*3600000).toISOString(),ended_at:new Date(Date.now()-2*3600000).toISOString()},'manager')]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 await database.withTransaction(c=>c.query("insert into attendance(id,organization_id,session_id,participant_id,action,service_date) values($1,$2,$3,$4,'checkout',$5)",['ops_out_'+suffix,org,session,child,today]));ratios=(await call('ratios?session='+session)).body;assert.equal(ratios.sessions[0].present,0);assert.equal(ratios.sessions[0].status,'empty');
 assert.equal((await call('programs/'+program+'/ratio','PATCH',{ratio_target:null},'manager')).status,200);
 assert.equal((await action('clock_in',{session_id:session})).status,200);await database.withTransaction(c=>c.query("update staff set status='inactive' where id=$1",[staff]));assert.equal((await call('timeclock')).status,403);assert.equal((await call('ratios','GET',{},'manager')).body.sessions.find(s=>s.id===session).working_staff,0);
 await database.withTransaction(c=>c.query("update staff set role='staff' where id=$1",[manager]));assert.equal((await call('programs/'+program+'/ratio','PATCH',{ratio_target:8},'manager')).status,403);
 const audit=await database.withTransaction(c=>c.query("select detail from audit_log where organization_id=$1 and action='staff.shift_corrected'",[org]));assert.ok(audit.rows.length>=2);assert.ok(audit.rows.every(r=>r.detail.before&&r.detail.after&&r.detail.reason));
 console.log('Staff clock, breaks, segmentation, dates, scope, CSV, role checks, coverage and concurrent corrections passed');
}finally{await database.withTransaction(async c=>{await c.query('delete from attendance where organization_id=$1',[org]);await c.query('delete from staff_shifts where organization_id=$1',[org]);await c.query('delete from participants where id=$1',[child]);await c.query('delete from organizations where id=any($1::text[])',[[org,foreign]])});await database.close()}
})().catch(e=>{console.error(e);process.exit(1)});
