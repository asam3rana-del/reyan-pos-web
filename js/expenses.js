// ================================================================
// expenses.js — Expenses screen (mirrors ExpenseActivity.kt: writes to the
// separate `expenses` Firestore collection — NOT cash_transactions — which
// is exactly what Reports.js's P&L "Total Expenses"/Net Profit reads.)
// ================================================================

import { saveExpense, deleteExpense, loadExpenseTotals, loadRecentExpenses } from "./data.js";
import { showToast } from "./ui.js";

// Same list ExpenseActivity.kt offers (one longer than CashActivity's —
// includes "Salaries" and "Zakat" too, matching the Kotlin source exactly).
const EXPENSE_CATEGORIES = [
  "Food Authority License Fees",
  "Utility Bills",
  "Wages",
  "Salaries",
  "Fuel Expense",
  "Pick up Maintenance",
  "Fines",
  "Rent",
  "Income Tax Fees",
  "Zakat",
  "Miscellaneous"
];

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function populateCategories() {
  el("expenseCategory").innerHTML = EXPENSE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
}

function updateMiscVisibility() {
  el("expenseMiscField").classList.toggle("hidden", el("expenseCategory").value !== "Miscellaneous");
}

// Same combined "description" ExpenseActivity.kt's saveExpense() builds:
// misc description (Miscellaneous only) + " | " + free-text note.
function buildDescription() {
  const category = el("expenseCategory").value;
  const misc = el("expenseMiscDesc").value.trim();
  const note = el("expenseReason").value.trim();
  let out = "";
  if (category === "Miscellaneous" && misc) out = misc;
  if (note) out += (out ? " | " : "") + note;
  return out;
}

async function handleSave() {
  const amt = parseFloat(el("expenseAmount").value);
  if (!amt || amt <= 0) { showToast("Sahi amount likhein"); return; }
  const category = el("expenseCategory").value;
  const description = buildDescription();

  const btn = el("btnSaveExpense");
  btn.disabled = true;
  try {
    await saveExpense({ category, description, amount: amt });
    showToast("Expense save ho gaya");
    el("expenseAmount").value = "";
    el("expenseMiscDesc").value = "";
    el("expenseReason").value = "";
    el("expenseCategory").selectedIndex = 0;
    updateMiscVisibility();
    refreshExpensesScreen();
  } catch (e) {
    showToast("Save nahi ho saka: " + e.message);
  } finally {
    btn.disabled = false;
  }
}

async function handleDelete(id) {
  if (!confirm("Ye expense entry delete kar dein?")) return;
  try {
    await deleteExpense(id);
    showToast("Expense delete ho gaya");
    refreshExpensesScreen();
  } catch (e) {
    showToast("Delete nahi ho saka: " + e.message);
  }
}

async function renderTotals() {
  const { today, month } = await loadExpenseTotals();
  el("expenseTodayTotal").textContent = money(today);
  el("expenseMonthTotal").textContent = money(month);
}

async function renderList() {
  const box = el("expenseList");
  box.innerHTML = "Loading…";
  const list = await loadRecentExpenses(50);
  if (!list.length) { box.innerHTML = "<p class='muted'>Abhi tak koi expense nahi.</p>"; return; }

  box.innerHTML = "";
  list.forEach(e => {
    const div = document.createElement("div");
    div.className = "card row-between";
    div.innerHTML = `
      <div>
        <div><b>${e.category}</b>${e.description ? " — " + e.description : ""}</div>
        <div class="muted">${new Date(e.createdAt).toLocaleString()}</div>
      </div>
      <div style="text-align:right">
        <div style="color:var(--red); font-weight:800;">- ${money(e.amount)}</div>
        <span class="expense-delete" data-id="${e.id}">Delete</span>
      </div>
    `;
    box.appendChild(div);
  });

  box.querySelectorAll(".expense-delete").forEach(elm => {
    elm.addEventListener("click", () => handleDelete(elm.dataset.id));
  });
}

export function initExpensesScreen() {
  populateCategories();
  updateMiscVisibility();
  el("expenseCategory").addEventListener("change", updateMiscVisibility);
  el("btnSaveExpense").addEventListener("click", handleSave);
}

export function refreshExpensesScreen() {
  renderTotals();
  renderList();
}
