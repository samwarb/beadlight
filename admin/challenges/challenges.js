/* Beadlight Challenge Studio. Public client keys only; all edits require database and storage RLS. */
(function () {
  "use strict";

  const cfg = window.BEADLIGHT_SUPABASE || {};
  const $ = (id) => document.getElementById(id);
  const el = {
    loginPanel: $("loginPanel"), loginEmail: $("loginEmail"), loginButton: $("loginButton"),
    loginStatus: $("loginStatus"), signOut: $("signOut"), studio: $("studio"),
    form: $("challengeForm"), formTitle: $("formTitle"), mode: $("editorMode"),
    list: $("challengeList"), count: $("count"), search: $("search"), newButton: $("newButton"),
    slug: $("slug"), sortOrder: $("sortOrder"), titleEn: $("titleEn"), titleEs: $("titleEs"),
    descriptionEn: $("descriptionEn"), descriptionEs: $("descriptionEs"), startsOn: $("startsOn"),
    endsOn: $("endsOn"), accent: $("accent"), useAccent: $("useAccent"),
    reflectionsEn: $("reflectionsEn"), reflectionsEs: $("reflectionsEs"), dayCount: $("dayCount"),
    reminderTitleEn: $("reminderTitleEn"), reminderTitleEs: $("reminderTitleEs"),
    reminderBodyEn: $("reminderBodyEn"), reminderBodyEs: $("reminderBodyEs"),
    bannerPreview: $("bannerPreview"), detailPreview: $("detailPreview"),
    bannerFile: $("bannerFile"), detailFile: $("detailFile"), dailyImages: $("dailyImages"),
    published: $("published"), saveButton: $("saveButton"), resetButton: $("resetButton"),
    deleteButton: $("deleteButton"), saveStatus: $("saveStatus"),
    signupRows: $("signupRows"), signupStatus: $("signupStatus"), refreshSignups: $("refreshSignups"),
    pushAudience: $("pushAudience"),pushTitle: $("pushTitle"),pushBody: $("pushBody"),pushTestID: $("pushTestID"),
    pushPreview: $("pushPreview"),pushStatus: $("pushStatus"),pushHistory: $("pushHistory"),
    pushRefresh: $("pushRefresh"),pushSend: $("pushSend"),pushTest: $("pushTest")
  };
  const client = (window.supabase && cfg.url && cfg.anonKey)
    ? window.supabase.createClient(cfg.url, cfg.anonKey) : null;
  const BUCKET = "challenge-images";
  const MIME_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const MAX_BYTES = 5 * 1024 * 1024;
  let allChallenges = [];
  let editingSlug = null;
  let currentPaths = { banner: "", detail: "", days: [] };
  const pendingFiles = new Map();
  const tempURLs = new Map();
  let busy = false;
  let authorised = false;
  let signupStats = [];
  let countsLoading = false;
  let pushPreview = null;
  let pushBusy = false;

  function report(message, error) {
    el.saveStatus.textContent = message || "";
    el.saveStatus.classList.toggle("error", Boolean(error));
  }
  function reportLogin(message, error) {
    el.loginStatus.textContent = message || "";
    el.loginStatus.classList.toggle("error", Boolean(error));
  }
  function daysBetween(start, end) {
    if (!start || !end) return 0;
    const a = Date.parse(start + "T00:00:00Z");
    const b = Date.parse(end + "T00:00:00Z");
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }
  function getDayCount() { return daysBetween(el.startsOn.value, el.endsOn.value); }
  function imageURL(path) {
    if (!path) return "";
    return client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
  function preview(img, path, key) {
    img.removeAttribute("src");
    if (tempURLs.has(key)) img.src = tempURLs.get(key);
    else if (path) img.src = imageURL(path);
    img.style.visibility = img.src ? "visible" : "hidden";
  }
  function releaseURLs() {
    tempURLs.forEach((url) => URL.revokeObjectURL(url));
    tempURLs.clear();
  }
  function setPending(key, file) {
    const prior = tempURLs.get(key);
    if (prior) URL.revokeObjectURL(prior);
    tempURLs.delete(key);
    pendingFiles.delete(key);
    if (file) {
      if (!Object.prototype.hasOwnProperty.call(MIME_EXT, file.type)) {
        throw Error("Please choose a PNG, JPG or WebP image.");
      }
      if (file.size > MAX_BYTES || file.size < 1) {
        throw Error("Images must be between 1 byte and 5 MB.");
      }
      pendingFiles.set(key, file);
      tempURLs.set(key, URL.createObjectURL(file));
    }
  }
  function resetImages() {
    releaseURLs();
    pendingFiles.clear();
    el.bannerFile.value = "";
    el.detailFile.value = "";
  }
  function showImages() {
    preview(el.bannerPreview, currentPaths.banner, "banner");
    preview(el.detailPreview, currentPaths.detail, "detail");
    renderDayImages();
  }
  function renderDayImages() {
    el.dailyImages.replaceChildren();
    const n = getDayCount();
    el.dayCount.textContent = n > 0 && n <= 90
      ? n + " days, including the first and last date." : "Choose an inclusive date range of 1–90 days.";
    if (n < 1 || n > 90) return;
    for (let i = 0; i < n; i++) {
      const row = document.createElement("div");
      row.className = "day-image";
      const label = document.createElement("strong");
      label.textContent = "Day " + (i + 1);
      const img = document.createElement("img");
      img.alt = "Day " + (i + 1) + " image preview";
      const key = "day:" + i;
      preview(img, currentPaths.days[i], key);
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = "image/png,image/jpeg,image/webp";
      picker.setAttribute("aria-label", "Upload image for day " + (i + 1));
      picker.addEventListener("change", () => {
        try {
          setPending(key, picker.files[0]);
          preview(img, currentPaths.days[i], key);
          report("");
        } catch (error) {
          picker.value = "";
          report(error.message, true);
        }
      });
      const clear = document.createElement("button");
      clear.type = "button"; clear.className = "secondary"; clear.textContent = "Remove";
      clear.setAttribute("aria-label", "Remove image for day " + (i + 1));
      clear.addEventListener("click", () => {
        setPending(key, null);
        currentPaths.days[i] = "";
        picker.value = "";
        preview(img, "", key);
      });
      row.append(label, img, picker, clear);
      el.dailyImages.append(row);
    }
  }
  function toLines(raw, expected, name) {
    if (!raw.trim()) return [];
    const lines = raw.replace(/\r/g, "").split("\n");
    if (lines.length !== expected) {
      throw Error(name + " needs " + expected + " lines (one per day), or must be empty. Currently " + lines.length + ".");
    }
    return lines.map((line) => line.trim());
  }
  function initialPaths(row) {
    return {
      banner: row && row.banner_image_path || "",
      detail: row && row.detail_image_path || "",
      days: row && Array.isArray(row.daily_image_paths) ? row.daily_image_paths.slice() : []
    };
  }
  function startNew() {
    editingSlug = null;
    el.form.reset();
    el.slug.readOnly = false;
    el.sortOrder.value = 100;
    el.accent.value = "#7F718C";
    el.useAccent.checked = false;
    el.formTitle.textContent = "Create a challenge";
    el.mode.textContent = "New challenge";
    el.deleteButton.classList.add("hidden");
    currentPaths = initialPaths(null);
    resetImages();
    showImages();
    renderList();
    report("");
  }
  function startEditing(row) {
    editingSlug = row.slug;
    resetImages();
    el.slug.value = row.slug;
    el.slug.readOnly = true;
    el.sortOrder.value = row.sort_order ?? 100;
    el.titleEn.value = row.title_en || "";
    el.titleEs.value = row.title_es || "";
    el.descriptionEn.value = row.description_en || "";
    el.descriptionEs.value = row.description_es || "";
    el.startsOn.value = row.starts_on || "";
    el.endsOn.value = row.ends_on || "";
    el.reflectionsEn.value = Array.isArray(row.reflections_en) ? row.reflections_en.join("\n") : "";
    el.reflectionsEs.value = Array.isArray(row.reflections_es) ? row.reflections_es.join("\n") : "";
    el.reminderTitleEn.value = row.reminder_title_en || "";
    el.reminderTitleEs.value = row.reminder_title_es || "";
    el.reminderBodyEn.value = row.reminder_body_en || "";
    el.reminderBodyEs.value = row.reminder_body_es || "";
    el.accent.value = row.accent_color_hex || "#7F718C";
    el.useAccent.checked = Boolean(row.accent_color_hex);
    el.published.checked = Boolean(row.is_published);
    el.formTitle.textContent = row.title_en || row.slug;
    el.mode.textContent = "Editing " + row.slug;
    el.deleteButton.classList.remove("hidden");
    currentPaths = initialPaths(row);
    showImages();
    renderList();
    report("");
  }
  function renderList() {
    el.list.replaceChildren();
    const term = el.search.value.trim().toLowerCase();
    const matches = allChallenges.filter((row) => [row.slug,row.title_en,row.title_es].join(" ").toLowerCase().includes(term));
    el.count.textContent = matches.length + " challenge" + (matches.length === 1 ? "" : "s");
    matches.forEach((row) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "item" + (editingSlug === row.slug ? " active" : "");
      const title = document.createElement("strong");
      title.textContent = row.title_en;
      const sub = document.createElement("span");
      sub.className = "status" + (row.is_published ? " live" : "");
      sub.textContent = (row.is_published ? "Published" : "Draft") + " · " + row.starts_on + " – " + row.ends_on;
      button.append(title, sub);
      button.addEventListener("click", () => startEditing(row));
      el.list.append(button);
    });
    if (!matches.length) {
      const p = document.createElement("p"); p.className = "help";
      p.textContent = "No challenges found. Create your first one.";
      el.list.append(p);
    }
  }

  function showSignupStatus(message, isError = false) {
    el.signupStatus.textContent = message || "";
    el.signupStatus.classList.toggle("error", Boolean(isError));
  }

  // Admin-only aggregate RPC. The underlying registrations are never readable
  // directly from the browser, and switching visibility off hides public RPC output.
  async function loadSignupCounts() {
    if (!authorised || countsLoading) return;
    countsLoading = true;
    el.refreshSignups.disabled = true;
    showSignupStatus("Refreshing participation counts…");
    try {
      const { data, error } = await client.rpc("get_admin_challenge_signup_counts");
      if (error) throw Error(error.message);
      signupStats = data || [];
      renderSignupCounts();
      showSignupStatus("Counts updated. Switches save immediately.");
    } catch (error) {
      showSignupStatus("Could not load sign-ups: " + error.message, true);
    } finally {
      countsLoading = false;
      el.refreshSignups.disabled = false;
    }
  }

  function renderSignupCounts() {
    el.signupRows.replaceChildren();
    signupStats.forEach((record) => {
      const row = document.createElement("div");
      row.className = "signup-row";
      const text = document.createElement("div");
      const name = document.createElement("div");
      name.className = "signup-name";
      const corresponding = allChallenges.find((c) => c.slug === record.challenge_slug);
      name.textContent = record.challenge_slug === "daily"
        ? "Daily Rosary Challenge" : (corresponding?.title_en || record.challenge_slug);
      const detail = document.createElement("small");
      detail.textContent = record.challenge_slug === "daily"
        ? "Ongoing, free challenge" : (corresponding?.is_published ? "Published" : "Draft");
      text.append(name, detail);
      const total = document.createElement("div");
      total.className = "signup-total";
      total.textContent = Number(record.signup_count || 0).toLocaleString();
      total.setAttribute("aria-label", total.textContent + " registered app installations");
      const label = document.createElement("label");
      label.className = "signup-switch";
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = Boolean(record.show_to_users);
      toggle.setAttribute("aria-label", "Show sign-up count to users for " + name.textContent);
      const span = document.createElement("span");
      span.textContent = "Show in app";
      label.append(toggle, span);
      toggle.addEventListener("change", async () => {
        const intended = toggle.checked;
        toggle.disabled = true;
        showSignupStatus("Updating visibility for " + name.textContent + "…");
        try {
          const { error } = await client.rpc("set_challenge_count_visibility", {
            p_slug: record.challenge_slug, p_show_to_users: intended
          });
          if (error) throw Error(error.message);
          record.show_to_users = intended;
          showSignupStatus(name.textContent + ": count " + (intended ? "visible to app users." : "hidden from app users."));
        } catch (error) {
          toggle.checked = !intended;
          showSignupStatus("Could not update visibility: " + error.message, true);
        } finally { toggle.disabled = false; }
      });
      row.append(text, total, label);
      el.signupRows.append(row);
    });
  }


  function pushMessage(message, error=false) {
    el.pushStatus.textContent = message || "";
    el.pushStatus.classList.toggle("error",error);
  }
  function selectedPushAudience() {
    const value=el.pushAudience.value;
    if(value.startsWith("segment:")){
      const saved=window.BeadlightAudienceBuilder?.get(value.slice(8));
      if(saved)return {audience:saved.audience,challenge_slug:saved.challenge_slug,segment_id:saved.id};
    }
    if (value === "general") return { audience:"general",challenge_slug:null };
    return { audience:"challenge",challenge_slug:value.replace(/^challenge:/,"") };
  }
  async function invokePush(payload) {
    const {data,error}=await client.functions.invoke("beadlight-push-admin",{body:payload});
    if(error){
      const reason=await error.context?.json?.().catch(()=>null);
      throw Error(reason?.error || error.message || "Request failed");
    }
    if (data?.error) throw Error(data.error);
    return data;
  }
  function fillPushAudience() {
    const selected=el.pushAudience.value;
    el.pushAudience.replaceChildren();
    const opts=[{value:"challenge:daily",text:"Daily Rosary Challenge"},
      ...allChallenges.filter(x=>x.is_published).map(x=>({value:"challenge:"+x.slug,text:x.title_en})),
      {value:"general",text:"Beadlight news and offers (opted-in users)"}];
    for(const option of opts){
      const elOption=document.createElement("option");
      elOption.value=option.value;elOption.textContent=option.text;
      el.pushAudience.append(elOption);
    }
    window.BeadlightAudienceBuilder?.options().forEach(seg=>{
      const opt=document.createElement("option");
      opt.value="segment:"+seg.id;
      opt.textContent="Saved audience · "+seg.name;
      el.pushAudience.append(opt);
    });
    if([...el.pushAudience.options].some(x=>x.value===selected))el.pushAudience.value=selected;
    pushPreview=null;el.pushSend.disabled=true;
  }
  async function refreshPushPreview() {
    if(!authorised || pushBusy)return;
    pushBusy=true; el.pushRefresh.disabled=true; el.pushSend.disabled=true;
    el.pushPreview.textContent="Checking eligible devices and Apple push configuration…";
    try {
      const result=await invokePush({action:"preview",...selectedPushAudience()});
      pushPreview=result;
      el.pushPreview.textContent=result.eligible_devices+" opted-in device(s) · Apple push "+
        (result.apns_configured?"configured":"credentials missing")+" · "+
        (result.successful_test_recorded?"test completed":"test send required");
      el.pushSend.disabled=!result.ready_to_send || !result.eligible_devices;
      if(result.requires_subscription_verification && !result.subscription_verification_configured){
        pushMessage("RevenueCat verification isn't configured; subscriber-targeted sends are blocked.",true);
      }else{
        pushMessage(result.limited?"Audience exceeds current safe send limit.":"");
      }
    }catch(error){
      pushPreview=null;el.pushPreview.textContent="Audience preview unavailable";
      pushMessage(error.message,true);
    }finally{pushBusy=false;el.pushRefresh.disabled=false;}
  }
  async function loadPushHistory() {
    if(!authorised)return;
    try {
      const result=await invokePush({action:"history"});
      el.pushHistory.replaceChildren();
      const history=result.history||[];
      if(!history.length){
        const msg=document.createElement("p");msg.className="help";
        msg.textContent="No messages sent yet.";el.pushHistory.append(msg);
      }
      for(const item of history){
        const entry=document.createElement("div");
        entry.className="item";
        const heading=document.createElement("strong");heading.textContent=(item.is_test?"Test: ":"")+item.title;
        const summary=document.createElement("small");
        summary.textContent=[new Date(item.sent_at).toLocaleString(),
          item.audience==="challenge"?(item.challenge_slug||"Challenge"):"All opted-in announcements",
          item.status, (item.delivered_count||0)+" accepted by Apple",
          (item.failed_count||0)+" failed"].join(" · ");
        const body=document.createElement("span");body.textContent=item.body;
        entry.append(heading,body,summary);
        el.pushHistory.append(entry);
      }
    }catch(error){pushMessage("History: "+error.message,true);}
  }
  async function submitPush(test=false) {
    if(!authorised || pushBusy)return;
    const target=selectedPushAudience();
    const {audience,challenge_slug}=target;
    const title=el.pushTitle.value.trim(),body=el.pushBody.value.trim();
    if(!title || !body)return pushMessage("Enter a title and message.",true);
    if(title.length>100 || body.length>240)return pushMessage("Title/message too long.",true);
    const testID=el.pushTestID.value.trim();
    if(test && !/^[0-9a-f-]{36}$/i.test(testID))return pushMessage("Copy the test ID from Beadlight's challenge settings on your iPhone.",true);
    if(!test && (!pushPreview?.ready_to_send || !pushPreview?.eligible_devices))
      return pushMessage("Preview the audience, configure APNs, and complete a successful test before a broadcast.",true);
    const audienceLabel=el.pushAudience.selectedOptions[0]?.textContent||audience;
    const confirmation=test
      ?"Send this test notification to the specified opted-in iPhone?"
      :"Send to "+pushPreview.eligible_devices+" eligible devices in "+audienceLabel+"? This cannot be undone.";
    if(!window.confirm(confirmation))return;
    if(window.prompt("Type SEND to confirm your message:")!=="SEND")return;
    pushBusy=true;el.pushSend.disabled=true;el.pushTest.disabled=true;
    pushMessage("Sending…");
    try{
      const result=await invokePush({action:test?"test":"send",audience,challenge_slug,
        segment_id:target.segment_id||null,
        title,body,test_installation_id:test?testID:null,confirm:true,confirmation_phrase:"SEND"});
      pushMessage(result.accepted_by_apns+" accepted by APNs; "+result.failed+" failed. Check your device for the test message.");
      await loadPushHistory();
    }catch(error){pushMessage(error.message,true);}
    finally{pushBusy=false;el.pushTest.disabled=false;await refreshPushPreview();}
  }

  async function loadAll(focus) {
    const { data, error } = await client.from("rosary_challenges")
      .select("*").order("starts_on", { ascending: false });
    if (error) throw Error(error.message + " — Run the Challenges admin SQL migration if it has not been installed.");
    allChallenges = data || [];
    fillPushAudience();
    await loadSignupCounts();
    await refreshPushPreview();
    await loadPushHistory();
    if (focus) {
      const row = allChallenges.find((r) => r.slug === focus);
      if (row) startEditing(row); else startNew();
    } else if (editingSlug) {
      const row = allChallenges.find((r) => r.slug === editingSlug);
      if (row) startEditing(row); else startNew();
    } else {
      renderList();
    }
  }
  async function authorize(session) {
    if (!session || !session.user || !session.user.email) {
      authorised = false;
      el.loginPanel.classList.remove("hidden");
      el.studio.classList.add("hidden");
      el.signOut.classList.add("hidden");
      return;
    }
    if (busy) return;
    busy = true;
    try {
      const { data, error } = await client.rpc("is_admin_email", { check_email: session.user.email });
      if (error || data !== true) throw Error("This account is not approved for Beadlight admin access.");
      authorised = true;
      el.loginPanel.classList.add("hidden");
      el.studio.classList.remove("hidden");
      el.signOut.classList.remove("hidden");
      await loadAll();
    } catch (error) {
      authorised = false;
      reportLogin(error.message, true);
      el.studio.classList.add("hidden");
      el.loginPanel.classList.remove("hidden");
    } finally { busy = false; }
  }
  async function login() {
    if (!client) return reportLogin("Supabase configuration is missing.", true);
    const email = el.loginEmail.value.trim();
    if (!email || !el.loginEmail.checkValidity()) {
      return reportLogin("Enter a valid email address.", true);
    }
    el.loginButton.disabled = true;
    reportLogin("Sending sign-in link…");
    const redirect = window.location.origin + "/admin/"; // Reuse the existing approved Supabase Auth redirect.
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    el.loginButton.disabled = false;
    reportLogin(error ? error.message : "If the address is approved, a sign-in link will arrive by email. The link opens the main admin dashboard; select Challenges to return here.", !!error);
  }
  function collect() {
    const slug = el.slug.value.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) throw Error("Slug must be 1–64 lowercase letters, numbers or hyphens.");
    const n = getDayCount();
    if (n < 1 || n > 90) throw Error("Challenge must last between 1 and 90 days (inclusive).");
    if (!el.titleEn.value.trim()) throw Error("English title is required.");
    if (!el.form.reportValidity()) throw Error("Please complete the required fields.");
    const sort = Number(el.sortOrder.value);
    if (!Number.isSafeInteger(sort)) throw Error("Sort order must be a whole number.");
    return {
      slug,
      sort_order: sort,
      title_en: el.titleEn.value.trim(), title_es: el.titleEs.value.trim(),
      description_en: el.descriptionEn.value.trim(), description_es: el.descriptionEs.value.trim(),
      starts_on: el.startsOn.value, ends_on: el.endsOn.value,
      reflections_en: toLines(el.reflectionsEn.value,n,"English reflections"),
      reflections_es: toLines(el.reflectionsEs.value,n,"Spanish reflections"),
      reminder_title_en: el.reminderTitleEn.value.trim() || null,
      reminder_title_es: el.reminderTitleEs.value.trim() || null,
      reminder_body_en: el.reminderBodyEn.value.trim() || null,
      reminder_body_es: el.reminderBodyEs.value.trim() || null,
      accent_color_hex: el.useAccent.checked ? el.accent.value.toUpperCase() : null,
      banner_image_path: currentPaths.banner || null,
      detail_image_path: currentPaths.detail || null,
      daily_image_paths: Array.from({length:n},(_,i)=>currentPaths.days[i] || ""),
      is_published: el.published.checked
    };
  }
  async function uploadImages(row) {
    const uploaded = [];
    try {
      for (const [key, file] of pendingFiles) {
        const ext = MIME_EXT[file.type];
        if (!ext || file.size > MAX_BYTES) throw Error("Invalid image selected: " + file.name);
        const uuid = window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
        const name = row.slug + "/" + uuid + "." + ext;
        const { error } = await client.storage.from(BUCKET).upload(name, file,
          { contentType:file.type, cacheControl:"3600", upsert:false });
        if (error) throw Error("Could not upload " + file.name + ": " + error.message);
        uploaded.push(name);
        if (key === "banner") row.banner_image_path = name;
        else if (key === "detail") row.detail_image_path = name;
        else if (key.startsWith("day:")) {
          const index = Number(key.split(":")[1]);
          if (index >= 0 && index < row.daily_image_paths.length) row.daily_image_paths[index] = name;
        }
      }
      if (!row.daily_image_paths.some(Boolean)) row.daily_image_paths = [];
      return uploaded;
    } catch (error) {
      if (uploaded.length) await client.storage.from(BUCKET).remove(uploaded);
      throw error;
    }
  }
  async function save(event) {
    event.preventDefault();
    if (!authorised || busy) return;
    let row;
    try { row = collect(); } catch (error) { return report(error.message, true); }
    busy = true; el.saveButton.disabled = true;
    report("Saving challenge and uploading images…");
    let uploaded = [];
    try {
      uploaded = await uploadImages(row);
      const isEdit = Boolean(editingSlug);
      const result = isEdit
        ? await client.from("rosary_challenges").update(row).eq("slug", editingSlug).select("slug").single()
        : await client.from("rosary_challenges").insert(row).select("slug").single();
      if (result.error) throw Error(result.error.message);
      pendingFiles.clear(); releaseURLs();
      await loadAll(row.slug);
      report("Saved. " + (row.is_published ? "This challenge is published in Beadlight." : "This challenge is a private draft."));
    } catch (error) {
      if (uploaded.length) await client.storage.from(BUCKET).remove(uploaded);
      report("Could not save: " + error.message, true);
    } finally { busy = false; el.saveButton.disabled = false; }
  }
  async function removeChallenge() {
    if (!authorised || !editingSlug || busy) return;
    if (!window.confirm("Permanently delete " + editingSlug + "? Unpublish instead if people may have joined it. Uploaded images are retained.")) return;
    busy = true; el.deleteButton.disabled = true;
    const slug = editingSlug;
    try {
      const { error } = await client.from("rosary_challenges").delete().eq("slug", slug);
      if (error) throw error;
      startNew();
      await loadAll();
      report("Deleted challenge " + slug + ". Existing images were retained.");
    } catch (error) { report(error.message, true); }
    finally { busy = false; el.deleteButton.disabled = false; }
  }
  function bindImage(key, input, img) {
    input.addEventListener("change", () => {
      try {
        setPending(key, input.files[0]);
        preview(img, currentPaths[key], key);
        report("");
      } catch (error) {
        input.value = "";
        report(error.message, true);
      }
    });
  }
  function init() {
    window.beadlightAdminClient=client;
    bindImage("banner", el.bannerFile, el.bannerPreview);
    bindImage("detail", el.detailFile, el.detailPreview);
    document.querySelectorAll("[data-clear-image]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.clearImage;
        currentPaths[key] = "";
        setPending(key, null);
        $(key + "File").value = "";
        preview($(key + "Preview"), "", key);
      });
    });
    el.startsOn.addEventListener("change", renderDayImages);
    el.endsOn.addEventListener("change", renderDayImages);
    el.newButton.addEventListener("click", startNew);
    el.refreshSignups.addEventListener("click", loadSignupCounts);
    el.pushAudience.addEventListener("change", refreshPushPreview);
    el.pushRefresh.addEventListener("click", refreshPushPreview);
    el.pushTest.addEventListener("click", () => submitPush(true));
    el.pushSend.addEventListener("click", () => submitPush(false));
    el.search.addEventListener("input", renderList);
    el.form.addEventListener("submit", save);
    el.deleteButton.addEventListener("click", removeChallenge);
    el.resetButton.addEventListener("click", () => {
      const row = allChallenges.find((r) => r.slug === editingSlug);
      if (row) startEditing(row); else startNew();
    });
    el.loginButton.addEventListener("click", login);
    el.loginEmail.addEventListener("keydown", (event) => { if (event.key === "Enter") login(); });
    el.signOut.addEventListener("click", async () => { if (client) await client.auth.signOut(); await authorize(null); });
    startNew();
    if (!client) {
      reportLogin("Supabase is not configured. Check supabase-config.js.", true);
      return;
    }
    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        setTimeout(() => authorize(session), 0);
      }
    });
    client.auth.getSession().then(({ data, error }) => {
      if (error) reportLogin(error.message, true);
      else authorize(data.session);
    });
  }
  init();
})();
