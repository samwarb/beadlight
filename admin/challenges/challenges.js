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
    deleteButton: $("deleteButton"), saveStatus: $("saveStatus")
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
  async function loadAll(focus) {
    const { data, error } = await client.from("rosary_challenges")
      .select("*").order("starts_on", { ascending: false });
    if (error) throw Error(error.message + " — Run the Challenges admin SQL migration if it has not been installed.");
    allChallenges = data || [];
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
    const redirect = window.location.origin + "/admin/challenges/";
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    el.loginButton.disabled = false;
    reportLogin(error ? error.message : "If the address is approved, a sign-in link will arrive by email.", !!error);
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
