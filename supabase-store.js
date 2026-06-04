import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://jerggqygfojqqenazqqt.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_DxnczUIpmEWlvN_pQCcnuA_plV6IjOw";

const TABLES = {
  store: "hk_app_store",
  orders: "hk_orders",
  products: "hk_products",
  issues: "hk_issues",
};

export function createCloudStore(env = import.meta.env) {
  const config = {
    url: env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL,
    key: env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_KEY,
  };
  const enabled = Boolean(config.url && config.key);
  const client = enabled
    ? createClient(config.url, config.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
  let channel = null;

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

  async function save(store, { syncRows = true } = {}) {
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
    if (syncRows) await syncReportTables(normalized);
    return true;
  }

  async function appendOrder(order, products = [], store = null) {
    if (!enabled) return null;
    const updatedAt = Number(store?.updatedAt || Date.now());
    await Promise.all([
      upsertRows(TABLES.orders, [orderRow(updatedAt)(order)]),
      upsertRows(TABLES.products, (products || []).filter((item) => item?.name).map(productRow(updatedAt))),
      store ? save(withUpdatedAt(store, updatedAt), { syncRows: false }) : Promise.resolve(false),
    ]);
    return store ? withUpdatedAt(store, updatedAt) : null;
  }

  async function appendIssue(issue, store = null) {
    if (!enabled) return null;
    const updatedAt = Number(store?.updatedAt || Date.now());
    await Promise.all([
      upsertRows(TABLES.issues, [issueRow(updatedAt)(issue)]),
      store ? save(withUpdatedAt(store, updatedAt), { syncRows: false }) : Promise.resolve(false),
    ]);
    return store ? withUpdatedAt(store, updatedAt) : null;
  }

  async function upsertOrder(order, store = null) {
    if (!enabled) return null;
    const updatedAt = Number(store?.updatedAt || Date.now());
    await Promise.all([
      upsertRows(TABLES.orders, [orderRow(updatedAt)(order)]),
      store ? save(withUpdatedAt(store, updatedAt), { syncRows: false }) : Promise.resolve(false),
    ]);
    return store ? withUpdatedAt(store, updatedAt) : null;
  }

  function startRealtime({ onStoreChange, onOrderChange, onIssueChange, onError, onStatus } = {}) {
    if (!enabled || channel) return () => {};
    channel = client
      .channel("hk-app-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLES.orders }, (payload) => {
        const order = payload.new?.payload;
        if (order) onOrderChange?.(order, { eventType: payload.eventType });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: TABLES.issues }, (payload) => {
        const issue = payload.new?.payload;
        if (issue) onIssueChange?.(issue, { eventType: payload.eventType });
      })
      .subscribe((status, error) => {
        onStatus?.(status);
        if (error) onError?.(error);
        if (status === "CHANNEL_ERROR") onError?.(new Error("Supabase realtime channel error"));
      });
    return stopRealtime;
  }

  function stopRealtime() {
    if (channel) client.removeChannel(channel);
    channel = null;
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

  return { enabled, config, load, save, appendOrder, appendIssue, upsertOrder, startRealtime, stopRealtime };
}

function withUpdatedAt(store = {}, updatedAt = 0) {
  return { ...(store || {}), updatedAt: Number(updatedAt || store?.updatedAt || 0) };
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
