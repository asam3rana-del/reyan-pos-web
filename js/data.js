// ================================================================
// data.js — all Firestore reads/writes, kept schema-identical to the
// Android app (see SyncQueueHelper.kt for the source of truth this
// mirrors). Comments reference the exact Kotlin function each block
// matches, so a future schema change on the Android side has an obvious
// spot to update here too.
// ================================================================

import {
  db, collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, query, where,
  orderBy, onSnapshot, runTransaction, increment, branchId, ids,
  toSmallestUnits, unitNames, smallestUnitFactor
} from "./firebase-init.js";
// (smallestUnitFactor already imported above — used by loadBalanceSheet())

// ---------- Live caches (kept simple: one listener per collection per branch) ----------

export let products = [];   // [{barcode,name,category,cost,salePrice,stock,unit,...}]
export let customers = [];  // [{id (doc id), name, phone, balance, ...}]
export let suppliers = [];  // [{id (doc id), name, phone, balance, ...}]
export let users = [];      // [{id (doc id), username, displayName, role, active, webPasswordHash, ...}]
export let categories = []; // [{name}] — doc id === name, mirrors Category.kt
export let units = [];      // [{name}] — doc id === name, mirrors UnitType.kt

let _productsUnsub = null, _customersUnsub = null, _suppliersUnsub = null, _usersUnsub = null;
let _categoriesUnsub = null, _unitsUnsub = null;

export function startProductListener(onChange) {
  if (_productsUnsub) _productsUnsub();
  const q = query(collection(db(), "products"), where("branchId", "==", branchId()));
  _productsUnsub = onSnapshot(q, (snap) => {
    products = snap.docs.map(d => ({ ...d.data(), barcode: d.id }));
    onChange && onChange(products);
  });
}

// ---------- Categories / Units master lists (mirrors ItemsActivity.kt's
// Categories/Units tabs — both are just a name, doc id === name so a
// category/unit added here or on Android lands on the same document). ----------

export function startCategoryListener(onChange) {
  if (_categoriesUnsub) _categoriesUnsub();
  const q = query(collection(db(), "categories"), where("branchId", "==", branchId()));
  _categoriesUnsub = onSnapshot(q, (snap) => {
    categories = snap.docs.map(d => d.data().name || d.id).sort((a, b) => a.localeCompare(b));
    onChange && onChange(categories);
  });
}

export function startUnitListener(onChange) {
  if (_unitsUnsub) _unitsUnsub();
  const q = query(collection(db(), "units"), where("branchId", "==", branchId()));
  _unitsUnsub = onSnapshot(q, (snap) => {
    units = snap.docs.map(d => d.data().name || d.id).sort((a, b) => a.localeCompare(b));
    onChange && onChange(units);
  });
}

export async function saveCategory(name) {
  const n = (name || "").trim();
  if (!n) throw new Error("Category name required");
  await setDoc(doc(db(), "categories", n), { name: n, updatedAt: Date.now(), branchId: branchId() });
  return n;
}

export async function deleteCategory(name) {
  await deleteDoc(doc(db(), "categories", name));
}

export async function saveUnit(name) {
  const n = (name || "").trim();
  if (!n) throw new Error("Unit name required");
  await setDoc(doc(db(), "units", n), { name: n, updatedAt: Date.now(), branchId: branchId() });
  return n;
}

export async function deleteUnit(name) {
  await deleteDoc(doc(db(), "units", name));
}

export function startCustomerListener(onChange) {
  if (_customersUnsub) _customersUnsub();
  const q = query(collection(db(), "customers"), where("branchId", "==", branchId()));
  _customersUnsub = onSnapshot(q, (snap) => {
    customers = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    onChange && onChange(customers);
  });
}

export function startSupplierListener(onChange) {
  if (_suppliersUnsub) _suppliersUnsub();
  const q = query(collection(db(), "suppliers"), where("branchId", "==", branchId()));
  _suppliersUnsub = onSnapshot(q, (snap) => {
    suppliers = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    onChange && onChange(suppliers);
  });
}

// ---------- Staff users / login (mirrors User.kt's fields; see auth.js's file
// header comment for why `webPasswordHash` exists only here, not on Android's
// side) ----------

export function startUserListener(onChange) {
  if (_usersUnsub) _usersUnsub();
  const q = query(collection(db(), "users"), where("branchId", "==", branchId()));
  _usersUnsub = onSnapshot(q, (snap) => {
    users = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    onChange && onChange(users);
  });
}

/** One-off (non-listener) fetch — used at Login-screen boot, before startUserListener
 *  has necessarily delivered its first snapshot yet. */
export async function fetchUsersOnce() {
  const bId = branchId();
  const snap = await getDocs(query(collection(db(), "users"), where("branchId", "==", bId)));
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

export function findUserByUsername(username) {
  const n = (username || "").trim().toLowerCase();
  return users.find(u => (u.username || "").trim().toLowerCase() === n) || null;
}

// Doc-id scheme `user:${username}` matches Android's SyncQueueHelper.userEntityId()
// exactly, so a user created on one side and later saved-to again from the other
// lands on the SAME document (merge-safe), not a duplicate.
export async function createWebUser({ username, displayName, role, phone, webPasswordHash }) {
  const bId = branchId();
  const id = `user:${username.trim()}`;
  await setDoc(doc(db(), "users", id), {
    serverId: id, username: username.trim(), displayName: (displayName || username).trim(),
    role: role || "cashier", phone: (phone || "").trim(), active: true,
    // No webPasswordHash yet when an admin creates this user from the Staff
    // Users screen (see users.js) — the new person sets their own the first
    // time they log in on the web, via the exact same "claim" flow login.js
    // already uses for an Android-created user's first web login.
    webPasswordHash: webPasswordHash || null,
    updatedAt: Date.now(), branchId: bId
  });
  return id;
}

export async function setUserWebPassword(userId, webPasswordHash) {
  await updateDoc(doc(db(), "users", userId), { webPasswordHash, updatedAt: Date.now() });
}

// ---- Staff Users screen (admin-only — see users.js) ----

export async function setUserActive(userId, active) {
  await updateDoc(doc(db(), "users", userId), { active, updatedAt: Date.now() });
}

export async function deleteWebUser(userId) {
  await deleteDoc(doc(db(), "users", userId));
}

export function findCustomerByName(name) {
  const n = (name || "").trim().toLowerCase();
  if (!n || n === "cash") return null;
  return customers.find(c => (c.name || "").trim().toLowerCase() === n) || null;
}

// NOTE (matches README's current CRUD scope): like findCustomerByName, this only
// MATCHES an existing supplier already created in the Android app — it never
// creates one. Full Supplier CRUD from the web is a later phase.
export function findSupplierByName(name) {
  const n = (name || "").trim().toLowerCase();
  if (!n) return null;
  return suppliers.find(s => (s.name || "").trim().toLowerCase() === n) || null;
}

// ---------- Customer/Supplier CRUD (mirrors PartyRepository.kt) ----------
//
// IMPORTANT: on edit, "balance" is deliberately never written here — same
// reasoning as customerJson()/supplierJson() on the Android side: balance is
// a running total only ever touched by an increment (a sale/purchase, or a
// payment against dues), never by a full-record save, so two devices editing
// the same party's name/phone at different times can never stomp on each
// other's balance. A brand-new party's balance simply starts at its opening
// balance.

export async function saveCustomer({ id, name, phone, creditLimit, openingBalance }) {
  const bId = branchId();
  if (id) {
    await updateDoc(doc(db(), "customers", id), {
      name, phone: phone || "", creditLimit: creditLimit || 0, openingBalance: openingBalance || 0,
      updatedAt: Date.now()
    });
    return id;
  }
  const newId = ids.customer();
  await setDoc(doc(db(), "customers", newId), {
    serverId: newId, name, phone: phone || "",
    creditLimit: creditLimit || 0, openingBalance: openingBalance || 0,
    balance: openingBalance || 0,
    updatedAt: Date.now(), branchId: bId
  });
  return newId;
}

export async function saveSupplier({ id, name, phone, openingBalance }) {
  const bId = branchId();
  if (id) {
    await updateDoc(doc(db(), "suppliers", id), {
      name, phone: phone || "", openingBalance: openingBalance || 0,
      updatedAt: Date.now()
    });
    return id;
  }
  const newId = ids.supplier();
  await setDoc(doc(db(), "suppliers", newId), {
    serverId: newId, name, phone: phone || "",
    openingBalance: openingBalance || 0, balance: openingBalance || 0,
    updatedAt: Date.now(), branchId: bId
  });
  return newId;
}

export async function deleteCustomer(id) {
  await deleteDoc(doc(db(), "customers", id));
}

export async function deleteSupplier(id) {
  await deleteDoc(doc(db(), "suppliers", id));
}

// ---------- Party transaction history + Payments (mirrors PartyTransactionActivity.kt —
// the Android screen you get to by tapping a party: their sales/purchases plus a
// Receive Payment (customer) / Make Payment (supplier) button. `partyId` on a payment
// here is the customer/supplier's own Firestore doc id (the web has no separate local
// numeric id the way Room does — Android's own `partyId` is per-device local anyway, so
// this loses nothing meaningful). Every payment also logs a cash_transactions row (IN
// for a customer payment, OUT for a supplier payment) — same "money physically changed
// hands" bookkeeping PartyTransactionActivity.savePayment() does on Android, so Balance
// Sheet's Cash in Hand stays correct. ----------

export async function loadPartyTransactions(partyId, partyType) {
  const bId = branchId();
  if (partyType === "customer") {
    const snap = await getDocs(query(
      collection(db(), "sales"), where("branchId", "==", bId), where("customerServerId", "==", partyId)
    ));
    return snap.docs.map(d => ({ ...d.data(), kind: "sale" }));
  }
  const snap = await getDocs(query(
    collection(db(), "purchases"), where("branchId", "==", bId), where("supplierServerId", "==", partyId)
  ));
  return snap.docs.map(d => ({ ...d.data(), kind: "purchase" }));
}

export async function loadPartyPayments(partyId, partyType) {
  const bId = branchId();
  const snap = await getDocs(query(
    collection(db(), "payments"), where("branchId", "==", bId),
    where("partyId", "==", partyId), where("partyType", "==", partyType)
  ));
  return snap.docs.map(d => ({ ...d.data(), kind: "payment" }));
}

export async function savePartyPayment({ partyId, partyType, partyName, amount, method, note }) {
  const bId = branchId();
  const id = ids.payment();
  const reference = `manual-${partyType}-${partyId}-${Date.now()}`;
  const reasonText = (partyType === "customer" ? `Payment received from ${partyName}` : `Payment made to ${partyName}`)
    + (note ? ` | ${note}` : "");

  await setDoc(doc(db(), "payments", id), {
    serverId: id, reference, partyType, partyId, amount, method: method || "cash", note: note || "",
    createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
  });

  // A customer paying us reduces what they owe (balance goes down); us paying a
  // supplier reduces what we owe them — both are a negative adjustment, mirroring
  // adjustCustomerBalance()/adjustSupplierBalance() on the Android side.
  const coll = partyType === "customer" ? "customers" : "suppliers";
  await updateDoc(doc(db(), coll, partyId), { balance: increment(-amount), updatedAt: Date.now() });

  const cashId = ids.cashTransaction();
  await setDoc(doc(db(), "cash_transactions", cashId), {
    serverId: cashId, type: partyType === "customer" ? "IN" : "OUT", method: (method || "cash").toLowerCase(),
    amount, reason: reasonText, reference,
    createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
  });

  return id;
}

// ---------- Payments / Party Report (mirrors PaymentsReportActivity.kt —
// every `payments` doc in range, whichever source wrote it: a manual Receive/
// Make Payment from the Party detail screen above, OR the automatic payment
// savePurchase() creates when a purchase is paid against a real supplier at
// bill time. NOTE a known asymmetry, already flagged elsewhere in this repo's
// notes: saveSale() does NOT create a matching payment when a sale is paid
// against a real customer at bill time — only Purchase does — so a straight
// cash/credit sale's paid amount won't show up here unless it was recorded
// separately via Record Receive Payment. ----------
export async function loadPaymentsReport(rangeStart, rangeEnd) {
  const bId = branchId();
  const snap = await getDocs(query(
    collection(db(), "payments"),
    where("branchId", "==", bId),
    where("createdAt", ">=", rangeStart),
    where("createdAt", "<=", rangeEnd)
  ));

  const list = snap.docs.map(d => {
    const p = d.data();
    const party = p.partyType === "customer"
      ? customers.find(c => c.id === p.partyId)
      : suppliers.find(s => s.id === p.partyId);
    return { ...p, partyName: party ? party.name : "Unknown" };
  }).sort((a, b) => b.createdAt - a.createdAt);

  let totalReceived = 0, totalPaid = 0;
  const byParty = new Map(); // partyId -> { partyName, partyType, received, paid }
  list.forEach(p => {
    if (p.partyType === "customer") totalReceived += p.amount; else totalPaid += p.amount;
    const key = p.partyType + "|" + p.partyId;
    const row = byParty.get(key) || { partyName: p.partyName, partyType: p.partyType, received: 0, paid: 0 };
    if (p.partyType === "customer") row.received += p.amount; else row.paid += p.amount;
    byParty.set(key, row);
  });

  return {
    payments: list,
    totalReceived, totalPaid, netCashFlow: totalReceived - totalPaid,
    partySummary: Array.from(byParty.values()).sort((a, b) => (b.received + b.paid) - (a.received + a.paid))
  };
}

// ---------- Product CRUD (mirrors ProductActivity.kt's save logic + Database.kt's
// Product entity). Doc id === barcode. `stock` is deliberately never overwritten by
// a plain save here (same reasoning as productJson() on Android) — a brand-new
// product's opening stock goes in via increment(), same mechanism Purchase/Sale use,
// so it can never silently clobber a concurrent sale/purchase's stock change. ----------

export function findProductByBarcode(barcode) {
  return products.find(p => p.barcode === barcode) || null;
}

/** editingBarcode: pass an existing product's barcode to edit it (stock/openingStock
 *  left untouched); pass null/empty to create a new product (barcode auto-generated
 *  if left blank, same "P" + timestamp scheme as ProductActivity.kt). */
export async function saveProduct({
  editingBarcode, barcode, name, searchTag, category, unit,
  secondaryUnit, secondaryUnitQty, cost, salePrice, wholesalePrice,
  reorderLevel, expiry, openingStock
}) {
  const bId = branchId();
  const n = (name || "").trim();
  if (!n) throw new Error("Name required");
  const finalUnit = (unit || "pcs").trim();
  const hasSecondary = !!secondaryUnit && (secondaryUnitQty || 0) > 0;

  const baseFields = {
    name: n,
    searchTag: (searchTag || "").trim(),
    category: (category || "").trim() || "General",
    cost: cost || 0,
    salePrice: salePrice || 0,
    wholesalePrice: wholesalePrice || 0,
    unit: finalUnit,
    secondaryUnit: hasSecondary ? secondaryUnit.trim() : "",
    secondaryUnitQty: hasSecondary ? (secondaryUnitQty || 0) : 0,
    reorderLevel: Math.max(0, reorderLevel || 0),
    expiry: (expiry || "").trim(),
    updatedAt: Date.now(),
    branchId: bId
  };

  if (editingBarcode) {
    // Edit: never touch stock/openingStock, same as Android's `existing != null` branch.
    await setDoc(doc(db(), "products", editingBarcode), baseFields, { merge: true });
    return editingBarcode;
  }

  // New product.
  const finalBarcode = (barcode || "").trim() || ("P" + Date.now());
  const openingQty = openingStock || 0;
  // Opening stock is entered in the product's main `unit` — convert to smallest
  // units the same way toSmallestUnits() does for Purchase/Sale lines.
  const smallestOpening = hasSecondary ? openingQty * secondaryUnitQty : openingQty;

  await setDoc(doc(db(), "products", finalBarcode), {
    ...baseFields,
    openingStock: smallestOpening,
    stock: 0 // set to 0 then incremented below, so this can never race a concurrent sale/purchase
  });
  if (smallestOpening > 0) {
    await updateDoc(doc(db(), "products", finalBarcode), { stock: increment(smallestOpening) });
  }
  return finalBarcode;
}

export async function deleteProduct(barcode) {
  await deleteDoc(doc(db(), "products", barcode));
}

// ---------- Save a sale (mirrors SyncQueueHelper.saleJson() field-for-field) ----------
//
// lines: [{ barcode, product, qty, unit, unitPrice, cost, amount }]
// Returns the invoice number on success.
export async function saveSale({ lines, customerName, saleType, subtotal, discount, total, paid, paymentMethod, dueDate }) {
  if (!lines.length) throw new Error("No items in cart");

  const invoice = ids.invoice();
  const bId = branchId();
  const customer = findCustomerByName(customerName);

  const itemMaps = lines.map(l => ({
    barcode: l.barcode, product: l.product, qty: l.qty, unit: l.unit,
    unitPrice: l.unitPrice, cost: l.cost, amount: l.amount,
    // conversionFactor: how many smallest-units ONE of `unit` equals, captured
    // at sale time — same field Android stamps, so edits/returns on either
    // side stay correct even if the product's unit ladder changes later.
    conversionFactor: l.conversionFactor || 0
  }));

  const saleDoc = {
    serverId: ids.sale(invoice),
    invoice,
    customerServerId: customer ? customer.id : null,
    subtotal, discount, total, paid,
    paymentMethod,
    saleType,
    createdAt: Date.now(),
    status: "active",
    dueDate: dueDate || 0,
    itemCount: lines.length,
    items: itemMaps,
    updatedAt: Date.now(),
    branchId: bId
  };

  await setDoc(doc(db(), "sales", saleDoc.serverId), saleDoc);

  // Decrement stock per line (mirrors SyncQueueHelper's increment_stock operation —
  // stock is NEVER overwritten by a full snapshot, only ever adjusted by delta).
  for (const l of lines) {
    const smallest = toSmallestUnits(
      products.find(p => p.barcode === l.barcode) || { unit: l.unit, secondaryUnit: "", secondaryUnitQty: 0, tertiaryUnit: "", tertiaryUnitQty: 0 },
      l.qty, l.unit
    );
    try {
      await updateDoc(doc(db(), "products", l.barcode), {
        stock: increment(-smallest),
        updatedAt: Date.now()
      });
    } catch (e) {
      console.warn("Stock update failed for", l.barcode, e);
    }
  }

  // Credit sale against an existing customer: bump their balance (they now owe more).
  const due = total - paid;
  if (customer && due > 0) {
    try {
      await updateDoc(doc(db(), "customers", customer.id), {
        balance: increment(due),
        updatedAt: Date.now()
      });
    } catch (e) {
      console.warn("Customer balance update failed", e);
    }
  }

  return invoice;
}

// ---------- Sale history / return / delete (mirrors SaleHistoryActivity.kt —
// unlike Purchase, Android's Sale History only offers Return + Delete, no Edit,
// so this section doesn't need an updateSaleBill() counterpart). ----------

export async function loadSaleHistory() {
  const bId = branchId();
  const q = query(collection(db(), "sales"), where("branchId", "==", bId));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data()).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSaleByInvoice(invoice) {
  const snap = await getDoc(doc(db(), "sales", ids.sale(invoice)));
  return snap.exists() ? snap.data() : null;
}

// ---------- Due Date Reminders — credit sales that were given an optional
// `dueDate` (Sale screen's "Due Date" field, only shown when there's an
// outstanding due) and still have an unpaid balance. Purely a read-side
// query, same `sales` collection Day Book/Sale History already use — no new
// collection, so nothing new for the Android side to sync. ----------
export async function loadDueReminders() {
  const bId = branchId();
  const snap = await getDocs(query(collection(db(), "sales"), where("branchId", "==", bId)));
  return snap.docs.map(d => d.data())
    .filter(s => s.status === "active" && (s.dueDate || 0) > 0 && (s.total - s.paid) > 0.0001)
    .map(s => {
      const customer = customers.find(c => c.id === s.customerServerId);
      return {
        invoice: s.invoice, dueDate: s.dueDate, total: s.total, paid: s.paid,
        due: s.total - s.paid,
        customerName: customer ? customer.name : "Cash/Unknown",
        customerPhone: customer ? (customer.phone || "") : ""
      };
    })
    .sort((a, b) => a.dueDate - b.dueDate);
}

// Reverses a sale's stock + customer-balance effects (the exact inverse of the
// "decrement stock, bump customer balance" block inside saveSale() above), and
// removes any payment/cash_transaction docs tied to this invoice. Shared by
// both deleteSaleBill() and returnSaleBill() below, same as Android's
// returnSale()/deleteSale() both doing the same reversal math before diverging
// on whether the sale record itself is kept (status="returned") or removed.
async function reverseSaleEffects(sale) {
  for (const it of (sale.items || [])) {
    const product = products.find(p => p.barcode === it.barcode);
    const smallest = it.conversionFactor > 0
      ? it.qty * it.conversionFactor
      : toSmallestUnits(product || { unit: it.unit, secondaryUnit: "", secondaryUnitQty: 0, tertiaryUnit: "", tertiaryUnitQty: 0 }, it.qty, it.unit);
    if (smallest <= 0) continue;
    try {
      await updateDoc(doc(db(), "products", it.barcode), { stock: increment(smallest), updatedAt: Date.now() });
    } catch (e) {
      console.warn("Stock reversal failed for", it.barcode, e);
    }
  }

  const outstanding = (sale.total || 0) - (sale.paid || 0);
  if (sale.customerServerId && outstanding > 0) {
    try {
      await updateDoc(doc(db(), "customers", sale.customerServerId), { balance: increment(-outstanding), updatedAt: Date.now() });
    } catch (e) {
      console.warn("Customer balance reversal failed", e);
    }
  }

  await deleteDocsByReference("payments", sale.invoice);
  await deleteDocsByReference("cash_transactions", sale.invoice);
}

// Deletes a sale entirely — reverses stock/customer-balance first, no trace left.
export async function deleteSaleBill(invoice) {
  const sale = await getSaleByInvoice(invoice);
  if (!sale) throw new Error("Sale not found");
  await reverseSaleEffects(sale);
  await deleteDoc(doc(db(), "sales", ids.sale(invoice)));
}

// Returns a sale — same reversal as delete, but the sale record is KEPT with
// status="returned" (so it still shows in Day Book/Reports as a returned sale,
// same as Android), and one `returns` doc per line item is logged for future
// Sale-Returns reporting (mirrors ReturnLine — see Database.kt).
export async function returnSaleBill(invoice) {
  const sale = await getSaleByInvoice(invoice);
  if (!sale) throw new Error("Sale not found");
  if (sale.status === "returned") throw new Error("Already returned");
  const bId = branchId();

  await reverseSaleEffects(sale);

  for (const it of (sale.items || [])) {
    const rId = ids.returnLine();
    try {
      await setDoc(doc(db(), "returns", rId), {
        serverId: rId, reference: invoice, type: "sale",
        barcode: it.barcode, qty: it.qty, amount: it.amount,
        createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
      });
    } catch (e) {
      console.warn("Return line record failed for", it.barcode, e);
    }
  }

  await updateDoc(doc(db(), "sales", ids.sale(invoice)), { status: "returned", updatedAt: Date.now() });
}

// ---------- Save a purchase (mirrors PurchaseRepository.savePurchase() +
// SyncQueueHelper.purchaseJson() field-for-field — create-only for now, same
// as saveSale(); editing an existing bill is a later phase, like the Android
// history screen's edit flow). ----------
//
// lines: [{ barcode, product, qty, unit, unitCost, amount, conversionFactor }]
// Returns the bill number on success.
export async function savePurchase({ lines, supplierName, discount, paid, paymentMethod, purchaseDateMillis }) {
  if (!lines.length) throw new Error("No items in purchase");

  const bId = branchId();
  const billNo = ids.purchaseBillNo();
  const supplier = findSupplierByName(supplierName);

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const total = Math.max(0, subtotal - discount);

  const itemMaps = lines.map(l => ({
    barcode: l.barcode, qty: l.qty, unit: l.unit,
    unitCost: l.unitCost, amount: l.amount,
    conversionFactor: l.conversionFactor || 0
  }));

  const purchaseDoc = {
    serverId: ids.purchase(billNo),
    billNo,
    supplierServerId: supplier ? supplier.id : null,
    subtotal, discount, total, paid,
    createdAt: purchaseDateMillis || Date.now(),
    status: "active",
    itemCount: lines.length,
    items: itemMaps,
    updatedAt: Date.now(),
    branchId: bId
  };

  await setDoc(doc(db(), "purchases", purchaseDoc.serverId), purchaseDoc);

  // Increase stock + roll the weighted-average cost forward per line (mirrors
  // PurchaseRepository.savePurchase's cost math exactly: blend the existing
  // stock value with this purchase's value, weighted by quantity).
  for (const l of lines) {
    const product = products.find(p => p.barcode === l.barcode);
    if (!product) continue;
    const purchasedSmallest = toSmallestUnits(product, l.qty, l.unit);
    if (purchasedSmallest <= 0) continue;

    const factor = smallestUnitFactor(product);
    const oldStock = product.stock || 0;
    const oldCostPerSmallest = factor > 0 ? (product.cost || 0) / factor : (product.cost || 0);
    const purchaseRatePerSmallest = l.amount / purchasedSmallest;
    const newCostPerSmallest = oldStock <= 0
      ? purchaseRatePerSmallest
      : ((oldStock * oldCostPerSmallest) + (purchasedSmallest * purchaseRatePerSmallest)) / (oldStock + purchasedSmallest);
    const newCost = newCostPerSmallest * factor;

    try {
      await updateDoc(doc(db(), "products", l.barcode), {
        stock: increment(purchasedSmallest),
        cost: newCost,
        updatedAt: Date.now()
      });
    } catch (e) {
      console.warn("Stock/cost update failed for", l.barcode, e);
    }
  }

  // Credit purchase against a matched supplier: bump their balance (we now owe them more).
  const outstanding = total - paid;
  if (supplier && outstanding > 0) {
    try {
      await updateDoc(doc(db(), "suppliers", supplier.id), {
        balance: increment(outstanding),
        updatedAt: Date.now()
      });
    } catch (e) {
      console.warn("Supplier balance update failed", e);
    }
  }

  // Anything paid at purchase time: a payment record (only when tied to a real
  // supplier, same rule as Android) plus a cash-out transaction either way.
  if (paid > 0) {
    if (supplier) {
      const paymentId = ids.payment();
      try {
        await setDoc(doc(db(), "payments", paymentId), {
          serverId: paymentId, reference: billNo, partyType: "supplier",
          partyId: supplier.id, amount: paid, method: paymentMethod,
          note: "Purchase payment", createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
        });
      } catch (e) {
        console.warn("Payment record failed", e);
      }
    }
    const cashTxId = ids.cashTransaction();
    try {
      await setDoc(doc(db(), "cash_transactions", cashTxId), {
        serverId: cashTxId, type: "OUT", method: (paymentMethod || "").toLowerCase(),
        amount: paid, reason: "Purchase", reference: billNo,
        createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
      });
    } catch (e) {
      console.warn("Cash transaction record failed", e);
    }
  }

  return billNo;
}

// ---------- Purchase history / edit / delete (mirrors PurchaseHistoryActivity.kt +
// PurchaseRepository.kt's deletePurchase()/savePurchase() edit-reversal math — an
// edit is "reverse the old bill's effects, then save the new one under the same
// billNo", same as PurchaseRepository.savePurchase()'s `original != null` branch). ----------

export async function loadPurchaseHistory() {
  const bId = branchId();
  const q = query(collection(db(), "purchases"), where("branchId", "==", bId));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data()).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getPurchaseByBillNo(billNo) {
  const snap = await getDoc(doc(db(), "purchases", ids.purchase(billNo)));
  return snap.exists() ? snap.data() : null;
}

async function deleteDocsByReference(collectionName, billNo) {
  const bId = branchId();
  const q = query(collection(db(), collectionName), where("branchId", "==", bId), where("reference", "==", billNo));
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    try { await deleteDoc(doc(db(), collectionName, d.id)); } catch (e) { console.warn(`${collectionName} delete failed`, e); }
  }
}

// Reverses a purchase's stock/cost + supplier-balance effects and removes the
// payment/cash_transaction records it created — the exact inverse of the
// "increase stock, roll cost forward, bump supplier balance, log payment+cash"
// block inside savePurchase() above.
//
// `productOverrides` (barcode -> working {stock,cost} copy), when passed, keeps
// this purely in-memory instead of writing straight to Firestore — used by
// updatePurchaseBill() so it can chain a reversal into a forward re-apply
// without waiting for the products listener to refresh the local cache in
// between (which is never guaranteed to land in time and would double-count).
async function reversePurchaseEffects(purchase, productOverrides) {
  for (const it of (purchase.items || [])) {
    const product = productOverrides ? (productOverrides[it.barcode] || products.find(p => p.barcode === it.barcode)) : products.find(p => p.barcode === it.barcode);
    if (!product) continue;
    const smallestQty = it.conversionFactor > 0 ? it.qty * it.conversionFactor : toSmallestUnits(product, it.qty, it.unit);
    if (smallestQty <= 0) continue;

    const factor = smallestUnitFactor(product);
    const oldCostPerSmallest = factor > 0 ? (product.cost || 0) / factor : (product.cost || 0);
    const oldStock = product.stock || 0;
    const newStock = oldStock - smallestQty;
    const totalValueBefore = oldStock * oldCostPerSmallest;
    const totalValueAfter = Math.max(0, totalValueBefore - it.amount);
    const newCostPerSmallest = newStock > 0 ? totalValueAfter / newStock : 0;
    const newCost = newCostPerSmallest * factor;

    if (productOverrides) {
      productOverrides[it.barcode] = { ...product, stock: newStock, cost: newCost };
    } else {
      try {
        await updateDoc(doc(db(), "products", it.barcode), { stock: increment(-smallestQty), cost: newCost, updatedAt: Date.now() });
      } catch (e) {
        console.warn("Stock/cost reversal failed for", it.barcode, e);
      }
    }
  }

  const outstanding = (purchase.total || 0) - (purchase.paid || 0);
  if (purchase.supplierServerId && outstanding > 0) {
    try {
      await updateDoc(doc(db(), "suppliers", purchase.supplierServerId), { balance: increment(-outstanding), updatedAt: Date.now() });
    } catch (e) {
      console.warn("Supplier balance reversal failed", e);
    }
  }

  await deleteDocsByReference("payments", purchase.billNo);
  await deleteDocsByReference("cash_transactions", purchase.billNo);
}

// Deletes a purchase bill entirely — reverses its stock/cost/supplier-balance
// effects first (see reversePurchaseEffects above), then removes the bill.
export async function deletePurchaseBill(billNo) {
  const purchase = await getPurchaseByBillNo(billNo);
  if (!purchase) throw new Error("Purchase not found");
  await reversePurchaseEffects(purchase);
  await deleteDoc(doc(db(), "purchases", ids.purchase(billNo)));
}

// Edits an existing bill in place (same billNo). `original` is the raw
// Firestore purchase doc being replaced — fetch it once when entering edit
// mode (see purchase.js's enterPurchaseEditMode()) and pass it back here so
// the reversal step above has the pre-edit items/total/paid to undo.
export async function updatePurchaseBill(billNo, { lines, supplierName, discount, paid, paymentMethod, purchaseDateMillis }, original) {
  if (!lines.length) throw new Error("No items in purchase");

  const bId = branchId();
  const supplier = findSupplierByName(supplierName);

  // Reverse the old bill into a local working copy of affected products (not
  // Firestore) so the forward pass below can read post-reversal figures
  // immediately, with no round-trip through the real-time listener.
  const productOverrides = {};
  await reversePurchaseEffects(original, productOverrides);

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const total = Math.max(0, subtotal - discount);

  const itemMaps = lines.map(l => ({
    barcode: l.barcode, qty: l.qty, unit: l.unit,
    unitCost: l.unitCost, amount: l.amount,
    conversionFactor: l.conversionFactor || 0
  }));

  const purchaseDoc = {
    serverId: ids.purchase(billNo),
    billNo,
    supplierServerId: supplier ? supplier.id : null,
    subtotal, discount, total, paid,
    createdAt: purchaseDateMillis || original.createdAt || Date.now(),
    status: "active",
    itemCount: lines.length,
    items: itemMaps,
    updatedAt: Date.now(),
    branchId: bId
  };
  await setDoc(doc(db(), "purchases", purchaseDoc.serverId), purchaseDoc);

  // Forward pass — same weighted-average roll-forward math as savePurchase(),
  // but reading from productOverrides first so this bill's own reversal is
  // already blended in before its (possibly changed) new lines are added.
  for (const l of lines) {
    const product = productOverrides[l.barcode] || products.find(p => p.barcode === l.barcode);
    if (!product) continue;
    const purchasedSmallest = toSmallestUnits(product, l.qty, l.unit);
    if (purchasedSmallest <= 0) continue;

    const factor = smallestUnitFactor(product);
    const oldStock = product.stock || 0;
    const oldCostPerSmallest = factor > 0 ? (product.cost || 0) / factor : (product.cost || 0);
    const purchaseRatePerSmallest = l.amount / purchasedSmallest;
    const newCostPerSmallest = oldStock <= 0
      ? purchaseRatePerSmallest
      : ((oldStock * oldCostPerSmallest) + (purchasedSmallest * purchaseRatePerSmallest)) / (oldStock + purchasedSmallest);
    const newCost = newCostPerSmallest * factor;
    const newStock = oldStock + purchasedSmallest;

    productOverrides[l.barcode] = { ...product, stock: newStock, cost: newCost };
  }

  // Flush every touched product as ONE absolute write (reversal + forward
  // combined) — avoids the double-write race a naive "reverse via increment(),
  // then forward via increment()" pair would have.
  for (const barcode of Object.keys(productOverrides)) {
    const p = productOverrides[barcode];
    try {
      await updateDoc(doc(db(), "products", barcode), { stock: p.stock, cost: p.cost, updatedAt: Date.now() });
    } catch (e) {
      console.warn("Stock/cost update failed for", barcode, e);
    }
  }

  const outstanding = total - paid;
  if (supplier && outstanding > 0) {
    try {
      await updateDoc(doc(db(), "suppliers", supplier.id), { balance: increment(outstanding), updatedAt: Date.now() });
    } catch (e) {
      console.warn("Supplier balance update failed", e);
    }
  }

  if (paid > 0) {
    if (supplier) {
      const paymentId = ids.payment();
      try {
        await setDoc(doc(db(), "payments", paymentId), {
          serverId: paymentId, reference: billNo, partyType: "supplier",
          partyId: supplier.id, amount: paid, method: paymentMethod,
          note: "Purchase payment (edited)", createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
        });
      } catch (e) {
        console.warn("Payment record failed", e);
      }
    }
    const cashTxId = ids.cashTransaction();
    try {
      await setDoc(doc(db(), "cash_transactions", cashTxId), {
        serverId: cashTxId, type: "OUT", method: (paymentMethod || "").toLowerCase(),
        amount: paid, reason: "Purchase", reference: billNo,
        createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
      });
    } catch (e) {
      console.warn("Cash transaction record failed", e);
    }
  }

  return billNo;
}

// ---------- Dashboard stats ----------

export async function loadTodayStats() {
  const bId = branchId();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const q = query(
    collection(db(), "sales"),
    where("branchId", "==", bId),
    where("createdAt", ">=", startOfDay.getTime())
  );
  const snap = await getDocs(q);
  let totalSale = 0, totalProfit = 0;
  snap.forEach(d => {
    const s = d.data();
    if (s.status === "active") {
      totalSale += s.total || 0;
      (s.items || []).forEach(it => {
        totalProfit += ((it.unitPrice || 0) - (it.cost || 0)) * (it.qty || 0);
      });
    }
  });
  return { totalSale, totalProfit };
}

export async function loadDuesSummary() {
  const bId = branchId();
  const custSnap = await getDocs(query(collection(db(), "customers"), where("branchId", "==", bId)));
  const suppSnap = await getDocs(query(collection(db(), "suppliers"), where("branchId", "==", bId)));
  let youllGet = 0, youllGive = 0;
  custSnap.forEach(d => { const b = d.data().balance || 0; if (b > 0) youllGet += b; });
  suppSnap.forEach(d => { const b = d.data().balance || 0; if (b > 0) youllGive += b; });
  return { youllGet, youllGive };
}

// ---------- Day book ----------

export async function loadDayBook(dateStr) {
  const bId = branchId();
  const start = new Date(dateStr); start.setHours(0, 0, 0, 0);
  const end = new Date(dateStr); end.setHours(23, 59, 59, 999);
  const q = query(
    collection(db(), "sales"),
    where("branchId", "==", bId),
    where("createdAt", ">=", start.getTime()),
    where("createdAt", "<=", end.getTime())
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data()).sort((a, b) => b.createdAt - a.createdAt);
}

// ---------- Stock report ----------

export function lowStockProducts() {
  return products.filter(p => (p.stock || 0) <= (p.reorderLevel || 0));
}

// ---------- Cash In / Cash Out (mirrors CashActivity.kt — manual cash log,
// separate from the automatic cash_transactions written by savePurchase()
// above; same collection/schema though, so both show up together) ----------

export async function saveCashTransaction({ type, method, amount, reason }) {
  const bId = branchId();
  const id = ids.cashTransaction();
  await setDoc(doc(db(), "cash_transactions", id), {
    serverId: id, type, method, amount, reason: reason || "", reference: "",
    createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
  });
  return id;
}

export async function loadTodayCashTotals() {
  const bId = branchId();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const q = query(
    collection(db(), "cash_transactions"),
    where("branchId", "==", bId),
    where("createdAt", ">=", start.getTime())
  );
  const snap = await getDocs(q);
  let cashIn = 0, cashOut = 0;
  snap.forEach(d => {
    const t = d.data();
    if (t.type === "IN") cashIn += t.amount || 0;
    else if (t.type === "OUT") cashOut += t.amount || 0;
  });
  return { cashIn, cashOut };
}

export async function loadRecentCashTransactions(limitCount = 50) {
  const bId = branchId();
  const snap = await getDocs(query(collection(db(), "cash_transactions"), where("branchId", "==", bId)));
  return snap.docs.map(d => d.data()).sort((a, b) => b.createdAt - a.createdAt).slice(0, limitCount);
}

// ---------- Expenses (mirrors ExpenseActivity.kt — a separate `expenses`
// collection from cash_transactions above; this is what Reports' P&L
// "Total Expenses"/loadPnL() and Balance Sheet's Net Profit actually read) ----------

export async function saveExpense({ category, description, amount }) {
  const bId = branchId();
  const id = ids.expense();
  await setDoc(doc(db(), "expenses", id), {
    serverId: id, category, description: description || "", amount,
    createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
  });
  return id;
}

export async function deleteExpense(serverId) {
  await deleteDoc(doc(db(), "expenses", serverId));
}

export async function loadExpenseTotals() {
  const bId = branchId();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const snap = await getDocs(query(collection(db(), "expenses"), where("branchId", "==", bId)));
  let today = 0, month = 0;
  snap.forEach(d => {
    const e = d.data();
    if ((e.createdAt || 0) >= dayStart.getTime()) today += e.amount || 0;
    if ((e.createdAt || 0) >= monthStart.getTime()) month += e.amount || 0;
  });
  return { today, month };
}

export async function loadRecentExpenses(limitCount = 50) {
  const bId = branchId();
  const snap = await getDocs(query(collection(db(), "expenses"), where("branchId", "==", bId)));
  return snap.docs.map(d => ({ ...d.data(), id: d.id })).sort((a, b) => b.createdAt - a.createdAt).slice(0, limitCount);
}

// ---------- Stock Adjustments & Stock Taking (new `stock_adjustments`
// collection — each row is one delta applied to a product's `stock` field,
// using the exact same increment()-only mechanism Sale/Purchase already use
// above, so this can never race a concurrent sale/purchase. `type` is
// "adjustment" (single ad-hoc correction, e.g. Damage/Theft/Correction) or
// "stocktake" (physical-count reconciliation — saveStockTake() below writes
// one row per changed product in a single round, reason fixed to "Stock
// Take"). deltaSmallest is always in the product's smallest unit, same basis
// `stock` itself is stored in. ----------

export async function saveStockAdjustment({ barcode, product, deltaSmallest, qtyEntered, unit, reason, note, type }) {
  const bId = branchId();
  const id = ids.stockAdjustment();
  await setDoc(doc(db(), "stock_adjustments", id), {
    serverId: id, barcode, product, deltaSmallest,
    qtyEntered: qtyEntered || 0, unit: unit || "",
    reason: reason || "", note: note || "", type: type || "adjustment",
    createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
  });
  await updateDoc(doc(db(), "products", barcode), { stock: increment(deltaSmallest), updatedAt: Date.now() });
  return id;
}

/** entries: [{barcode, product, deltaSmallest, countedSmallest}] — one
 *  stock_adjustments row + one product stock increment per entry. */
export async function saveStockTake(entries) {
  for (const e of entries) {
    await saveStockAdjustment({
      barcode: e.barcode, product: e.product, deltaSmallest: e.deltaSmallest,
      qtyEntered: e.countedSmallest, unit: "", reason: "Stock Take", note: "", type: "stocktake"
    });
  }
}

export async function loadRecentStockAdjustments(limitCount = 30) {
  const bId = branchId();
  const snap = await getDocs(query(collection(db(), "stock_adjustments"), where("branchId", "==", bId)));
  return snap.docs.map(d => d.data()).sort((a, b) => b.createdAt - a.createdAt).slice(0, limitCount);
}

// ---------- Stock/Cost History ledger (mirrors the Android app's
// StockMovementActivity — a per-product chronological ledger of every event
// that ever touched `stock`: Purchases (in), Sales (out, including a second
// "Return" row when a sale was returned — the stock genuinely moved twice),
// and Stock Adjustments/Stock Takes (in or out, from the Adjust/Take tabs
// above). Unlike Android's dedicated `stock_movements` table, this is
// derived on read from the existing purchases/sales/returns/stock_adjustments
// collections rather than written at save-time — simpler, and avoids adding
// a new synced collection the Android side doesn't know about yet. Known
// limitation: a purchase bill that was later fully DELETED (not returned) is
// gone from `purchases` entirely, so it silently drops out of this ledger
// too — same as Android has no record of a deleted bill either. ----------
export async function loadStockHistoryForProduct(barcode, limitCount = 200) {
  const bId = branchId();
  const [purchasesSnap, salesSnap, returnsSnap, adjustSnap] = await Promise.all([
    getDocs(query(collection(db(), "purchases"), where("branchId", "==", bId))),
    getDocs(query(collection(db(), "sales"), where("branchId", "==", bId))),
    getDocs(query(collection(db(), "returns"), where("branchId", "==", bId))),
    getDocs(query(collection(db(), "stock_adjustments"), where("branchId", "==", bId)))
  ]);

  const product = products.find(p => p.barcode === barcode) || null;
  const events = [];

  // Look up each sale-item's conversionFactor by "invoice|barcode" so a
  // later `returns` row (which only stores qty, no unit/conversionFactor)
  // can still be converted to the exact same smallest-unit basis the
  // original sale used, instead of guessing from the product's CURRENT
  // unit ladder (which may have changed since).
  const saleLineConversion = {};

  salesSnap.docs.forEach(d => {
    const s = d.data();
    (s.items || []).forEach(it => {
      saleLineConversion[`${s.invoice}|${it.barcode}`] = it.conversionFactor || 0;
      if (it.barcode !== barcode) return;
      const smallest = it.conversionFactor > 0 ? it.qty * it.conversionFactor : toSmallestUnits(product || { unit: it.unit }, it.qty, it.unit);
      events.push({
        createdAt: s.createdAt,
        type: s.status === "returned" ? "Sale (returned)" : "Sale",
        direction: "out",
        qty: it.qty, unit: it.unit, rate: it.unitPrice,
        deltaSmallest: -smallest,
        reference: s.invoice, note: ""
      });
    });
  });

  purchasesSnap.docs.forEach(d => {
    const p = d.data();
    (p.items || []).forEach(it => {
      if (it.barcode !== barcode) return;
      const smallest = it.conversionFactor > 0 ? it.qty * it.conversionFactor : toSmallestUnits(product || { unit: it.unit }, it.qty, it.unit);
      events.push({
        createdAt: p.createdAt, type: "Purchase", direction: "in",
        qty: it.qty, unit: it.unit, rate: it.unitCost,
        deltaSmallest: smallest,
        reference: p.billNo, note: ""
      });
    });
  });

  returnsSnap.docs.forEach(d => {
    const r = d.data();
    if (r.barcode !== barcode || r.type !== "sale") return;
    const factor = saleLineConversion[`${r.reference}|${r.barcode}`] || 0;
    const smallest = factor > 0 ? r.qty * factor : toSmallestUnits(product || { unit: "" }, r.qty, "");
    events.push({
      createdAt: r.createdAt, type: "Return", direction: "in",
      qty: r.qty, unit: "", rate: 0,
      deltaSmallest: smallest,
      reference: r.reference, note: `Return against sale #${r.reference}`
    });
  });

  adjustSnap.docs.forEach(d => {
    const a = d.data();
    if (a.barcode !== barcode) return;
    events.push({
      createdAt: a.createdAt,
      type: a.type === "stocktake" ? "Stock Take" : "Adjustment",
      direction: a.deltaSmallest >= 0 ? "in" : "out",
      qty: Math.abs(a.qtyEntered || 0), unit: a.unit || "",
      rate: 0, deltaSmallest: a.deltaSmallest,
      reference: a.reason || "", note: a.note || ""
    });
  });

  events.sort((a, b) => b.createdAt - a.createdAt);

  // Walk newest → oldest, unwinding each event's delta from the product's
  // CURRENT stock to reconstruct the running balance at each point in time.
  let running = product ? (product.stock || 0) : 0;
  for (const ev of events) {
    ev.balanceAfterSmallest = running;
    running -= ev.deltaSmallest;
  }

  return events.slice(0, limitCount);
}

// ---------- Profit & Loss report (mirrors ReportsActivity.kt's loadReport() —
// same fields/formula, just queried from Firestore instead of Room) ----------
//
// rangeStart/rangeEnd are epoch millis, same convention as the Android app's
// date-range filter pills (Today/This Week/This Month/All Time).
export async function loadPnL(rangeStart, rangeEnd) {
  const bId = branchId();

  const salesSnap = await getDocs(query(
    collection(db(), "sales"),
    where("branchId", "==", bId),
    where("createdAt", ">=", rangeStart),
    where("createdAt", "<=", rangeEnd)
  ));
  let totalSales = 0, cogs = 0, saleCount = 0;
  const topProductsMap = new Map(); // product name -> qty sold
  const dailyMap = new Map();       // "YYYY-MM-DD" -> total
  salesSnap.forEach(d => {
    const s = d.data();
    if (s.status !== "active") return;
    saleCount++;
    totalSales += s.total || 0;
    const day = new Date(s.createdAt).toISOString().slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) || 0) + (s.total || 0));
    (s.items || []).forEach(it => {
      cogs += (it.cost || 0) * (it.qty || 0);
      const name = it.product || it.barcode || "—";
      topProductsMap.set(name, (topProductsMap.get(name) || 0) + (it.qty || 0));
    });
  });

  const purchasesSnap = await getDocs(query(
    collection(db(), "purchases"),
    where("branchId", "==", bId),
    where("createdAt", ">=", rangeStart),
    where("createdAt", "<=", rangeEnd)
  ));
  let totalPurchases = 0;
  purchasesSnap.forEach(d => { totalPurchases += d.data().total || 0; });

  const expensesSnap = await getDocs(query(
    collection(db(), "expenses"),
    where("branchId", "==", bId),
    where("createdAt", ">=", rangeStart),
    where("createdAt", "<=", rangeEnd)
  ));
  let totalExpenses = 0;
  expensesSnap.forEach(d => { totalExpenses += d.data().amount || 0; });

  const grossProfit = totalSales - cogs;
  const netProfit = grossProfit - totalExpenses;

  const topProducts = [...topProductsMap.entries()]
    .map(([product, qty]) => ({ product, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  const dailySales = [...dailyMap.entries()]
    .map(([day, total]) => ({ day, total }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    totalSales, cogs, grossProfit, totalExpenses, netProfit,
    totalPurchases, saleCount, topProducts, dailySales
  };
}

// ---------- Balance Sheet (mirrors BalanceSheetActivity.kt field-for-field —
// see that file's class doc for the exact formula each line uses) ----------
export async function loadBalanceSheet() {
  const bId = branchId();

  const cashTxSnap = await getDocs(query(collection(db(), "cash_transactions"), where("branchId", "==", bId)));
  let cashInHand = 0, bankBalance = 0;
  cashTxSnap.forEach(d => {
    const t = d.data();
    const sign = t.type === "IN" ? 1 : t.type === "OUT" ? -1 : 0;
    if ((t.method || "").toLowerCase() === "cash") cashInHand += sign * (t.amount || 0);
    else if ((t.method || "").toLowerCase() === "bank") bankBalance += sign * (t.amount || 0);
  });

  // Stock value: cost is per PRIMARY unit while stock is stored in the
  // product's SMALLEST unit, so cost must be divided by smallestUnitFactor()
  // first — same fix BalanceSheetActivity.kt applies, see its class doc.
  const stockValue = products.reduce((sum, p) => {
    const factor = smallestUnitFactor(p);
    const costPerSmallestUnit = factor > 0 ? (p.cost || 0) / factor : (p.cost || 0);
    return sum + (p.stock || 0) * costPerSmallestUnit;
  }, 0);

  let receivables = 0, advanceFromCustomers = 0;
  customers.forEach(c => {
    const b = c.balance || 0;
    if (b > 0) receivables += b; else advanceFromCustomers += -b;
  });

  let payables = 0, advancePaidToSuppliers = 0;
  suppliers.forEach(s => {
    const b = s.balance || 0;
    if (b > 0) payables += b; else advancePaidToSuppliers += -b;
  });

  const totalAssets = cashInHand + bankBalance + stockValue + receivables + advancePaidToSuppliers;
  const totalLiabilities = payables + advanceFromCustomers;

  // Net profit (all-time), same P&L formula as loadPnL() above.
  const salesSnap = await getDocs(query(collection(db(), "sales"), where("branchId", "==", bId)));
  let totalSales = 0, cogs = 0;
  salesSnap.forEach(d => {
    const s = d.data();
    if (s.status !== "active") return;
    totalSales += s.total || 0;
    (s.items || []).forEach(it => { cogs += (it.cost || 0) * (it.qty || 0); });
  });
  const expensesSnap = await getDocs(query(collection(db(), "expenses"), where("branchId", "==", bId)));
  let totalExpenses = 0;
  expensesSnap.forEach(d => { totalExpenses += d.data().amount || 0; });
  const netProfit = (totalSales - cogs) - totalExpenses;

  const capital = totalAssets - totalLiabilities - netProfit;

  return {
    cashInHand, bankBalance, stockValue, receivables, advancePaidToSuppliers, totalAssets,
    payables, advanceFromCustomers, totalLiabilities,
    netProfit, capital
  };
}

// ---------- Zakat (mirrors ZakatActivity.kt — `zakat_years`/`zakat_payments`
// Firestore collections, field-for-field, so a year/payment started here is
// indistinguishable from one started on the Android app. zakat_month_plans
// stays device-local on Android (no server collection) so it's kept the same
// way here — see zakat.js's localStorage-based month-plan helpers instead. ----------

export async function loadLatestZakatYear() {
  const bId = branchId();
  const snap = await getDocs(query(collection(db(), "zakat_years"), where("branchId", "==", bId)));
  const years = snap.docs.map(d => ({ ...d.data(), id: d.id }));
  years.sort((a, b) => (b.startDate || 0) - (a.startDate || 0));
  return years[0] || null;
}

export async function saveZakatYear({ startDate, endDate, assetsSnapshot, totalPayable, currency, calendarType }) {
  const bId = branchId();
  const id = ids.zakatYear();
  await setDoc(doc(db(), "zakat_years", id), {
    serverId: id, startDate, endDate, assetsSnapshot, totalPayable,
    currency: currency || "Rs", calendarType: calendarType || "islamic",
    createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
  });
  return id;
}

export async function updateZakatYear(serverId, { assetsSnapshot, totalPayable, currency, calendarType }) {
  await updateDoc(doc(db(), "zakat_years", serverId), {
    assetsSnapshot, totalPayable, currency, calendarType, updatedAt: Date.now()
  });
}

export async function loadZakatPayments(yearServerId) {
  const snap = await getDocs(query(collection(db(), "zakat_payments"), where("zakatYearServerId", "==", yearServerId)));
  return snap.docs.map(d => d.data()).sort((a, b) => (b.paymentDate || 0) - (a.paymentDate || 0));
}

// Records a Zakat payment AND mirrors it as an Expense (category "Zakat") +
// a cash_transactions OUT row — same as ZakatActivity.kt's savePayment()
// (one withTransaction{} there) — so Cash in Hand/Bank Balance and the P&L's
// Total Expenses stay in sync whether the payment is logged from Android or here.
export async function saveZakatPayment(year, { amount, method, note, category, paymentDate }) {
  const bId = branchId();
  const paymentId = ids.zakatPayment();
  const expenseId = ids.expense();
  const cashTxId = ids.cashTransaction();
  const desc = "Zakat payment (" + new Date(year.startDate).toLocaleDateString() + " — " + new Date(year.endDate).toLocaleDateString() + ")" + (note ? " | " + note : "");

  await setDoc(doc(db(), "zakat_payments", paymentId), {
    serverId: paymentId, zakatYearServerId: year.serverId, amount,
    method: method || "cash", note: note || "", category: category || "",
    paymentDate: paymentDate || Date.now(),
    createdAt: Date.now(), updatedAt: Date.now(), branchId: bId
  });
  await setDoc(doc(db(), "expenses", expenseId), {
    serverId: expenseId, category: "Zakat", description: desc, amount,
    createdAt: paymentDate || Date.now(), updatedAt: Date.now(), branchId: bId
  });
  await setDoc(doc(db(), "cash_transactions", cashTxId), {
    serverId: cashTxId, type: "OUT", method: (method || "cash").toLowerCase(), amount,
    reason: "Expense: Zakat", reference: expenseId,
    createdAt: paymentDate || Date.now(), updatedAt: Date.now(), branchId: bId
  });
  return paymentId;
}
