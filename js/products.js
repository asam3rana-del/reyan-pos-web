// ================================================================
// products.js — "Items" hub: Products / Categories / Units tabs.
// Mirrors ItemsActivity.kt (3-tab hub) + ProductActivity.kt (add/edit
// product form). Products screen was the biggest remaining gap vs the
// Android app — until now there was no way to create a brand-new
// product from the web at all (Purchase/Sale could only match an
// EXISTING product by name).
//
// NOTE (known simplification vs Android): only a 2-tier unit ladder
// (main unit + one secondary/smallest unit) is supported here — the
// Android app also supports a 3rd "tertiary" tier, which is rarely
// used and left out of this first web version to keep the form usable.
// ================================================================

import {
  products, categories, units,
  saveProduct, deleteProduct, findProductByBarcode,
  saveCategory, deleteCategory, saveUnit, deleteUnit
} from "./data.js";
import { showToast } from "./ui.js";

let currentTab = "products"; // "products" | "categories" | "units"
let editingBarcode = null;   // barcode of product being edited, or null for "add new"

function el(id) { return document.getElementById(id); }

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Tab switching ----------

function switchTab(tab) {
  currentTab = tab;
  ["products", "categories", "units"].forEach(t => {
    el("itemsTab" + cap(t)).classList.toggle("active", t === tab);
    el("itemsPane" + cap(t)).classList.toggle("hidden", t !== tab);
  });
  if (tab === "products") { resetProductForm(); renderProductList(); }
  if (tab === "categories") renderCategoryList();
  if (tab === "units") renderUnitList();
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ---------- Products pane ----------

function populateUnitDropdowns() {
  const opts = units.length ? units : ["pcs"];
  [el("prodUnit"), el("prodSecondaryUnit")].forEach((sel, i) => {
    const keepValue = sel.value;
    sel.innerHTML = "";
    if (i === 1) sel.appendChild(new Option("None", ""));
    opts.forEach(u => sel.appendChild(new Option(u, u)));
    if ([...sel.options].some(o => o.value === keepValue)) sel.value = keepValue;
  });
}

function populateCategoryList() {
  const dl = el("prodCategoryList");
  dl.innerHTML = "";
  categories.forEach(c => dl.appendChild(new Option(c)));
}

function resetProductForm() {
  editingBarcode = null;
  el("productFormTitle").textContent = "+ Add Product";
  el("prodBarcode").value = "";
  el("prodBarcode").disabled = false;
  el("prodName").value = "";
  el("prodSearchTag").value = "";
  el("prodCategory").value = "";
  populateUnitDropdowns();
  populateCategoryList();
  el("prodUnit").value = "pcs";
  el("prodSecondaryUnit").value = "";
  el("prodSecondaryQty").value = "";
  el("prodCost").value = 0;
  el("prodSalePrice").value = 0;
  el("prodWholesalePrice").value = 0;
  el("prodReorderLevel").value = 0;
  el("prodExpiry").value = "";
  el("openingStockField").classList.remove("hidden");
  el("prodOpeningStock").value = 0;
  el("btnCancelProductEdit").classList.add("hidden");
  el("btnSaveProduct").textContent = "SAVE";
  toggleSecondaryQtyField();
}

function toggleSecondaryQtyField() {
  const has = !!el("prodSecondaryUnit").value;
  el("secondaryQtyField").classList.toggle("hidden", !has);
  el("secondaryQtyHint").textContent = has
    ? `1 ${el("prodUnit").value} = ? ${el("prodSecondaryUnit").value}`
    : "";
}

function startEditProduct(p) {
  editingBarcode = p.barcode;
  el("productFormTitle").textContent = "Edit Product";
  el("prodBarcode").value = p.barcode || "";
  el("prodBarcode").disabled = true; // barcode is the doc id — can't change on edit
  el("prodName").value = p.name || "";
  el("prodSearchTag").value = p.searchTag || "";
  el("prodCategory").value = p.category || "";
  populateUnitDropdowns();
  populateCategoryList();
  el("prodUnit").value = p.unit || "pcs";
  el("prodSecondaryUnit").value = p.secondaryUnit || "";
  el("prodSecondaryQty").value = p.secondaryUnitQty || "";
  el("prodCost").value = p.cost || 0;
  el("prodSalePrice").value = p.salePrice || 0;
  el("prodWholesalePrice").value = p.wholesalePrice || 0;
  el("prodReorderLevel").value = p.reorderLevel || 0;
  el("prodExpiry").value = p.expiry || "";
  // Stock only changes via Purchase/Sale/Stock Adjustment, never a plain edit here.
  el("openingStockField").classList.add("hidden");
  el("btnCancelProductEdit").classList.remove("hidden");
  el("btnSaveProduct").textContent = "SAVE CHANGES";
  toggleSecondaryQtyField();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function handleDeleteProduct(p) {
  if (!confirm(`"${p.name}" ko delete kar dein? Is se purani sales/purchases ka record nahi hataega, sirf item list se hat jaega.`)) return;
  try {
    await deleteProduct(p.barcode);
    showToast("Product delete ho gaya");
    if (editingBarcode === p.barcode) resetProductForm();
    renderProductList();
  } catch (e) {
    showToast("Delete nahi ho saka: " + e.message);
  }
}

function renderProductList() {
  const box = el("productList");
  const q = (el("productSearch").value || "").trim().toLowerCase();
  const list = products
    .filter(p => !q || (p.name || "").toLowerCase().includes(q) || (p.searchTag || "").toLowerCase().includes(q) || (p.barcode || "").includes(q))
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  box.innerHTML = "";
  if (!list.length) { box.innerHTML = "<p class='muted'>Koi item nahi mila.</p>"; return; }

  list.forEach(p => {
    const low = (p.stock || 0) <= (p.reorderLevel || 0);
    const div = document.createElement("div");
    div.className = "card row-between party-row";
    div.innerHTML = `
      <div>
        <div><b>${p.name}</b></div>
        <div class="muted">${p.category || "General"} · ${money(p.salePrice)} / ${p.unit}</div>
      </div>
      <div style="text-align:right">
        <div style="color:${low ? "var(--red)" : "var(--text-dark)"}; font-weight:800;">${p.stock || 0} ${p.secondaryUnit || p.unit}</div>
        <div class="party-row-actions">
          <span class="party-edit" data-barcode="${p.barcode}">Edit</span>
          <span class="party-delete" data-barcode="${p.barcode}">Delete</span>
        </div>
      </div>
    `;
    box.appendChild(div);
  });

  box.querySelectorAll(".party-edit").forEach(elm => {
    elm.addEventListener("click", () => {
      const p = findProductByBarcode(elm.dataset.barcode);
      if (p) startEditProduct(p);
    });
  });
  box.querySelectorAll(".party-delete").forEach(elm => {
    elm.addEventListener("click", () => {
      const p = findProductByBarcode(elm.dataset.barcode);
      if (p) handleDeleteProduct(p);
    });
  });
}

async function handleSaveProduct() {
  const name = el("prodName").value.trim();
  if (!name) { showToast("Item ka naam likhna zaroori hai"); return; }

  const secondaryUnit = el("prodSecondaryUnit").value;
  const secondaryQty = parseFloat(el("prodSecondaryQty").value) || 0;
  if (secondaryUnit && secondaryQty <= 0) {
    showToast("Secondary unit ke liye conversion qty likhein (e.g. 1 Carton = 12 Piece)");
    return;
  }

  el("btnSaveProduct").disabled = true;
  try {
    await saveProduct({
      editingBarcode,
      barcode: el("prodBarcode").value,
      name,
      searchTag: el("prodSearchTag").value,
      category: el("prodCategory").value,
      unit: el("prodUnit").value,
      secondaryUnit,
      secondaryUnitQty: secondaryQty,
      cost: parseFloat(el("prodCost").value) || 0,
      salePrice: parseFloat(el("prodSalePrice").value) || 0,
      wholesalePrice: parseFloat(el("prodWholesalePrice").value) || 0,
      reorderLevel: parseFloat(el("prodReorderLevel").value) || 0,
      expiry: el("prodExpiry").value,
      openingStock: parseFloat(el("prodOpeningStock").value) || 0
    });
    showToast(editingBarcode ? "Product update ho gaya" : "Product add ho gaya");
    resetProductForm();
    renderProductList();
  } catch (e) {
    showToast("Save nahi ho saka: " + e.message);
  } finally {
    el("btnSaveProduct").disabled = false;
  }
}

// ---------- Categories pane ----------

function renderCategoryList() {
  const box = el("categoryList");
  box.innerHTML = "";
  if (!categories.length) { box.innerHTML = "<p class='muted'>Koi category nahi hai.</p>"; return; }
  categories.forEach(name => {
    const count = products.filter(p => p.category === name).length;
    const div = document.createElement("div");
    div.className = "card row-between party-row";
    div.innerHTML = `
      <div><b>${name}</b><div class="muted">${count} item${count === 1 ? "" : "s"}</div></div>
      <span class="party-delete" data-name="${name}">Delete</span>
    `;
    box.appendChild(div);
  });
  box.querySelectorAll(".party-delete").forEach(elm => {
    elm.addEventListener("click", async () => {
      const name = elm.dataset.name;
      const count = products.filter(p => p.category === name).length;
      if (count > 0 && !confirm(`"${name}" category mein ${count} items hain — category delete karne se wo items "General" ki tarah reh jayenge (khud General mein move nahi honge). Delete karein?`)) return;
      try {
        await deleteCategory(name);
        showToast("Category delete ho gayi");
      } catch (e) {
        showToast("Delete nahi ho saka: " + e.message);
      }
    });
  });
}

async function handleAddCategory() {
  const name = el("newCategoryName").value.trim();
  if (!name) { showToast("Category ka naam likhein"); return; }
  try {
    await saveCategory(name);
    el("newCategoryName").value = "";
    showToast("Category add ho gayi");
  } catch (e) {
    showToast("Add nahi ho saka: " + e.message);
  }
}

// ---------- Units pane ----------

function renderUnitList() {
  const box = el("unitList");
  box.innerHTML = "";
  if (!units.length) { box.innerHTML = "<p class='muted'>Koi unit nahi hai.</p>"; return; }
  units.forEach(name => {
    const count = products.filter(p => p.unit === name || p.secondaryUnit === name).length;
    const div = document.createElement("div");
    div.className = "card row-between party-row";
    div.innerHTML = `
      <div><b>${name}</b><div class="muted">${count} item${count === 1 ? "" : "s"} use kar rahay hain</div></div>
      <span class="party-delete" data-name="${name}">Delete</span>
    `;
    box.appendChild(div);
  });
  box.querySelectorAll(".party-delete").forEach(elm => {
    elm.addEventListener("click", async () => {
      const name = elm.dataset.name;
      const count = products.filter(p => p.unit === name || p.secondaryUnit === name).length;
      if (count > 0 && !confirm(`"${name}" unit ${count} item(s) use kar rahay hain — delete karne se un items ka unit field khud nahi badlega. Delete karein?`)) return;
      try {
        await deleteUnit(name);
        showToast("Unit delete ho gayi");
      } catch (e) {
        showToast("Delete nahi ho saka: " + e.message);
      }
    });
  });
}

async function handleAddUnit() {
  const name = el("newUnitName").value.trim();
  if (!name) { showToast("Unit ka naam likhein"); return; }
  try {
    await saveUnit(name);
    el("newUnitName").value = "";
    showToast("Unit add ho gayi");
  } catch (e) {
    showToast("Add nahi ho saka: " + e.message);
  }
}

// ---------- Init ----------

export function initProductsScreen() {
  el("itemsTabProducts").addEventListener("click", () => switchTab("products"));
  el("itemsTabCategories").addEventListener("click", () => switchTab("categories"));
  el("itemsTabUnits").addEventListener("click", () => switchTab("units"));

  el("productSearch").addEventListener("input", renderProductList);
  el("btnCancelProductEdit").addEventListener("click", resetProductForm);
  el("btnSaveProduct").addEventListener("click", handleSaveProduct);
  el("prodUnit").addEventListener("change", toggleSecondaryQtyField);
  el("prodSecondaryUnit").addEventListener("change", toggleSecondaryQtyField);

  el("btnAddCategory").addEventListener("click", handleAddCategory);
  el("btnAddUnit").addEventListener("click", handleAddUnit);

  switchTab("products");
}

/** Called whenever products/categories/units listeners deliver fresh data,
 *  so the currently-visible pane (and dropdowns) stay in sync live. */
export function refreshProductsScreen() {
  populateUnitDropdowns();
  populateCategoryList();
  if (currentTab === "products") renderProductList();
  if (currentTab === "categories") renderCategoryList();
  if (currentTab === "units") renderUnitList();
}
