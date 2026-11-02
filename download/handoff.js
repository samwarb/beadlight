(function () {
  "use strict";

  var card = document.getElementById("downloadCard");
  var title = document.getElementById("downloadTitle");
  var message = document.getElementById("downloadMessage");
  var note = document.getElementById("loadingNote");
  if (!card || !title || !message || !note) return;

  var offerCode = (card.getAttribute("data-offer-code") || "").trim();
  var landingPage = window.location.pathname || "/download/";
  var appleStore = offerCode === "ROSARY90"
    ? "https://apps.apple.com/redeem?ctx=offercodes&id=6773049841&code=ROSARY90"
    : "https://apps.apple.com/gb/app/beadlight-catholic-rosary/id6773049841";
  var googlePlay = "https://play.google.com/store/apps/details?id=com.merciandigital.beadlight";
  var userAgent = navigator.userAgent || navigator.vendor || "";
  var isAndroid = /Android/i.test(userAgent);
  var isIOS = /iPad|iPhone|iPod/.test(userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isSpanish = /^es(?:-|$)/i.test(document.documentElement.lang || "");
  var isCampaignLanding = card.hasAttribute("data-campaign-landing");
  var context = window.beadlightCampaignContext || {};

  function bounded(value) {
    return String(value || "").trim().replace(/[^A-Za-z0-9._~%+\- ]/g, "").slice(0, 80);
  }

  function addAppleCampaign(url) {
    var campaignLinks = window.beadlightAppStoreCampaignLinks || {};
    var campaignLink = campaignLinks[bounded(context.partner_id)];
    if (typeof campaignLink === "string") {
      try {
        var parsedCampaignLink = new URL(campaignLink);
        if (parsedCampaignLink.protocol === "https:" && parsedCampaignLink.hostname === "apps.apple.com") {
          return parsedCampaignLink.toString();
        }
      } catch (error) {
        // Fall back to the verified product page if the campaign link is invalid.
      }
    }
    return url;
  }

  function addGoogleReferrer(url) {
    var result = new URL(url);
    var referrer = new URLSearchParams();
    referrer.set("utm_source", bounded(context.utm_source || "beadlight"));
    if (context.utm_medium) referrer.set("utm_medium", bounded(context.utm_medium));
    if (context.campaign_id) referrer.set("utm_campaign", bounded(context.campaign_id));
    if (context.utm_content) referrer.set("utm_content", bounded(context.utm_content));
    if (context.partner_id) referrer.set("partner_id", bounded(context.partner_id));
    if (offerCode) referrer.set("offer_code", offerCode);
    result.searchParams.set("referrer", referrer.toString());
    return result.toString();
  }

  var appleDestination = addAppleCampaign(appleStore);
  var googleDestination = addGoogleReferrer(googlePlay);

  document.querySelectorAll('.store-links a[href*="apps.apple.com"]').forEach(function (link) {
    link.href = appleDestination;
    link.addEventListener("click", function (event) {
      trackStoreLink("apple", link, event);
    });
  });
  document.querySelectorAll('.store-links a[href*="play.google.com"]').forEach(function (link) {
    link.href = googleDestination;
    link.addEventListener("click", function (event) {
      trackStoreLink("google_play", link, event);
    });
  });

  function eventProperties(destination, handoffType) {
    return {
      store_destination: destination,
      landing_page: landingPage,
      handoff_type: handoffType,
      offer_code: offerCode || null
    };
  }

  function trackStoreLink(destination, link, event) {
    var shouldWaitForAnalytics = window.beadlightAnalyticsAllowed !== false;
    var didNavigate = false;
    var fallbackTimer = null;

    function continueToStore() {
      if (didNavigate) return;
      didNavigate = true;
      if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      window.location.assign(link.href);
    }

    if (shouldWaitForAnalytics) {
      event.preventDefault();
      fallbackTimer = window.setTimeout(continueToStore, 900);
    }

    try {
      if (typeof window.beadlightTrackStoreLink === "function") {
        window.beadlightTrackStoreLink(
          eventProperties(destination, "manual"),
          shouldWaitForAnalytics ? continueToStore : undefined
        );
      }
    } catch (error) {
      // Store navigation must not depend on analytics.
    }

    if (shouldWaitForAnalytics && typeof window.beadlightTrackStoreLink !== "function") {
      continueToStore();
    }
  }

  if (isCampaignLanding) {
    try {
      if (typeof window.beadlightTrackCampaignLanding === "function") {
        window.beadlightTrackCampaignLanding({ landing_page: landingPage });
      }
    } catch (error) {
      // The landing page must remain usable when analytics is blocked or unavailable.
    }
    note.textContent = isSpanish
      ? "Elige una tienda para descargar Beadlight."
      : "Choose your app store to download Beadlight.";
    return;
  }

  var destination = isAndroid ? googleDestination : (isIOS ? appleDestination : null);
  if (!destination) {
    note.textContent = isSpanish
      ? "¿No estás en un móvil? Elige una tienda arriba o abre este enlace en tu teléfono."
      : "Not on a mobile device? Choose a store above, or open this link on your phone.";
    return;
  }

  var destinationName = isAndroid ? "google_play" : "apple";
  title.textContent = isSpanish ? "Abriendo Beadlight…" : "Opening Beadlight…";
  message.textContent = isSpanish
    ? (isAndroid ? "Te llevamos a Google Play." : "Te llevamos al App Store.")
    : (isAndroid ? "Taking you to Google Play." : "Taking you to the App Store.");
  note.textContent = isSpanish
    ? "Si la tienda no se abre, usa uno de los botones de arriba."
    : "If the store does not open, use the buttons above.";

  try {
    if (typeof window.beadlightTrackStoreHandoff === "function") {
      window.beadlightTrackStoreHandoff(eventProperties(destinationName, "automatic"));
    }
  } catch (error) {
    // Store navigation must not depend on analytics.
  }

  window.setTimeout(function () {
    window.location.replace(destination);
  }, 140);
}());
