const FIRESTORE_BASE = "https://firestore.googleapis.com/v1";

export function createCloudStore(env = import.meta.env) {
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY || "",
    projectId: env.VITE_FIREBASE_PROJECT_ID || "",
    collection: env.VITE_FIREBASE_COLLECTION || "hk1Stores",
    documentId: env.VITE_FIREBASE_STORE_ID || "main",
    pollMs: Number(env.VITE_FIREBASE_POLL_MS || 15000),
  };
  const enabled = Boolean(config.apiKey && config.projectId);
  let pollTimer = null;

  function documentUrl() {
    const path = `${encodeURIComponent(config.collection)}/${encodeURIComponent(config.documentId)}`;
    return `${FIRESTORE_BASE}/projects/${encodeURIComponent(config.projectId)}/databases/(default)/documents/${path}?key=${encodeURIComponent(config.apiKey)}`;
  }

  async function load() {
    if (!enabled) return null;
    const response = await fetch(documentUrl());
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Firebase load failed: ${response.status}`);
    return parseDocument(await response.json());
  }

  async function save(store) {
    if (!enabled) return false;
    const payload = JSON.stringify(store);
    const response = await fetch(documentUrl(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          payload: { stringValue: payload },
          updatedAt: { integerValue: String(store.updatedAt || Date.now()) },
        },
      }),
    });
    if (!response.ok) throw new Error(`Firebase save failed: ${response.status}`);
    return true;
  }

  function startPolling(onRemoteStore, onError) {
    if (!enabled || pollTimer) return () => {};
    pollTimer = window.setInterval(async () => {
      try {
        const remoteStore = await load();
        if (remoteStore) onRemoteStore(remoteStore);
      } catch (error) {
        onError?.(error);
      }
    }, config.pollMs);
    return stopPolling;
  }

  function stopPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
  }

  return { enabled, config, load, save, startPolling, stopPolling };
}

function parseDocument(document) {
  const payload = document?.fields?.payload?.stringValue;
  if (!payload) return null;
  return JSON.parse(payload);
}
