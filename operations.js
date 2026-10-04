const fail=(status,message)=>Object.assign(Error(message),{status});
const permitted=(a)=>['owner','manager'].includes(a.role);
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function shiftDurations(shift,breaks,now=new Date()){
 const end=new Date(shift.ended_at||now),start=new Date(shift.started_at);
 const elapsed=Math.max(0,(end-start)/60000),breakMinutes=breaks.reduce((total,b)=>total+Math.max(0,(Math.min(end,new Date(b.ended_at||now))-Math.max(start,new Date(b.started_at)))/60000),0);
 return {elapsed_minutes:Math.round(elapsed*100)/100,break_minutes:Math.round(breakMinutes*100)/100,worked_minutes:Math.round(Math.max(0,elapsed-breakMinutes)*100)/100};
}
function createOperations(ctx){
 const {database,json,body,id,requireAuth,requireRole,familySession,dateInZone}=ctx;
 async function audit(c,org,a,action,detail){await c.query('insert into audit_log(id,organization_id,actor_type,actor_id,action,detail) values($1,$2,$3,$4,$5,$6::jsonb)',[id('audit'),org,a.type,a.id,action,JSON.stringify(detail)])}
 const actor=a=>({type:a.owner?'owner':'staff',id:a.owner?.id||a.staff?.id});
 async function session(c,org,sid){const r=await c.query('select s.id from sessions s join programs p on p.id=s.program_id where s.id=$1 and p.organization_id=$2 and s.status<>\'cancelled\'',[sid,org]);if(!r.rowCount)throw fail(403,'Choose a session in your organization.');return r.rows[0]}
 async function currentActor(c,a){if(!a.owner){const r=await c.query("select role from staff where id=$1 and organization_id=$2 and status='active'",[a.staff.id,a.org.id]);if(!r.rowCount)throw fail(403,'Your staff account is not active.');a.role=r.rows[0].role}return a}
 async function incident(c,org,iid,lock=false){const r=await c.query('select * from incident_reports where id=$1 and organization_id=$2'+(lock?' for update':''),[iid,org]);if(!r.rowCount)throw fail(404,'Incident report not found.');return r.rows[0]}
 function fields(x){const occurred=new Date(x.occurred_at);if(!Number.isFinite(+occurred)||+occurred>Date.now()+60000)throw fail(400,'Choose a valid incident date and time.');if(!['injury','behavior','safety','other'].includes(x.kind))throw fail(400,'Choose an incident type.');const f={occurred_at:occurred.toISOString(),kind:x.kind};for(const key of ['title','description','actions_taken','internal_notes']){f[key]=String(x[key]||'').trim();if(f[key].length>(key==='title'?160:10000))throw fail(400,'The report text is too long.')}if(!f.title||!f.description||!f.actions_taken)throw fail(400,'Enter a title, what happened and the actions taken.');return f}
 async function validParticipant(c,org,pid,sid){await session(c,org,sid);const r=await c.query('select 1 from registrations where organization_id=$1 and participant_id=$2 and session_id=$3 union all select 1 from waitlist where organization_id=$1 and participant_id=$2 and session_id=$3 limit 1',[org,pid,sid]);if(!r.rowCount)throw fail(403,'Choose a participant registered in this session.')}
 async function familyHandle(req,res,u,d){
  const f=familySession(req,d);if(!f){json(res,401,{error:'Please sign in to your Family Portal.'});return true}
  if(req.method==='GET'&&u.pathname==='/api/family/incidents'){
   const out=await database.withTransaction(async c=>{
    const r=await c.query("select i.id,i.participant_id,p.name as participant_name,s.label as session_label,pr.name as program_name,i.occurred_at,i.kind,i.title,i.description,i.actions_taken,i.version,i.reviewed_at,i.acknowledged_at,i.acknowledged_name from incident_reports i join participants p on p.id=i.participant_id join families f on f.id=p.family_id join sessions s on s.id=i.session_id join programs pr on pr.id=s.program_id where f.id=$1 and i.organization_id=f.organization_id and i.status='approved' order by i.occurred_at desc limit 200",[f.family_id]);
    const ids=r.rows.map(i=>i.id),addenda=ids.length?(await c.query('select incident_id,text,created_at from incident_addenda where incident_id=any($1::text[]) order by created_at,id',[ids])).rows:[];
    return r.rows.map(i=>({...i,addenda:addenda.filter(x=>x.incident_id===i.id)}));
   });json(res,200,{incidents:out});return true;
  }
  if(req.method==='POST'&&/^\/api\/family\/incidents\/[^/]+\/acknowledge$/.test(u.pathname)){
   const x=await body(req),name=String(x.name||'').trim();if(x.agree!==true||name.length<2||name.length>160)throw fail(400,'Enter your name and confirm you have read the report.');
   const out=await database.withTransaction(async c=>{
    const r=await c.query("select i.* from incident_reports i join participants p on p.id=i.participant_id join families f on f.id=p.family_id where i.id=$1 and f.id=$2 and i.organization_id=f.organization_id and i.status='approved' for update of i",[u.pathname.split('/')[4],f.family_id]);if(!r.rowCount)throw fail(404,'Incident report not found.');const report=r.rows[0];if(Number(x.version)!==report.version)throw fail(409,'This report has been updated. Read the current version before acknowledging.');
    if(!report.acknowledged_at){await c.query('update incident_reports set acknowledged_at=now(),acknowledged_by=$2,acknowledged_name=$3,acknowledged_version=version where id=$1',[report.id,f.family_id,name]);await audit(c,report.organization_id,{type:'family',id:f.family_id},'incident.acknowledged',{incident_id:report.id,version:report.version})}
    return {ok:true};
   });json(res,200,out);return true;
  }
  json(res,404,{error:'Unknown incident action.'});return true;
 }
 async function handle(req,res,u,d){
  if(!u.pathname.startsWith('/api/operations/')&&!u.pathname.startsWith('/api/family/incidents'))return false;
  try{
   if(!ctx.ready())throw fail(503,'Operations are temporarily unavailable.');
   if(u.pathname.startsWith('/api/family/incidents'))return await familyHandle(req,res,u,d);
   const a=requireAuth(req,res,d);if(!a)return true;await database.withTransaction(c=>currentActor(c,a));const who=actor(a),org=a.org.id;
   if(req.method==='GET'&&u.pathname==='/api/operations/incidents'){
    const status=u.searchParams.get('status');if(status&&!['draft','submitted','approved'].includes(status))throw fail(400,'Choose a valid report status.');
    const out=await database.withTransaction(async c=>{const r=await c.query('select i.*,p.name as participant_name,s.label as session_label,pr.name as program_name from incident_reports i join participants p on p.id=i.participant_id join sessions s on s.id=i.session_id join programs pr on pr.id=s.program_id where i.organization_id=$1 and ($2::text is null or i.status=$2) order by i.occurred_at desc limit 500',[org,status||null]);const addenda=r.rowCount?(await c.query('select * from incident_addenda where incident_id=any($1::text[]) order by created_at,id',[r.rows.map(i=>i.id)])).rows:[];return r.rows.map(i=>({...i,can_edit:i.status==='draft'&&(permitted(a)||i.author_id===who.id&&i.author_type===who.type),addenda:addenda.filter(n=>n.incident_id===i.id)}))});json(res,200,{incidents:out,can_review:permitted(a)});return true;
   }
   if(req.method==='POST'&&u.pathname==='/api/operations/incidents'){
    const x=await body(req),f=fields(x),iid=id('incident');await database.withTransaction(async c=>{await validParticipant(c,org,x.participant_id,x.session_id);await c.query('insert into incident_reports(id,organization_id,participant_id,session_id,occurred_at,kind,title,description,actions_taken,internal_notes,author_type,author_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[iid,org,x.participant_id,x.session_id,f.occurred_at,f.kind,f.title,f.description,f.actions_taken,f.internal_notes,who.type,who.id]);await audit(c,org,who,'incident.created',{incident_id:iid,participant_id:x.participant_id,session_id:x.session_id})});json(res,201,{id:iid,status:'draft',version:1});return true;
   }
   const match=u.pathname.match(/^\/api\/operations\/incidents\/([^/]+)(?:\/(submit|approve|return|addendum|notify))?$/);
   if(match&&['POST','PATCH'].includes(req.method)){
    const x=await body(req),action=match[2]||'edit';
    const out=await database.withTransaction(async c=>{const i=await incident(c,org,match[1],true);if(Number(x.version)!==i.version)throw fail(409,'This report has changed. Refresh before saving.');
     if(['approve','return','addendum','notify'].includes(action)&&!permitted(a))throw fail(403,'A manager must perform this action.');
     if(['edit','submit'].includes(action)&&!(permitted(a)||i.author_id===who.id&&i.author_type===who.type))throw fail(403,'Only the author or a manager can edit this draft.');
     if(action==='edit'){
      if(i.status!=='draft')throw fail(409,'Reviewed reports are locked. A manager can add a correction.');const f=fields(x);
      await c.query('update incident_reports set occurred_at=$2,kind=$3,title=$4,description=$5,actions_taken=$6,internal_notes=$7,version=version+1,updated_at=now() where id=$1',[i.id,f.occurred_at,f.kind,f.title,f.description,f.actions_taken,f.internal_notes]);
     }else if(action==='submit'){
      if(i.status!=='draft')throw fail(409,'Only drafts can be submitted.');await c.query("update incident_reports set status='submitted',version=version+1,updated_at=now() where id=$1",[i.id]);
     }else if(action==='approve'){
      if(i.status!=='submitted')throw fail(409,'Submit the report for review first.');await c.query("update incident_reports set status='approved',reviewer_id=$2,reviewed_at=now(),version=version+1,updated_at=now() where id=$1",[i.id,who.id]);
     }else if(action==='return'){
      if(i.status!=='submitted')throw fail(409,'Only reports awaiting review can be returned.');const note=String(x.note||'').trim();if(!note||note.length>2000)throw fail(400,'Enter a review note.');await c.query("update incident_reports set status='draft',internal_notes=internal_notes||E'\\nReview: '||$2,version=version+1,updated_at=now() where id=$1",[i.id,note]);
     }else if(action==='addendum'){
      if(i.status!=='approved')throw fail(409,'Only approved reports can receive a correction.');const text=String(x.text||'').trim();if(!text||text.length>10000)throw fail(400,'Enter the correction.');await c.query('insert into incident_addenda(id,incident_id,author_id,text) values($1,$2,$3,$4)',[id('addendum'),i.id,who.id,text]);await c.query('update incident_reports set version=version+1,acknowledged_at=null,acknowledged_by=null,acknowledged_name=null,acknowledged_version=null,updated_at=now() where id=$1',[i.id]);
     }else if(action==='notify'){
      if(i.status!=='approved')throw fail(409,'Approve the report before recording family contact.');const note=String(x.note||'').trim();if(!note||note.length>2000)throw fail(400,'Record how the family was contacted.');await c.query('update incident_reports set notified_at=now(),notification_note=$2 where id=$1',[i.id,note]);
     }
     await audit(c,org,who,'incident.'+action,{incident_id:i.id,previous_version:i.version});return {ok:true};
    });json(res,200,out);return true;
   }
   if(req.method==='GET'&&u.pathname==='/api/operations/timeclock'){
    const out=await database.withTransaction(async c=>{const q=await c.query('select * from staff_shifts where organization_id=$1 and actor_type=$2 and actor_id=$3 and ended_at is null',[org,who.type,who.id]);const shift=q.rows[0]||null,breaks=shift?(await c.query('select * from staff_breaks where shift_id=$1 order by started_at',[shift.id])).rows:[];return {shift,breaks,on_break:breaks.some(b=>!b.ended_at),...(shift?shiftDurations(shift,breaks):{})}});json(res,200,out);return true;
   }
   if(req.method==='POST'&&u.pathname==='/api/operations/timeclock'){
    const x=await body(req);if(!['clock_in','clock_out','break_start','break_end','switch_session'].includes(x.action))throw fail(400,'Choose a valid clock action.');
    const out=await database.withTransaction(async c=>{
     const q=await c.query('select * from staff_shifts where organization_id=$1 and actor_type=$2 and actor_id=$3 and ended_at is null for update',[org,who.type,who.id]);const shift=q.rows[0];
     if(x.action==='clock_in'){if(shift)throw fail(409,'You are already clocked in.');await session(c,org,x.session_id);const sid=id('shift');await c.query('insert into staff_shifts(id,organization_id,actor_type,actor_id,session_id) values($1,$2,$3,$4,$5)',[sid,org,who.type,who.id,x.session_id]);await audit(c,org,who,'staff.clock_in',{shift_id:sid,session_id:x.session_id});return {ok:true,shift_id:sid}}
     if(!shift)throw fail(409,'Clock in before recording this action.');const br=await c.query('select * from staff_breaks where shift_id=$1 and ended_at is null for update',[shift.id]),open=br.rows[0];
     if(x.action==='clock_out'){if(open)await c.query('update staff_breaks set ended_at=clock_timestamp() where id=$1',[open.id]);await c.query('update staff_shifts set ended_at=clock_timestamp() where id=$1',[shift.id]);}
     if(x.action==='break_start'){if(open)throw fail(409,'Your break is already running.');await c.query('insert into staff_breaks(id,shift_id) values($1,$2)',[id('break'),shift.id]);}
     if(x.action==='break_end'){if(!open)throw fail(409,'No break is running.');await c.query('update staff_breaks set ended_at=clock_timestamp() where id=$1',[open.id]);}
     if(x.action==='switch_session'){if(open)throw fail(409,'End your break before switching sessions.');await session(c,org,x.session_id);await c.query('update staff_shifts set ended_at=clock_timestamp() where id=$1',[shift.id]);const newShift=id('shift');await c.query('insert into staff_shifts(id,organization_id,actor_type,actor_id,session_id) values($1,$2,$3,$4,$5)',[newShift,org,who.type,who.id,x.session_id]);await audit(c,org,who,'staff.session_assignment_started',{shift_id:newShift,previous_shift_id:shift.id,session_id:x.session_id});}
     await audit(c,org,who,'staff.'+x.action,{shift_id:shift.id,session_id:x.session_id||shift.session_id});return {ok:true};
    });json(res,200,out);return true;
   }
   if(req.method==='GET'&&['/api/operations/timesheets','/api/operations/timesheets.csv'].includes(u.pathname)){
    const today=dateInZone(a.org.timezone),from=u.searchParams.get('from')||today.slice(0,7)+'-01',to=u.searchParams.get('to')||today;if(!validDate(from)||!validDate(to)||from>to||new Date(to)-new Date(from)>366*86400e3)throw fail(400,'Choose a valid date range of up to one year.');
    const rows=await database.withTransaction(async c=>{
     const result=await c.query("select s.*,coalesce(o.name,st.name,st.email,'Former staff') as staff_name,se.label as session_label,p.name as program_name from staff_shifts s join sessions se on se.id=s.session_id join programs p on p.id=se.program_id left join owners o on s.actor_type='owner' and o.id=s.actor_id left join staff st on s.actor_type='staff' and st.id=s.actor_id where s.organization_id=$1 and (s.started_at at time zone $2)::date between $3::date and $4::date and ($5::boolean or (s.actor_type=$6 and s.actor_id=$7)) order by s.started_at desc limit 5000",[org,a.org.timezone||'UTC',from,to,permitted(a),who.type,who.id]);const bs=result.rowCount?(await c.query('select * from staff_breaks where shift_id=any($1::text[]) order by started_at',[result.rows.map(s=>s.id)])).rows:[];return result.rows.map(s=>({...s,breaks:bs.filter(b=>b.shift_id===s.id),...shiftDurations(s,bs.filter(b=>b.shift_id===s.id))}));
    });
    if(u.pathname.endsWith('.csv')){const cell=v=>'"'+((/^[=+\-@\t\r]/.test(String(v??''))?"'":'')+String(v??'')).replaceAll('"','""')+'"',data=[['Staff','Program','Session','Clock in','Clock out','Break minutes','Worked minutes','Correction note'],...rows.map(s=>[s.staff_name,s.program_name,s.session_label,s.started_at?.toISOString?.()||s.started_at,s.ended_at?.toISOString?.()||s.ended_at||'Running',s.break_minutes,s.worked_minutes,s.correction_note||''])];res.writeHead(200,{'content-type':'text/csv; charset=utf-8','cache-control':'no-store','content-disposition':'attachment; filename="rosterllama-timesheets.csv"'});res.end(data.map(row=>row.map(cell).join(',')).join('\n'));return true}
    json(res,200,{shifts:rows,from,to,can_manage:permitted(a)});return true;
   }
   if(req.method==='PATCH'&&/^\/api\/operations\/shifts\/[^/]+$/.test(u.pathname)){
    if(!permitted(a))throw fail(403,'A manager must correct a timesheet.');const x=await body(req),start=new Date(x.started_at),end=new Date(x.ended_at),note=String(x.note||'').trim();if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<start||end>Date.now()+60000||!note||note.length>2000)throw fail(400,'Enter valid recorded times and a correction reason.');
    await database.withTransaction(async c=>{const q=await c.query('select * from staff_shifts where id=$1 and organization_id=$2 for update',[u.pathname.split('/')[4],org]);if(!q.rowCount)throw fail(404,'Shift not found.');const shift=q.rows[0];if(!shift.ended_at)throw fail(409,'Clock out before correcting this shift.');const bs=await c.query('select 1 from staff_breaks where shift_id=$1 and (started_at<$2 or ended_at>$3 or ended_at is null)',[shift.id,start,end]);if(bs.rowCount)throw fail(409,'Recorded breaks must remain within the corrected shift.');
     const overlap=await c.query('select 1 from staff_shifts where organization_id=$1 and actor_type=$2 and actor_id=$3 and id<>$4 and started_at<$6 and coalesce(ended_at,now())>$5',[org,shift.actor_type,shift.actor_id,shift.id,start,end]);if(overlap.rowCount)throw fail(409,'The corrected shift overlaps another shift.');
     await c.query('update staff_shifts set started_at=$2,ended_at=$3,correction_note=$4,corrected_by=$5,corrected_at=now() where id=$1',[shift.id,start,end,note,who.id]);await audit(c,org,who,'staff.shift_corrected',{shift_id:shift.id,before:{started_at:shift.started_at,ended_at:shift.ended_at},after:{started_at:start,ended_at:end},reason:note});
    });json(res,200,{ok:true});return true;
   }
   if(req.method==='GET'&&u.pathname==='/api/operations/ratios'){
    const rows=await database.withTransaction(async c=>{
     const sessions=await c.query("select s.id,s.label,p.id as program_id,p.name as program_name,p.ratio_target from sessions s join programs p on p.id=s.program_id where p.organization_id=$1 and s.status<>'cancelled' order by p.name,s.label",[org]);const day=dateInZone(a.org.timezone);
     const present=await c.query("select session_id,count(distinct participant_id)::int as present from attendance a where organization_id=$1 and service_date=$2 and action='checkin' and not exists(select 1 from attendance b where b.participant_id=a.participant_id and b.session_id=a.session_id and b.service_date=a.service_date and b.action='checkout') group by session_id",[org,day]);
     const staffing=await c.query("select s.session_id,count(*)::int as working from staff_shifts s where s.organization_id=$1 and s.ended_at is null and not exists(select 1 from staff_breaks b where b.shift_id=s.id and b.ended_at is null) and ((s.actor_type='owner' and exists(select 1 from owners o where o.id=s.actor_id and o.organization_id=$1)) or (s.actor_type='staff' and exists(select 1 from staff st where st.id=s.actor_id and st.organization_id=$1 and st.status='active'))) group by s.session_id",[org]);
     return sessions.rows.map(s=>{const kids=present.rows.find(p=>p.session_id===s.id)?.present||0,staff=staffing.rows.find(p=>p.session_id===s.id)?.working||0,required=s.ratio_target?Math.ceil(kids/s.ratio_target):null;return {...s,present:kids,working_staff:staff,required_staff:required,additional_staff:required===null?null:Math.max(0,required-staff),status:kids&&!staff?'no_coverage':required!==null&&required>staff?'needs_staff':s.ratio_target?'within_target':'target_not_set'}});
    });json(res,200,{sessions:rows,can_manage:permitted(a),checked_at:new Date().toISOString()});return true;
   }
   if(req.method==='PATCH'&&/^\/api\/operations\/programs\/[^/]+\/ratio$/.test(u.pathname)){
    if(!permitted(a))throw fail(403,'A manager must set ratio targets.');const x=await body(req),target=x.ratio_target==null||x.ratio_target===''?null:Number(x.ratio_target);if(target!==null&&(!Number.isInteger(target)||target<1||target>50))throw fail(400,'Choose a whole-number ratio target between 1 and 50.');await database.withTransaction(async c=>{const q=await c.query('update programs set ratio_target=$3 where id=$1 and organization_id=$2 returning id',[u.pathname.split('/')[4],org,target]);if(!q.rowCount)throw fail(404,'Program not found.');await audit(c,org,who,'staff.ratio_target_updated',{program_id:q.rows[0].id,ratio_target:target})});json(res,200,{ok:true});return true;
   }
   json(res,404,{error:'Unknown operations action.'});return true;
  }catch(e){json(res,e.code==='23505'?409:e.status||500,{error:e.code==='23505'?'This clock action has already been recorded. Refresh to see your current shift.':e.message});return true}
 }
 return {handle};
}
module.exports={createOperations,shiftDurations,validDate};
