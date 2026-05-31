const STORE_SHEET = "Store";
const ORDERS_SHEET = "Orders";
const PRODUCTS_SHEET = "Products";

function doGet(event) {
  const action = event.parameter.action || "loadStore";
  if (action === "loadStore") return jsonResponse({ status: "ok", store: loadStore() });
  return jsonResponse({ status: "error", message: "Unknown action" });
}

function doPost(event) {
  const payload = JSON.parse(event.postData.contents || "{}");
  if (payload.action === "saveStore") {
    saveStore(payload.store || {});
    return jsonResponse({ status: "ok", updatedAt: payload.store && payload.store.updatedAt });
  }
  return jsonResponse({ status: "error", message: "Unknown action" });
}

function loadStore() {
  const sheet = ensureSheet(STORE_SHEET, ["key", "payload", "updatedAt"]);
  const payload = sheet.getRange(2, 2).getValue();
  if (!payload) return null;
  return JSON.parse(payload);
}

function saveStore(store) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    writeStore(store);
    writeOrders(store.orders || []);
    writeProducts(store.products || []);
  } finally {
    lock.releaseLock();
  }
}

function writeStore(store) {
  const sheet = ensureSheet(STORE_SHEET, ["key", "payload", "updatedAt"]);
  sheet.getRange(2, 1, 1, 3).setValues([["main", JSON.stringify(store), store.updatedAt || Date.now()]]);
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
    "doneAt",
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
    order.doneAt || "",
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
