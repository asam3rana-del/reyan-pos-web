// ================================================================
// auditLog.js — Audit Log screen. Reads the `audit_log` Firestore
// collection (see data.js's logAudit()/loadAuditLog()) — COMBINED across
// every device/branch-member, per the earlier design decision that this
// (unlike Held Bills — see heldBills.js, deliberately per-device) should
// show one shared trail everyone on the branch can see, same "Sync History"
// spirit as the Android app but for real business actions rather than sync
// conflicts. ================================================================

import { loadAuditLog } from "./data.js";

function el(id) { return document.getElementById(id); }

const ACTION_LABELS = {
  SALE: { label: "Sale", color: "var(--positive, #1a7f37)" },
  SALE_DELETE: { label: "Sale Deleted", color: "var(--negative, #c62828)" },
  SALE_RETURN: { label: "Sale Returned", color: "var(--amber, #b26a00)" },
  PURCHASE: { label: "Purchase", color: "var(--navy, #1e3a5f)" },
  PURCHASE_EDIT: { label: "Purchase Edited", color: "var(--amber, #b26a00)" },
  PURCHASE_DELETE: { label: "Purchase Deleted", color: "var(--negative, #c62828)" },
  PAYMENT: { label: "Payment", color: "var(--positive, #1a7f37)" },
  PARTY_CREATE: { label: "Party Added", color: "var(--navy, #1e3a5f)" },
  PARTY_EDIT: { label: "Party Edited", color: "var(--amber, #b26a00)" },
  PARTY_DELETE: { label: "Party Deleted", color: "var(--negative, #c62828)" },
  EXPENSE: { label: "Expense", color: "var(--negative, #c62828)" },
  EXPENSE_DELETE: { label: "Expense Deleted", color: "var(--negative, #c62828)" },
  STOCK_ADJUST: { label: "Stock Adjust", color: "var(--amber, #b26a00)" }
};

let filter = "all";

export function initAuditLogScreen() {
  const filterSel = el("auditActionFilter");
  if (filterSel) {
    filterSel.addEventListener("change", () => {
      filter = filterSel.value;
      renderAuditLog();
    });
  }
  const refreshBtn = el("btnRefreshAuditLog");
  if (refreshBtn) refreshBtn.addEventListener("click", renderAuditLog);
}

export async function renderAuditLog() {
  const box = el("auditLogList");
  if (!box) return;
  box.innerHTML = "<p class='muted'>Loading…</p>";

  const entries = await loadAuditLog(200);
  const filtered = filter === "all" ? entries : entries.filter(e => e.action === filter);

  if (!filtered.length) {
    box.innerHTML = "<p class='muted'>Koi activity nahi mili.</p>";
    return;
  }

  box.innerHTML = "";
  filtered.forEach(e => {
    const meta = ACTION_LABELS[e.action] || { label: e.action, color: "var(--navy, #1e3a5f)" };
    const row = document.createElement("div");
    row.className = "card row-between";
    row.innerHTML = `
      <div>
        <div><span style="color:${meta.color}; font-weight:700;">${meta.label}</span> — ${e.summary || ""}</div>
        <div class="muted">${new Date(e.createdAt).toLocaleString("en-PK")} · ${e.user ? "by " + e.user : "unknown user"} · device ${e.device || "?"}</div>
      </div>
    `;
    box.appendChild(row);
  });
}
