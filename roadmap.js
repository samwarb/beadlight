const ROADMAP_STATUSES = [
  ["in-progress", "In progress"],
  ["planned", "Planned"],
  ["under-consideration", "Under consideration"],
  ["released", "Released"],
  ["not-planned", "Not planned"]
];

const STATUS_ORDER = {
  "in-progress": 1,
  "planned": 2,
  "under-consideration": 3,
  "released": 4,
  "not-planned": 5
};

const STATUS_DESCRIPTIONS = {
  "in-progress": "Being actively worked on now.",
  "planned": "Chosen for an upcoming build cycle.",
  "under-consideration": "Ideas being shaped, validated, or scoped.",
  "released": "Already shipped and available.",
  "not-planned": "Not currently on the product path."
};

let roadmapClient;
let allRoadmapItems = [];

document.addEventListener("DOMContentLoaded", initRoadmap);

function initRoadmapClient() {
  const config = window.BEADLIGHT_SUPABASE || {};

  if (!config.url || !config.anonKey || config.url.includes("PASTE_YOUR")) {
    return null;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    return null;
  }

  return window.supabase.createClient(config.url, config.anonKey);
}

async function initRoadmap() {
  setCurrentSprintLabel();

  roadmapClient = initRoadmapClient();

  setupFilterListeners();

  if (!roadmapClient) {
    await loadStaticRoadmap();
    return;
  }

  await loadRoadmap();
}

function setCurrentSprintLabel() {
  const sprintLabel = document.getElementById("currentSprintLabel");

  if (!sprintLabel) return;

  sprintLabel.textContent = getCurrentSprintText();
}

function getCurrentSprintText() {
  const now = new Date();
  const year = now.getFullYear();
  const week = getIsoWeekNumber(now);

  return `${year} Sprint ${week}`;
}

function getIsoWeekNumber(date) {
  const tempDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = tempDate.getUTCDay() || 7;

  tempDate.setUTCDate(tempDate.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 1));

  return Math.ceil((((tempDate - yearStart) / 86400000) + 1) / 7);
}

function setupFilterListeners() {
  const search = document.getElementById("roadmapSearch");
  const statusFilter = document.getElementById("statusFilter");
  const tagFilter = document.getElementById("tagFilter");
  const priorityFilter = document.getElementById("priorityFilter");
  const sprintFilter = document.getElementById("sprintFilter");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");

  [search, statusFilter, tagFilter, priorityFilter, sprintFilter].forEach((control) => {
    if (!control) return;

    control.addEventListener("input", renderFilteredRoadmap);
    control.addEventListener("change", renderFilteredRoadmap);
  });

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", clearFilters);
  }
}

async function loadRoadmap() {
  const board = document.getElementById("roadmapBoard");

  if (!board) return;

  board.innerHTML = `<div class="empty-state">Loading roadmap…</div>`;

  const { data, error } = await roadmapClient
    .from("roadmap_items")
    .select("id,title,summary,status,tag,priority,sprint_due,created_at,updated_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false });

  if (error) {
    const usedFallback = await loadStaticRoadmap();
    if (!usedFallback) {
      showRoadmapError("Could not load roadmap: " + error.message);
    }
    return;
  }

  allRoadmapItems = normalizeRoadmapItems(data || []);

  populateFilters(allRoadmapItems);
  renderFilteredRoadmap();
}

async function loadStaticRoadmap() {
  try {
    const response = await fetch("../data/roadmap.json", { cache: "no-store" });

    if (!response.ok) throw new Error("Static roadmap file was not found.");

    const payload = await response.json();

    allRoadmapItems = normalizeRoadmapItems(payload.items || []);

    populateFilters(allRoadmapItems);
    renderFilteredRoadmap();
    return true;
  } catch (error) {
    showRoadmapError(error.message || "Could not load roadmap.");
    return false;
  }
}

function normalizeRoadmapItems(items) {
  const statusAliases = {
    "wont-do": "not-planned"
  };

  return items.map((item) => {
    const status = statusAliases[item.status] || item.status || "under-consideration";

    return {
      ...item,
      status,
      sprint_due: item.sprint_due || "N/A"
    };
  });
}

function populateFilters(items) {
  populateStatusFilter();
  populateSelect("tagFilter", getUniqueValues(items, "tag"), "All tags");
  populateSelect("priorityFilter", getPriorityValues(items), "All priorities");
  populateSelect("sprintFilter", getSprintValues(items), "All sprints");
}

function populateStatusFilter() {
  const statusFilter = document.getElementById("statusFilter");

  if (!statusFilter) return;

  statusFilter.innerHTML = `
    <option value="">All statuses</option>
    ${ROADMAP_STATUSES.map(([value, label]) => {
      return `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`;
    }).join("")}
  `;
}

function populateSelect(id, values, defaultLabel) {
  const select = document.getElementById(id);

  if (!select) return;

  select.innerHTML = `
    <option value="">${escapeHtml(defaultLabel)}</option>
    ${values.map((value) => {
      return `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`;
    }).join("")}
  `;
}

function getUniqueValues(items, key) {
  return [...new Set(
    items
      .map((item) => item[key])
      .filter(Boolean)
      .map((value) => String(value).trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
}

function getPriorityValues(items) {
  const priorityOrder = ["Urgent", "High", "Medium", "Low"];
  const found = getUniqueValues(items, "priority");

  return priorityOrder
    .filter((priority) => found.includes(priority))
    .concat(found.filter((priority) => !priorityOrder.includes(priority)));
}

function getSprintValues(items) {
  const found = getUniqueValues(items, "sprint_due");

  return found.sort((a, b) => {
    return getSprintSortValue(a) - getSprintSortValue(b);
  });
}

function renderFilteredRoadmap() {
  const filteredItems = getFilteredItems();
  const sortedItems = sortItems(filteredItems);

  const board = document.getElementById("roadmapBoard");

  if (!board) return;

  board.innerHTML = renderRoadmapSummary(filteredItems) + renderRoadmapGroups(sortedItems);

  updateResultCount(filteredItems.length, allRoadmapItems.length);
}

function getFilteredItems() {
  const searchValue = getControlValue("roadmapSearch").toLowerCase();
  const statusValue = getControlValue("statusFilter");
  const tagValue = getControlValue("tagFilter");
  const priorityValue = getControlValue("priorityFilter");
  const sprintValue = getControlValue("sprintFilter");

  return allRoadmapItems.filter((item) => {
    const title = String(item.title || "").toLowerCase();
    const summary = String(item.summary || "").toLowerCase();
    const tag = String(item.tag || "");
    const priority = String(item.priority || "");
    const sprint = String(item.sprint_due || "");
    const status = String(item.status || "");

    const matchesSearch =
      !searchValue ||
      title.includes(searchValue) ||
      summary.includes(searchValue) ||
      tag.toLowerCase().includes(searchValue) ||
      priority.toLowerCase().includes(searchValue) ||
      sprint.toLowerCase().includes(searchValue) ||
      getStatusLabel(status).toLowerCase().includes(searchValue);

    const matchesStatus = !statusValue || status === statusValue;
    const matchesTag = !tagValue || tag === tagValue;
    const matchesPriority = !priorityValue || priority === priorityValue;
    const matchesSprint = !sprintValue || sprint === sprintValue;

    return matchesSearch && matchesStatus && matchesTag && matchesPriority && matchesSprint;
  });
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const statusCompare = (STATUS_ORDER[a.status] || 99) - (STATUS_ORDER[b.status] || 99);
    if (statusCompare !== 0) return statusCompare;

    const priorityCompare = getPrioritySortValue(a.priority) - getPrioritySortValue(b.priority);
    if (priorityCompare !== 0) return priorityCompare;

    const sprintCompare = getSprintSortValue(a.sprint_due) - getSprintSortValue(b.sprint_due);
    if (sprintCompare !== 0) return sprintCompare;

    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function getPrioritySortValue(priority) {
  const order = {
    urgent: 1,
    high: 2,
    medium: 3,
    low: 4
  };

  return order[String(priority || "").toLowerCase()] || 99;
}

function clearFilters() {
  setControlValue("roadmapSearch", "");
  setControlValue("statusFilter", "");
  setControlValue("tagFilter", "");
  setControlValue("priorityFilter", "");
  setControlValue("sprintFilter", "");

  renderFilteredRoadmap();
}

function getControlValue(id) {
  const control = document.getElementById(id);
  return control ? control.value : "";
}

function setControlValue(id, value) {
  const control = document.getElementById(id);
  if (control) control.value = value;
}

function updateResultCount(filteredCount, totalCount) {
  const count = document.getElementById("filterResultCount");

  if (!count) return;

  if (filteredCount === totalCount) {
    count.textContent = `Showing all ${totalCount} roadmap item${totalCount === 1 ? "" : "s"}.`;
    return;
  }

  count.textContent = `Showing ${filteredCount} of ${totalCount} roadmap item${totalCount === 1 ? "" : "s"}.`;
}

function renderRoadmapSummary(items) {
  const counts = ROADMAP_STATUSES.map(([statusValue, statusLabel]) => {
    const count = items.filter((item) => item.status === statusValue).length;

    return `
      <div class="roadmap-summary-card status-${escapeAttr(statusValue)}">
        <span>${count}</span>
        <strong>${escapeHtml(statusLabel)}</strong>
      </div>
    `;
  }).join("");

  return `
    <section class="roadmap-summary-grid" aria-label="Roadmap summary">
      ${counts}
    </section>
  `;
}

function renderRoadmapGroups(items) {
  if (!items.length) {
    return `<div class="empty-state">No roadmap items match these filters.</div>`;
  }

  const activeStatusFilter = getControlValue("statusFilter");
  const groups = ROADMAP_STATUSES
    .filter(([statusValue]) => !activeStatusFilter || statusValue === activeStatusFilter)
    .map(([statusValue, statusLabel]) => {
      return {
        statusValue,
        statusLabel,
        items: items.filter((item) => (item.status || "under-consideration") === statusValue)
      };
    })
    .filter((group) => group.items.length > 0);

  return `
    <section class="roadmap-status-board" aria-label="Roadmap grouped by status">
      ${groups.map(renderRoadmapGroup).join("")}
    </section>
  `;
}

function renderRoadmapGroup(group) {
  const description = STATUS_DESCRIPTIONS[group.statusValue] || "Roadmap items in this status.";
  const countLabel = `${group.items.length} item${group.items.length === 1 ? "" : "s"}`;

  return `
    <article class="roadmap-status-group roadmap-group-${escapeAttr(group.statusValue)}">
      <header class="roadmap-status-head">
        <span class="roadmap-pill status-pill status-${escapeAttr(group.statusValue)}">
          ${escapeHtml(group.statusLabel)}
        </span>
        <h3>${escapeHtml(group.statusLabel)}</h3>
        <p>${escapeHtml(description)}</p>
        <strong>${escapeHtml(countLabel)}</strong>
      </header>

      <div class="roadmap-card-grid">
        ${group.items.map(renderRoadmapCard).join("")}
      </div>
    </article>
  `;
}

function renderRoadmapCard(item) {
  const title = item.title || "Untitled item";
  const tag = item.tag || "Feature";
  const priority = item.priority || "Medium";
  const sprintDue = item.sprint_due || "N/A";
  const summary = item.summary || "";

  return `
    <article class="roadmap-item-card">
      <div class="roadmap-item-card-top">
        <span class="roadmap-pill tag-pill tag-${escapeAttr(slugify(tag))}">
          ${escapeHtml(tag)}
        </span>

        <span class="roadmap-pill priority-pill priority-${escapeAttr(slugify(priority))}">
          ${escapeHtml(priority)}
        </span>
      </div>

      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(summary)}</p>

      <dl class="roadmap-card-meta">
        <div>
          <dt>Sprint due</dt>
          <dd>${escapeHtml(sprintDue)}</dd>
        </div>
      </dl>
    </article>
  `;
}

function getStatusLabel(value) {
  const match = ROADMAP_STATUSES.find(([statusValue]) => statusValue === value);

  return match ? match[1] : value;
}

function getSprintSortValue(value) {
  if (!value || value === "N/A") return 999999;

  const match = String(value).match(/(\d{4})\s*Sprint\s*(\d{1,2})/i);

  if (!match) return 999999;

  const year = Number(match[1]);
  const week = Number(match[2]);

  return year * 100 + week;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function showRoadmapError(message) {
  setCurrentSprintLabel();

  const board = document.getElementById("roadmapBoard");

  if (!board) return;

  board.innerHTML = `<div class="empty-state error-text">${escapeHtml(message)}</div>`;
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
