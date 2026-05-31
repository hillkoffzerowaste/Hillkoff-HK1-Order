import Peer from "peerjs";
import QRCode from "qrcode";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

const STORAGE_KEY = "hk1-host-store-v1";
const HOST_PREFIX = "hk1";
const WAIT_MINUTES = { 250: 1, 500: 2, 1000: 4 };

const defaultStore = {
  products: [
    { name: "Hillkoff Espresso Blend", size: 500 },
    { name: "Hillkoff Classic Blend", size: 500 },
    { name: "Hillkoff Arabica 100%", size: 250 },
  ],
  orders: [],
};

const state = {
  view: "host",
  store: loadStore(),
  hostPeer: null,
  cashierPeer: null,
  hostConn: null,
  clientConns: new Map(),
  scanner: null,
  scannerMode: null,
  audioCtx: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

boot();

function boot() {
  bindViews();
  bindSectionTabs();
  bindHost();
  bindCashier();
  bindReport();
  renderAll();
  startHost();
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

function bindHost() {
  $("#copy-host-id").addEventListener("click", async () => {
    await navigator.clipboard?.writeText($("#host-peer-id").value);
    toast("คัดลอก Host ID แล้ว");
  });
  $("#host-unlock-audio").addEventListener("click", unlockAudio);
}

function bindCashier() {
  $("#cashier-unlock-audio").addEventListener("click", unlockAudio);
  $("#scan-host-qr").addEventListener("click", () => openScanner("host-qr"));
  $("#connect-host").addEventListener("click", () => connectToHost($("#manual-host-id").value.trim()));
  $("#product-name").addEventListener("input", syncProductFromName);
  $("#product-name").addEventListener("change", syncProductFromName);
  bindGrindInput();
  $("#send-order").addEventListener("click", sendOrder);
  $("#close-scanner").addEventListener("click", closeScanner);
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

function startHost() {
  const preferredId = `${HOST_PREFIX}-${randomId()}`;
  state.hostPeer = new Peer(preferredId, { debug: 1 });

  state.hostPeer.on("open", (id) => {
    $("#host-status").textContent = "พร้อมเชื่อมต่อ";
    $("#host-peer-id").value = id;
    QRCode.toCanvas($("#host-qr"), `HK1_HOST:${id}`, {
      width: 220,
      margin: 1,
      color: { dark: "#3a241a", light: "#fff8ee" },
    });
  });

  state.hostPeer.on("connection", (conn) => {
    state.clientConns.set(conn.peer, conn);
    updateConnectionUi();
    conn.on("open", () => sendSnapshot(conn));
    conn.on("data", (message) => handleHostMessage(message, conn));
    conn.on("close", () => {
      state.clientConns.delete(conn.peer);
      updateConnectionUi();
    });
  });

  state.hostPeer.on("error", (error) => {
    $("#host-status").textContent = "Host มีปัญหา";
    toast(error.message || "สร้าง Host ไม่สำเร็จ");
  });
}

function connectToHost(peerId) {
  if (!peerId) return toast("กรุณากรอก Host ID");
  if (state.cashierPeer) state.cashierPeer.destroy();

  $("#cashier-status").textContent = "กำลังเชื่อมต่อ...";
  state.cashierPeer = new Peer(undefined, { debug: 1 });
  state.cashierPeer.on("open", () => {
    state.hostConn = state.cashierPeer.connect(peerId, { reliable: true });
    state.hostConn.on("open", () => {
      $("#cashier-status").textContent = "เชื่อมต่อแล้ว";
      toast("เชื่อมต่อเครื่องแม่แล้ว");
      state.hostConn.send({ type: "hello" });
    });
    state.hostConn.on("data", handleCashierMessage);
    state.hostConn.on("close", () => {
      $("#cashier-status").textContent = "หลุดการเชื่อมต่อ";
    });
  });
  state.cashierPeer.on("error", (error) => {
    $("#cashier-status").textContent = "เชื่อมต่อไม่สำเร็จ";
    toast(error.message || "เชื่อมต่อเครื่องแม่ไม่สำเร็จ");
  });
}

function handleHostMessage(message, conn) {
  if (message?.type === "order") {
    const order = {
      id: crypto.randomUUID(),
      queue: nextQueue(),
      status: "waiting",
      createdAt: Date.now(),
      ...message.order,
    };
    rememberProduct(order.name, order.size);
    state.store.orders.unshift(order);
    saveStore();
    ringBell();
    broadcastSnapshot();
    renderAll();
  }

  if (message?.type === "hello") sendSnapshot(conn);
}

function handleCashierMessage(message) {
  if (message?.type !== "snapshot") return;
  state.store = migrateStore(message.store);
  renderAll();
}

function sendOrder() {
  const name = $("#product-name").value.trim();
  const size = Number($("#bag-size").value);
  const qty = Math.max(1, Number($("#qty").value || 1));
  const grind = selectedGrind();
  const customer = $("#customer").value.trim();

  if (!state.hostConn?.open) return toast("ยังไม่ได้เชื่อมต่อเครื่องแม่");
  if (!name) return toast("กรุณากรอกชื่อสินค้า");
  if (!grind) return toast("กรุณาเลือกหรือกรอกเบอร์บด");

  rememberProduct(name, size);
  saveStore();

  state.hostConn.send({
    type: "order",
    order: { name, size, qty, grind, customer },
  });

  $("#product-name").value = "";
  $("#customer").value = "";
  $("#qty").value = 1;
  renderCashier();
  toast("ส่งออเดอร์แล้ว");
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
  broadcastSnapshot();
  renderAll();
}

async function openScanner(mode) {
  state.scannerMode = mode;
  $("#scanner-title").textContent = "สแกน QR เครื่องแม่";
  $("#scanner-dialog").showModal();

  state.scanner = new Html5Qrcode("reader", {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.UPC_A,
    ],
  });

  try {
    await state.scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 180 } },
      (decodedText) => handleScan(decodedText),
    );
  } catch (error) {
    toast(error.message || "เปิดกล้องไม่สำเร็จ");
  }
}

async function closeScanner() {
  if (state.scanner?.isScanning) await state.scanner.stop();
  state.scanner?.clear();
  state.scanner = null;
  $("#scanner-dialog").close();
}

async function handleScan(text) {
  await closeScanner();
  const value = text.replace("HK1_HOST:", "").trim();
  if (state.scannerMode === "host-qr") {
    $("#manual-host-id").value = value;
    connectToHost(value);
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
    done: state.store.orders.filter((order) => order.status === "done").slice(0, 20),
  };

  $("#waiting-list").innerHTML = groups.waiting.map(orderCard).join("") || empty("ยังไม่มีออเดอร์ใหม่");
  $("#grinding-list").innerHTML = groups.grinding.map(orderCard).join("") || empty("ยังไม่มีงานกำลังบด");
  $("#done-list").innerHTML = groups.done.map(orderCard).join("") || empty("ยังไม่มีออเดอร์เสร็จ");

  $("#count-waiting").textContent = groups.waiting.length;
  $("#count-grinding").textContent = groups.grinding.length;
  $("#count-done").textContent = state.store.orders.filter((order) => order.status === "done").length;
  $("#host-wait").textContent = `${totalWait()} นาที`;

  $$(".order-action").forEach((button) => {
    button.addEventListener("click", () => setOrderStatus(button.dataset.id, button.dataset.status));
  });
  updateConnectionUi();
}

function renderCashier() {
  renderProductSuggestions();
  $("#product-count").textContent = state.store.products.length;
  $("#cashier-wait").textContent = `${totalWait()} นาที`;
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

function sendSnapshot(conn) {
  if (conn?.open) conn.send({ type: "snapshot", store: state.store });
}

function broadcastSnapshot() {
  state.clientConns.forEach(sendSnapshot);
}

function updateConnectionUi() {
  $("#peer-count").textContent = state.clientConns.size;
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

function loadStore() {
  try {
    return migrateStore(JSON.parse(localStorage.getItem(STORAGE_KEY)) || structuredClone(defaultStore));
  } catch {
    return migrateStore(structuredClone(defaultStore));
  }
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.store));
}

function migrateStore(store) {
  const migrated = {
    ...structuredClone(defaultStore),
    ...(store || {}),
  };
  migrated.products = (migrated.products || [])
    .filter((product) => product?.name)
    .map((product) => ({
      name: product.name,
      size: Number(product.size || 500),
    }));
  migrated.orders = migrated.orders || [];
  return migrated;
}

function unlockAudio() {
  state.audioCtx = state.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  state.audioCtx.resume();
  beep(true);
  toast("เปิดระบบเสียงแล้ว");
}

function ringBell() {
  if (!state.audioCtx) return;
  playTone(784, 0.14, 0);
  playTone(988, 0.22, 0.12);
}

function beep(success) {
  if (!state.audioCtx) return;
  playTone(success ? 1046 : 220, 0.16, 0);
}

function playTone(freq, duration, delay) {
  const now = state.audioCtx.currentTime + delay;
  const osc = state.audioCtx.createOscillator();
  const gain = state.audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain);
  gain.connect(state.audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.03);
}

function randomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
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
