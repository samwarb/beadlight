const ROADMAP_STATUSES = [
  ["under-consideration", "Under consideration"],
  ["planned", "Planned"],
  ["in-progress", "In progress"],
  ["released", "Released"],
  ["not-planned", "Not planned"]
];

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

  board.innerHTML = ROADMAP_STATUSES.map(([statusValue, statusLabel]) => {
    const statusItems = items.filter((item) => item.status === statusValue);

    return `
      <section class="roadmap-column">
        <div class="roadmap-column-head">
          <h2>${escapeHtml(statusLabel)}</h2>
          <span>${statusItems.length}</span>
        </div>

        <div class="roadmap-list">
          ${
            statusItems.length
              ? statusItems.map(renderRoadmapItem).join("")
              : `<div class="empty-state small">No items yet.</div>`
          }
        </div>
      </section>
    `;
  }).join("");
}

function renderRoadmapItem(item) {
  const tag = item.tag || "Feature";
  const priority = item.priority || "Medium";
  const sprintDue = item.sprint_due || "Not assigned";

  return `
    <article class="roadmap-card">
      <div class="roadmap-card-meta">
        <span>${escapeHtml(tag)}</span>
        <span>${escapeHtml(priority)}</span>
        <span>${escapeHtml(sprintDue)}</span>
      </div>

      <h3>${escapeHtml(item.title || "Untitled item")}</h3>

      <p>${escapeHtml(item.summary || "")}</p>
    </article>
  `;
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

initRoadmap();
