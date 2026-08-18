'use strict';

const path = require('path');
const { createCsvStore } = require('./csvStore');

const PRODUCT_HEADERS = [
  'id', 'sku', 'name', 'category', 'supplier', 'unit_cost', 'sell_price',
  'current_stock', 'reorder_point', 'reorder_qty', 'max_stock', 'lead_time_days',
];
const PRODUCT_NUMERIC = [
  'id', 'unit_cost', 'sell_price', 'current_stock', 'reorder_point', 'reorder_qty', 'max_stock', 'lead_time_days',
];

const ORDER_HEADERS = [
  'order_id', 'product_id', 'sku', 'name', 'supplier', 'qty_ordered',
  'unit_cost', 'total_cost', 'order_date', 'expected_arrival', 'status', 'received_date',
];
const ORDER_NUMERIC = ['order_id', 'product_id', 'qty_ordered', 'unit_cost', 'total_cost'];

const productStore = createCsvStore({
  filePath: path.join(__dirname, '..', 'data', 'products.csv'),
  headers: PRODUCT_HEADERS,
  numericFields: PRODUCT_NUMERIC,
  idField: 'id',
});

const orderStore = createCsvStore({
  filePath: path.join(__dirname, '..', 'data', 'orders_history.csv'),
  headers: ORDER_HEADERS,
  numericFields: ORDER_NUMERIC,
  idField: 'order_id',
});

module.exports = {
  PRODUCT_HEADERS,
  ORDER_HEADERS,

  getProducts: () => productStore.all(),
  getProduct: (id) => productStore.find(id),
  addProduct: (data) =>
    productStore.add({
      sku: data.sku || '',
      name: data.name || '',
      category: data.category || '',
      supplier: data.supplier || '',
      unit_cost: Number(data.unit_cost) || 0,
      sell_price: Number(data.sell_price) || 0,
      current_stock: Number(data.current_stock) || 0,
      reorder_point: Number(data.reorder_point) || 0,
      reorder_qty: Number(data.reorder_qty) || 0,
      max_stock: Number(data.max_stock) || 0,
      lead_time_days: Number(data.lead_time_days) || 0,
    }),
  updateProduct: (id, patch) => productStore.update(id, patch),
  deleteProduct: (id) => productStore.remove(id),
  adjustStock: (id, delta) => {
    const product = productStore.find(id);
    if (!product) return null;
    return productStore.update(id, { current_stock: product.current_stock + delta });
  },

  getOrders: () => orderStore.all(),
  addOrder: (order) => orderStore.addRaw({ order_id: nextOrderId(), ...order }),
  updateOrder: (orderId, patch) => orderStore.update(orderId, patch),
};

function nextOrderId() {
  const rows = orderStore.all();
  return rows.reduce((max, r) => Math.max(max, Number(r.order_id) || 0), 0) + 1;
}
