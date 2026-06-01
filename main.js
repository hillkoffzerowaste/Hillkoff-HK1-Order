import { createCloudStore } from "./sheets-store.js";

const SHEETS_URL_KEY = "hk1-sheets-web-app-url";
const WAIT_MINUTES = { 250: 1, 500: 2, 1000: 4 };

const defaultStore = {
  products: [
    { name: "Hillkoff Espresso Blend", size: 500 },
    { name: "Hillkoff Classic Blend", size: 500 },
    { name: "Hillkoff Arabica 100%", size: 250 },
  ],
  orders: [],
  updatedAt: 0,
};

const state = {
  view: "host",
  store: migrateStore(structuredClone(defaultStore)),
  cloudStore: null,
  cloudSaveTimer: null,
  cloudUnsubscribe: null,
  installPrompt: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

boot();

function boot() {
  bindViews();
  bindSectionTabs();
  bindCashier();
  bindReport();
  bindCloudControls();
  bindInstallApp();
  registerServiceWorker();
  renderAll();
  initCloudSync();
}

function bindViews() {
  $$(".mode-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      $$(".mode-btn").forEach((item) => item.classList.toggle("active", item === button));
      $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${state.view}-view`));
      if (state.view === "report") renderReport();
    });
  });
}

function bindSectionTabs() {
  $$(".queue-tabs .section-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.queuePanel;
      $$(".queue-tabs .section-tab").forEach((item) => item.classList.toggle("active", item === button));
      $$("[data-queue-section]").forEach((section) => {
        section.classList.toggle("active", section.dataset.queueSection === target);
      });
    });
  });

}

function bindCashier() {
  $("#product-name").addEventListener("input", syncProductFromName);
  $("#product-name").addEventListener("change", syncProductFromName);
  bindGrindInput();
  $("#send-order").addEventListener("click", sendOrder);
}

function bindCloudControls() {
  $("#cloud-sync-now")?.addEventListener("click", () => syncCloudNow({ force: true }));
  const sheetsUrlInput = $("#sheets-web-app-url");
  if (sheetsUrlInput) sheetsUrlInput.value = getSheetsWebAppUrl();
  $("#save-sheets-url")?.addEventListener("click", async () => {
    const url = sheetsUrlInput.value.trim();
    if (!url) {
      localStorage.removeItem(SHEETS_URL_KEY);
      toast("ล้าง URL Google Sheets แล้ว");
    } else {
      localStorage.setItem(SHEETS_URL_KEY, url);
      toast("บันทึก URL Google Sheets แล้ว");
    }
    await saveCentralSheetsUrl(url);
    initCloudSync();
  });
}

function bindInstallApp() {
  const installButton = $("#install-app");
  if (!installButton) return;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!state.installPrompt) {
      toast("บนมือถือให้กดเมนู browser แล้วเลือก เพิ่มไปยังหน้าจอหลัก");
      return;
    }
    state.installPrompt.prompt();
    const result = await state.installPrompt.userChoice;
    state.installPrompt = null;
    installButton.hidden = true;
    if (result.outcome === "accepted") toast("ติดตั้งแอพแล้ว");
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    installButton.hidden = true;
    toast("ติดตั้งแอพเรียบร้อย");
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      toast("เตรียมโหมดแอพไม่สำเร็จ");
    });
  });
}

function bindGrindInput() {
  $("#grind").addEventListener("change", syncCustomGrindVisibility);
  syncCustomGrindVisibility();
}

function syncCustomGrindVisibility() {
  const isCustom = $("#grind").value === "custom";
  $("#custom-grind-label").classList.toggle("hidden", !isCustom);
  if (isCustom) $("#custom-grind").focus();
}

function bindReport() {
  const dateInput = $("#report-date");
  dateInput.value = todayKey();
  dateInput.addEventListener("change", renderReport);
  $("#report-today").addEventListener("click", () => {
    dateInput.value = todayKey();
    renderReport();
  });
  $("#copy-report").addEventListener("click", copyDailyReport);
  $("#export-report").addEventListener("click", exportDailyReport);
}

async function sendOrder() {
  const name = $("#product-name").value.trim();
  const size = Number($("#bag-size").value);
  const qty = Math.max(1, Number($("#qty").value || 1));
  const grind = selectedGrind();
  const customer = $("#customer").value.trim();

  if (!name) return toast("กรุณากรอกชื่อสินค้า");
  if (!grind) return toast("กรุณาเลือกหรือกรอกเบอร์บด");

  rememberProduct(name, size);
  const order = createQueuedOrder({ name, size, qty, grind, customer });
  saveStore({ syncCloud: false });

  if (state.cloudStore?.enabled) {
    try {
      renderCloudStatus("กำลังบันทึกออเดอร์", "กำลังส่งออเดอร์เข้า Google Sheets");
      const remoteStore = await state.cloudStore.appendOrder(order, state.store.products);
      if (remoteStore) {
        state.store = migrateStore(remoteStore);
        saveStore({ syncCloud: false, touch: false });
      }
      renderCloudStatus("ออนไลน์พร้อมใช้", `ซิงก์ล่าสุด ${formatTime(Date.now())}`);
    } catch (error) {
      toast("บันทึกออนไลน์ไม่สำเร็จ");
      renderCloudStatus("ซิงก์มีปัญหา", error.message || "ส่งออเดอร์เข้า Google Sheets ไม่สำเร็จ");
      return;
    }
  }

  $("#product-name").value = "";
  $("#customer").value = "";
  $("#qty").value = 1;
  renderAll();
  toast(state.cloudStore?.enabled ? "บันทึกออเดอร์เข้า Sheets แล้ว" : "บันทึกออเดอร์แล้ว");
}

function createQueuedOrder(orderPayload) {
  const order = {
    id: crypto.randomUUID(),
    queue: nextQueue(),
    status: "waiting",
    createdAt: Date.now(),
    ...orderPayload,
  };
  rememberProduct(order.name, order.size);
  state.store.orders.unshift(order);
  return order;
}

function selectedGrind() {
  if ($("#grind").value === "custom") return $("#custom-grind").value.trim();
  return $("#grind").value;
}

function syncProductFromName() {
  const product = findProductByName($("#product-name").value);
  if (product?.size) $("#bag-size").value = String(product.size);
}

function rememberProduct(name, size) {
  const normalizedName = normalizeProductName(name);
  if (!normalizedName) return;
  const index = state.store.products.findIndex((item) => normalizeProductName(item.name) === normalizedName);
  const product = { name: name.trim(), size: Number(size || 500) };
  if (index >= 0) state.store.products[index] = { ...state.store.products[index], ...product };
  else state.store.products.push(product);
  renderProductSuggestions();
}

function findProductByName(name) {
  const normalizedName = normalizeProductName(name);
  return state.store.products.find((item) => normalizeProductName(item.name) === normalizedName);
}

function normalizeProductName(name = "") {
  return String(name).trim().toLocaleLowerCase("th-TH");
}

function setOrderStatus(id, status) {
  const order = state.store.orders.find((item) => item.id === id);
  if (!order) return;
  order.status = status;
  if (status === "done") order.doneAt = Date.now();
  saveStore();
  renderAll();
}

function renderAll() {
  renderHost();
  renderCashier();
  renderReport();
}

function renderHost() {
  const groups = {
    waiting: state.store.orders.filter((order) => order.status === "waiting"),
    grinding: state.store.orders.filter((order) => order.status === "grinding"),
    done: state.store.orders.filter((order) => order.status === "done").slice(0, 20),
  };

  $("#waiting-list").innerHTML = groups.waiting.map(orderCard).join("") || empty("ยังไม่มีออเดอร์ใหม่");
  $("#grinding-list").innerHTML = groups.grinding.map(orderCard).join("") || empty("ยังไม่มีงานกำลังบด");
  $("#done-list").innerHTML = groups.done.map(orderCard).join("") || empty("ยังไม่มีออเดอร์เสร็จ");

  $("#count-waiting").textContent = groups.waiting.length;
  $("#count-grinding").textContent = groups.grinding.length;
  $("#count-done").textContent = state.store.orders.filter((order) => order.status === "done").length;

  $$(".order-action").forEach((button) => {
    button.addEventListener("click", () => setOrderStatus(button.dataset.id, button.dataset.status));
  });
}

function renderCashier() {
  renderProductSuggestions();
  const activeOrders = state.store.orders.filter((order) => order.status !== "done").slice(0, 10);
  $("#cashier-queue-list").innerHTML =
    activeOrders
      .map((order) => `<div class="mini-item"><strong>คิว ${order.queue}</strong><span>${order.name} - ${statusLabel(order.status)}</span></div>`)
      .join("") || empty("ยังไม่มีคิวคงค้าง");
}

function renderProductSuggestions() {
  const list = $("#product-suggestions");
  if (!list) return;
  list.innerHTML = state.store.products
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "th"))
    .map((product) => `<option value="${escapeHtml(product.name)}"></option>`)
    .join("");
}

function renderReport() {
  const report = buildDailyReport($("#report-date")?.value || todayKey());
  renderReportDateLabel(report.date);
  $("#report-orders").textContent = report.orders.length;
  $("#report-bags").textContent = report.totalBags;
  $("#report-minutes").textContent = `${report.totalMinutes} นาที`;
  $("#report-body").innerHTML =
    report.orders.map((order) => `
      <tr>
        <td>${formatTime(order.createdAt)}</td>
        <td>${escapeHtml(order.queue)}</td>
        <td>${escapeHtml(order.name)}</td>
        <td>${order.size}g</td>
        <td>${order.qty}</td>
        <td>${escapeHtml(order.grind)}</td>
        <td>${statusLabel(order.status)}</td>
        <td>${escapeHtml(order.customer || "-")}</td>
      </tr>
    `).join("") || `<tr><td colspan="8">ยังไม่มีออเดอร์ในวันที่เลือก</td></tr>`;
}

async function copyDailyReport() {
  const report = buildDailyReport($("#report-date").value || todayKey());
  await navigator.clipboard?.writeText(formatDailyReportText(report));
  toast("คัดลอกรายงานแล้ว");
}

function exportDailyReport() {
  const report = buildDailyReport($("#report-date").value || todayKey());
  const html = buildExcelHtml(report);
  const blob = new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `HK1-report-${report.date}.xls`;
  link.click();
  URL.revokeObjectURL(url);
  toast("ดาวน์โหลด Excel แล้ว");
}

function buildExcelHtml(report) {
  const rows = report.orders.map((order) => `
    <tr>
      <td>${report.date}</td>
      <td>${formatTime(order.createdAt)}</td>
      <td>${escapeHtml(order.queue)}</td>
      <td>${escapeHtml(order.name)}</td>
      <td>${order.size}</td>
      <td>${order.qty}</td>
      <td>${escapeHtml(order.grind)}</td>
      <td>${statusLabel(order.status)}</td>
      <td>${escapeHtml(order.customer || "")}</td>
      <td>${(WAIT_MINUTES[order.size] || 2) * Number(order.qty || 1)}</td>
    </tr>
  `).join("");
  return `
    <html>
      <head><meta charset="UTF-8" /></head>
      <body>
        <h2>รายงานออเดอร์บดกาแฟประจำวันที่ ${report.date}</h2>
        <table border="1">
          <tr><th>รายการ</th><th>ค่า</th></tr>
          <tr><td>จำนวนออเดอร์</td><td>${report.orders.length}</td></tr>
          <tr><td>จำนวนถุงรวม</td><td>${report.totalBags}</td></tr>
          <tr><td>เวลาบดรวม (นาที)</td><td>${report.totalMinutes}</td></tr>
        </table>
        <br />
        <table border="1">
          <tr>
            <th>วันที่</th><th>เวลา</th><th>คิว</th><th>สินค้า</th>
            <th>ขนาดกรัม</th><th>จำนวนถุง</th><th>เบอร์บด</th><th>สถานะ</th>
            <th>ลูกค้า/เลขบิล</th><th>เวลาบดนาที</th>
          </tr>
          ${rows || '<tr><td colspan="10">ไม่มีข้อมูล</td></tr>'}
        </table>
      </body>
    </html>
  `;
}

function buildDailyReport(dateKey) {
  const orders = state.store.orders
    .filter((order) => dateFromTimestamp(order.createdAt) === dateKey)
    .sort((a, b) => a.createdAt - b.createdAt);
  const totalBags = orders.reduce((sum, order) => sum + Number(order.qty || 0), 0);
  const totalMinutes = orders.reduce((sum, order) => sum + (WAIT_MINUTES[order.size] || 2) * Number(order.qty || 1), 0);
  return { date: dateKey, orders, totalBags, totalMinutes };
}

function formatDailyReportText(report) {
  const lines = [
    `รายงานออเดอร์บดกาแฟประจำวันที่ ${report.date}`,
    `จำนวนออเดอร์: ${report.orders.length}`,
    `จำนวนถุงรวม: ${report.totalBags}`,
    `เวลาบดรวม: ${report.totalMinutes} นาที`,
    "",
    ...report.orders.map((order) =>
      `${formatTime(order.createdAt)} | คิว ${order.queue} | ${order.name} | ${order.size}g x ${order.qty} | ${order.grind} | ${statusLabel(order.status)}`
    ),
  ];
  return lines.join("\n");
}

function renderReportDateLabel(dateKey) {
  const label = $("#report-current-date");
  if (!label) return;
  label.textContent = `วันที่เลือก: ${formatDateLong(dateKey)}`;
}

function formatDateLong(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function orderCard(order) {
  const minutes = (WAIT_MINUTES[order.size] || 2) * order.qty;
  const actions = {
    waiting: `<button class="order-action" data-id="${order.id}" data-status="grinding">เริ่มบด</button>`,
    grinding: `<button class="order-action" data-id="${order.id}" data-status="done">ปิดออเดอร์</button>`,
    done: "",
  };
  return `
    <article class="order-card">
      <div class="order-top">
        <strong>คิว ${order.queue}</strong>
        <span>${minutes} นาที</span>
      </div>
      <h3>${escapeHtml(order.name)}</h3>
      <p>${order.size}g x ${order.qty} ถุง / ${escapeHtml(order.grind)}</p>
      <p class="muted">${escapeHtml(order.customer || "ไม่ระบุลูกค้า")}</p>
      <div class="order-actions">${actions[order.status]}</div>
    </article>`;
}

function totalWait() {
  return state.store.orders
    .filter((order) => order.status !== "done")
    .reduce((sum, order) => sum + (WAIT_MINUTES[order.size] || 2) * Number(order.qty || 1), 0);
}

function nextQueue() {
  const today = todayKey();
  const todays = state.store.orders.filter((order) => dateFromTimestamp(order.createdAt) === today);
  return String(todays.length + 1).padStart(3, "0");
}

function todayKey() {
  return dateFromTimestamp(Date.now());
}

function dateFromTimestamp(timestamp) {
  return new Date(timestamp).toLocaleDateString("sv-SE");
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status) {
  return { waiting: "รอคิว", grinding: "กำลังบด", done: "เสร็จแล้ว" }[status] || status;
}

function saveStore({ syncCloud = true, touch = true } = {}) {
  if (touch) state.store.updatedAt = Date.now();
  if (syncCloud) scheduleCloudSave();
}

function migrateStore(store) {
  const migrated = {
    ...structuredClone(defaultStore),
    ...(store || {}),
  };
  migrated.updatedAt = Number(migrated.updatedAt || 0);
  migrated.products = (migrated.products || [])
    .filter((product) => product?.name)
    .map((product) => ({
      name: product.name,
      size: Number(product.size || 500),
    }));
  migrated.orders = migrated.orders || [];
  return migrated;
}

function initCloudSync() {
  state.cloudUnsubscribe?.();
  state.cloudStore?.stopPolling?.();
  state.cloudStore = createStoreFromSheetsUrl(getSheetsWebAppUrl());
  const sheetsUrlInput = $("#sheets-web-app-url");
  if (sheetsUrlInput) sheetsUrlInput.value = getSheetsWebAppUrl();
  renderCloudStatus("ยังไม่ได้ตั้งค่า", "ใส่ URL Google Sheets Web App ในช่องด้านล่าง แล้วกดบันทึกเพื่อเริ่มซิงก์ออนไลน์");

  if (!state.cloudStore.enabled) return;

  renderCloudStatus("กำลังเชื่อมต่อ", "กำลังเชื่อมต่อ Google Sheets");
  connectCloudStore();
}

function createStoreFromSheetsUrl(webAppUrl) {
  return createCloudStore({
    ...import.meta.env,
    VITE_SHEETS_WEB_APP_URL: webAppUrl,
  });
}

async function connectCloudStore() {
  await refreshCentralSheetsUrl();
  loadCloudStore();
  state.cloudUnsubscribe = state.cloudStore.startPolling(handleRemoteStore, (error) => {
    renderCloudStatus("ซิงก์มีปัญหา", error.message || "ตรวจ Google Sheets ไม่สำเร็จ");
  });
}

async function refreshCentralSheetsUrl() {
  if (!state.cloudStore?.enabled) return;
  try {
    const settings = await state.cloudStore.loadSettings();
    const centralUrl = String(settings.webAppUrl || "").trim();
    if (!centralUrl || centralUrl === state.cloudStore.config.webAppUrl) return;
    localStorage.setItem(SHEETS_URL_KEY, centralUrl);
    state.cloudStore.stopPolling?.();
    state.cloudStore = createStoreFromSheetsUrl(centralUrl);
    const sheetsUrlInput = $("#sheets-web-app-url");
    if (sheetsUrlInput) sheetsUrlInput.value = centralUrl;
    renderCloudStatus("อัปเดต URL แล้ว", "ดึง Google Sheets Web App URL ล่าสุดจาก Sheet แล้ว");
  } catch (error) {
    renderCloudStatus("ซิงก์มีปัญหา", error.message || "ดึง URL ล่าสุดจาก Google Sheets ไม่สำเร็จ");
  }
}

async function saveCentralSheetsUrl(webAppUrl) {
  const targets = [state.cloudStore, createStoreFromSheetsUrl(webAppUrl)].filter((store) => store?.enabled);
  const uniqueTargets = [...new Map(targets.map((store) => [store.config.webAppUrl, store])).values()];
  for (const store of uniqueTargets) {
    try {
      await store.saveSettings({ webAppUrl });
    } catch {
      // A brand-new deployment may not have the latest script yet; keep trying other known URLs.
    }
  }
}

async function loadCloudStore() {
  try {
    renderCloudStatus("กำลังโหลดข้อมูล", "กำลังดึงข้อมูลล่าสุดจาก Google Sheets");
    const remoteStore = await state.cloudStore.load();
    if (remoteStore) {
      handleRemoteStore(remoteStore, { force: true });
      return;
    }
    renderCloudStatus("ออนไลน์พร้อมใช้", "ยังไม่มีข้อมูลใน Google Sheets");
  } catch (error) {
    renderCloudStatus("ซิงก์มีปัญหา", error.message || "โหลดข้อมูล Google Sheets ไม่สำเร็จ");
  }
}

function scheduleCloudSave() {
  if (!state.cloudStore?.enabled) return;
  window.clearTimeout(state.cloudSaveTimer);
  state.cloudSaveTimer = window.setTimeout(() => syncCloudNow(), 1200);
}

async function syncCloudNow({ force = false } = {}) {
  if (!state.cloudStore?.enabled) {
    renderCloudStatus("ยังไม่ได้ตั้งค่า", "ใส่ URL Google Sheets Web App ในไฟล์ .env ก่อนใช้งานออนไลน์");
    return;
  }

  try {
    if (force) {
      renderCloudStatus("กำลังตรวจข้อมูล", "กำลังเทียบข้อมูลในเครื่องกับ Google Sheets");
      const remoteStore = await state.cloudStore.load();
      if (remoteStore) {
        handleRemoteStore(remoteStore, { force: true });
        return;
      }
      if (!state.store.orders.length && !state.store.products.length) {
        renderCloudStatus("ออนไลน์พร้อมใช้", "ยังไม่มีข้อมูลใน Google Sheets");
        return;
      }
    }

    renderCloudStatus("กำลังซิงก์", "กำลังบันทึกข้อมูลขึ้น Google Sheets");
    const remoteStore = await state.cloudStore.load();
    const mergedStore = remoteStore ? mergeStores(migrateStore(remoteStore), state.store) : migrateStore(state.store);
    mergedStore.updatedAt = Date.now();
    await state.cloudStore.save(mergedStore);
    state.store = migrateStore(mergedStore);
    saveStore({ syncCloud: false, touch: false });
    renderCloudStatus("ออนไลน์พร้อมใช้", `ซิงก์ล่าสุด ${formatTime(Date.now())}`);
  } catch (error) {
    renderCloudStatus("ซิงก์มีปัญหา", error.message || "บันทึก Google Sheets ไม่สำเร็จ");
  }
}

function handleRemoteStore(remoteStore, { force = false } = {}) {
  const remote = migrateStore(remoteStore);
  if (!force && (remote.updatedAt || 0) <= (state.store.updatedAt || 0)) return false;

  state.store = remote;
  saveStore({ syncCloud: false, touch: false });
  renderAll();
  renderCloudStatus("รับข้อมูลออนไลน์แล้ว", `อัปเดตล่าสุด ${formatTime(remote.updatedAt)}`);
  return true;
}

function mergeStores(remoteStore, localStore) {
  const merged = migrateStore(remoteStore);
  const ordersById = new Map((merged.orders || []).map((order) => [order.id, order]));
  (localStore.orders || []).forEach((order) => {
    if (!order?.id) return;
    ordersById.set(order.id, { ...(ordersById.get(order.id) || {}), ...order });
  });
  merged.orders = [...ordersById.values()].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const productsByName = new Map((merged.products || []).map((product) => [normalizeProductName(product.name), product]));
  (localStore.products || []).forEach((product) => {
    const key = normalizeProductName(product.name);
    if (key) productsByName.set(key, { ...(productsByName.get(key) || {}), ...product });
  });
  merged.products = [...productsByName.values()];
  return merged;
}

function renderCloudStatus(status, detail) {
  const statusEl = $("#cloud-status");
  const detailEl = $("#cloud-detail");
  if (statusEl) statusEl.textContent = status;
  if (detailEl) detailEl.textContent = detail;
}

function getSheetsWebAppUrl() {
  return localStorage.getItem(SHEETS_URL_KEY) || import.meta.env.VITE_SHEETS_WEB_APP_URL || "";
}

function empty(text) {
  return `<div class="empty">${text}</div>`;
}

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  window.setTimeout(() => $("#toast").classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
