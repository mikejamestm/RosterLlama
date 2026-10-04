const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const base='http://127.0.0.1:4208';
const programs=Array.from({length:20},(_,i)=>({id:'program_'+i,name:i===0?'Bay Explorers Adventure and Nature Camp':i===1?'Kinder Camp':'Class '+(i+1),type:'camp',questions:[],addons:[],price:0,waitlist_mode:'manual'}));
const sessions=programs.flatMap((p,i)=>[0,1].map(j=>({id:'session_'+i+'_'+j,program_id:p.id,label:j?'October 12':'October 9',start_date:j?'2026-10-12T00:00:00.000Z':'2026-10-09T00:00:00.000Z',capacity:12,enrolled:1,available:11,status:'open'})));
const participants=sessions.map((s,i)=>({id:'kid_'+i,family_id:'family_'+i,name:'Participant '+i,authorized_pickups:['Guardian']}));
const registrations=sessions.map((s,i)=>({id:'reg_'+i,session_id:s.id,participant_id:'kid_'+i,status:'enrolled'}));
const organization={id:'workspace_test',name:'Twenty Program Organization',timezone:'America/Los_Angeles',slug:'workspace'};
const data={organization,programs,sessions,participants,registrations,families:participants.map((p,i)=>({id:p.family_id,name:'Guardian '+i,email:'guardian'+i+'@test.local'})),attendance:[],waitlist:[],staff:[],absences:[],payments:[],refunds:[],payouts:[],disputes:[],communications:[],signouts:[],registration_requests:[],audit:[]};
(async()=>{const server=spawn(process.execPath,['server.js'],{env:{...process.env,DATABASE_URL:'',PORT:'4208'},stdio:'inherit'});let browser;
try{
 for(let i=0;i<50;i++){try{await fetch(base+'/app');break}catch{}await new Promise(r=>setTimeout(r,200))}
 browser=await chromium.launch({headless:true});
 for(const width of [390,768,1280]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;
   if(req.method()==='POST'&&path.startsWith('/api/attendance/'))writes.push(req.postDataJSON());
   await route.fulfill({json:path==='/api/me'?{organization,owner:{name:'Owner'},role:'owner'}:path==='/api/dashboard'?data:path==='/api/billing/subscription'?{configured:false}: {}});
  });
  await page.route('**/health',route=>route.fulfill({json:{ok:true}}));await page.goto(base+'/app#roster');await page.locator('#contextprogram option').nth(20).waitFor({state:'attached'});
  assert.equal(await page.locator('#rostertable [data-transfer]').count(),0,'Roster must require a program selection');
  await page.locator('#contextprogram').selectOption('program_0');
  assert.equal(await page.locator('#rostertable [data-transfer]').count(),2);
  await page.locator('#contextsession').selectOption('session_0_0');
  assert.equal(await page.locator('#rostertable [data-transfer]').count(),1);
  assert.match(await page.locator('#rostertable').textContent(),/Participant 0/);
  assert.doesNotMatch(await page.locator('#rostertable').textContent(),/Participant 2/);await page.screenshot({path:'workspace-roster-'+width+'.png',fullPage:true});
  await page.locator('[data-view="staffportal"]').click();
  assert.match(await page.locator('#staffheading').textContent(),/Bay Explorers/);
  assert.match(await page.locator('#staffsubtitle').textContent(),/October 9/);
  await page.locator('#contextdate').fill('2099-10-09');
  assert.equal(await page.locator('#staffroster .primary').count(),0,'Future view cannot create a current-date check-in');
  assert.match(await page.locator('#staffdatewarning').textContent(),/only for today/);
  await page.locator('#contextprogram').selectOption('program_1');
  assert.equal(await page.locator('#staffroster .staffkid').count(),0,'Changing programs requires choosing the corresponding session');
  await page.locator('#contextsession').selectOption('session_1_1');
  assert.match(await page.locator('#staffroster').textContent(),/Participant 3/);
  assert.doesNotMatch(await page.locator('#staffroster').textContent(),/Participant 0/);await page.screenshot({path:'workspace-staff-'+width+'.png',fullPage:true});
  await page.locator('[data-view="families"]').click();
  assert.equal(await page.locator('.familyinvite').count(),1);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#contextsession').value==='session_1_1');
  assert.equal(await page.locator('#contextprogram').inputValue(),'program_1');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal page overflow');
  if(width<900){const height=await page.locator('aside').evaluate(e=>e.getBoundingClientRect().height);assert(height<100,'Mobile navigation must not cover several rows of content')}
  assert.equal(await page.locator('nav .build-dashboard').getAttribute('href'),'/control.html');
  assert.deepEqual(errors,[]);assert.equal(writes.length,0);await page.goto(base+'/control.html');await page.waitForFunction(()=>document.querySelector('#engines').textContent.includes('Medication administration'));assert.match(await page.locator('#engines').textContent(),/Not yet/);assert.match(await page.locator('#engines').textContent(),/NOT BUILT/);await page.screenshot({path:'workspace-progress-'+width+'.png',fullPage:true});assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Workspace browser tests passed: 20 programs, program/session isolation, date safety, persistence and mobile navigation');
}finally{await browser?.close();server.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
