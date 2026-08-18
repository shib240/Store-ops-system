'use strict';

const path = require('path');
const { createCsvStore } = require('./csvStore');
const productStore = require('./store');

const SALE_HEADERS = [
  'sale_id', 'transaction_id', 'product_id', 'sku', 'name', 'qty',
  'unit_price', 'line_total', 'payment_method', 'cashier', 'timestamp',
];
const SALE_NUMERIC = ['sale_id', 'transaction_id', 'product_id', 'qty', 'unit_price', 'line_total'];

const saleStore = createCsvStore({
  filePath: path.join(__dirname, '..', 'data', 'sales.csv'),
  headers: SALE_HEADERS,
  numericFields: SALE_NUMERIC,
  idField: 'sale_id',
});

function nextTransactionId() {
  const rows = saleStore.all();
  return rows.reduce((max, r) => Math.max(max, Number(r.transaction_id) || 0), 0) + 1;
}

/**
 * Ring up a basket of { product_id, qty } lines as one transaction.
 * Validates stock availability for every line before committing any of
 * them, so a sale never partially applies.
 */
function ringUpSale({ items, payment_method, cashier }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Sale must include at least one item');
  }

  const resolved = items.map(({ product_id, qty }) => {
    const product = productStore.getProduct(product_id);
    if (!product) throw new Error(`Product ${product_id} not found`);
    const quantity = Number(qty) || 0;
    if (quantity <= 0) throw new Error(`Invalid quantity for ${product.name}`);
    if (quantity > product.current_stock) {
      throw new Error(`Insufficient stock for ${product.name} (have ${product.current_stock}, need ${quantity})`);
    }
    return { product, quantity };
  });

  const transactionId = nextTransactionId();
  const timestamp = new Date().toISOString();
  const lines = [];

  for (const { product, quantity } of resolved) {
    productStore.adjustStock(product.id, -quantity);
    const lineTotal = Number((product.sell_price * quantity).toFixed(2));
    const record = saleStore.add(
      {
        transaction_id: transactionId,
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        qty: quantity,
        unit_price: product.sell_price,
        line_total: lineTotal,
        payment_method: payment_method || 'card',
        cashier: cashier || 'Unassigned',
        timestamp,
      }
    );
    lines.push(record);
  }

  const total = Number(lines.reduce((sum, l) => sum + l.line_total, 0).toFixed(2));
  return { transaction_id: transactionId, timestamp, lines, total };
}

function getSales() {
  return saleStore.all();
}

function getTodaysSalesStats() {
  const today = new Date().toISOString().slice(0, 10);
  const todaysLines = saleStore.all().filter((s) => String(s.timestamp).slice(0, 10) === today);
  const revenue = todaysLines.reduce((sum, l) => sum + l.line_total, 0);
  const transactionIds = new Set(todaysLines.map((l) => l.transaction_id));
  return {
    transactions_today: transactionIds.size,
    items_sold_today: todaysLines.reduce((sum, l) => sum + l.qty, 0),
    revenue_today: Number(revenue.toFixed(2)),
  };
}

module.exports = { ringUpSale, getSales, getTodaysSalesStats };
