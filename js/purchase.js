import { products, suppliers, savePurchase, updatePurchaseBill } from "./data.js";
import { unitNames, toSmallestUnits } from "./firebase-init.js";
import { showToast } from "./ui.js";
import { printPurchaseReceipt } from "./print.js";

let cart = [];       // [{barcode, product, qty, unit, unitCost, amount, conversionFactor}]
let selectedProduct = null;
let lastSavedPurchase = null; // { billNo, supplierName, receipt } — set after a successful save, for the Print button

// Set only while editing an existing bill from Purchase History (see
// enterPurchaseEditMode()) — editingOriginal is the raw Firestore doc being
// replaced, needed by updatePurchaseBill() to reverse its old effects.
let editingBillNo = null;
let editingOriginal = null;

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function el(id) { return document.getElementById(id); }

function todayDateStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function renderSupplierList() {
  const dl = el("supplierList");
  dl.innerHTML = "";
  suppliers.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.name;
    dl.appendChild(opt);
  });
}

function renderSuggestions(matches) {
  const box = el("purchaseItemSuggestions");
  if (!matches.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.innerHTML = "";
  matches.slice(0, 8).forEach(p => {
    const d = document.createElement("div");
    d.textContent = `${p.name} — cost Rs ${p.cost || 0} (${p.unit}, stock ${p.stock || 0})`;
    d.addEventListener("click", () => selectProduct(p));
    box.appendChild(d);
  });
  box.classList.remove("hidden");
}

function selectProduct(p) {
  selectedProduct = p;
  el("purchaseItemSearch").value = p.name;
  el("purchaseItemSuggestions").classList.add("hidden");

  const unitSel = el("purchaseItemUnit");
  unitSel.innerHTML = "";
  unitNames(p).forEach(u => {
    const opt = document.createElement("option");
    opt.value = u; opt.textContent = u;
    unitSel.appendChild(opt);
  });
  // default rate: this product's last cost — purchase rate, not sale price
  el("purchaseItemRate").value = p.cost || "";
  recalcLineAmount();
}

function recalcLineAmount() {
  const qty = parseFloat(el("purchaseItemQty").value) || 0;
  const rate = parseFloat(el("purchaseItemRate").value) || 0;
  el("purchaseLineAmount").textContent = money(qty * rate);
}

function renderCart() {
  const list = el("purchaseCartList");
  list.innerHTML = "";
  cart.forEach((line, idx) => {
    const div = document.createElement("div");
    div.className = "cart-line";
    div.innerHTML = `
      <div class="cart-line-top"><span>${line.product}</span><span>${money(line.amount)}</span></div>
      <div class="cart-line-sub">Qty: ${line.qty} ${line.unit} · Cost: ${line.unitCost}</div>
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
  el("purchaseCartCount").textContent = cart.length;
}

function recalcTotals() {
  const subtotal = cart.reduce((s, l) => s + l.amount, 0);
  const discount = parseFloat(el("purchaseDiscount").value) || 0;
  const total = Math.max(0, subtotal - discount);
  const paid = parseFloat(el("purchasePaid").value) || 0;
  const due = Math.max(0, total - paid);

  el("purchaseSumSubtotal").textContent = money(subtotal);
  el("purchaseSumTotal").textContent = money(total);
  el("purchaseSumDue").textContent = money(due);
  return { subtotal, discount, total, paid, due };
}

function exitEditMode() {
  editingBillNo = null;
  editingOriginal = null;
  el("purchaseEditBanner").classList.add("hidden");
  el("btnSavePurchase").textContent = "SAVE PURCHASE";
}

function resetForm() {
  cart = [];
  selectedProduct = null;
  exitEditMode();
  el("purchaseItemSearch").value = "";
  el("purchaseItemQty").value = 0;
  el("purchaseItemRate").value = "";
  el("purchaseItemUnit").innerHTML = "";
  el("purchaseDiscount").value = 0;
  el("purchasePaid").value = 0;
  el("purchaseSupplier").value = "";
  el("purchaseDate").value = todayDateStr();
  el("purchasePaymentMethod").value = "Cash";
  renderCart();
  recalcTotals();
  recalcLineAmount();
}

// Loads a past bill (from Purchase History's ✎ Edit) into this screen for
// editing. `purchase` is the raw Firestore purchase doc; `supplierName` is
// already resolved from purchase.supplierServerId since this screen otherwise
// only deals in names, not ids. Saving afterwards calls updatePurchaseBill()
// instead of savePurchase() — see the btnSavePurchase handler below.
//
// Note: paymentMethod isn't stored on the purchase doc itself (only qty/cost/
// totals are — see savePurchase()'s purchaseDoc shape), so it can't be
// restored here and defaults back to "Cash", same limitation the Android app
// has for the same reason.
export function enterPurchaseEditMode(purchase, supplierName) {
  editingBillNo = purchase.billNo;
  editingOriginal = purchase;
  selectedProduct = null;

  cart = (purchase.items || []).map(it => {
    const product = products.find(p => p.barcode === it.barcode);
    return {
      barcode: it.barcode,
      product: product ? product.name : it.barcode,
      qty: it.qty, unit: it.unit, unitCost: it.unitCost,
      amount: it.amount, conversionFactor: it.conversionFactor || 0
    };
  });

  el("purchaseItemSearch").value = "";
  el("purchaseItemQty").value = 0;
  el("purchaseItemRate").value = "";
  el("purchaseItemUnit").innerHTML = "";
  el("purchaseSupplier").value = supplierName || "";
  const d = new Date(purchase.createdAt);
  el("purchaseDate").value = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  el("purchaseDiscount").value = purchase.discount || 0;
  el("purchasePaid").value = purchase.paid || 0;
  el("purchasePaymentMethod").value = "Cash";

  renderCart();
  recalcTotals();
  recalcLineAmount();

  el("purchaseEditBillNo").textContent = purchase.billNo;
  el("purchaseEditBanner").classList.remove("hidden");
  el("btnSavePurchase").textContent = "UPDATE PURCHASE";
}

export function initPurchaseScreen() {
  renderSupplierList();
  el("purchaseDate").value = todayDateStr();

  el("purchaseItemSearch").addEventListener("input", () => {
    const q = el("purchaseItemSearch").value.trim().toLowerCase();
    if (!q) { el("purchaseItemSuggestions").classList.add("hidden"); return; }
    const matches = products.filter(p => p.name.toLowerCase().includes(q));
    renderSuggestions(matches);
  });

  el("purchaseItemQty").addEventListener("input", recalcLineAmount);
  el("purchaseItemRate").addEventListener("input", recalcLineAmount);
  el("purchaseDiscount").addEventListener("input", recalcTotals);
  el("purchasePaid").addEventListener("input", recalcTotals);

  el("btnAddPurchaseItem").addEventListener("click", () => {
    if (!selectedProduct) { showToast("Pehle item select karein"); return; }
    const qty = parseFloat(el("purchaseItemQty").value) || 0;
    const unit = el("purchaseItemUnit").value;
    const rate = parseFloat(el("purchaseItemRate").value) || 0;
    if (qty <= 0) { showToast("Quantity 0 se zyada honi chahiye"); return; }
    if (rate <= 0) { showToast("Cost rate 0 se zyada honi chahiye"); return; }

    const smallest = toSmallestUnits(selectedProduct, qty, unit);

    cart.push({
      barcode: selectedProduct.barcode,
      product: selectedProduct.name,
      qty, unit, unitCost: rate,
      amount: qty * rate,
      conversionFactor: smallest / qty
    });
    renderCart();
    recalcTotals();

    // reset item-entry fields, ready for the next item
    selectedProduct = null;
    el("purchaseItemSearch").value = "";
    el("purchaseItemQty").value = 0;
    el("purchaseItemRate").value = "";
    el("purchaseItemUnit").innerHTML = "";
    el("purchaseItemSearch").focus();
  });

  el("btnClearPurchase").addEventListener("click", () => {
    if (confirm("Poori purchase clear kar dein?")) resetForm();
  });

  el("btnSavePurchase").addEventListener("click", async () => {
    if (!cart.length) { showToast("Purchase khali hai"); return; }
    const totals = recalcTotals();
    const dateVal = el("purchaseDate").value;
    const purchaseDateMillis = dateVal ? new Date(dateVal + "T00:00:00").getTime() : Date.now();
    const supplierName = el("purchaseSupplier").value;
    const isEdit = !!editingBillNo;

    el("btnSavePurchase").disabled = true;
    try {
      const billNo = isEdit
        ? await updatePurchaseBill(editingBillNo, {
            lines: cart, supplierName, discount: totals.discount, paid: totals.paid,
            paymentMethod: el("purchasePaymentMethod").value, purchaseDateMillis
          }, editingOriginal)
        : await savePurchase({
            lines: cart, supplierName, discount: totals.discount, paid: totals.paid,
            paymentMethod: el("purchasePaymentMethod").value, purchaseDateMillis
          });
      // Receipt-shaped snapshot for the Print button — save/update only return
      // the bill number (see data.js), so build it from what's already in the browser.
      lastSavedPurchase = {
        billNo,
        supplierName,
        receipt: {
          billNo, createdAt: purchaseDateMillis, items: cart.map(l => ({ ...l })),
          subtotal: totals.subtotal, discount: totals.discount, total: totals.total,
          paid: totals.paid
        }
      };
      el("btnPrintLastPurchase").classList.remove("hidden");
      showToast(isEdit ? `Purchase update ho gayi — Bill ${billNo}` : `Purchase saved — Bill ${billNo}`);
      resetForm();
    } catch (e) {
      showToast("Save nahi ho saka: " + e.message);
    } finally {
      el("btnSavePurchase").disabled = false;
    }
  });

  el("btnCancelPurchaseEdit").addEventListener("click", () => {
    if (confirm("Edit cancel kar dein? Changes save nahi honge.")) resetForm();
  });

  el("btnPrintLastPurchase").addEventListener("click", () => {
    if (!lastSavedPurchase) return;
    printPurchaseReceipt(lastSavedPurchase.receipt, lastSavedPurchase.supplierName);
  });

  resetForm();
}

export function refreshPurchaseSupplierList() {
  renderSupplierList();
}
