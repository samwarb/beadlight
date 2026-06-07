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

const TICKET_STATUSES = [
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["waiting_for_customer", "Waiting for customer"],
  ["resolved", "Resolved"],
  ["closed", "Closed"]
];

const TICKET_PRIORITIES = [
  ["urgent", "Urgent"],
  ["high", "High"],
  ["normal", "Normal"],
  ["low", "Low"]
];

const STATUSES_WITHOUT_SPRINT = ["under-consideration", "not-planned"];
const ADMIN_REDIRECT_URL = "https://beadlight.merciandigital.co.uk/admin/";

let client;
let items = [];
let tickets = [];
let currentAdminEmail = null;
let selectedTicketId = null;
let loadedTicketReplies = [];

const loginPanel = document.getElementById("loginPanel");
const editorPanel = document.getElementById("editorPanel");
const loginStatus = document.getElementById("loginStatus");
const adminStatus = document.getElementById("adminStatus");
const editor = document.getElementById("itemsEditor");
const headerSignOutBtn = document.getElementById("headerSignOutBtn");
const analyticsStatus = document.getElementById("analyticsStatus");
const analyticsTotals = document.getElementById("analyticsTotals");
const analyticsDaily = document.getElementById("analyticsDaily");
const analyticsMysteries = document.getElementById("analyticsMysteries");
const ticketSummary = document.getElementById("ticketSummary");
const ticketSearch = document.getElementById("ticketSearch");
const ticketStatusFilter = document.getElementById("ticketStatusFilter");
const ticketPriorityFilter = document.getElementById("ticketPriorityFilter");
const ticketTableBody = document.getElementById("ticketTableBody");
const ticketCount = document.getElementById("ticketCount");
const ticketEmpty = document.getElementById("ticketEmpty");
const ticketDetail = document.getElementById("ticketDetail");
const ticketStatus = document.getElementById("ticketStatus");

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
  const refreshTicketsBtn = document.getElementById("refreshTicketsBtn");

  if (loginBtn) loginBtn.addEventListener("click", sendMagicLink);
  if (signOutBtn) signOutBtn.addEventListener("click", signOut);
  if (headerSignOutBtn) headerSignOutBtn.addEventListener("click", signOut);
  if (addBtn) addBtn.addEventListener("click", addItem);
  if (refreshAnalyticsBtn) refreshAnalyticsBtn.addEventListener("click", loadAnalytics);
  if (refreshTicketsBtn) refreshTicketsBtn.addEventListener("click", loadTickets);

  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => switchAdminSection(button.dataset.adminTab));
  });

  if (editor) {
    editor.addEventListener("click", handleEditorClick);
    editor.addEventListener("change", handleEditorChange);
  }

  if (ticketSearch) ticketSearch.addEventListener("input", renderTickets);
  if (ticketStatusFilter) ticketStatusFilter.addEventListener("change", renderTickets);
  if (ticketPriorityFilter) ticketPriorityFilter.addEventListener("change", renderTickets);
  if (ticketTableBody) ticketTableBody.addEventListener("click", handleTicketTableClick);
  if (ticketDetail) ticketDetail.addEventListener("click", handleTicketDetailClick);

  const {
    data: { session },
    error
  } = await client.auth.getSession();

  if (error) {
    setLoginStatus(error.message, true);
    return;
  }

  if (session) {
    await showEditor(session);
  }

  client.auth.onAuthStateChange(async (_event, session) => {
    if (session) {
      await showEditor(session);
    } else {
      showLogin();
    }
  });
}

function switchAdminSection(sectionName) {
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    const isActive = button.dataset.adminTab === sectionName;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });

  document.querySelectorAll("[data-admin-section]").forEach((section) => {
    section.classList.toggle("is-active", section.dataset.adminSection === sectionName);
  });
}

async function sendMagicLink() {
  const emailInput = document.getElementById("email");
  const email = emailInput ? emailInput.value.trim() : "";

  if (!email) {
    setLoginStatus("Enter your email address first.", true);
    return;
  }

  setLoginStatus("Checking admin access...");

  let isAdmin = false;

  try {
    isAdmin = await isAuthorizedAdminEmail(email);
  } catch (error) {
    setLoginStatus(
      error.message || "Could not verify admin access. Please try again later.",
      true
    );
    return;
  }

  if (!isAdmin) {
    setLoginStatus("Unauthorised user.", true);
    return;
  }

  setLoginStatus("Sending magic link...");

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

async function showEditor(session) {
  const email = session && session.user ? session.user.email : "";

  if (!email) {
    await client.auth.signOut();
    showLogin();
    setLoginStatus("Unauthorised user.", true);
    return;
  }

  let isAdmin = false;

  try {
    isAdmin = await isAuthorizedAdminEmail(email);
  } catch (error) {
    await client.auth.signOut();
    showLogin();
    setLoginStatus(
      error.message || "Could not verify admin access. Please try again later.",
      true
    );
    return;
  }

  if (!isAdmin) {
    await client.auth.signOut();
    showLogin();
    setLoginStatus("Unauthorised user.", true);
    return;
  }

  currentAdminEmail = normalizeEmail(email);
  if (loginPanel) loginPanel.classList.add("hidden");
  if (editorPanel) editorPanel.classList.remove("hidden");
  if (headerSignOutBtn) headerSignOutBtn.classList.remove("hidden");

  switchAdminSection("analytics");
  await Promise.all([loadAnalytics(), loadItems(), loadTickets()]);
}

function showLogin() {
  currentAdminEmail = null;
  selectedTicketId = null;
  if (editorPanel) editorPanel.classList.add("hidden");
  if (loginPanel) loginPanel.classList.remove("hidden");
  if (headerSignOutBtn) headerSignOutBtn.classList.add("hidden");
}

async function isAuthorizedAdminEmail(email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) return false;

  const { data, error } = await client.rpc("is_admin_email", {
    check_email: normalizedEmail
  });

  if (error) {
    throw new Error(
      "Admin access check is not configured yet. Add the is_admin_email SQL function in Supabase."
    );
  }

  return data === true;
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
  if (analyticsTotals) analyticsTotals.innerHTML = "";

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
  setAdminStatus("Loading roadmap...");

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
      <div class="editor-card-head">
        <div>
          <span class="roadmap-pill ${statusClass(status)}">${escapeHtml(titleCase(status))}</span>
          <h3>${escapeHtml(item.title || "Untitled roadmap item")}</h3>
        </div>
      </div>

      <div class="admin-grid">
        <label>
          Name
          <input data-field="title" value="${escapeAttr(item.title || "")}" placeholder="Roadmap item name">
        </label>

        <label>
          Status
          <select data-field="status">${statusOptions}</select>
        </label>

        <label>
          Tag
          <select data-field="tag_select">${tagOptions}</select>
        </label>

        <label class="${selectedTag === "Other" ? "" : "hidden"}" data-custom-tag-wrap>
          Other tag
          <input data-field="tag_other" value="${escapeAttr(customTagValue)}" placeholder="Type custom tag">
        </label>

        <label>
          Priority
          <select data-field="priority">${priorityOptions}</select>
        </label>

        <label>
          Sprint due
          <input data-field="sprint_week" type="week" value="${escapeAttr(weekValue)}" ${sprintDisabled ? "disabled" : ""}>
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
        <button type="button" class="primary-button" data-action="save" data-id="${escapeAttr(item.id)}">Save</button>
        <button type="button" class="secondary-button danger-button" data-action="delete" data-id="${escapeAttr(item.id)}">Delete</button>
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

    customTagWrap.classList.toggle("hidden", changed.value !== "Other");
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

  if (!sprintWeek.value) sprintWeek.value = getCurrentWeekInputValue();
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

  if (action === "save") await saveItem(id);
  if (action === "delete") await deleteItem(id);
}

function getCardValues(id) {
  const cards = Array.from(document.querySelectorAll(".editor-card"));
  const card = cards.find((candidate) => candidate.dataset.id === id);
  if (!card) return null;

  const get = (field) => {
    const input = card.querySelector(`[data-field="${field}"]`);
    return input ? input.value : "";
  };

  const status = get("status");
  const selectedTag = get("tag_select");
  const otherTag = get("tag_other").trim();
  const finalTag = selectedTag === "Other" ? otherTag || "Other" : selectedTag;
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
  if (!currentAdminEmail) {
    setAdminStatus("Unauthorised user.", true);
    return;
  }

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

  setAdminStatus("Saving...");

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
    setAdminStatus("Nothing was saved. Your Supabase policy may be blocking updates.", true);
    return;
  }

  await loadItems();
  setAdminStatus("Saved.");
}

async function addItem() {
  if (!currentAdminEmail) {
    setAdminStatus("Unauthorised user.", true);
    return;
  }

  setAdminStatus("Adding item...");

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
    setAdminStatus("Nothing was added. Your Supabase policy may be blocking inserts.", true);
    return;
  }

  await loadItems();
  setAdminStatus("New item added.");
}

async function deleteItem(id) {
  if (!currentAdminEmail) {
    setAdminStatus("Unauthorised user.", true);
    return;
  }

  if (!confirm("Delete this roadmap item?")) return;

  setAdminStatus("Deleting...");

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
    setAdminStatus("Nothing was deleted. Your Supabase policy may be blocking deletes.", true);
    return;
  }

  await loadItems();
  setAdminStatus("Deleted.");
}

async function loadTickets() {
  if (!ticketTableBody) return;

  renderTicketLoading();
  setTicketStatus("Loading support tickets...");

  const { data, error } = await client
    .from("support_tickets")
    .select("id,ticket_reference,name,email,ticket_type,subject,message,device_details,status,priority,admin_notes,created_at,updated_at,resolved_at,last_replied_at")
    .order("created_at", { ascending: false });

  if (error) {
    tickets = [];
    renderTickets();
    setTicketStatus("Could not load tickets: " + error.message, true);
    return;
  }

  tickets = data || [];
  renderTicketSummary();
  renderTickets();
  setTicketStatus(`${tickets.length} ticket${tickets.length === 1 ? "" : "s"} loaded.`);

  if (selectedTicketId) {
    const selectedStillExists = tickets.some((ticket) => ticket.id === selectedTicketId);
    if (selectedStillExists) openTicket(selectedTicketId);
    else clearTicketDetail();
  }
}

function renderTicketLoading() {
  if (ticketSummary) {
    ticketSummary.innerHTML = [
      renderTicketSummaryCard("...", "Open", "open"),
      renderTicketSummaryCard("...", "In progress", "in-progress"),
      renderTicketSummaryCard("...", "Waiting", "waiting"),
      renderTicketSummaryCard("...", "Resolved", "resolved")
    ].join("");
  }

  if (ticketTableBody) {
    ticketTableBody.innerHTML = `<tr><td colspan="6" class="ticket-loading-cell">Loading tickets...</td></tr>`;
  }
}

function renderTicketSummary() {
  if (!ticketSummary) return;

  const count = (status) => tickets.filter((ticket) => ticket.status === status).length;

  ticketSummary.innerHTML = [
    renderTicketSummaryCard(count("open"), "Open", "open"),
    renderTicketSummaryCard(count("in_progress"), "In progress", "in-progress"),
    renderTicketSummaryCard(count("waiting_for_customer"), "Waiting", "waiting"),
    renderTicketSummaryCard(count("resolved"), "Resolved", "resolved")
  ].join("");
}

function renderTicketSummaryCard(value, label, tone) {
  return `
    <article class="ticket-summary-card ticket-summary-${tone}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </article>
  `;
}

function getFilteredTickets() {
  const searchTerm = ticketSearch ? ticketSearch.value.trim().toLowerCase() : "";
  const statusValue = ticketStatusFilter ? ticketStatusFilter.value : "";
  const priorityValue = ticketPriorityFilter ? ticketPriorityFilter.value : "";

  return tickets.filter((ticket) => {
    const searchable = [
      ticket.ticket_reference,
      ticket.name,
      ticket.email,
      ticket.ticket_type,
      ticket.subject,
      ticket.message,
      ticket.device_details
    ].join(" ").toLowerCase();

    return (!searchTerm || searchable.includes(searchTerm))
      && (!statusValue || ticket.status === statusValue)
      && (!priorityValue || ticket.priority === priorityValue);
  });
}

function renderTickets() {
  if (!ticketTableBody) return;

  const filteredTickets = getFilteredTickets();

  if (ticketCount) {
    ticketCount.textContent = `${filteredTickets.length} ticket${filteredTickets.length === 1 ? "" : "s"}`;
  }

  if (ticketEmpty) ticketEmpty.classList.toggle("hidden", filteredTickets.length !== 0);

  if (!filteredTickets.length) {
    ticketTableBody.innerHTML = "";
    return;
  }

  ticketTableBody.innerHTML = filteredTickets.map((ticket) => `
    <tr class="ticket-row ${selectedTicketId === ticket.id ? "is-selected" : ""}" data-ticket-id="${escapeAttr(ticket.id)}">
      <td><strong>${escapeHtml(ticket.ticket_reference)}</strong></td>
      <td>
        <span class="ticket-customer-name">${escapeHtml(ticket.name)}</span>
        <small>${escapeHtml(ticket.email)}</small>
      </td>
      <td>
        <span class="ticket-subject">${escapeHtml(ticket.subject || "No subject")}</span>
        <small>${escapeHtml(ticket.ticket_type || "General")}</small>
      </td>
      <td><span class="ticket-badge ticket-status-${escapeAttr(ticket.status)}">${escapeHtml(ticketStatusLabel(ticket.status))}</span></td>
      <td><span class="ticket-badge ticket-priority-${escapeAttr(ticket.priority)}">${escapeHtml(ticketPriorityLabel(ticket.priority))}</span></td>
      <td>${escapeHtml(formatDateTime(ticket.created_at))}</td>
    </tr>
  `).join("");
}

function handleTicketTableClick(event) {
  const row = event.target.closest("[data-ticket-id]");
  if (!row) return;
  openTicket(row.dataset.ticketId);
}

function openTicket(ticketId) {
  const ticket = tickets.find((candidate) => candidate.id === ticketId);
  if (!ticket || !ticketDetail) return;

  selectedTicketId = ticket.id;
  loadedTicketReplies = [];
  renderTickets();

  const statusOptions = TICKET_STATUSES.map(([value, label]) => (
    `<option value="${value}" ${ticket.status === value ? "selected" : ""}>${label}</option>`
  )).join("");

  const priorityOptions = TICKET_PRIORITIES.map(([value, label]) => (
    `<option value="${value}" ${ticket.priority === value ? "selected" : ""}>${label}</option>`
  )).join("");

  const replySubject = `Re: Beadlight ticket ${ticket.ticket_reference} — ${ticket.subject || "Support request"}`;
  const fallbackSubject = encodeURIComponent(replySubject);

  ticketDetail.innerHTML = `
    <div class="ticket-detail-head">
      <div>
        <span class="ticket-reference-label">${escapeHtml(ticket.ticket_reference)}</span>
        <h3>${escapeHtml(ticket.subject || "No subject")}</h3>
      </div>
      <a class="secondary-button ticket-reply-button" href="mailto:${escapeAttr(ticket.email)}?subject=${fallbackSubject}">Open in email app</a>
    </div>

    <div class="ticket-detail-meta">
      <div><span>Customer</span><strong>${escapeHtml(ticket.name)}</strong></div>
      <div><span>Email</span><strong>${escapeHtml(ticket.email)}</strong></div>
      <div><span>Type</span><strong>${escapeHtml(ticket.ticket_type || "General")}</strong></div>
      <div><span>Received</span><strong>${escapeHtml(formatDateTime(ticket.created_at))}</strong></div>
      <div><span>Device</span><strong>${escapeHtml(ticket.device_details || "Not provided")}</strong></div>
      <div><span>Last replied</span><strong>${escapeHtml(ticket.last_replied_at ? formatDateTime(ticket.last_replied_at) : "Not yet")}</strong></div>
    </div>

    <div class="ticket-message-block">
      <span>Customer message</span>
      <p>${escapeHtml(ticket.message || "").replaceAll("\n", "<br>")}</p>
    </div>

    <section class="ticket-conversation" aria-labelledby="ticketConversationTitle">
      <div class="ticket-subsection-head">
        <div>
          <span class="ticket-subsection-kicker">Conversation</span>
          <h4 id="ticketConversationTitle">Replies sent from Beadlight</h4>
        </div>
      </div>
      <div id="ticketReplyHistory" class="ticket-reply-history">
        <div class="ticket-replies-loading">Loading reply history...</div>
      </div>
    </section>

    <section class="ticket-reply-composer" aria-labelledby="ticketReplyComposerTitle">
      <div class="ticket-subsection-head">
        <div>
          <span class="ticket-subsection-kicker">Direct reply</span>
          <h4 id="ticketReplyComposerTitle">Email ${escapeHtml(ticket.name)}</h4>
          <p>The customer will receive this from Beadlight Support.</p>
        </div>
      </div>

      <div class="ticket-reply-grid">
        <label class="wide">
          Subject
          <input id="ticketReplySubject" type="text" maxlength="200" value="${escapeAttr(replySubject)}">
        </label>

        <label class="wide">
          Message
          <textarea id="ticketReplyMessage" rows="9" maxlength="10000" placeholder="Write your reply here..."></textarea>
        </label>

        <label>
          Status after sending
          <select id="ticketReplyStatusAfter">
            <option value="waiting_for_customer" selected>Waiting for customer</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="keep">Keep current status</option>
          </select>
        </label>
      </div>

      <div class="ticket-send-row">
        <p>Reply-to address: <strong>beadlight@merciandigital.co.uk</strong></p>
        <button class="primary-button" id="sendTicketReplyBtn" type="button" data-ticket-id="${escapeAttr(ticket.id)}">Send reply</button>
      </div>

      <div class="admin-status" id="ticketReplyStatus"></div>
    </section>

    <div class="ticket-edit-divider"></div>

    <div class="ticket-edit-grid">
      <label>
        Ticket status
        <select id="ticketEditStatus">${statusOptions}</select>
      </label>

      <label>
        Priority
        <select id="ticketEditPriority">${priorityOptions}</select>
      </label>

      <label class="wide">
        Private admin notes
        <textarea id="ticketEditNotes" rows="6" placeholder="Add internal notes that the customer cannot see">${escapeHtml(ticket.admin_notes || "")}</textarea>
      </label>
    </div>

    <div class="admin-actions">
      <button class="primary-button" id="saveTicketBtn" type="button" data-ticket-id="${escapeAttr(ticket.id)}">Save ticket details</button>
    </div>

    <div class="admin-status" id="ticketSaveStatus"></div>
  `;

  loadTicketReplies(ticket.id);
}

function clearTicketDetail() {
  selectedTicketId = null;
  loadedTicketReplies = [];
  if (!ticketDetail) return;

  ticketDetail.innerHTML = `
    <div class="ticket-detail-placeholder">
      <span>✉</span>
      <h3>Select a ticket</h3>
      <p>Choose a ticket from the inbox to read it, reply and update its details.</p>
    </div>
  `;
}

function handleTicketDetailClick(event) {
  const sendReplyButton = event.target.closest("#sendTicketReplyBtn");

  if (sendReplyButton) {
    sendTicketReply(sendReplyButton.dataset.ticketId);
    return;
  }

  const saveButton = event.target.closest("#saveTicketBtn");
  if (!saveButton) return;
  saveTicket(saveButton.dataset.ticketId);
}

async function loadTicketReplies(ticketId) {
  const history = document.getElementById("ticketReplyHistory");
  if (!history || !ticketId) return;

  const { data, error } = await client
    .from("support_ticket_replies")
    .select("id,ticket_id,sender_email,recipient_email,subject,message,delivery_status,resend_email_id,error_message,sent_by_email,created_at,sent_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (selectedTicketId !== ticketId) return;

  if (error) {
    history.innerHTML = `<div class="ticket-reply-empty error-text">Could not load reply history: ${escapeHtml(error.message)}</div>`;
    return;
  }

  loadedTicketReplies = data || [];
  renderTicketReplies(loadedTicketReplies);
}

function renderTicketReplies(replies) {
  const history = document.getElementById("ticketReplyHistory");
  if (!history) return;

  if (!replies.length) {
    history.innerHTML = `<div class="ticket-reply-empty">No replies have been sent from the admin page yet.</div>`;
    return;
  }

  history.innerHTML = replies.map((reply) => `
    <article class="ticket-reply-entry ticket-reply-${escapeAttr(reply.delivery_status || "sent")}">
      <div class="ticket-reply-entry-head">
        <div>
          <strong>${escapeHtml(reply.subject || "Reply")}</strong>
          <span>To ${escapeHtml(reply.recipient_email || "customer")}</span>
        </div>
        <div class="ticket-reply-entry-meta">
          <span class="ticket-delivery-badge ticket-delivery-${escapeAttr(reply.delivery_status || "sent")}">${escapeHtml(titleCase(reply.delivery_status || "sent"))}</span>
          <time>${escapeHtml(formatDateTime(reply.sent_at || reply.created_at))}</time>
        </div>
      </div>
      <p>${escapeHtml(reply.message || "").replaceAll("\n", "<br>")}</p>
      ${reply.error_message ? `<small class="error-text">${escapeHtml(reply.error_message)}</small>` : ""}
    </article>
  `).join("");
}

async function sendTicketReply(ticketId) {
  const subjectInput = document.getElementById("ticketReplySubject");
  const messageInput = document.getElementById("ticketReplyMessage");
  const statusAfterInput = document.getElementById("ticketReplyStatusAfter");
  const sendButton = document.getElementById("sendTicketReplyBtn");
  const replyStatus = document.getElementById("ticketReplyStatus");

  if (!ticketId || !subjectInput || !messageInput || !statusAfterInput || !sendButton) return;

  const subject = subjectInput.value.trim();
  const message = messageInput.value.trim();

  if (!subject) {
    setInlineStatus(replyStatus, "Enter a subject before sending.", true);
    subjectInput.focus();
    return;
  }

  if (!message) {
    setInlineStatus(replyStatus, "Write a reply before sending.", true);
    messageInput.focus();
    return;
  }

  if (!confirm(`Send this reply to ${tickets.find((ticket) => ticket.id === ticketId)?.email || "the customer"}?`)) {
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = "Sending...";
  setInlineStatus(replyStatus, "Sending reply through Beadlight Support...");

  const { data, error } = await client.functions.invoke("send-ticket-reply", {
    body: {
      ticketId,
      subject,
      message,
      statusAfterSend: statusAfterInput.value
    }
  });

  if (error) {
    const detailedMessage = await getFunctionErrorMessage(error);
    sendButton.disabled = false;
    sendButton.textContent = "Send reply";
    setInlineStatus(replyStatus, "Could not send reply: " + detailedMessage, true);
    return;
  }

  if (!data || data.success !== true) {
    sendButton.disabled = false;
    sendButton.textContent = "Send reply";
    setInlineStatus(replyStatus, data?.error || "The reply could not be sent.", true);
    return;
  }

  messageInput.value = "";
  setTicketStatus(`Reply sent to ${data.recipientEmail || "the customer"}.`);

  await loadTickets();

  const refreshedReplyStatus = document.getElementById("ticketReplyStatus");
  setInlineStatus(
    refreshedReplyStatus,
    data.warning ? `Reply sent. ${data.warning}` : "Reply sent successfully."
  );
}

async function getFunctionErrorMessage(error) {
  if (error?.context && typeof error.context.json === "function") {
    try {
      const payload = await error.context.json();
      return payload?.error || payload?.message || error.message || "Unknown error";
    } catch (_ignored) {
      // Fall through to the standard error message.
    }
  }

  return error?.message || "Unknown error";
}

function setInlineStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error-text", isError);
}

async function saveTicket(ticketId) {
  const statusInput = document.getElementById("ticketEditStatus");
  const priorityInput = document.getElementById("ticketEditPriority");
  const notesInput = document.getElementById("ticketEditNotes");
  const saveStatus = document.getElementById("ticketSaveStatus");

  if (!ticketId || !statusInput || !priorityInput || !notesInput) return;

  setInlineStatus(saveStatus, "Saving ticket...");

  const { data, error } = await client
    .from("support_tickets")
    .update({
      status: statusInput.value,
      priority: priorityInput.value,
      admin_notes: notesInput.value.trim() || null
    })
    .eq("id", ticketId)
    .select()
    .single();

  if (error) {
    setInlineStatus(saveStatus, "Could not save ticket: " + error.message, true);
    return;
  }

  const index = tickets.findIndex((ticket) => ticket.id === ticketId);
  if (index !== -1) tickets[index] = data;

  renderTicketSummary();
  renderTickets();
  openTicket(ticketId);

  const refreshedStatus = document.getElementById("ticketSaveStatus");
  setInlineStatus(refreshedStatus, "Ticket saved.");
  setTicketStatus("Ticket updated successfully.");
}

function ticketStatusLabel(value) {
  const match = TICKET_STATUSES.find(([status]) => status === value);
  return match ? match[1] : titleCase(value || "open");
}

function ticketPriorityLabel(value) {
  const match = TICKET_PRIORITIES.find(([priority]) => priority === value);
  return match ? match[1] : titleCase(value || "normal");
}

async function signOut() {
  await client.auth.signOut();
  showLogin();
  setLoginStatus("Signed out.");
}

function shouldDisableSprint(status) {
  return STATUSES_WITHOUT_SPRINT.includes(status);
}

function getCurrentSprintText() {
  const now = new Date();
  return `${now.getFullYear()} Sprint ${getIsoWeekNumber(now)}`;
}

function weekInputValueToSprintText(value) {
  if (!value || !value.includes("-W")) return getCurrentSprintText();

  const parts = value.split("-W");
  const year = parts[0];
  const week = Number(parts[1]);

  if (!year || !week) return getCurrentSprintText();
  return `${year} Sprint ${week}`;
}

function sprintTextToWeekInputValue(value) {
  if (!value || value === "N/A") return getCurrentWeekInputValue();

  const match = String(value).match(/(\d{4})\s*Sprint\s*(\d{1,2})/i);
  if (!match) return getCurrentWeekInputValue();

  return `${match[1]}-W${String(match[2]).padStart(2, "0")}`;
}

function getCurrentWeekInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-W${String(getIsoWeekNumber(now)).padStart(2, "0")}`;
}

function getIsoWeekNumber(date) {
  const tempDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = tempDate.getUTCDay() || 7;
  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));
  return Math.ceil((((tempDate - yearStart) / 86400000) + 1) / 7);
}

function statusClass(status) {
  return `status-${String(status || "under-consideration").replace(/_/g, "-")}`;
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

function setTicketStatus(message, isError = false) {
  if (!ticketStatus) return;
  ticketStatus.textContent = message;
  ticketStatus.classList.toggle("error-text", isError);
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

function formatDateTime(value) {
  if (!value) return "Unknown";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

init();
