import {
  customers, suppliers, saveCustomer, saveSupplier, deleteCustomer, deleteSupplier
} from "./data.js";
import { showToast } from "./ui.js";

let activeType = "customer";  // "customer" | "supplier"
let editingId = null;         // doc id being edited, or null for "add new"

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
          <span class="party-edit" data-id="${p.id}">Edit</span>
          <span class="party-delete" data-id="${p.id}">Delete</span>
        </div>
      </div>
    `;
    box.appendChild(div);
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

export function initPartiesScreen() {
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

export function refreshPartiesList() {
  renderList();
}
