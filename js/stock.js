// ================================================================
// stock.js — the Stock screen's 3 tabs: Report (unchanged, moved here from
// reports.js), Adjust (single ad-hoc correction — Damage/Expired/Theft/
// Correction/Other, mirrors the Android app's Stock Adjustment feature) and
// Take (bulk physical-count reconciliation across many products at once).
// See data.js's saveStockAdjustment()/saveStockTake() for the backend half.
// ================================================================

import { products, lowStockProducts, saveStockAdjustment, saveStockTake, loadRecentStockAdjustments } from "./data.js";
import { unitNames, toSmallestUnits } from "./firebase-init.js";
import { showToast } from "./ui.js";

function el(id) { return document.getElementById(id); }

let currentStockTab = "report";

export function initStockScreens() {
  el("lowStockOnly").addEventListener("change", renderStockReport);

  el("tabStockReport").addEventListener("click", () => switchStockTab("report"));
  el("tabStockAdjust").addEventListener("click", () => switchStockTab("adjust"));
  el("tabStockTake").addEventListener("click", () => switchStockTab("take"));

  initAdjustTab();
  initTakeTab();
}

/** Called by app.js whenever the Stock nav button is pressed — re-renders
 *  whichever sub-tab is currently active, same pattern as Reports' P&L /
 *  Balance Sheet tabs. */
export function renderStockScreen() {
  switchStockTab(currentStockTab);
}

function switchStockTab(tab) {
  currentStockTab = tab;
  el("tabStockReport").classList.toggle("active", tab === "report");
  el("tabStockAdjust").classList.toggle("active", tab === "adjust");
  el("tabStockTake").classList.toggle("active", tab === "take");
  el("stockReportTab").classList.toggle("hidden", tab !== "report");
  el("stockAdjustTab").classList.toggle("hidden", tab !== "adjust");
  el("stockTakeTab").classList.toggle("hidden", tab !== "take");

  if (tab === "report") renderStockReport();
  if (tab === "adjust") renderAdjustHistory();
  if (tab === "take") renderTakeTable();
}

// ---------- Report tab (identical logic to the old reports.js renderStock()) ----------
function renderStockReport() {
  const box = el("stockList");
  if (!box) return;
  const onlyLow = el("lowStockOnly").checked;
  const list = onlyLow ? lowStockProducts() : products;
  box.innerHTML = "";
  if (!list.length) { box.innerHTML = "<p class='muted'>Koi item nahi mila.</p>"; return; }
  list
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(p => {
      const low = (p.stock || 0) <= (p.reorderLevel || 0);
      const div = document.createElement("div");
      div.className = "card row-between";
      div.innerHTML = `
        <div>
          <div><b>${p.name}</b></div>
          <div class="muted">${p.category || ""}</div>
        </div>
        <div style="text-align:right">
          <div style="color:${low ? "var(--red)" : "var(--text-dark)"}; font-weight:800;">${p.stock} ${p.unit}</div>
          <div class="muted">reorder at ${p.reorderLevel}</div>
        </div>
      `;
      box.appendChild(div);
    });
}

// ================================================================
// Adjust tab — single ad-hoc correction. Product picker mirrors Sale's
// itemSearch/itemSuggestions pattern (sale.js) exactly, and qty+unit reuses
// the same toSmallestUnits()/unitNames() unit-ladder helpers Sale/Purchase
// already use, so a multi-tier (carton/box/pcs) product adjusts correctly.
// ================================================================

let adjustSelectedProduct = null;
let adjustDirection = "add"; // "add" | "remove"

function renderAdjustSuggestions(matches) {
  const box = el("adjustSuggestions");
  if (!matches.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.innerHTML = "";
  matches.slice(0, 8).forEach(p => {
    const d = document.createElement("div");
    d.textContent = `${p.name} — stock ${p.stock} ${p.unit}`;
    d.addEventListener("click", () => selectAdjustProduct(p));
    box.appendChild(d);
  });
  box.classList.remove("hidden");
}

function selectAdjustProduct(p) {
  adjustSelectedProduct = p;
  el("adjustSearch").value = p.name;
  el("adjustSuggestions").classList.add("hidden");

  const unitSel = el("adjustUnit");
  unitSel.innerHTML = "";
  unitNames(p).forEach(u => {
    const opt = document.createElement("option");
    opt.value = u; opt.textContent = u;
    unitSel.appendChild(opt);
  });
  el("adjustCurrentStock").textContent = `Current stock: ${p.stock} ${p.unit}`;
}

function setAdjustDirection(dir) {
  adjustDirection = dir;
  el("btnAdjustAdd").classList.toggle("active", dir === "add");
  el("btnAdjustRemove").classList.toggle("active", dir === "remove");
}

function resetAdjustForm() {
  adjustSelectedProduct = null;
  el("adjustSearch").value = "";
  el("adjustQty").value = "";
  el("adjustUnit").innerHTML = "";
  el("adjustNote").value = "";
  el("adjustCurrentStock").textContent = "";
  setAdjustDirection("add");
}

function initAdjustTab() {
  setAdjustDirection("add");

  el("adjustSearch").addEventListener("input", () => {
    const q = el("adjustSearch").value.trim().toLowerCase();
    if (!q) { el("adjustSuggestions").classList.add("hidden"); return; }
    renderAdjustSuggestions(products.filter(p => p.name.toLowerCase().includes(q)));
  });

  el("btnAdjustAdd").addEventListener("click", () => setAdjustDirection("add"));
  el("btnAdjustRemove").addEventListener("click", () => setAdjustDirection("remove"));

  el("btnSaveAdjustment").addEventListener("click", async () => {
    if (!adjustSelectedProduct) { showToast("Pehle item select karein"); return; }
    const qty = parseFloat(el("adjustQty").value) || 0;
    if (qty <= 0) { showToast("Quantity 0 se zyada honi chahiye"); return; }
    const unit = el("adjustUnit").value;
    const reason = el("adjustReason").value;
    const note = el("adjustNote").value.trim();

    const smallest = toSmallestUnits(adjustSelectedProduct, qty, unit);
    if (adjustDirection === "remove" && smallest > (adjustSelectedProduct.stock || 0)) {
      showToast(`Sirf ${adjustSelectedProduct.stock} ${adjustSelectedProduct.unit} stock mein hai`);
      return;
    }
    const delta = adjustDirection === "add" ? smallest : -smallest;

    try {
      await saveStockAdjustment({
        barcode: adjustSelectedProduct.barcode, product: adjustSelectedProduct.name,
        deltaSmallest: delta, qtyEntered: qty, unit, reason, note, type: "adjustment"
      });
      showToast("Stock adjust ho gaya");
      resetAdjustForm();
      renderAdjustHistory();
    } catch (e) {
      showToast("Error: " + e.message);
    }
  });
}

async function renderAdjustHistory() {
  const box = el("stockAdjustList");
  if (!box) return;
  box.innerHTML = "<p class='muted'>Loading…</p>";
  const list = await loadRecentStockAdjustments(30);
  if (!list.length) { box.innerHTML = "<p class='muted'>Koi adjustment nahi hui abhi tak.</p>"; return; }
  box.innerHTML = "";
  list.forEach(a => {
    const positive = (a.deltaSmallest || 0) >= 0;
    const div = document.createElement("div");
    div.className = "card row-between";
    div.innerHTML = `
      <div>
        <div><b>${a.product}</b></div>
        <div class="muted">${a.reason || ""}${a.note ? " · " + a.note : ""} · ${new Date(a.createdAt).toLocaleString()}</div>
      </div>
      <div style="text-align:right; color:${positive ? "var(--teal-fg)" : "var(--red)"}; font-weight:800;">
        ${positive ? "+" : ""}${(a.deltaSmallest || 0).toLocaleString("en-PK")}
      </div>
    `;
    box.appendChild(div);
  });
}

// ================================================================
// Take tab — bulk physical-count reconciliation. Counted quantities are
// entered directly in each product's SMALLEST unit (same basis `stock` is
// already stored/displayed in on the Report tab), so a table listing many
// products never needs a per-row unit dropdown — only rows the user actually
// edits get saved, everything else is left untouched.
// ================================================================

let takeCounted = new Map(); // barcode -> counted value (smallest units), only for edited rows

function renderTakeTable() {
  const box = el("stockTakeList");
  if (!box) return;
  const q = (el("stockTakeSearch").value || "").trim().toLowerCase();
  const list = products
    .filter(p => !q || p.name.toLowerCase().includes(q))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  box.innerHTML = "";
  if (!list.length) { box.innerHTML = "<p class='muted'>Koi item nahi mila.</p>"; return; }
  list.forEach(p => {
    const finestUnit = unitNames(p)[0];
    const counted = takeCounted.has(p.barcode) ? takeCounted.get(p.barcode) : (p.stock || 0);
    const row = document.createElement("div");
    row.className = "card row-between";
    row.innerHTML = `
      <div>
        <div><b>${p.name}</b></div>
        <div class="muted">System: ${p.stock || 0} ${finestUnit}</div>
      </div>
      <input type="number" step="any" class="stocktake-input" data-barcode="${p.barcode}" value="${counted}" style="width:90px; text-align:right;" />
    `;
    const input = row.querySelector(".stocktake-input");
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      if (isNaN(v)) takeCounted.delete(p.barcode);
      else takeCounted.set(p.barcode, v);
      updateTakeSummary();
    });
    box.appendChild(row);
  });
  updateTakeSummary();
}

function pendingTakeEntries() {
  const entries = [];
  products.forEach(p => {
    if (!takeCounted.has(p.barcode)) return;
    const counted = takeCounted.get(p.barcode);
    const delta = counted - (p.stock || 0);
    if (delta === 0) return;
    entries.push({ barcode: p.barcode, product: p.name, deltaSmallest: delta, countedSmallest: counted });
  });
  return entries;
}

function updateTakeSummary() {
  const summary = el("stockTakeSummary");
  const btn = el("btnSaveStockTake");
  if (!summary || !btn) return;
  const changed = pendingTakeEntries().length;
  summary.textContent = changed ? `${changed} item(s) mein farq hai` : "Koi farq nahi";
  btn.disabled = changed === 0;
}

function initTakeTab() {
  el("stockTakeSearch").addEventListener("input", renderTakeTable);

  el("btnSaveStockTake").addEventListener("click", async () => {
    const entries = pendingTakeEntries();
    if (!entries.length) { showToast("Koi farq nahi mila"); return; }
    if (!confirm(`${entries.length} item(s) ka stock update karna hai?`)) return;

    el("btnSaveStockTake").disabled = true;
    try {
      await saveStockTake(entries);
      showToast("Stock take save ho gayi");
      takeCounted = new Map();
      renderTakeTable();
    } catch (e) {
      showToast("Error: " + e.message);
      updateTakeSummary();
    }
  });
}
