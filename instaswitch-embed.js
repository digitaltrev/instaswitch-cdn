(function () {
  const SDK_URL =
    "https://sdk.staging.instaswitch.co/latest/instaswitch-sdk.umd.js";
  const API_URL =
    "https://api.staging.instaswitch.co/api/v1/partner/auth/sessions";
  const API_KEY =
    "ak_jDO18a1n2Rexu1tTK0WaGqhM:twn4aS37yHvkD2kJ7dgTNtzPWsDij9/+GVOCdEpwwEM=";
  const API_SECRET = "kHZohtwo6GUq9a4RdTxXD+LM0sQKvYdv9OOFipU8+r8=";

  async function hmacSign(method, path, body, timestamp) {
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
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function createSession(externalUserId, email) {
    const path = "/api/v1/partner/auth/sessions";
    const body = JSON.stringify({
      session: { external_user_id: externalUserId, email: email },
    });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await hmacSign("POST", path, body, timestamp);

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

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Auth failed: ${res.status}`);
    }
    return res.json();
  }

  async function refreshSession(refreshToken) {
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

    if (!res.ok) throw new Error("Refresh failed");
    return res.json();
  }

  function loadSDK() {
    return new Promise((resolve, reject) => {
      if (window.InstaSwitchSDK) return resolve();
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Failed to load InstaSwitch SDK"));
      document.head.appendChild(script);
    });
  }

  window.launchInstaSwitch = async function (options = {}) {
    const userId = options.userId || "default_user";
    const email = options.email || "user@example.com";

    try {
      const [session] = await Promise.all([
        createSession(userId, email),
        loadSDK(),
      ]);

      let currentRefreshToken = session.refresh_token;

      const sdk = new window.InstaSwitchSDK({
        apiKey: API_KEY,
        onAuth: async () => {
          const refreshed = await refreshSession(currentRefreshToken);
          currentRefreshToken = refreshed.refresh_token;
          return { jwt: refreshed.jwt, refreshToken: refreshed.refresh_token };
        },
        onReady: () => {
          console.log("InstaSwitch ready");
          if (options.onReady) options.onReady();
        },
        onExit: () => {
          console.log("InstaSwitch closed");
          if (options.onExit) options.onExit();
        },
        onError: (error) => {
          console.error("InstaSwitch error:", error);
          if (options.onError) options.onError(error);
        },
        requestedStart: options.requestedStart,
      });

      return sdk;
    } catch (err) {
      console.error("Failed to launch InstaSwitch:", err);
      if (options.onError) options.onError(err);
    }
  };
})();
