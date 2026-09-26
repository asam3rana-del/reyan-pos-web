import { products, customers, saveSale } from "./data.js";
import { unitNames, toSmallestUnits } from "./firebase-init.js";
import { showToast } from "./ui.js";
import { printSaleReceipt } from "./print.js";
import { holdBill, showRecallModal, heldCount } from "./heldBills.js";

let cart = [];       // [{barcode, product, qty, unit, unitPrice, cost, amount, conversionFactor}]
let selectedProduct = null;
let lastSavedSale = null; // { invoice, customerName, receipt } — set after a successful save, for the Print button

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function el(id) { return document.getElementById(id); }

function renderCustomerList() {
  const dl = el("customerList");
  dl.innerHTML = "";
  customers.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    dl.appendChild(opt);
  });
}

function renderSuggestions(matches) {
  const box = el("itemSuggestions");
  if (!matches.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.innerHTML = "";
  matches.slice(0, 8).forEach(p => {
    const d = document.createElement("div");
    d.textContent = `${p.name} — Rs ${p.salePrice} (${p.unit}, stock ${p.stock})`;
    d.addEventListener("click", () => selectProduct(p));
    box.appendChild(d);
  });
  box.classList.remove("hidden");
}

function selectProduct(p) {
  selectedProduct = p;
  el("itemSearch").value = p.name;
  el("itemSuggestions").classList.add("hidden");

  const unitSel = el("itemUnit");
  unitSel.innerHTML = "";
  unitNames(p).forEach(u => {
    const opt = document.createElement("option");
    opt.value = u; opt.textContent = u;
    unitSel.appendChild(opt);
  });
  // default rate: wholesale if that sale type is selected and the product has one
  const saleType = el("saleType").value;
  const rate = (saleType === "wholesale" && p.wholesalePrice > 0) ? p.wholesalePrice : p.salePrice;
  el("itemRate").value = rate || "";
  recalcLineAmount();
}

function recalcLineAmount() {
  const qty = parseFloat(el("itemQty").value) || 0;
  const rate = parseFloat(el("itemRate").value) || 0;
  el("lineAmount").textContent = money(qty * rate);
}

function renderCart() {
  const list = el("cartList");
  list.innerHTML = "";
  cart.forEach((line, idx) => {
    const div = document.createElement("div");
    div.className = "cart-line";
    div.innerHTML = `
      <div class="cart-line-top"><span>${line.product}</span><span>${money(line.amount)}</span></div>
      <div class="cart-line-sub">Qty: ${line.qty} ${line.unit} · Rate: ${line.unitPrice}</div>
      <span class="cart-line-remove" data-idx="${idx}">✕ Remove</span>
    `;
    list.appendChild(div);
  });
  list.querySelectorAll(".cart-line-remove").forEach(elm => {
    elm.addEventListener("click", () => {
      cart.splice(parseInt(elm.dataset.idx), 1);
      renderCart();
      recalcTotals();
    });
  });
  el("cartCount").textContent = cart.length;
}

function recalcTotals() {
  const subtotal = cart.reduce((s, l) => s + l.amount, 0);
  const discount = parseFloat(el("saleDiscount").value) || 0;
  const total = Math.max(0, subtotal - discount);
  const paid = parseFloat(el("salePaid").value) || 0;
  const due = Math.max(0, total - paid);

  el("sumSubtotal").textContent = money(subtotal);
  el("sumTotal").textContent = money(total);
  el("sumDue").textContent = money(due);
  el("saleDueDateCard").classList.toggle("hidden", due <= 0);
  return { subtotal, discount, total, paid, due };
}

function resetForm() {
  cart = [];
  selectedProduct = null;
  el("itemSearch").value = "";
  el("itemQty").value = 0;
  el("itemRate").value = "";
  el("itemUnit").innerHTML = "";
  el("saleDiscount").value = 0;
  el("salePaid").value = 0;
  el("saleCustomer").value = "cash";
  el("saleDueDate").value = "";
  renderCart();
  recalcTotals();
  recalcLineAmount();
}

function updateHeldBadge() {
  const badge = el("heldSaleCount");
  if (badge) badge.textContent = heldCount("sale");
}

// Captures everything needed to fully rebuild this screen later — used by
// Hold Bill; the inverse of this is applyHeldState() below.
function captureState() {
  const totals = recalcTotals();
  return {
    cart: cart.map(l => ({ ...l })),
    customerName: el("saleCustomer").value,
    saleType: el("saleType").value,
    discount: totals.discount,
    paid: totals.paid,
    paymentMethod: el("paymentMethod").value,
    dueDate: el("saleDueDate").value,
    total: totals.total
  };
}

function applyHeldState(state) {
  cart = (state.cart || []).map(l => ({ ...l }));
  selectedProduct = null;
  el("itemSearch").value = "";
  el("itemQty").value = 0;
  el("itemRate").value = "";
  el("itemUnit").innerHTML = "";
  el("saleCustomer").value = state.customerName || "cash";
  el("saleType").value = state.saleType || "retail";
  el("saleDiscount").value = state.discount || 0;
  el("salePaid").value = state.paid || 0;
  el("paymentMethod").value = state.paymentMethod || "Cash";
  el("saleDueDate").value = state.dueDate || "";
  renderCart();
  recalcTotals();
  recalcLineAmount();
}

export function initSaleScreen() {
  renderCustomerList();

  el("itemSearch").addEventListener("input", () => {
    const q = el("itemSearch").value.trim().toLowerCase();
    if (!q) { el("itemSuggestions").classList.add("hidden"); return; }
    const matches = products.filter(p => p.name.toLowerCase().includes(q));
    renderSuggestions(matches);
  });

  el("itemQty").addEventListener("input", recalcLineAmount);
  el("itemRate").addEventListener("input", recalcLineAmount);
  el("saleDiscount").addEventListener("input", recalcTotals);
  el("salePaid").addEventListener("input", recalcTotals);
  el("saleType").addEventListener("change", () => { if (selectedProduct) selectProduct(selectedProduct); });

  el("btnAddItem").addEventListener("click", () => {
    if (!selectedProduct) { showToast("Pehle item select karein"); return; }
    const qty = parseFloat(el("itemQty").value) || 0;
    const unit = el("itemUnit").value;
    const rate = parseFloat(el("itemRate").value) || 0;
    if (qty <= 0) { showToast("Quantity 0 se zyada honi chahiye"); return; }

    const smallest = toSmallestUnits(selectedProduct, qty, unit);
    if (smallest > (selectedProduct.stock || 0)) {
      showToast(`Sirf ${selectedProduct.stock} ${selectedProduct.unit === unit ? unit : "smallest units"} stock mein hai`);
    }

    cart.push({
      barcode: selectedProduct.barcode,
      product: selectedProduct.name,
      qty, unit, unitPrice: rate,
      cost: selectedProduct.cost || 0,
      amount: qty * rate,
      conversionFactor: smallest / qty
    });
    renderCart();
    recalcTotals();

    // reset item-entry fields, ready for the next item (like the Android app does)
    selectedProduct = null;
    el("itemSearch").value = "";
    el("itemQty").value = 0;
    el("itemRate").value = "";
    el("itemUnit").innerHTML = "";
    el("itemSearch").focus();
  });

  el("btnClearSale").addEventListener("click", () => {
    if (confirm("Poori sale clear kar dein?")) resetForm();
  });

  el("btnSaveSale").addEventListener("click", async () => {
    if (!cart.length) { showToast("Cart khali hai"); return; }
    const totals = recalcTotals();
    const customerName = el("saleCustomer").value;
    const paymentMethod = el("paymentMethod").value;
    // Due date is only meaningful when something is actually owed — ignore a
    // stray value left in the field if paid was bumped back up to full before saving.
    const dueDateStr = el("saleDueDate").value;
    const dueDate = (totals.due > 0 && dueDateStr) ? new Date(dueDateStr + "T00:00:00").getTime() : 0;
    el("btnSaveSale").disabled = true;
    try {
      const invoice = await saveSale({
        lines: cart,
        customerName,
        saleType: el("saleType").value,
        subtotal: totals.subtotal,
        discount: totals.discount,
        total: totals.total,
        paid: totals.paid,
        paymentMethod,
        dueDate
      });
      // Receipt-shaped snapshot for the Print button — built from what we already
      // have in the browser rather than re-fetching, since saveSale() only returns
      // the invoice number (see data.js).
      lastSavedSale = {
        invoice,
        customerName,
        receipt: {
          invoice, createdAt: Date.now(), items: cart.map(l => ({ ...l })),
          subtotal: totals.subtotal, discount: totals.discount, total: totals.total,
          paid: totals.paid, paymentMethod
        }
      };
      el("btnPrintLastSale").classList.remove("hidden");
      showToast(`Sale saved — Invoice ${invoice}`);
      resetForm();
    } catch (e) {
      showToast("Save nahi ho saka: " + e.message);
    } finally {
      el("btnSaveSale").disabled = false;
    }
  });

  el("btnPrintLastSale").addEventListener("click", () => {
    if (!lastSavedSale) return;
    printSaleReceipt(lastSavedSale.receipt, lastSavedSale.customerName);
  });

  el("btnHoldSale")?.addEventListener("click", () => {
    if (!cart.length) { showToast("Cart khali hai — hold karne ke liye pehle item add karein"); return; }
    const state = captureState();
    const label = `${state.customerName === "cash" ? "Cash" : state.customerName} — ${cart.length} item(s)`;
    holdBill("sale", label, state);
    updateHeldBadge();
    showToast("Sale hold ho gayi");
    resetForm();
  });

  el("btnRecallSale")?.addEventListener("click", () => {
    showRecallModal("sale", "Held Sales", (state) => {
      applyHeldState(state);
      updateHeldBadge();
      showToast("Sale recall ho gayi");
    });
  });

  updateHeldBadge();
  resetForm();
}

export function focusQuickSale() {
  el("itemSearch").focus();
}

export function refreshSaleCustomerList() {
  renderCustomerList();
}
