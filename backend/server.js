'use strict';

const http = require('http');
const { URL } = require('url');
const store = require('./lib/store');
const replenishment = require('./lib/replenishment');
const pos = require('./lib/pos');
const roster = require('./lib/roster');
const clickCollect = require('./lib/clickCollect');

const PORT = process.env.PORT || 4000;

function send(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function pendingByProductId() {
  const map = {};
  for (const o of store.getOrders()) {
    if (o.status === 'pending') map[o.product_id] = true;
  }
  return map;
}

const routes = [
  // ---- Inventory / replenishment -----------------------------------
  { method: 'GET', pattern: /^\/api\/products$/, handler: async (req, res) => send(res, 200, store.getProducts()) },
  {
    method: 'POST',
    pattern: /^\/api\/products$/,
    handler: async (req, res) => {
      const body = await readBody(req);
      if (!body.sku || !body.name) return send(res, 400, { error: 'sku and name are required' });
      send(res, 201, store.addProduct(body));
    },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/products\/(\d+)$/,
    handler: async (req, res, match) => {
      const body = await readBody(req);
      const updated = store.updateProduct(match[1], body);
      if (!updated) return send(res, 404, { error: 'product not found' });
      send(res, 200, updated);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/products\/(\d+)$/,
    handler: async (req, res, match) => {
      const ok = store.deleteProduct(match[1]);
      if (!ok) return send(res, 404, { error: 'product not found' });
      send(res, 204, {});
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/replenishment$/,
    handler: async (req, res) => send(res, 200, replenishment.buildSuggestions(store.getProducts(), pendingByProductId())),
  },
  {
    method: 'POST',
    pattern: /^\/api\/replenishment\/(\d+)\/order$/,
    handler: async (req, res, match) => {
      const product = store.getProduct(match[1]);
      if (!product) return send(res, 404, { error: 'product not found' });
      const body = await readBody(req);
      const qty = Number(body.qty) || replenishment.suggestOrderQty(product);
      const orderDate = new Date();
      const expected = new Date(orderDate.getTime() + product.lead_time_days * 86400000);
      const order = store.addOrder({
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        supplier: product.supplier,
        qty_ordered: qty,
        unit_cost: product.unit_cost,
        total_cost: Number((qty * product.unit_cost).toFixed(2)),
        order_date: orderDate.toISOString().slice(0, 10),
        expected_arrival: expected.toISOString().slice(0, 10),
        status: 'pending',
        received_date: '',
      });
      send(res, 201, order);
    },
  },
  { method: 'GET', pattern: /^\/api\/orders$/, handler: async (req, res) => send(res, 200, store.getOrders()) },
  {
    method: 'POST',
    pattern: /^\/api\/orders\/(\d+)\/receive$/,
    handler: async (req, res, match) => {
      const orders = store.getOrders();
      const order = orders.find((o) => o.order_id === Number(match[1]));
      if (!order) return send(res, 404, { error: 'order not found' });
      if (order.status === 'received') return send(res, 400, { error: 'order already received' });
      const product = store.getProduct(order.product_id);
      if (product) store.adjustStock(product.id, order.qty_ordered);
      const updated = store.updateOrder(order.order_id, {
        status: 'received',
        received_date: new Date().toISOString().slice(0, 10),
      });
      send(res, 200, updated);
    },
  },

  // ---- POS / checkout -------------------------------------------------
  {
    method: 'POST',
    pattern: /^\/api\/pos\/sale$/,
    handler: async (req, res) => {
      const body = await readBody(req);
      try {
        const result = pos.ringUpSale(body);
        send(res, 201, result);
      } catch (err) {
        send(res, 400, { error: err.message });
      }
    },
  },
  { method: 'GET', pattern: /^\/api\/pos\/sales$/, handler: async (req, res) => send(res, 200, pos.getSales()) },

  // ---- Staff & rostering ------------------------------------------------
  { method: 'GET', pattern: /^\/api\/staff$/, handler: async (req, res) => send(res, 200, roster.getStaff()) },
  {
    method: 'POST',
    pattern: /^\/api\/staff$/,
    handler: async (req, res) => {
      const body = await readBody(req);
      if (!body.name) return send(res, 400, { error: 'name is required' });
      send(res, 201, roster.addStaff(body));
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/roster$/,
    handler: async (req, res, match, url) => {
      const date = url.searchParams.get('date');
      send(res, 200, roster.getShifts(date));
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/roster$/,
    handler: async (req, res) => {
      const body = await readBody(req);
      try {
        send(res, 201, roster.addShift(body));
      } catch (err) {
        send(res, 400, { error: err.message });
      }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/roster\/(\d+)\/checkin$/,
    handler: async (req, res, match) => {
      const updated = roster.setShiftStatus(match[1], 'checked_in');
      if (!updated) return send(res, 404, { error: 'shift not found' });
      send(res, 200, updated);
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/roster\/(\d+)\/checkout$/,
    handler: async (req, res, match) => {
      const updated = roster.setShiftStatus(match[1], 'completed');
      if (!updated) return send(res, 404, { error: 'shift not found' });
      send(res, 200, updated);
    },
  },

  // ---- Click & collect ----------------------------------------------
  { method: 'GET', pattern: /^\/api\/click-collect$/, handler: async (req, res) => send(res, 200, clickCollect.getOrders()) },
  {
    method: 'POST',
    pattern: /^\/api\/click-collect$/,
    handler: async (req, res) => {
      const body = await readBody(req);
      try {
        send(res, 201, clickCollect.createOrder(body));
      } catch (err) {
        send(res, 400, { error: err.message });
      }
    },
  },
  {
    method: 'POST',
    pattern: /^\/api\/click-collect\/(\d+)\/status$/,
    handler: async (req, res, match) => {
      const body = await readBody(req);
      try {
        send(res, 200, clickCollect.advanceStatus(match[1], body.status));
      } catch (err) {
        send(res, 400, { error: err.message });
      }
    },
  },

  // ---- Unified overview ------------------------------------------------
  {
    method: 'GET',
    pattern: /^\/api\/overview$/,
    handler: async (req, res) => {
      const products = store.getProducts();
      const orders = store.getOrders();
      const invStats = replenishment.buildStats(products, orders);
      const salesStats = pos.getTodaysSalesStats();
      const onShift = roster.getOnShiftNow();
      send(res, 200, {
        inventory: invStats,
        sales: salesStats,
        staff_on_shift: onShift.length,
        staff_on_shift_list: onShift,
        click_collect_pending: clickCollect.getPendingCount(),
      });
    },
  },
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') return send(res, 204, {});

  for (const route of routes) {
    if (route.method !== req.method) continue;
    const match = url.pathname.match(route.pattern);
    if (match) {
      try {
        return await route.handler(req, res, match, url);
      } catch (err) {
        console.error(err);
        return send(res, 500, { error: 'internal server error' });
      }
    }
  }

  send(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
});

server.listen(PORT, () => {
  console.log(`Store Ops API listening on http://localhost:${PORT}`);
});
