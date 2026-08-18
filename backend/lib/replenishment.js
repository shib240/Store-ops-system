'use strict';

/**
 * Classic (s, Q) replenishment policy:
 *  - s = reorder_point: the stock level that triggers a reorder
 *  - Q = reorder_qty:   the fixed quantity ordered each time
 *  - max_stock is used only to render the bin gauge (order-up-to ceiling)
 *
 * Status bands:
 *  - critical: stock has fallen to/under half the reorder point
 *  - low:      stock at/under the reorder point but above the critical band
 *  - healthy:  above the reorder point
 */

function getStatus(product) {
  const { current_stock, reorder_point } = product;
  if (current_stock <= reorder_point * 0.5) return 'critical';
  if (current_stock <= reorder_point) return 'low';
  return 'healthy';
}

function needsReplenishment(product) {
  return product.current_stock <= product.reorder_point;
}

function suggestOrderQty(product) {
  // Order the fixed reorder quantity, but never past the max shelf/bin capacity.
  const roomLeft = Math.max(product.max_stock - product.current_stock, 0);
  return Math.max(Math.min(product.reorder_qty, roomLeft) || product.reorder_qty, 0);
}

function buildSuggestions(products, pendingByProductId) {
  return products
    .filter(needsReplenishment)
    .map((p) => {
      const suggestedQty = suggestOrderQty(p);
      return {
        product_id: p.id,
        sku: p.sku,
        name: p.name,
        supplier: p.supplier,
        status: getStatus(p),
        current_stock: p.current_stock,
        reorder_point: p.reorder_point,
        suggested_qty: suggestedQty,
        estimated_cost: Number((suggestedQty * p.unit_cost).toFixed(2)),
        lead_time_days: p.lead_time_days,
        has_pending_order: Boolean(pendingByProductId[p.id]),
      };
    })
    .sort((a, b) => {
      const rank = { critical: 0, low: 1, healthy: 2 };
      return rank[a.status] - rank[b.status];
    });
}

function buildStats(products, orders) {
  const statuses = products.map(getStatus);
  const pendingOrders = orders.filter((o) => o.status === 'pending');
  return {
    total_skus: products.length,
    healthy_count: statuses.filter((s) => s === 'healthy').length,
    low_count: statuses.filter((s) => s === 'low').length,
    critical_count: statuses.filter((s) => s === 'critical').length,
    pending_orders: pendingOrders.length,
    pending_order_value: Number(
      pendingOrders.reduce((sum, o) => sum + Number(o.total_cost || 0), 0).toFixed(2)
    ),
  };
}

module.exports = { getStatus, needsReplenishment, suggestOrderQty, buildSuggestions, buildStats };
