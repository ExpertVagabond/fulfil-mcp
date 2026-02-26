/**
 * Operations tools — daily briefing, operational health
 */

import { getClient } from "../api.js";

// ---------------------------------------------------------------------------
// 18. daily_ops_briefing
// ---------------------------------------------------------------------------

export async function dailyOpsBriefing(): Promise<string> {
  const client = getClient();
  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const sections: string[] = [];

  sections.push(`DAILY OPERATIONS BRIEFING - ${today}`);
  sections.push("=".repeat(60));

  // --- 1. Orders summary ---
  try {
    const todayOrders = await client.searchRead<Record<string, unknown>>(
      "sale.sale",
      {
        domain: [["sale_date", "=", today]],
        fields: ["id", "total_amount", "state"],
        limit: 1000,
      },
    );

    const yesterdayOrders = await client.searchRead<Record<string, unknown>>(
      "sale.sale",
      {
        domain: [["sale_date", "=", yesterday]],
        fields: ["id", "total_amount", "state"],
        limit: 1000,
      },
    );

    const todayRevenue = todayOrders.reduce(
      (sum, o) => sum + parseFloat(String(o.total_amount) || "0"),
      0,
    );
    const yesterdayRevenue = yesterdayOrders.reduce(
      (sum, o) => sum + parseFloat(String(o.total_amount) || "0"),
      0,
    );

    sections.push("");
    sections.push("ORDERS:");
    sections.push(`  Today's Orders: ${todayOrders.length}`);
    sections.push(`  Today's Revenue: ${todayRevenue.toFixed(2)}`);
    sections.push(`  Yesterday's Orders: ${yesterdayOrders.length}`);
    sections.push(`  Yesterday's Revenue: ${yesterdayRevenue.toFixed(2)}`);

    if (yesterdayRevenue > 0) {
      const change = ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100;
      sections.push(`  Day-over-Day: ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`);
    }
  } catch {
    sections.push("\nORDERS: (Could not fetch order data)");
  }

  // --- 2. Pending fulfillment ---
  try {
    const pendingOrders = await client.searchRead<Record<string, unknown>>(
      "sale.sale",
      {
        domain: [
          ["state", "in", ["confirmed", "processing"]],
          ["shipment_state", "in", ["none", "waiting"]],
        ],
        fields: ["id"],
        limit: 1000,
      },
    );

    sections.push("");
    sections.push("PENDING FULFILLMENT:");
    sections.push(`  Orders awaiting shipment: ${pendingOrders.length}`);
  } catch {
    sections.push("\nPENDING FULFILLMENT: (Could not fetch data)");
  }

  // --- 3. Shipment status ---
  try {
    const states = ["waiting", "assigned", "packed", "done"];
    sections.push("");
    sections.push("TODAY'S SHIPMENTS:");

    for (const state of states) {
      const shipments = await client.searchRead<Record<string, unknown>>(
        "stock.shipment.out",
        {
          domain: [
            ["planned_date", "=", today],
            ["state", "=", state],
          ],
          fields: ["id"],
          limit: 1000,
        },
      );
      sections.push(`  ${state}: ${shipments.length}`);
    }
  } catch {
    sections.push("\nTODAY'S SHIPMENTS: (Could not fetch data)");
  }

  // --- 4. Overdue shipments ---
  try {
    const overdue = await client.searchRead<Record<string, unknown>>(
      "stock.shipment.out",
      {
        domain: [
          ["planned_date", "<", today],
          ["state", "in", ["waiting", "assigned", "packed"]],
        ],
        fields: ["id"],
        limit: 1000,
      },
    );

    sections.push("");
    sections.push("ALERTS:");
    sections.push(
      `  Overdue Shipments: ${overdue.length}${overdue.length > 0 ? " *** ACTION REQUIRED ***" : ""}`,
    );
  } catch {
    sections.push("\nALERTS: (Could not fetch overdue shipment data)");
  }

  // --- 5. Low stock ---
  try {
    const lowStock = await client.searchRead<Record<string, unknown>>(
      "product.product",
      {
        domain: [
          ["quantity_on_hand", "<=", 5],
          ["active", "=", true],
          ["salable", "=", true],
          ["quantity_on_hand", ">", 0],
        ],
        fields: ["id", "rec_name", "code", "quantity_on_hand"],
        limit: 20,
        order: [["quantity_on_hand", "ASC"]],
      },
    );

    sections.push(
      `  Low Stock Products (<=5 units): ${lowStock.length}${lowStock.length > 0 ? " *** REVIEW ***" : ""}`,
    );

    if (lowStock.length > 0) {
      for (const p of lowStock.slice(0, 5)) {
        sections.push(
          `    - ${p.rec_name} (${p.code ?? "N/A"}): ${p.quantity_on_hand} units`,
        );
      }
      if (lowStock.length > 5) {
        sections.push(`    ... and ${lowStock.length - 5} more`);
      }
    }

    // Out of stock
    const oos = await client.searchRead<Record<string, unknown>>(
      "product.product",
      {
        domain: [
          ["quantity_on_hand", "<=", 0],
          ["active", "=", true],
          ["salable", "=", true],
        ],
        fields: ["id"],
        limit: 1000,
      },
    );

    sections.push(
      `  Out of Stock Products: ${oos.length}${oos.length > 0 ? " *** CRITICAL ***" : ""}`,
    );
  } catch {
    sections.push("  Low Stock: (Could not fetch inventory data)");
  }

  // --- 6. Exception shipments ---
  try {
    const exceptions = await client.searchRead<Record<string, unknown>>(
      "stock.shipment.out",
      {
        domain: [["state", "=", "exception"]],
        fields: ["id"],
        limit: 100,
      },
    );

    sections.push(
      `  Shipment Exceptions: ${exceptions.length}${exceptions.length > 0 ? " *** FIX ***" : ""}`,
    );
  } catch {
    sections.push("  Shipment Exceptions: (Could not fetch data)");
  }

  sections.push("");
  sections.push("=".repeat(60));
  sections.push(`Generated at ${new Date().toISOString()}`);

  return sections.join("\n");
}
