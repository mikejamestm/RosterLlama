// One explicit program/session/date context shared by every working screen.
const workspace={programId:'',sessionId:'',date:'',loaded:false};
function workspaceKey(){return 'rosterllama.workspace.'+me.organization.id}
function restoreWorkspace(){
  allState.sessions=allState.sessions.map(s=>({...s,start_date:String(s.start_date||'').slice(0,10),end_date:String(s.end_date||'').slice(0,10)}));
  if(!workspace.loaded){try{Object.assign(workspace,JSON.parse(sessionStorage.getItem(workspaceKey())||'{}'))}catch{}workspace.loaded=true}
  if(!allState.programs.some(p=>p.id===workspace.programId)){workspace.programId='';workspace.sessionId=''}
  if(!allState.sessions.some(s=>s.id===workspace.sessionId&&s.program_id===workspace.programId))workspace.sessionId='';
  if(!workspace.date)workspace.date=localDateISO();
}
function scopeWorkspace(data){
  if(!workspace.programId)return data;
  const programs=data.programs.filter(p=>p.id===workspace.programId),sessions=data.sessions.filter(s=>s.program_id===workspace.programId&&(!workspace.sessionId||s.id===workspace.sessionId)),sids=new Set(sessions.map(s=>s.id));
  const registrations=data.registrations.filter(r=>sids.has(r.session_id)),waitlist=data.waitlist.filter(r=>sids.has(r.session_id)),pids=new Set([...registrations,...waitlist].map(r=>r.participant_id)),participants=data.participants.filter(p=>pids.has(p.id)),fids=new Set(participants.map(p=>p.family_id)),rids=new Set(registrations.map(r=>r.id));
  const dated=r=>String(r.service_date||r.date||localDateISO(new Date(r.at||r.created_at))).slice(0,10)===workspace.date;
  const result={...data,programs,sessions,registrations,waitlist,participants,families:data.families.filter(f=>fids.has(f.id)),attendance:(data.attendance||[]).filter(r=>sids.has(r.session_id)&&dated(r)),absences:(data.absences||[]).filter(r=>pids.has(r.participant_id)&&(!r.session_id||sids.has(r.session_id))&&dated(r)),signouts:(data.signouts||[]).filter(r=>sids.has(r.session_id)&&dated(r)),registration_requests:(data.registration_requests||[]).filter(r=>rids.has(r.registration_id))};
  for(const name of ['payments','refunds','disputes'])result[name]=(data[name]||[]).filter(r=>rids.has(r.registration_id));
  return result;
}
function workspacePicker(message){return '<div class="workspace-empty"><h3>'+esc(message)+'</h3><p>Use the selectors above or choose a program below.</p><div class="program-shortcuts">'+allState.programs.map(p=>'<button class="program-shortcut" data-choose-program="'+esc(p.id)+'"><strong>'+esc(p.name)+'</strong><span>'+allState.sessions.filter(s=>s.program_id===p.id).length+' sessions →</span></button>').join('')+'</div></div>'}
function readableDate(date){return new Date(date+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}
function selectProgram(id){workspace.programId=id;const sessions=allState.sessions.filter(s=>s.program_id===id);workspace.sessionId=sessions.length===1?sessions[0].id:'';if(workspace.sessionId)chooseSessionDate(sessions[0]);applyWorkspace()}
function chooseSessionDate(session){const today=localDateISO();workspace.date=session.start_date&&session.start_date>today?session.start_date:today}
function applyWorkspace(){sessionStorage.setItem(workspaceKey(),JSON.stringify(workspace));state=scopeWorkspace(allState);render();renderWorkspace()}
function renderWorkspace(){
  const p=allState.programs.find(p=>p.id===workspace.programId),s=allState.sessions.find(s=>s.id===workspace.sessionId),sessions=allState.sessions.filter(s=>s.program_id===workspace.programId).sort((a,b)=>String(a.start_date||'').localeCompare(String(b.start_date||''))||a.label.localeCompare(b.label));
  $('#contextprogram').innerHTML='<option value="">Choose a program / camp</option>'+allState.programs.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');$('#contextprogram').value=workspace.programId;
  $('#contextsession').innerHTML='<option value="">'+(p?'Choose a session / class':'Choose a program first')+'</option>'+sessions.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.label)+(s.start_date?' · '+s.start_date:'')+'</option>').join('');$('#contextsession').disabled=!p;$('#contextsession').value=workspace.sessionId;$('#contextdate').value=workspace.date;
  $('#contexttitle').textContent=p?p.name:'All programs';$('#contextsummary').textContent=p?(s?s.label:'All sessions in this program')+' · '+readableDate(workspace.date):'Dashboard totals cover your organization. Choose a program before opening participant lists.';
  $('#staffheading').textContent=s?p.name:'Program attendance';$('#staffsubtitle').textContent=s?s.label+' · '+readableDate(workspace.date):'Choose a program and session above to open the correct roster.';
  const historical=workspace.date!==localDateISO();$('#staffdatewarning').classList.toggle('hidden',!s||!historical);$('#staffdatewarning').textContent='Viewing '+readableDate(workspace.date)+'. Check-in and pickup are available only for today. Select today to record live attendance.';
  $('#dashboardprograms').innerHTML=allState.programs.map(p=>'<button class="program-shortcut '+(p.id===workspace.programId?'selected':'')+'" data-choose-program="'+esc(p.id)+'"><strong>'+esc(p.name)+'</strong><span>'+allState.sessions.filter(s=>s.program_id===p.id).length+' sessions · '+allState.registrations.filter(r=>r.status==='enrolled'&&allState.sessions.some(s=>s.id===r.session_id&&s.program_id===p.id)).length+' enrollments →</span></button>').join('')||'<p class="muted">Create your first program to get started.</p>';
  if(!p)for(const id of ['rostertable','attendancecards','waitlisttable','familytable','absencetable','reportcontent'])$('#'+id).innerHTML=workspacePicker('Choose a program to see its '+({rostertable:'participants',attendancecards:'attendance',waitlisttable:'waitlist',familytable:'families',absencetable:'absences',reportcontent:'reports'}[id])+'.');
  if(p&&!s)$('#attendancecards').innerHTML='<div class="panel empty">Choose a session above before checking participants in.</div>';
  for(const id of ['exportcsv','exportreport','openkiosk'])$('#'+id).disabled=!p||(id==='openkiosk'&&!s);
  if(s)$('#kiosksession').value=s.id;
  $$('#sessionlist .sessionrow').forEach((row,index)=>{const session=state.sessions[index];row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label','Open '+prog(session).name+' '+session.label);const choose=()=>{workspace.programId=session.program_id;workspace.sessionId=session.id;chooseSessionDate(session);applyWorkspace();view('roster')};row.onclick=choose;row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose()}}});
  $$('[data-choose-program]').forEach(b=>b.onclick=()=>{selectProgram(b.dataset.chooseProgram)});
}
function csvValue(value){const v=String(value??'');return '"'+(/^[=+@-]/.test(v)?"'":'')+v.replaceAll('"','""')+'"'}
function downloadCSV(name,rows){const url=URL.createObjectURL(new Blob([rows.map(r=>r.map(csvValue).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function downloadScopedRoster(){if(!workspace.programId)return;downloadCSV('roster-'+workspace.date+'.csv',[['Program','Session','Participant','Guardian','Email','Status'],...state.registrations.filter(r=>r.status==='enrolled').map(r=>{const s=state.sessions.find(s=>s.id===r.session_id),p=person(r.participant_id),f=state.families.find(f=>f.id===p.family_id)||{};return [prog(s).name,s.label,p.name,f.name,f.email,r.status]})])}
function downloadScopedReport(){if(!workspace.programId)return;const table=$('#reportcontent table');if(table)downloadCSV('report-'+workspace.date+'.csv',[...table.rows].map(r=>[...r.cells].map(c=>c.textContent.trim())));else notify('There are no report rows to export.')}
$('#contextprogram').onchange=e=>selectProgram(e.target.value);
$('#contextsession').onchange=e=>{workspace.sessionId=e.target.value;const s=allState.sessions.find(s=>s.id===workspace.sessionId);if(s)chooseSessionDate(s);applyWorkspace()};
$('#contextdate').onchange=e=>{if(e.target.value){workspace.date=e.target.value;applyWorkspace()}};
$('#clearcontext').onclick=()=>{workspace.programId='';workspace.sessionId='';workspace.date=localDateISO();applyWorkspace();view('home')};

boot();
