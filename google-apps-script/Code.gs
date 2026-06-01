const STORE_SHEET = "Store";
const ORDERS_SHEET = "Orders";
const PRODUCTS_SHEET = "Products";
const ISSUES_SHEET = "Issues";
const SETTINGS_SHEET = "Settings";

function doGet(event) {
  const action = event.parameter.action || "loadStore";
  if (action === "loadStore") return jsonResponse({ status: "ok", store: loadStore() });
  if (action === "loadSettings") return jsonResponse({ status: "ok", settings: loadSettings() });
  return jsonResponse({ status: "error", message: "Unknown action" });
}

function doPost(event) {
  const payload = JSON.parse(event.postData.contents || "{}");
  if (payload.action === "saveStore") {
    saveStore(payload.store || {});
    return jsonResponse({ status: "ok", updatedAt: payload.store && payload.store.updatedAt });
  }
  if (payload.action === "appendOrder") {
    const store = appendOrder(payload.order || {}, payload.products || []);
    return jsonResponse({ status: "ok", store: store, updatedAt: store.updatedAt });
  }
  if (payload.action === "appendIssue") {
    const store = appendIssue(payload.issue || {});
    return jsonResponse({ status: "ok", store: store, updatedAt: store.updatedAt });
  }
  if (payload.action === "saveSettings") {
    saveSettings(payload.settings || {});
    return jsonResponse({ status: "ok", settings: loadSettings() });
  }
  return jsonResponse({ status: "error", message: "Unknown action" });
}

function loadStore() {
  const sheet = ensureSheet(STORE_SHEET, ["key", "payload", "updatedAt", "webAppUrl"]);
  const payload = sheet.getRange(2, 2).getValue();
  if (!payload) return null;
  return JSON.parse(payload);
}

function loadSettings() {
  const settings = {};
  const sheet = ensureSheet(SETTINGS_SHEET, ["key", "value"]);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 2).getValues().forEach((row) => {
      if (row[0]) settings[row[0]] = row[1];
    });
  }
  const storeSheet = ensureSheet(STORE_SHEET, ["key", "payload", "updatedAt", "webAppUrl"]);
  const storeWebAppUrl = storeSheet.getRange(2, 4).getValue();
  if (storeWebAppUrl && !settings.webAppUrl) settings.webAppUrl = storeWebAppUrl;
  return settings;
}

function saveSettings(settings) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const current = loadSettings();
    const next = Object.assign({}, current, settings || {});
    const sheet = ensureSheet(SETTINGS_SHEET, ["key", "value"]);
    clearBody(sheet);
    const rows = Object.keys(next)
      .filter((key) => next[key] !== undefined && next[key] !== null && next[key] !== "")
      .sort()
      .map((key) => [key, next[key]]);
    if (rows.length) sheet.getRange(2, 1, rows.length, 2).setValues(rows);
    writeStoreWebAppUrl(next.webAppUrl || "");
  } finally {
    lock.releaseLock();
  }
}

function saveStore(store) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    writeStore(store);
    writeOrders(store.orders || []);
    writeProducts(store.products || []);
    writeIssues(store.issues || []);
  } finally {
    lock.releaseLock();
  }
}

function appendOrder(order, products) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const store = loadStore() || { products: [], orders: [], issues: [], updatedAt: 0 };
    store.products = mergeProducts(store.products || [], products || []);
    store.orders = store.orders || [];
    store.issues = store.issues || [];
    if (order.id && !store.orders.some((item) => item.id === order.id)) {
      store.orders.unshift(order);
    }
    store.updatedAt = Date.now();
    writeStore(store);
    writeOrders(store.orders);
    writeProducts(store.products);
    writeIssues(store.issues);
    return store;
  } finally {
    lock.releaseLock();
  }
}

function appendIssue(issue) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const store = loadStore() || { products: [], orders: [], issues: [], updatedAt: 0 };
    store.products = store.products || [];
    store.orders = store.orders || [];
    store.issues = store.issues || [];
    if (issue.id && !store.issues.some((item) => item.id === issue.id)) {
      store.issues.unshift(issue);
    }
    store.updatedAt = Date.now();
    writeStore(store);
    writeOrders(store.orders);
    writeProducts(store.products);
    writeIssues(store.issues);
    return store;
  } finally {
    lock.releaseLock();
  }
}

function mergeProducts(currentProducts, newProducts) {
  const map = {};
  currentProducts.concat(newProducts).forEach((product) => {
    if (!product || !product.name) return;
    map[String(product.name).trim().toLowerCase()] = {
      name: product.name,
      size: Number(product.size || 500),
    };
  });
  return Object.keys(map)
    .sort()
    .map((key) => map[key]);
}

function writeStore(store) {
  const sheet = ensureSheet(STORE_SHEET, ["key", "payload", "updatedAt", "webAppUrl"]);
  const settings = loadSettings();
  sheet.getRange(2, 1, 1, 4).setValues([["main", JSON.stringify(store), store.updatedAt || Date.now(), settings.webAppUrl || ""]]);
}

function writeStoreWebAppUrl(webAppUrl) {
  const sheet = ensureSheet(STORE_SHEET, ["key", "payload", "updatedAt", "webAppUrl"]);
  sheet.getRange(2, 4).setValue(webAppUrl || "");
}

function writeOrders(orders) {
  const sheet = ensureSheet(ORDERS_SHEET, [
    "id",
    "queue",
    "createdAt",
    "date",
    "time",
    "status",
    "name",
    "size",
    "qty",
    "grind",
    "customer",
    "issueNote",
    "doneAt",
    "canceledAt",
  ]);
  clearBody(sheet);
  if (!orders.length) return;
  const rows = orders.map((order) => [
    order.id || "",
    order.queue || "",
    order.createdAt || "",
    formatDate(order.createdAt),
    formatTime(order.createdAt),
    order.status || "",
    order.name || "",
    order.size || "",
    order.qty || "",
    order.grind || "",
    order.customer || "",
    order.issueNote || "",
    order.doneAt || "",
    order.canceledAt || "",
  ]);
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function writeIssues(issues) {
  const sheet = ensureSheet(ISSUES_SHEET, ["id", "createdAt", "date", "time", "issue"]);
  clearBody(sheet);
  if (!issues.length) return;
  const rows = issues.map((issue) => [
    issue.id || "",
    issue.createdAt || "",
    formatDate(issue.createdAt),
    formatTime(issue.createdAt),
    issue.message || "",
  ]);
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function writeProducts(products) {
  const sheet = ensureSheet(PRODUCTS_SHEET, ["name", "size"]);
  clearBody(sheet);
  if (!products.length) return;
  const rows = products.map((product) => [product.name || "", product.size || ""]);
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function ensureSheet(name, headers) {
  const spreadsheet = SpreadsheetApp.getActive();
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const needsHeaders = headers.some((header, index) => currentHeaders[index] !== header);
  if (needsHeaders) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function clearBody(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow > 1 && lastColumn > 0) sheet.getRange(2, 1, lastRow - 1, lastColumn).clearContent();
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  return Utilities.formatDate(new Date(timestamp), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  return Utilities.formatDate(new Date(timestamp), Session.getScriptTimeZone(), "HH:mm");
}
