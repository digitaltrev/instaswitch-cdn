(function () {
  const BUILD = "2026-06-16-a";
  console.log("[IS] instaswitch-embed.js loaded, build:", BUILD);
  console.log("[IS] document.readyState:", document.readyState);
  console.log("[IS] location:", location.href);

  const SDK_URL =
    "https://sdk.staging.instaswitch.co/latest/instaswitch-sdk.umd.js";
  const API_URL =
    "https://api.staging.instaswitch.co/api/v1/partner/auth/sessions";
  const API_KEY =
    "ak_jDO18a1n2Rexu1tTK0WaGqhM:twn4aS37yHvkD2kJ7dgTNtzPWsDij9/+GVOCdEpwwEM=";
  const API_SECRET = "kHZohtwo6GUq9a4RdTxXD+LM0sQKvYdv9OOFipU8+r8=";

  // --- Backdrop overlay: dims the page while the widget is open so it pops ---
  const BACKDROP_ID = "instaswitch-backdrop";
  // Very high, but intended to sit just *below* the SDK's own modal/iframe
  // (Atomic-style widgets render near max int). If the backdrop ends up
  // covering the widget, lower this; if the page isn't dimmed, raise it.
  const BACKDROP_Z = 2147483000;

  function showBackdrop() {
    let el = document.getElementById(BACKDROP_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = BACKDROP_ID;
      el.style.cssText = [
        "position:fixed",
        "inset:0",
        "background:rgba(0,0,0,0.6)",
        "z-index:" + BACKDROP_Z,
        "opacity:0",
        "transition:opacity 200ms ease",
      ].join(";");
      document.body.appendChild(el);
    }
    void el.offsetWidth; // force reflow so the opacity transition runs
    el.style.opacity = "1";
    document.body.style.overflow = "hidden";
    console.log("[IS] backdrop shown");
  }

  function hideBackdrop() {
    document.body.style.overflow = "";
    const el = document.getElementById(BACKDROP_ID);
    if (!el) return;
    el.style.opacity = "0";
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 250);
    console.log("[IS] backdrop hidden");
  }

  async function hmacSign(method, path, body, timestamp) {
    console.log("[IS] hmacSign called", { method, path, timestamp });
    console.log("[IS] canonical string:", `${method}\\n${path}\\n${body}\\n${timestamp}`);
    const encoder = new TextEncoder();
    const canonical = `${method}\n${path}\n${body}\n${timestamp}`;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(API_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(canonical));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    console.log("[IS] signature generated:", hex);
    return hex;
  }

  async function createSession(externalUserId, email) {
    console.log("[IS] createSession called", { externalUserId, email });
    const path = "/api/v1/partner/auth/sessions";
    const body = JSON.stringify({
      session: { external_user_id: externalUserId, email: email },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await hmacSign("POST", path, body, timestamp);

    console.log("[IS] fetching session from", API_URL);
    console.log("[IS] request headers:", {
      "X-API-Key": API_KEY,
      "X-Signature": signature,
      "X-Timestamp": timestamp,
    });
    console.log("[IS] request body:", body);

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-Key": API_KEY,
        "X-Signature": signature,
        "X-Timestamp": timestamp,
      },
      body: body,
    });

    console.log("[IS] session response status:", res.status);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[IS] session creation failed:", err);
      throw new Error(err.error || `Auth failed: ${res.status}`);
    }

    const data = await res.json();
    console.log("[IS] session created successfully:", {
      hasJwt: !!data.jwt,
      hasRefreshToken: !!data.refresh_token,
      expiresAt: data.expires_at,
      userId: data.user?.id,
    });
    return data;
  }

  async function resetUser(externalUserId) {
    console.log("[IS] resetUser called", { externalUserId });
    const path =
      "/api/v1/partner/users/" + encodeURIComponent(externalUserId) + "/reset";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await hmacSign("POST", path, "", timestamp);

    const res = await fetch("https://api.staging.instaswitch.co" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-Key": API_KEY,
        "X-Signature": signature,
        "X-Timestamp": timestamp,
      },
    });

    console.log("[IS] reset response status:", res.status);
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn("[IS] reset failed (continuing to launch anyway):", errBody);
    }
    return res.ok;
  }

  async function refreshSession(refreshToken) {
    console.log("[IS] refreshSession called");
    const path = "/api/v1/partner/auth/refresh";
    const body = JSON.stringify({ refresh_token: refreshToken });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await hmacSign("POST", path, body, timestamp);

    const res = await fetch(
      "https://api.staging.instaswitch.co/api/v1/partner/auth/refresh",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-API-Key": API_KEY,
          "X-Signature": signature,
          "X-Timestamp": timestamp,
        },
        body: body,
      }
    );

    console.log("[IS] refresh response status:", res.status);

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("[IS] refresh failed:", errBody);
      throw new Error("Refresh failed: " + res.status);
    }

    const data = await res.json();
    console.log("[IS] refresh successful, new tokens received");
    return data;
  }

  function loadSDK() {
    return new Promise((resolve, reject) => {
      if (window.InstaSwitchSDK) {
        console.log("[IS] SDK already loaded, skipping");
        return resolve();
      }
      console.log("[IS] loading SDK from", SDK_URL);
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.onload = () => {
        console.log("[IS] SDK script loaded successfully");
        console.log("[IS] window.InstaSwitchSDK exists:", !!window.InstaSwitchSDK);
        console.log("[IS] typeof InstaSwitchSDK:", typeof window.InstaSwitchSDK);
        resolve();
      };
      script.onerror = (e) => {
        console.error("[IS] SDK script failed to load:", e);
        reject(new Error("Failed to load InstaSwitch SDK"));
      };
      document.head.appendChild(script);
    });
  }

  window.launchInstaSwitch = async function (options = {}) {
    console.log("[IS] launchInstaSwitch called with options:", {
      userId: options.userId,
      email: options.email,
      requestedStart: options.requestedStart,
    });

    const userId = options.userId || "default_user";
    const email = options.email || "user@example.com";

    try {
      showBackdrop();
      if (options.reset) {
        console.log("[IS] reset requested - resetting user before launch");
        await resetUser(userId);
      }
      console.log("[IS] starting parallel: createSession + loadSDK");
      const [session] = await Promise.all([
        createSession(userId, email),
        loadSDK(),
      ]);
      console.log("[IS] both session and SDK ready");

      let currentRefreshToken = session.refresh_token;

      console.log("[IS] creating InstaSwitchSDK instance...");
      // Sizing: the SDK caps width at the "large" preset (~900px, clamped to
      // 90vw) — there is no true custom width. Height (customHeight) accepts
      // px only, so compute ~85% of the viewport in px (SDK clamps to 100vh).
      const customWidth = options.customWidth || "large";
      const customHeight =
        options.customHeight ||
        Math.round((window.innerHeight || 800) * 0.85) + "px";
      const sdkConfig = {
        apiKey: API_KEY,
        customWidth: customWidth,
        customHeight: customHeight,
        onAuth: async () => {
          console.log("[IS] onAuth callback fired");
          const refreshed = await refreshSession(currentRefreshToken);
          currentRefreshToken = refreshed.refresh_token;
          console.log("[IS] onAuth returning new tokens");
          return { jwt: refreshed.jwt, refreshToken: refreshed.refresh_token };
        },
        onReady: () => {
          console.log("[IS] onReady callback fired - widget should be visible");
          if (options.onReady) options.onReady();
        },
        onExit: () => {
          console.log("[IS] onExit callback fired - user closed widget");
          hideBackdrop();
          if (options.onExit) options.onExit();
        },
        onError: (error) => {
          console.error("[IS] onError callback fired:", error);
          console.error("[IS] error details:", JSON.stringify(error, null, 2));
          hideBackdrop();
          if (options.onError) options.onError(error);
        },
        requestedStart: options.requestedStart,
      };
      console.log("[IS] SDK config (without callbacks):", {
        apiKey: sdkConfig.apiKey,
        customWidth: sdkConfig.customWidth,
        customHeight: sdkConfig.customHeight,
        requestedStart: sdkConfig.requestedStart,
      });

      const sdk = new window.InstaSwitchSDK(sdkConfig);
      console.log("[IS] InstaSwitchSDK instance created:", sdk);
      console.log("[IS] SDK instance type:", typeof sdk);
      console.log("[IS] SDK instance keys:", Object.keys(sdk || {}));

      return sdk;
    } catch (err) {
      console.error("[IS] launchInstaSwitch FAILED:", err);
      console.error("[IS] error stack:", err.stack);
      hideBackdrop();
      if (options.onError) options.onError(err);
    }
  };

  console.log("[IS] window.launchInstaSwitch is now available");

  function scanTriggers(label) {
    const triggers = document.querySelectorAll("[data-instaswitch-trigger]");
    console.log("[IS][" + label + "] trigger element count:", triggers.length);
    triggers.forEach((el, i) => {
      console.log("[IS][" + label + "] trigger #" + i + ":", {
        tag: el.tagName,
        id: el.id,
        userid: el.dataset.userid,
        email: el.dataset.email,
      });
    });
    return triggers.length;
  }

  document.addEventListener(
    "click",
    function (e) {
      console.log("[IS] document click seen on:", e.target);
      const el =
        e.target && e.target.closest
          ? e.target.closest("[data-instaswitch-trigger]")
          : null;
      if (!el) {
        console.log("[IS] click was not on a trigger element");
        return;
      }
      console.log("[IS] trigger element matched:", el);
      console.log("[IS] trigger dataset:", {
        userid: el.dataset.userid,
        email: el.dataset.email,
      });
      e.preventDefault();
      try {
        window.launchInstaSwitch({
          userId: el.dataset.userid || "demo_" + Date.now(),
          email: el.dataset.email || "user@example.com",
          reset: el.dataset.noReset === undefined,
          onReady: () => console.log("[IS] CLICK: ready"),
          onExit: () => console.log("[IS] CLICK: user exited"),
          onError: (err) => console.error("[IS] CLICK: error", err),
        });
      } catch (err) {
        console.error("[IS] launchInstaSwitch threw:", err);
      }
    },
    true
  );
  console.log("[IS] document-level click delegator installed (capture phase)");

  scanTriggers("initial");
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      console.log("[IS] DOMContentLoaded fired");
      scanTriggers("DOMContentLoaded");
    });
  }
  window.addEventListener("load", function () {
    console.log("[IS] window load fired");
    scanTriggers("load");
  });
})();
