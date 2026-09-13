const DRIVE_FILE_NAME = "CalTrak.json";
const DRIVE_FILE_ID_KEY = "calorie-tracker-drive-file-id";
const CLIENT_ID_KEY = "calorie-tracker-google-client-id";
const DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive.file openid email profile";

function getClientId() {
  const fromConfig = String(window.CALTRAK_GOOGLE_CLIENT_ID || "").trim();
  if (fromConfig) return fromConfig;
  return String(localStorage.getItem(CLIENT_ID_KEY) || "").trim();
}

function mergeDays(localDays, remoteDays) {
  const merged = {};
  const keys = new Set([...Object.keys(localDays), ...Object.keys(remoteDays)]);
  for (const key of keys) {
    const byId = new Map();
    for (const entry of [...(localDays[key] ?? []), ...(remoteDays[key] ?? [])]) {
      if (entry?.id) byId.set(entry.id, entry);
    }
    const entries = [...byId.values()].sort(
      (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)
    );
    if (entries.length) merged[key] = entries;
  }
  return merged;
}

window.CalTrakDrive = {
  token: null,
  tokenClient: null,
  email: null,
  saveTimer: null,
  onStatus: () => {},
  onSignedIn: async () => {},

  clientId() {
    return getClientId();
  },

  saveClientId(id) {
    localStorage.setItem(CLIENT_ID_KEY, id.trim());
  },

  ready() {
    return Boolean(window.google?.accounts?.oauth2) && Boolean(this.clientId());
  },

  init() {
    if (!this.ready()) return;
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.clientId(),
      scope: DRIVE_SCOPE,
      callback: async (response) => {
        if (response.error) {
          this.onStatus("Google sign-in failed.");
          return;
        }
        this.token = response.access_token;
        try {
          this.email = await this.fetchEmail();
          this.onStatus(`Signed in as ${this.email}`);
        } catch (error) {
          this.email = null;
          this.onStatus("Signed in with Google.");
        }
        try {
          await this.onSignedIn();
        } catch (error) {
          this.onStatus(error.message || "Drive sync failed.");
        }
      },
    });
  },

  signIn() {
    if (!this.clientId()) {
      this.onStatus("Add a Google client ID first.");
      return;
    }
    if (!window.google?.accounts?.oauth2) {
      this.onStatus("Google sign-in is still loading. Try again.");
      return;
    }
    if (!this.tokenClient) this.init();
    this.tokenClient.requestAccessToken({ prompt: this.token ? "" : "consent" });
  },

  signOut() {
    if (this.token) {
      google.accounts.oauth2.revoke(this.token, () => {});
    }
    this.token = null;
    this.email = null;
    this.onStatus("Signed out. Data stays on this device.");
  },

  async fetchEmail() {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) return "Google user";
    const data = await response.json();
    return data.email || "Google user";
  },

  async api(url, options = {}, retry = true) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(options.headers || {}),
      },
    });
    if (response.status === 401 && retry) {
      await new Promise((resolve) => {
        const previous = this.tokenClient.callback;
        this.tokenClient.callback = (tokenResponse) => {
          this.tokenClient.callback = previous;
          if (tokenResponse.access_token) this.token = tokenResponse.access_token;
          resolve();
        };
        this.tokenClient.requestAccessToken({ prompt: "" });
      });
      return this.api(url, options, false);
    }
    return response;
  },

  async findFileId() {
    const stored = localStorage.getItem(DRIVE_FILE_ID_KEY);
    if (stored) return stored;
    const query = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
    const response = await this.api(
      `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name)&pageSize=1`
    );
    if (!response.ok) throw new Error("Could not search Google Drive.");
    const data = await response.json();
    const id = data.files?.[0]?.id;
    if (id) localStorage.setItem(DRIVE_FILE_ID_KEY, id);
    return id || null;
  },

  async readDays() {
    const id = await this.findFileId();
    if (!id) return {};
    const response = await this.api(
      `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
    );
    if (response.status === 404) {
      localStorage.removeItem(DRIVE_FILE_ID_KEY);
      return {};
    }
    if (!response.ok) throw new Error("Could not download Drive backup.");
    const data = await response.json();
    return data.days && typeof data.days === "object" ? data.days : {};
  },

  async writeDays(days) {
    const body = JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      days,
    });
    const id = await this.findFileId();
    if (id) {
      const response = await this.api(
        `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body,
        }
      );
      if (!response.ok) throw new Error("Could not update Drive backup.");
      return;
    }

    const metadata = {
      name: DRIVE_FILE_NAME,
      mimeType: "application/json",
    };
    const form = new FormData();
    form.append(
      "metadata",
      new Blob([JSON.stringify(metadata)], { type: "application/json" })
    );
    form.append("file", new Blob([body], { type: "application/json" }));
    const response = await this.api(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      { method: "POST", body: form }
    );
    if (!response.ok) throw new Error("Could not create Drive backup.");
    const created = await response.json();
    if (created.id) localStorage.setItem(DRIVE_FILE_ID_KEY, created.id);
  },

  async pullAndMerge(localDays) {
    if (!this.token) return localDays;
    this.onStatus("Syncing with Google Drive…");
    const remoteDays = await this.readDays();
    const merged = mergeDays(localDays, remoteDays);
    await this.writeDays(merged);
    this.onStatus(`Saved to Drive as ${DRIVE_FILE_NAME}`);
    return merged;
  },

  scheduleSave(days) {
    if (!this.token) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        await this.writeDays(days);
        this.onStatus(`Saved to Drive as ${DRIVE_FILE_NAME}`);
      } catch (error) {
        this.onStatus(error.message || "Drive save failed.");
      }
    }, 600);
  },
};
