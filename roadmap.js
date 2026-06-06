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

function initRoadmapClient() {
  const config = window.BEADLIGHT_SUPABASE || {};

  if (!config.url || !config.anonKey || config.url.includes("PASTE_YOUR")) {
    showRoadmapError("Roadmap is not configured yet.");
    return null;
  }

  return window.supabase.createClient(config.url, config.anonKey);
}

async function initRoadmap() {
  roadmapClient = initRoadmapClient();

  if (!roadmapClient) return;

  await loadRoadmap();
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

  const items = data || [];

  const sortedItems = [...items].sort((a, b) => {
    const statusA = STATUS_ORDER[a.status] || 99;
    const statusB = STATUS_ORDER[b.status] || 99;

    if (statusA !== statusB) return statusA - statusB;

    const sprintA = getSprintSortValue(a.sprint_due);
    const sprintB = getSprintSortValue(b.sprint_due);

    return sprintA - sprintB;
  });

  board.innerHTML = renderRoadmapSummary(items) + renderRoadmapTable(sortedItems);
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
    return `<div class="empty-state">No roadmap items yet.</div>`;
  }

  const rows = items.map(renderRoadmapRow).join("");

  return `
    <section class="roadmap-table-wrap" aria-label="Roadmap table">
      <table class="roadmap-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Status</th>
            <th>Tag</th>
            <th>Priority</th>
            <th>Sprint due</th>
            <th>Summary</th>
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>
  `;
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

initRoadmap();
