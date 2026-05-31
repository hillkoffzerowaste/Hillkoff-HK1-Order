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

  async function save(store) {
    if (!enabled) return false;
    const response = await fetch(config.webAppUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "saveStore", store }),
    });
    if (!response.ok) throw new Error(`Sheets save failed: ${response.status}`);
    const result = await response.json();
    if (result.status !== "ok") throw new Error(result.message || "Sheets save failed");
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
