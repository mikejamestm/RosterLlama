// Explicit publishing controls, independent of whether registration is open or closed.
function isPublished(org,program,session){return program?.published!==false&&session?.published!==false&&!(org?.hidden_categories||[]).includes(program?.category||'');}
function createPublishing(ctx){
 return async function(req,res,u,d){
  if(req.method!=='PATCH'||u.pathname!=='/api/website/publishing')return false;
  const a=ctx.requireRole(req,res,d,['owner','manager']);if(!a)return true;
  if(!ctx.ready()){ctx.json(res,503,{error:'Website settings are temporarily unavailable.'});return true}
  try{
   const x=await ctx.body(req);
   if(!['program','session','category'].includes(x.type)||typeof x.published!=='boolean')throw Object.assign(Error('Choose an item and its publication status.'),{status:400});
   await ctx.database.withTransaction(async c=>{
    // All publication changes acquire session locks in the same order as public enrollment.
    await c.query('select s.id from sessions s join programs p on p.id=s.program_id where p.organization_id=$1 order by s.id for update of s',[a.org.id]);
    if(x.type==='program'){
     const r=await c.query('update programs set published=$3 where id=$1 and organization_id=$2 returning id',[String(x.id),a.org.id,x.published]);if(!r.rowCount)throw Object.assign(Error('Program not found.'),{status:404});
    }else if(x.type==='session'){
     const r=await c.query('update sessions s set published=$3 from programs p where s.id=$1 and s.program_id=p.id and p.organization_id=$2 returning s.id',[String(x.id),a.org.id,x.published]);if(!r.rowCount)throw Object.assign(Error('Session not found.'),{status:404});
    }else{
     const category=String(x.id||'').trim();if(!category)throw Object.assign(Error('Choose a category.'),{status:400});
     const r=await c.query('select hidden_categories from organizations where id=$1 for update',[a.org.id]);const hidden=new Set(r.rows[0].hidden_categories||[]);if(x.published)hidden.delete(category);else hidden.add(category);
     await c.query('update organizations set hidden_categories=$2::jsonb where id=$1',[a.org.id,JSON.stringify([...hidden])]);
    }
    await c.query("insert into audit_log(id,organization_id,actor_type,actor_id,action,detail) values($1,$2,$3,$4,'website.publishing_updated',$5::jsonb)",[ctx.id('audit'),a.org.id,a.owner?'owner':'staff',a.owner?.id||a.staff?.id,JSON.stringify(x)]);
   });
   const latest=ctx.load();if(x.type==='category'){const org=latest.organizations.find(o=>o.id===a.org.id),hidden=new Set(org.hidden_categories||[]);if(x.published)hidden.delete(String(x.id).trim());else hidden.add(String(x.id).trim());org.hidden_categories=[...hidden]}else{const item=(x.type==='program'?latest.programs:latest.sessions).find(item=>item.id===x.id);if(item)item.published=x.published}ctx.save(latest);
   ctx.json(res,200,{ok:true});
  }catch(e){ctx.json(res,e.status||409,{error:e.message})}
  return true;
 };
}
module.exports={createPublishing,isPublished};
