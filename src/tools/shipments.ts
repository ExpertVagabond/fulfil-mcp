/**
 * Shipment tools — outbound shipments, exceptions
 */

import { getClient, type Domain } from "../api.js";

// ---------------------------------------------------------------------------
// 11. list_shipments
// ---------------------------------------------------------------------------

export interface ListShipmentsArgs {
  status?: string;
  date_from?: string;
  date_to?: string;
  carrier?: string;
  limit?: number;
  offset?: number;
}

export async function listShipments(args: ListShipmentsArgs): Promise<string> {
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
  if (args.carrier) {
    domain.push(["carrier.rec_name", "ilike", `%${args.carrier}%`]);
  }

  const fields = [
    "id",
    "number",
    "state",
    "planned_date",
    "effective_date",
    "customer.rec_name",
    "carrier.rec_name",
    "tracking_number",
    "warehouse.rec_name",
  ];

  const shipments = await client.searchRead("stock.shipment.out", {
    domain,
    fields,
    limit: args.limit ?? 25,
    offset: args.offset ?? 0,
    order: [["planned_date", "DESC"]],
  });

  if (!shipments.length) {
    return "No shipments found matching the given criteria.";
  }

  const lines = (shipments as Record<string, unknown>[]).map((s) =>
    [
      `Shipment #${s.number ?? s.id}`,
      `State: ${s.state}`,
      `Customer: ${s["customer.rec_name"] ?? "N/A"}`,
      `Planned: ${s.planned_date ?? "N/A"}`,
      `Shipped: ${s.effective_date ?? "N/A"}`,
      `Carrier: ${s["carrier.rec_name"] ?? "N/A"}`,
      `Tracking: ${s.tracking_number ?? "N/A"}`,
      `Warehouse: ${s["warehouse.rec_name"] ?? "N/A"}`,
    ].join(" | "),
  );

  return `Found ${shipments.length} shipment(s):\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// 12. shipment_exceptions
// ---------------------------------------------------------------------------

export interface ShipmentExceptionsArgs {
  days?: number;
  limit?: number;
}

export async function shipmentExceptions(
  args: ShipmentExceptionsArgs,
): Promise<string> {
  const client = getClient();
  const sections: string[] = [];

  // 1) Shipments stuck in "waiting" or "assigned" past their planned date
  const today = new Date().toISOString().split("T")[0];

  const overdue = await client.searchRead<Record<string, unknown>>(
    "stock.shipment.out",
    {
      domain: [
        ["planned_date", "<", today],
        ["state", "in", ["waiting", "assigned", "packed"]],
      ],
      fields: [
        "id",
        "number",
        "state",
        "planned_date",
        "customer.rec_name",
        "carrier.rec_name",
        "warehouse.rec_name",
      ],
      limit: args.limit ?? 50,
      order: [["planned_date", "ASC"]],
    },
  );

  if (overdue.length > 0) {
    const lines = overdue.map((s) => {
      const planned = new Date(s.planned_date as string);
      const daysLate = Math.floor(
        (Date.now() - planned.getTime()) / (1000 * 60 * 60 * 24),
      );
      return `  Shipment #${s.number ?? s.id} | State: ${s.state} | Planned: ${s.planned_date} (${daysLate}d overdue) | Customer: ${s["customer.rec_name"] ?? "N/A"} | Carrier: ${s["carrier.rec_name"] ?? "N/A"}`;
    });
    sections.push(
      `OVERDUE SHIPMENTS (${overdue.length}):\n${lines.join("\n")}`,
    );
  } else {
    sections.push("OVERDUE SHIPMENTS: None");
  }

  // 2) Shipments in exception state
  const exceptions = await client.searchRead<Record<string, unknown>>(
    "stock.shipment.out",
    {
      domain: [["state", "=", "exception"]],
      fields: [
        "id",
        "number",
        "state",
        "planned_date",
        "customer.rec_name",
        "warehouse.rec_name",
      ],
      limit: args.limit ?? 50,
    },
  );

  if (exceptions.length > 0) {
    const lines = exceptions.map(
      (s) =>
        `  Shipment #${s.number ?? s.id} | Planned: ${s.planned_date ?? "N/A"} | Customer: ${s["customer.rec_name"] ?? "N/A"} | Warehouse: ${s["warehouse.rec_name"] ?? "N/A"}`,
    );
    sections.push(
      `\nEXCEPTION SHIPMENTS (${exceptions.length}):\n${lines.join("\n")}`,
    );
  } else {
    sections.push("\nEXCEPTION SHIPMENTS: None");
  }

  return sections.join("\n");
}
