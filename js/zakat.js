// ================================================================
// zakat.js — Zakat tracker screen (mirrors ZakatActivity.kt): a
// Ramadan-to-Ramadan year, auto-calculated from Cash + Bank + Stock (at
// cost) + Receivables − Payables (same formula as Reports' Balance Sheet),
// paid all at once or in installments, with an editable 12-month breakdown.
//
// zakat_years / zakat_payments are synced Firestore collections, field-for-
// field identical to SyncQueueHelper.kt's zakatYearJson()/zakatPaymentJson()
// (see data.js). The monthly plan (ZakatMonthPlan) is LOCAL-ONLY on Android
// too (no server collection) — kept the same way here, in localStorage.
// ================================================================

import { loadBalanceSheet, loadLatestZakatYear, saveZakatYear, updateZakatYear, loadZakatPayments, saveZakatPayment } from "./data.js";
import { branchId } from "./firebase-init.js";
import { showToast } from "./ui.js";

function el(id) { return document.getElementById(id); }

// ---------------- Tabular ("civil") Hijri calendar — public-domain
// Kuwaiti-algorithm conversion, same 30-year leap cycle ICU's default
// "islamic" calendar uses. Good enough for a Ramadan-to-Ramadan year
// window; day-level astronomical precision isn't needed here. ----------

function gregorianToJD(date) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function jdToGregorian(jd) {
  jd = Math.floor(jd);
  const a = jd + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + d - 4800 + Math.floor(m / 10);
  return new Date(year, month - 1, day);
}

function jdToHijri(jd) {
  jd = Math.floor(jd);
  const l = jd - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  let ll = l - 10631 * n + 354;
  const j = Math.floor((10985 - ll) / 5316) * Math.floor((50 * ll) / 17719) + Math.floor(ll / 5670) * Math.floor((43 * ll) / 15238);
  ll = ll - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const month = Math.floor((24 * ll) / 709);
  const day = ll - Math.floor((709 * month) / 24);
  const year = 30 * n + j - 30;
  return { year, month, day }; // month 1-12 (1=Muharram, 9=Ramadan)
}

function hijriToJD(year, month, day) {
  return Math.floor((11 * year + 3) / 30) + 354 * year + 30 * month - Math.floor((month - 1) / 2) + day + 1948440 - 385;
}

function ramadanStartMillis(hijriYear) {
  return jdToGregorian(hijriToJD(hijriYear, 9, 1)).getTime();
}

// Most recent 1-Ramadan on/before today, through the following 1-Ramadan.
function currentRamadanBracket() {
  const now = Date.now();
  const hijriYearNow = jdToHijri(gregorianToJD(new Date())).year;
  let start = ramadanStartMillis(hijriYearNow);
  if (start > now) start = ramadanStartMillis(hijriYearNow - 1);
  const startHijriYear = jdToHijri(gregorianToJD(new Date(start))).year;
  const end = ramadanStartMillis(startHijriYear + 1);
  return { start, end };
}

// ---------------- Month-slice helpers (12 even slices of the year) ----------------

function monthStartMillis(year, m) {
  const span = year.endDate - year.startDate;
  return year.startDate + Math.floor((span * (m - 1)) / 12);
}
function monthEndMillis(year, m) {
  const span = year.endDate - year.startDate;
  return year.startDate + Math.floor((span * m) / 12);
}

const ISLAMIC_MONTH_NAMES = [
  "Ramadan", "Shawwal", "Dhul-Qa'dah", "Dhul-Hijjah", "Muharram", "Safar",
  "Rabi' al-Awwal", "Rabi' al-Thani", "Jumada al-Awwal", "Jumada al-Thani", "Rajab", "Sha'ban"
];

function monthLabel(year, m) {
  if (year.calendarType === "gregorian") {
    return new Date(monthStartMillis(year, m)).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return ISLAMIC_MONTH_NAMES[m - 1] || ("Month " + m);
}

// ---------------- Month plan (local-only, mirrors ZakatMonthPlan — no
// server collection on Android either, see Database.kt's doc comment) ----------

function monthPlanKey(yearServerId, m) { return `zakat_month_plan:${branchId()}:${yearServerId}:${m}`; }

function getMonthPlan(yearServerId, m) {
  try {
    const raw = localStorage.getItem(monthPlanKey(yearServerId, m));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setMonthPlan(yearServerId, m, payableAmount, note) {
  localStorage.setItem(monthPlanKey(yearServerId, m), JSON.stringify({ payableAmount, note: note || "" }));
}

// ---------------- Small formatting helpers ----------------

function money(amount, currency) {
  return (currency || "Rs") + " " + Math.round(amount || 0).toLocaleString("en-PK");
}
function dateStr(ms) { return new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
function todayInputValue() { return new Date().toISOString().slice(0, 10); }

const CURRENCY_OPTIONS = ["Rs", "PKR", "$", "SAR", "AED", "£", "€", "Custom"];
const CATEGORY_OPTIONS = [
  ["", "No category"], ["cash", "Cash / Bank"], ["gold", "Gold"], ["silver", "Silver"],
  ["business", "Business Stock"], ["livestock", "Livestock"], ["crops", "Crops / Produce"], ["other", "Other"]
];

// ---------------- Module state ----------------

let latestYear = null;
let payments = [];
let formMode = null; // null | "start" | "edit" | "payment" | number (month index)
let autoAssets = 0;

function currencySelectHtml(id, selected) {
  const known = CURRENCY_OPTIONS.includes(selected) ? selected : "Custom";
  const opts = CURRENCY_OPTIONS.map(c => `<option value="${c}" ${c === known ? "selected" : ""}>${c}</option>`).join("");
  const customVal = known === "Custom" ? selected : "";
  return `
    <select id="${id}">${opts}</select>
    <input id="${id}Custom" type="text" placeholder="Custom currency symbol/code" value="${customVal}" class="${known === "Custom" ? "" : "hidden"}" style="margin-top:8px;" />
  `;
}

function calendarToggleHtml(id, selected) {
  return `
    <div class="party-tabs" id="${id}">
      <button type="button" class="nav-btn ${selected === "islamic" ? "active" : ""}" data-cal="islamic">Islamic Months</button>
      <button type="button" class="nav-btn ${selected === "gregorian" ? "active" : ""}" data-cal="gregorian">Gregorian Months</button>
    </div>
  `;
}

function readCurrencySelect(id) {
  const sel = el(id).value;
  if (sel === "Custom") return (el(id + "Custom").value || "Rs").trim() || "Rs";
  return sel;
}

function readCalendarToggle(id) {
  return el(id).querySelector(".nav-btn.active")?.dataset.cal || "islamic";
}

function wireCurrencySelect(id) {
  el(id).addEventListener("change", () => {
    el(id + "Custom").classList.toggle("hidden", el(id).value !== "Custom");
  });
}

function wireCalendarToggle(id) {
  el(id).querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      el(id).querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

// ---------------- Render ----------------

async function computeAutoAssets() {
  const bs = await loadBalanceSheet();
  return bs.cashInHand + bs.bankBalance + bs.stockValue + bs.receivables - bs.payables;
}

function startYearCardHtml(isRestart) {
  const { start, end } = currentRamadanBracket();
  return `
    <div class="card">
      <div class="card-title">${isRestart ? "Start a new Zakat year" : "No active Zakat year"}</div>
      <p class="muted">${dateStr(start)} — ${dateStr(end)}</p>
      ${formMode === "start" ? startFormHtml(start, end) :
        `<button class="btn-primary full-width" id="btnOpenStartForm">Calculate &amp; Start This Year</button>`}
    </div>
  `;
}

function startFormHtml(start, end) {
  const suggested = autoAssets > 0 ? Math.round(autoAssets) : 0;
  return `
    <p class="muted">Auto-calculated from Cash + Bank + Stock + Receivables − Payables. Adjust if needed:</p>
    <label>NET ZAKATABLE ASSETS</label>
    <input id="zkStartAssets" type="number" step="any" value="${suggested}" />
    <label>CURRENCY</label>
    ${currencySelectHtml("zkStartCurrency", "Rs")}
    <label>MONTHLY BREAKDOWN SHOWS</label>
    ${calendarToggleHtml("zkStartCalendar", "islamic")}
    <div class="button-row">
      <button class="btn-primary full-width" id="btnConfirmStart">Start</button>
      <button class="btn-secondary" id="btnCancelStart">Cancel</button>
    </div>
    <input type="hidden" id="zkStartFrom" value="${start}" />
    <input type="hidden" id="zkStartTo" value="${end}" />
  `;
}

function editFormHtml(year) {
  return `
    <div class="card">
      <div class="card-title">Edit Zakat Year</div>
      <label>NET ZAKATABLE ASSETS</label>
      <input id="zkEditAssets" type="number" step="any" value="${Math.round(year.assetsSnapshot)}" />
      <label>CURRENCY</label>
      ${currencySelectHtml("zkEditCurrency", year.currency)}
      <label>MONTHLY BREAKDOWN SHOWS</label>
      ${calendarToggleHtml("zkEditCalendar", year.calendarType)}
      <div class="button-row">
        <button class="btn-primary full-width" id="btnConfirmEdit">Save</button>
        <button class="btn-secondary" id="btnCancelEdit">Cancel</button>
      </div>
    </div>
  `;
}

function bigAmountRowHtml(label, amount, colorVar, currency) {
  return `<div class="row-between" style="padding:4px 0;">
    <span class="muted">${label}</span>
    <b style="color:${colorVar}; font-size:15px;">${money(amount, currency)}</b>
  </div>`;
}

function activeYearCardHtml(year, paid) {
  const remaining = Math.max(0, year.totalPayable - paid);
  const pct = year.totalPayable > 0 ? Math.min(100, Math.max(0, (paid / year.totalPayable) * 100)) : 0;
  return `
    <div class="card">
      <div class="row-between">
        <span class="muted">${dateStr(year.startDate)} — ${dateStr(year.endDate)}</span>
        <span id="btnOpenEdit" style="cursor:pointer; color:var(--navy); font-weight:700; font-size:12.5px;">✎ Edit</span>
      </div>
      ${bigAmountRowHtml("Total Zakat Payable", year.totalPayable, "var(--navy)", year.currency)}
      ${bigAmountRowHtml("Paid So Far", paid, "var(--teal)", year.currency)}
      ${bigAmountRowHtml("Remaining", remaining, remaining > 0 ? "var(--red)" : "var(--teal)", year.currency)}
      <div style="background:var(--border); border-radius:10px; height:10px; margin-top:10px; overflow:hidden;">
        <div style="background:var(--teal); height:100%; width:${pct}%;"></div>
      </div>
      <p class="muted" style="margin:6px 0 0;">${pct.toFixed(0)}% paid</p>
      ${remaining > 0 ? `
        <div class="button-row">
          <button class="btn-primary full-width" id="btnOpenPayment">Record Payment</button>
          <button class="btn-secondary" id="btnPayFull" style="background:var(--teal-bg); color:var(--teal-fg); flex:1;">Pay Remaining in Full</button>
        </div>
      ` : `<p style="color:var(--teal-fg); font-weight:800; margin-top:10px;">✅ Fully paid for this year</p>`}
    </div>
    ${formMode === "edit" ? editFormHtml(year) : ""}
    ${formMode === "payment" ? paymentFormHtml(year, remaining) : ""}
  `;
}

function paymentFormHtml(year, remaining) {
  const catOpts = CATEGORY_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  return `
    <div class="card">
      <div class="card-title">Record Payment</div>
      <label>AMOUNT <span class="muted">(remaining: ${money(remaining, year.currency)})</span></label>
      <input id="zkPayAmount" type="number" min="0" step="any" placeholder="0.00" />
      <label>METHOD</label>
      <select id="zkPayMethod"><option value="cash">Cash</option><option value="bank">Bank</option></select>
      <label>CATEGORY <span class="muted">(optional)</span></label>
      <select id="zkPayCategory">${catOpts}</select>
      <label>PAYMENT DATE</label>
      <input id="zkPayDate" type="date" value="${todayInputValue()}" />
      <label>NOTE <span class="muted">(optional)</span></label>
      <input id="zkPayNote" type="text" placeholder="Optional note" />
      <div class="button-row">
        <button class="btn-primary full-width" id="btnConfirmPayment">Save Payment</button>
        <button class="btn-secondary" id="btnCancelPayment">Cancel</button>
      </div>
    </div>
  `;
}

function monthlyBreakdownCardHtml(year) {
  const defaultMonthly = year.totalPayable / 12;
  let rows = "";
  let totalPlanned = 0, totalPaid = 0;
  for (let m = 1; m <= 12; m++) {
    const plan = getMonthPlan(year.serverId, m);
    const payableAmt = plan ? plan.payableAmount : defaultMonthly;
    const note = plan ? plan.note : "";
    const startM = monthStartMillis(year, m), endM = monthEndMillis(year, m);
    const paidM = payments.filter(p => p.paymentDate >= startM && p.paymentDate < endM).reduce((s, p) => s + (p.amount || 0), 0);
    totalPlanned += payableAmt; totalPaid += paidM;
    const covered = paidM >= payableAmt - 0.5;
    const remainingM = Math.max(0, payableAmt - paidM);
    rows += `
      <div class="card" style="cursor:pointer; margin-bottom:8px;" data-month="${m}">
        <div class="row-between">
          <b>${covered ? "✅" : "✎"} ${monthLabel(year, m)}</b>
          <b style="color:var(--navy);">${money(payableAmt, year.currency)}</b>
        </div>
        <div class="row-between" style="margin-top:4px;">
          <span class="muted" style="color:var(--teal-fg);">Paid: ${money(paidM, year.currency)}</span>
          <span class="muted" style="color:${remainingM > 0 ? "var(--red)" : "var(--teal-fg)"};">Remaining: ${money(remainingM, year.currency)}</span>
        </div>
        ${note ? `<p class="muted" style="margin:6px 0 0;">${note}</p>` : ""}
      </div>
      ${typeof formMode === "number" && formMode === m ? monthFormHtml(year, m, plan, defaultMonthly) : ""}
    `;
  }
  return `
    <h3 class="section-label">MONTHLY BREAKDOWN</h3>
    <p class="muted">Tap a month to set its amount and add a note.</p>
    ${rows}
    <div class="card">
      <div class="card-title">Year-End Totals (from monthly schedule)</div>
      ${bigAmountRowHtml("Total Planned Payable", totalPlanned, "var(--navy)", year.currency)}
      ${bigAmountRowHtml("Total Paid (this schedule)", totalPaid, "var(--teal)", year.currency)}
      ${bigAmountRowHtml("Remaining (this schedule)", Math.max(0, totalPlanned - totalPaid), "var(--red)", year.currency)}
    </div>
  `;
}

function monthFormHtml(year, m, plan, suggested) {
  return `
    <div class="card">
      <div class="card-title">${monthLabel(year, m)}</div>
      <label>PAYABLE AMOUNT FOR THIS MONTH</label>
      <input id="zkMonthAmount" type="number" step="any" value="${Math.round(plan ? plan.payableAmount : suggested)}" />
      <label>DESCRIPTION / NOTE <span class="muted">(optional)</span></label>
      <input id="zkMonthNote" type="text" value="${plan ? plan.note.replace(/"/g, "&quot;") : ""}" />
      <div class="button-row">
        <button class="btn-primary full-width" id="btnConfirmMonth" data-month="${m}">Save</button>
        <button class="btn-secondary" id="btnCancelMonth">Cancel</button>
      </div>
    </div>
  `;
}

function paymentHistoryCardHtml(year) {
  if (!payments.length) {
    return `<h3 class="section-label">PAYMENT HISTORY</h3><p class="muted">No payments recorded yet.</p>`;
  }
  const catLabels = Object.fromEntries(CATEGORY_OPTIONS);
  const rows = payments.map(p => {
    const meta = [p.method ? p.method.toUpperCase() : "", catLabels[p.category] || "", p.note || ""].filter(Boolean).join("  •  ");
    return `
      <div class="card">
        <div class="row-between">
          <span class="muted">${dateStr(p.paymentDate)}</span>
          <b style="color:var(--teal-fg);">${money(p.amount, year.currency)}</b>
        </div>
        ${meta ? `<p class="muted" style="margin:4px 0 0;">${meta}</p>` : ""}
      </div>
    `;
  }).join("");
  return `<h3 class="section-label">PAYMENT HISTORY</h3>${rows}`;
}

const ZAKAT_NOTE = `<p class="muted" style="margin:14px 0;">
  Note: this uses a standard estimate (cash + bank + stock at cost + receivables − payables) × 2.5%.
  Confirm anything business-specific with your own mufti/scholar, especially Nisab and stock valuation.
</p>`;

async function render() {
  const box = el("zakatBox");
  if (!box) return;
  box.innerHTML = "<p class='muted'>Loading…</p>";

  autoAssets = await computeAutoAssets();
  latestYear = await loadLatestZakatYear();
  const now = Date.now();

  if (!latestYear || now >= latestYear.endDate) {
    payments = [];
    box.innerHTML = startYearCardHtml(false) + ZAKAT_NOTE;
    wireStartForm();
    return;
  }

  payments = await loadZakatPayments(latestYear.serverId);
  const paid = payments.reduce((s, p) => s + (p.amount || 0), 0);

  box.innerHTML =
    activeYearCardHtml(latestYear, paid) +
    monthlyBreakdownCardHtml(latestYear) +
    paymentHistoryCardHtml(latestYear) +
    startYearCardHtml(true) +
    ZAKAT_NOTE;

  wireActiveYear(latestYear, paid);
  wireMonthly(latestYear);
  wireStartForm();
}

// ---------------- Event wiring ----------------

function wireStartForm() {
  const openBtn = el("btnOpenStartForm");
  if (openBtn) openBtn.addEventListener("click", () => { formMode = "start"; render(); });

  const cancelBtn = el("btnCancelStart");
  if (cancelBtn) cancelBtn.addEventListener("click", () => { formMode = null; render(); });

  const confirmBtn = el("btnConfirmStart");
  if (confirmBtn) {
    wireCurrencySelect("zkStartCurrency");
    wireCalendarToggle("zkStartCalendar");
    confirmBtn.addEventListener("click", async () => {
      const assets = parseFloat(el("zkStartAssets").value);
      if (isNaN(assets) || assets < 0) { showToast("Sahi amount likhein"); return; }
      const start = parseInt(el("zkStartFrom").value, 10);
      const end = parseInt(el("zkStartTo").value, 10);
      const currency = readCurrencySelect("zkStartCurrency");
      const calendarType = readCalendarToggle("zkStartCalendar");
      try {
        await saveZakatYear({ startDate: start, endDate: end, assetsSnapshot: assets, totalPayable: assets * 0.025, currency, calendarType });
        showToast("Zakat year shuru ho gaya");
        formMode = null;
        render();
      } catch (e) {
        showToast("Save nahi ho saka: " + e.message);
      }
    });
  }
}

function wireActiveYear(year, paid) {
  const editBtn = el("btnOpenEdit");
  if (editBtn) editBtn.addEventListener("click", () => { formMode = formMode === "edit" ? null : "edit"; render(); });

  const openPay = el("btnOpenPayment");
  if (openPay) openPay.addEventListener("click", () => { formMode = formMode === "payment" ? null : "payment"; render(); });

  const payFull = el("btnPayFull");
  if (payFull) payFull.addEventListener("click", async () => {
    const remaining = Math.max(0, year.totalPayable - paid);
    try {
      await saveZakatPayment(year, { amount: remaining, method: "cash", note: "Full remaining balance", category: "", paymentDate: Date.now() });
      showToast("Payment save ho gayi");
      formMode = null;
      render();
    } catch (e) { showToast("Save nahi ho saka: " + e.message); }
  });

  if (formMode === "edit") {
    wireCurrencySelect("zkEditCurrency");
    wireCalendarToggle("zkEditCalendar");
    el("btnCancelEdit").addEventListener("click", () => { formMode = null; render(); });
    el("btnConfirmEdit").addEventListener("click", async () => {
      const assets = parseFloat(el("zkEditAssets").value);
      if (isNaN(assets) || assets < 0) { showToast("Sahi amount likhein"); return; }
      const currency = readCurrencySelect("zkEditCurrency");
      const calendarType = readCalendarToggle("zkEditCalendar");
      try {
        await updateZakatYear(year.serverId, { assetsSnapshot: assets, totalPayable: assets * 0.025, currency, calendarType });
        showToast("Zakat year update ho gaya");
        formMode = null;
        render();
      } catch (e) { showToast("Save nahi ho saka: " + e.message); }
    });
  }

  if (formMode === "payment") {
    el("btnCancelPayment").addEventListener("click", () => { formMode = null; render(); });
    el("btnConfirmPayment").addEventListener("click", async () => {
      const amt = parseFloat(el("zkPayAmount").value);
      if (isNaN(amt) || amt <= 0) { showToast("Sahi amount likhein"); return; }
      const method = el("zkPayMethod").value;
      const category = el("zkPayCategory").value;
      const note = el("zkPayNote").value.trim();
      const dateVal = el("zkPayDate").value;
      const paymentDate = dateVal ? new Date(dateVal + "T12:00:00").getTime() : Date.now();
      try {
        await saveZakatPayment(year, { amount: amt, method, note, category, paymentDate });
        showToast("Payment save ho gayi");
        formMode = null;
        render();
      } catch (e) { showToast("Save nahi ho saka: " + e.message); }
    });
  }
}

function wireMonthly(year) {
  document.querySelectorAll("#zakatBox [data-month]").forEach(row => {
    if (row.id === "btnConfirmMonth") return;
    row.addEventListener("click", (evt) => {
      if (evt.target.closest("#btnConfirmMonth") || evt.target.closest("#btnCancelMonth")) return;
      const m = parseInt(row.dataset.month, 10);
      formMode = formMode === m ? null : m;
      render();
    });
  });

  if (typeof formMode === "number") {
    const confirmBtn = document.getElementById("btnConfirmMonth");
    const cancelBtn = document.getElementById("btnCancelMonth");
    if (cancelBtn) cancelBtn.addEventListener("click", (evt) => { evt.stopPropagation(); formMode = null; render(); });
    if (confirmBtn) confirmBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      const m = parseInt(confirmBtn.dataset.month, 10);
      const amt = parseFloat(el("zkMonthAmount").value);
      if (isNaN(amt) || amt < 0) { showToast("Sahi amount likhein"); return; }
      const note = el("zkMonthNote").value.trim();
      setMonthPlan(year.serverId, m, amt, note);
      showToast("Month update ho gaya");
      formMode = null;
      render();
    });
  }
}

export function initZakatScreen() {
  // Nothing to wire up-front — the whole screen is rendered on demand by
  // renderZakatScreen() (same reason app.js calls it from showScreen()
  // rather than once at boot: figures can go stale between visits).
}

export function renderZakatScreen() {
  formMode = null;
  render();
}
