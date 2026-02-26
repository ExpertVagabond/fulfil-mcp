/**
 * Inventory tools — products, stock levels, low-stock alerts
 */

import { getClient, type Domain } from "../api.js";

// ---------------------------------------------------------------------------
// 1. list_products
// ---------------------------------------------------------------------------

export interface ListProductsArgs {
  query?: string;
  sku?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export async function listProducts(args: ListProductsArgs): Promise<string> {
  const client = getClient();
  const domain: Domain = [];

  if (args.query) {
    domain.push(["rec_name", "ilike", `%${args.query}%`]);
  }
  if (args.sku) {
    domain.push(["code", "ilike", `%${args.sku}%`]);
  }
  if (args.category) {
    domain.push(["categories.name", "ilike", `%${args.category}%`]);
  }

  const fields = [
    "id",
    "rec_name",
    "code",
    "list_price",
    "cost_price",
    "type",
    "active",
    "salable",
    "purchasable",
  ];

  const products = await client.searchRead("product.product", {
    domain,
    fields,
    limit: args.limit ?? 25,
    offset: args.offset ?? 0,
  });

  if (!products.length) {
    return "No products found matching the given criteria.";
  }

  const lines = products.map((p: Record<string, unknown>) =>
    [
      `ID: ${p.id}`,
      `Name: ${p.rec_name}`,
      `SKU: ${p.code ?? "N/A"}`,
      `List Price: ${p.list_price ?? "N/A"}`,
      `Cost Price: ${p.cost_price ?? "N/A"}`,
      `Type: ${p.type}`,
      `Active: ${p.active}`,
      `Salable: ${p.salable}`,
    ].join(" | "),
  );

  return `Found ${products.length} product(s):\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// 2. get_product
// ---------------------------------------------------------------------------

export interface GetProductArgs {
  product_id: number;
}

export async function getProduct(args: GetProductArgs): Promise<string> {
  const client = getClient();

  const fields = [
    "id",
    "rec_name",
    "code",
    "list_price",
    "cost_price",
    "type",
    "active",
    "salable",
    "purchasable",
    "description",
    "weight",
    "weight_uom",
    "default_uom",
    "categories",
    "account_category",
  ];

  const product = await client.read("product.product", args.product_id, fields);
  const p = product as Record<string, unknown>;

  const lines = [
    `Product ID: ${p.id}`,
    `Name: ${p.rec_name}`,
    `SKU/Code: ${p.code ?? "N/A"}`,
    `Description: ${p.description ?? "N/A"}`,
    `List Price: ${p.list_price ?? "N/A"}`,
    `Cost Price: ${p.cost_price ?? "N/A"}`,
    `Type: ${p.type}`,
    `Active: ${p.active}`,
    `Salable: ${p.salable}`,
    `Purchasable: ${p.purchasable}`,
    `Weight: ${p.weight ?? "N/A"} ${p.weight_uom ?? ""}`,
    `Default UOM: ${p.default_uom ?? "N/A"}`,
    `Categories: ${Array.isArray(p.categories) ? (p.categories as unknown[]).join(", ") : "N/A"}`,
  ];

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 3. check_inventory
// ---------------------------------------------------------------------------

export interface CheckInventoryArgs {
  product_id: number;
}

export async function checkInventory(args: CheckInventoryArgs): Promise<string> {
  const client = getClient();

  // Get product info first
  const product = await client.read<Record<string, unknown>>(
    "product.product",
    args.product_id,
    ["rec_name", "code"],
  );

  // Query stock.move to compute on-hand by location
  // Alternative: use product's quantity_on_hand if available
  // We'll search stock quantities via product fields
  const productWithStock = await client.read<Record<string, unknown>>(
    "product.product",
    args.product_id,
    [
      "rec_name",
      "code",
      "quantity_on_hand",
      "quantity_available",
      "forecast_quantity",
    ],
  );

  const lines = [
    `Product: ${productWithStock.rec_name} (SKU: ${productWithStock.code ?? "N/A"})`,
    `On Hand: ${productWithStock.quantity_on_hand ?? "N/A"}`,
    `Available: ${productWithStock.quantity_available ?? "N/A"}`,
    `Forecast: ${productWithStock.forecast_quantity ?? "N/A"}`,
  ];

  // Also try to get warehouse-level breakdown via stock.location
  try {
    const moves = await client.searchRead<Record<string, unknown>>(
      "stock.move",
      {
        domain: [
          ["product", "=", args.product_id],
          ["state", "=", "done"],
        ],
        fields: [
          "to_location",
          "to_location.rec_name",
          "from_location",
          "from_location.rec_name",
          "quantity",
          "effective_date",
        ],
        limit: 50,
        order: [["effective_date", "DESC"]],
      },
    );

    if (moves.length > 0) {
      lines.push("\nRecent stock movements (last 50):");
      for (const m of moves.slice(0, 10)) {
        lines.push(
          `  ${m.effective_date}: ${m["from_location.rec_name"]} -> ${m["to_location.rec_name"]} qty: ${m.quantity}`,
        );
      }
      if (moves.length > 10) {
        lines.push(`  ... and ${moves.length - 10} more movements`);
      }
    }
  } catch {
    // stock.move details not available — that's fine
    lines.push("\n(Detailed stock movement breakdown not available)");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 4. low_stock_alert
// ---------------------------------------------------------------------------

export interface LowStockAlertArgs {
  threshold: number;
  limit?: number;
}

export async function lowStockAlert(args: LowStockAlertArgs): Promise<string> {
  const client = getClient();

  const products = await client.searchRead<Record<string, unknown>>(
    "product.product",
    {
      domain: [
        ["quantity_on_hand", "<=", args.threshold],
        ["active", "=", true],
        ["salable", "=", true],
      ],
      fields: [
        "id",
        "rec_name",
        "code",
        "quantity_on_hand",
        "quantity_available",
      ],
      limit: args.limit ?? 50,
      order: [["quantity_on_hand", "ASC"]],
    },
  );

  if (!products.length) {
    return `No salable products found with on-hand quantity at or below ${args.threshold}.`;
  }

  const lines = products.map(
    (p) =>
      `ID: ${p.id} | ${p.rec_name} (SKU: ${p.code ?? "N/A"}) | On Hand: ${p.quantity_on_hand} | Available: ${p.quantity_available ?? "N/A"}`,
  );

  return `${products.length} product(s) at or below threshold (${args.threshold}):\n\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// 5. inventory_by_location
// ---------------------------------------------------------------------------

export interface InventoryByLocationArgs {
  product_id?: number;
  location_name?: string;
}

export async function inventoryByLocation(
  args: InventoryByLocationArgs,
): Promise<string> {
  const client = getClient();

  // Get warehouse locations
  const locDomain: Domain = [["type", "=", "warehouse"]];
  if (args.location_name) {
    locDomain.push(["rec_name", "ilike", `%${args.location_name}%`]);
  }

  const locations = await client.searchRead<Record<string, unknown>>(
    "stock.location",
    {
      domain: locDomain,
      fields: ["id", "rec_name", "type", "active"],
      limit: 50,
    },
  );

  if (!locations.length) {
    return "No warehouse locations found.";
  }

  const lines: string[] = ["Warehouse Locations:"];

  for (const loc of locations) {
    lines.push(`\n--- ${loc.rec_name} (ID: ${loc.id}, Type: ${loc.type}) ---`);

    if (args.product_id) {
      // Get stock for specific product at this location
      try {
        const moves = await client.searchRead<Record<string, unknown>>(
          "stock.move",
          {
            domain: [
              ["product", "=", args.product_id],
              ["to_location", "=", loc.id as number],
              ["state", "=", "done"],
            ],
            fields: ["quantity", "effective_date"],
            limit: 5,
            order: [["effective_date", "DESC"]],
          },
        );
        lines.push(`  Recent inbound moves: ${moves.length}`);
        for (const m of moves) {
          lines.push(`    ${m.effective_date}: qty ${m.quantity}`);
        }
      } catch {
        lines.push("  (Could not retrieve stock details for this location)");
      }
    }
  }

  return lines.join("\n");
}
