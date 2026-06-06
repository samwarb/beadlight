const STATUSES = [
  ["under-consideration", "Under consideration"],
  ["planned", "Planned"],
  ["in-progress", "In progress"],
  ["released", "Released"],
  ["not-planned", "Not planned"]
];

const ADMIN_REDIRECT_URL = "https://beadlight.merciandigital.co.uk/admin/";

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

  if (loginBtn) loginBtn.addEventListener("click", sendMagicLink);
  if (signOutBtn) signOutBtn.addEventListener("click", signOut);
  if (addBtn) addBtn.addEventListener("click", addItem);

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
    return setLoginStatus("Enter your email address first.", true);
  }

  setLoginStatus("Sending magic link…");

  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: ADMIN_REDIRECT_URL
    }
  });

  if (error) {
    return setLoginStatus(error.message, true);
  }

  setLoginStatus("Magic link sent. Check your email, then open the newest link.");
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
  if (!editor) return;

  editor.innerHTML = items.length
    ? items.map(renderEditorItem).join("")
    : `<div class="empty-state">No roadmap items yet.</div>`;

  editor
    .querySelectorAll("[data-action='save']")
    .forEach((btn) => {
      btn.addEventListener("click", () => saveItem(btn.dataset.id));
    });

  editor
    .querySelectorAll("[data-action='delete']")
    .forEach((btn) => {
      btn.addEventListener("click", () => deleteItem(btn.dataset.id));
    });
}

function renderEditorItem(item) {
  const statusOptions = STATUSES.map(([value, label]) => {
    return `<option value="${value}" ${item.status === value ? "selected" : ""}>${label}</option>`;
  }).join("");

  return `
    <article class="editor-card" data-id="${escapeAttr(item.id)}">
      <div class="admin-grid">
        <label>
          Title
          <input data-field="title" value="${escapeAttr(item.title || "")}">
        </label>

        <label>
          Status
          <select data-field="status">
            ${statusOptions}
          </select>
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
        <button class="primary-button" data-action="save" data-id="${escapeAttr(item.id)}">Save</button>
        <button class="secondary-button danger-button" data-action="delete" data-id="${escapeAttr(item.id)}">Delete</button>
      </div>
    </article>
  `;
}

function getCardValues(id) {
  const card = editor.querySelector(`[data-id='${CSS.escape(id)}']`);

  if (!card) {
    return null;
  }

  const get = (field) => {
    const input = card.querySelector(`[data-field='${field}']`);
    return input ? input.value : "";
  };

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

  if (!values) {
    return setAdminStatus("Could not find this roadmap item.", true);
  }

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
  const confirmed = confirm("Delete this roadmap item?");

  if (!confirmed) return;

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
  if (!loginStatus) return;

  loginStatus.innerHTML = escapeHtml(message);
  loginStatus.classList.toggle("error-text", isError);
}

function setAdminStatus(message, isError = false) {
  if (!adminStatus) return;

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
