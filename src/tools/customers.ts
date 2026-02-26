/**
 * Customer tools — search, order history
 */

import { getClient, type Domain } from "../api.js";

// ---------------------------------------------------------------------------
// 13. search_customers
// ---------------------------------------------------------------------------

export interface SearchCustomersArgs {
  query?: string;
  email?: string;
  phone?: string;
  limit?: number;
  offset?: number;
}

export async function searchCustomers(
  args: SearchCustomersArgs,
): Promise<string> {
  const client = getClient();
  const domain: Domain = [];

  if (args.query) {
    domain.push(["rec_name", "ilike", `%${args.query}%`]);
  }
  if (args.email) {
    domain.push(["email", "ilike", `%${args.email}%`]);
  }
  if (args.phone) {
    domain.push(["phone", "ilike", `%${args.phone}%`]);
  }

  const fields = [
    "id",
    "rec_name",
    "email",
    "phone",
    "addresses",
    "active",
    "customer_since",
  ];

  const customers = await client.searchRead("party.party", {
    domain,
    fields,
    limit: args.limit ?? 25,
    offset: args.offset ?? 0,
  });

  if (!customers.length) {
    return "No customers found matching the given criteria.";
  }

  const lines = (customers as Record<string, unknown>[]).map((c) =>
    [
      `ID: ${c.id}`,
      `Name: ${c.rec_name}`,
      `Email: ${c.email ?? "N/A"}`,
      `Phone: ${c.phone ?? "N/A"}`,
      `Active: ${c.active}`,
      `Since: ${c.customer_since ?? "N/A"}`,
    ].join(" | "),
  );

  return `Found ${customers.length} customer(s):\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// 14. customer_order_history
// ---------------------------------------------------------------------------

export interface CustomerOrderHistoryArgs {
  customer_id: number;
  limit?: number;
}

export async function customerOrderHistory(
  args: CustomerOrderHistoryArgs,
): Promise<string> {
  const client = getClient();

  // Get customer name
  const customer = await client.read<Record<string, unknown>>(
    "party.party",
    args.customer_id,
    ["rec_name", "email"],
  );

  // Get their orders
  const orders = await client.searchRead<Record<string, unknown>>(
    "sale.sale",
    {
      domain: [["party", "=", args.customer_id]],
      fields: [
        "id",
        "number",
        "sale_date",
        "state",
        "total_amount",
        "currency",
        "shipment_state",
        "invoice_state",
      ],
      limit: args.limit ?? 50,
      order: [["sale_date", "DESC"]],
    },
  );

  const lines = [
    `Customer: ${customer.rec_name} (ID: ${args.customer_id})`,
    `Email: ${customer.email ?? "N/A"}`,
    `Total Orders: ${orders.length}`,
  ];

  if (orders.length > 0) {
    // Calculate totals
    let totalSpend = 0;
    for (const o of orders) {
      const amount = typeof o.total_amount === "number"
        ? o.total_amount
        : parseFloat(String(o.total_amount) || "0");
      totalSpend += amount;
    }

    lines.push(`Lifetime Spend: ${totalSpend.toFixed(2)}`);
    lines.push("");
    lines.push("Order History:");

    for (const o of orders) {
      lines.push(
        `  Order #${o.number ?? o.id} | ${o.sale_date} | ${o.state} | ${o.total_amount} ${o.currency ?? ""} | Ship: ${o.shipment_state ?? "N/A"} | Invoice: ${o.invoice_state ?? "N/A"}`,
      );
    }
  } else {
    lines.push("", "No orders found for this customer.");
  }

  return lines.join("\n");
}
