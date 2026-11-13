// Admin-only send/preview/history for Beadlight remote push.
// Never store Apple credentials, service-role tokens, or APNs device tokens in the browser.
const projectUrl=Deno.env.get("SUPABASE_URL")!;
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey=Deno.env.get("SUPABASE_ANON_KEY")!;
const jsonHeaders={apikey:serviceKey,Authorization:"Bearer "+serviceKey,Accept:"application/json","Content-Type":"application/json"};
const reply=(status:number,data:Record<string,unknown>)=>
  new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store",
    "Access-Control-Allow-Origin":"https://beadlight.app","Access-Control-Allow-Headers":"authorization,apikey,content-type",
    "Access-Control-Allow-Methods":"POST,OPTIONS"}});
async function db(path:string,method="GET",body?:unknown){
  const h:Record<string,string>={...jsonHeaders};
  if(method==="POST"||method==="PATCH")h.Prefer="return=representation";
  const resp=await fetch(projectUrl+"/rest/v1/"+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  return {ok:resp.ok,status:resp.status,data:await resp.json().catch(()=>[])};
}
const allowedSlug=(value:unknown):value is string=>typeof value==="string"&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const uuid=(value:unknown):value is string=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const creds=()=>({
  kid:Deno.env.get("APNS_KEY_ID")||"",team:Deno.env.get("APNS_TEAM_ID")||"",
  pem:Deno.env.get("APNS_PRIVATE_KEY")||"",topic:Deno.env.get("APNS_BUNDLE_ID")||""
});
function configured(c:ReturnType<typeof creds>){
  return Boolean(c.kid && c.team && c.pem && c.topic);
}
async function admin(request:Request){
  const bearer=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!bearer)return null;
  const auth=await fetch(projectUrl+"/auth/v1/user",{headers:{apikey:anonKey,Authorization:"Bearer "+bearer}});
  if(!auth.ok)return null;
  const user=await auth.json();
  if(!user?.email)return null;
  const verified=await db("admin_users?email=ilike."+encodeURIComponent(user.email)+"&select=email&limit=1");
  return verified.ok && verified.data.length===1 ? user.email as string : null;
}
type Device={installation_id:string;apns_token:string;apns_environment:string};
async function eligible(audience:string,slug:string|null,testID:string|null):Promise<{devices:Device[];limited:boolean}> {
  // Cap the synchronous edge sender to avoid gateway timeout and accidental mass sends.
  const column=audience==="challenge"?"challenge_updates":"general_announcements";
  const selected=await db("beadlight_push_devices?"+column+"=eq.true&select=installation_id,apns_token,apns_environment&limit=251");
  if(!selected.ok)throw Error("Unable to load opted-in device list");
  let devices:Device[]=selected.data;
  const limited=devices.length>250;
  if(testID)return {devices:devices.filter(d=>d.installation_id===testID),limited};
  if(audience==="challenge"){
    const members=await db("challenge_participations?challenge_slug=eq."+encodeURIComponent(slug||"")+"&select=installation_id&limit=5001");
    if(!members.ok)throw Error("Unable to load challenge registrations");
    if(members.data.length>5000)throw Error("Audience too large for synchronous sender");
    const registered=new Set(members.data.map((x:{installation_id:string})=>x.installation_id));
    devices=devices.filter(d=>registered.has(d.installation_id));
  }
  return {devices,limited};
}
function b64url(bytes:Uint8Array){
  let str="";for(const n of bytes)str+=String.fromCharCode(n);
  return btoa(str).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function providerJWT(c:ReturnType<typeof creds>){
  const pem=c.pem.replace(/\\n/g,"\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,"");
  const key=await crypto.subtle.importKey("pkcs8",
    Uint8Array.from(atob(pem),v=>v.charCodeAt(0)),
    {name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const header=b64url(new TextEncoder().encode(JSON.stringify({alg:"ES256",kid:c.kid})));
  const payload=b64url(new TextEncoder().encode(JSON.stringify({iss:c.team,iat:Math.floor(Date.now()/1000)})));
  const input=header+"."+payload;
  const signed=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,new TextEncoder().encode(input));
  return input+"."+b64url(new Uint8Array(signed));
}
async function deliver(device:Device,title:string,body:string,slug:string|null,jwt:string,topic:string){
  const endpoint=device.apns_environment==="sandbox"?"https://api.sandbox.push.apple.com":"https://api.push.apple.com";
  try {
    const result=await fetch(endpoint+"/3/device/"+device.apns_token,{
      method:"POST",headers:{"authorization":"bearer "+jwt,"apns-topic":topic,
        "apns-push-type":"alert","apns-priority":"10","content-type":"application/json"},
      body:JSON.stringify({aps:{alert:{title,body},sound:"default"},beadlight:slug?{challenge_slug:slug}:{}})
    });
    if(result.ok)return {delivered:true};
    const detail=await result.json().catch(()=>({}));
    if(result.status===410){
      // Apple says the token is no longer registered with this topic.
      await db("beadlight_push_devices?installation_id=eq."+encodeURIComponent(device.installation_id),"DELETE");
    }
    return {delivered:false,error:String(detail.reason||result.status)};
  }catch{return {delivered:false,error:"APNs gateway unreachable"};}
}
Deno.serve(async(request:Request)=>{
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":"https://beadlight.app","Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"}});
  if(request.method!=="POST")return reply(405,{error:"POST required"});
  try {
    const user=await admin(request);
    if(!user)return reply(403,{error:"Beadlight admin login required"});
    const raw=await request.text();
    if(raw.length>4000)return reply(413,{error:"Too large"});
    const input=JSON.parse(raw);
    const action=String(input.action||"");
    if(action==="history"){
      const history=await db("beadlight_push_campaigns?select=id,audience,challenge_slug,title,body,is_test,intended_count,delivered_count,failed_count,status,created_by,sent_at&order=sent_at.desc&limit=30");
      return history.ok?reply(200,{history:history.data}):reply(503,{error:"Could not fetch history"});
    }

    if(action==="segments_list"){
      const result=await db("beadlight_push_segments?select=*&order=created_at.desc&limit=100");
      return result.ok?reply(200,{segments:result.data}):reply(503,{error:"Could not load saved audiences"});
    }
    if(action==="segment_delete"){
      if(!uuid(input.segment_id))return reply(400,{error:"Invalid audience"});
      const result=await db("beadlight_push_segments?id=eq."+input.segment_id,"DELETE");
      return result.ok?reply(200,{deleted:true}):reply(503,{error:"Could not delete audience"});
    }
    if(action==="segment_save"){
      const name=String(input.name||"").trim();
      const group=input.segment_audience;
      const challenge=group==="challenge"?input.challenge_slug:null;
      const filter=String(input.subscription_filter||"any");
      const age=Number(input.min_app_age_days??0);
      const inactive=Number(input.inactive_min_days??0);
      const maxInactive=input.inactive_max_days==null?null:Number(input.inactive_max_days);
      const subscribed=Number(input.min_subscription_days??0);
      const validNum=(n:number)=>Number.isInteger(n)&&n>=0&&n<=3650;
      if(name.length<2||name.length>90||!["general","challenge"].includes(group)||
        !["any","free","trial","monthly","annual","lifetime","expired"].includes(filter)||
        (group==="challenge"&&!allowedSlug(challenge))||
        ![age,inactive,subscribed].every(validNum)||
        (maxInactive!==null&&(!validNum(maxInactive)||maxInactive<inactive)))
        return reply(400,{error:"Invalid audience rule"});
      const record={
        name,audience:group,challenge_slug:challenge,subscription_filter:filter,
        min_app_age_days:age,inactive_min_days:inactive,inactive_max_days:maxInactive,
        min_subscription_days:subscribed
      };
      if(input.segment_id && !uuid(input.segment_id))return reply(400,{error:"Invalid audience identifier"});
      const existing=input.segment_id ? await db("beadlight_push_segments?id=eq."+input.segment_id+"&select=id") : null;
      if(existing&&!existing.data?.length)return reply(404,{error:"Audience not found"});
      const result=existing
        ?await db("beadlight_push_segments?id=eq."+input.segment_id,"PATCH",record)
        :await db("beadlight_push_segments","POST",{...record,created_by:user});
      return result.ok&&result.data?.[0]?reply(200,{segment:result.data[0]}):reply(503,{error:"Failed to save audience"});
    }
    if(!["preview","test","send"].includes(action))return reply(400,{error:"Invalid action"});

    const segmentID=input.segment_id??null;
    if(segmentID!==null && !uuid(segmentID))return reply(400,{error:"Invalid saved audience"});
    let savedSegment:any=null;
    if(segmentID){
      const saved=await db("beadlight_push_segments?id=eq."+segmentID+"&select=*&limit=1");
      if(!saved.ok||saved.data.length!==1)return reply(404,{error:"Saved audience not found"});
      savedSegment=saved.data[0];
    }
    const audience=savedSegment?.audience??input.audience;
    const slug=audience==="challenge"?(savedSegment?.challenge_slug??input.challenge_slug):null;
    if(!["challenge","general"].includes(audience)|| (audience==="challenge"&&!allowedSlug(slug)))
      return reply(400,{error:"Choose a valid audience and challenge"});
    if(slug){
      const existing=await db("rosary_challenges?slug=eq."+encodeURIComponent(slug)+"&is_published=eq.true&select=slug&limit=1");
      if(slug!=="daily"&&(!existing.ok||existing.data.length!==1))
        return reply(400,{error:"Challenge is not currently published"});
    }
    const testID=action==="test"?input.test_installation_id:null;
    if(action==="test"&&!uuid(testID))return reply(400,{error:"Enter a valid iPhone test device ID"});

    let result:{devices:Device[];limited:boolean;total?:number};
    if(savedSegment && action!=="test"){
      const found=await db("rpc/beadlight_push_segment_candidates","POST",{p_segment_id:segmentID});
      if(!found.ok||!found.data)return reply(503,{error:"Audience evaluation unavailable"});
      const data=found.data;
      result={devices:data.devices||[],limited:Number(data.total_count)>150,
        total:Number(data.total_count)};
    } else {
      result=await eligible(audience,slug,testID);
    }
    const recipients=result.devices;
    const ready=configured(creds());
    const recentTest=await db("beadlight_push_campaigns?is_test=eq.true&delivered_count=gt.0&select=id&limit=1");
    const tested=recentTest.ok && recentTest.data.length>0;
    if(action==="preview")return reply(200,{

      eligible_devices:result.total??recipients.length,limited:result.limited,apns_configured:ready,
      subscription_verification_configured:Boolean(Deno.env.get("REVENUECAT_SECRET_API_KEY")),
      requires_subscription_verification:Boolean(savedSegment&&savedSegment.subscription_filter!=="any"),
      successful_test_recorded:tested,ready_to_send:ready&&tested&&!result.limited&&
        Boolean(savedSegment||audience==="challenge")&&
        Boolean(!savedSegment||savedSegment.subscription_filter==="any"||Deno.env.get("REVENUECAT_SECRET_API_KEY"))
    });
    const title=String(input.title||"").trim(),body=String(input.body||"").trim();
    if(title.length<1||title.length>100||body.length<1||body.length>240)
      return reply(400,{error:"Title must be 1–100 characters and message 1–240 characters"});
    if(input.confirm!==true||input.confirmation_phrase!=="SEND")
      return reply(400,{error:"Explicit send confirmation required"});
    if(!ready)return reply(409,{error:"APNs secrets not configured. Configure Apple key, team and bundle ID first."});
    if(result.limited||recipients.length>150)return reply(409,{error:"Audience is too large for the current 150-device synchronous sender. Batch delivery is required."});

    if(action==="send"&&!tested)return reply(409,{error:"Send one successful test notification before broadcasting."});
    if(action==="send"&&audience==="general"&&!savedSegment)
      return reply(409,{error:"Choose a saved audience to apply the weekly marketing frequency cap."});
    if(action==="send"&&savedSegment?.subscription_filter!=="any"&&
       !Deno.env.get("REVENUECAT_SECRET_API_KEY"))
      return reply(409,{error:"Configure server-side RevenueCat verification before targeting subscription types."});
    if(!recipients.length)return reply(409,{error:"No devices eligible for this message. Check app opt-in and challenge registration."});
    const token=await providerJWT(creds());
    // Log the send before doing external I/O to keep an audit trail.
    const written=await db("beadlight_push_campaigns","POST",{

      audience,challenge_slug:slug,title,body,is_test:action==="test",
      segment_id:segmentID,intended_count:recipients.length,created_by:user,status:"sending"
    });
    if(!written.ok||!written.data[0]?.id)return reply(503,{error:"Could not log the send; no notifications sent"});
    const id=written.data[0].id;

    let ok=0,failed=0;
    const acceptedInstallations:string[]=[];
    const failures:Record<string,number>={};
    // Send in batches of 10 to avoid saturating the APNs server.
    for(let i=0;i<recipients.length;i+=10){

      const batch=recipients.slice(i,i+10);
      const slice=await Promise.all(batch.map(d=>deliver(d,title,body,slug,token,creds().topic)));
      for(let j=0;j<slice.length;j++){
        const output=slice[j];
        if(output.delivered){ok++;acceptedInstallations.push(batch[j].installation_id);}
        else {failed++;const reason=output.error||"Unknown";failures[reason]=(failures[reason]||0)+1;}
      }
    }

    if(action==="send"&&audience==="general"&&acceptedInstallations.length){
      const rows=acceptedInstallations.map(installation_id=>({campaign_id:id,installation_id}));
      const recorded=await db("beadlight_push_deliveries","POST",rows);
      if(!recorded.ok)return reply(503,{error:"APNs accepted messages, but delivery frequency audit could not be recorded. Pause additional sends and investigate."});
    }
    const status=failed===0?"sent":ok>0?"partial":"failed";
    await db("beadlight_push_campaigns?id=eq."+id,"PATCH",{delivered_count:ok,failed_count:failed,status});
    return reply(200,{id,status,eligible_devices:recipients.length,accepted_by_apns:ok,failed,
      errors:failures}); // APNs acceptance is NOT guaranteed device presentation.
  } catch(error){
    return reply(500,{error:"Push operation failed: "+String((error as Error)?.message||"Unknown")});
  }
});