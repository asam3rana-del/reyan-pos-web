// ================================================================
// inventoryInsights.js — port of InventoryInsightsActivity.kt's four tabs:
// Reorder Suggestions, Damage/Loss Report, Profit Margin per Item, and
// Fast/Slow Movers. One screen, one tab switcher, same as Android.
//
// Reorder and Margin read straight from the already-cached `products`
// array (data.js's live listener) — no query needed. Damage and Movers
// need a date-range query across ALL products, so those two go straight
// to Firestore (branch-scoped) the same way loadStockHistoryForProduct()
// does in data.js, rather than looping loadStockHistoryForProduct() once
// per product (which would be one query storm per product).
// ================================================================

import {
  products, lowStockProducts, aliveDocs
} from "./data.js";
import {
  db, collection, query, where, getDocs, branchId, smallestUnitFactor
} from "./firebase-init.js";

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let mode = "reorder"; // reorder | damage | profit | movers
let rangeStart = 0;
let rangeEnd = Date.now();

// ---------- Date range (same buckets as reports.js's setPnlRange) ----------
function setRange(period) {
  const now = new Date();
  if (period === "today") {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    rangeStart = start.getTime(); rangeEnd = now.getTime();
  } else if (period === "week") {
    const start = new Date(); start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    rangeStart = start.getTime(); rangeEnd = now.getTime();
  } else if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    rangeStart = start.getTime(); rangeEnd = now.getTime();
  } else {
    rangeStart = 0; rangeEnd = now.getTime();
  }
}

// ---------- Shared small renderers ----------
function summaryCard(label, value, colorClass) {
  const div = document.createElement("div");
  div.className = "stat-card " + colorClass;
  div.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${value}</div>`;
  return div;
}

function rowCard(title, subtitle, rightTop, rightTopStyle, rightBottom, onClick) {
  const div = document.createElement("div");
  div.className = "card row-between";
  if (onClick) div.style.cursor = "pointer";
  div.innerHTML = `
    <div>
      <div><b>${title}</b></div>
      <div class="muted">${subtitle}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:800; ${rightTopStyle || ""}">${rightTop}</div>
      <div class="muted">${rightBottom}</div>
    </div>
  `;
  if (onClick) div.addEventListener("click", onClick);
  return div;
}

function showEmpty(box, text) {
  box.innerHTML = `<p class="muted" style="text-align:center; padding:30px 0;">${text}</p>`;
}

// ---------- Reorder Suggestions ----------
function loadReorder(summaryBox, resultsBox) {
  const low = lowStockProducts()
    .filter(p => (p.reorderLevel || 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  summaryBox.appendChild(summaryCard("Items to reorder", low.length, "stat-red"));
  if (!low.length) { showEmpty(resultsBox, "Abhi kuch bhi reorder karne ki zaroorat nahi"); return; }

  low.forEach(p => {
    // Same rule of thumb as Android: top back up to double the reorder
    // level, so stock doesn't dip below it again immediately.
    const suggested = Math.max(p.reorderLevel * 2 - (p.stock || 0), p.reorderLevel - (p.stock || 0));
    resultsBox.appendChild(rowCard(
      p.name,
      `Current: ${p.stock || 0} ${p.unit} • Reorder level: ${p.reorderLevel} ${p.unit}`,
      `+${Math.round(suggested)} ${p.unit}`,
      "color:var(--amber-fg);",
      "suggested"
    ));
  });
}

// ---------- Damage / Loss Report ----------
const LOSS_REASONS = new Set(["Damage", "Expired", "Theft/Loss"]);

async function loadDamage(summaryBox, resultsBox) {
  const bId = branchId();
  const snap = await getDocs(query(collection(db(), "stock_adjustments"), where("branchId", "==", bId)));
  const entries = aliveDocs(snap).map(d => d.data())
    .filter(a => LOSS_REASONS.has(a.reason) && a.createdAt >= rangeStart && a.createdAt <= rangeEnd)
    .sort((a, b) => b.createdAt - a.createdAt);

  function lossValue(a) {
    const p = products.find(pr => pr.barcode === a.barcode);
    if (!p) return 0;
    const factor = smallestUnitFactor(p);
    const costPerSmallest = factor > 0 ? (p.cost || 0) / factor : (p.cost || 0);
    return Math.abs(a.deltaSmallest || 0) * costPerSmallest;
  }

  const totalLoss = entries.reduce((sum, a) => sum + lossValue(a), 0);
  summaryBox.appendChild(summaryCard("Total loss value", money(totalLoss), "stat-red"));
  summaryBox.appendChild(summaryCard("Entries logged", entries.length, "stat-amber"));

  if (!entries.length) { showEmpty(resultsBox, "Is period mein koi damage/loss darj nahi"); return; }
  entries.forEach(a => {
    const p = products.find(pr => pr.barcode === a.barcode);
    resultsBox.appendChild(rowCard(
      p ? p.name : a.product || a.barcode,
      `${a.reason}${a.note ? " • " + a.note : ""} • ${new Date(a.createdAt).toLocaleString("en-PK")}`,
      `-${Math.abs(a.qtyEntered || 0)} ${a.unit || ""}`,
      "color:var(--red);",
      money(lossValue(a))
    ));
  });
}

// ---------- Profit Margin per Item ----------
function marginPercent(p) {
  return p.salePrice > 0 ? ((p.salePrice - (p.cost || 0)) / p.salePrice) * 100 : 0;
}

function loadProfit(summaryBox, resultsBox) {
  const priced = products.filter(p => (p.salePrice || 0) > 0);
  const avgMargin = priced.length ? priced.reduce((s, p) => s + marginPercent(p), 0) / priced.length : 0;
  const lowMarginCount = priced.filter(p => marginPercent(p) < 10).length;

  summaryBox.appendChild(summaryCard("Average margin", avgMargin.toFixed(1) + "%", "stat-teal"));
  summaryBox.appendChild(summaryCard("Under 10% margin", lowMarginCount, "stat-red"));

  if (!priced.length) { showEmpty(resultsBox, "Abhi koi priced item nahi"); return; }

  // Worst margin first — most actionable ordering.
  priced.slice().sort((a, b) => marginPercent(a) - marginPercent(b)).forEach(p => {
    const margin = marginPercent(p);
    const color = margin < 10 ? "var(--red)" : margin < 25 ? "var(--amber-fg)" : "var(--teal-fg)";
    resultsBox.appendChild(rowCard(
      p.name,
      `Cost: ${money(p.cost)}   Sale: ${money(p.salePrice)}`,
      margin.toFixed(1) + "%",
      `color:${color};`,
      "margin"
    ));
  });
}

// ---------- Fast / Slow Movers ----------
async function loadMovers(summaryBox, resultsBox) {
  const bId = branchId();
  const snap = await getDocs(query(collection(db(), "sales"), where("branchId", "==", bId)));
  const sales = aliveDocs(snap).map(d => d.data())
    .filter(s => s.status !== "returned" && s.createdAt >= rangeStart && s.createdAt <= rangeEnd);

  const movement = new Map(); // barcode -> { qty, amount }
  sales.forEach(s => {
    (s.items || []).forEach(it => {
      const m = movement.get(it.barcode) || { qty: 0, amount: 0 };
      m.qty += it.qty || 0;
      m.amount += (it.qty || 0) * (it.unitPrice || 0);
      movement.set(it.barcode, m);
    });
  });

  const rows = products.map(p => {
    const m = movement.get(p.barcode) || { qty: 0, amount: 0 };
    return { name: p.name, unit: p.unit, qty: m.qty, amount: m.amount };
  });
  const totalUnitsSold = rows.reduce((s, r) => s + r.qty, 0);
  summaryBox.appendChild(summaryCard("Units sold this period", Math.round(totalUnitsSold), "stat-teal"));

  resultsBox.appendChild(sectionLabel("🔥 FAST MOVERS"));
  const fast = rows.slice().sort((a, b) => b.qty - a.qty).filter(r => r.qty > 0).slice(0, 15);
  if (!fast.length) resultsBox.appendChild(smallNote("Is period mein abhi koi sale nahi"));
  fast.forEach(r => {
    resultsBox.appendChild(rowCard(r.name, money(r.amount), Math.round(r.qty) + " " + r.unit, "color:var(--teal-fg);", "sold"));
  });

  resultsBox.appendChild(document.createElement("div")).style.height = "14px";
  resultsBox.appendChild(sectionLabel("❄️ SLOW MOVERS"));
  const slow = rows.slice().sort((a, b) => a.qty - b.qty).slice(0, 15);
  slow.forEach(r => {
    const subtitle = r.qty === 0 ? "Is period mein koi sale nahi" : money(r.amount);
    resultsBox.appendChild(rowCard(r.name, subtitle, Math.round(r.qty) + " " + r.unit, `color:${r.qty === 0 ? "var(--red)" : "var(--amber-fg)"};`, "sold"));
  });
}

function sectionLabel(text) {
  const div = document.createElement("div");
  div.className = "section-label";
  div.textContent = text;
  return div;
}
function smallNote(text) {
  const div = document.createElement("div");
  div.className = "muted";
  div.style.padding = "4px 4px 12px";
  div.textContent = text;
  return div;
}

// ---------- Mode / period switching ----------

const MODE_TITLES = {
  reorder: ["Reorder Suggestions", "Items at or below their reorder level"],
  damage: ["Damage / Loss Report", "Stock logged as damaged, expired or lost"],
  profit: ["Profit Margin per Item", "Sale price vs cost, item by item"],
  movers: ["Fast / Slow Movers", "Which items sell, and which sit on the shelf"]
};

async function loadData() {
  const summaryBox = el("invSummary");
  const resultsBox = el("invResults");
  summaryBox.innerHTML = "";
  resultsBox.innerHTML = "<p class='muted'>Loading…</p>";
  resultsBox.innerHTML = "";

  try {
    if (mode === "reorder") loadReorder(summaryBox, resultsBox);
    else if (mode === "damage") await loadDamage(summaryBox, resultsBox);
    else if (mode === "profit") loadProfit(summaryBox, resultsBox);
    else await loadMovers(summaryBox, resultsBox);
  } catch (e) {
    resultsBox.innerHTML = `<p class="muted">Error: ${e.message}</p>`;
  }
}

function onModeChanged() {
  const [title, subtitle] = MODE_TITLES[mode];
  el("invSubtitle").textContent = subtitle;
  document.querySelectorAll("#screen-inventoryInsights .party-tabs .nav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  el("invPeriodRow").classList.toggle("hidden", mode !== "damage" && mode !== "movers");
  document.querySelector('#screen-inventoryInsights h1').textContent = "📊 " + title;
  loadData();
}

export function initInventoryInsightsScreen() {
  document.querySelectorAll("#screen-inventoryInsights .party-tabs .nav-btn").forEach(btn => {
    btn.addEventListener("click", () => { mode = btn.dataset.mode; onModeChanged(); });
  });
  document.querySelectorAll("#invPeriodRow .report-filter-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#invPeriodRow .report-filter-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      setRange(btn.dataset.period);
      loadData();
    });
  });
  setRange("month");
}

/** Called by app.js whenever the Inventory Insights nav button is pressed. */
export function refreshInventoryInsightsScreen() {
  onModeChanged();
}
