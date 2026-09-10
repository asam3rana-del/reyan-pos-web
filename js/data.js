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

let _productsUnsub = null, _customersUnsub = null, _suppliersUnsub = null, _usersUnsub = null;

export function startProductListener(onChange) {
  if (_productsUnsub) _productsUnsub();
  const q = query(collection(db(), "products"), where("branchId", "==", branchId()));
  _productsUnsub = onSnapshot(q, (snap) => {
    products = snap.docs.map(d => ({ ...d.data(), barcode: d.id }));
    onChange && onChange(products);
  });
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
export async function createWebUser({ username, displayName, role, webPasswordHash }) {
  const bId = branchId();
  const id = `user:${username.trim()}`;
  await setDoc(doc(db(), "users", id), {
    serverId: id, username: username.trim(), displayName: (displayName || username).trim(),
    role: role || "cashier", phone: "", active: true,
    webPasswordHash, updatedAt: Date.now(), branchId: bId
  });
  return id;
}

export async function setUserWebPassword(userId, webPasswordHash) {
  await updateDoc(doc(db(), "users", userId), { webPasswordHash, updatedAt: Date.now() });
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

// ---------- Save a sale (mirrors SyncQueueHelper.saleJson() field-for-field) ----------
//
// lines: [{ barcode, product, qty, unit, unitPrice, cost, amount }]
// Returns the invoice number on success.
export async function saveSale({ lines, customerName, saleType, subtotal, discount, total, paid, paymentMethod }) {
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
    dueDate: 0,
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
