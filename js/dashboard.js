import {
  loadTodayStats, loadDuesSummary, loadCashRegister, loadTodayCashTotals,
  lowStockProducts, shellCustomers, loadDueReminders, loadRecentActivity,
  customers, suppliers, loadAllTrueBalances
} from "./data.js";
import { selectOverdueTab } from "./reminders.js";
import { showModal, closeModal } from "./ui.js";

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function el(id) { return document.getElementById(id); }

let dashboardRole = null; // set once by initDashboard() — gates which sections refreshDashboard() bothers fetching

function todayKey() { return new Date().toISOString().slice(0, 10); }

function timeAgo(millis) {
  const diffMin = Math.round((Date.now() - millis) / 60000);
  if (diffMin < 1) return "abhi";
  if (diffMin < 60) return `${diffMin} min pehle`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ghante pehle`;
  return `${Math.round(diffHr / 24)} din pehle`;
}

// ---------- 1. Till/Register Status card ----------
async function refreshRegisterCard() {
  const card = el("statRegisterCard");
  if (!card) return;
  card.classList.remove("stat-red", "stat-teal", "stat-muted");

  let reg;
  try {
    reg = await loadCashRegister(todayKey());
  } catch (e) {
    reg = null;
  }

  if (!reg) {
    card.classList.add("stat-red");
    el("statRegisterLabel").textContent = "Till / Register";
    el("statRegisterValue").textContent = "Register nahi khula";
    return;
  }

  if (reg.closed) {
    card.classList.add("stat-muted");
    el("statRegisterLabel").textContent = "Register — Closed";
    el("statRegisterValue").textContent = money(reg.closingCash);
    return;
  }

  // This call was previously unguarded — a failure here escaped straight
  // through the Promise.all() in refreshDashboard() as an unhandled
  // rejection (refreshDashboard() itself is fire-and-forget from
  // app.js's showScreen(), so nothing upstream would have caught it either).
  let cashIn = 0, cashOut = 0;
  try {
    ({ cashIn, cashOut } = await loadTodayCashTotals());
  } catch (e) {
    console.warn("refreshRegisterCard: loadTodayCashTotals failed", e);
  }
  const expected = (reg.openingCash || 0) + cashIn - cashOut;
  card.classList.add("stat-teal");
  el("statRegisterLabel").textContent = "Register — Open";
  el("statRegisterValue").textContent = "Exp. Closing: " + money(expected);
}

// ---------- 2. Low Stock — live badge ----------
function refreshLowStockBadge() {
  const count = lowStockProducts().length;
  const sub = el("lowStockSub");
  const badge = el("lowStockBadge");
  if (sub) sub.textContent = count > 0 ? `${count} items need restock` : "All items stocked";
  if (badge) {
    badge.classList.toggle("hidden", count === 0);
    badge.textContent = count;
  }
}

// ---------- 3. Shell Ledger — total owed stat ----------
export function refreshShellOwedStat() {
  const card = el("statShellOwedCard");
  if (!card) return;
  const total = shellCustomers.reduce((s, c) => s + (c.shellsOwed || 0), 0);
  card.classList.toggle("hidden", total <= 0);
  el("statShellOwed").textContent = total;
}

// ---------- 4. Due Reminders — overdue badge ----------
async function refreshOverdueCard() {
  const card = el("statOverdueCard");
  if (!card) return;
  const todayStart = new Date(new Date().toDateString()).getTime();
  let list;
  try {
    list = await loadDueReminders();
  } catch (e) {
    list = [];
  }
  const overdueCount = list.filter(r => r.dueDate < todayStart).length;
  card.classList.toggle("hidden", overdueCount === 0);
  el("statOverdue").textContent = overdueCount;
}

// ---------- 5. Recent Activity feed ----------
const ACTIVITY_META = {
  sale: { icon: "🛒", label: "Sale", color: "var(--positive, #1a7f37)" },
  purchase: { icon: "📦", label: "Purchase", color: "var(--negative, #c62828)" },
  cashIn: { icon: "💰", label: "Cash In", color: "var(--positive, #1a7f37)" },
  cashOut: { icon: "💸", label: "Cash Out", color: "var(--negative, #c62828)" }
};

async function refreshRecentActivity() {
  const box = el("recentActivityList");
  if (!box) return;
  box.innerHTML = "<p class='muted'>Loading…</p>";

  let events;
  try {
    events = await loadRecentActivity(10);
  } catch (e) {
    box.innerHTML = `<p class='muted'>Error: ${e.message}</p>`;
    return;
  }

  if (!events.length) { box.innerHTML = "<p class='muted'>Koi recent activity nahi.</p>"; return; }

  box.innerHTML = "";
  events.forEach(ev => {
    const meta = ACTIVITY_META[ev.type] || { icon: "•", label: ev.type, color: "var(--text-dark)" };
    const row = document.createElement("div");
    row.className = "card row-between";
    row.innerHTML = `
      <div>
        <div>${meta.icon} <b>${ev.label}</b></div>
        <div class="muted">${timeAgo(ev.createdAt)}</div>
      </div>
      <div style="color:${meta.color}; font-weight:600;">${money(ev.amount)}</div>
    `;
    box.appendChild(row);
  });
}

// ---------- 6. Dues breakdown — double-tap "You'll get" / "You'll give" ----------
// Same true-balance recompute as loadDuesSummary()/Parties (see data.js's
// loadAllTrueBalances) so this list's figures always match the dashboard
// total and the Parties screen — never the raw, driftable `balance` field.
let onOpenPartyCb = null;

async function showDuesBreakdown(kind) {
  // kind: "get" (customers who owe us) | "give" (suppliers we owe)
  const isCustomers = kind === "get";
  const title = isCustomers ? "You'll get — Customers" : "You'll give — Suppliers";
  showModal(title, "<p class='muted'>Loading…</p>");

  let balances;
  try {
    balances = await loadAllTrueBalances();
  } catch (e) {
    showModal(title, `<p class="muted">Error: ${e.message}</p>`);
    return;
  }

  const partyType = isCustomers ? "customer" : "supplier";
  const list = (isCustomers ? customers : suppliers)
    .map(p => ({ p, balance: balances.get(`${partyType}:${p.id}`) || 0 }))
    .filter(x => x.balance > 0)
    .sort((a, b) => b.balance - a.balance);

  if (!list.length) {
    showModal(title, `<p class="muted">Koi ${isCustomers ? "receivable" : "payable"} nahi hai.</p>`);
    return;
  }

  const rows = list.map(({ p, balance }) => `
    <div class="modal-menu-row party-dues-row" data-id="${p.id}">
      <span>
        <b>${(p.name || "").trim() || "(Naam missing)"}</b>
        ${p.phone ? `<div class="muted">${p.phone}</div>` : ""}
      </span>
      <span style="font-weight:800;">${money(balance)}</span>
    </div>
  `).join("");
  const total = list.reduce((s, x) => s + x.balance, 0);
  const body = rows + `
    <div class="modal-menu-row" style="border-top:2px solid var(--border,#ddd);">
      <span><b>Total</b></span><span style="font-weight:800;">${money(total)}</span>
    </div>
  `;
  const container = showModal(title, body);
  container.querySelectorAll(".party-dues-row").forEach(row => {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => {
      closeModal();
      if (onOpenPartyCb) onOpenPartyCb(row.dataset.id, isCustomers);
    });
  });
}

export async function refreshDashboard() {
  try {
    const { totalSale, totalProfit } = await loadTodayStats();
    document.getElementById("statTodaySale").textContent = money(totalSale);
    document.getElementById("statTodayProfit").textContent = money(totalProfit);

    const { youllGet, youllGive } = await loadDuesSummary();
    document.getElementById("statYoullGet").textContent = money(youllGet);
    document.getElementById("statYoullGive").textContent = money(youllGive);
  } catch (e) {
    // app.js's showScreen() calls refreshDashboard() without awaiting or
    // catching it, so a throw here would otherwise surface as a generic
    // unhandled-rejection banner with no indication of which stat failed.
    console.warn("refreshDashboard: today's stats / dues summary failed", e);
  }

  refreshLowStockBadge();
  refreshShellOwedStat();

  // Register status, Overdue Dues and Recent Activity are admin/manager only
  // (see app.js's enterApp() financial-visibility gate) — for a cashier these
  // elements are already display:none via CSS, but skip fetching their data
  // entirely too, rather than just leaving it unseen.
  if (dashboardRole === "admin" || dashboardRole === "manager") {
    // allSettled, not all: one card's fetch failing must not stop the other
    // two from finishing (each already has its own internal try/catch too —
    // this is a second layer of defense, not a substitute for those).
    await Promise.allSettled([refreshRegisterCard(), refreshOverdueCard(), refreshRecentActivity()]);
  }
}

export function initDashboard({ onQuickSale, onOpenParty, role }) {
  dashboardRole = role;
  onOpenPartyCb = onOpenParty || null;
  document.getElementById("btnQuickSale").addEventListener("click", onQuickSale);
  // Double-tap (dblclick) "You'll get" / "You'll give" — full breakdown of
  // every customer/supplier with dues, not just the summed total.
  const getCard = document.getElementById("statYoullGetCard");
  const giveCard = document.getElementById("statYoullGiveCard");
  if (getCard) getCard.addEventListener("dblclick", () => showDuesBreakdown("get"));
  if (giveCard) giveCard.addEventListener("dblclick", () => showDuesBreakdown("give"));
  // Land on the Overdue tab specifically, even if Reminders was last left on
  // a different one. Navigation itself is handled by app.js's generic
  // wireNav() via this card's static data-screen="reminders" (index.html) —
  // this listener just resets the tab after that navigation runs.
  const overdueCard = document.getElementById("statOverdueCard");
  if (overdueCard) overdueCard.addEventListener("click", selectOverdueTab);
}
