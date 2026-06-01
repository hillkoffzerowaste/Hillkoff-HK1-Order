export function createCloudStore(env = import.meta.env) {
  const config = {
    webAppUrl: env.VITE_SHEETS_WEB_APP_URL || "",
    pollMs: Number(env.VITE_SHEETS_POLL_MS || 15000),
  };
  const enabled = Boolean(config.webAppUrl);
  let pollTimer = null;

  async function load() {
    if (!enabled) return null;
    const url = new URL(config.webAppUrl);
    url.searchParams.set("action", "loadStore");
    const response = await fetch(url.toString(), { method: "GET" });
    if (!response.ok) throw new Error(`Sheets load failed: ${response.status}`);
    const result = await response.json();
    return result.store || null;
  }

  async function loadSettings() {
    if (!enabled) return {};
    const url = new URL(config.webAppUrl);
    url.searchParams.set("action", "loadSettings");
    const response = await fetch(url.toString(), { method: "GET" });
    if (!response.ok) throw new Error(`Sheets settings load failed: ${response.status}`);
    const result = await response.json();
    return result.settings || {};
  }

  async function save(store) {
    if (!enabled) return false;
    const response = await postJson({ action: "saveStore", store });
    if (!response.ok) throw new Error(`Sheets save failed: ${response.status}`);
    const result = await response.json();
    if (result.status !== "ok") throw new Error(result.message || "Sheets save failed");
    return true;
  }

  async function appendOrder(order, products = []) {
    if (!enabled) return null;
    const response = await postJson({ action: "appendOrder", order, products });
    if (!response.ok) throw new Error(`Sheets append failed: ${response.status}`);
    const result = await response.json();
    if (result.status !== "ok") throw new Error(result.message || "Sheets append failed");
    return result.store || null;
  }

  async function appendIssue(issue) {
    if (!enabled) return null;
    const response = await postJson({ action: "appendIssue", issue });
    if (!response.ok) throw new Error(`Sheets issue append failed: ${response.status}`);
    const result = await response.json();
    if (result.status !== "ok") throw new Error(result.message || "Sheets issue append failed");
    return result.store || null;
  }

  async function saveSettings(settings) {
    if (!enabled) return false;
    const response = await postJson({ action: "saveSettings", settings });
    if (!response.ok) throw new Error(`Sheets settings save failed: ${response.status}`);
    const result = await response.json();
    if (result.status !== "ok") throw new Error(result.message || "Sheets settings save failed");
    return true;
  }

  function postJson(payload) {
    return fetch(config.webAppUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
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

  return { enabled, config, load, save, appendOrder, appendIssue, loadSettings, saveSettings, startPolling, stopPolling };
}
