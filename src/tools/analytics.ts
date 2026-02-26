/**
 * Analytics tools — sales summary, top products, inventory valuation
 */

import { getClient } from "../api.js";

// ---------------------------------------------------------------------------
// 15. sales_summary
// ---------------------------------------------------------------------------

export interface SalesSummaryArgs {
  date_from: string;
  date_to: string;
}

export async function salesSummary(args: SalesSummaryArgs): Promise<string> {
  const client = getClient();

  // Fetch all orders in the date range
  const orders = await client.searchRead<Record<string, unknown>>(
    "sale.sale",
    {
      domain: [
        ["sale_date", ">=", args.date_from],
        ["sale_date", "<=", args.date_to],
      ],
      fields: [
        "id",
        "state",
        "total_amount",
        "untaxed_amount",
        "tax_amount",
        "currency",
        "shipment_state",
      ],
      limit: 1000,
    },
  );

  if (!orders.length) {
    return `No orders found between ${args.date_from} and ${args.date_to}.`;
  }

  // Aggregate
  let totalRevenue = 0;
  let totalTax = 0;
  let totalUntaxed = 0;
  const stateCounts: Record<string, number> = {};
  const shipmentCounts: Record<string, number> = {};

  for (const o of orders) {
    const amount = parseFloat(String(o.total_amount) || "0");
    const tax = parseFloat(String(o.tax_amount) || "0");
    const untaxed = parseFloat(String(o.untaxed_amount) || "0");

    totalRevenue += amount;
    totalTax += tax;
    totalUntaxed += untaxed;

    const state = String(o.state ?? "unknown");
    stateCounts[state] = (stateCounts[state] ?? 0) + 1;

    const shipState = String(o.shipment_state ?? "unknown");
    shipmentCounts[shipState] = (shipmentCounts[shipState] ?? 0) + 1;
  }

  const avgOrder = totalRevenue / orders.length;

  const lines = [
    `Sales Summary: ${args.date_from} to ${args.date_to}`,
    `${"=".repeat(50)}`,
    `Total Orders: ${orders.length}`,
    `Total Revenue: ${totalRevenue.toFixed(2)}`,
    `Total Tax: ${totalTax.toFixed(2)}`,
    `Revenue (pre-tax): ${totalUntaxed.toFixed(2)}`,
    `Average Order Value: ${avgOrder.toFixed(2)}`,
    ``,
    `Order States:`,
    ...Object.entries(stateCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([state, count]) => `  ${state}: ${count}`),
    ``,
    `Shipment States:`,
    ...Object.entries(shipmentCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([state, count]) => `  ${state}: ${count}`),
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 16. top_products
// ---------------------------------------------------------------------------

export interface TopProductsArgs {
  date_from: string;
  date_to: string;
  limit?: number;
}

export async function topProducts(args: TopProductsArgs): Promise<string> {
  const client = getClient();

  // Get order lines in the date range via sale.line
  const orderLines = await client.searchRead<Record<string, unknown>>(
    "sale.line",
    {
      domain: [
        ["sale.sale_date", ">=", args.date_from],
        ["sale.sale_date", "<=", args.date_to],
        ["type", "=", "line"],
      ],
      fields: [
        "product",
        "product.rec_name",
        "product.code",
        "quantity",
        "amount",
      ],
      limit: 5000,
    },
  );

  if (!orderLines.length) {
    return `No order lines found between ${args.date_from} and ${args.date_to}.`;
  }

  // Aggregate by product
  const productMap = new Map<
    string,
    { name: string; code: string; totalQty: number; totalRevenue: number }
  >();

  for (const line of orderLines) {
    const productId = String(line.product ?? "unknown");
    const existing = productMap.get(productId);
    const qty = parseFloat(String(line.quantity) || "0");
    const revenue = parseFloat(String(line.amount) || "0");

    if (existing) {
      existing.totalQty += qty;
      existing.totalRevenue += revenue;
    } else {
      productMap.set(productId, {
        name: String(line["product.rec_name"] ?? "Unknown"),
        code: String(line["product.code"] ?? "N/A"),
        totalQty: qty,
        totalRevenue: revenue,
      });
    }
  }

  // Sort by revenue descending
  const sorted = [...productMap.values()]
    .sort((a, b) => b.totalRevenue - a.totalRevenue)
    .slice(0, args.limit ?? 20);

  const lines = [
    `Top ${sorted.length} Products by Revenue: ${args.date_from} to ${args.date_to}`,
    `${"=".repeat(60)}`,
    "",
  ];

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    lines.push(
      `${i + 1}. ${p.name} (SKU: ${p.code}) | Qty Sold: ${p.totalQty} | Revenue: ${p.totalRevenue.toFixed(2)}`,
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 17. inventory_valuation
// ---------------------------------------------------------------------------

export interface InventoryValuationArgs {
  category?: string;
}

export async function inventoryValuation(
  args: InventoryValuationArgs,
): Promise<string> {
  const client = getClient();

  const domain: [string, string, string | number | boolean | null | string[] | number[]][] = [
    ["active", "=", true],
    ["type", "=", "goods"],
  ];

  if (args.category) {
    domain.push(["categories.name", "ilike", `%${args.category}%`]);
  }

  const products = await client.searchRead<Record<string, unknown>>(
    "product.product",
    {
      domain,
      fields: [
        "id",
        "rec_name",
        "code",
        "cost_price",
        "quantity_on_hand",
      ],
      limit: 5000,
    },
  );

  if (!products.length) {
    return "No products found for valuation.";
  }

  let totalValue = 0;
  let totalUnits = 0;
  let valuedCount = 0;
  const valuations: Array<{
    name: string;
    code: string;
    qty: number;
    cost: number;
    value: number;
  }> = [];

  for (const p of products) {
    const qty = parseFloat(String(p.quantity_on_hand) || "0");
    const cost = parseFloat(String(p.cost_price) || "0");
    const value = qty * cost;

    if (qty > 0 && cost > 0) {
      totalValue += value;
      totalUnits += qty;
      valuedCount++;
      valuations.push({
        name: String(p.rec_name),
        code: String(p.code ?? "N/A"),
        qty,
        cost,
        value,
      });
    }
  }

  // Sort by value descending
  valuations.sort((a, b) => b.value - a.value);

  const lines = [
    `Inventory Valuation${args.category ? ` (Category: ${args.category})` : ""}`,
    `${"=".repeat(50)}`,
    `Total Products: ${products.length}`,
    `Products with Stock & Cost: ${valuedCount}`,
    `Total Units on Hand: ${totalUnits.toFixed(0)}`,
    `Total Inventory Value: ${totalValue.toFixed(2)}`,
    ``,
    `Top 20 by Value:`,
  ];

  for (const v of valuations.slice(0, 20)) {
    lines.push(
      `  ${v.name} (${v.code}) | Qty: ${v.qty} | Cost: ${v.cost.toFixed(2)} | Value: ${v.value.toFixed(2)}`,
    );
  }

  if (valuations.length > 20) {
    lines.push(`  ... and ${valuations.length - 20} more products`);
  }

  return lines.join("\n");
}
