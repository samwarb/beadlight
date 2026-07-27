(function () {
  "use strict";
  const CONSENT_KEY = "beadlight_analytics_consent";
  const MEASUREMENT_ID = "G-MCC82930DS";

  function loadAnalytics() {
    if (window.gtag) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID);
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + MEASUREMENT_ID;
    document.head.appendChild(script);
  }

  function getConsent() {
    try { return window.localStorage.getItem(CONSENT_KEY); } catch (error) { return null; }
  }

  function init() {
    const consent = getConsent();
    if (consent === "reject") return;
    loadAnalytics();
    if (consent === "accept") return;
    const banner = document.createElement("aside");
    banner.id = "cookieConsentBanner";
    banner.setAttribute("aria-label", "Cookie preferences");
    const root = document.documentElement.dataset.siteRoot || ".";
    banner.innerHTML = `<div class="cookie-consent-copy"><strong>Privacy choices</strong><p>Beadlight uses Google Analytics to understand visits, traffic sources and store-link clicks. Analytics is active unless you reject it.</p><a href="${root}/privacy/">Read our privacy policy</a></div><div class="cookie-consent-actions"><button type="button" data-cookie-choice="reject">Reject analytics</button><button type="button" data-cookie-choice="accept">Keep analytics on</button></div>`;
    document.body.appendChild(banner);
    banner.addEventListener("click", function (event) {
      const button = event.target.closest("[data-cookie-choice]");
      if (!button) return;
      const choice = button.dataset.cookieChoice;
      try { window.localStorage.setItem(CONSENT_KEY, choice); } catch (error) {}
      banner.remove();
      if (choice === "reject" && window.gtag) window.gtag("consent", "update", { analytics_storage: "denied" });
      addSettingsButton();
    });
  }

  function addSettingsButton() {
    if (document.getElementById("cookieConsentSettings")) return;
    const button = document.createElement("button");
    button.id = "cookieConsentSettings";
    button.type = "button";
    button.textContent = "Privacy settings";
    button.addEventListener("click", function () {
      try { window.localStorage.removeItem(CONSENT_KEY); } catch (error) {}
      button.remove();
      init();
    });
    document.body.appendChild(button);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { init(); if (getConsent()) addSettingsButton(); });
  else { init(); if (getConsent()) addSettingsButton(); }
})();
