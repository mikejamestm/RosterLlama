const fs=require('fs'),path=require('path');
let pool=null;
function getPool(){if(!process.env.DATABASE_URL)return null;if(!pool){const {Pool}=require('pg');pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}})}return pool}
async function migrate(){const p=getPool();if(!p)return {enabled:false};const sql=fs.readFileSync(path.join(__dirname,'db','schema.sql'),'utf8');await p.query(sql);return {enabled:true}}
async function check(){const p=getPool();if(!p)return {enabled:false};const r=await p.query('select now() as now');return {enabled:true,now:r.rows[0].now}}
async function withTransaction(fn){const p=getPool();if(!p)throw new Error('DATABASE_URL is not configured');const client=await p.connect();try{await client.query('BEGIN');const out=await fn(client);await client.query('COMMIT');return out}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}}
module.exports={getPool,migrate,check,withTransaction};
