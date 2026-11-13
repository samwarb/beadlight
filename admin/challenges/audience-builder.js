/* Beadlight Audience Builder: saves targeting rules, never handles private device records. */
(()=>{"use strict";
const client=window.beadlightAdminClient,$=id=>document.getElementById(id);
const f={saved:$("audienceSaved"),name:$("audienceName"),type:$("audienceType"),
challenge:$("audienceChallenge"),challengeLabel:$("audienceChallengeLabel"),
subscription:$("audienceSubscription"),age:$("audienceAppAge"),
inactive:$("audienceInactive"),inactiveMax:$("audienceInactiveMax"),
subscriptionAge:$("audienceSubscriptionAge"),status:$("audienceStatus"),push:$("pushAudience")};
let segments=[],currentId="",busy=false;
const message=(m,e=false)=>{f.status.textContent=m;f.status.classList.toggle("error",e);};
async function api(body){
  if(!client)throw Error("Sign in to Beadlight admin first.");
  const {data,error}=await client.functions.invoke("beadlight-push-admin",{body});
  if(error){const detail=await error.context?.json?.().catch(()=>null);throw Error(detail?.error||error.message);}
  if(data?.error)throw Error(data.error);return data;
}
function option(target,value,label){
  const item=document.createElement("option");item.value=value;item.textContent=label;target.append(item);
}
function updateOptions(){
  const old=f.push.value;
  [...f.push.options].filter(x=>x.value.startsWith("segment:")).forEach(x=>x.remove());
  segments.forEach(x=>option(f.push,"segment:"+x.id,"Saved audience · "+x.name));
  if([...f.push.options].some(x=>x.value===old))f.push.value=old;
  f.saved.replaceChildren();option(f.saved,"","Create a new audience");
  segments.forEach(x=>option(f.saved,x.id,x.name));
  if(segments.some(x=>x.id===currentId))f.saved.value=currentId;
}
function challenges(){
  const old=f.challenge.value;f.challenge.replaceChildren();
  [...f.push.options].filter(x=>x.value.startsWith("challenge:"))
    .forEach(x=>option(f.challenge,x.value.slice(10),x.textContent));
  if([...f.challenge.options].some(x=>x.value===old))f.challenge.value=old;
}
function reset(){
  currentId="";f.saved.value="";f.name.value="";f.type.value="general";
  f.subscription.value="any";f.age.value="0";f.inactive.value="0";
  f.inactiveMax.value="";f.subscriptionAge.value="0";
  f.challengeLabel.classList.add("hidden");message("New audience. Set filters, then save.");
}
function edit(s){
  currentId=s.id;f.saved.value=s.id;f.name.value=s.name||"";f.type.value=s.audience||"general";
  challenges();if(s.challenge_slug)f.challenge.value=s.challenge_slug;
  f.challengeLabel.classList.toggle("hidden",f.type.value!=="challenge");
  f.subscription.value=s.subscription_filter||"any";f.age.value=s.min_app_age_days??0;
  f.inactive.value=s.inactive_min_days??0;f.inactiveMax.value=s.inactive_max_days??"";
  f.subscriptionAge.value=s.min_subscription_days??0;
  message("Editing saved audience; save to apply changes.");
}
function parseRule(){
  const day=(x,optional=false)=>{
    if(optional&&x.value==="")return null;
    const n=Number(x.value);if(!Number.isInteger(n)||n<0||n>3650)
      throw Error("Day filters must be whole numbers from 0 to 3650.");return n;
  };
  const name=f.name.value.trim();
  if(name.length<2||name.length>90)throw Error("Name must be 2–90 characters.");
  const r={name,segment_audience:f.type.value,
    challenge_slug:f.type.value==="challenge"?f.challenge.value:null,
    subscription_filter:f.subscription.value,min_app_age_days:day(f.age),
    inactive_min_days:day(f.inactive),inactive_max_days:day(f.inactiveMax,true),
    min_subscription_days:day(f.subscriptionAge)};
  if(r.inactive_max_days!==null&&r.inactive_max_days<r.inactive_min_days)
    throw Error("Maximum inactivity cannot be less than minimum inactivity.");
  if(r.segment_audience==="challenge"&&!r.challenge_slug)
    throw Error("Choose a challenge.");return r;
}
async function load(){
  if(busy)return;busy=true;
  try{const data=await api({action:"segments_list"});segments=data.segments||[];
    updateOptions();const selected=segments.find(x=>x.id===currentId);
    if(selected)edit(selected);else reset();challenges();
  }catch(e){message("Unable to load saved audiences: "+e.message,true)}
  finally{busy=false;}
}
async function save(){
  if(busy)return;let r;
  try{r=parseRule()}catch(e){return message(e.message,true)}
  busy=true;message("Saving audience…");
  try{const data=await api({action:"segment_save",segment_id:currentId||null,...r});
    currentId=data.segment.id;segments=segments.filter(x=>x.id!==currentId).concat(data.segment);
    segments.sort((a,b)=>a.name.localeCompare(b.name));updateOptions();edit(data.segment);
    message("Saved. Use Preview matching devices to choose recipients.");
  }catch(e){message(e.message,true)}finally{busy=false;}
}
async function erase(){
  if(!currentId)return message("Select an existing audience first.",true);
  if(!window.confirm("Delete this saved audience? Existing send history is retained."))return;
  busy=true;try{await api({action:"segment_delete",segment_id:currentId});
    segments=segments.filter(x=>x.id!==currentId);reset();updateOptions();message("Deleted.");
  }catch(e){message(e.message,true)}finally{busy=false;}
}
function preview(){
  if(!currentId)return message("Save the audience before previewing.",true);
  updateOptions();f.push.value="segment:"+currentId;
  if(f.push.value!=="segment:"+currentId)return message("Audience selection failed.",true);
  f.push.dispatchEvent(new Event("change"));
  message("Audience selected in the notification composer; refreshing recipients.");
}
function init(){
  if(!client)return message("Admin session is unavailable.",true);
  $("audienceNew").addEventListener("click",reset);
  $("audienceSave").addEventListener("click",save);
  $("audienceDelete").addEventListener("click",erase);
  $("audiencePreview").addEventListener("click",preview);
  f.saved.addEventListener("change",()=>{const s=segments.find(x=>x.id===f.saved.value);if(s)edit(s);else reset();});
  f.type.addEventListener("change",()=>{
    f.challengeLabel.classList.toggle("hidden",f.type.value!=="challenge");
    if(f.type.value==="challenge")challenges();
  });
  client.auth.onAuthStateChange((event,session)=>{
    if(event==="SIGNED_IN"&&session)queueMicrotask(load);
    if(event==="SIGNED_OUT"){segments=[];reset();updateOptions();}
  });
  client.auth.getSession().then(({data})=>{if(data?.session)load();});
}
window.BeadlightAudienceBuilder={get:id=>segments.find(x=>x.id===id),options:()=>segments,load,refreshOptions:updateOptions};
init();
})();