'use strict';

const API_BASE = window.STOREOPS_API_BASE || 'http://localhost:4000/api';

const els = {
  connDot: document.getElementById('connDot'),
  connText: document.getElementById('connText'),
  toast: document.getElementById('toast'),
};

function money(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function setConn(live) {
  els.connDot.classList.toggle('live', live);
  els.connDot.classList.toggle('down', !live);
  els.connText.textContent = live ? 'API LIVE' : 'API OFFLINE';
}

async function api(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  setConn(true);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function getStockStatus(p) {
  if (p.current_stock <= p.reorder_point * 0.5) return 'critical';
  if (p.current_stock <= p.reorder_point) return 'low';
  return 'healthy';
}

/* =========================================================
   Tab routing
========================================================= */
const TABS = ['overview', 'pos', 'inventory', 'roster', 'clickcollect'];
const loaders = {
  overview: loadOverview,
  pos: loadPOS,
  inventory: loadInventory,
  roster: loadRoster,
  clickcollect: loadClickCollect,
};

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${tab}`));
  loaders[tab]();
}

/* =========================================================
   OVERVIEW
========================================================= */
async function loadOverview() {
  try {
    const ov = await api('/overview');
    document.getElementById('ovRevenue').textContent = money(ov.sales.revenue_today);
    document.getElementById('ovTx').textContent = ov.sales.transactions_today;
    document.getElementById('ovStaff').textContent = ov.staff_on_shift;
    document.getElementById('ovCritical').textContent = ov.inventory.critical_count;
    document.getElementById('ovLow').textContent = ov.inventory.low_count;
    document.getElementById('ovCC').textContent = ov.click_collect_pending;

    const onShiftEl = document.getElementById('ovOnShift');
    onShiftEl.innerHTML = ov.staff_on_shift_list.length
      ? ov.staff_on_shift_list
          .map(
            (s) => `
        <div class="simple-row">
          <span class="simple-row-name">${s.name}</span>
          <span class="simple-row-sub">${s.role} · ${s.start_time}–${s.end_time}</span>
        </div>`
          )
          .join('')
      : `<div class="empty-note">Nobody currently on shift.</div>`;

    const glanceEl = document.getElementById('ovGlance');
    glanceEl.innerHTML = `
      <div class="simple-row"><span class="simple-row-name">Items sold</span><span class="simple-row-sub">${ov.sales.items_sold_today}</span></div>
      <div class="simple-row"><span class="simple-row-name">SKUs tracked</span><span class="simple-row-sub">${ov.inventory.total_skus}</span></div>
      <div class="simple-row"><span class="simple-row-name">Pending purchase orders</span><span class="simple-row-sub">${ov.inventory.pending_orders} (${money(ov.inventory.pending_order_value)})</span></div>
      <div class="simple-row"><span class="simple-row-name">Click &amp; Collect open orders</span><span class="simple-row-sub">${ov.click_collect_pending}</span></div>
    `;
  } catch (err) {
    setConn(false);
    console.error(err);
  }
}

/* =========================================================
   POS
========================================================= */
let basket = []; // [{ product, qty }]
let posProducts = [];

async function loadPOS() {
  try {
    const [products, staff, sales] = await Promise.all([api('/products'), api('/staff'), api('/pos/sales')]);
    posProducts = products;
    renderPosGrid();
    renderCashierOptions(staff);
    renderRecentSales(sales);
  } catch (err) {
    setConn(false);
    console.error(err);
  }
}

function renderPosGrid() {
  const grid = document.getElementById('posGrid');
  grid.innerHTML = posProducts
    .map(
      (p) => `
    <button class="pos-tile" data-add-product="${p.id}" ${p.current_stock <= 0 ? 'disabled' : ''}>
      <div class="pos-tile-name">${p.name}</div>
      <div class="pos-tile-price">${money(p.sell_price)}</div>
      <div class="pos-tile-stock">${p.current_stock} in stock · ${p.sku}</div>
    </button>`
    )
    .join('');
  grid.querySelectorAll('[data-add-product]').forEach((btn) => {
    btn.addEventListener('click', () => addToBasket(Number(btn.dataset.addProduct)));
  });
}

function renderCashierOptions(staff) {
  const select = document.getElementById('cashierSelect');
  if (select.dataset.filled) return;
  select.innerHTML =
    `<option value="">Select cashier…</option>` +
    staff.map((s) => `<option value="${s.name}">${s.name} — ${s.role}</option>`).join('');
  select.dataset.filled = '1';
}

function addToBasket(productId) {
  const product = posProducts.find((p) => p.id === productId);
  if (!product) return;
  const existing = basket.find((b) => b.product.id === productId);
  const currentQty = existing ? existing.qty : 0;
  if (currentQty + 1 > product.current_stock) {
    showToast(`Only ${product.current_stock} of ${product.name} in stock.`);
    return;
  }
  if (existing) existing.qty += 1;
  else basket.push({ product, qty: 1 });
  renderBasket();
}

function changeQty(productId, delta) {
  const item = basket.find((b) => b.product.id === productId);
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty <= 0) {
    basket = basket.filter((b) => b.product.id !== productId);
  } else if (newQty > item.product.current_stock) {
    showToast(`Only ${item.product.current_stock} of ${item.product.name} in stock.`);
    return;
  } else {
    item.qty = newQty;
  }
  renderBasket();
}

function renderBasket() {
  const list = document.getElementById('basketList');
  if (basket.length === 0) {
    list.innerHTML = `<div class="empty-note">Basket is empty. Tap a product to add it.</div>`;
  } else {
    list.innerHTML = basket
      .map(
        (b) => `
      <div class="basket-row">
        <span class="basket-row-name">${b.product.name}</span>
        <span class="basket-row-qty">
          <button class="qty-btn" data-qty-minus="${b.product.id}">−</button>
          <span>${b.qty}</span>
          <button class="qty-btn" data-qty-plus="${b.product.id}">+</button>
          <span style="width:60px;text-align:right;display:inline-block;">${money(b.product.sell_price * b.qty)}</span>
        </span>
      </div>`
      )
      .join('');
    list.querySelectorAll('[data-qty-plus]').forEach((btn) =>
      btn.addEventListener('click', () => changeQty(Number(btn.dataset.qtyPlus), 1))
    );
    list.querySelectorAll('[data-qty-minus]').forEach((btn) =>
      btn.addEventListener('click', () => changeQty(Number(btn.dataset.qtyMinus), -1))
    );
  }
  const total = basket.reduce((sum, b) => sum + b.product.sell_price * b.qty, 0);
  document.getElementById('basketTotal').textContent = money(total);
}

function renderRecentSales(sales) {
  const el = document.getElementById('recentSales');
  if (sales.length === 0) {
    el.innerHTML = `<div class="empty-note">No sales yet.</div>`;
    return;
  }
  const byTx = {};
  sales.forEach((s) => {
    if (!byTx[s.transaction_id]) byTx[s.transaction_id] = { id: s.transaction_id, lines: [], timestamp: s.timestamp, cashier: s.cashier };
    byTx[s.transaction_id].lines.push(s);
  });
  const txs = Object.values(byTx).sort((a, b) => b.id - a.id).slice(0, 8);
  el.innerHTML = txs
    .map((tx) => {
      const total = tx.lines.reduce((sum, l) => sum + l.line_total, 0);
      const itemCount = tx.lines.reduce((sum, l) => sum + l.qty, 0);
      return `
      <div class="order-row">
        <div class="order-row-left">
          <span class="order-row-name">TX-${String(tx.id).padStart(4, '0')} · ${money(total)}</span>
          <span class="order-row-sub">${itemCount} items · ${tx.cashier} · ${new Date(tx.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>`;
    })
    .join('');
}

document.getElementById('clearBasketBtn').addEventListener('click', () => {
  basket = [];
  renderBasket();
});

document.getElementById('ringUpBtn').addEventListener('click', async () => {
  if (basket.length === 0) return showToast('Basket is empty.');
  const cashier = document.getElementById('cashierSelect').value;
  if (!cashier) return showToast('Select a cashier first.');
  const payment_method = document.getElementById('paymentSelect').value;
  try {
    const result = await api('/pos/sale', {
      method: 'POST',
      body: JSON.stringify({
        items: basket.map((b) => ({ product_id: b.product.id, qty: b.qty })),
        payment_method,
        cashier,
      }),
    });
    showToast(`Sale complete: ${money(result.total)}`);
    basket = [];
    renderBasket();
    loadPOS();
  } catch (err) {
    showToast(err.message);
  }
});

/* =========================================================
   INVENTORY (replenishment)
========================================================= */
async function loadInventory() {
  try {
    const [stats, products, suggestions, orders] = await Promise.all([
      api('/replenishment').then(async (s) => s), // placeholder to keep pattern consistent
      api('/products'),
      api('/replenishment'),
      api('/orders'),
    ]);
    const overviewStats = await api('/overview');
    renderInvStats(overviewStats.inventory);
    renderProducts(products);
    renderQueue(suggestions);
    renderOrders(orders);
  } catch (err) {
    setConn(false);
    console.error(err);
  }
}

function renderInvStats(stats) {
  document.getElementById('statTotal').textContent = stats.total_skus;
  document.getElementById('statHealthy').textContent = stats.healthy_count;
  document.getElementById('statLow').textContent = stats.low_count;
  document.getElementById('statCritical').textContent = stats.critical_count;
  document.getElementById('statPending').textContent = stats.pending_orders;
  document.getElementById('statPendingValue').textContent = money(stats.pending_order_value);
}

function renderProducts(products) {
  const el = document.getElementById('productRows');
  if (products.length === 0) {
    el.innerHTML = `<tr><td colspan="7" class="loading-row">No SKUs registered.</td></tr>`;
    return;
  }
  el.innerHTML = products
    .map((p) => {
      const status = getStockStatus(p);
      const fillPct = Math.min((p.current_stock / p.max_stock) * 100, 100);
      const ropPct = Math.min((p.reorder_point / p.max_stock) * 100, 100);
      return `
        <tr>
          <td class="sku-cell">${p.sku}</td>
          <td class="name-cell">${p.name}<div class="supplier-cell">${p.category || ''}</div></td>
          <td class="supplier-cell">${p.supplier}</td>
          <td class="gauge-cell">
            <div class="gauge">
              <div class="gauge-fill ${status}" style="width:${fillPct}%"></div>
              <div class="gauge-tick" style="left:${ropPct}%" title="Reorder point"></div>
            </div>
          </td>
          <td class="num">${p.current_stock}</td>
          <td class="num">${p.reorder_point}</td>
          <td><span class="status-pill ${status}">${{ healthy: 'Healthy', low: 'Low Stock', critical: 'Critical' }[status]}</span></td>
        </tr>`;
    })
    .join('');
}

function renderQueue(suggestions) {
  const el = document.getElementById('queueList');
  if (suggestions.length === 0) {
    el.innerHTML = `<div class="empty-note">All SKUs above reorder point. Nothing queued.</div>`;
    return;
  }
  el.innerHTML = suggestions
    .map(
      (s) => `
      <div class="queue-card ${s.status}">
        <div class="queue-card-top">
          <span class="queue-name">${s.name}</span>
          <span class="queue-sku">${s.sku}</span>
        </div>
        <div class="queue-meta">
          <span>Stock <b>${s.current_stock}</b>/${s.reorder_point}</span>
          <span>Order <b>${s.suggested_qty}</b> u.</span>
          <span>Est. <b>${money(s.estimated_cost)}</b></span>
          <span>Lead <b>${s.lead_time_days}</b>d</span>
        </div>
        <button class="btn btn-primary btn-sm" data-order-product="${s.product_id}" ${s.has_pending_order ? 'disabled' : ''}>
          ${s.has_pending_order ? 'ORDER PENDING' : 'PLACE ORDER'}
        </button>
      </div>`
    )
    .join('');
  el.querySelectorAll('[data-order-product]').forEach((btn) => {
    btn.addEventListener('click', () => placeReplenishmentOrder(btn.dataset.orderProduct));
  });
}

function renderOrders(orders) {
  const el = document.getElementById('orderList');
  if (orders.length === 0) {
    el.innerHTML = `<div class="empty-note">No orders logged yet.</div>`;
    return;
  }
  const sorted = [...orders].sort((a, b) => b.order_id - a.order_id);
  el.innerHTML = sorted
    .map(
      (o) => `
      <div class="order-row">
        <div class="order-row-left">
          <span class="order-row-name">${o.name}</span>
          <span class="order-row-sub">PO-${String(o.order_id).padStart(4, '0')} · ${o.qty_ordered}u · ${money(o.total_cost)} · ETA ${o.expected_arrival}</span>
        </div>
        ${o.status === 'pending' ? `<button class="btn btn-receive btn-sm" data-receive-order="${o.order_id}">RECEIVE</button>` : `<span class="badge received">Received</span>`}
      </div>`
    )
    .join('');
  el.querySelectorAll('[data-receive-order]').forEach((btn) => {
    btn.addEventListener('click', () => receiveOrder(btn.dataset.receiveOrder));
  });
}

async function placeReplenishmentOrder(productId) {
  try {
    await api(`/replenishment/${productId}/order`, { method: 'POST' });
    showToast('Purchase order placed.');
    loadInventory();
  } catch (err) {
    showToast(err.message);
  }
}

async function receiveOrder(orderId) {
  try {
    await api(`/orders/${orderId}/receive`, { method: 'POST' });
    showToast('Stock received and bin updated.');
    loadInventory();
  } catch (err) {
    showToast(err.message);
  }
}

const modalBackdrop = document.getElementById('modalBackdrop');
const addProductForm = document.getElementById('addProductForm');
document.getElementById('addProductBtn').addEventListener('click', () => modalBackdrop.classList.add('open'));

addProductForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(addProductForm).entries());
  try {
    await api('/products', { method: 'POST', body: JSON.stringify(data) });
    showToast(`${data.name} registered.`);
    closeModal(modalBackdrop, addProductForm);
    loadInventory();
    loadPOS();
  } catch (err) {
    showToast(err.message);
  }
});

/* =========================================================
   ROSTER
========================================================= */
let rosterStaffCache = [];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function loadRoster() {
  const datePicker = document.getElementById('rosterDatePicker');
  if (!datePicker.value) datePicker.value = todayISO();
  try {
    const [shifts, staff] = await Promise.all([api(`/roster?date=${datePicker.value}`), api('/staff')]);
    rosterStaffCache = staff;
    renderRosterRows(shifts);
    renderStaffRows(staff);
    fillShiftStaffSelect(staff);
    document.getElementById('rosterDateLabel').textContent =
      datePicker.value === todayISO() ? '// today' : `// ${datePicker.value}`;
  } catch (err) {
    setConn(false);
    console.error(err);
  }
}

function renderRosterRows(shifts) {
  const el = document.getElementById('rosterRows');
  if (shifts.length === 0) {
    el.innerHTML = `<tr><td colspan="6" class="loading-row">No shifts scheduled for this date.</td></tr>`;
    return;
  }
  el.innerHTML = shifts
    .map(
      (s) => `
      <tr>
        <td class="name-cell">${s.name}</td>
        <td class="supplier-cell">${s.role}</td>
        <td class="num">${s.start_time}</td>
        <td class="num">${s.end_time}</td>
        <td><span class="status-tag ${s.status}">${s.status.replace('_', ' ')}</span></td>
        <td>
          ${
            s.status === 'scheduled'
              ? `<button class="btn btn-ghost btn-sm" data-checkin="${s.shift_id}">CHECK IN</button>`
              : s.status === 'checked_in'
              ? `<button class="btn btn-receive btn-sm" data-checkout="${s.shift_id}">CHECK OUT</button>`
              : ''
          }
        </td>
      </tr>`
    )
    .join('');
  el.querySelectorAll('[data-checkin]').forEach((btn) =>
    btn.addEventListener('click', () => setShiftStatus(btn.dataset.checkin, 'checkin'))
  );
  el.querySelectorAll('[data-checkout]').forEach((btn) =>
    btn.addEventListener('click', () => setShiftStatus(btn.dataset.checkout, 'checkout'))
  );
}

async function setShiftStatus(shiftId, action) {
  try {
    await api(`/roster/${shiftId}/${action}`, { method: 'POST' });
    showToast(action === 'checkin' ? 'Checked in.' : 'Checked out.');
    loadRoster();
  } catch (err) {
    showToast(err.message);
  }
}

function renderStaffRows(staff) {
  const el = document.getElementById('staffRows');
  el.innerHTML = staff
    .map(
      (s) => `
      <tr>
        <td class="name-cell">${s.name}</td>
        <td class="supplier-cell">${s.role}</td>
        <td class="num">${money(s.hourly_rate)}</td>
        <td class="supplier-cell">${s.phone || '—'}</td>
      </tr>`
    )
    .join('');
}

function fillShiftStaffSelect(staff) {
  const select = document.getElementById('shiftStaffSelect');
  select.innerHTML = staff.map((s) => `<option value="${s.id}">${s.name} — ${s.role}</option>`).join('');
}

document.getElementById('rosterDatePicker').addEventListener('change', loadRoster);

const shiftModalBackdrop = document.getElementById('shiftModalBackdrop');
const addShiftForm = document.getElementById('addShiftForm');
document.getElementById('addShiftBtn').addEventListener('click', () => shiftModalBackdrop.classList.add('open'));

addShiftForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(addShiftForm).entries());
  try {
    await api('/roster', { method: 'POST', body: JSON.stringify(data) });
    showToast('Shift scheduled.');
    closeModal(shiftModalBackdrop, addShiftForm);
    loadRoster();
  } catch (err) {
    showToast(err.message);
  }
});

/* =========================================================
   CLICK & COLLECT
========================================================= */
let ccProductsCache = [];

async function loadClickCollect() {
  try {
    const [orders, products] = await Promise.all([api('/click-collect'), api('/products')]);
    ccProductsCache = products;
    renderCCBoard(orders);
  } catch (err) {
    setConn(false);
    console.error(err);
  }
}

const CC_STATUSES = ['pending', 'picking', 'ready', 'collected'];

function renderCCBoard(orders) {
  CC_STATUSES.forEach((status) => {
    const col = document.getElementById(`ccCol-${status}`);
    const matching = orders.filter((o) => o.status === status);
    col.innerHTML = matching.length
      ? matching
          .map((o) => {
            const nextStatus = CC_STATUSES[CC_STATUSES.indexOf(status) + 1];
            return `
        <div class="cc-card">
          <div class="cc-card-name">${o.customer_name}</div>
          <div class="cc-card-meta">Order #${o.order_id} · Req ${o.requested_time || '—'}</div>
          <div class="cc-card-items">${o.items.map((i) => `${i.qty}× ${i.name}`).join('<br>')}</div>
          ${nextStatus ? `<button class="btn btn-primary btn-sm" data-cc-advance="${o.order_id}" data-next="${nextStatus}">MARK ${nextStatus.toUpperCase()}</button>` : `<span class="badge received">Done</span>`}
        </div>`;
          })
          .join('')
      : `<div class="empty-note">Empty.</div>`;
  });
  document.querySelectorAll('[data-cc-advance]').forEach((btn) => {
    btn.addEventListener('click', () => advanceCC(btn.dataset.ccAdvance, btn.dataset.next));
  });
}

async function advanceCC(orderId, nextStatus) {
  try {
    await api(`/click-collect/${orderId}/status`, { method: 'POST', body: JSON.stringify({ status: nextStatus }) });
    showToast(`Order moved to ${nextStatus}.`);
    loadClickCollect();
  } catch (err) {
    showToast(err.message);
  }
}

const ccModalBackdrop = document.getElementById('ccModalBackdrop');
const addCCOrderForm = document.getElementById('addCCOrderForm');
const ccItemsEditor = document.getElementById('ccItemsEditor');

document.getElementById('addCCOrderBtn').addEventListener('click', () => {
  ccItemsEditor.innerHTML = '';
  addCCItemRow();
  ccModalBackdrop.classList.add('open');
});

function addCCItemRow() {
  const row = document.createElement('div');
  row.className = 'cc-item-row';
  row.innerHTML = `
    <select name="product">${ccProductsCache.map((p) => `<option value="${p.id}">${p.name} (${p.sku})</option>`).join('')}</select>
    <input type="number" name="qty" min="1" value="1">
  `;
  ccItemsEditor.appendChild(row);
}
document.getElementById('addCCItemRow').addEventListener('click', addCCItemRow);

addCCOrderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(addCCOrderForm);
  const items = [];
  ccItemsEditor.querySelectorAll('.cc-item-row').forEach((row) => {
    const product_id = Number(row.querySelector('select[name="product"]').value);
    const qty = Number(row.querySelector('input[name="qty"]').value) || 1;
    items.push({ product_id, qty });
  });
  try {
    await api('/click-collect', {
      method: 'POST',
      body: JSON.stringify({
        customer_name: formData.get('customer_name'),
        customer_phone: formData.get('customer_phone'),
        requested_time: formData.get('requested_time'),
        items,
      }),
    });
    showToast('Click & collect order created.');
    closeModal(ccModalBackdrop, addCCOrderForm);
    loadClickCollect();
  } catch (err) {
    showToast(err.message);
  }
});

/* =========================================================
   Shared modal helpers
========================================================= */
function closeModal(backdrop, form) {
  backdrop.classList.remove('open');
  form.reset();
}

document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => btn.closest('.modal-backdrop').classList.remove('open'));
});
document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  });
});

/* =========================================================
   Boot
========================================================= */
loadOverview();
setInterval(() => {
  const activeTab = document.querySelector('.tab.active').dataset.tab;
  loaders[activeTab]();
}, 15000);
