// ================================================================
// rateComparison.js — port of RateComparisonActivity.kt. Pick an item, see
// its purchase history grouped by supplier: last rate, lowest, highest, and
// how many times it's been bought — so the next purchase can go to whoever
// gave the best rate. Rates are normalized to the product's PRIMARY unit
// (same toPrimaryUnitRate idea Android uses) so a purchase entered in
// "Ctn" and another in "pcs" still compare fairly.
// ================================================================

import { products, suppliers, loadPurchaseHistory } from "./data.js";
import { unitLadder, smallestUnitFactor } from "./firebase-init.js";

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let cachedPurchases = null; // invalidated on every screen entry, see refresh() below
let selectedProduct = null;

function normalizedRate(product, rate, fromUnit) {
  const ladder = unitLadder(product);
  const tier = ladder.find(t => (t.unit || "").trim().toLowerCase() === (fromUnit || "").trim().toLowerCase())
    || ladder[ladder.length - 1];
  const ratePerSmallest = tier.smallestPerUnit > 0 ? rate / tier.smallestPerUnit : rate;
  return ratePerSmallest * smallestUnitFactor(product);
}

// ---------- Product picker ----------
function renderSuggestions(matches) {
  const box = el("rateCompareSuggestions");
  if (!matches.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.innerHTML = "";
  matches.slice(0, 8).forEach(p => {
    const d = document.createElement("div");
    d.textContent = p.name;
    d.addEventListener("click", () => selectProduct(p));
    box.appendChild(d);
  });
  box.classList.remove("hidden");
}

async function selectProduct(product) {
  selectedProduct = product;
  el("rateCompareSuggestions").classList.add("hidden");
  el("rateComparePicker").classList.add("hidden");
  el("rateCompareResult").classList.remove("hidden");
  el("rateCompareProductName").textContent = "📦 " + product.name;
  el("rateCompareSubtext").textContent = `Rates per ${product.unit} (kisi bhi unit se convert karke)`;
  el("rateCompareList").innerHTML = "<p class='muted'>Loading purchase history…</p>";

  try {
    if (!cachedPurchases) cachedPurchases = await loadPurchaseHistory();
    renderComparison(computeRows(product));
  } catch (e) {
    el("rateCompareList").innerHTML = `<p class="muted">Error: ${e.message}</p>`;
  }
}

// ---------- Comparison math ----------
function computeRows(product) {
  const bySupplier = new Map(); // supplierServerId -> [{rate, createdAt}]

  cachedPurchases.forEach(purchase => {
    if (!purchase.supplierServerId) return;
    (purchase.items || []).forEach(it => {
      if (it.barcode !== product.barcode) return;
      const rate = normalizedRate(product, it.unitCost, it.unit || product.unit);
      const bucket = bySupplier.get(purchase.supplierServerId) || [];
      bucket.push({ rate, createdAt: purchase.createdAt });
      bySupplier.set(purchase.supplierServerId, bucket);
    });
  });

  const rows = [];
  bySupplier.forEach((entries, supplierId) => {
    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) return; // supplier was deleted since
    const mostRecent = entries.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    rows.push({
      supplierName: supplier.name,
      lastRate: mostRecent.rate,
      lastDate: mostRecent.createdAt,
      minRate: Math.min(...entries.map(e => e.rate)),
      maxRate: Math.max(...entries.map(e => e.rate)),
      timesPurchased: entries.length
    });
  });

  return rows.sort((a, b) => a.lastRate - b.lastRate); // best (lowest) first
}

// ---------- Rendering ----------
function renderComparison(rows) {
  const box = el("rateCompareList");
  box.innerHTML = "";

  if (!rows.length) {
    box.innerHTML = "<p class='muted' style='text-align:center; padding:30px 0;'>Is item ki koi purchase history kisi supplier se nahi mili.</p>";
    return;
  }

  rows.forEach((r, i) => {
    const isBest = i === 0 && rows.length > 1;
    const div = document.createElement("div");
    div.className = "rate-row" + (isBest ? " is-best" : "");
    div.innerHTML = `
      <div class="row-between">
        <div>
          <div><b>${r.supplierName}</b>${isBest ? '<span class="rate-badge badge-navy">BEST</span>' : ""}</div>
          <div class="muted">${r.timesPurchased} purchase${r.timesPurchased > 1 ? "s" : ""} • last: ${new Date(r.lastDate).toLocaleDateString("en-PK")}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:800;">${money(r.lastRate)}</div>
          <div class="muted">range ${money(r.minRate)} – ${money(r.maxRate)}</div>
        </div>
      </div>
    `;
    box.appendChild(div);
  });
}

function backToPicker() {
  selectedProduct = null;
  el("rateCompareResult").classList.add("hidden");
  el("rateComparePicker").classList.remove("hidden");
  el("rateCompareSearch").value = "";
  el("rateCompareSearch").focus();
}

export function initRateComparisonScreen() {
  el("rateCompareSearch").addEventListener("input", () => {
    const q = el("rateCompareSearch").value.trim().toLowerCase();
    if (!q) { el("rateCompareSuggestions").classList.add("hidden"); return; }
    renderSuggestions(products.filter(p => p.name.toLowerCase().includes(q)));
  });
  el("btnRateCompareChange").addEventListener("click", backToPicker);
}

/** Called by app.js whenever the Rate Comparison nav button is pressed —
 *  drops the purchase-history cache so a bill entered moments ago (this tab
 *  or another) is reflected next time an item is picked. */
export function refreshRateComparisonScreen() {
  cachedPurchases = null;
  if (!selectedProduct) {
    el("rateComparePicker").classList.remove("hidden");
    el("rateCompareResult").classList.add("hidden");
  }
}
