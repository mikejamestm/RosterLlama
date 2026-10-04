const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const http=require('node:http');
const base='http://127.0.0.1:4207';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){
  const child=spawn(process.execPath,['-e',"const db=require('./database');const migrate=db.migrate;let first=true;db.migrate=async()=>{if(first){first=false;throw Error('simulated temporary database startup failure')}return migrate()};require('./server')"],{cwd:__dirname,env:{...process.env,PORT:'4207',SESSION_SECRET:process.env.SESSION_SECRET||'reliability-test-session-secret'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  try{
    let ready=false;for(let i=0;i<120;i++){try{const r=await fetch(base+'/ready');if(r.ok){ready=true;break}}catch{}await pause(250)}
    assert(ready,'Readiness failed: '+logs);assert.match(logs,/initialization attempt 1 failed/);assert.match(logs,/PostgreSQL schema ready/);
    let r=await fetch(base+'/api/login',{method:'POST',body:'{bad json'});assert.equal(r.status,400);
    r=await fetch(base+'/api/login',{method:'POST',body:'x'.repeat(1024*1024+1)});assert.equal(r.status,413);
    await new Promise(resolve=>{const req=http.request(base+'/api/login',{method:'POST',headers:{'content-length':10000}});req.on('error',()=>resolve());req.write('{');setTimeout(()=>{req.destroy();resolve()},30)});
    for(let i=0;i<20;i++){r=await fetch(base+'/ready');assert.equal(r.status,200)}
    child.kill('SIGTERM');const result=await Promise.race([exited,pause(10000).then(()=>{throw Error('Shutdown timed out')})]);
    assert.deepEqual(result,{code:0,signal:null});assert.match(logs,/Graceful shutdown: SIGTERM/);
    console.log('Reliability tests passed: malformed and oversized requests, aborted client, repeated readiness, clean SIGTERM');
  }finally{if(child.exitCode===null&&!child.killed)child.kill('SIGKILL')}
}
run().catch(e=>{console.error(e);process.exitCode=1});
