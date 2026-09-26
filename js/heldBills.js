// ================================================================
// heldBills.js — Hold/Recall Bill, for both Sale and Purchase.
//
// DELIBERATELY kept OUT of Firestore/data.js: per an earlier design
// decision, a held/parked bill should behave exactly like Android's local
// Room `held_bills` table — PER-DEVICE only. A bill parked on one phone or
// browser must never appear, or be recallable, on any other device or
// branch member's screen (unlike the Audit Log — see auditLog.js — which
// is the opposite, deliberately COMBINED across every device). Plain
// localStorage is enough; nothing here ever touches Firestore.
// ================================================================

import { showModal, closeModal } from "./ui.js";

const LS_KEYS = { sale: "held_sales", purchase: "held_purchases" };

function load(kind) {
  try { return JSON.parse(localStorage.getItem(LS_KEYS[kind]) || "[]"); }
  catch { return []; }
}

function save(kind, list) {
  localStorage.setItem(LS_KEYS[kind], JSON.stringify(list));
}

export function heldCount(kind) {
  return load(kind).length;
}

/** state: whatever shape the caller (sale.js/purchase.js) wants back on recall. */
export function holdBill(kind, label, state) {
  const list = load(kind);
  list.unshift({
    id: "hold_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    label, state, heldAt: Date.now()
  });
  save(kind, list);
}

export function deleteHeldBill(kind, id) {
  save(kind, load(kind).filter(h => h.id !== id));
}

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Shows the recall list in the shared modal (ui.js). onRecall(state) fires
 *  when the user taps Recall — this file doesn't know how to rebuild a
 *  Sale/Purchase form itself, the caller does. */
export function showRecallModal(kind, title, onRecall) {
  const list = load(kind);
  const body = list.length
    ? list.map(h => `
        <div class="card row-between" style="align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <div><b>${h.label}</b></div>
            <div class="muted">${new Date(h.heldAt).toLocaleString("en-PK")} · ${(h.state.cart || []).length} item(s) · ${money(h.state.total || 0)}</div>
          </div>
          <div class="button-row" style="margin-top:0;">
            <button class="btn-primary" data-recall="${h.id}">RECALL</button>
            <button class="btn-secondary" data-del="${h.id}">DELETE</button>
          </div>
        </div>`).join("")
    : "<p class='muted'>Koi held bill nahi.</p>";

  const box = showModal(title, body);
  box.querySelectorAll("[data-recall]").forEach(btn => {
    btn.addEventListener("click", () => {
      const held = load(kind).find(h => h.id === btn.dataset.recall);
      if (!held) return;
      deleteHeldBill(kind, held.id);
      closeModal();
      onRecall(held.state);
    });
  });
  box.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!confirm("Yeh held bill delete kar dein?")) return;
      deleteHeldBill(kind, btn.dataset.del);
      showRecallModal(kind, title, onRecall); // re-render in place
    });
  });
}
