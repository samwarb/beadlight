(() => {
  "use strict";

  const element = (id) => document.getElementById(id);
  const iosTab = element("pushTabIos");
  const androidTab = element("pushTabAndroid");
  const iosPane = element("pushIosPane");
  const androidPane = element("pushAndroidPane");
  const audience = element("androidPushAudience");
  const title = element("androidPushTitle");
  const body = element("androidPushBody");
  const device = element("androidPushTestId");
  const previewButton = element("androidPushRefresh");
  const testButton = element("androidPushTest");
  const sendButton = element("androidPushSend");
  const preview = element("androidPushPreview");
  const status = element("androidPushStatus");
  const history = element("androidPushHistory");

  let client = null;
  let previewResult = null;
  let busy = false;
  let retry = null;
  let contextVersion = 0;

  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle("error", error);
  }

  function updateButtons() {
    audience.disabled = busy;
    previewButton.disabled = !client || busy;
    testButton.disabled = !client || busy || !previewResult?.fcm_configured;
    sendButton.disabled = !client || busy || !previewResult?.ready_to_send;
  }

  function target() {
    return audience.value === "general"
      ? { audience: "general", challenge_slug: null }
      : { audience: "challenge", challenge_slug: audience.value.slice("challenge:".length) };
  }

  async function invoke(payload) {
    const response = await client.functions.invoke("beadlight-android-push-admin", { body: payload });
    if (response.error) {
      const reason = await response.error.context?.json?.().catch(() => null);
      throw new Error(reason?.error || response.error.message || "Request failed");
    }
    if (response.data?.error) throw new Error(response.data.error);
    return response.data;
  }

  async function loadPreview() {
    if (!client || busy) return;
    const version = contextVersion;
    busy = true;
    previewResult = null;
    preview.textContent = "Checking Android recipients…";
    updateButtons();
    try {
      const response = await invoke({ action: "preview", ...target() });
      if (version !== contextVersion) return;
      previewResult = response;
      const recipients = response.limited ? "More than 150" : response.eligible_devices;
      preview.textContent = [
        recipients + " eligible Android device(s)",
        response.fcm_configured ? "Firebase configured" : "Firebase sender key required",
        response.successful_test_recorded ? "Test recorded" : "Test send required",
      ].join(" · ");
    } catch (error) {
      if (version === contextVersion) {
        preview.textContent = "Android preview unavailable";
        message(error.message, true);
      }
    } finally {
      busy = false;
      updateButtons();
      if (client && version !== contextVersion && !androidPane.hidden) void loadPreview();
    }
  }

  async function loadHistory() {
    if (!client) return;
    const version = contextVersion;
    try {
      const response = await invoke({ action: "history" });
      if (version !== contextVersion) return;
      history.replaceChildren();
      for (const item of response.history || []) {
        const row = document.createElement("div");
        row.className = "item";
        const heading = document.createElement("strong");
        heading.textContent = (item.is_test ? "Test: " : "") + item.title;
        const detail = document.createElement("span");
        detail.textContent = item.body;
        const metadata = document.createElement("small");
        metadata.textContent = [
          new Date(item.sent_at).toLocaleString(),
          item.challenge_slug || "Beadlight announcements",
          item.status, item.accepted_count + " accepted by Firebase", item.failed_count + " failed",
        ].join(" · ");
        row.append(heading, detail, metadata);
        history.append(row);
      }
      if (!history.childElementCount) {
        const empty = document.createElement("p");
        empty.className = "help";
        empty.textContent = "No Android messages have been sent.";
        history.append(empty);
      }
    } catch (error) {
      if (version === contextVersion) message("History: " + error.message, true);
    }
  }

  async function submit(test) {
    if (!client || busy) return;
    const version = contextVersion;
    const payload = {
      action: test ? "test" : "send",
      ...target(),
      title: title.value.trim(),
      body: body.value.trim(),
      test_installation_id: test ? device.value.trim() : null,
    };
    if (!payload.title || !payload.body || payload.title.length > 100 || payload.body.length > 240) {
      message("Enter a title and message within the length limits.", true);
      return;
    }
    const installationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (test && !installationId.test(payload.test_installation_id)) {
      message("Enter the Android test device ID shown in Beadlight.", true);
      return;
    }
    if (test ? !previewResult?.fcm_configured : !previewResult?.ready_to_send) return;
    if (!window.confirm(test
      ? "Send a test to the specified opted-in Android device?"
      : "Send this message to the eligible Android audience?")) return;
    if (window.prompt("Type SEND to confirm the Android notification:") !== "SEND") return;
    const signature = JSON.stringify(payload);
    if (retry?.signature !== signature) retry = { signature, id: crypto.randomUUID() };

    busy = true;
    updateButtons();
    message("Sending through Firebase…");
    try {
      const response = await invoke({ ...payload, request_id: retry.id, confirmation_phrase: "SEND" });
      if (version !== contextVersion) return;
      retry = null;
      message(
        response.accepted_by_fcm + " accepted by Firebase; " + response.failed + " failed." +
        (response.history_saved ? "" : " The history could not be updated. Check before retrying."),
        response.failed > 0 || !response.history_saved
      );
      await loadHistory();
    } catch (error) {
      if (version === contextVersion) message(error.message, true);
    } finally {
      busy = false;
      updateButtons();
      if (client && !androidPane.hidden) void loadPreview();
    }
  }

  function selectTab(android, focus = false) {
    androidPane.hidden = !android;
    iosPane.hidden = android;
    [[iosTab, !android], [androidTab, android]].forEach(([tab, selected]) => {
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.classList.toggle("secondary", !selected);
      if (selected && focus) tab.focus();
    });
    if (android) {
      void loadPreview();
      void loadHistory();
    }
  }

  iosTab.addEventListener("click", () => selectTab(false));
  androidTab.addEventListener("click", () => selectTab(true));
  for (const tab of [iosTab, androidTab]) {
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      selectTab(event.key === "End" || (event.key !== "Home" && tab === iosTab), true);
    });
  }
  audience.addEventListener("change", loadPreview);
  previewButton.addEventListener("click", loadPreview);
  testButton.addEventListener("click", () => submit(true));
  sendButton.addEventListener("click", () => submit(false));

  window.BeadlightAndroidPush = {
    setContext(nextClient, challenges) {
      client = nextClient;
      contextVersion++;
      previewResult = null;
      if (!client) {
        title.value = body.value = device.value = "";
        retry = null;
        history.replaceChildren();
        message("");
        selectTab(false);
      }
      const selected = audience.value;
      audience.replaceChildren();
      const options = [
        ["challenge:daily", "Daily Rosary Challenge"],
        ...challenges.filter((challenge) => challenge.is_published && challenge.slug !== "daily")
          .map((challenge) => ["challenge:" + challenge.slug, challenge.title_en]),
        ["general", "Beadlight news and offers"],
      ];
      for (const [value, label] of options) audience.add(new Option(label, value));
      if (options.some(([value]) => value === selected)) audience.value = selected;
      updateButtons();
      if (!androidPane.hidden) {
        void loadPreview();
        void loadHistory();
      }
    },
  };
})();
