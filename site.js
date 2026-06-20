(function () {
  const root = document.documentElement.dataset.siteRoot || ".";
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let revealObserver = null;

  function ready(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
      return;
    }

    callback();
  }

  function track(eventNames, properties = {}) {
    if (!eventNames) return;

    String(eventNames)
      .split(/[\s,]+/)
      .filter(Boolean)
      .forEach((eventName) => {
        const payload = {
          event_category: "Beadlight Website",
          ...properties
        };

        if (typeof window.gtag === "function") {
          window.gtag("event", eventName, payload);
        }

        if (typeof window.plausible === "function") {
          window.plausible(eventName, { props: payload });
        }

        if (Array.isArray(window.dataLayer)) {
          window.dataLayer.push({ event: eventName, ...payload });
        }
      });
  }

  window.beadlightTrack = track;

  function initAnalyticsDelegation() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-analytics-event]");
      if (!target) return;

      track(target.dataset.analyticsEvent, {
        label: target.textContent.trim(),
        href: target.href || null
      });
    });
  }

  function initMenu() {
    const header = document.querySelector("[data-site-header]");
    const toggle = document.querySelector("[data-menu-toggle]");
    const nav = document.getElementById("siteNav");

    if (!header || !toggle || !nav) return;

    function setOpen(isOpen) {
      header.classList.toggle("is-menu-open", isOpen);
      document.body.classList.toggle("is-menu-open", isOpen);
      toggle.setAttribute("aria-expanded", String(isOpen));
    }

    toggle.addEventListener("click", () => {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });

    document.addEventListener("click", (event) => {
      if (!header.classList.contains("is-menu-open")) return;
      if (header.contains(event.target)) return;
      setOpen(false);
    });
  }

  function initDailyMystery() {
    const targets = document.querySelectorAll("[data-daily-mystery]");
    if (!targets.length) return;

    const mysteriesByDay = [
      "Glorious Mysteries",
      "Joyful Mysteries",
      "Sorrowful Mysteries",
      "Glorious Mysteries",
      "Luminous Mysteries",
      "Sorrowful Mysteries",
      "Joyful Mysteries"
    ];

    const mystery = mysteriesByDay[new Date().getDay()];
    targets.forEach((target) => {
      target.textContent = mystery;
    });
  }

  function initFaqTracking() {
    document.querySelectorAll(".faq-list details").forEach((details) => {
      details.addEventListener("toggle", () => {
        if (!details.open) return;

        const summary = details.querySelector("summary");
        track("faq_interaction", {
          question: summary ? summary.textContent.trim() : "FAQ item"
        });
      });
    });
  }

  function initScrollAnimations() {
    if (motionQuery.matches) return;

    const selectors = [
      ".trust-strip",
      ".problem-section .section-heading",
      ".problem-copy > *",
      ".feature-story",
      ".steps-path",
      ".steps-path li",
      ".guided-grid > *",
      ".founder-section > *",
      ".pricing-card",
      ".faq-list details",
      ".roadmap-home > *",
      ".roadmap-preview-card",
      ".final-cta > *",
      ".support-hero > *",
      ".support-form-card",
      ".support-info-card",
      ".roadmap-hero > *",
      ".roadmap-filter-panel",
      ".roadmap-summary-card",
      ".roadmap-status-group",
      ".roadmap-feedback-card",
      ".article-hero > *",
      ".article-content > *",
      ".legal-content > *"
    ];

    const elements = uniqueElements(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))));
    if (!elements.length) return;

    if ("IntersectionObserver" in window) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        });
      }, {
        rootMargin: "0px 0px -12% 0px",
        threshold: 0.12
      });
    }

    prepareRevealItems(elements);
    document.body.classList.add("is-reveal-ready");
  }

  function prepareRevealItems(elements) {
    if (motionQuery.matches) return;

    uniqueElements(Array.from(elements)).forEach((element, index) => {
      if (element.classList.contains("reveal-item")) return;

      element.classList.add("reveal-item");
      element.style.setProperty("--reveal-delay", `${Math.min((index % 5) * 70, 280)}ms`);

      if (revealObserver) {
        revealObserver.observe(element);
        return;
      }

      element.classList.add("is-visible");
    });
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements)).filter((element) => element instanceof HTMLElement);
  }

  function initButtonMotion() {
    if (motionQuery.matches) return;

    document.addEventListener("pointerdown", (event) => {
      const target = event.target.closest(".primary-button, .secondary-button, .nav-pill, .mobile-download-bar, .menu-toggle");
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "button-ripple";
      ripple.style.setProperty("--ripple-x", `${event.clientX - rect.left}px`);
      ripple.style.setProperty("--ripple-y", `${event.clientY - rect.top}px`);
      target.append(ripple);

      window.setTimeout(() => {
        ripple.remove();
      }, 720);
    });
  }

  async function initRoadmapPreview() {
    const mount = document.getElementById("homepageRoadmapPreview");
    if (!mount) return;

    try {
      const items = await loadRoadmapItems();
      renderRoadmapPreview(mount, items);
    } catch (error) {
      mount.innerHTML = `<div class="empty-state">Roadmap preview is temporarily unavailable.</div>`;
    }
  }

  async function loadRoadmapItems() {
    const config = window.BEADLIGHT_SUPABASE || {};

    if (config.url && config.anonKey && !config.url.includes("PASTE_YOUR")) {
      const endpoint = `${config.url.replace(/\/$/, "")}/rest/v1/roadmap_items?is_public=eq.true&select=id,title,summary,status,tag,priority,created_at&order=created_at.desc`;
      const response = await fetch(endpoint, {
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`
        }
      });

      if (response.ok) {
        return normalizeRoadmapItems(await response.json());
      }
    }

    const fallback = await fetch(`${root}/data/roadmap.json`, { cache: "no-store" });
    if (!fallback.ok) throw new Error("Static roadmap file was not found.");

    const payload = await fallback.json();
    return normalizeRoadmapItems(payload.items || []);
  }

  function normalizeRoadmapItems(items) {
    const aliases = {
      "wont-do": "not-planned"
    };

    return items.map((item) => ({
      ...item,
      status: aliases[item.status] || item.status || "under-consideration"
    }));
  }

  function renderRoadmapPreview(mount, items) {
    const statusOrder = {
      "in-progress": 1,
      planned: 2,
      "under-consideration": 3,
      released: 4,
      "not-planned": 5
    };

    const selected = [...items]
      .filter((item) => item.status !== "not-planned")
      .sort((a, b) => (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99))
      .slice(0, 3);

    if (!selected.length) {
      mount.innerHTML = `<div class="empty-state">No public roadmap items are available yet.</div>`;
      return;
    }

    mount.innerHTML = selected.map((item) => `
      <article class="roadmap-preview-card">
        <span>${escapeHtml(statusLabel(item.status))}</span>
        <h3>${escapeHtml(item.title || "Roadmap item")}</h3>
        <p>${escapeHtml(item.summary || "")}</p>
      </article>
    `).join("");

    prepareRevealItems(mount.querySelectorAll(".roadmap-preview-card"));
  }

  function statusLabel(value) {
    const labels = {
      "in-progress": "In progress",
      planned: "Planned",
      "under-consideration": "Under consideration",
      released: "Released",
      "not-planned": "Not planned"
    };

    return labels[value] || value || "Roadmap";
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

  ready(() => {
    initAnalyticsDelegation();
    initMenu();
    initDailyMystery();
    initFaqTracking();
    initScrollAnimations();
    initButtonMotion();
    initRoadmapPreview();
  });
}());
