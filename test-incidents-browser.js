const {chromium}=require('playwright'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const base='http://127.0.0.1:4212',organization={id:'incident_ui',name:'Bay Youth Programs',timezone:'UTC',slug:'bay'};
const programs=[{id:'p1',name:'Bay Explorers',questions:[],addons:[]},{id:'p2',name:'Kinder Camp',questions:[],addons:[]}],sessions=[{id:'s1',program_id:'p1',label:'October 4 morning',status:'open',capacity:10},{id:'s2',program_id:'p2',label:'October 4 afternoon',status:'open',capacity:10}];
const data={organization,programs,sessions,participants:[{id:'kid',family_id:'fam',name:'Avery Garcia'}],families:[{id:'fam',name:'Morgan Garcia',email:'guardian@test.local'}],registrations:[{id:'r1',participant_id:'kid',session_id:'s1',status:'enrolled'}],waitlist:[],attendance:[],absences:[],staff:[],payments:[],refunds:[],payouts:[],disputes:[],communications:[],signouts:[],registration_requests:[],audit:[]};
const report={id:'i1',participant_id:'kid',session_id:'s1',participant_name:'Avery Garcia',program_name:'Bay Explorers',session_label:'October 4 morning',occurred_at:'2026-10-01T10:15:00Z',kind:'injury',title:'Playground fall',description:'Avery tripped near the play area. <script>bad()</script>',actions_taken:'Staff checked in with Avery and called the guardian.',internal_notes:'PRIVATE STAFF NOTE',status:'submitted',version:2,addenda:[],can_edit:false};
(async()=>{const server=spawn(process.execPath,['server.js'],{env:{...process.env,DATABASE_URL:'',PORT:'4212'},stdio:'inherit'});let browser;
try{for(let i=0;i<50;i++){try{await fetch(base+'/app');break}catch{}await new Promise(r=>setTimeout(r,200))}browser=await chromium.launch({headless:true});
 for(const width of [390,768,1280]){
 let incident={...report},acks=[];const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{const req=route.request(),u=new URL(req.url()),path=u.pathname;let result={};
 if(path==='/api/me')result={organization,owner:{name:'Owner'},role:'owner'};
 if(path==='/api/dashboard')result=data;
 if(path==='/api/billing/subscription')result={configured:false};
 if(path==='/api/operations/incidents')result=req.method()==='GET'?{incidents:u.searchParams.get('program')==='p1'?[incident]:[],can_review:true}:{id:'i2',version:1};
 if(path.endsWith('/approve')){assert.equal(req.postDataJSON().version,2);incident={...incident,status:'approved',version:3};result={ok:true}}
 if(path==='/api/family/me')result={family:data.families[0],...data,registration_requests:[]};
 if(path==='/api/family/incidents'){const {internal_notes,...publicReport}=incident;result={incidents:[publicReport]}}
 if(path.endsWith('/acknowledge')){acks.push(req.postDataJSON());incident={...incident,acknowledged_at:new Date().toISOString(),acknowledged_name:'Morgan Garcia'};result={ok:true}}
 await route.fulfill({json:result});});
 await page.goto(base+'/app#safety');await page.locator('#incidentlist [data-choose-program]').first().waitFor();assert.ok(await page.locator('#newincident').isDisabled());
 await page.locator('#contextprogram').selectOption('p1');await page.locator('[data-report="i1"]').waitFor();await page.screenshot({path:'incident-staff-'+width+'.png',fullPage:true});
 await page.locator('[data-report="i1"]').click();assert.ok((await page.locator('#incidentdetail').textContent()).includes('PRIVATE STAFF NOTE'));assert.equal(await page.locator('#incidentdetail script').count(),0);
 await page.locator('[data-incidentaction="approve"]').click();await page.locator('#confirmok').click();await page.locator('#incidentdetaildialog').waitFor({state:'hidden'});
 await page.locator('#contextprogram').selectOption('p2');await page.locator('#incidentlist .empty').waitFor();assert.equal(await page.locator('[data-report]').count(),0);
 await page.locator('#contextprogram').selectOption('p1');await page.locator('#newincident').click();assert.equal(await page.locator('#incidentsession').inputValue(),'s1');assert.equal(await page.locator('#incidentparticipant').inputValue(),'');await page.locator('[data-close="incidentdialog"]').first().click();
 await page.goto(base+'/family');await page.locator('[data-familyincident="i1"]').waitFor();assert.ok(!(await page.locator('#familyapp').textContent()).includes('PRIVATE STAFF NOTE'));await page.locator('[data-familyincident="i1"]').click();await page.screenshot({path:'incident-family-'+width+'.png'});
 await page.locator('#incidentackagree').check();await page.locator('#incidentacksubmit').click();await page.locator('#familyincidentdialog').waitFor({state:'hidden'});assert.equal(acks.length,1);assert.equal(acks[0].version,3);assert.equal(acks[0].agree,true);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal page overflow');assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Incident staff review and family acknowledgment UI passed at mobile, tablet, desktop widths');
}finally{if(browser)await browser.close();server.kill('SIGTERM')}})().catch(e=>{console.error(e);process.exit(1)});
