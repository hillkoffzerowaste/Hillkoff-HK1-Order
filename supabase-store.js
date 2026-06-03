import { createClient } from "@supabase/supabase-js";

const TABLES = {
  store: "hk_app_store",
  orders: "hk_orders",
  products: "hk_products",
  issues: "hk_issues",
};

export function createCloudStore(env = import.meta.env) {
  const config = {
    url: env.VITE_SUPABASE_URL || "",
    key: env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    pollMs: Number(env.VITE_SUPABASE_POLL_MS || 15000),
  };
  const enabled = Boolean(config.url && config.key);
  const client = enabled
    ? createClient(config.url, config.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
  let pollTimer = null;

  async function load() {
    if (!enabled) return null;
    const { data, error } = await client
      .from(TABLES.store)
      .select("payload, updated_at")
      .eq("id", "main")
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return withUpdatedAt(data.payload, data.updated_at);
  }

  async function save(store) {
    if (!enabled) return false;
    const normalized = withUpdatedAt(store, store?.updatedAt || Date.now());
    const { error } = await client.from(TABLES.store).upsert(
      {
        id: "main",
        payload: normalized,
        updated_at: normalized.updatedAt,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) throw error;
    await syncReportTables(normalized);
    return true;
  }

  async function appendOrder(order, products = []) {
    if (!enabled) return null;
    const store = await loadStoreForAppend();
    const ordersById = new Map((store.orders || []).map((item) => [item.id, item]));
    ordersById.set(order.id, { ...(ordersById.get(order.id) || {}), ...order });
    store.orders = [...ordersById.values()].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    store.products = mergeProducts(store.products, products);
    store.updatedAt = Date.now();
    await save(store);
    return store;
  }

  async function appendIssue(issue) {
    if (!enabled) return null;
    const store = await loadStoreForAppend();
    const issuesById = new Map((store.issues || []).map((item) => [item.id, item]));
    issuesById.set(issue.id, { ...(issuesById.get(issue.id) || {}), ...issue });
    store.issues = [...issuesById.values()].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    store.updatedAt = Date.now();
    await save(store);
    return store;
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

  async function loadStoreForAppend() {
    const store = (await load()) || {};
    return {
      products: Array.isArray(store.products) ? store.products : [],
      orders: Array.isArray(store.orders) ? store.orders : [],
      issues: Array.isArray(store.issues) ? store.issues : [],
      updatedAt: Number(store.updatedAt || 0),
    };
  }

  async function syncReportTables(store) {
    await Promise.all([
      upsertRows(TABLES.products, (store.products || []).filter((item) => item?.name).map(productRow(store.updatedAt))),
      upsertRows(TABLES.orders, (store.orders || []).filter((item) => item?.id).map(orderRow(store.updatedAt))),
      upsertRows(TABLES.issues, (store.issues || []).filter((item) => item?.id).map(issueRow(store.updatedAt))),
    ]);
  }

  async function upsertRows(table, rows) {
    if (!rows.length) return;
    const { error } = await client.from(table).upsert(rows);
    if (error) throw error;
  }

  return { enabled, config, load, save, appendOrder, appendIssue, startPolling, stopPolling };
}

function withUpdatedAt(store = {}, updatedAt = 0) {
  return { ...(store || {}), updatedAt: Number(updatedAt || store?.updatedAt || 0) };
}

function mergeProducts(remoteProducts = [], localProducts = []) {
  const productsByName = new Map(remoteProducts.map((product) => [normalizeProductName(product.name), product]));
  localProducts.forEach((product) => {
    const key = normalizeProductName(product.name);
    if (key) productsByName.set(key, { ...(productsByName.get(key) || {}), ...product });
  });
  return [...productsByName.values()];
}

function normalizeProductName(name = "") {
  return String(name).trim().toLocaleLowerCase("th-TH");
}

function productRow(updatedAt) {
  return (product) => ({
    name: product.name,
    size: Number(product.size || 500),
    payload: product,
    updated_at: Number(updatedAt || Date.now()),
    synced_at: new Date().toISOString(),
  });
}

function orderRow(updatedAt) {
  return (order) => ({
    id: order.id,
    queue: order.queue || null,
    status: order.status || null,
    created_at: Number(order.createdAt || 0),
    done_at: order.doneAt ? Number(order.doneAt) : null,
    canceled_at: order.canceledAt ? Number(order.canceledAt) : null,
    name: order.name || null,
    size: order.size ? Number(order.size) : null,
    qty: order.qty ? Number(order.qty) : null,
    grind: order.grind || null,
    customer: order.customer || null,
    payload: order,
    updated_at: Number(updatedAt || Date.now()),
    synced_at: new Date().toISOString(),
  });
}

function issueRow(updatedAt) {
  return (issue) => ({
    id: issue.id,
    created_at: Number(issue.createdAt || 0),
    message: issue.message || null,
    payload: issue,
    updated_at: Number(updatedAt || Date.now()),
    synced_at: new Date().toISOString(),
  });
}
