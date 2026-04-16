(function () {
  const TRAY_WEBHOOK_URL = "REPLACE_WITH_TRAY_WEBHOOK_URL";
  const SDK_URL = "https://sdk.staging.instaswitch.co/latest/instaswitch-sdk.umd.js";

  async function getContactIdFromJourney() {
    const segments = new URL(window.location.href).pathname.split("/");
    const slug = segments[2];
    if (!slug) throw new Error("[IS] no journey slug in URL");

    const res = await fetch(
      "https://api.digitalonboarding.com/v1/journeys/slug/" + encodeURIComponent(slug)
    );
    if (!res.ok) throw new Error("[IS] journey lookup failed: " + res.status);
    const data = await res.json();
    if (!data.contact || !data.contact.id) {
      throw new Error("[IS] no contact.id on journey response");
    }
    return data.contact.id;
  }

  async function trayLogin(contactId) {
    const res = await fetch(TRAY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", contact_id: contactId }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error("[IS] Tray login failed: " + res.status + " " + err);
    }
    return res.json();
  }

  async function trayRefresh(refreshToken) {
    const res = await fetch(TRAY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh", refresh_token: refreshToken }),
    });
    if (!res.ok) throw new Error("[IS] Tray refresh failed: " + res.status);
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
    try {
      const contactId = options.contactId || (await getContactIdFromJourney());

      const [session] = await Promise.all([trayLogin(contactId), loadSDK()]);
      let currentRefreshToken = session.refresh_token;

      const sdk = new window.InstaSwitchSDK({
        apiKey: session.api_key,
        onAuth: async () => {
          const refreshed = await trayRefresh(currentRefreshToken);
          currentRefreshToken = refreshed.refresh_token;
          return { jwt: refreshed.jwt, refreshToken: refreshed.refresh_token };
        },
        onReady: () => options.onReady && options.onReady(),
        onExit: () => options.onExit && options.onExit(),
        onError: (error) => options.onError && options.onError(error),
        requestedStart: options.requestedStart,
      });

      return sdk;
    } catch (err) {
      console.error("[IS] launchInstaSwitch failed:", err);
      if (options.onError) options.onError(err);
    }
  };

  window.addEventListener("load", () => window.launchInstaSwitch());
})();
