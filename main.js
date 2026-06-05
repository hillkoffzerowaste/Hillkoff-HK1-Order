import { createCloudStore } from "./supabase-store.js";

const WAIT_MINUTES = { 200: 1, 250: 1, 500: 2, 1000: 4 };

const defaultStore = {
  products: [
    { name: "Hillkoff Espresso Blend", size: 500 },
    { name: "Hillkoff Classic Blend", size: 500 },
    { name: "Hillkoff Arabica 100%", size: 250 },
  ],
  orders: [],
  issues: [],
  updatedAt: 0,
};

const state = {
  view: "host",
  clientId: crypto.randomUUID(),
  store: migrateStore(structuredClone(defaultStore)),
  blendProducts: [],
  cloudStore: null,
  cloudUnsubscribe: null,
  realtimeRetryTimer: null,
  realtimeRetryAttempt: 0,
  cloudPollTimer: null,
  cloudPollInFlight: false,
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
  bindSettings();
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
  bindOrderModeTabs();
  bindBlendForm();
  $("#send-order").addEventListener("click", sendOrder);
  $("#send-blend-order").addEventListener("click", sendBlendOrder);
}

function bindOrderModeTabs() {
  $$(".cashier-tabs .section-tab").forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.orderMode;
      $$(".cashier-tabs .section-tab").forEach((item) => item.classList.toggle("active", item === button));
      $$("[data-order-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.orderPanel !== mode));
    });
  });
}

function bindBlendForm() {
  $("#add-blend-product").addEventListener("click", addBlendProduct);
  $("#blend-product-name").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addBlendProduct();
  });
  $("#blend-grams").addEventListener("change", syncBlendCustomGramsVisibility);
  $("#blend-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-blend]");
    if (!button) return;
    state.blendProducts.splice(Number(button.dataset.removeBlend), 1);
    renderBlendList();
  });
  $("#blend-grind").addEventListener("change", syncBlendCustomGrindVisibility);
  syncBlendCustomGramsVisibility();
  syncBlendCustomGrindVisibility();
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

function syncBlendCustomGrindVisibility() {
  const isCustom = $("#blend-grind").value === "custom";
  $("#blend-custom-grind-label").classList.toggle("hidden", !isCustom);
  if (isCustom) $("#blend-custom-grind").focus();
}

function syncBlendCustomGramsVisibility() {
  const isCustom = $("#blend-grams").value === "custom";
  $("#blend-custom-grams-label").classList.toggle("hidden", !isCustom);
  if (isCustom) $("#blend-custom-grams").focus();
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
  $("#send-issue").addEventListener("click", sendIssue);
}

function bindSettings() {
  const button = $("#enable-notifications");
  if (!button) return;
  button.addEventListener("click", requestNotificationPermission);
  renderNotificationSettings();
}

async function sendOrder() {
  const name = $("#product-name").value.trim();
  const size = Number($("#bag-size").value);
  const qty = Math.max(1, Number($("#qty").value || 1));
  const grind = selectedGrind();
  const customer = $("#customer").value.trim();

  if (!name) return toast("กรุณากรอกชื่อสินค้า");
  if (!grind) return toast("กรุณาเลือกหรือกรอกเบอร์บด");
  if (!state.cloudStore?.enabled) {
    renderCloudStatus("ระบบยังไม่พร้อม", "ยังเชื่อมต่อข้อมูลกลางไม่สำเร็จ");
    reconnectCloudStore();
    return toast("ระบบยังไม่พร้อม ลองอีกครั้งในอีกสักครู่");
  }

  rememberProduct(name, size);
  const order = createQueuedOrder({ name, size, qty, grind, customer });
  saveStore();

  try {
    renderCloudStatus("กำลังบันทึกออเดอร์", "กำลังส่งออเดอร์เข้าข้อมูลกลาง");
    const remoteStore = await state.cloudStore.appendOrder(order, state.store.products, state.store);
    if (remoteStore) {
      state.store = migrateStore(remoteStore);
      saveStore({ touch: false });
    }
    renderCloudStatus("ระบบพร้อมใช้งาน", `บันทึกล่าสุด ${formatTime(Date.now())}`);
  } catch (error) {
    removeOrder(order.id);
    reconnectCloudStore();
    toast("บันทึกออเดอร์ไม่สำเร็จ");
    renderCloudStatus("ระบบมีปัญหา", error.message || "ส่งออเดอร์ไม่สำเร็จ");
    return;
  }

  $("#product-name").value = "";
  $("#customer").value = "";
  $("#qty").value = 1;
  renderAll();
  toast("บันทึกออเดอร์แล้ว");
}

async function sendBlendOrder() {
  const components = state.blendProducts.slice();
  const customDetail = $("#blend-detail").value.trim();
  const qty = blendTotalBags(components);
  const grind = selectedBlendGrind();
  const customer = $("#blend-customer").value.trim();

  if (!components.length) return toast("กรุณาเพิ่มกาแฟที่จะผสมอย่างน้อย 1 ตัว");
  if (!grind) return toast("กรุณาเลือกหรือกรอกเบอร์บด");
  if (!state.cloudStore?.enabled) {
    renderCloudStatus("ระบบยังไม่พร้อม", "ยังเชื่อมต่อข้อมูลกลางไม่สำเร็จ");
    reconnectCloudStore();
    return toast("ระบบยังไม่พร้อม ลองอีกครั้งในอีกสักครู่");
  }

  const blendName = `ผสม: ${components.map((item) => item.name).join(" + ")}`;
  const order = createQueuedOrder({
    name: blendName,
    size: 0,
    qty,
    grind,
    customer,
    type: "blend",
    blendComponents: components,
    blendDetail: customDetail,
  });
  saveStore();

  try {
    renderCloudStatus("กำลังบันทึกออเดอร์ผสม", "กำลังส่งออเดอร์เข้าข้อมูลกลาง");
    const remoteStore = await state.cloudStore.appendOrder(order, state.store.products, state.store);
    if (remoteStore) {
      state.store = migrateStore(remoteStore);
      saveStore({ touch: false });
    }
    renderCloudStatus("ระบบพร้อมใช้งาน", `บันทึกล่าสุด ${formatTime(Date.now())}`);
  } catch (error) {
    removeOrder(order.id);
    reconnectCloudStore();
    toast("บันทึกออเดอร์ไม่สำเร็จ");
    renderCloudStatus("ระบบมีปัญหา", error.message || "ส่งออเดอร์ไม่สำเร็จ");
    return;
  }

  state.blendProducts = [];
  $("#blend-customer").value = "";
  $("#blend-detail").value = "";
  $("#blend-product-name").value = "";
  $("#blend-grams").value = "500";
  $("#blend-custom-grams").value = "";
  $("#blend-bags").value = 1;
  syncBlendCustomGramsVisibility();
  renderBlendList();
  renderAll();
  toast("บันทึกออเดอร์ผสมแล้ว");
}

function createQueuedOrder(orderPayload) {
  const order = {
    id: crypto.randomUUID(),
    queue: nextQueue(),
    status: "waiting",
    createdAt: Date.now(),
    sourceClientId: state.clientId,
    ...orderPayload,
  };
  if (order.type !== "blend") rememberProduct(order.name, order.size);
  state.store.orders.unshift(order);
  return order;
}

function removeOrder(id) {
  state.store.orders = state.store.orders.filter((order) => order.id !== id);
  saveStore();
  renderAll();
}

async function sendIssue() {
  const message = $("#issue-message").value.trim();
  if (!message) return toast("กรุณากรอกปัญหาที่ต้องการบันทึก");

  const issue = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    message,
  };
  state.store.issues.unshift(issue);
  saveStore();

  if (!state.cloudStore?.enabled) {
    removeIssue(issue.id);
    renderCloudStatus("ระบบยังไม่พร้อม", "ยังเชื่อมต่อข้อมูลกลางไม่สำเร็จ");
    reconnectCloudStore();
    return toast("ระบบยังไม่พร้อม ลองอีกครั้งในอีกสักครู่");
  }

  try {
    renderCloudStatus("กำลังบันทึกปัญหา", "กำลังส่งแจ้งปัญหาเข้าข้อมูลกลาง");
    const remoteStore = await state.cloudStore.appendIssue(issue, state.store);
    if (remoteStore) {
      state.store = migrateStore(remoteStore);
      saveStore({ touch: false });
    }
    renderCloudStatus("ระบบพร้อมใช้งาน", `บันทึกล่าสุด ${formatTime(Date.now())}`);
  } catch (error) {
    removeIssue(issue.id);
    reconnectCloudStore();
    toast("บันทึกปัญหาไม่สำเร็จ");
    renderCloudStatus("ระบบมีปัญหา", error.message || "ส่งแจ้งปัญหาไม่สำเร็จ");
    return;
  }

  $("#issue-message").value = "";
  renderReport();
  toast("บันทึกปัญหาแล้ว");
}

function removeIssue(id) {
  state.store.issues = state.store.issues.filter((issue) => issue.id !== id);
  saveStore();
  renderReport();
}

function selectedGrind() {
  if ($("#grind").value === "custom") return $("#custom-grind").value.trim();
  return $("#grind").value;
}

function selectedBlendGrind() {
  if ($("#blend-grind").value === "custom") return $("#blend-custom-grind").value.trim();
  return $("#blend-grind").value;
}

function addBlendProduct() {
  const name = $("#blend-product-name").value.trim();
  const grams = selectedBlendGrams();
  const bags = Math.max(1, Number($("#blend-bags").value || 1));
  const product = findProductByName(name);
  const productName = product?.name || name;
  if (!productName) return toast("กรุณาพิมพ์หรือเลือกชื่อกาแฟ");
  if (!Number.isFinite(grams) || grams <= 0) return toast("กรุณาใส่จำนวนกรัมของกาแฟตัวนี้");
  if (!Number.isFinite(bags) || bags <= 0) return toast("กรุณาใส่จำนวนถุงของกาแฟตัวนี้");
  if (state.blendProducts.some((item) => normalizeProductName(item.name) === normalizeProductName(productName))) {
    return toast("เพิ่มกาแฟตัวนี้ในสูตรผสมแล้ว");
  }
  rememberProduct(productName, product?.size || grams);
  state.blendProducts.push({ name: productName, grams, bags });
  $("#blend-product-name").value = "";
  $("#blend-grams").value = "500";
  $("#blend-custom-grams").value = "";
  $("#blend-bags").value = 1;
  syncBlendCustomGramsVisibility();
  renderBlendList();
}

function selectedBlendGrams() {
  if ($("#blend-grams").value === "custom") return Number($("#blend-custom-grams").value || 0);
  return Number($("#blend-grams").value || 0);
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
  renderBlendProductOptions();
}

function findProductByName(name) {
  const normalizedName = normalizeProductName(name);
  return state.store.products.find((item) => normalizeProductName(item.name) === normalizedName);
}

function normalizeProductName(name = "") {
  return String(name).trim().toLocaleLowerCase("th-TH");
}

async function setOrderStatus(id, status) {
  const order = state.store.orders.find((item) => item.id === id);
  if (!order) return;
  const previousOrder = { ...order };
  order.status = status;
  if (status === "done") order.doneAt = Date.now();
  if (status === "canceled") order.canceledAt = Date.now();
  saveStore();
  renderAll();
  if (!state.cloudStore?.enabled) {
    Object.assign(order, previousOrder);
    saveStore();
    renderAll();
    renderCloudStatus("ระบบยังไม่พร้อม", "ยังเชื่อมต่อข้อมูลกลางไม่สำเร็จ");
    reconnectCloudStore();
    return toast("ระบบยังไม่พร้อม ลองอีกครั้งในอีกสักครู่");
  }
  try {
    await state.cloudStore.upsertOrder(order, state.store);
    renderCloudStatus("ระบบพร้อมใช้งาน", `อัปเดตล่าสุด ${formatTime(Date.now())}`);
  } catch (error) {
    Object.assign(order, previousOrder);
    saveStore();
    renderAll();
    reconnectCloudStore();
    renderCloudStatus("ระบบมีปัญหา", error.message || "อัปเดตสถานะออเดอร์ไม่สำเร็จ");
    toast("อัปเดตสถานะไม่สำเร็จ");
  }
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
    done: state.store.orders.filter((order) => order.status === "done" || order.status === "canceled").slice(0, 20),
  };

  $("#waiting-list").innerHTML = groups.waiting.map(orderCard).join("") || empty("ยังไม่มีออเดอร์ใหม่");
  $("#grinding-list").innerHTML = groups.grinding.map(orderCard).join("") || empty("ยังไม่มีงานกำลังบด");
  $("#done-list").innerHTML = groups.done.map(orderCard).join("") || empty("ยังไม่มีออเดอร์เสร็จหรือยกเลิก");

  $("#count-waiting").textContent = groups.waiting.length;
  $("#count-grinding").textContent = groups.grinding.length;
  $("#count-done").textContent = state.store.orders.filter((order) => order.status === "done").length;

  $$(".order-action").forEach((button) => {
    button.addEventListener("click", () => setOrderStatus(button.dataset.id, button.dataset.status));
  });
}

function renderCashier() {
  renderProductSuggestions();
  renderBlendProductOptions();
  renderBlendList();
  const activeOrders = state.store.orders.filter((order) => order.status !== "done" && order.status !== "canceled").slice(0, 10);
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

function renderBlendProductOptions() {
  const list = $("#blend-product-suggestions");
  if (!list) return;
  const products = state.store.products.slice().sort((a, b) => a.name.localeCompare(b.name, "th"));
  list.innerHTML = products.map((product) => `<option value="${escapeHtml(product.name)}"></option>`).join("");
}

function renderBlendList() {
  const list = $("#blend-list");
  if (!list) return;
  list.innerHTML =
    state.blendProducts
      .map(
        (product, index) => `
          <div class="blend-item">
            <span>${escapeHtml(product.name)}</span>
            <small>${formatBlendComponent(product)}</small>
            <button class="icon-btn" type="button" data-remove-blend="${index}">ลบ</button>
          </div>
        `
      )
      .join("") || empty("ยังไม่ได้เพิ่มกาแฟที่จะผสม");
}

function renderReport() {
  const report = buildDailyReport($("#report-date")?.value || todayKey());
  renderReportDateLabel(report.date);
  $("#report-orders").textContent = report.orders.length;
  $("#report-bags").textContent = report.totalBags;
  $("#report-minutes").textContent = `${report.totalMinutes} นาที`;
  $("#report-issues").textContent = report.issues.length;
  $("#report-body").innerHTML =
    report.orders.map((order) => `
      <tr>
        <td>${formatTime(order.createdAt)}</td>
        <td>${escapeHtml(order.queue)}</td>
        <td>${escapeHtml(order.name)}</td>
        <td>${escapeHtml(orderSizeLabel(order))}</td>
        <td>${order.qty}</td>
        <td>${escapeHtml(order.grind)}</td>
        <td>${statusLabel(order.status)}</td>
        <td>${escapeHtml(order.customer || "-")}</td>
      </tr>
    `).join("") || `<tr><td colspan="8">ยังไม่มีออเดอร์ในวันที่เลือก</td></tr>`;
  $("#issue-list").innerHTML =
    report.issues
      .map((issue) => `
        <div class="issue-item">
          <strong>${formatTime(issue.createdAt)}</strong>
          <span>${escapeHtml(issue.message)}</span>
        </div>`)
      .join("") || empty("ยังไม่มีแจ้งปัญหาของวันนี้");
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
      <td>${escapeHtml(orderSizeLabel(order))}</td>
      <td>${order.qty}</td>
      <td>${escapeHtml(order.grind)}</td>
      <td>${statusLabel(order.status)}</td>
      <td>${escapeHtml(order.customer || "")}</td>
      <td>${orderMinutes(order)}</td>
    </tr>
  `).join("");
  const issueRows = report.issues.map((issue) => `
    <tr>
      <td>${report.date}</td>
      <td>${formatTime(issue.createdAt)}</td>
      <td>${escapeHtml(issue.message)}</td>
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
          <tr><td>แจ้งปัญหา</td><td>${report.issues.length}</td></tr>
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
        <br />
        <table border="1">
          <tr><th>วันที่</th><th>เวลา</th><th>แจ้งปัญหา</th></tr>
          ${issueRows || '<tr><td colspan="3">ไม่มีแจ้งปัญหา</td></tr>'}
        </table>
      </body>
    </html>
  `;
}

function buildDailyReport(dateKey) {
  const orders = state.store.orders
    .filter((order) => dateFromTimestamp(order.createdAt) === dateKey)
    .sort((a, b) => a.createdAt - b.createdAt);
  const issues = (state.store.issues || [])
    .filter((issue) => dateFromTimestamp(issue.createdAt) === dateKey)
    .sort((a, b) => a.createdAt - b.createdAt);
  const totalBags = orders.reduce((sum, order) => sum + Number(order.qty || 0), 0);
  const totalMinutes = orders.reduce((sum, order) => sum + orderMinutes(order), 0);
  return { date: dateKey, orders, issues, totalBags, totalMinutes };
}

function formatDailyReportText(report) {
  const lines = [
    `รายงานออเดอร์บดกาแฟประจำวันที่ ${report.date}`,
    `จำนวนออเดอร์: ${report.orders.length}`,
    `จำนวนถุงรวม: ${report.totalBags}`,
    `เวลาบดรวม: ${report.totalMinutes} นาที`,
    `แจ้งปัญหา: ${report.issues.length}`,
    "",
    ...report.orders.map((order) =>
      `${formatTime(order.createdAt)} | คิว ${order.queue} | ${order.name} | ${orderSizeLabel(order)} x ${order.qty} | ${order.grind} | ${statusLabel(order.status)}`
    ),
    "",
    "แจ้งปัญหา",
    ...(report.issues.length
      ? report.issues.map((issue) => `${formatTime(issue.createdAt)} | ${issue.message}`)
      : ["ไม่มีแจ้งปัญหา"]),
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
  const minutes = orderMinutes(order);
  const startActionLabel = order.type === "blend" ? "เริ่มผสม/บด" : "เริ่มบด";
  const actions = {
    waiting: `
      <button class="order-action" data-id="${order.id}" data-status="grinding">${startActionLabel}</button>
      <button class="order-action danger" data-id="${order.id}" data-status="canceled">ยกเลิก</button>
    `,
    grinding: `
      <button class="order-action" data-id="${order.id}" data-status="done">ปิดออเดอร์</button>
      <button class="order-action danger" data-id="${order.id}" data-status="canceled">ยกเลิก</button>
    `,
    done: "",
    canceled: "",
  };
  return `
    <article class="order-card">
      <div class="order-top">
        <strong>คิว ${order.queue}</strong>
        <span>${minutes} นาที</span>
      </div>
      <h3>${escapeHtml(order.name)}</h3>
      <p>${escapeHtml(orderSizeLabel(order))} x ${order.qty} ถุง / ${escapeHtml(order.grind)}</p>
      ${renderBlendComponents(order)}
      ${order.blendDetail ? `<p class="muted">${escapeHtml(order.blendDetail)}</p>` : ""}
      <p class="muted">${escapeHtml(order.customer || "ไม่ระบุลูกค้า")}</p>
      <div class="order-actions">${actions[order.status]}</div>
    </article>`;
}

function totalWait() {
  return state.store.orders
    .filter((order) => order.status !== "done" && order.status !== "canceled")
    .reduce((sum, order) => sum + orderMinutes(order), 0);
}

function orderMinutes(order) {
  if (order.type === "blend" && order.blendComponents?.length) {
    return order.blendComponents.reduce((sum, component) => sum + componentMinutes(component), 0);
  }
  return (WAIT_MINUTES[order.size] || 2) * Number(order.qty || 1);
}

function orderSizeLabel(order) {
  if (order.type === "blend") return "ผสมตามรายการ";
  if (order.size) return `${order.size}g`;
  return order.blendDetail || "รายละเอียดเอง";
}

function blendTotalBags(components) {
  return components.reduce((sum, component) => sum + Number(component.bags || 1), 0) || 1;
}

function componentMinutes(component) {
  const grams = Number(component.grams || component.size || 500);
  const bags = Number(component.bags || 1);
  if (WAIT_MINUTES[grams]) return WAIT_MINUTES[grams] * bags;
  return Math.max(1, Math.ceil(grams / 250)) * bags;
}

function formatBlendComponent(component) {
  const grams = Number(component.grams || component.size || 0);
  const bags = Number(component.bags || 1);
  return `${grams || "-"}g x ${bags} ถุง`;
}

function renderBlendComponents(order) {
  if (order.type !== "blend" || !order.blendComponents?.length) return "";
  return `
    <ul class="blend-components">
      ${order.blendComponents
        .map((component) => `<li>${escapeHtml(component.name)} <span>${escapeHtml(formatBlendComponent(component))}</span></li>`)
        .join("")}
    </ul>
  `;
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
  return { waiting: "รอคิว", grinding: "กำลังบด", done: "เสร็จแล้ว", canceled: "ยกเลิก" }[status] || status;
}

function saveStore({ touch = true } = {}) {
  if (touch) state.store.updatedAt = Date.now();
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
  migrated.issues = (migrated.issues || [])
    .filter((issue) => issue?.message)
    .map((issue) => ({
      id: issue.id || crypto.randomUUID(),
      createdAt: Number(issue.createdAt || Date.now()),
      message: String(issue.message),
    }));
  return migrated;
}

function initCloudSync() {
  clearRealtimeRetry();
  stopCloudPolling();
  state.cloudUnsubscribe?.();
  state.cloudStore?.stopRealtime?.();
  state.cloudStore = createCloudStore();
  renderCloudStatus("ระบบกำลังเตรียมพร้อม", "กำลังเตรียมการเชื่อมต่อข้อมูลกลาง");

  if (!state.cloudStore.enabled) return;

  renderCloudStatus("กำลังเชื่อมต่อ", "กำลังเชื่อมต่อข้อมูลกลาง");
  connectCloudStore();
  startCloudPolling();
  bindConnectionLifecycle();
}

async function connectCloudStore() {
  clearRealtimeRetry();
  loadCloudStore();
  state.cloudStore.stopRealtime?.();
  state.cloudUnsubscribe = state.cloudStore.startRealtime({
    onStoreChange: handleRemoteStore,
    onOrderChange: handleRemoteOrder,
    onIssueChange: handleRemoteIssue,
    onStatus: handleRealtimeStatus,
    onError: (error) => {
      renderCloudStatus("ระบบมีปัญหา", error.message || "ตรวจข้อมูลกลางไม่สำเร็จ");
      scheduleRealtimeReconnect();
    },
  });
}

function reconnectCloudStore() {
  if (!state.cloudStore?.enabled || !navigator.onLine) return;
  state.cloudUnsubscribe?.();
  state.cloudStore.stopRealtime?.();
  connectCloudStore();
}

function handleRealtimeStatus(status) {
  if (status === "SUBSCRIBED") {
    state.realtimeRetryAttempt = 0;
    renderCloudStatus("ระบบพร้อมใช้งาน", `เชื่อมต่อล่าสุด ${formatTime(Date.now())}`);
    return;
  }
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
    scheduleRealtimeReconnect();
  }
}

function scheduleRealtimeReconnect() {
  if (!state.cloudStore?.enabled || state.realtimeRetryTimer || !navigator.onLine) return;
  const delay = Math.min(30000, 1000 * 2 ** state.realtimeRetryAttempt);
  state.realtimeRetryAttempt += 1;
  state.realtimeRetryTimer = window.setTimeout(() => {
    state.realtimeRetryTimer = null;
    reconnectCloudStore();
  }, delay);
}

function clearRealtimeRetry() {
  if (!state.realtimeRetryTimer) return;
  window.clearTimeout(state.realtimeRetryTimer);
  state.realtimeRetryTimer = null;
}

function startCloudPolling() {
  stopCloudPolling();
  state.cloudPollTimer = window.setInterval(() => {
    pollCloudStore();
  }, 4000);
}

function stopCloudPolling() {
  if (!state.cloudPollTimer) return;
  window.clearInterval(state.cloudPollTimer);
  state.cloudPollTimer = null;
}

async function pollCloudStore() {
  if (!state.cloudStore?.enabled || state.cloudPollInFlight || !navigator.onLine) return;
  state.cloudPollInFlight = true;
  try {
    await loadCloudStore({ force: false, silent: true });
  } finally {
    state.cloudPollInFlight = false;
  }
}

function bindConnectionLifecycle() {
  if (bindConnectionLifecycle.bound) return;
  bindConnectionLifecycle.bound = true;
  window.addEventListener("online", reconnectCloudStore);
  window.addEventListener("focus", () => {
    if (state.cloudStore?.enabled) loadCloudStore({ force: false });
    reconnectCloudStore();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (state.cloudStore?.enabled) loadCloudStore({ force: false });
    reconnectCloudStore();
  });
}

async function loadCloudStore({ force = true, silent = false } = {}) {
  try {
    if (!silent) renderCloudStatus("กำลังโหลดข้อมูล", "กำลังอ่านข้อมูลล่าสุดจากข้อมูลกลาง");
    const remoteStore = await state.cloudStore.load();
    if (remoteStore) {
      handleRemoteStore(remoteStore, { force });
      return;
    }
    if (!silent) renderCloudStatus("ระบบพร้อมใช้งาน", "ยังไม่มีข้อมูลในข้อมูลกลาง");
  } catch (error) {
    if (!silent) renderCloudStatus("ระบบมีปัญหา", error.message || "โหลดข้อมูลไม่สำเร็จ");
    scheduleRealtimeReconnect();
  }
}

function handleRemoteStore(remoteStore, { force = false } = {}) {
  const remote = migrateStore(remoteStore);
  if (!force && (remote.updatedAt || 0) <= (state.store.updatedAt || 0)) return false;

  const knownOrderIds = new Set((state.store.orders || []).map((order) => order.id));
  state.store = remote;
  saveStore({ touch: false });
  renderAll();
  remote.orders
    .filter((order) => !knownOrderIds.has(order.id) && order.sourceClientId !== state.clientId)
    .forEach(notifyIncomingOrder);
  renderCloudStatus("รับข้อมูลใหม่แล้ว", `อัปเดตล่าสุด ${formatTime(remote.updatedAt)}`);
  return true;
}

function handleRemoteOrder(order, { eventType } = {}) {
  if (!order?.id || order.sourceClientId === state.clientId) return false;
  const existed = state.store.orders.some((item) => item.id === order.id);
  const ordersById = new Map((state.store.orders || []).map((item) => [item.id, item]));
  ordersById.set(order.id, { ...(ordersById.get(order.id) || {}), ...order });
  state.store.orders = [...ordersById.values()].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  if (order.type !== "blend") rememberProduct(order.name, order.size);
  state.store.updatedAt = Math.max(Number(state.store.updatedAt || 0), Number(order.updatedAt || order.createdAt || Date.now()));
  saveStore({ touch: false });
  renderAll();
  if (!existed && eventType === "INSERT") notifyIncomingOrder(order);
  renderCloudStatus("รับออเดอร์ใหม่แล้ว", `อัปเดตล่าสุด ${formatTime(Date.now())}`);
  return true;
}

function handleRemoteIssue(issue) {
  if (!issue?.id) return false;
  const issuesById = new Map((state.store.issues || []).map((item) => [item.id, item]));
  issuesById.set(issue.id, { ...(issuesById.get(issue.id) || {}), ...issue });
  state.store.issues = [...issuesById.values()].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  saveStore({ touch: false });
  renderReport();
  return true;
}

function notifyIncomingOrder(order) {
  toast(`มีออเดอร์บดกาแฟใหม่ คิว ${order.queue || "-"}: ${order.name || ""}`);
  playOrderAlert();
  showOrderNotification(order);
}

function playOrderAlert() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const master = context.createGain();
    const start = context.currentTime;
    const beepDuration = 0.24;
    const interval = 0.5;
    const totalDuration = 5;

    master.gain.value = 0.42;
    master.connect(context.destination);

    for (let offset = 0; offset < totalDuration; offset += interval) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const beepStart = start + offset;
      const frequency = offset % 1 === 0 ? 920 : 720;

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequency, beepStart);
      gain.gain.setValueAtTime(0.0001, beepStart);
      gain.gain.exponentialRampToValueAtTime(0.34, beepStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, beepStart + beepDuration);
      oscillator.connect(gain).connect(master);
      oscillator.start(beepStart);
      oscillator.stop(beepStart + beepDuration + 0.04);
    }

    window.setTimeout(() => context.close?.(), Math.ceil((totalDuration + 0.4) * 1000));
  } catch {
    // Some browsers block sound until the page has received a user gesture.
  }
}

function showOrderNotification(order) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
  const title = "มีออเดอร์บดกาแฟใหม่";
  const options = {
    body: `คิว ${order.queue || "-"}: ${order.name || ""}`,
    tag: `hk-order-${order.id}`,
    data: { url: "/" },
  };
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => registration.showNotification(title, options))
      .catch(() => new Notification(title, options));
    return;
  }
  new Notification(title, options);
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    renderNotificationSettings("ไม่รองรับ", "เบราว์เซอร์นี้ยังไม่รองรับการแจ้งเตือน");
    return;
  }
  if (Notification.permission === "default") {
    await Notification.requestPermission();
  }
  renderNotificationSettings();
  if (Notification.permission === "granted") toast("เปิดการแจ้งเตือนแล้ว");
  else toast("ยังไม่ได้อนุญาตการแจ้งเตือน");
}

function renderNotificationSettings(status, detail) {
  const statusEl = $("#notification-status");
  const detailEl = $("#notification-detail");
  const button = $("#enable-notifications");
  if (!statusEl || !detailEl || !button) return;
  if (!("Notification" in window)) {
    statusEl.textContent = status || "ไม่รองรับ";
    detailEl.textContent = detail || "เบราว์เซอร์นี้ยังไม่รองรับการแจ้งเตือน";
    button.disabled = true;
    return;
  }

  const labels = {
    granted: ["เปิดแล้ว", "เครื่องนี้จะแจ้งเตือนเมื่อมีออเดอร์ใหม่และแอพยังเปิดอยู่เบื้องหลัง", "เปิดแล้ว"],
    denied: ["ถูกปิดไว้", "ต้องเปิดสิทธิ์แจ้งเตือนจากการตั้งค่าของเบราว์เซอร์หรือระบบ", "เปิดการแจ้งเตือน"],
    default: ["ยังไม่ได้เปิด", "เปิดการแจ้งเตือนบนเครื่องนี้เพื่อรับออเดอร์ใหม่เมื่อแอพยังเปิดอยู่เบื้องหลัง", "เปิดการแจ้งเตือน"],
  };
  const [nextStatus, nextDetail, nextButton] = labels[Notification.permission] || labels.default;
  statusEl.textContent = status || nextStatus;
  detailEl.textContent = detail || nextDetail;
  button.textContent = nextButton;
  button.disabled = Notification.permission === "granted";
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
  const issuesById = new Map((merged.issues || []).map((issue) => [issue.id, issue]));
  (localStore.issues || []).forEach((issue) => {
    if (!issue?.id) return;
    issuesById.set(issue.id, { ...(issuesById.get(issue.id) || {}), ...issue });
  });
  merged.issues = [...issuesById.values()].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return merged;
}

function renderCloudStatus() {
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
