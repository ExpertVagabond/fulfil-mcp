/**
 * Returns & RMA tools — customer returns, return rate analysis
 */

import { getClient, type Domain } from "../api.js";

// ---------------------------------------------------------------------------
// 23. list_returns
// ---------------------------------------------------------------------------

export interface ListReturnsArgs {
  status?: string;
  date_from?: string;
  date_to?: string;
  reason?: string;
  limit?: number;
  offset?: number;
}

export async function listReturns(args: ListReturnsArgs): Promise<string> {
  const client = getClient();
  const domain: Domain = [];

  if (args.status) {
    domain.push(["state", "=", args.status]);
  }
  if (args.date_from) {
    domain.push(["planned_date", ">=", args.date_from]);
  }
  if (args.date_to) {
    domain.push(["planned_date", "<=", args.date_to]);
  }
  if (args.reason) {
    domain.push(["comment", "ilike", `%${args.reason}%`]);
  }

  const fields = [
    "id",
    "number",
    "state",
    "planned_date",
    "effective_date",
    "customer.rec_name",
    "origin",
    "warehouse.rec_name",
    "comment",
  ];

  const returns = await client.searchRead("stock.shipment.out.return", {
    domain,
    fields,
    limit: args.limit ?? 25,
    offset: args.offset ?? 0,
    order: [["planned_date", "DESC"]],
  });

  if (!returns.length) {
    return "No returns found matching the given criteria.";
  }

  const lines = (returns as Record<string, unknown>[]).map((r) =>
    [
      `Return #${r.number ?? r.id}`,
      `State: ${r.state}`,
      `Customer: ${r["customer.rec_name"] ?? "N/A"}`,
      `Planned: ${r.planned_date ?? "N/A"}`,
      `Received: ${r.effective_date ?? "N/A"}`,
      `Warehouse: ${r["warehouse.rec_name"] ?? "N/A"}`,
      `Reason: ${r.comment ?? "N/A"}`,
    ].join(" | "),
  );

  return `Found ${returns.length} return(s):\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// 24. get_return
// ---------------------------------------------------------------------------

export interface GetReturnArgs {
  return_id: number;
}

export async function getReturn(args: GetReturnArgs): Promise<string> {
  const client = getClient();

  const fields = [
    "id",
    "number",
    "state",
    "planned_date",
    "effective_date",
    "customer.rec_name",
    "customer.email",
    "origin",
    "warehouse.rec_name",
    "comment",
    "moves",
  ];

  const ret = await client.read<Record<string, unknown>>(
    "stock.shipment.out.return",
    args.return_id,
    fields,
  );

  const lines = [
    `Return #${ret.number ?? ret.id}`,
    `State: ${ret.state}`,
    `Customer: ${ret["customer.rec_name"] ?? "N/A"}`,
    `Customer Email: ${ret["customer.email"] ?? "N/A"}`,
    `Planned Date: ${ret.planned_date ?? "N/A"}`,
    `Received Date: ${ret.effective_date ?? "N/A"}`,
    `Origin: ${ret.origin ?? "N/A"}`,
    `Warehouse: ${ret["warehouse.rec_name"] ?? "N/A"}`,
    `Reason/Comment: ${ret.comment ?? "N/A"}`,
  ];

  // Fetch return move lines if available
  const moveIds = ret.moves;
  if (Array.isArray(moveIds) && moveIds.length > 0) {
    try {
      const moves = await client.readMany<Record<string, unknown>>(
        "stock.move",
        moveIds as number[],
        [
          "product.rec_name",
          "product.code",
          "quantity",
          "unit_price",
          "from_location.rec_name",
          "to_location.rec_name",
          "state",
        ],
      );

      lines.push("", `Return Items (${moves.length}):`);
      let totalRefund = 0;
      for (const m of moves) {
        const unitPrice = parseFloat(String(m.unit_price) || "0");
        const qty = parseFloat(String(m.quantity) || "0");
        totalRefund += unitPrice * qty;
        lines.push(
          `  - ${m["product.rec_name"] ?? "N/A"} (SKU: ${m["product.code"] ?? "N/A"}) | Qty: ${m.quantity} | Unit Price: ${m.unit_price ?? "N/A"} | State: ${m.state}`,
        );
      }
      lines.push(``, `Estimated Refund Value: ${totalRefund.toFixed(2)}`);
    } catch {
      lines.push("", "(Could not fetch return item details)");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 25. return_rate_report
// ---------------------------------------------------------------------------

export interface ReturnRateReportArgs {
  date_from: string;
  date_to: string;
  group_by?: string;
}

export async function returnRateReport(
  args: ReturnRateReportArgs,
): Promise<string> {
  const client = getClient();

  // Get total sales in the date range
  const sales = await client.searchRead<Record<string, unknown>>(
    "sale.sale",
    {
      domain: [
        ["sale_date", ">=", args.date_from],
        ["sale_date", "<=", args.date_to],
      ],
      fields: ["id", "total_amount"],
      limit: 5000,
    },
  );

  // Get returns in the date range
  const returns = await client.searchRead<Record<string, unknown>>(
    "stock.shipment.out.return",
    {
      domain: [
        ["planned_date", ">=", args.date_from],
        ["planned_date", "<=", args.date_to],
      ],
      fields: ["id", "moves"],
      limit: 5000,
    },
  );

  const totalOrders = sales.length;
  const totalReturns = returns.length;
  const returnRate = totalOrders > 0 ? (totalReturns / totalOrders) * 100 : 0;

  const totalSalesRevenue = sales.reduce(
    (sum, o) => sum + parseFloat(String(o.total_amount) || "0"),
    0,
  );

  // Try to get return value from move lines
  let totalReturnValue = 0;
  let returnedProducts = new Map<
    string,
    { name: string; code: string; returnCount: number; totalQty: number }
  >();

  for (const ret of returns) {
    const moveIds = ret.moves;
    if (Array.isArray(moveIds) && moveIds.length > 0) {
      try {
        const moves = await client.readMany<Record<string, unknown>>(
          "stock.move",
          moveIds as number[],
          [
            "product",
            "product.rec_name",
            "product.code",
            "quantity",
            "unit_price",
          ],
        );

        for (const m of moves) {
          const unitPrice = parseFloat(String(m.unit_price) || "0");
          const qty = parseFloat(String(m.quantity) || "0");
          totalReturnValue += unitPrice * qty;

          const productId = String(m.product ?? "unknown");
          const existing = returnedProducts.get(productId);
          if (existing) {
            existing.returnCount++;
            existing.totalQty += qty;
          } else {
            returnedProducts.set(productId, {
              name: String(m["product.rec_name"] ?? "Unknown"),
              code: String(m["product.code"] ?? "N/A"),
              returnCount: 1,
              totalQty: qty,
            });
          }
        }
      } catch {
        // Move details not available for this return
      }
    }
  }

  // Sort products by return frequency
  const topReturnedProducts = [...returnedProducts.values()]
    .sort((a, b) => b.totalQty - a.totalQty)
    .slice(0, 15);

  const lines = [
    `Return Rate Report: ${args.date_from} to ${args.date_to}`,
    `${"=".repeat(55)}`,
    `Total Orders: ${totalOrders}`,
    `Total Returns: ${totalReturns}`,
    `Return Rate: ${returnRate.toFixed(2)}%`,
    ``,
    `Total Sales Revenue: ${totalSalesRevenue.toFixed(2)}`,
    `Total Return Value: ${totalReturnValue.toFixed(2)}`,
    totalSalesRevenue > 0
      ? `Return Value Rate: ${((totalReturnValue / totalSalesRevenue) * 100).toFixed(2)}%`
      : "",
  ];

  if (topReturnedProducts.length > 0) {
    lines.push(``, `Most Returned Products:`);
    for (let i = 0; i < topReturnedProducts.length; i++) {
      const p = topReturnedProducts[i];
      lines.push(
        `  ${i + 1}. ${p.name} (SKU: ${p.code}) | ${p.totalQty} units returned across ${p.returnCount} return(s)`,
      );
    }
  }

  return lines.join("\n");
}
