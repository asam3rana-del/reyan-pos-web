// ================================================================
// shellLedger.js — "Shell Ledger" screen (mirrors Android's
// ShellLedgerActivity.kt: refundable empty-shell/crate deposits customers
// owe the shop). Issue/Return toggle + customer autocomplete (create-if-new,
// same as ShellLedgerActivity's own save flow) + a small separate "Shop
// Stock" card for the shop's own running count of empty shells in hand.
// Backend is data.js's shellCustomers/startShellCustomerListener()/
// saveShellTransaction()/loadShellTransactionsForCustomer()/
// saveShopEmptyShellLog()/loadShopEmptyShellLog() (already written).
// ================================================================

import {
  shellCustomers, startShellCustomerListener, saveShellTransaction,
  loadShellTransactionsForCustomer, saveShopEmptyShellLog, loadShopEmptyShellLog
} from "./data.js";
import { showToast } from "./ui.js";

function el(id) { return document.getElementById(id); }

let isIssue = true;
let selectedCustomer = null; // an existing shellCustomers row once picked from suggestions, else null (brand-new name)

function setDirection(issue) {
  isIssue = issue;
  el("btnShellIssue").classList.toggle("active", issue);
  el("btnShellReturn").classList.toggle("active", !issue);
}

function renderCustomerSuggestions(q) {
  const box = el("shellCustomerSuggestions");
  if (!q) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  const matches = shellCustomers.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  if (!matches.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.innerHTML = "";
  matches.forEach(c => {
    const d = document.createElement("div");
    d.textContent = `${c.name} — owed ${c.shellsOwed || 0}`;
    d.addEventListener("click", () => {
      selectedCustomer = c;
      el("shellCustomerName").value = c.name;
      el("shellCustomerPhone").value = c.phone || "";
      el("shellNewCustomerPhoneField").classList.add("hidden");
      box.classList.add("hidden");
    });
    box.appendChild(d);
  });
  box.classList.remove("hidden");
}

function resetForm() {
  selectedCustomer = null;
  el("shellCustomerName").value = "";
  el("shellCustomerPhone").value = "";
  el("shellQty").value = "";
  el("shellNote").value = "";
  el("shellNewCustomerPhoneField").classList.remove("hidden");
}

function renderCustomerList() {
  const box = el("shellCustomerList");
  const q = (el("shellCustomerSearch").value || "").trim().toLowerCase();
  const list = shellCustomers
    .filter(c => !q || c.name.toLowerCase().includes(q))
    .slice().sort((a, b) => a.name.localeCompare(b.name));
  box.innerHTML = "";
  if (!list.length) { box.innerHTML = "<p class='muted'>Koi customer nahi hai.</p>"; return; }
  list.forEach(c => {
    const owed = c.shellsOwed || 0;
    const div = document.createElement("div");
    div.className = "card row-between";
    div.style.cursor = "pointer";
    div.innerHTML = `
      <div>
        <div><b>${c.name}</b></div>
        <div class="muted">${c.phone || ""}</div>
      </div>
      <div class="stat-card ${owed > 0 ? "stat-red" : "stat-teal"}" style="padding:6px 12px;">${owed}</div>
    `;
    div.addEventListener("click", () => openCustomerHistory(c));
    box.appendChild(div);
  });
}

async function openCustomerHistory(c) {
  el("shellHistoryCard").classList.remove("hidden");
  el("shellHistoryTitle").textContent = `${c.name} — Transaction History`;
  const box = el("shellHistoryList");
  box.innerHTML = "Loading…";
  const list = await loadShellTransactionsForCustomer(c.id);
  if (!list.length) { box.innerHTML = "<p class='muted'>Koi transaction nahi hai.</p>"; return; }
  box.innerHTML = "";
  list.forEach(t => {
    const isI = t.type === "ISSUE";
    const div = document.createElement("div");
    div.className = "card row-between";
    div.innerHTML = `
      <div>
        <div><b>${isI ? "Issued" : "Returned"}</b>${t.note ? " — " + t.note : ""}</div>
        <div class="muted">${new Date(t.createdAt).toLocaleString()}</div>
      </div>
      <div style="color:${isI ? "var(--red-fg)" : "var(--teal-fg)"}; font-weight:800;">
        ${isI ? "+" : "-"}${t.qty}
      </div>
    `;
    box.appendChild(div);
  });
}

async function renderShopStock() {
  const list = await loadShopEmptyShellLog();
  const total = list.reduce((sum, l) => sum + (l.delta || 0), 0);
  el("shopShellCount").textContent = total.toLocaleString("en-PK");

  const box = el("shopShellLogList");
  box.innerHTML = "";
  if (!list.length) { box.innerHTML = "<p class='muted'>Koi log nahi hai.</p>"; return; }
  list.slice(0, 20).forEach(l => {
    const positive = (l.delta || 0) >= 0;
    const div = document.createElement("div");
    div.className = "card row-between";
    div.innerHTML = `
      <div>
        <div>${l.reason || ""}${l.note ? " — " + l.note : ""}</div>
        <div class="muted">${new Date(l.createdAt).toLocaleString()}</div>
      </div>
      <div style="color:${positive ? "var(--teal-fg)" : "var(--red-fg)"}; font-weight:800;">
        ${positive ? "+" : ""}${l.delta}
      </div>
    `;
    box.appendChild(div);
  });
}

async function adjustShopStock(sign) {
  const qtyStr = prompt(sign > 0 ? "Kitne shells add karne hain?" : "Kitne shells remove karne hain?");
  if (qtyStr === null) return;
  const qty = parseFloat(qtyStr);
  if (!qty || qty <= 0) { showToast("Sahi quantity likhein"); return; }
  try {
    await saveShopEmptyShellLog(sign * qty, sign > 0 ? "MANUAL_ADD" : "MANUAL_REMOVE", "");
    renderShopStock();
  } catch (e) {
    showToast("Error: " + e.message);
  }
}

export function initShellLedgerScreen() {
  setDirection(true);
  el("btnShellIssue").addEventListener("click", () => setDirection(true));
  el("btnShellReturn").addEventListener("click", () => setDirection(false));

  el("shellCustomerName").addEventListener("input", () => {
    selectedCustomer = null;
    el("shellNewCustomerPhoneField").classList.remove("hidden");
    renderCustomerSuggestions(el("shellCustomerName").value.trim());
  });

  el("btnSaveShellTransaction").addEventListener("click", async () => {
    const name = el("shellCustomerName").value.trim();
    const qty = parseFloat(el("shellQty").value) || 0;
    if (!name) { showToast("Customer name likhein"); return; }
    if (qty <= 0) { showToast("Qty 0 se zyada honi chahiye"); return; }

    el("btnSaveShellTransaction").disabled = true;
    try {
      await saveShellTransaction({
        customerName: name, phone: el("shellCustomerPhone").value.trim(),
        isIssue, qty, note: el("shellNote").value.trim()
      });
      showToast(isIssue ? "Shells issue ho gaye" : "Shells return ho gaye");
      resetForm();
      renderCustomerList();
    } catch (e) {
      showToast("Error: " + e.message);
    } finally {
      el("btnSaveShellTransaction").disabled = false;
    }
  });

  el("shellCustomerSearch").addEventListener("input", renderCustomerList);
  el("btnCloseShellHistory").addEventListener("click", () => el("shellHistoryCard").classList.add("hidden"));
  el("btnShopShellAdd").addEventListener("click", () => adjustShopStock(1));
  el("btnShopShellRemove").addEventListener("click", () => adjustShopStock(-1));

  startShellCustomerListener(renderCustomerList);
}

export function refreshShellLedgerScreen() {
  renderCustomerList();
  renderShopStock();
}
