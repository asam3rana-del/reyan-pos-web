// ================================================================
// firebase-init.js
//
// Talks to the SAME Firestore project the Android app uses (see
// CloudConfigStore.kt / BranchConfigStore.kt in the app repo). Config is
// entered once in the Setup screen and kept in this browser's localStorage —
// nothing is hardcoded here, so this file works for any shop, same as the
// Android app's "Cloud Sync Setup" screen.
//
// Firestore schema below is copied EXACTLY from SyncQueueHelper.kt /
// SyncApi.kt in the Android app repo, field-for-field, so records created
// here are indistinguishable from ones created by the Android app, and
// vice versa.
// ================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, onSnapshot, runTransaction, increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const LS_KEYS = {
  projectId: "cloud_project_id",
  apiKey: "cloud_api_key",
  appId: "cloud_app_id",
  storageBucket: "cloud_storage_bucket",
  branchId: "branch_id",
  deviceTag: "device_tag"
};

// ---------- Config storage (mirrors CloudConfigStore.kt + BranchConfigStore.kt) ----------

export function getConfig() {
  const projectId = localStorage.getItem(LS_KEYS.projectId);
  const apiKey = localStorage.getItem(LS_KEYS.apiKey);
  const appId = localStorage.getItem(LS_KEYS.appId);
  if (!projectId || !apiKey || !appId) return null;
  return {
    projectId,
    apiKey,
    appId,
    storageBucket: localStorage.getItem(LS_KEYS.storageBucket) || "",
    branchId: localStorage.getItem(LS_KEYS.branchId) || ""
  };
}

export function isConfigured() {
  const c = getConfig();
  return !!(c && c.branchId);
}

export function saveConfig({ projectId, apiKey, appId, storageBucket, branchId }) {
  localStorage.setItem(LS_KEYS.projectId, projectId.trim());
  localStorage.setItem(LS_KEYS.apiKey, apiKey.trim());
  localStorage.setItem(LS_KEYS.appId, appId.trim());
  localStorage.setItem(LS_KEYS.storageBucket, (storageBucket || "").trim());
  localStorage.setItem(LS_KEYS.branchId, branchId.trim());
}

export function clearConfig() {
  Object.values(LS_KEYS).forEach(k => { if (k !== LS_KEYS.deviceTag) localStorage.removeItem(k); });
}

export function branchId() {
  return localStorage.getItem(LS_KEYS.branchId) || "";
}

// ---------- Device tag (mirrors DeviceTag.kt) — keeps IDs unique per browser/device ----------

export function deviceTag() {
  let tag = localStorage.getItem(LS_KEYS.deviceTag);
  if (!tag) {
    tag = "WEB" + Math.random().toString(36).slice(2, 6).toUpperCase();
    localStorage.setItem(LS_KEYS.deviceTag, tag);
  }
  return tag;
}

// ---------- Firebase app / auth / firestore singletons ----------

let _app = null, _auth = null, _db = null, _readyPromise = null;

export function initFirebase() {
  const cfg = getConfig();
  if (!cfg) return null;
  if (!_app) {
    _app = initializeApp({
      projectId: cfg.projectId,
      apiKey: cfg.apiKey,
      appId: cfg.appId,
      storageBucket: cfg.storageBucket || undefined
    });
    _auth = getAuth(_app);
    _db = getFirestore(_app);
  }
  return { app: _app, auth: _auth, db: _db };
}

/** Resolves once anonymously signed in; resolves to the UID. */
export function ensureSignedIn() {
  if (_readyPromise) return _readyPromise;
  const f = initFirebase();
  if (!f) return Promise.reject(new Error("not_configured"));
  _readyPromise = new Promise((resolve, reject) => {
    onAuthStateChanged(f.auth, (user) => {
      if (user) resolve(user.uid);
    });
    signInAnonymously(f.auth).catch(reject);
  });
  return _readyPromise;
}

export function db() { return _db; }
export { collection, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, query, where, orderBy, onSnapshot, runTransaction, increment };

// ---------- Entity IDs (mirrors SyncQueueHelper.kt's *EntityId() functions) ----------
// These just need to be unique, valid Firestore doc-id strings — the exact format
// doesn't need to match the Android app's, since other devices only ever look
// records up by this id, never parse it apart.

let _seq = 0;
function nextSeq() { return (Date.now() % 100000) + (++_seq); }

export const ids = {
  customer: () => `customer:${deviceTag()}-${nextSeq()}`,
  supplier: () => `supplier:${deviceTag()}-${nextSeq()}`,
  sale: (invoice) => `sale:${invoice}`,
  purchase: (billNo) => `purchase:${billNo}`,
  payment: () => `payment:${deviceTag()}-${nextSeq()}`,
  expense: () => `expense:${deviceTag()}-${nextSeq()}`,
  cashTransaction: () => `cash_transaction:${deviceTag()}-${nextSeq()}`,
  returnLine: () => `return:${deviceTag()}-${nextSeq()}`,
  invoice: () => `WEB-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${nextSeq()}`,
  // Purchase bill number — same role as Android's genBillNo() (PurchaseRepository.kt),
  // just doesn't need to match its exact "PUR-MMMyy-####-DEVICE" format since other
  // devices only ever look this up by value, never parse it apart.
  purchaseBillNo: () => `PUR-WEB-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${nextSeq()}`
};

// ================================================================
// Unit-ladder stock math — ported EXACTLY from Database.kt's
// Product.unitLadder() / toSmallestUnits() so stock decrements the same
// way here as they do on the Android app for multi-tier (carton/box/pcs
// style) products. `stock` in Firestore is always in "smallest units",
// same as Room's `stock` column.
// ================================================================

function sameUnit(a, b) {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Ordered ladder of a product's units, SMALLEST first — see Database.kt's
 *  Product.unitLadder() for the authoritative version this mirrors. */
export function unitLadder(product) {
  const hasSecondary = !!product.secondaryUnit && product.secondaryUnitQty > 0;
  const hasTertiary = hasSecondary && !!product.tertiaryUnit && product.tertiaryUnitQty > 0;

  if (!hasSecondary) {
    return [{ unit: product.unit, smallestPerUnit: 1.0 }];
  }
  if (!hasTertiary) {
    return [
      { unit: product.secondaryUnit, smallestPerUnit: 1.0 },
      { unit: product.unit, smallestPerUnit: product.secondaryUnitQty }
    ];
  }
  return [
    { unit: product.tertiaryUnit, smallestPerUnit: 1.0 },
    { unit: product.secondaryUnit, smallestPerUnit: product.tertiaryUnitQty },
    { unit: product.unit, smallestPerUnit: product.secondaryUnitQty * product.tertiaryUnitQty }
  ];
}

export function smallestUnitFactor(product) {
  const ladder = unitLadder(product);
  return ladder[ladder.length - 1].smallestPerUnit;
}

/** Converts qty entered in enteredUnit into the product's smallest-unit basis. */
export function toSmallestUnits(product, qty, enteredUnit) {
  const ladder = unitLadder(product);
  const tier = ladder.find(t => sameUnit(t.unit, enteredUnit)) || ladder[ladder.length - 1];
  return qty * tier.smallestPerUnit;
}

/** All unit names available for this product (for the Unit dropdown), smallest first. */
export function unitNames(product) {
  return unitLadder(product).map(t => t.unit);
}
