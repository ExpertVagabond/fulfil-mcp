/**
 * Warehouse operations tools — locations, utilization, receipts, pick lists
 */

import { getClient, type Domain } from "../api.js";

// ---------------------------------------------------------------------------
// 26. list_warehouses
// ---------------------------------------------------------------------------

export interface ListWarehousesArgs {}

export async function listWarehouses(
  _args: ListWarehousesArgs,
): Promise<string> {
  const client = getClient();

  const locations = await client.searchRead<Record<string, unknown>>(
    "stock.location",
    {
      domain: [["type", "=", "warehouse"]],
      fields: [
        "id",
        "rec_name",
        "code",
        "type",
        "active",
        "address",
        "address.rec_name",
        "input_location",
        "output_location",
        "storage_location",
        "picking_location",
      ],
      limit: 100,
    },
  );

  if (!locations.length) {
    return "No warehouse locations found.";
  }

  const lines = locations.map((loc) =>
    [
      `**${loc.rec_name}** (ID: ${loc.id})`,
      `  Code: ${loc.code ?? "N/A"}`,
      `  Active: ${loc.active}`,
      `  Address: ${loc["address.rec_name"] ?? "N/A"}`,
      `  Zones: Input=${loc.input_location ?? "N/A"} | Output=${loc.output_location ?? "N/A"} | Storage=${loc.storage_location ?? "N/A"} | Picking=${loc.picking_location ?? "N/A"}`,
    ].join("\n"),
  );

  return `Found ${locations.length} warehouse(s):\n\n${lines.join("\n\n")}`;
}

// ---------------------------------------------------------------------------
// 27. warehouse_utilization
// ---------------------------------------------------------------------------

export interface WarehouseUtilizationArgs {
  warehouse_name?: string;
}

export async function warehouseUtilization(
  args: WarehouseUtilizationArgs,
): Promise<string> {
  const client = getClient();

  const locDomain: Domain = [["type", "=", "warehouse"]];
  if (args.warehouse_name) {
    locDomain.push(["rec_name", "ilike", `%${args.warehouse_name}%`]);
  }

  const warehouses = await client.searchRead<Record<string, unknown>>(
    "stock.location",
    {
      domain: locDomain,
      fields: ["id", "rec_name", "code", "storage_location"],
      limit: 50,
    },
  );

  if (!warehouses.length) {
    return "No warehouses found.";
  }

  const sections: string[] = [
    `Warehouse Utilization Report`,
    `${"=".repeat(50)}`,
  ];

  for (const wh of warehouses) {
    sections.push(`\n--- ${wh.rec_name} (ID: ${wh.id}) ---`);

    // Get products with stock at this warehouse's storage location
    try {
      const stockProducts = await client.searchRead<Record<string, unknown>>(
        "product.product",
        {
          domain: [
            ["quantity_on_hand", ">", 0],
            ["active", "=", true],
          ],
          fields: ["id", "rec_name", "quantity_on_hand", "quantity_available"],
          limit: 5000,
        },
      );

      let totalOnHand = 0;
      let totalAvailable = 0;
      let skuCount = 0;

      for (const p of stockProducts) {
        const onHand = parseFloat(String(p.quantity_on_hand) || "0");
        const available = parseFloat(String(p.quantity_available) || "0");
        totalOnHand += onHand;
        totalAvailable += available;
        if (onHand > 0) skuCount++;
      }

      sections.push(`  Active SKUs with stock: ${skuCount}`);
      sections.push(`  Total Units on Hand: ${totalOnHand.toFixed(0)}`);
      sections.push(`  Total Units Available: ${totalAvailable.toFixed(0)}`);
      sections.push(
        `  Reserved/Allocated: ${(totalOnHand - totalAvailable).toFixed(0)}`,
      );
    } catch {
      sections.push("  (Could not fetch utilization data for this warehouse)");
    }
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// 28. pending_receipts
// ---------------------------------------------------------------------------

export interface PendingReceiptsArgs {
  warehouse_name?: string;
  limit?: number;
}

export async function pendingReceipts(
  args: PendingReceiptsArgs,
): Promise<string> {
  const client = getClient();

  const domain: Domain = [
    ["state", "in", ["draft", "waiting"]],
  ];

  if (args.warehouse_name) {
    domain.push(["warehouse.rec_name", "ilike", `%${args.warehouse_name}%`]);
  }

  const fields = [
    "id",
    "number",
    "state",
    "planned_date",
    "effective_date",
    "supplier.rec_name",
    "warehouse.rec_name",
    "moves",
  ];

  const receipts = await client.searchRead<Record<string, unknown>>(
    "stock.shipment.in",
    {
      domain,
      fields,
      limit: args.limit ?? 50,
      order: [["planned_date", "ASC"]],
    },
  );

  if (!receipts.length) {
    return "No pending inbound receipts found.";
  }

  const lines: string[] = [];
  for (const r of receipts) {
    const plannedDate = r.planned_date
      ? new Date(r.planned_date as string)
      : null;
    const isOverdue =
      plannedDate && plannedDate.getTime() < Date.now() ? " *** OVERDUE ***" : "";

    let moveCount = 0;
    if (Array.isArray(r.moves)) {
      moveCount = (r.moves as number[]).length;
    }

    lines.push(
      `Receipt #${r.number ?? r.id} | State: ${r.state} | Supplier: ${r["supplier.rec_name"] ?? "N/A"} | Planned: ${r.planned_date ?? "N/A"}${isOverdue} | Warehouse: ${r["warehouse.rec_name"] ?? "N/A"} | Items: ${moveCount}`,
    );
  }

  return `${receipts.length} pending inbound receipt(s):\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// 29. pick_list
// ---------------------------------------------------------------------------

export interface PickListArgs {
  warehouse_name?: string;
  limit?: number;
}

export async function pickList(args: PickListArgs): Promise<string> {
  const client = getClient();

  // Find outbound shipments in "waiting" or "assigned" state (need picking)
  const domain: Domain = [
    ["state", "in", ["waiting", "assigned"]],
  ];

  if (args.warehouse_name) {
    domain.push(["warehouse.rec_name", "ilike", `%${args.warehouse_name}%`]);
  }

  const shipments = await client.searchRead<Record<string, unknown>>(
    "stock.shipment.out",
    {
      domain,
      fields: [
        "id",
        "number",
        "state",
        "planned_date",
        "customer.rec_name",
        "warehouse.rec_name",
        "moves",
      ],
      limit: args.limit ?? 30,
      order: [["planned_date", "ASC"]],
    },
  );

  if (!shipments.length) {
    return "No shipments awaiting picking.";
  }

  const sections: string[] = [
    `PICK LIST`,
    `${"=".repeat(50)}`,
    `Generated: ${new Date().toISOString()}`,
    `Shipments to pick: ${shipments.length}`,
    ``,
  ];

  // Aggregate all items to pick
  const pickItems = new Map<
    string,
    {
      name: string;
      code: string;
      totalQty: number;
      shipments: string[];
      locations: string[];
    }
  >();

  for (const shipment of shipments) {
    const moveIds = shipment.moves;
    if (!Array.isArray(moveIds) || moveIds.length === 0) continue;

    try {
      const moves = await client.readMany<Record<string, unknown>>(
        "stock.move",
        moveIds as number[],
        [
          "product",
          "product.rec_name",
          "product.code",
          "quantity",
          "from_location.rec_name",
        ],
      );

      for (const m of moves) {
        const productId = String(m.product ?? "unknown");
        const qty = parseFloat(String(m.quantity) || "0");
        const existing = pickItems.get(productId);

        if (existing) {
          existing.totalQty += qty;
          existing.shipments.push(String(shipment.number ?? shipment.id));
          const loc = String(m["from_location.rec_name"] ?? "N/A");
          if (!existing.locations.includes(loc)) {
            existing.locations.push(loc);
          }
        } else {
          pickItems.set(productId, {
            name: String(m["product.rec_name"] ?? "Unknown"),
            code: String(m["product.code"] ?? "N/A"),
            totalQty: qty,
            shipments: [String(shipment.number ?? shipment.id)],
            locations: [String(m["from_location.rec_name"] ?? "N/A")],
          });
        }
      }
    } catch {
      sections.push(
        `(Could not fetch move details for shipment #${shipment.number ?? shipment.id})`,
      );
    }
  }

  // Sort by location for efficient picking
  const sortedItems = [...pickItems.values()].sort((a, b) =>
    a.locations[0].localeCompare(b.locations[0]),
  );

  sections.push(`Items to Pick (${sortedItems.length} unique products):`);
  sections.push(`${"─".repeat(50)}`);

  for (const item of sortedItems) {
    sections.push(
      `[ ] ${item.name} (SKU: ${item.code})`,
    );
    sections.push(
      `    Qty: ${item.totalQty} | Location(s): ${item.locations.join(", ")} | For shipment(s): ${item.shipments.join(", ")}`,
    );
  }

  // Per-shipment breakdown
  sections.push(``, `${"─".repeat(50)}`, `Per-Shipment Breakdown:`);
  for (const shipment of shipments) {
    sections.push(
      `  Shipment #${shipment.number ?? shipment.id} | Customer: ${shipment["customer.rec_name"] ?? "N/A"} | Planned: ${shipment.planned_date ?? "N/A"} | State: ${shipment.state}`,
    );
  }

  return sections.join("\n");
}
