import { loadDayBook, products, customers, loadPnL, loadBalanceSheet } from "./data.js";
import { printSaleReceipt } from "./print.js";

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function initReportsScreens() {
  const dateInput = document.getElementById("dayBookDate");
  dateInput.value = new Date().toISOString().slice(0, 10);
  dateInput.addEventListener("change", () => renderDayBook(dateInput.value));

  initPnlBalanceSheetTabs();
}

export async function renderDayBook(dateStr) {
  const box = document.getElementById("dayBookList");
  box.innerHTML = "Loading…";
  const sales = await loadDayBook(dateStr);
  if (!sales.length) { box.innerHTML = "<p class='muted'>Is din koi sale nahi.</p>"; return; }

  box.innerHTML = "";
  let dayTotal = 0;
  sales.forEach(s => {
    dayTotal += s.total || 0;
    const customer = customers.find(c => c.id === s.customerServerId);
    const div = document.createElement("div");
    div.className = "card row-between";
    div.innerHTML = `
      <div>
        <div><b>${s.invoice}</b> — ${s.paymentMethod}</div>
        <div class="muted">${new Date(s.createdAt).toLocaleTimeString()} · ${s.itemCount} items</div>
      </div>
      <div style="text-align:right">
        <div><b>${money(s.total)}</b></div>
        <span class="daybook-print" data-invoice="${s.invoice}">🖨 Print</span>
      </div>
    `;
    div.querySelector(".daybook-print").addEventListener("click", () => {
      printSaleReceipt(s, customer ? customer.name : "Cash");
    });
    box.appendChild(div);
  });
  const summary = document.createElement("div");
  summary.className = "card row-between total-row";
  summary.innerHTML = `<span>Day Total</span><span>${money(dayTotal)}</span>`;
  box.prepend(summary);
}

// ================================================================
// REPORTS SCREEN: Profit & Loss  +  Balance Sheet
// (mirrors ReportsActivity.kt / BalanceSheetActivity.kt — same fields and
// formulas, just read from Firestore instead of Room. See data.js's
// loadPnL()/loadBalanceSheet() for the exact math.)
// ================================================================

let pnlRangeStart = 0, pnlRangeEnd = 0;

function statRow(label, amount, opts = {}) {
  const { bold, big, colorVar } = opts;
  const color = colorVar || (amount < 0 ? "var(--red)" : bold ? "var(--navy)" : "var(--text-dark)");
  const div = document.createElement("div");
  div.className = "stmt-row" + (bold ? " stmt-row-bold" : "");
  div.innerHTML = `
    <span style="${bold ? "font-weight:800;" : "color:var(--text-muted);"} ${big ? "font-size:15px;" : "font-size:13.5px;"}">${label}</span>
    <span style="color:${color}; font-weight:${bold ? 800 : 600}; ${big ? "font-size:16px;" : "font-size:13.5px;"}">${money(amount)}</span>
  `;
  return div;
}

function stmtDivider() {
  const d = document.createElement("div");
  d.className = "stmt-divider";
  return d;
}

function sectionLabel(text) {
  const h = document.createElement("h3");
  h.className = "section-label";
  h.style.margin = "18px 0 8px";
  h.textContent = text;
  return h;
}

// ---------- Tab toggle (Profit & Loss <-> Balance Sheet), same pattern as
// the Parties screen's Customers/Suppliers tabs ----------
function initPnlBalanceSheetTabs() {
  const tabPnl = el("tabPnl"), tabBs = el("tabBalanceSheet");
  if (!tabPnl || !tabBs) return; // guards against older index.html without Reports screen

  tabPnl.addEventListener("click", () => switchReportsTab("pnl"));
  tabBs.addEventListener("click", () => switchReportsTab("balanceSheet"));

  document.querySelectorAll(".report-filter-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".report-filter-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      setPnlRange(btn.dataset.range);
      renderPnl();
    });
  });

  switchReportsTab("pnl");
  setPnlRange("today");
}

function switchReportsTab(tab) {
  el("tabPnl").classList.toggle("active", tab === "pnl");
  el("tabBalanceSheet").classList.toggle("active", tab === "balanceSheet");
  el("pnlTab").classList.toggle("hidden", tab !== "pnl");
  el("balanceSheetTab").classList.toggle("hidden", tab !== "balanceSheet");
  if (tab === "pnl") renderPnl();
  else renderBalanceSheet();
}

// ---------- Date range helpers (same buckets as ReportsActivity.kt's filter pills) ----------
function setPnlRange(range) {
  const now = new Date();
  if (range === "today") {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    pnlRangeStart = start.getTime(); pnlRangeEnd = now.getTime();
  } else if (range === "week") {
    const start = new Date(); start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    pnlRangeStart = start.getTime(); pnlRangeEnd = now.getTime();
  } else if (range === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    pnlRangeStart = start.getTime(); pnlRangeEnd = now.getTime();
  } else {
    pnlRangeStart = 0; pnlRangeEnd = now.getTime();
  }
}

export async function renderPnl() {
  const statsBox = el("pnlStats");
  const stmtBox = el("pnlStatement");
  const topBox = el("pnlTopProducts");
  const dailyBox = el("pnlDailySales");
  if (!statsBox) return;

  statsBox.innerHTML = "<p class='muted'>Loading…</p>";
  const r = await loadPnL(pnlRangeStart, pnlRangeEnd);

  statsBox.innerHTML = "";
  statsBox.appendChild(makeStat("Total Sales", r.totalSales, "stat-navy"));
  statsBox.appendChild(makeStat("Gross Profit", r.grossProfit, "stat-teal"));
  statsBox.appendChild(makeStat("Total Purchases", r.totalPurchases, "stat-amber"));
  statsBox.appendChild(makeStat("Total Expenses", r.totalExpenses, "stat-red"));

  stmtBox.innerHTML = "";
  stmtBox.appendChild(sectionLabel("PROFIT & LOSS"));
  stmtBox.appendChild(statRow("Revenue", r.totalSales));
  stmtBox.appendChild(statRow("Cost of Goods Sold (COGS)", -r.cogs));
  stmtBox.appendChild(stmtDivider());
  stmtBox.appendChild(statRow("Gross Profit", r.grossProfit, { bold: true }));
  stmtBox.appendChild(statRow("Expenses", -r.totalExpenses));
  stmtBox.appendChild(stmtDivider());
  stmtBox.appendChild(statRow("Net Profit", r.netProfit, { bold: true, big: true }));
  stmtBox.appendChild(statRow("Number of Sales", r.saleCount, { colorVar: "var(--purple-fg)" }));

  topBox.innerHTML = "<div class='card-title'>Top Products</div>";
  if (!r.topProducts.length) {
    topBox.innerHTML += "<p class='muted'>Is period mein koi sale nahi.</p>";
  } else {
    r.topProducts.forEach(tp => {
      const row = document.createElement("div");
      row.className = "row-between";
      row.style.padding = "8px 0";
      row.innerHTML = `<span>${tp.product}</span><span style="font-weight:800; color:var(--purple-fg)">${tp.qty} sold</span>`;
      topBox.appendChild(row);
    });
  }

  dailyBox.innerHTML = "<div class='card-title'>Daily Sales</div>";
  if (!r.dailySales.length) {
    dailyBox.innerHTML += "<p class='muted'>Koi data nahi.</p>";
  } else {
    r.dailySales.forEach(d => {
      const row = document.createElement("div");
      row.className = "row-between";
      row.style.padding = "8px 0";
      row.innerHTML = `<span>${d.day}</span><span style="font-weight:800; color:var(--purple-fg)">${money(d.total)}</span>`;
      dailyBox.appendChild(row);
    });
  }
}

function makeStat(label, value, colorClass) {
  const div = document.createElement("div");
  div.className = "stat-card " + colorClass;
  div.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value">${money(value)}</div>`;
  return div;
}

export async function renderBalanceSheet() {
  const box = el("balanceSheetBox");
  if (!box) return;
  box.innerHTML = "<p class='muted'>Loading…</p>";
  const b = await loadBalanceSheet();

  box.innerHTML = "";

  box.appendChild(sectionLabel("ASSETS"));
  const assets = document.createElement("div");
  assets.className = "card";
  assets.appendChild(statRow("Cash in Hand", b.cashInHand));
  assets.appendChild(statRow("Bank Balance", b.bankBalance));
  assets.appendChild(statRow("Stock in Hand (at cost)", b.stockValue));
  assets.appendChild(statRow("Accounts Receivable", b.receivables));
  if (b.advancePaidToSuppliers > 0) assets.appendChild(statRow("Advance Paid to Suppliers", b.advancePaidToSuppliers));
  assets.appendChild(stmtDivider());
  assets.appendChild(statRow("Total Assets", b.totalAssets, { bold: true, big: true }));
  box.appendChild(assets);

  box.appendChild(sectionLabel("LIABILITIES"));
  const liab = document.createElement("div");
  liab.className = "card";
  liab.appendChild(statRow("Accounts Payable", b.payables));
  if (b.advanceFromCustomers > 0) liab.appendChild(statRow("Advance from Customers", b.advanceFromCustomers));
  liab.appendChild(stmtDivider());
  liab.appendChild(statRow("Total Liabilities", b.totalLiabilities, { bold: true, big: true }));
  box.appendChild(liab);

  box.appendChild(sectionLabel("CAPITAL / EQUITY"));
  const cap = document.createElement("div");
  cap.className = "card";
  cap.appendChild(statRow("Net Profit (all-time)", b.netProfit));
  cap.appendChild(statRow("Capital (calculated)", b.capital));
  cap.appendChild(stmtDivider());
  cap.appendChild(statRow("Total Liabilities + Capital", b.totalLiabilities + b.capital + b.netProfit, { bold: true, big: true }));
  box.appendChild(cap);

  const note = document.createElement("p");
  note.className = "muted";
  note.style.fontSize = "11.5px";
  note.textContent = "Note: Capital is a calculated balancing figure (Total Assets \u2212 Total Liabilities \u2212 Net Profit), since owner's injected capital isn't entered separately.";
  box.appendChild(note);
}
