const fail=(status,message)=>Object.assign(Error(message),{status});
const permitted=(a)=>['owner','manager'].includes(a.role);
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
    const status=u.searchParams.get('status'), program=u.searchParams.get('program'), selectedSession=u.searchParams.get('session');if(status&&!['draft','submitted','approved'].includes(status))throw fail(400,'Choose a valid report status.');
    const out=await database.withTransaction(async c=>{const r=await c.query('select i.*,p.name as participant_name,s.label as session_label,pr.name as program_name from incident_reports i join participants p on p.id=i.participant_id join sessions s on s.id=i.session_id join programs pr on pr.id=s.program_id where i.organization_id=$1 and ($2::text is null or i.status=$2) and ($3::text is null or pr.id=$3) and ($4::text is null or s.id=$4) order by i.occurred_at desc limit 500',[org,status||null,program||null,selectedSession||null]);const addenda=r.rowCount?(await c.query('select * from incident_addenda where incident_id=any($1::text[]) order by created_at,id',[r.rows.map(i=>i.id)])).rows:[];return r.rows.map(i=>({...i,can_edit:i.status==='draft'&&(permitted(a)||i.author_id===who.id&&i.author_type===who.type),addenda:addenda.filter(n=>n.incident_id===i.id)}))});json(res,200,{incidents:out,can_review:permitted(a)});return true;
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
   json(res,404,{error:'Unknown operations action.'});return true;
  }catch(e){json(res,e.code==='23505'?409:e.status||500,{error:e.code==='23505'?'This clock action has already been recorded. Refresh to see your current shift.':e.status?e.message:'Incident reports are temporarily unavailable. Please try again.'});return true}
 }
 return {handle};
}
module.exports={createOperations};
