// ================================================================
// saleHistory.js — mirrors SaleHistoryActivity.kt. Unlike Purchase History,
// the Android Sale History screen only offers Return + Delete (no Edit) —
// see SaleHistoryActivity.kt's confirmReturn()/confirmDelete(), there's no
// edit entry point at all — so this screen follows the same two-action shape.
// ================================================================

import { loadSaleHistory, returnSaleBill, deleteSaleBill, customers } from "./data.js";
import { printSaleReceipt } from "./print.js";
import { showToast } from "./ui.js";

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let cachedHistory = [];

function customerNameFor(sale) {
  if (!sale.customerServerId) return "Walk-in";
  const c = customers.find(cu => cu.id === sale.customerServerId);
  return c ? c.name : "Walk-in";
}

function matchesSearch(sale, q, cName) {
  if (!q) return true;
  return sale.invoice.toLowerCase().includes(q) || cName.toLowerCase().includes(q);
}

export function initSaleHistoryScreen() {
  el("saleHistorySearch").addEventListener("input", renderFilteredList);
}

export async function renderSaleHistory() {
  const box = el("saleHistoryList");
  box.innerHTML = "Loading…";
  cachedHistory = await loadSaleHistory();
  renderFilteredList();
}

function renderFilteredList() {
  const box = el("saleHistoryList");
  const q = (el("saleHistorySearch").value || "").trim().toLowerCase();
  const list = cachedHistory.filter(s => matchesSearch(s, q, customerNameFor(s)));

  box.innerHTML = "";
  if (!list.length) { box.innerHTML = "<p class='muted'>Koi sale nahi mili.</p>"; return; }

  list.forEach(s => {
    const due = (s.total || 0) - (s.paid || 0);
    const cName = customerNameFor(s);
    const returned = s.status === "returned";
    const div = document.createElement("div");
    div.className = "card row-between";
    div.innerHTML = `
      <div>
        <div><b>${s.invoice}</b> — ${cName} ${returned ? '<span class="muted">(Returned)</span>' : ""}</div>
        <div class="muted">${new Date(s.createdAt).toLocaleString("en-PK")} · ${s.itemCount || (s.items || []).length} items</div>
      </div>
      <div style="text-align:right">
        <div><b>${money(s.total)}</b></div>
        ${due > 0 && !returned ? `<div class="muted">Due: ${money(due)}</div>` : ""}
        <div class="history-actions">
          <span class="daybook-print" data-action="print">🖨 Print</span>
          ${returned ? "" : '<span class="party-edit" data-action="return">↩ Return</span>'}
          <span class="party-delete" data-action="delete">✕ Delete</span>
        </div>
      </div>
    `;
    div.querySelector('[data-action="print"]').addEventListener("click", () => {
      printSaleReceipt(s, cName);
    });
    const returnBtn = div.querySelector('[data-action="return"]');
    if (returnBtn) {
      returnBtn.addEventListener("click", async () => {
        if (!confirm(`Sale ${s.invoice} return karein? Stock wapas add ho jayega aur customer ka outstanding balance reverse ho jayega.`)) return;
        try {
          await returnSaleBill(s.invoice);
          showToast("Sale return ho gayi");
          renderSaleHistory();
        } catch (e) {
          showToast("Return nahi ho saka: " + e.message);
        }
      });
    }
    div.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm(`Sale ${s.invoice} delete karein? Stock aur customer balance reverse ho jayega. Ye undo nahi ho sakta.`)) return;
      try {
        await deleteSaleBill(s.invoice);
        showToast("Sale delete ho gayi");
        renderSaleHistory();
      } catch (e) {
        showToast("Delete nahi ho saka: " + e.message);
      }
    });
    box.appendChild(div);
  });
}
