// ================================================================
// reminders.js — Due Date Reminders screen. Lists credit sales that were
// given an optional due date on the Sale screen (js/sale.js's "Due Date"
// field, shown only when a sale has an outstanding balance) and still have
// money owed. Three filter pills: Overdue (due date already passed),
// Upcoming (due date still ahead), All. See data.js's loadDueReminders()
// for the query half — this file is display-only.
// ================================================================

import { loadDueReminders } from "./data.js";

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let currentFilter = "overdue"; // "overdue" | "upcoming" | "all"

function daysBetween(fromMillis, toMillis) {
  return Math.round((toMillis - fromMillis) / (1000 * 60 * 60 * 24));
}

export function initRemindersScreen() {
  el("tabRemindersOverdue").addEventListener("click", () => switchFilter("overdue"));
  el("tabRemindersUpcoming").addEventListener("click", () => switchFilter("upcoming"));
  el("tabRemindersAll").addEventListener("click", () => switchFilter("all"));
}

function switchFilter(f) {
  currentFilter = f;
  el("tabRemindersOverdue").classList.toggle("active", f === "overdue");
  el("tabRemindersUpcoming").classList.toggle("active", f === "upcoming");
  el("tabRemindersAll").classList.toggle("active", f === "all");
  renderReminders();
}

export async function renderReminders() {
  const box = el("remindersList");
  if (!box) return;
  box.innerHTML = "<p class='muted'>Loading...</p>";

  let list;
  try {
    list = await loadDueReminders();
  } catch (e) {
    box.innerHTML = `<p class='muted'>Error: ${e.message}</p>`;
    return;
  }

  const now = Date.now();
  const todayStart = new Date(new Date().toDateString()).getTime();

  if (currentFilter === "overdue") list = list.filter(r => r.dueDate < todayStart);
  if (currentFilter === "upcoming") list = list.filter(r => r.dueDate >= todayStart);
  // "all" — no filter

  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = `<p class='muted'>${currentFilter === "overdue" ? "Koi overdue reminder nahi." : currentFilter === "upcoming" ? "Koi upcoming reminder nahi." : "Koi due-date sale nahi mili."}</p>`;
    return;
  }

  list.forEach(r => {
    const overdueDays = daysBetween(r.dueDate, todayStart);
    const isOverdue = overdueDays > 0;
    const statusLabel = isOverdue ? `${overdueDays} din overdue` : (overdueDays === 0 ? "Aaj due hai" : `${-overdueDays} din baaki`);
    const statusColor = isOverdue ? "var(--negative, #c62828)" : (overdueDays === 0 ? "var(--warning, #b26a00)" : "var(--positive, #1a7f37)");

    const row = document.createElement("div");
    row.className = "card row-between";
    row.innerHTML = `
      <div>
        <div><b>${r.customerName}</b> <span class="muted">— Invoice ${r.invoice}</span></div>
        <div class="muted">Due date: ${new Date(r.dueDate).toLocaleDateString("en-PK")}</div>
        <div style="color:${statusColor};">${statusLabel}</div>
      </div>
      <div style="text-align:right;">
        <div><b>${money(r.due)}</b></div>
        ${r.customerPhone ? `<a href="tel:${r.customerPhone}" class="btn-secondary" style="display:inline-block; margin-top:6px;">📞 Call</a>` : ""}
      </div>
    `;
    box.appendChild(row);
  });
}
