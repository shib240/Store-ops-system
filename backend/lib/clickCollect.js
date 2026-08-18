'use strict';

const path = require('path');
const { createCsvStore } = require('./csvStore');
const productStore = require('./store');

const ORDER_HEADERS = ['order_id', 'customer_name', 'customer_phone', 'status', 'requested_time', 'created_at'];
const ORDER_NUMERIC = ['order_id'];

const ITEM_HEADERS = ['item_id', 'order_id', 'product_id', 'sku', 'name', 'qty'];
const ITEM_NUMERIC = ['item_id', 'order_id', 'product_id', 'qty'];

const orderStore = createCsvStore({
  filePath: path.join(__dirname, '..', 'data', 'click_collect_orders.csv'),
  headers: ORDER_HEADERS,
  numericFields: ORDER_NUMERIC,
  idField: 'order_id',
});

const itemStore = createCsvStore({
  filePath: path.join(__dirname, '..', 'data', 'click_collect_items.csv'),
  headers: ITEM_HEADERS,
  numericFields: ITEM_NUMERIC,
  idField: 'item_id',
});

// Valid forward progression for an order's fulfillment lifecycle.
const STATUS_FLOW = ['pending', 'picking', 'ready', 'collected'];

function withItems(order) {
  return { ...order, items: itemStore.where((i) => i.order_id === order.order_id) };
}

function getOrders() {
  return orderStore.all().map(withItems);
}

function getOrder(orderId) {
  const order = orderStore.find(orderId);
  return order ? withItems(order) : null;
}

function createOrder({ customer_name, customer_phone, requested_time, items }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Order must include at least one item');
  }
  const resolvedItems = items.map(({ product_id, qty }) => {
    const product = productStore.getProduct(product_id);
    if (!product) throw new Error(`Product ${product_id} not found`);
    return { product, qty: Number(qty) || 1 };
  });

  const order = orderStore.add(
    {
      customer_name: customer_name || 'Walk-in',
      customer_phone: customer_phone || '',
      requested_time: requested_time || '',
    },
    { status: 'pending', created_at: new Date().toISOString().slice(0, 16).replace('T', ' ') }
  );

  for (const { product, qty } of resolvedItems) {
    itemStore.add({
      order_id: order.order_id,
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      qty,
    });
  }

  return withItems(order);
}

function advanceStatus(orderId, targetStatus) {
  const order = orderStore.find(orderId);
  if (!order) throw new Error('Order not found');
  if (!STATUS_FLOW.includes(targetStatus)) throw new Error('Invalid status');
  const updated = orderStore.update(orderId, { status: targetStatus });
  return withItems(updated);
}

function getPendingCount() {
  return orderStore.where((o) => o.status !== 'collected').length;
}

module.exports = { getOrders, getOrder, createOrder, advanceStatus, getPendingCount, STATUS_FLOW };
