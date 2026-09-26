import {
  customers, suppliers, saveCustomer, saveSupplier, deleteCustomer, deleteSupplier,
  loadPartyTransactions, loadPartyPayments, savePartyPayment
} from "./data.js";
import { showToast } from "./ui.js";
import { printSaleReceipt, printPurchaseReceipt } from "./print.js";

let activeType = "customer";  // "customer" | "supplier"
let editingId = null;         // doc id being edited, or null for "add new"
let viewingParty = null;      // the party object currently open in detail view, or null

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function currentList() {
  return activeType === "customer" ? customers : suppliers;
}

function resetForm() {
  editingId = null;
  el("partyFormTitle").textContent = activeType === "customer" ? "+ Add Customer" : "+ Add Supplier";
  el("partyName").value = "";
  el("partyPhone").value = "";
  el("partyOpeningBalance").value = 0;
  el("partyCreditLimit").value = 0;
  el("btnCancelPartyEdit").classList.add("hidden");
  el("btnSaveParty").textContent = "SAVE";
}

function switchType(type) {
  activeType = type;
  el("tabCustomers").classList.toggle("active", type === "customer");
  el("tabSuppliers").classList.toggle("active", type === "supplier");
  el("creditLimitField").classList.toggle("hidden", type !== "customer");
  el("partySearch").value = "";
  resetForm();
  renderList();
}

function startEdit(party) {
  editingId = party.id;
  el("partyFormTitle").textContent = "Edit " + (activeType === "customer" ? "Customer" : "Supplier");
  el("partyName").value = party.name || "";
  el("partyPhone").value = party.phone || "";
  el("partyOpeningBalance").value = party.openingBalance || 0;
  el("partyCreditLimit").value = party.creditLimit || 0;
  el("btnCancelPartyEdit").classList.remove("hidden");
  el("btnSaveParty").textContent = "SAVE CHANGES";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function handleDelete(party) {
  const label = activeType === "customer" ? "customer" : "supplier";
  if (!confirm(`"${party.name}" ${label} ko delete kar dein?`)) return;
  try {
    if (activeType === "customer") await deleteCustomer(party.id);
    else await deleteSupplier(party.id);
    showToast((activeType === "customer" ? "Customer" : "Supplier") + " delete ho gaya");
    if (editingId === party.id) resetForm();
    renderList();
  } catch (e) {
    showToast("Delete nahi ho saka: " + e.message);
  }
}

function renderList() {
  const box = el("partyList");
  const q = (el("partySearch").value || "").trim().toLowerCase();
  const list = currentList()
    .filter(p => !q || (p.name || "").toLowerCase().includes(q) || (p.phone || "").includes(q))
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = "<p class='muted'>Koi record nahi mila.</p>";
    return;
  }

  list.forEach(p => {
    const balance = p.balance || 0;
    const owesLabel = activeType === "customer" ? "You'll get" : "You'll give";
    const div = document.createElement("div");
    div.className = "card row-between party-row";
    div.innerHTML = `
      <div>
        <div><b>${p.name}</b></div>
        <div class="muted">${p.phone || "—"}</div>
      </div>
      <div style="text-align:right">
        <div style="color: ${balance > 0 ? "var(--teal-fg)" : "var(--text-muted)"}; font-weight:800;">
          ${money(Math.abs(balance))} ${balance > 0 ? "· " + owesLabel : ""}
        </div>
        <div class="party-row-actions">
          <span class="party-view" data-id="${p.id}">View</span>
          <span class="party-edit" data-id="${p.id}">Edit</span>
          <span class="party-delete" data-id="${p.id}">Delete</span>
        </div>
      </div>
    `;
    box.appendChild(div);
  });

  box.querySelectorAll(".party-view").forEach(elm => {
    elm.addEventListener("click", () => {
      const p = currentList().find(x => x.id === elm.dataset.id);
      if (p) openPartyDetail(p);
    });
  });
  box.querySelectorAll(".party-edit").forEach(elm => {
    elm.addEventListener("click", () => {
      const p = currentList().find(x => x.id === elm.dataset.id);
      if (p) startEdit(p);
    });
  });
  box.querySelectorAll(".party-delete").forEach(elm => {
    elm.addEventListener("click", () => {
      const p = currentList().find(x => x.id === elm.dataset.id);
      if (p) handleDelete(p);
    });
  });
}

// ================================================================
// Party detail view — this party's sales/purchases + payments merged
// chronologically, plus Receive Payment (customer) / Make Payment (supplier).
// Mirrors the Android app's PartyTransactionActivity, minus its per-line
// billed-items edit/delete dialog (out of scope for this round).
// ================================================================

function openPartyDetail(party) {
  viewingParty = party;
  el("partyListView").classList.add("hidden");
  el("partyDetailView").classList.remove("hidden");
  el("partyPaymentCard").classList.add("hidden");
  el("btnPartyRecordPayment").textContent = activeType === "customer" ? "💰 Record Receive Payment" : "💰 Record Make Payment";
  el("partyPaymentTitle").textContent = activeType === "customer" ? "Receive Payment" : "Make Payment";
  renderPartyDetailHeader();
  renderPartyTransactions();
}

function closePartyDetail() {
  viewingParty = null;
  el("partyDetailView").classList.add("hidden");
  el("partyListView").classList.remove("hidden");
  renderList(); // balance may have changed from a payment just recorded
}

function renderPartyDetailHeader() {
  const p = viewingParty;
  const balance = p.balance || 0;
  const owesLabel = activeType === "customer" ? "You'll get" : "You'll give";
  el("partyDetailHeader").innerHTML = `
    <div class="card-title">${p.name}</div>
    <div class="muted">${p.phone || "—"}</div>
    <div style="margin-top:8px; font-weight:800; font-size:16px; color:${balance > 0 ? "var(--teal-fg)" : "var(--text-muted)"};">
      ${money(Math.abs(balance))} ${balance !== 0 ? "· " + owesLabel : ""}
    </div>
  `;
}

async function renderPartyTransactions() {
  const box = el("partyTransactionsList");
  box.innerHTML = "<p class='muted'>Loading…</p>";
  const p = viewingParty;

  const [bills, payments] = await Promise.all([
    loadPartyTransactions(p.id, activeType),
    loadPartyPayments(p.id, activeType)
  ]);
  const entries = [...bills, ...payments].sort((a, b) => b.createdAt - a.createdAt);

  box.innerHTML = "";
  if (!entries.length) { box.innerHTML = "<p class='muted'>Abhi tak koi transaction nahi.</p>"; return; }

  entries.forEach(entry => box.appendChild(partyTxRow(entry)));
}

function partyTxRow(entry) {
  const div = document.createElement("div");
  div.className = "card row-between";
  const when = new Date(entry.createdAt).toLocaleString();

  if (entry.kind === "payment") {
    const label = entry.partyType === "customer" ? "Payment Received" : "Payment Made";
    div.innerHTML = `
      <div>
        <div><b>💰 ${label}</b></div>
        <div class="muted">${entry.method}${entry.note ? " · " + entry.note : ""} · ${when}</div>
      </div>
      <div style="font-weight:800; color:var(--teal-fg)">${money(entry.amount)}</div>
    `;
    return div;
  }

  const isSale = entry.kind === "sale";
  const label = isSale ? `🛒 Sale — ${entry.invoice}` : `🧾 Purchase — ${entry.billNo}`;
  const statusNote = entry.status !== "active" ? " · " + entry.status : "";
  div.innerHTML = `
    <div>
      <div><b>${label}</b></div>
      <div class="muted">${when} · ${entry.itemCount || 0} items${statusNote}</div>
    </div>
    <div style="text-align:right">
      <div style="font-weight:800;">${money(entry.total)}</div>
      <span class="party-tx-print">🖨 Print</span>
    </div>
  `;
  div.querySelector(".party-tx-print").addEventListener("click", () => {
    if (isSale) printSaleReceipt(entry, viewingParty.name);
    else printPurchaseReceipt(entry, viewingParty.name);
  });
  return div;
}

function initPartyPaymentForm() {
  el("btnPartyDetailBack").addEventListener("click", closePartyDetail);

  el("btnPartyRecordPayment").addEventListener("click", () => {
    el("paymentAmount").value = "";
    el("paymentMethod").value = "cash";
    el("paymentNote").value = "";
    el("partyPaymentCard").classList.remove("hidden");
    el("paymentAmount").focus();
  });
  el("btnCancelPayment").addEventListener("click", () => el("partyPaymentCard").classList.add("hidden"));

  el("btnSavePayment").addEventListener("click", async () => {
    const amount = parseFloat(el("paymentAmount").value) || 0;
    if (amount <= 0) { showToast("Sahi amount likhein"); return; }
    const method = el("paymentMethod").value;
    const note = el("paymentNote").value.trim();

    el("btnSavePayment").disabled = true;
    try {
      await savePartyPayment({
        partyId: viewingParty.id, partyType: activeType, partyName: viewingParty.name,
        amount, method, note
      });
      showToast("Payment save ho gayi");
      el("partyPaymentCard").classList.add("hidden");
      // Pull the freshly-updated balance from the live `customers`/`suppliers` cache
      // (the listener's onSnapshot will have already applied the increment by now).
      const fresh = currentList().find(x => x.id === viewingParty.id);
      if (fresh) viewingParty = fresh;
      renderPartyDetailHeader();
      renderPartyTransactions();
    } catch (e) {
      showToast("Error: " + e.message);
    } finally {
      el("btnSavePayment").disabled = false;
    }
  });
}

export function initPartiesScreen() {
  initPartyPaymentForm();

  el("tabCustomers").addEventListener("click", () => switchType("customer"));
  el("tabSuppliers").addEventListener("click", () => switchType("supplier"));
  el("partySearch").addEventListener("input", renderList);
  el("btnCancelPartyEdit").addEventListener("click", resetForm);

  el("btnSaveParty").addEventListener("click", async () => {
    const name = el("partyName").value.trim();
    if (!name) { showToast("Naam likhna zaroori hai"); return; }
    const phone = el("partyPhone").value.trim();
    const openingBalance = parseFloat(el("partyOpeningBalance").value) || 0;
    const creditLimit = parseFloat(el("partyCreditLimit").value) || 0;

    el("btnSaveParty").disabled = true;
    try {
      if (activeType === "customer") {
        await saveCustomer({ id: editingId, name, phone, creditLimit, openingBalance });
        showToast(editingId ? "Customer update ho gaya" : "Customer add ho gaya");
      } else {
        await saveSupplier({ id: editingId, name, phone, openingBalance });
        showToast(editingId ? "Supplier update ho gaya" : "Supplier add ho gaya");
      }
      resetForm();
      renderList();
    } catch (e) {
      showToast("Save nahi ho saka: " + e.message);
    } finally {
      el("btnSaveParty").disabled = false;
    }
  });

  switchType("customer");
}

// Used by Party Dashboard: jump straight to a party's detail view (as if the
// user had switched tabs + clicked "View" themselves) after showScreen("parties").
export function openPartyById(id, isCustomer) {
  activeType = isCustomer ? "customer" : "supplier";
  el("tabCustomers").classList.toggle("active", activeType === "customer");
  el("tabSuppliers").classList.toggle("active", activeType === "supplier");
  el("creditLimitField").classList.toggle("hidden", activeType !== "customer");
  const p = currentList().find(x => x.id === id);
  if (p) openPartyDetail(p);
}

export function refreshPartiesList() {
  if (viewingParty) {
    const fresh = currentList().find(x => x.id === viewingParty.id);
    if (fresh) viewingParty = fresh;
    renderPartyDetailHeader();
  } else {
    renderList();
  }
}
