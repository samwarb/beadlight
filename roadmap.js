const ROADMAP_STATUSES = [
  ["under-consideration", "Under consideration"],
  ["planned", "Planned"],
  ["in-progress", "In progress"],
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

let roadmapClient;
let allRoadmapItems = [];

let currentSort = {
  key: "status",
  direction: "asc"
};

document.addEventListener("DOMContentLoaded", initRoadmap);

function initRoadmapClient() {
  const config = window.BEADLIGHT_SUPABASE || {};

  if (!config.url || !config.anonKey || config.url.includes("PASTE_YOUR")) {
    showRoadmapError("Roadmap is not configured yet.");
    return null;
  }

  return window.supabase.createClient(config.url, config.anonKey);
}

async function initRoadmap() {
  setCurrentSprintLabel();

  roadmapClient = initRoadmapClient();

  if (!roadmapClient) return;

  setupFilterListeners();
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
    showRoadmapError("Could not load roadmap: " + error.message);
    return;
  }

  allRoadmapItems = data || [];

  populateFilters(allRoadmapItems);
  renderFilteredRoadmap();
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

  board.innerHTML = renderRoadmapSummary(filteredItems) + renderRoadmapTable(sortedItems);

  setupSortButtons();
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
    const key = currentSort.key;
    const direction = currentSort.direction === "asc" ? 1 : -1;

    let valueA;
    let valueB;

    if (key === "title") {
      valueA = String(a.title || "").toLowerCase();
      valueB = String(b.title || "").toLowerCase();
      return valueA.localeCompare(valueB) * direction;
    }

    if (key === "status") {
      valueA = STATUS_ORDER[a.status] || 99;
      valueB = STATUS_ORDER[b.status] || 99;
      return (valueA - valueB) * direction;
    }

    if (key === "tag") {
      valueA = String(a.tag || "").toLowerCase();
      valueB = String(b.tag || "").toLowerCase();
      return valueA.localeCompare(valueB) * direction;
    }

    if (key === "priority") {
      valueA = getPrioritySortValue(a.priority);
      valueB = getPrioritySortValue(b.priority);
      return (valueA - valueB) * direction;
    }

    if (key === "sprint_due") {
      valueA = getSprintSortValue(a.sprint_due);
      valueB = getSprintSortValue(b.sprint_due);
      return (valueA - valueB) * direction;
    }

    if (key === "summary") {
      valueA = String(a.summary || "").toLowerCase();
      valueB = String(b.summary || "").toLowerCase();
      return valueA.localeCompare(valueB) * direction;
    }

    return 0;
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

function renderRoadmapTable(items) {
  if (!items.length) {
    return `<div class="empty-state">No roadmap items match these filters.</div>`;
  }

  const rows = items.map(renderRoadmapRow).join("");

  return `
    <section class="roadmap-table-wrap" aria-label="Roadmap table">
      <table class="roadmap-table">
        <thead>
          <tr>
            <th>
              <button class="sort-button" type="button" data-sort="title">
                Item ${getSortIndicator("title")}
              </button>
            </th>

            <th>
              <button class="sort-button" type="button" data-sort="status">
                Status ${getSortIndicator("status")}
              </button>
            </th>

            <th>
              <button class="sort-button" type="button" data-sort="tag">
                Tag ${getSortIndicator("tag")}
              </button>
            </th>

            <th>
              <button class="sort-button" type="button" data-sort="priority">
                Priority ${getSortIndicator("priority")}
              </button>
            </th>

            <th>
              <button class="sort-button" type="button" data-sort="sprint_due">
                Sprint due ${getSortIndicator("sprint_due")}
              </button>
            </th>

            <th>
              <button class="sort-button" type="button" data-sort="summary">
                Summary ${getSortIndicator("summary")}
              </button>
            </th>
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>
  `;
}

function setupSortButtons() {
  document.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const sortKey = button.dataset.sort;

      if (currentSort.key === sortKey) {
        currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
      } else {
        currentSort.key = sortKey;
        currentSort.direction = "asc";
      }

      renderFilteredRoadmap();
    });
  });
}

function getSortIndicator(key) {
  if (currentSort.key !== key) {
    return `<span class="sort-indicator">↕</span>`;
  }

  return currentSort.direction === "asc"
    ? `<span class="sort-indicator active">↑</span>`
    : `<span class="sort-indicator active">↓</span>`;
}

function renderRoadmapRow(item) {
  const title = item.title || "Untitled item";
  const statusValue = item.status || "under-consideration";
  const statusLabel = getStatusLabel(statusValue);
  const tag = item.tag || "Feature";
  const priority = item.priority || "Medium";
  const sprintDue = item.sprint_due || "N/A";
  const summary = item.summary || "";

  return `
    <tr>
      <td data-label="Item">
        <strong class="roadmap-item-title">${escapeHtml(title)}</strong>
      </td>

      <td data-label="Status">
        <span class="roadmap-pill status-pill status-${escapeAttr(statusValue)}">
          ${escapeHtml(statusLabel)}
        </span>
      </td>

      <td data-label="Tag">
        <span class="roadmap-pill tag-pill tag-${escapeAttr(slugify(tag))}">
          ${escapeHtml(tag)}
        </span>
      </td>

      <td data-label="Priority">
        <span class="roadmap-pill priority-pill priority-${escapeAttr(slugify(priority))}">
          ${escapeHtml(priority)}
        </span>
      </td>

      <td data-label="Sprint due">
        <span class="roadmap-sprint">${escapeHtml(sprintDue)}</span>
      </td>

      <td data-label="Summary">
        <span class="roadmap-summary-text">${escapeHtml(summary)}</span>
      </td>
    </tr>
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
