const STATUSES = [
  ["under-consideration", "Under consideration"],
  ["planned", "Planned"],
  ["in-progress", "In progress"],
  ["released", "Released"],
  ["not-planned", "Not planned"]
];

let client;
let items = [];

const loginPanel = document.getElementById("loginPanel");
const editorPanel = document.getElementById("editorPanel");
const loginStatus = document.getElementById("loginStatus");
const adminStatus = document.getElementById("adminStatus");
const editor = document.getElementById("itemsEditor");

function initClient() {
  const config = window.BEADLIGHT_SUPABASE || {};

  if (!config.url || !config.anonKey || config.url.includes("PASTE_YOUR")) {
    setLoginStatus(
      "Supabase is not configured yet. Add your project URL and anon key to supabase-config.js.",
      true
    );
    return null;
  }

  return window.supabase.createClient(config.url, config.anonKey);
}

async function init() {
  client = initClient();
  if (!client) return;

  document.getElementById("loginBtn").addEventListener("click", sendMagicLink);
  document.getElementById("signOutBtn").addEventListener("click", signOut);
  document.getElementById("addBtn").addEventListener("click", addItem);

  const {
    data: { session }
  } = await client.auth.getSession();

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
  const email = document.getElementById("email").value.trim();

  if (!email) {
    return setLoginStatus("Enter your email address first.", true);
  }

  setLoginStatus("Sending magic link…");

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/admin/`
    }
  });

  if (error) {
    return setLoginStatus(error.message, true);
  }

  setLoginStatus("Magic link sent. Check your email, then open the link on this device.");
}

async function showEditor() {
  loginPanel.classList.add("hidden");
  editorPanel.classList.remove("hidden");
  await loadItems();
}

async function loadItems() {
  setAdminStatus("Loading roadmap…");

  const { data, error } = await client
    .from("roadmap_items")
    .select("id,title,summary,status,tag,priority,sort_order,is_public,created_at,updated_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) {
    setAdminStatus(error.message, true);
    return;
  }

  items = data || [];
  renderEditor();
  setAdminStatus(`${items.length} item${items.length === 1 ? "" : "s"} loaded.`);
}

function renderEditor() {
  editor.innerHTML = items.length
    ? items.map(renderEditorItem).join("")
    : `<div class="empty-state">No roadmap items yet.</div>`;

  editor
    .querySelectorAll("[data-action='save']")
    .forEach((btn) => btn.addEventListener("click", () => saveItem(btn.dataset.id)));

  editor
    .querySelectorAll("[data-action='delete']")
    .forEach((btn) => btn.addEventListener("click", () => deleteItem(btn.dataset.id)));
}

function renderEditorItem(item) {
  const statusOptions = STATUSES.map(
    ([value, label]) =>
      `<option value="${value}" ${item.status === value ? "selected" : ""}>${label}</option>`
  ).join("");

  return `
    <article class="editor-card" data-id="${item.id}">
      <div class="admin-grid">
        <label>
          Title
          <input data-field="title" value="${escapeAttr(item.title || "")}">
        </label>

        <label>
          Status
          <select data-field="status">${statusOptions}</select>
        </label>

        <label>
          Tag
          <input data-field="tag" value="${escapeAttr(item.tag || "")}" placeholder="e.g. Android, Audio, UI">
        </label>

        <label>
          Priority
          <input data-field="priority" value="${escapeAttr(item.priority || "")}" placeholder="High / Medium / Low">
        </label>

        <label>
          Sort order
          <input data-field="sort_order" type="number" value="${Number(item.sort_order || 0)}">
        </label>

        <label>
          Visible
          <select data-field="is_public">
            <option value="true" ${item.is_public ? "selected" : ""}>Public</option>
            <option value="false" ${!item.is_public ? "selected" : ""}>Hidden</option>
          </select>
        </label>

        <label class="wide">
          Summary
          <textarea data-field="summary" rows="3">${escapeHtml(item.summary || "")}</textarea>
        </label>
      </div>

      <div class="admin-actions">
        <button class="primary-button" data-action="save" data-id="${item.id}">Save</button>
        <button class="secondary-button danger-button" data-action="delete" data-id="${item.id}">Delete</button>
      </div>
    </article>
  `;
}

function getCardValues(id) {
  const card = editor.querySelector(`[data-id='${CSS.escape(id)}']`);

  const get = (field) => card.querySelector(`[data-field='${field}']`).value;

  return {
    title: get("title").trim(),
    status: get("status"),
    tag: get("tag").trim(),
    priority: get("priority").trim(),
    sort_order: Number(get("sort_order")) || 0,
    is_public: get("is_public") === "true",
    summary: get("summary").trim()
  };
}

async function saveItem(id) {
  const values = getCardValues(id);

  if (!values.title) {
    return setAdminStatus("Title is required.", true);
  }

  setAdminStatus("Saving…");

  const { error } = await client
    .from("roadmap_items")
    .update(values)
    .eq("id", id);

  if (error) {
    return setAdminStatus(error.message, true);
  }

  await loadItems();
  setAdminStatus("Saved.");
}

async function addItem() {
  setAdminStatus("Adding item…");

  const { error } = await client.from("roadmap_items").insert({
    title: "New roadmap item",
    summary: "Describe the feature or improvement.",
    status: "under-consideration",
    tag: "Idea",
    priority: "Medium",
    sort_order: 100,
    is_public: true
  });

  if (error) {
    return setAdminStatus(error.message, true);
  }

  await loadItems();
  setAdminStatus("New item added.");
}

async function deleteItem(id) {
  if (!confirm("Delete this roadmap item?")) return;

  setAdminStatus("Deleting…");

  const { error } = await client
    .from("roadmap_items")
    .delete()
    .eq("id", id);

  if (error) {
    return setAdminStatus(error.message, true);
  }

  await loadItems();
  setAdminStatus("Deleted.");
}

async function signOut() {
  await client.auth.signOut();

  editorPanel.classList.add("hidden");
  loginPanel.classList.remove("hidden");

  setLoginStatus("Signed out.");
}

function setLoginStatus(message, isError = false) {
  loginStatus.innerHTML = escapeHtml(message);
  loginStatus.classList.toggle("error-text", isError);
}

function setAdminStatus(message, isError = false) {
  adminStatus.textContent = message;
  adminStatus.classList.toggle("error-text", isError);
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
