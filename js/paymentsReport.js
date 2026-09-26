// ================================================================
// paymentsReport.js — Payments / Party Report screen (mirrors
// PaymentsReportActivity.kt). Reads every `payments` doc in the selected
// date range (see data.js's loadPaymentsReport() for the query + party-wise
// rollup), filterable by Customer/Supplier, with a running Total
// Received/Paid/Net Cash Flow summary and a party-wise breakdown.
// ================================================================

import { loadPaymentsReport } from "./data.js";

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let prRangeStart = 0, prRangeEnd = Date.now();
let prTypeFilter = "all"; // "all" | "customer" | "supplier"

function setRange(range) {
  const now = new Date();
  if (range === "today") {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    prRangeStart = start.getTime(); prRangeEnd = now.getTime();
  } else if (range === "week") {
    const start = new Date(); start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    prRangeStart = start.getTime(); prRangeEnd = now.getTime();
  } else if (range === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    prRangeStart = start.getTime(); prRangeEnd = now.getTime();
  } else {
    prRangeStart = 0; prRangeEnd = now.getTime();
  }
}

function makeStat(label, value, colorClass) {
  const div = document.createElement("div");
  div.className = "stat-card " + colorClass;
  div.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${money(value)}</div>`;
  return div;
}

export function initPaymentsReportScreen() {
  const rangeBtns = { today: el("prRangeToday"), week: el("prRangeWeek"), month: el("prRangeMonth"), all: el("prRangeAll") };
  Object.entries(rangeBtns).forEach(([key, btn]) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      Object.values(rangeBtns).forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      setRange(key);
      renderPaymentsReport();
    });
  });

  const typeBtns = { all: el("prTypeAll"), customer: el("prTypeCustomer"), supplier: el("prTypeSupplier") };
  Object.entries(typeBtns).forEach(([key, btn]) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      Object.values(typeBtns).forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      prTypeFilter = key;
      renderPaymentsReport();
    });
  });

  setRange("today");
}

export async function renderPaymentsReport() {
  const statsBox = el("prStats");
  const summaryBox = el("prPartySummary");
  const txBox = el("prTransactions");
  if (!statsBox) return;

  statsBox.innerHTML = "<p class='muted'>Loading…</p>";
  summaryBox.innerHTML = "";
  txBox.innerHTML = "";

  const r = await loadPaymentsReport(prRangeStart, prRangeEnd);

  const payments = prTypeFilter === "all" ? r.payments : r.payments.filter(p => p.partyType === prTypeFilter);
  const partySummary = prTypeFilter === "all" ? r.partySummary : r.partySummary.filter(p => p.partyType === prTypeFilter);

  statsBox.innerHTML = "";
  if (prTypeFilter !== "supplier") statsBox.appendChild(makeStat("Total Received", r.payments.filter(p => p.partyType === "customer").reduce((s, p) => s + p.amount, 0), "stat-teal"));
  if (prTypeFilter !== "customer") statsBox.appendChild(makeStat("Total Paid", r.payments.filter(p => p.partyType === "supplier").reduce((s, p) => s + p.amount, 0), "stat-amber"));
  statsBox.appendChild(makeStat("Net Cash Flow", r.netCashFlow, "stat-navy"));

  if (!partySummary.length) {
    summaryBox.innerHTML = "<p class='muted'>Is range mein koi payment nahi.</p>";
  } else {
    partySummary.forEach(p => {
      const net = p.received - p.paid;
      const row = document.createElement("div");
      row.className = "card row-between";
      row.innerHTML = `
        <div>
          <div><b>${p.partyName}</b></div>
          <div class="muted">${p.partyType === "customer" ? "Customer" : "Supplier"}</div>
        </div>
        <div style="text-align:right;">
          ${p.received ? `<div>Received: ${money(p.received)}</div>` : ""}
          ${p.paid ? `<div>Paid: ${money(p.paid)}</div>` : ""}
        </div>
      `;
      summaryBox.appendChild(row);
    });
  }

  if (!payments.length) {
    txBox.innerHTML = "<p class='muted'>Is range mein koi transaction nahi.</p>";
    return;
  }
  payments.forEach(p => {
    const label = p.partyType === "customer" ? "Received from" : "Paid to";
    const color = p.partyType === "customer" ? "var(--positive, #1a7f37)" : "var(--negative, #c62828)";
    const row = document.createElement("div");
    row.className = "card row-between";
    row.innerHTML = `
      <div>
        <div><b>${label} ${p.partyName}</b></div>
        <div class="muted">${new Date(p.createdAt).toLocaleString("en-PK")} · ${p.method || ""} ${p.reference ? "· Ref: " + p.reference : ""}</div>
        ${p.note ? `<div class="muted">${p.note}</div>` : ""}
      </div>
      <div style="color:${color}; font-weight:600;">${money(p.amount)}</div>
    `;
    txBox.appendChild(row);
  });
}
