// POST /functions/v1/beadlight-push-device
// Anonymous opt-in from the iOS app. Only a long random, per-installation proof
// can update an existing registration. Never return or log APNs tokens.
const url = Deno.env.get("SUPABASE_URL")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const headers = {
  apikey: service, Authorization: "Bearer " + service,
  "Content-Type": "application/json", Accept: "application/json"
};
const reply = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {status, headers: {"Content-Type":"application/json","Cache-Control":"no-store"}});
async function store(path:string, method="GET", body?:unknown) {
  const h:Record<string,string> = {...headers};
  if (method === "POST" || method === "PATCH") h.Prefer="return=representation";
  const res=await fetch(url+"/rest/v1/"+path, {method,headers:h,body: body ? JSON.stringify(body) : undefined});
  return {ok:res.ok,status:res.status,data:await res.json().catch(()=>[])};
}
async function digest(value:string):Promise<string> {
  const bytes=new TextEncoder().encode(value);
  const hash=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,"0")).join("");
}

// Server-side RevenueCat verification. We never trust a subscription tier supplied by the iPhone.
// This requires REVENUECAT_SECRET_API_KEY in Supabase Edge Function Secrets.
async function subscriberStatus(appUserId:string):Promise<{
  subscription_status:string;subscription_started_at:string|null;subscription_verified_at:string
}|null> {
  const secret=Deno.env.get("REVENUECAT_SECRET_API_KEY");
  if(!secret)return null;
  const res=await fetch("https://api.revenuecat.com/v1/subscribers/"+encodeURIComponent(appUserId),{
    headers:{Authorization:"Bearer "+secret,Accept:"application/json"}
  }).catch(()=>null);
  if(!res || !res.ok)return null;
  const body=await res.json().catch(()=>null);
  const subscriber=body?.subscriber;
  if(!subscriber || typeof subscriber!=="object")return null;
  const now=Date.now();
  const subs=Object.entries(subscriber.subscriptions||{}) as [string,any][];
  const premium=subscriber.entitlements?.premium;
  const isActive=(date:unknown)=> !date || (typeof date==="string" && Date.parse(date)>now);
  let status="free",started:null|string=null;
  const lifetime=(subscriber.non_subscriptions||{})["beadlight.guided.audio.lifetime"];
  if(lifetime?.length || (premium && !premium.expires_date)) {
    status="lifetime";
  } else if(premium && isActive(premium.expires_date)) {
    const active=subs.filter(([product,meta])=>
      ["beadlight.guided.audio.monthly","beadlight.guided.audio.annual"].includes(product)
      && isActive(meta.expires_date));
    active.sort((x,y)=>Date.parse(y[1].purchase_date||"0")-Date.parse(x[1].purchase_date||"0"));
    const [product,meta]=active[0]||["",{}];
    if(String(meta.period_type||"").toLowerCase()==="trial")status="trial";
    else if(product.includes("annual"))status="annual";
    else if(product.includes("monthly"))status="monthly";
    else status="unknown"; // prevent falsely marketing to verified premium with unrecognised plan
    const first=meta.original_purchase_date||meta.purchase_date;
    if(first && Number.isFinite(Date.parse(first)))started=new Date(first).toISOString();
  } else if(subs.length) {
    status="expired";
  }
  return {subscription_status:status,subscription_started_at:started,
    subscription_verified_at:new Date().toISOString()};
}

Deno.serve(async(request:Request)=>{
  if(request.method !== "POST") return reply(405,{error:"POST required"});
  try {
    const raw=await request.text();
    if(raw.length>4096) return reply(413,{error:"Request too large"});
    const data=JSON.parse(raw);
    const id=String(data.installation_id||"").toLowerCase();
    const secret=String(data.registration_secret||"");
    const token=String(data.token||"").toLowerCase();
    const environment=String(data.environment||"");
    const rcID=typeof data.revenuecat_app_user_id==="string"
      ?data.revenuecat_app_user_id.trim():"";
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
      || secret.length<64 || secret.length>128
      || !/^[0-9a-f]{64,256}$/.test(token)

      || !["sandbox","production"].includes(environment)
      || (rcID.length>255 || (rcID && !/^[A-Za-z0-9_.:$@+\-]{1,255}$/.test(rcID)))
      || typeof data.challenge_updates!=="boolean"
      || typeof data.general_announcements!=="boolean") return reply(400,{error:"Invalid device registration"});
    const hash=await digest(secret);
    const path="beadlight_push_devices?installation_id=eq."+encodeURIComponent(id);
    const old=await store(path+"&select=installation_id,registration_secret_hash,revenuecat_app_user_id,subscription_verified_at,subscription_status,subscription_started_at");
    if(!old.ok) return reply(503,{error:"Registration storage is unavailable"});
    const existing=old.data?.[0];
    if(existing && existing.registration_secret_hash!==hash)
      return reply(403,{error:"This installation is already registered"});
    const values={
      installation_id:id,registration_secret_hash:hash,apns_token:token,
      apns_environment:environment,challenge_updates:data.challenge_updates,

      general_announcements:data.general_announcements,
      last_seen_at:new Date().toISOString(),last_active_at:new Date().toISOString(),
      revenuecat_app_user_id:rcID || null
    };
    const previousVerified=existing?.subscription_verified_at;
    const stale=!previousVerified || Date.now()-Date.parse(previousVerified)>24*60*60*1000;
    if(rcID && (stale || existing?.revenuecat_app_user_id!==rcID)){
      const verified=await subscriberStatus(rcID);
      if(verified)Object.assign(values,verified);
      else if(existing?.revenuecat_app_user_id!==rcID){
        Object.assign(values,{subscription_status:"unknown",subscription_verified_at:null,
          subscription_started_at:null});
      }
    } else if(!rcID && existing?.revenuecat_app_user_id){
      Object.assign(values,{subscription_status:"unknown",subscription_verified_at:null,
        subscription_started_at:null});
    }
    let write=await store(existing ? path : "beadlight_push_devices",existing ? "PATCH" : "POST",values);
    // APNs may issue the same token after an app reinstall. Ownership of the
    // unpredictable token permits reattaching it to the new installation.
    if(!existing && !write.ok && write.status===409){
      const oldToken=await store("beadlight_push_devices?apns_token=eq."+encodeURIComponent(token)+"&select=installation_id");
      if(oldToken.ok && oldToken.data?.length===1){
        const stale=String(oldToken.data[0].installation_id);
        const removed=await store("beadlight_push_devices?installation_id=eq."+encodeURIComponent(stale),"DELETE");
        if(removed.ok)write=await store("beadlight_push_devices","POST",values);
      }
    }
    if(!write.ok) return reply(write.status===409?409:503,{error:write.status===409?"A push token is already registered":"Could not store push preferences"});
    return reply(200,{ok:true,challenge_updates:values.challenge_updates,general_announcements:values.general_announcements});
  } catch {
    return reply(400,{error:"Malformed registration request"});
  }
});