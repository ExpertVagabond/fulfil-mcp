/**
 * Purchasing tools — purchase orders, supplier management
 */

import { getClient, type Domain } from "../api.js";

// ---------------------------------------------------------------------------
// 19. list_purchase_orders
// ---------------------------------------------------------------------------

export interface ListPurchaseOrdersArgs {
  status?: string;
  supplier_name?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export async function listPurchaseOrders(
  args: ListPurchaseOrdersArgs,
): Promise<string> {
  const client = getClient();
  const domain: Domain = [];

  if (args.status) {
    domain.push(["state", "=", args.status]);
  }
  if (args.supplier_name) {
    domain.push(["party.rec_name", "ilike", `%${args.supplier_name}%`]);
  }
  if (args.date_from) {
    domain.push(["purchase_date", ">=", args.date_from]);
  }
  if (args.date_to) {
    domain.push(["purchase_date", "<=", args.date_to]);
  }

  const fields = [
    "id",
    "number",
    "reference",
    "party.rec_name",
    "purchase_date",
    "state",
    "total_amount",
    "currency",
    "shipment_state",
    "invoice_state",
    "delivery_date",
  ];

  const orders = await client.searchRead("purchase.purchase", {
    domain,
    fields,
    limit: args.limit ?? 25,
    offset: args.offset ?? 0,
    order: [["purchase_date", "DESC"]],
  });

  if (!orders.length) {
    return "No purchase orders found matching the given criteria.";
  }

  const lines = (orders as Record<string, unknown>[]).map((o) =>
    [
      `PO #${o.number ?? o.id}`,
      `Ref: ${o.reference ?? "N/A"}`,
      `Supplier: ${o["party.rec_name"] ?? "N/A"}`,
      `Date: ${o.purchase_date}`,
      `State: ${o.state}`,
      `Total: ${o.total_amount} ${o.currency ?? ""}`,
      `Shipment: ${o.shipment_state ?? "N/A"}`,
      `Invoice: ${o.invoice_state ?? "N/A"}`,
      `Expected Delivery: ${o.delivery_date ?? "N/A"}`,
    ].join(" | "),
  );

  return `Found ${orders.length} purchase order(s):\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// 20. get_purchase_order
// ---------------------------------------------------------------------------

export interface GetPurchaseOrderArgs {
  purchase_order_id: number;
}

export async function getPurchaseOrder(
  args: GetPurchaseOrderArgs,
): Promise<string> {
  const client = getClient();

  const fields = [
    "id",
    "number",
    "reference",
    "party.rec_name",
    "party.email",
    "purchase_date",
    "state",
    "total_amount",
    "untaxed_amount",
    "tax_amount",
    "currency",
    "shipment_state",
    "invoice_state",
    "delivery_date",
    "comment",
    "warehouse",
    "warehouse.rec_name",
    "lines",
  ];

  const order = await client.read<Record<string, unknown>>(
    "purchase.purchase",
    args.purchase_order_id,
    fields,
  );

  const lines = [
    `PO #${order.number ?? order.id}`,
    `Reference: ${order.reference ?? "N/A"}`,
    `Supplier: ${order["party.rec_name"] ?? "N/A"}`,
    `Supplier Email: ${order["party.email"] ?? "N/A"}`,
    `Date: ${order.purchase_date}`,
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
    ``,
    `Expected Delivery: ${order.delivery_date ?? "N/A"}`,
    `Warehouse: ${order["warehouse.rec_name"] ?? "N/A"}`,
    `Comment: ${order.comment ?? "N/A"}`,
  ];

  // Fetch PO lines if available
  const lineIds = order.lines;
  if (Array.isArray(lineIds) && lineIds.length > 0) {
    try {
      const poLines = await client.readMany<Record<string, unknown>>(
        "purchase.line",
        lineIds as number[],
        [
          "product.rec_name",
          "product.code",
          "quantity",
          "unit_price",
          "amount",
          "description",
          "delivery_date",
        ],
      );

      lines.push("", `PO Lines (${poLines.length}):`);
      for (const pl of poLines) {
        lines.push(
          `  - ${pl["product.rec_name"] ?? pl.description ?? "N/A"} (SKU: ${pl["product.code"] ?? "N/A"}) | Qty: ${pl.quantity} | Unit: ${pl.unit_price} | Total: ${pl.amount} | Delivery: ${pl.delivery_date ?? "N/A"}`,
        );
      }
    } catch {
      lines.push("", "(Could not fetch purchase order line details)");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 21. overdue_purchase_orders
// ---------------------------------------------------------------------------

export interface OverduePurchaseOrdersArgs {
  limit?: number;
}

export async function overduePurchaseOrders(
  args: OverduePurchaseOrdersArgs,
): Promise<string> {
  const client = getClient();
  const today = new Date().toISOString().split("T")[0];

  const orders = await client.searchRead<Record<string, unknown>>(
    "purchase.purchase",
    {
      domain: [
        ["delivery_date", "<", today],
        ["shipment_state", "in", ["none", "waiting"]],
        ["state", "in", ["confirmed", "processing"]],
      ],
      fields: [
        "id",
        "number",
        "party.rec_name",
        "purchase_date",
        "delivery_date",
        "state",
        "shipment_state",
        "total_amount",
        "currency",
      ],
      limit: args.limit ?? 50,
      order: [["delivery_date", "ASC"]],
    },
  );

  if (!orders.length) {
    return "No overdue purchase orders found.";
  }

  const lines = orders.map((o) => {
    const deliveryDate = new Date(o.delivery_date as string);
    const daysLate = Math.floor(
      (Date.now() - deliveryDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    return `PO #${o.number ?? o.id} | Supplier: ${o["party.rec_name"] ?? "N/A"} | Ordered: ${o.purchase_date} | Expected: ${o.delivery_date} (${daysLate}d overdue) | State: ${o.state} | Shipment: ${o.shipment_state} | Total: ${o.total_amount} ${o.currency ?? ""}`;
  });

  return `${orders.length} overdue purchase order(s):\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// 22. create_purchase_order_draft
// ---------------------------------------------------------------------------

export interface CreatePurchaseOrderDraftArgs {
  supplier_id: number;
  products: Array<{
    product_id: number;
    quantity: number;
    unit_price?: number;
  }>;
  delivery_date?: string;
  warehouse_id?: number;
  comment?: string;
}

export async function createPurchaseOrderDraft(
  args: CreatePurchaseOrderDraftArgs,
): Promise<string> {
  const client = getClient();

  // Verify supplier exists
  const supplier = await client.read<Record<string, unknown>>(
    "party.party",
    args.supplier_id,
    ["rec_name", "email"],
  );

  // Get product details for each requested product
  const productDetails: Array<{
    id: number;
    name: string;
    code: string;
    cost: number;
    quantity: number;
    unitPrice: number;
  }> = [];

  for (const item of args.products) {
    const product = await client.read<Record<string, unknown>>(
      "product.product",
      item.product_id,
      ["rec_name", "code", "cost_price"],
    );

    productDetails.push({
      id: item.product_id,
      name: String(product.rec_name ?? "Unknown"),
      code: String(product.code ?? "N/A"),
      cost: parseFloat(String(product.cost_price) || "0"),
      quantity: item.quantity,
      unitPrice: item.unit_price ?? parseFloat(String(product.cost_price) || "0"),
    });
  }

  // Build the summary (this is a draft summary — actual creation
  // would go through the Fulfil API's create endpoint)
  const totalAmount = productDetails.reduce(
    (sum, p) => sum + p.unitPrice * p.quantity,
    0,
  );

  const lines = [
    `DRAFT PURCHASE ORDER`,
    `${"=".repeat(50)}`,
    `Supplier: ${supplier.rec_name} (ID: ${args.supplier_id})`,
    `Supplier Email: ${supplier.email ?? "N/A"}`,
    `Expected Delivery: ${args.delivery_date ?? "Not specified"}`,
    args.warehouse_id ? `Warehouse ID: ${args.warehouse_id}` : null,
    args.comment ? `Comment: ${args.comment}` : null,
    ``,
    `Line Items (${productDetails.length}):`,
  ].filter((l) => l !== null) as string[];

  for (const p of productDetails) {
    lines.push(
      `  - ${p.name} (SKU: ${p.code}, ID: ${p.id}) | Qty: ${p.quantity} | Unit Price: ${p.unitPrice.toFixed(2)} | Line Total: ${(p.unitPrice * p.quantity).toFixed(2)}`,
    );
  }

  lines.push(``, `Estimated Total: ${totalAmount.toFixed(2)}`);
  lines.push(
    ``,
    `NOTE: This is a draft preview. The purchase order has been validated but creating POs via API requires write permissions on the purchase.purchase model. Confirm with your Fulfil admin that API write access is enabled.`,
  );

  return lines.join("\n");
}
