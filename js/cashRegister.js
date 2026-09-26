// ================================================================
// cashRegister.js — "Till / Register" screen (mirrors Android's
// CashRegisterActivity.kt: one shared register per branch per day). Two
// states, exactly like the Android screen:
//   A) not opened yet today  -> "Open Today's Register" card
//   B) opened (open or closed) -> live Expected Closing + Close/Reopen +
//      a small history of the last 10 days
// Backend is data.js's loadCashRegister()/openCashRegister()/
// updateCashRegister() (already written, mirrors SyncQueueHelper's
// create_if_absent open + plain-upsert edit/close/reopen).
// ================================================================

import { loadCashRegister, openCashRegister, updateCashRegister, loadTodayCashTotals } from "./data.js";
import { showToast } from "./ui.js";

function el(id) { return document.getElementById(id); }
function money(n) { return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function dateKey(d) { return d.toISOString().slice(0, 10); }
function todayKey() { return dateKey(new Date()); }

let currentReg = null; // today's cash_register doc, or null if not opened yet

async function prefillFromYesterday() {
  const y = new Date(); y.setDate(y.getDate() - 1);
  try {
    const yReg = await loadCashRegister(dateKey(y));
    if (yReg && yReg.closed) {
      el("regOpeningCash").value = yReg.closingCash || 0;
      el("regOpeningBank").value = yReg.closingBank || 0;
    } else {
      el("regOpeningCash").value = "";
      el("regOpeningBank").value = "";
    }
  } catch (e) { /* best-effort prefill only — a failed lookup shouldn't block opening today's till */ }
}

async function renderOpenState() {
  el("regStatOpeningCash").textContent = money(currentReg.openingCash);
  el("regStatOpeningBank").textContent = money(currentReg.openingBank);

  const { cashIn, cashOut } = await loadTodayCashTotals();
  const expected = (currentReg.openingCash || 0) + cashIn - cashOut;
  el("regStatExpectedClosing").textContent = money(expected);
  el("btnCloseRegister").dataset.expected = expected; // stashed for the close-dialog's shortage/excess calc

  el("btnCloseRegister").classList.toggle("hidden", !!currentReg.closed);
  el("btnReopenRegister").classList.toggle("hidden", !currentReg.closed);
  el("registerClosedNote").classList.toggle("hidden", !currentReg.closed);
  if (currentReg.closed) {
    el("registerClosedNote").textContent =
      `Register band hai — Closing Cash ${money(currentReg.closingCash)}, Closing Bank ${money(currentReg.closingBank)}`;
  }
  el("closeRegisterDialog").classList.add("hidden");
}

async function loadAndRender() {
  currentReg = await loadCashRegister(todayKey());
  if (!currentReg) {
    el("registerClosedCard").classList.remove("hidden");
    el("registerOpenCard").classList.add("hidden");
    await prefillFromYesterday();
  } else {
    el("registerClosedCard").classList.add("hidden");
    el("registerOpenCard").classList.remove("hidden");
    await renderOpenState();
  }
  renderHistory();
}

function openCloseDialog() {
  const expected = parseFloat(el("btnCloseRegister").dataset.expected || "0");
  el("regClosingCashInput").value = expected.toFixed(2);
  el("regClosingBankInput").value = currentReg.openingBank || 0;
  updateShortageExcess();
  el("closeRegisterDialog").classList.remove("hidden");
}

function updateShortageExcess() {
  const expected = parseFloat(el("btnCloseRegister").dataset.expected || "0");
  const counted = parseFloat(el("regClosingCashInput").value) || 0;
  const diff = counted - expected;
  const box = el("regShortageExcess");
  if (Math.abs(diff) < 0.01) { box.textContent = "Match — koi shortage/excess nahi"; return; }
  box.innerHTML = diff > 0
    ? `Excess: <b style="color:var(--teal-fg)">+${money(diff)}</b>`
    : `Shortage: <b style="color:var(--red-fg)">${money(diff)}</b>`;
}

async function renderHistory() {
  const box = el("registerHistoryList");
  box.innerHTML = "Loading…";
  const days = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(dateKey(d));
  }
  const regs = (await Promise.all(days.map(loadCashRegister))).filter(Boolean);
  if (!regs.length) { box.innerHTML = "<p class='muted'>Koi register history nahi hai.</p>"; return; }
  box.innerHTML = "";
  regs.forEach(r => {
    const div = document.createElement("div");
    div.className = "card row-between";
    div.innerHTML = `
      <div>
        <div><b>${r.date}</b></div>
        <div class="muted">Opening: ${money(r.openingCash)} · ${r.closed ? "Closed" : "Open"}</div>
      </div>
      <div style="text-align:right">
        <div>${r.closed ? money(r.closingCash) : "—"}</div>
        <div class="muted">${r.closed ? "Closing" : ""}</div>
      </div>
    `;
    box.appendChild(div);
  });
}

export function initCashRegisterScreen() {
  el("btnOpenRegister").addEventListener("click", async () => {
    const openingCash = parseFloat(el("regOpeningCash").value) || 0;
    const openingBank = parseFloat(el("regOpeningBank").value) || 0;
    el("btnOpenRegister").disabled = true;
    try {
      const opened = await openCashRegister(todayKey(), { openingCash, openingBank });
      showToast(opened ? "Register khul gaya" : "Kisi aur device ne pehle hi khol diya — values reload ki gayi hain");
      await loadAndRender();
    } catch (e) {
      showToast("Error: " + e.message);
    } finally {
      el("btnOpenRegister").disabled = false;
    }
  });

  el("btnCloseRegister").addEventListener("click", openCloseDialog);
  el("btnCancelCloseRegister").addEventListener("click", () => el("closeRegisterDialog").classList.add("hidden"));
  el("regClosingCashInput").addEventListener("input", updateShortageExcess);

  el("btnConfirmCloseRegister").addEventListener("click", async () => {
    const closingCash = parseFloat(el("regClosingCashInput").value) || 0;
    const closingBank = parseFloat(el("regClosingBankInput").value) || 0;
    el("btnConfirmCloseRegister").disabled = true;
    try {
      await updateCashRegister(todayKey(), {
        openingCash: currentReg.openingCash, openingBank: currentReg.openingBank,
        closingCash, closingBank, closed: true
      });
      showToast("Register close ho gaya");
      await loadAndRender();
    } catch (e) {
      showToast("Error: " + e.message);
    } finally {
      el("btnConfirmCloseRegister").disabled = false;
    }
  });

  el("btnReopenRegister").addEventListener("click", async () => {
    if (!confirm("Register dobara open karna hai?")) return;
    try {
      await updateCashRegister(todayKey(), {
        openingCash: currentReg.openingCash, openingBank: currentReg.openingBank,
        closingCash: currentReg.closingCash, closingBank: currentReg.closingBank, closed: false
      });
      showToast("Register reopen ho gaya");
      await loadAndRender();
    } catch (e) {
      showToast("Error: " + e.message);
    }
  });
}

export function refreshCashRegisterScreen() {
  loadAndRender();
}
