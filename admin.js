const STATUSES = [
  ["under-consideration", "Under consideration"],
  ["planned", "Planned"],
  ["in-progress", "In progress"],
  ["released", "Released"],
  ["not-planned", "Not planned"]
];

const TAGS = [
  ["UI", "UI"],
  ["Platform", "Platform"],
  ["Bug", "Bug"],
  ["Feature", "Feature"],
  ["Other", "Other"]
];

const PRIORITIES = [
  ["Urgent", "Urgent"],
  ["High", "High"],
  ["Medium", "Medium"],
  ["Low", "Low"]
];

const STATUSES_WITHOUT_SPRINT = ["under-consideration", "not-planned"];

const ADMIN_REDIRECT_URL = "https://beadlight.merciandigital.co.uk/admin/";

let client;
let items = [];

const loginPanel = document.getElementById("loginPanel");
const editorPanel = document.getElementById("editorPanel");
const loginStatus = document.getElementById("loginStatus");
const adminStatus = document.getElementById("adminStatus");
const editor = document.getElementById("itemsEditor");
const analyticsStatus = document.getElementById("analyticsStatus");
const analyticsTotals = document.getElementById("analyticsTotals");
const analyticsDaily = document.getElementById("analyticsDaily");
const analyticsMysteries = document.getElementById("analyticsMysteries");

function initClient() {
  const config = window.BEADLIGHT_SUPABASE || {};

  if (!config.url || !config.anonKey || config.url.includes("PASTE_YOUR")) {
    setLoginStatus(
      "Supabase is not configured yet. Add your project URL and publishable key to supabase-config.js.",
      true
    );
    return null;
  }

  return window.supabase.createClient(config.url, config.anonKey);
}

async function init() {
  client = initClient();
  if (!client) return;

  const loginBtn = document.getElementById("loginBtn");
  const signOutBtn = document.getElementById("signOutBtn");
  const addBtn = document.getElementById("addBtn");
  const refreshAnalyticsBtn = document.getElementById("refreshAnalyticsBtn");

  if (loginBtn) loginBtn.addEventListener("click", sendMagicLink);
  if (signOutBtn) signOutBtn.addEventListener("click", signOut);
  if (addBtn) addBtn.addEventListener("click", addItem);
  if (refreshAnalyticsBtn) refreshAnalyticsBtn.addEventListener("click", loadAnalytics);

  if (editor) {
    editor.addEventListener("click", handleEditorClick);
    editor.addEventListener("change", handleEditorChange);
  }

  const {
    data: { session },
    error
  } = await client.auth.getSession();

  if (error) {
    setLoginStatus(error.message, true);
    return;
  }

  if (session) {
    await showEditor();
  }

  client.auth.onAuthStateChange(async (_event, session) => {
    if (session) {
      await showEditor();
    }
  });
}

async function sendMagicLink() {
  const emailInput = document.getElementById("email");
  const email = emailInput ? emailInput.value.trim() : "";

  if (!email) {
    setLoginStatus("Enter your email address first.", true);
    return;
  }

  setLoginStatus("Sending magic link…");

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: ADMIN_REDIRECT_URL
    }
  });

  if (error) {
    setLoginStatus(error.message, true);
    return;
  }

  setLoginStatus("Magic link sent. Check your email, then open the newest link.");
}

async function showEditor() {
  if (loginPanel) loginPanel.classList.add("hidden");
  if (editorPanel) editorPanel.classList.remove("hidden");

  await loadAnalytics();
  await loadItems();
}

async function loadAnalytics() {
  renderAnalyticsLoading();
  setAnalyticsStatus("Loading prayer analytics...");

  const { data, error } = await client.rpc("get_prayer_analytics_dashboard");

  if (error) {
    setAnalyticsStatus(
      "Could not load analytics: " + error.message + ". Make sure the prayer analytics admin SQL function has been added in Supabase.",
      true
    );
    renderAnalyticsEmpty("Analytics are not available yet.");
    return;
  }

  const dashboard = data || {};

  renderAnalyticsTotals(dashboard.totals || {});
  renderDailyAnalytics(dashboard.daily || []);
  renderMysteryAnalytics(dashboard.mysteries || []);
  setAnalyticsStatus("Prayer analytics loaded.");
}

function renderAnalyticsLoading() {
  if (analyticsTotals) {
    analyticsTotals.innerHTML = renderAnalyticsCard("...", "Completed steps")
      + renderAnalyticsCard("...", "Decades completed")
      + renderAnalyticsCard("...", "Full rosaries")
      + renderAnalyticsCard("...", "Anonymous devices");
  }

  if (analyticsDaily) {
    analyticsDaily.innerHTML = `<div class="analytics-empty">Loading daily activity...</div>`;
  }

  if (analyticsMysteries) {
    analyticsMysteries.innerHTML = `<div class="analytics-empty">Loading mystery sets...</div>`;
  }
}

function renderAnalyticsEmpty(message) {
  if (analyticsTotals) {
    analyticsTotals.innerHTML = "";
  }

  const empty = `<div class="analytics-empty">${escapeHtml(message)}</div>`;

  if (analyticsDaily) analyticsDaily.innerHTML = empty;
  if (analyticsMysteries) analyticsMysteries.innerHTML = empty;
}

function renderAnalyticsTotals(totals) {
  if (!analyticsTotals) return;

  analyticsTotals.innerHTML = [
    renderAnalyticsCard(formatNumber(totals.completed_steps), "Completed steps"),
    renderAnalyticsCard(formatNumber(totals.completed_decades), "Decades completed"),
    renderAnalyticsCard(formatNumber(totals.completed_rosaries), "Full rosaries"),
    renderAnalyticsCard(formatNumber(totals.anonymous_devices), "Anonymous devices")
  ].join("");
}

function renderAnalyticsCard(value, label) {
  return `
    <article class="analytics-card">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </article>
  `;
}

function renderDailyAnalytics(rows) {
  if (!analyticsDaily) return;

  if (!rows.length) {
    analyticsDaily.innerHTML = `<div class="analytics-empty">No prayer activity has been recorded yet.</div>`;
    return;
  }

  analyticsDaily.innerHTML = `
    <div class="analytics-table-scroll">
      <table class="analytics-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Steps</th>
            <th>Decades</th>
            <th>Rosaries</th>
            <th>Devices</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(formatDate(row.prayer_date))}</td>
              <td>${escapeHtml(formatNumber(row.completed_steps))}</td>
              <td>${escapeHtml(formatNumber(row.completed_decades))}</td>
              <td>${escapeHtml(formatNumber(row.completed_rosaries))}</td>
              <td>${escapeHtml(formatNumber(row.anonymous_devices))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMysteryAnalytics(rows) {
  if (!analyticsMysteries) return;

  if (!rows.length) {
    analyticsMysteries.innerHTML = `<div class="analytics-empty">No mystery set data has been recorded yet.</div>`;
    return;
  }

  analyticsMysteries.innerHTML = `
    <div class="analytics-table-scroll">
      <table class="analytics-table">
        <thead>
          <tr>
            <th>Mystery set</th>
            <th>Steps</th>
            <th>Decades</th>
            <th>Rosaries</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(titleCase(row.mystery_set || "Unknown"))}</td>
              <td>${escapeHtml(formatNumber(row.completed_steps))}</td>
              <td>${escapeHtml(formatNumber(row.completed_decades))}</td>
              <td>${escapeHtml(formatNumber(row.completed_rosaries))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function loadItems() {
  setAdminStatus("Loading roadmap…");

  const { data, error } = await client
    .from("roadmap_items")
    .select("id,title,summary,status,tag,priority,sprint_due,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    setAdminStatus("Could not load roadmap: " + error.message, true);
    return;
  }

  items = data || [];
  renderEditor();

  setAdminStatus(`${items.length} item${items.length === 1 ? "" : "s"} loaded.`);
}

function renderEditor() {
  if (!editor) return;

  if (!items.length) {
    editor.innerHTML = `<div class="empty-state">No roadmap items yet.</div>`;
    return;
  }

  editor.innerHTML = items.map(renderEditorItem).join("");
}

function renderEditorItem(item) {
  const status = item.status || "under-consideration";
  const sprintDisabled = shouldDisableSprint(status);

  const statusOptions = STATUSES.map(([value, label]) => {
    return `<option value="${value}" ${status === value ? "selected" : ""}>${label}</option>`;
  }).join("");

  const savedTag = item.tag || "Feature";
  const tagIsKnown = TAGS.some(([value]) => value === savedTag);
  const selectedTag = tagIsKnown ? savedTag : "Other";
  const customTagValue = tagIsKnown ? "" : savedTag;

  const tagOptions = TAGS.map(([value, label]) => {
    return `<option value="${value}" ${selectedTag === value ? "selected" : ""}>${label}</option>`;
  }).join("");

  const priorityOptions = PRIORITIES.map(([value, label]) => {
    return `<option value="${value}" ${item.priority === value ? "selected" : ""}>${label}</option>`;
  }).join("");

  const sprintText = sprintDisabled ? "N/A" : item.sprint_due || getCurrentSprintText();
  const weekValue = sprintDisabled ? "" : sprintTextToWeekInputValue(sprintText);

  return `
    <article class="editor-card" data-id="${escapeAttr(item.id)}">
      <div class="admin-grid">
        <label>
          Name
          <input data-field="title" value="${escapeAttr(item.title || "")}" placeholder="Roadmap item name">
        </label>

        <label>
          Status
          <select data-field="status">
            ${statusOptions}
          </select>
        </label>

        <label>
          Tag
          <select data-field="tag_select">
            ${tagOptions}
          </select>
        </label>

        <label class="${selectedTag === "Other" ? "" : "hidden"}" data-custom-tag-wrap>
          Other tag
          <input data-field="tag_other" value="${escapeAttr(customTagValue)}" placeholder="Type custom tag">
        </label>

        <label>
          Priority
          <select data-field="priority">
            ${priorityOptions}
          </select>
        </label>

        <label>
          Sprint due
          <input
            data-field="sprint_week"
            type="week"
            value="${escapeAttr(weekValue)}"
            ${sprintDisabled ? "disabled" : ""}
          >
        </label>

        <label>
          Sprint label
          <input data-field="sprint_due" value="${escapeAttr(sprintText)}" readonly>
        </label>

        <label class="wide">
          Summary
          <textarea data-field="summary" rows="3" placeholder="Describe the feature, bug, or improvement">${escapeHtml(item.summary || "")}</textarea>
        </label>
      </div>

      <div class="admin-actions">
        <button type="button" class="primary-button" data-action="save" data-id="${escapeAttr(item.id)}">
          Save
        </button>

        <button type="button" class="secondary-button danger-button" data-action="delete" data-id="${escapeAttr(item.id)}">
          Delete
        </button>
      </div>
    </article>
  `;
}

function handleEditorChange(event) {
  const changed = event.target;

  if (!changed) return;

  if (changed.dataset.field === "tag_select") {
    const card = changed.closest(".editor-card");
    if (!card) return;

    const customTagWrap = card.querySelector("[data-custom-tag-wrap]");
    if (!customTagWrap) return;

    if (changed.value === "Other") {
      customTagWrap.classList.remove("hidden");
    } else {
      customTagWrap.classList.add("hidden");
    }

    return;
  }

  if (changed.dataset.field === "status") {
    const card = changed.closest(".editor-card");
    if (!card) return;

    updateSprintControlsForStatus(card, changed.value);
    return;
  }

  if (changed.dataset.field === "sprint_week") {
    const card = changed.closest(".editor-card");
    if (!card) return;

    const sprintLabel = card.querySelector('[data-field="sprint_due"]');
    if (!sprintLabel) return;

    sprintLabel.value = weekInputValueToSprintText(changed.value);
    return;
  }
}

function updateSprintControlsForStatus(card, status) {
  const sprintWeek = card.querySelector('[data-field="sprint_week"]');
  const sprintLabel = card.querySelector('[data-field="sprint_due"]');

  if (!sprintWeek || !sprintLabel) return;

  if (shouldDisableSprint(status)) {
    sprintWeek.value = "";
    sprintWeek.disabled = true;
    sprintLabel.value = "N/A";
    return;
  }

  sprintWeek.disabled = false;

  if (!sprintWeek.value) {
    sprintWeek.value = getCurrentWeekInputValue();
  }

  sprintLabel.value = weekInputValueToSprintText(sprintWeek.value);
}

async function handleEditorClick(event) {
  const button = event.target.closest("button[data-action]");

  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;

  if (!id) {
    setAdminStatus("Could not identify this roadmap item.", true);
    return;
  }

  if (action === "save") {
    await saveItem(id);
    return;
  }

  if (action === "delete") {
    await deleteItem(id);
    return;
  }
}

function getCardValues(id) {
  const cards = Array.from(document.querySelectorAll(".editor-card"));
  const card = cards.find((card) => card.dataset.id === id);

  if (!card) return null;

  const get = (field) => {
    const input = card.querySelector(`[data-field="${field}"]`);
    return input ? input.value : "";
  };

  const status = get("status");
  const selectedTag = get("tag_select");
  const otherTag = get("tag_other").trim();

  let finalTag = selectedTag;

  if (selectedTag === "Other") {
    finalTag = otherTag || "Other";
  }

  const sprintDue = shouldDisableSprint(status) ? "N/A" : get("sprint_due").trim();

  return {
    title: get("title").trim(),
    status,
    tag: finalTag,
    priority: get("priority"),
    sprint_due: sprintDue,
    summary: get("summary").trim(),
    is_public: true
  };
}

async function saveItem(id) {
  const values = getCardValues(id);

  if (!values) {
    setAdminStatus("Could not find this roadmap item.", true);
    return;
  }

  if (!values.title) {
    setAdminStatus("Name is required.", true);
    return;
  }

  if (!values.sprint_due) {
    setAdminStatus("Sprint due is required.", true);
    return;
  }

  setAdminStatus("Saving…");

  const { data, error } = await client
    .from("roadmap_items")
    .update(values)
    .eq("id", id)
    .select();

  if (error) {
    setAdminStatus("Could not save item: " + error.message, true);
    return;
  }

  if (!data || data.length === 0) {
    setAdminStatus(
      "Nothing was saved. This usually means your Supabase security policy is blocking updates for this email.",
      true
    );
    return;
  }

  await loadItems();
  setAdminStatus("Saved.");
}

async function addItem() {
  setAdminStatus("Adding item…");

  const { data, error } = await client
    .from("roadmap_items")
    .insert({
      title: "New roadmap item",
      summary: "Describe the feature or improvement.",
      status: "under-consideration",
      tag: "Feature",
      priority: "Medium",
      sprint_due: "N/A",
      is_public: true
    })
    .select();

  if (error) {
    setAdminStatus("Could not add item: " + error.message, true);
    return;
  }

  if (!data || data.length === 0) {
    setAdminStatus(
      "Nothing was added. This usually means your Supabase security policy is blocking inserts for this email.",
      true
    );
    return;
  }

  await loadItems();
  setAdminStatus("New item added.");
}

async function deleteItem(id) {
  const confirmed = confirm("Delete this roadmap item?");

  if (!confirmed) return;

  setAdminStatus("Deleting…");

  const { data, error } = await client
    .from("roadmap_items")
    .delete()
    .eq("id", id)
    .select();

  if (error) {
    setAdminStatus("Could not delete item: " + error.message, true);
    return;
  }

  if (!data || data.length === 0) {
    setAdminStatus(
      "Nothing was deleted. This usually means your Supabase security policy is blocking deletes for this email.",
      true
    );
    return;
  }

  await loadItems();
  setAdminStatus("Deleted.");
}

async function signOut() {
  await client.auth.signOut();

  if (editorPanel) editorPanel.classList.add("hidden");
  if (loginPanel) loginPanel.classList.remove("hidden");

  setLoginStatus("Signed out.");
}

function shouldDisableSprint(status) {
  return STATUSES_WITHOUT_SPRINT.includes(status);
}

function getCurrentSprintText() {
  const now = new Date();
  const year = now.getFullYear();
  const week = getIsoWeekNumber(now);

  return `${year} Sprint ${week}`;
}

function weekInputValueToSprintText(value) {
  if (!value || !value.includes("-W")) {
    return getCurrentSprintText();
  }

  const parts = value.split("-W");
  const year = parts[0];
  const week = Number(parts[1]);

  if (!year || !week) {
    return getCurrentSprintText();
  }

  return `${year} Sprint ${week}`;
}

function sprintTextToWeekInputValue(value) {
  if (!value || value === "N/A") {
    return getCurrentWeekInputValue();
  }

  const match = String(value).match(/(\d{4})\s*Sprint\s*(\d{1,2})/i);

  if (!match) {
    return getCurrentWeekInputValue();
  }

  const year = match[1];
  const week = String(match[2]).padStart(2, "0");

  return `${year}-W${week}`;
}

function getCurrentWeekInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const week = String(getIsoWeekNumber(now)).padStart(2, "0");

  return `${year}-W${week}`;
}

function getIsoWeekNumber(date) {
  const tempDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = tempDate.getUTCDay() || 7;

  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));

  return Math.ceil((((tempDate - yearStart) / 86400000) + 1) / 7);
}

function setLoginStatus(message, isError = false) {
  if (!loginStatus) return;

  loginStatus.innerHTML = escapeHtml(message);
  loginStatus.classList.toggle("error-text", isError);
}

function setAdminStatus(message, isError = false) {
  if (!adminStatus) return;

  adminStatus.textContent = message;
  adminStatus.classList.toggle("error-text", isError);
}

function setAnalyticsStatus(message, isError = false) {
  if (!analyticsStatus) return;

  analyticsStatus.textContent = message;
  analyticsStatus.classList.toggle("error-text", isError);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-GB").format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "Unknown";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function titleCase(value) {
  return String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

init();
