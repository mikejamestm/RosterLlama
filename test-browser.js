// Browser smoke tests use deterministic API fixtures; integration tests cover persistence.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const base='http://127.0.0.1:4201';
const organization={id:'org_ui',name:'Browser Test Programs',slug:'ui',timezone:'America/Los_Angeles'};
const state={organization,programs:[{id:'program_ui',organization_id:organization.id,name:'Camp',type:'camp',price:1000,questions:[],addons:[],waitlist_mode:'manual'}],sessions:[{id:'session_ui',program_id:'program_ui',label:'First week',status:'open',capacity:10,enrolled:1,available:9,waitlist_count:0,start_date:'2026-07-01',end_date:'2026-07-05'}],families:[{id:'family_ui',name:'Guardian',email:'guardian@example.test'}],participants:[{id:'kid_ui',family_id:'family_ui',name:'Jamie'}],registrations:[{id:'reg_ui',session_id:'session_ui',participant_id:'kid_ui',status:'enrolled',payment_status:'not_required'}],attendance:[],waitlist:[],staff:[],absences:[],refunds:[],payments:[],payouts:[],disputes:[],signouts:[],registration_requests:[],communications:[]};
(async()=>{const p=spawn(process.execPath,['server.js'],{env:{...process.env,DATABASE_URL:'',PORT:'4201'},stdio:'inherit'});let browser;
try{
 for(let i=0;i<50;i++){try{await fetch(base+'/app');break}catch{}await new Promise(r=>setTimeout(r,200))}
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.error('Browser console:',m.text())});let created=null;
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;let response;
 if(path==='/api/me')response={organization,owner:{name:'Owner'},role:'owner'};
 else if(path==='/api/dashboard')response=state;
 else if(path==='/api/billing/subscription')response={configured:false,status:'not_started'};
 else if(path==='/api/communications/recipients')response={emails:['guardian@example.test'],count:1};
 else if(path.startsWith('/api/programs/'))response={...state.programs[0],...route.request().postDataJSON()};
 else if(path.startsWith('/api/sessions/'))response={...state.sessions[0],...route.request().postDataJSON()};
 else if(path==='/api/programs'){created=route.request().postDataJSON();response={program:created,sessions:[]}}
 else if(path==='/api/kiosk/devices')response={url:'/pickup#token=test',expires_at:'2026-10-04T12:00:00Z'};
 else response={};
 await route.fulfill({json:response});});
 await page.goto(base+'/app#settings');await page.locator('#orgdetails').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('#orgdetails').textContent.includes('Browser Test Programs'));
 assert.equal(await page.locator('#settings').isVisible(),true);assert.match(await page.locator('#subscriptionstatus').textContent(),/not available/);
 await page.locator('[data-view="families"]').click();assert.equal(await page.locator('.familyinvite').count(),1);
 await page.locator('[data-view="accounting"]').click();await page.locator('[data-acct="payouts"]').click();await page.locator('[data-acct="disputes"]').click();
 await page.locator('[data-view="roster"]').click();assert.equal(await page.locator('[data-transfer]').count(),1);
 await page.locator('nav [data-view="programs"]').click();await page.locator('#emailprograms').click();await page.locator('.email-session').check();await page.context().grantPermissions(['clipboard-read','clipboard-write']);await page.locator('#copyemails').click();await page.waitForFunction(()=>document.querySelector('#emailresult').textContent.includes('1 unique email'));await page.locator('#emaildialog .x').click();
 await page.locator('nav [data-view="programs"]').click();await page.getByRole('button',{name:'Edit program',exact:true}).click();await page.locator('#ephours').fill('6');await page.locator('#editprogramform .primary').click();await page.waitForFunction(()=>!document.querySelector('#editprogramdialog').open);await page.getByRole('button',{name:'Edit session',exact:true}).click();await page.locator('#esendtime').fill('16:00');await page.locator('#editsessionform .primary').click();await page.waitForFunction(()=>!document.querySelector('#editsessiondialog').open);await page.locator('#newprogram').click();await page.locator('#pname').fill('Browser created program');await page.locator('#psession').fill('Browser session');await page.locator('#pstart').fill('2026-07-01');await page.locator('#pend').fill('2026-07-05');await page.locator('.presetq[value="birthday"]').check();await page.locator('#addquestion').click();await page.locator('.cq-label').fill('Favorite activity');await page.locator('#programform button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('#programdialog').open);assert.equal(created.questions.length,2);assert.equal(created.questions[0].system_key,'birthday');
 await page.locator('[data-view="attendance"]').click();await page.locator('#openkiosk').click();await page.locator('#kiosklink a').waitFor();assert.match(await page.locator('#kiosklink a').getAttribute('href'),/pickup#token/);
 assert.deepEqual(errors,[],'Owner app must render without browser errors');
 // Tablet and mobile pickup flows, including failure recovery and clearing the previous adult.
 for(const width of [1024,390]){
 const pickup=await browser.newPage({viewport:{width,height:900}});const pickupErrors=[];pickup.on('pageerror',e=>pickupErrors.push(e.message));let remaining=true,attempts=0;
 await pickup.route('**/api/kiosk/**',async route=>{const path=new URL(route.request().url()).pathname;
 if(path.endsWith('/me'))return route.fulfill({json:{organization_name:organization.name,participants:remaining?[{participant_id:'kid_ui',name:'Jamie',session_id:'session_ui',label:'First week',program_name:'Camp'}]:[]}});
 if(path.endsWith('/signouts')){attempts++;if(attempts===1)return route.fulfill({status:403,json:{error:'Please see staff. Unauthorized pickup adult.'}});remaining=false;return route.fulfill({status:201,json:{ok:true}})}
 return route.fulfill({json:{ok:true}})});
 await pickup.goto(base+'/pickup#token=secret');assert.equal(new URL(pickup.url()).hash,'');await pickup.locator('.participant').click();await pickup.locator('#adult').fill('Unknown');await pickup.locator('#initials').fill('UU');await pickup.locator('#submit').click();await pickup.waitForFunction(()=>document.querySelector('#error').textContent.includes('Unauthorized'));
 await pickup.locator('#adult').fill('Guardian');await pickup.locator('#initials').fill('GG');await pickup.locator('#submit').click();await pickup.waitForFunction(()=>document.querySelector('#success').textContent.includes('Pickup recorded'));assert.equal(await pickup.locator('#adult').inputValue(),'');assert.equal(await pickup.locator('#sign').isVisible(),false);assert.equal(await pickup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(pickupErrors,[]);await pickup.close();
 }
 console.log('RosterLlama owner and pickup browser workflow tests passed');
}finally{await browser?.close();p.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
