// ================================================================
// partyReports.js — mirrors PartyReportsActivity.kt: pick a customer or
// supplier, then choose one of 6 reports about just that party — Item
// Report, Ledger (Dr/Cr), Payment History, Statement (running balance),
// Transactions (Sale/Purchase list), and Profit & Loss (customer) /
// Purchase Summary (supplier). Every report re-uses loadPartyTransactions()
// (same `sales`/`purchases` docs Parties' detail view already reads) — no
// new Firestore collection needed, since each sale/purchase doc already
// carries its own `items` array and `paid` amount, same shape Android's
// PartyReportsActivity reads from Room.
// ================================================================

import { customers, suppliers, loadPartyTransactions } from "./data.js";
import { showModal, closeModal } from "./ui.js";

let showingCustomers = true;

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(ms) {
  return new Date(ms).toLocaleString("en-PK", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function currentList() {
  return showingCustomers ? customers : suppliers;
}

// ================= Party list (tap a party -> report menu) =================
export function renderPartyReportsList() {
  const box = el("partyReportsList");
  const list = currentList().slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = `<p class="muted">Koi ${showingCustomers ? "customer" : "supplier"} nahi hai.</p>`;
    return;
  }
  list.forEach(p => {
    const closing = (p.openingBalance || 0) + (p.balance || 0);
    // Same sign convention as PartyReportsActivity.kt's partyRow(): a positive
    // customer balance means they owe us (red); a positive supplier balance
    // means WE owe them (also red, from our point of view) — either way,
    // "isGive" (red) is customer>0-is-false / supplier>0-is-true reversed
    // below to keep the exact PartyReportsActivity.kt semantics:
    //   customer: isGive = closing < 0   supplier: isGive = closing > 0
    const isGive = showingCustomers ? closing < 0 : closing > 0;
    const div = document.createElement("div");
    div.className = "card row-between";
    div.style.cursor = "pointer";
    div.innerHTML = `
      <div><b>${p.name}</b><div class="muted">${p.phone || "—"}</div></div>
      <div style="font-weight:800; color:${isGive ? "var(--red)" : "var(--teal-fg)"};">${money(closing)}</div>
    `;
    div.addEventListener("click", () => showReportMenu(p));
    box.appendChild(div);
  });
}

function showReportMenu(party) {
  const plLabel = showingCustomers ? "Customer-wise Profit" : "Purchase Summary";
  const statementLabel = showingCustomers ? "Customer Statement" : "Supplier Statement";
  const entries = [
    ["Party Report by Item", showItemReport],
    ["Ledger", showLedger],
    ["Payment History", showPaymentHistory],
    [statementLabel, showStatement],
    ["Sale/Purchase by Party", showTransactions],
    [plLabel, showPartyPL]
  ];
  const body = entries.map(([label], i) =>
    `<div class="modal-menu-row" data-i="${i}"><span>${label}</span><span>›</span></div>`
  ).join("");
  const container = showModal(party.name, body);
  entries.forEach(([, fn], i) => {
    container.querySelector(`[data-i="${i}"]`).addEventListener("click", () => fn(party));
  });
}

// ================= 1) Party Report by Item =================
async function showItemReport(party) {
  showModal("Item Report — " + party.name, "<p class='muted'>Loading…</p>");
  const rows = await loadPartyTransactions(party.id, showingCustomers ? "customer" : "supplier");
  const map = new Map();
  rows.forEach(doc => {
    (doc.items || []).forEach(it => {
      const key = it.product || it.barcode;
      const ex = map.get(key);
      const qty = it.qty || 0;
      const amt = it.amount || 0;
      if (ex) { ex.qty += qty; ex.amount += amt; }
      else map.set(key, { product: key, qty, amount: amt });
    });
  });
  const items = [...map.values()].sort((a, b) => b.amount - a.amount);
  const body = items.length
    ? items.map(i => rowHtml(i.product, `${i.qty} × — ${money(i.amount)}`)).join("")
    : `<p class="muted">Koi item nahi mila.</p>`;
  showModal("Item Report — " + party.name, body);
}

// ================= 2) Ledger (Dr/Cr, running balance) =================
async function showLedger(party) {
  showModal("Ledger — " + party.name, "<p class='muted'>Loading…</p>");
  const opening = party.openingBalance || 0;
  const rows = (await loadPartyTransactions(party.id, showingCustomers ? "customer" : "supplier"))
    .sort((a, b) => a.createdAt - b.createdAt);

  let running = opening;
  let html = `
    <div class="stmt-row" style="font-size:11px; font-weight:800; color:var(--text-muted);">
      <span style="flex:1.4;">Date</span><span style="flex:1; text-align:right; color:var(--red);">Debit</span>
      <span style="flex:1; text-align:right; color:var(--teal-fg);">Credit</span>
    </div>
    <div class="stmt-divider"></div>
  `;
  html += ledgerRowHtml("Opening Balance", opening > 0 ? opening : 0, opening < 0 ? -opening : 0, running, true);

  if (!rows.length) html += `<p class="muted">Koi transaction nahi.</p>`;
  rows.forEach(r => {
    running += (r.total - r.paid);
    html += ledgerRowHtml(fmtDate(r.createdAt), r.total, r.paid, running, false);
  });

  html += `<div class="stmt-divider"></div>`;
  html += rowHtml("<b>Closing Balance</b>", `<b style="color:${running > 0 ? "var(--red)" : "var(--teal-fg)"}">${money(running)}</b>`);
  showModal("Ledger — " + party.name, html);
}

function ledgerRowHtml(dateLabel, dr, cr, balance, bold) {
  return `
    <div style="padding:8px 0;">
      <div class="stmt-row">
        <span style="flex:1.4; font-weight:${bold ? 800 : 400};">${dateLabel}</span>
        <span style="flex:1; text-align:right; color:${dr > 0 ? "var(--red)" : "var(--text-muted)"};">${dr > 0 ? money(dr) : "—"}</span>
        <span style="flex:1; text-align:right; color:${cr > 0 ? "var(--teal-fg)" : "var(--text-muted)"};">${cr > 0 ? money(cr) : "—"}</span>
      </div>
      <div class="muted" style="font-weight:800; color:${balance > 0 ? "var(--red)" : "var(--teal-fg)"}; font-size:11.5px;">Balance: ${money(balance)}</div>
    </div>
  `;
}

// ================= 3) Payment History =================
// Same convention as PartyReportsActivity.kt's PaymentEntry: there's no
// dedicated installment table, so each sale/purchase's own `paid` amount
// (recorded at bill time) is read as one payment entry dated at createdAt.
async function showPaymentHistory(party) {
  showModal("Payment History — " + party.name, "<p class='muted'>Loading…</p>");
  const rows = await loadPartyTransactions(party.id, showingCustomers ? "customer" : "supplier");
  const against = showingCustomers ? "Against Sale" : "Against Purchase";
  const payments = rows.filter(r => (r.paid || 0) > 0)
    .map(r => ({ date: r.createdAt, amount: r.paid }))
    .sort((a, b) => b.date - a.date);

  let html;
  if (!payments.length) {
    html = `<p class="muted">Abhi tak koi payment record nahi hua.</p>`;
  } else {
    let total = 0;
    html = payments.map(p => {
      total += p.amount;
      return `
        <div class="row-between" style="padding:10px 0; border-bottom:1px solid var(--border);">
          <div><b>${fmtDateTime(p.date)}</b><div class="muted">${against}</div></div>
          <div style="font-weight:800; color:var(--teal-fg);">${money(p.amount)}</div>
        </div>
      `;
    }).join("");
    html += `<div class="stmt-divider"></div>`;
    html += rowHtml(`<b>${showingCustomers ? "Total Received" : "Total Paid"}</b>`, `<b style="color:var(--teal-fg)">${money(total)}</b>`);
  }
  showModal("Payment History — " + party.name, html);
}

// ================= 4) Statement (running balance) =================
async function showStatement(party) {
  showModal("Statement — " + party.name, "<p class='muted'>Loading…</p>");
  const opening = party.openingBalance || 0;
  const rows = (await loadPartyTransactions(party.id, showingCustomers ? "customer" : "supplier"))
    .sort((a, b) => a.createdAt - b.createdAt);

  let running = opening;
  let html = rowHtml("<b>Opening Balance</b>", money(opening)) + `<div class="stmt-divider"></div>`;
  if (!rows.length) html += `<p class="muted">Koi transaction nahi.</p>`;
  rows.forEach(r => {
    running += (r.total - r.paid);
    const isGive = showingCustomers ? running < 0 : running > 0;
    html += `
      <div style="padding:10px 0;">
        <div class="stmt-row"><span>${fmtDate(r.createdAt)}</span><span class="muted">${money(r.total)}</span></div>
        <div style="font-weight:800; color:${isGive ? "var(--red)" : "var(--teal-fg)"}; font-size:12px;">Balance: ${money(running)}</div>
      </div>
    `;
  });
  html += `<div class="stmt-divider"></div>`;
  const closingIsGive = showingCustomers ? running < 0 : running > 0;
  html += rowHtml("<b>Closing Balance</b>", `<b style="color:${closingIsGive ? "var(--red)" : "var(--teal-fg)"}">${money(running)}</b>`);
  showModal("Statement — " + party.name, html);
}

// ================= 5) Sale/Purchase by Party =================
async function showTransactions(party) {
  const title = showingCustomers ? "Sales" : "Purchases";
  showModal(title + " — " + party.name, "<p class='muted'>Loading…</p>");
  const rows = (await loadPartyTransactions(party.id, showingCustomers ? "customer" : "supplier"))
    .sort((a, b) => b.createdAt - a.createdAt);

  let html;
  if (!rows.length) {
    html = `<p class="muted">Koi ${showingCustomers ? "sale" : "purchase"} nahi hui.</p>`;
  } else {
    let total = 0;
    html = rows.map(r => { total += r.total; return rowHtml(fmtDateTime(r.createdAt), money(r.total)); }).join("");
    html += `<div class="stmt-divider"></div>` + rowHtml("<b>Total</b>", `<b>${money(total)}</b>`);
  }
  showModal(title + " — " + party.name, html);
}

// ================= 6) Profit & Loss (customer) / Purchase Summary (supplier) =================
async function showPartyPL(party) {
  const title = showingCustomers ? "Profit & Loss" : "Purchase Summary";
  showModal(title + " — " + party.name, "<p class='muted'>Loading…</p>");
  const rows = await loadPartyTransactions(party.id, showingCustomers ? "customer" : "supplier");

  let html;
  if (!rows.length) {
    html = `<p class="muted">Koi ${showingCustomers ? "sale" : "purchase"} nahi hui.</p>`;
  } else if (showingCustomers) {
    let revenue = 0, cost = 0;
    rows.forEach(s => (s.items || []).forEach(it => { revenue += it.amount || 0; cost += (it.cost || 0) * (it.qty || 0); }));
    const profit = revenue - cost;
    html = rowHtml("Total Sales (bills)", rows.length)
      + rowHtml("Revenue", money(revenue))
      + rowHtml("Cost of Goods", money(cost))
      + `<div class="stmt-divider"></div>`
      + rowHtml(`<b>${profit >= 0 ? "Net Profit" : "Net Loss"}</b>`, `<b style="color:${profit >= 0 ? "var(--teal-fg)" : "var(--red)"}">${money(profit)}</b>`);
  } else {
    const totalAmount = rows.reduce((s, r) => s + r.total, 0);
    const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
    const due = totalAmount - totalPaid;
    html = rowHtml("Total Bills", rows.length)
      + rowHtml("Total Purchased", money(totalAmount))
      + rowHtml("Total Paid", money(totalPaid))
      + `<div class="stmt-divider"></div>`
      + rowHtml("<b>Outstanding Due</b>", `<b style="color:${due > 0 ? "var(--red)" : "var(--teal-fg)"}">${money(due)}</b>`)
      + `<p class="muted" style="margin-top:8px;">Note: Suppliers don't have their own 'profit' — this is a purchase summary.</p>`;
  }
  showModal(title + " — " + party.name, html);
}

function rowHtml(left, right) {
  return `<div class="stmt-row">${typeof left === "string" ? `<span>${left}</span>` : left}<span>${right}</span></div>`;
}

// ================= Screen wiring =================
export function initPartyReportsScreen() {
  el("prtTabCustomers").addEventListener("click", () => {
    showingCustomers = true;
    el("prtTabCustomers").classList.add("active");
    el("prtTabSuppliers").classList.remove("active");
    renderPartyReportsList();
  });
  el("prtTabSuppliers").addEventListener("click", () => {
    showingCustomers = false;
    el("prtTabSuppliers").classList.add("active");
    el("prtTabCustomers").classList.remove("active");
    renderPartyReportsList();
  });
}
