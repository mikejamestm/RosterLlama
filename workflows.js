// Device-scoped pickup and platform subscription workflows. PostgreSQL is authoritative.
const crypto = require('crypto');
const fail = (status, message) => Object.assign(new Error(message), {status});
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizeName = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
function isAuthorizedAdult(participant, guardian, adult) {
  const names = (participant.authorized_pickups || []).map(p => typeof p === 'string' ? p : p.name);
  if (guardian) names.push(guardian);
  return !!normalizeName(adult) && names.some(name => normalizeName(name) === normalizeName(adult));
}
function isLate(session, timezone, now = new Date()) {
  if (!/^\d{2}:\d{2}$/.test(session.end_time || '')) return false;
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone: timezone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle:'h23'}).formatToParts(now);
  return parts.find(p => p.type === 'hour').value + ':' + parts.find(p => p.type === 'minute').value > session.end_time;
}

function eligibleAge(participant, program, session) {
  if (program.age_min == null && program.age_max == null) return true;
  let age = participant.age == null || String(participant.age).trim()==='' ? NaN : Number(participant.age);
  if (participant.birth_date) {
    const birth = String(participant.birth_date).slice(0,10), reference = session.start_date || new Date().toISOString().slice(0,10);
    age = Number(reference.slice(0,4))-Number(birth.slice(0,4))-(reference.slice(5)<birth.slice(5)?1:0);
  }
  return Number.isFinite(age) && (program.age_min == null || age >= program.age_min) && (program.age_max == null || age <= program.age_max);
}

function createWorkflows(ctx) {
  const {database, json, body, cookies, requireAuth, requireRole, id, dateInZone, stripeRequest, stripeGet} = ctx;
  const ready = () => { if (!ctx.ready()) throw fail(503, 'This service is temporarily unavailable.'); };
  const cookie = (req, token, age) => 'rl_kiosk=' + token + '; Path=/api/kiosk; HttpOnly; SameSite=Strict; Max-Age=' + age + ((req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted) ? '; Secure' : '');
  async function grant(client, req, lock=false) {
    const token = cookies(req).rl_kiosk;
    if (!token) throw fail(401, 'Ask staff to set up this pickup device.');
    const result = await client.query("select k.*,o.name,o.timezone from pickup_devices k join organizations o on o.id=k.organization_id where k.token_hash=$1 and k.revoked_at is null and k.expires_at>now()" + (lock ? ' for update of k' : ''), [digest(token)]);
    if (!result.rowCount) throw fail(401, 'This pickup device has expired or been closed. Ask staff to reopen it.');
    return result.rows[0];
  }
  async function handle(req, res, u, d) {
    if (!u.pathname.startsWith('/api/kiosk') && !u.pathname.startsWith('/api/billing/subscription')) return false;
    try {
      ready();
      if (req.method === 'POST' && u.pathname === '/api/kiosk/devices') {
        const a = requireAuth(req,res,d); if (!a) return true;
        const x = await body(req), sessions = [...new Set(Array.isArray(x.session_ids) ? x.session_ids : [])];
        if (!sessions.length || sessions.length > 100) throw fail(400, 'Choose at least one session for this device.');
        const token = crypto.randomBytes(32).toString('base64url'), expires = new Date(Date.now()+12*3600e3);
        await database.withTransaction(async c => {
          const result = await c.query('select s.id from sessions s join programs p on p.id=s.program_id where p.organization_id=$1 and s.id=any($2::text[])', [a.org.id,sessions]);
          if (result.rowCount !== sessions.length) throw fail(403, 'Invalid session selection.');
          await c.query('insert into pickup_devices(id,organization_id,token_hash,session_ids,expires_at,created_by) values($1,$2,$3,$4,$5,$6)', [id('device'),a.org.id,digest(token),sessions,expires,a.owner?.id||a.staff?.id]);
        });
        json(res,201,{url:'/pickup#token='+token,expires_at:expires.toISOString()}); return true;
      }
      if (req.method === 'POST' && u.pathname === '/api/kiosk/devices/revoke') {
        const a = requireAuth(req,res,d); if (!a) return true;
        await database.withTransaction(c=>c.query('update pickup_devices set revoked_at=now() where organization_id=$1 and revoked_at is null',[a.org.id]));
        json(res,200,{ok:true}); return true;
      }
      if (req.method === 'POST' && u.pathname === '/api/kiosk/activate') {
        const x = await body(req), token = String(x.token || '');
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw fail(401, 'This pickup link is invalid.');
        const g = await database.withTransaction(c=>grant(c,{headers:{cookie:'rl_kiosk='+token}}));
        json(res,200,{ok:true},{'set-cookie':cookie(req,token,Math.max(0,Math.floor((new Date(g.expires_at)-Date.now())/1000)))});return true;
      }
      if (req.method === 'POST' && u.pathname === '/api/kiosk/logout') {
        // Close this device without requiring access to the staff account.
        await database.withTransaction(async c=>{const g=await grant(c,req,true);await c.query('update pickup_devices set revoked_at=now() where id=$1',[g.id])});
        json(res,200,{ok:true},{'set-cookie':cookie(req,'',0)});return true;
      }
      if (req.method === 'GET' && u.pathname === '/api/kiosk/me') {
        const data = await database.withTransaction(async c=>{
          const g=await grant(c,req),day=dateInZone(g.timezone);
          const rows=await c.query("select distinct p.id as participant_id,p.name,s.id as session_id,s.label,pr.name as program_name from registrations r join participants p on p.id=r.participant_id join sessions s on s.id=r.session_id join programs pr on pr.id=s.program_id where r.organization_id=$1 and r.status='enrolled' and s.id=any($2::text[]) and exists(select 1 from attendance a where a.organization_id=$1 and a.participant_id=p.id and a.session_id=s.id and a.service_date=$3 and a.action='checkin') and not exists(select 1 from attendance a where a.participant_id=p.id and a.session_id=s.id and a.service_date=$3 and a.action='checkout') order by p.name",[g.organization_id,g.session_ids,day]);
          return {organization_name:g.name,service_date:day,participants:rows.rows,expires_at:g.expires_at};
        });json(res,200,data);return true;
      }
      if (req.method === 'POST' && u.pathname === '/api/kiosk/signouts') {
        const x=await body(req),adult=String(x.adult||'').trim(),initials=String(x.initials||'').trim().toUpperCase();
        if (!adult || adult.length>160 || !/^[\p{L}]{1,8}$/u.test(initials)) throw fail(400,'Enter your full name and initials.');
        const rec=await database.withTransaction(async c=>{
          const g=await grant(c,req,true);
          if (!g.session_ids.includes(x.session_id)) throw fail(403,'This session is not available on this device.');
          const rr=await c.query("select r.id,p.authorized_pickups,f.name as guardian,s.end_time from registrations r join participants p on p.id=r.participant_id join families f on f.id=p.family_id join sessions s on s.id=r.session_id where r.organization_id=$1 and r.participant_id=$2 and r.session_id=$3 and r.status='enrolled' for update of r",[g.organization_id,x.participant_id,x.session_id]);
          if(!rr.rowCount)throw fail(409,'This participant is no longer available for pickup.');
          if(!isAuthorizedAdult(rr.rows[0],rr.rows[0].guardian,adult))throw fail(403,'Please see staff. This name is not listed as an authorized pickup adult.');
          const at=new Date(),day=dateInZone(g.timezone,at),acts=await c.query('select action from attendance where participant_id=$1 and session_id=$2 and service_date=$3',[x.participant_id,x.session_id,day]);
          if(!acts.rows.some(a=>a.action==='checkin')||acts.rows.some(a=>a.action==='checkout'))throw fail(409,'This participant is not currently checked in. Please see staff.');
          const rec={id:id('out'),organization_id:g.organization_id,participant_id:x.participant_id,session_id:x.session_id,adult,initials,authorized:true,late:isLate(rr.rows[0],g.timezone),service_date:day,at:at.toISOString()};
          await c.query('insert into signouts(id,organization_id,participant_id,session_id,pickup_name,initials,authorized,late,service_date,created_at) values($1,$2,$3,$4,$5,$6,true,$7,$8,$9)',[rec.id,g.organization_id,x.participant_id,x.session_id,adult,initials,rec.late,day,at]);
          rec.attendance={id:id('att'),organization_id:g.organization_id,participant_id:x.participant_id,session_id:x.session_id,action:'checkout',service_date:day,at:rec.at};
          await c.query("insert into attendance(id,organization_id,participant_id,session_id,action,service_date,at,actor_id) values($1,$2,$3,$4,'checkout',$5,$6,$7)",[rec.attendance.id,g.organization_id,x.participant_id,x.session_id,day,at,g.id]);
          await c.query("insert into audit_log(id,organization_id,actor_type,actor_id,action,detail) values($1,$2,'kiosk',$3,'pickup.signed_out',$4::jsonb)",[id('audit'),g.organization_id,g.id,JSON.stringify({participant_id:x.participant_id,session_id:x.session_id,signout_id:rec.id})]);
          return rec;
        });
        // Merge into the latest snapshot rather than the pre-transaction request snapshot.
        const latest=ctx.load();latest.signouts=latest.signouts||[];latest.signouts.push(rec);latest.attendance.push(rec.attendance);ctx.save(latest);
        json(res,201,{ok:true,late:rec.late});return true;
      }
      if (u.pathname.startsWith('/api/billing/subscription')) {
        const a=requireRole(req,res,d,['owner']);if(!a)return true;
        const configured=!!(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_SUBSCRIPTION_PRICE_ID&&process.env.STRIPE_WEBHOOK_SECRET);
        const origin=process.env.PUBLIC_BASE_URL || ('https://'+process.env.RAILWAY_PUBLIC_DOMAIN);
        if(req.method==='GET'&&u.pathname==='/api/billing/subscription') {
          const result=await database.withTransaction(c=>c.query('select status,cancel_at_period_end,current_period_end,customer_id from platform_billing where organization_id=$1',[a.org.id]));
          const b=result.rows[0]||{};json(res,200,{configured,status:b.status||'not_started',cancel_at_period_end:!!b.cancel_at_period_end,current_period_end:b.current_period_end||null,can_manage:!!b.customer_id});return true;
        }
        if(!configured)throw fail(503,'Subscription plans are not available yet.');
        if(!/^https:\/\/[^/]+/.test(origin)||origin.includes('undefined'))throw fail(503,'Subscription setup is temporarily unavailable.');
        const returnUrl=origin.replace(/\/$/,'')+'/app#settings';
        if(req.method==='POST'&&u.pathname==='/api/billing/subscription/start'){
          const result=await database.withTransaction(async c=>{
            await c.query('insert into platform_billing(organization_id) values($1) on conflict do nothing',[a.org.id]);
            const b=(await c.query('select * from platform_billing where organization_id=$1 for update',[a.org.id])).rows[0];
            if(b.subscription_id&&!['canceled','incomplete_expired'].includes(b.status))throw fail(409,'A subscription already exists. Use Manage subscription.');
            if(!b.customer_id){const customer=await stripeRequest('/v1/customers',{email:a.owner.email,name:a.org.name,'metadata[organization_id]':a.org.id},{idempotencyKey:'platform-customer-'+a.org.id});b.customer_id=customer.id;await c.query('update platform_billing set customer_id=$2 where organization_id=$1',[a.org.id,b.customer_id])}
            if(b.checkout_id&&!['canceled','incomplete_expired'].includes(b.status)){const existing=await stripeGet('/v1/checkout/sessions/'+encodeURIComponent(b.checkout_id));if(existing.status==='open'&&existing.url)return {checkout_url:existing.url};if(existing.status==='complete')throw fail(409,'Your subscription is being confirmed. Refresh in a moment.');}
            // Reuse a request key across retries, even if Stripe succeeds before the database commit.
            const key='platform-checkout-'+a.org.id+'-'+(b.checkout_id||'first');
            const checkout=await stripeRequest('/v1/checkout/sessions',{mode:'subscription',customer:b.customer_id,'line_items[0][price]':process.env.STRIPE_SUBSCRIPTION_PRICE_ID,'line_items[0][quantity]':'1','metadata[organization_id]':a.org.id,'subscription_data[metadata][organization_id]':a.org.id,client_reference_id:a.org.id,success_url:origin.replace(/\/$/,'')+'/app?subscription=confirming#settings',cancel_url:returnUrl},{idempotencyKey:key});
            await c.query('update platform_billing set checkout_id=$2 where organization_id=$1',[a.org.id,checkout.id]);return {checkout_url:checkout.url};
          });json(res,200,result);return true;
        }
        if(req.method==='POST'&&u.pathname==='/api/billing/subscription/portal'){
          const b=await database.withTransaction(c=>c.query('select customer_id from platform_billing where organization_id=$1',[a.org.id]));
          if(!b.rows[0]?.customer_id)throw fail(409,'Start a subscription first.');
          const portal=await stripeRequest('/v1/billing_portal/sessions',{customer:b.rows[0].customer_id,return_url:returnUrl});json(res,200,{portal_url:portal.url});return true;
        }
      }
      json(res,404,{error:'Unknown workflow.'});return true;
    }catch(e){json(res,e.code==='23505'?409:e.status||500,{error:e.code==='23505'?'This pickup has already been recorded.':e.message});return true;}
  }
  async function webhook(event) {
    const obj=event.data?.object||{},isSubscription=event.type.startsWith('customer.subscription.')||(event.type.startsWith('checkout.session.')&&obj.mode==='subscription');
    if(!isSubscription)return false;
    if(event.account)return true; // Platform subscriptions never belong to a connected account.
    const orgId=obj.metadata?.organization_id;
    if(!orgId)return true;
    await database.withTransaction(async c=>{
      const br=await c.query('select * from platform_billing where organization_id=$1 for update',[orgId]);
      if(!br.rowCount||br.rows[0].customer_id!==String(obj.customer?.id||obj.customer||''))throw fail(409,'Subscription customer does not match the organization.');
      const b=br.rows[0];
      const seen=await c.query('select 1 from platform_billing_events where event_id=$1',[event.id]);if(seen.rowCount)return;
      const subscriptionId=String(obj.subscription?.id||obj.subscription|| (obj.object==='subscription'?obj.id:'')||'');
      if(subscriptionId){
        if(b.subscription_id&&b.subscription_id!==subscriptionId&&Number(event.created)<=Number(b.last_event_created||0))return;
        if(b.subscription_id&&b.subscription_id!==subscriptionId&&!['canceled','incomplete_expired'].includes(b.status))throw fail(409,'Subscription does not match the organization.');
        // Fetch the current Stripe object so out-of-order deliveries cannot restore stale status.
        const sub=await stripeGet('/v1/subscriptions/'+encodeURIComponent(subscriptionId));
        if(String(sub.customer?.id||sub.customer)!==b.customer_id||sub.metadata?.organization_id!==orgId)throw fail(409,'Subscription ownership does not match.');
        if(b.subscription_id!==subscriptionId&&Number(event.created)<Number(b.last_event_created||0))return;
        const end=sub.current_period_end||sub.items?.data?.[0]?.current_period_end;
        await c.query('update platform_billing set subscription_id=$2,status=$3,cancel_at_period_end=$4,current_period_end=$5,last_event_created=greatest(last_event_created,$6),updated_at=now() where organization_id=$1',[orgId,sub.id,sub.status,!!sub.cancel_at_period_end,end?new Date(end*1000):null,event.created||0]);
        await c.query('update organizations set subscription_status=$2 where id=$1',[orgId,sub.status]);
      }
      await c.query('insert into platform_billing_events(event_id,organization_id,type) values($1,$2,$3)',[event.id,orgId,event.type]);
    });
    return true;
  }
  return {handle,webhook};
}
module.exports={createWorkflows,isAuthorizedAdult,isLate,eligibleAge};
