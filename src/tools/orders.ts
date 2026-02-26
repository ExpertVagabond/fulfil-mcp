/**
 * Order tools — sales orders, statuses, delayed order detection
 */

import { getClient, type Domain } from "../api.js";

// ---------------------------------------------------------------------------
// 6. list_orders
// ---------------------------------------------------------------------------

export interface ListOrdersArgs {
  status?: string;
  customer_name?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export async function listOrders(args: ListOrdersArgs): Promise<string> {
  const client = getClient();
  const domain: Domain = [];

  if (args.status) {
    domain.push(["state", "=", args.status]);
  }
  if (args.customer_name) {
    domain.push(["party.rec_name", "ilike", `%${args.customer_name}%`]);
  }
  if (args.date_from) {
    domain.push(["sale_date", ">=", args.date_from]);
  }
  if (args.date_to) {
    domain.push(["sale_date", "<=", args.date_to]);
  }

  const fields = [
    "id",
    "number",
    "reference",
    "party.rec_name",
    "sale_date",
    "state",
    "total_amount",
    "currency",
    "shipment_state",
    "invoice_state",
  ];

  const orders = await client.searchRead("sale.sale", {
    domain,
    fields,
    limit: args.limit ?? 25,
    offset: args.offset ?? 0,
    order: [["sale_date", "DESC"]],
  });

  if (!orders.length) {
    return "No orders found matching the given criteria.";
  }

  const lines = (orders as Record<string, unknown>[]).map((o) =>
    [
      `Order #${o.number ?? o.id}`,
      `Ref: ${o.reference ?? "N/A"}`,
      `Customer: ${o["party.rec_name"] ?? "N/A"}`,
      `Date: ${o.sale_date}`,
      `State: ${o.state}`,
      `Total: ${o.total_amount} ${o.currency ?? ""}`,
      `Shipment: ${o.shipment_state ?? "N/A"}`,
      `Invoice: ${o.invoice_state ?? "N/A"}`,
    ].join(" | "),
  );

  return `Found ${orders.length} order(s):\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// 7. get_order
// ---------------------------------------------------------------------------

export interface GetOrderArgs {
  order_id: number;
}

export async function getOrder(args: GetOrderArgs): Promise<string> {
  const client = getClient();

  const fields = [
    "id",
    "number",
    "reference",
    "party.rec_name",
    "party.email",
    "sale_date",
    "state",
    "total_amount",
    "untaxed_amount",
    "tax_amount",
    "currency",
    "shipment_state",
    "invoice_state",
    "payment_state",
    "comment",
    "shipping_address",
    "shipping_address.rec_name",
    "warehouse",
    "warehouse.rec_name",
    "lines",
  ];

  const order = await client.read<Record<string, unknown>>(
    "sale.sale",
    args.order_id,
    fields,
  );

  const lines = [
    `Order #${order.number ?? order.id}`,
    `Reference: ${order.reference ?? "N/A"}`,
    `Customer: ${order["party.rec_name"] ?? "N/A"}`,
    `Customer Email: ${order["party.email"] ?? "N/A"}`,
    `Date: ${order.sale_date}`,
    `State: ${order.state}`,
    ``,
    `Amounts:`,
    `  Untaxed: ${order.untaxed_amount ?? "N/A"}`,
    `  Tax: ${order.tax_amount ?? "N/A"}`,
    `  Total: ${order.total_amount} ${order.currency ?? ""}`,
    ``,
    `Fulfillment:`,
    `  Shipment State: ${order.shipment_state ?? "N/A"}`,
    `  Invoice State: ${order.invoice_state ?? "N/A"}`,
    `  Payment State: ${order.payment_state ?? "N/A"}`,
    ``,
    `Shipping Address: ${order["shipping_address.rec_name"] ?? "N/A"}`,
    `Warehouse: ${order["warehouse.rec_name"] ?? "N/A"}`,
    `Comment: ${order.comment ?? "N/A"}`,
  ];

  // Fetch order lines if available
  const lineIds = order.lines;
  if (Array.isArray(lineIds) && lineIds.length > 0) {
    try {
      const orderLines = await client.readMany<Record<string, unknown>>(
        "sale.line",
        lineIds as number[],
        [
          "product.rec_name",
          "product.code",
          "quantity",
          "unit_price",
          "amount",
          "description",
        ],
      );

      lines.push("", `Order Lines (${orderLines.length}):`);
      for (const ol of orderLines) {
        lines.push(
          `  - ${ol["product.rec_name"] ?? ol.description ?? "N/A"} (SKU: ${ol["product.code"] ?? "N/A"}) | Qty: ${ol.quantity} | Unit: ${ol.unit_price} | Total: ${ol.amount}`,
        );
      }
    } catch {
      lines.push("", "(Could not fetch order line details)");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 8. order_status
// ---------------------------------------------------------------------------

export interface OrderStatusArgs {
  order_id: number;
}

export async function orderStatus(args: OrderStatusArgs): Promise<string> {
  const client = getClient();

  const order = await client.read<Record<string, unknown>>(
    "sale.sale",
    args.order_id,
    [
      "number",
      "state",
      "shipment_state",
      "invoice_state",
      "payment_state",
      "shipments",
    ],
  );

  const lines = [
    `Order #${order.number ?? args.order_id}`,
    `Order State: ${order.state}`,
    `Shipment State: ${order.shipment_state ?? "N/A"}`,
    `Invoice State: ${order.invoice_state ?? "N/A"}`,
    `Payment State: ${order.payment_state ?? "N/A"}`,
  ];

  // Try to get associated shipments
  const shipmentIds = order.shipments;
  if (Array.isArray(shipmentIds) && shipmentIds.length > 0) {
    try {
      const shipments = await client.readMany<Record<string, unknown>>(
        "stock.shipment.out",
        shipmentIds as number[],
        [
          "id",
          "number",
          "state",
          "planned_date",
          "effective_date",
          "carrier",
          "carrier.rec_name",
          "tracking_number",
        ],
      );

      lines.push("", `Shipments (${shipments.length}):`);
      for (const s of shipments) {
        lines.push(
          [
            `  Shipment #${s.number ?? s.id}`,
            `State: ${s.state}`,
            `Planned: ${s.planned_date ?? "N/A"}`,
            `Shipped: ${s.effective_date ?? "N/A"}`,
            `Carrier: ${s["carrier.rec_name"] ?? "N/A"}`,
            `Tracking: ${s.tracking_number ?? "N/A"}`,
          ].join(" | "),
        );
      }
    } catch {
      lines.push("", "(Could not fetch shipment details)");
    }
  } else {
    lines.push("", "No shipments associated with this order.");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 9. delayed_orders
// ---------------------------------------------------------------------------

export interface DelayedOrdersArgs {
  days: number;
  limit?: number;
}

export async function delayedOrders(args: DelayedOrdersArgs): Promise<string> {
  const client = getClient();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - args.days);
  const cutoff = cutoffDate.toISOString().split("T")[0];

  const orders = await client.searchRead<Record<string, unknown>>(
    "sale.sale",
    {
      domain: [
        ["sale_date", "<=", cutoff],
        ["shipment_state", "in", ["none", "waiting"]],
        ["state", "in", ["confirmed", "processing"]],
      ],
      fields: [
        "id",
        "number",
        "party.rec_name",
        "sale_date",
        "state",
        "shipment_state",
        "total_amount",
      ],
      limit: args.limit ?? 50,
      order: [["sale_date", "ASC"]],
    },
  );

  if (!orders.length) {
    return `No orders older than ${args.days} days are waiting for shipment.`;
  }

  const lines = orders.map((o) => {
    const orderDate = new Date(o.sale_date as string);
    const ageMs = Date.now() - orderDate.getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    return `Order #${o.number ?? o.id} | Customer: ${o["party.rec_name"] ?? "N/A"} | Date: ${o.sale_date} (${ageDays}d ago) | State: ${o.state} | Shipment: ${o.shipment_state} | Total: ${o.total_amount}`;
  });

  return `${orders.length} order(s) older than ${args.days} days awaiting shipment:\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// 10. recent_orders
// ---------------------------------------------------------------------------

export interface RecentOrdersArgs {
  count?: number;
}

export async function recentOrders(args: RecentOrdersArgs): Promise<string> {
  const client = getClient();
  const count = args.count ?? 10;

  const orders = await client.searchRead<Record<string, unknown>>(
    "sale.sale",
    {
      fields: [
        "id",
        "number",
        "party.rec_name",
        "sale_date",
        "state",
        "total_amount",
        "currency",
        "shipment_state",
      ],
      limit: count,
      order: [["create_date", "DESC"]],
    },
  );

  if (!orders.length) {
    return "No recent orders found.";
  }

  const lines = orders.map(
    (o) =>
      `Order #${o.number ?? o.id} | ${o["party.rec_name"] ?? "N/A"} | ${o.sale_date} | ${o.state} | ${o.total_amount} ${o.currency ?? ""} | Ship: ${o.shipment_state ?? "N/A"}`,
  );

  return `${orders.length} most recent order(s):\n\n${lines.join("\n")}`;
}
