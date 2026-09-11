// ================================================================
// purchaseHistory.js — the README's "❌ Purchase edit/history" gap.
//
// Lists every purchase bill for the branch (search by bill no / supplier),
// and lets a user Edit (hands off to purchase.js's enterPurchaseEditMode()),
// re-Print, or Delete a bill. Delete/Edit both go through data.js's
// deletePurchaseBill()/updatePurchaseBill(), which handle reversing the
// bill's stock/cost/supplier-balance effects — this file only renders the
// list and wires the buttons.
// ================================================================

import { loadPurchaseHistory, deletePurchaseBill, suppliers } from "./data.js";
import { printPurchaseReceipt } from "./print.js";
import { showToast } from "./ui.js";

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let cachedHistory = [];
let onEditCallback = null;

function supplierNameFor(purchase) {
  if (!purchase.supplierServerId) return "—";
  const s = suppliers.find(sup => sup.id === purchase.supplierServerId);
  return s ? s.name : "—";
}

function matchesSearch(purchase, q, sName) {
  if (!q) return true;
  return purchase.billNo.toLowerCase().includes(q) || sName.toLowerCase().includes(q);
}

// `onEdit(purchase, supplierName)` is provided by app.js so this file doesn't
// need to know how to switch screens — see app.js's initPurchaseHistoryScreen() call.
export function initPurchaseHistoryScreen({ onEdit }) {
  onEditCallback = onEdit;
  el("purchaseHistorySearch").addEventListener("input", renderFilteredList);
}

export async function renderPurchaseHistory() {
  const box = el("purchaseHistoryList");
  box.innerHTML = "Loading…";
  cachedHistory = await loadPurchaseHistory();
  renderFilteredList();
}

function renderFilteredList() {
  const box = el("purchaseHistoryList");
  const q = (el("purchaseHistorySearch").value || "").trim().toLowerCase();
  const list = cachedHistory.filter(p => matchesSearch(p, q, supplierNameFor(p)));

  box.innerHTML = "";
  if (!list.length) { box.innerHTML = "<p class='muted'>Koi purchase nahi mila.</p>"; return; }

  list.forEach(p => {
    const due = (p.total || 0) - (p.paid || 0);
    const sName = supplierNameFor(p);
    const div = document.createElement("div");
    div.className = "card row-between";
    div.innerHTML = `
      <div>
        <div><b>${p.billNo}</b> — ${sName}</div>
        <div class="muted">${new Date(p.createdAt).toLocaleString("en-PK")} · ${p.itemCount || (p.items || []).length} items</div>
      </div>
      <div style="text-align:right">
        <div><b>${money(p.total)}</b></div>
        ${due > 0 ? `<div class="muted">Due: ${money(due)}</div>` : ""}
        <div class="history-actions">
          <span class="party-edit" data-action="edit">✎ Edit</span>
          <span class="daybook-print" data-action="print">🖨 Print</span>
          <span class="party-delete" data-action="delete">✕ Delete</span>
        </div>
      </div>
    `;
    div.querySelector('[data-action="edit"]').addEventListener("click", () => {
      onEditCallback && onEditCallback(p, sName);
    });
    div.querySelector('[data-action="print"]').addEventListener("click", () => {
      printPurchaseReceipt(p, sName);
    });
    div.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm(`Purchase ${p.billNo} delete karein? Stock aur supplier balance reverse ho jayega.`)) return;
      try {
        await deletePurchaseBill(p.billNo);
        showToast("Purchase delete ho gaya");
        renderPurchaseHistory();
      } catch (e) {
        showToast("Delete nahi ho saka: " + e.message);
      }
    });
    box.appendChild(div);
  });
}
