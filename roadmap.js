const STATUS_ORDER = [
  { key: "under-consideration", label: "Under consideration", note: "Ideas being explored" },
  { key: "planned", label: "Planned", note: "Likely to be built" },
  { key: "in-progress", label: "In progress", note: "Currently being worked on" },
  { key: "released", label: "Released", note: "Already live" },
  { key: "not-planned", label: "Not planned", note: "Not on the roadmap right now" }
];

function getClient() {
  const config = window.BEADLIGHT_SUPABASE || {};
  if (!config.url || !config.anonKey || config.url.includes("PASTE_YOUR")) {
    throw new Error("Supabase is not configured yet. Add your project URL and anon key to beadlight/supabase-config.js.");
  }
  return window.supabase.createClient(config.url, config.anonKey);
}

async function loadRoadmap() {
  const client = getClient();
  const { data, error } = await client
    .from("roadmap_items")
    .select("id,title,summary,status,tag,priority,sort_order,created_at,updated_at")
    .eq("is_public", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

function renderRoadmap(items) {
  const board = document.getElementById("roadmapBoard");
  const meta = document.getElementById("roadmapMeta");
  if (!board) return;

  board.innerHTML = STATUS_ORDER.map(status => {
    const filtered = items.filter(item => item.status === status.key);
    return `
      <article class="roadmap-column">
        <div class="roadmap-column-header">
          <div>
            <h2>${status.label}</h2>
            <p>${status.note}</p>
          </div>
          <span>${filtered.length}</span>
        </div>
        <div class="roadmap-list">
          ${filtered.length ? filtered.map(renderItem).join("") : `<div class="empty-state">Nothing here yet.</div>`}
        </div>
      </article>`;
  }).join("");

  if (meta) {
    const latest = items.map(i => i.updated_at || i.created_at).filter(Boolean).sort().pop();
    meta.textContent = latest ? `Last updated ${formatDate(latest)}` : `${items.length} roadmap items`;
  }
}

function renderItem(item) {
  return `
    <div class="roadmap-item">
      <div class="roadmap-item-top">
        <strong>${escapeHtml(item.title || "Untitled")}</strong>
        ${item.priority ? `<span>${escapeHtml(item.priority)}</span>` : ""}
      </div>
      <p>${escapeHtml(item.summary || "")}</p>
      ${item.tag ? `<small>${escapeHtml(item.tag)}</small>` : ""}
    </div>`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

loadRoadmap().then(renderRoadmap).catch(error => {
  const board = document.getElementById("roadmapBoard");
  const meta = document.getElementById("roadmapMeta");
  if (meta) meta.textContent = "Roadmap could not be loaded.";
  if (board) board.innerHTML = `<div class="roadmap-error">${escapeHtml(error.message)}</div>`;
});
