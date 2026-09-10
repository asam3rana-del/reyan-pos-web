// ================================================================
// cash.js — Cash In / Cash Out screen (mirrors CashActivity.kt: a manual
// log of money moving in/out, separate from Expenses. Writes to the same
// `cash_transactions` Firestore collection savePurchase() already uses in
// data.js, so entries from both sources show up together here.)
// ================================================================

import { saveCashTransaction, loadTodayCashTotals, loadRecentCashTransactions } from "./data.js";
import { showToast } from "./ui.js";

// Same list CashActivity.kt offers for CASH OUT entries.
const EXPENSE_CATEGORIES = [
  "Food Authority License Fees",
  "Utility Bills",
  "Wages",
  "Fuel Expense",
  "Pick up Maintenance",
  "Fines",
  "Rent",
  "Income Tax Fees",
  "Miscellaneous"
];

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function populateCategories() {
  const sel = el("cashCategory");
  sel.innerHTML = EXPENSE_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
}

function updateMiscVisibility() {
  const isMisc = el("cashCategory").value === "Miscellaneous";
  el("cashMiscField").classList.toggle("hidden", !isMisc);
}

// Builds the same combined "reason" string CashActivity.kt's saveEntry() does:
// category (+ misc description if Miscellaneous) + " | " + free-text note.
// Category is only meaningful for CASH OUT, same as the Android screen.
function buildReason(type) {
  const category = el("cashCategory").value;
  const misc = el("cashMiscDesc").value.trim();
  const note = el("cashReason").value.trim();
  let out = "";
  if (type === "OUT" && category) {
    out = category;
    if (category === "Miscellaneous" && misc) out += " - " + misc;
  }
  if (note) out += (out ? " | " : "") + note;
  return out;
}

async function saveEntry(type) {
  const amt = parseFloat(el("cashAmount").value);
  if (!amt || amt <= 0) { showToast("Sahi amount likhein"); return; }
  const method = el("cashMethod").value;
  const reason = buildReason(type);

  const btnIn = el("btnCashIn"), btnOut = el("btnCashOut");
  btnIn.disabled = true; btnOut.disabled = true;
  try {
    await saveCashTransaction({ type, method, amount: amt, reason });
    showToast(type === "IN" ? "Cash In save ho gaya" : "Cash Out save ho gaya");
    el("cashAmount").value = "";
    el("cashMiscDesc").value = "";
    el("cashReason").value = "";
    el("cashCategory").selectedIndex = 0;
    updateMiscVisibility();
    refreshCashScreen();
  } catch (e) {
    showToast("Save nahi ho saka: " + e.message);
  } finally {
    btnIn.disabled = false; btnOut.disabled = false;
  }
}

async function renderTotals() {
  const { cashIn, cashOut } = await loadTodayCashTotals();
  el("cashTodayIn").textContent = money(cashIn);
  el("cashTodayOut").textContent = money(cashOut);
}

async function renderList() {
  const box = el("cashList");
  box.innerHTML = "Loading…";
  const list = await loadRecentCashTransactions(50);
  if (!list.length) { box.innerHTML = "<p class='muted'>Koi entry nahi hai.</p>"; return; }

  box.innerHTML = "";
  list.forEach(t => {
    const isIn = t.type === "IN";
    const div = document.createElement("div");
    div.className = "card row-between";
    div.innerHTML = `
      <div>
        <div><b>${(t.method || "").toUpperCase()}</b>${t.reason ? " — " + t.reason : ""}</div>
        <div class="muted">${new Date(t.createdAt).toLocaleString()}</div>
      </div>
      <div style="color:${isIn ? "var(--teal-fg)" : "var(--red)"}; font-weight:800;">
        ${isIn ? "+" : "-"} ${money(t.amount)}
      </div>
    `;
    box.appendChild(div);
  });
}

export function initCashScreen() {
  populateCategories();
  updateMiscVisibility();
  el("cashCategory").addEventListener("change", updateMiscVisibility);
  el("btnCashIn").addEventListener("click", () => saveEntry("IN"));
  el("btnCashOut").addEventListener("click", () => saveEntry("OUT"));
}

export function refreshCashScreen() {
  renderTotals();
  renderList();
}
