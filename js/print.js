// ================================================================
// print.js
//
// Bill print — opens a new browser tab/window with a plain, thermal-receipt-
// styled HTML page and triggers window.print() on it, then the browser's own
// print dialog (Save as PDF / pick a printer) takes over from there. This
// covers the README's "❌ Bill print/PDF" gap using only what a browser can
// already do — no server, no PDF library.
// ================================================================

import { getShopInfo } from "./shop.js";

function money(n) {
  return "Rs " + (n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

const RECEIPT_STYLE = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; margin: 0; padding: 18px; color: #0B2545; }
  .receipt { max-width: 340px; margin: 0 auto; }
  .center { text-align: center; }
  .shop-name { font-size: 17px; font-weight: 800; margin: 0; }
  .shop-sub { font-size: 12px; color: #555; margin: 2px 0; }
  .divider { border-top: 1px dashed #999; margin: 10px 0; }
  .meta-row { display: flex; justify-content: space-between; font-size: 12.5px; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
  th { text-align: left; font-size: 11px; color: #555; border-bottom: 1px solid #ccc; padding: 4px 2px; }
  td { padding: 4px 2px; vertical-align: top; }
  td.num, th.num { text-align: right; }
  .totals-row { display: flex; justify-content: space-between; font-size: 13px; padding: 2px 0; }
  .totals-row.grand { font-weight: 800; font-size: 15px; border-top: 1px dashed #999; margin-top: 6px; padding-top: 6px; }
  .footer { text-align: center; font-size: 12px; color: #555; margin-top: 16px; }
  .print-btn-bar { text-align: center; margin-bottom: 14px; }
  .print-btn-bar button {
    background: #0B2545; color: #fff; border: none; padding: 10px 22px;
    border-radius: 10px; font-weight: 700; font-size: 13.5px; cursor: pointer;
  }
  @media print { .print-btn-bar { display: none; } body { padding: 0; } }
`;

function openReceiptWindow(bodyHtml, docTitle) {
  const win = window.open("", "_blank", "width=420,height=640");
  if (!win) { alert("Print window block ho gayi — popup blocker check karein."); return; }
  win.document.write(`
    <!DOCTYPE html>
    <html><head><meta charset="UTF-8"><title>${escapeHtml(docTitle)}</title>
    <style>${RECEIPT_STYLE}</style></head>
    <body>
      <div class="print-btn-bar"><button onclick="window.print()">🖨 Print</button></div>
      <div class="receipt">${bodyHtml}</div>
    </body></html>
  `);
  win.document.close();
  win.focus();
}

function shopHeaderHtml() {
  const shop = getShopInfo();
  return `
    <div class="center">
      <p class="shop-name">${escapeHtml(shop.name)}</p>
      ${shop.address ? `<p class="shop-sub">${escapeHtml(shop.address)}</p>` : ""}
      ${shop.phone ? `<p class="shop-sub">${escapeHtml(shop.phone)}</p>` : ""}
    </div>
    <div class="divider"></div>
  `;
}

export function printSaleReceipt(sale, customerName) {
  const items = sale.items || [];
  const rows = items.map(it => `
    <tr>
      <td>${escapeHtml(it.product)}<br><span style="color:#777;">${it.qty} ${escapeHtml(it.unit)} × ${money(it.unitPrice)}</span></td>
      <td class="num">${money(it.amount)}</td>
    </tr>
  `).join("");

  const due = (sale.total || 0) - (sale.paid || 0);

  const body = `
    ${shopHeaderHtml()}
    <div class="meta-row"><span>Invoice</span><span><b>${escapeHtml(sale.invoice)}</b></span></div>
    <div class="meta-row"><span>Date</span><span>${new Date(sale.createdAt).toLocaleString("en-PK")}</span></div>
    <div class="meta-row"><span>Customer</span><span>${escapeHtml(customerName || "Cash")}</span></div>
    <table>
      <thead><tr><th>Item</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="divider"></div>
    <div class="totals-row"><span>Subtotal</span><span>${money(sale.subtotal)}</span></div>
    ${sale.discount ? `<div class="totals-row"><span>Discount</span><span>-${money(sale.discount)}</span></div>` : ""}
    <div class="totals-row grand"><span>Total</span><span>${money(sale.total)}</span></div>
    <div class="totals-row"><span>Paid (${escapeHtml(sale.paymentMethod)})</span><span>${money(sale.paid)}</span></div>
    ${due > 0 ? `<div class="totals-row"><span>Due</span><span>${money(due)}</span></div>` : ""}
    <div class="footer">Shukriya! — Thank you for shopping with us.</div>
  `;

  openReceiptWindow(body, "Invoice " + sale.invoice);
}

export function printPurchaseReceipt(purchase, supplierName) {
  const items = purchase.items || [];
  const rows = items.map(it => `
    <tr>
      <td>${escapeHtml(it.barcode)}<br><span style="color:#777;">${it.qty} ${escapeHtml(it.unit)} × ${money(it.unitCost)}</span></td>
      <td class="num">${money(it.amount)}</td>
    </tr>
  `).join("");

  const due = (purchase.total || 0) - (purchase.paid || 0);

  const body = `
    ${shopHeaderHtml()}
    <p class="center" style="font-weight:700; margin:0 0 8px;">PURCHASE BILL</p>
    <div class="meta-row"><span>Bill No</span><span><b>${escapeHtml(purchase.billNo)}</b></span></div>
    <div class="meta-row"><span>Date</span><span>${new Date(purchase.createdAt).toLocaleString("en-PK")}</span></div>
    <div class="meta-row"><span>Supplier</span><span>${escapeHtml(supplierName || "—")}</span></div>
    <table>
      <thead><tr><th>Item</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="divider"></div>
    <div class="totals-row"><span>Subtotal</span><span>${money(purchase.subtotal)}</span></div>
    ${purchase.discount ? `<div class="totals-row"><span>Discount</span><span>-${money(purchase.discount)}</span></div>` : ""}
    <div class="totals-row grand"><span>Total</span><span>${money(purchase.total)}</span></div>
    <div class="totals-row"><span>Paid</span><span>${money(purchase.paid)}</span></div>
    ${due > 0 ? `<div class="totals-row"><span>Due (to supplier)</span><span>${money(due)}</span></div>` : ""}
    <div class="footer">Internal copy — supplier bill record.</div>
  `;

  openReceiptWindow(body, "Purchase " + purchase.billNo);
}
