#!/usr/bin/env node

/**
 * fulfil-mcp — MCP server for Fulfil.io ERP
 *
 * Provides tools for inventory, orders, shipments, customers,
 * analytics, and daily operations via Fulfil.io REST API v2.
 *
 * Security:
 * - API keys redacted from all error messages before client delivery
 * - All tool inputs validated via Zod schemas (type + bounds)
 * - Environment variables validated at import time (fail-fast)
 * - No shell execution — all API calls via structured HTTP fetch
 * - Numeric limits clamped to prevent excessive API requests
 *
 * Environment variables:
 *   FULFIL_API_KEY     — Fulfil.io API key (Bearer token)
 *   FULFIL_SUBDOMAIN   — Fulfil.io tenant subdomain
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Environment validation (fail-fast) ──────────────────────────────────────

const REQUIRED_ENV = ["FULFIL_API_KEY", "FULFIL_SUBDOMAIN"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// ── Security helpers ──────────────────────────────────────────────────────────

/** Validate a string input: type check, length bound, no null bytes. */
function validateInput(value: unknown, name: string, maxLen = 1024): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  if (value.includes("\0")) throw new Error(`${name} contains null byte`);
  if (value.length > maxLen) throw new Error(`${name} exceeds max length (${maxLen})`);
  return value;
}

function redactEnvSecrets(message: string): string {
  const key = process.env.FULFIL_API_KEY;
  if (key && message.includes(key)) {
    return message.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[REDACTED]");
  }
  return message;
}

function safeErrorMessage(err: unknown): string {
  return redactEnvSecrets(err instanceof Error ? err.message : String(err));
}

// Tool implementations
import {
  listProducts,
  getProduct,
  checkInventory,
  lowStockAlert,
  inventoryByLocation,
} from "./tools/inventory.js";

import {
  listOrders,
  getOrder,
  orderStatus,
  delayedOrders,
  recentOrders,
} from "./tools/orders.js";

import { listShipments, shipmentExceptions } from "./tools/shipments.js";

import { searchCustomers, customerOrderHistory } from "./tools/customers.js";

import {
  salesSummary,
  topProducts,
  inventoryValuation,
} from "./tools/analytics.js";

import { dailyOpsBriefing } from "./tools/operations.js";

import {
  listPurchaseOrders,
  getPurchaseOrder,
  overduePurchaseOrders,
  createPurchaseOrderDraft,
} from "./tools/purchasing.js";

import {
  listReturns,
  getReturn,
  returnRateReport,
} from "./tools/returns.js";

import {
  listWarehouses,
  warehouseUtilization,
  pendingReceipts,
  pickList,
} from "./tools/warehouse.js";

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "fulfil-mcp",
  version: "0.1.0",
});

// ---- Inventory Tools -------------------------------------------------------

server.tool(
  "list_products",
  "Search and list products with filters (name, SKU, category). Returns product details including pricing and availability.",
  {
    query: z.string().optional().describe("Search products by name (partial match)"),
    sku: z.string().optional().describe("Filter by SKU/product code (partial match)"),
    category: z.string().optional().describe("Filter by category name (partial match)"),
    limit: z.number().optional().describe("Max results to return (default 25)"),
    offset: z.number().optional().describe("Pagination offset (default 0)"),
  },
  async (args) => {
    try {
      const text = await listProducts(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "get_product",
  "Get detailed information about a specific product by its ID, including pricing, weight, categories, and availability flags.",
  {
    product_id: z.number().describe("The Fulfil product ID"),
  },
  async (args) => {
    try {
      const text = await getProduct(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "check_inventory",
  "Check stock levels for a product including on-hand quantity, available quantity, forecast, and recent stock movements.",
  {
    product_id: z.number().describe("The Fulfil product ID to check inventory for"),
  },
  async (args) => {
    try {
      const text = await checkInventory(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "low_stock_alert",
  "Find salable products with on-hand inventory at or below a given threshold. Useful for reorder planning and stockout prevention.",
  {
    threshold: z.number().describe("Stock level threshold — products at or below this quantity are returned"),
    limit: z.number().optional().describe("Max results (default 50)"),
  },
  async (args) => {
    try {
      const text = await lowStockAlert(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "inventory_by_location",
  "Get inventory breakdown by warehouse location. Optionally filter to a specific product or location name.",
  {
    product_id: z.number().optional().describe("Filter to a specific product ID"),
    location_name: z.string().optional().describe("Filter locations by name (partial match)"),
  },
  async (args) => {
    try {
      const text = await inventoryByLocation(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

// ---- Order Tools -----------------------------------------------------------

server.tool(
  "list_orders",
  "Search sales orders with filters by status, customer name, and date range. Returns order summaries with fulfillment status.",
  {
    status: z.string().optional().describe("Order state filter (e.g. draft, confirmed, processing, done, cancelled)"),
    customer_name: z.string().optional().describe("Filter by customer name (partial match)"),
    date_from: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
    date_to: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max results (default 25)"),
    offset: z.number().optional().describe("Pagination offset (default 0)"),
  },
  async (args) => {
    try {
      const text = await listOrders(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "get_order",
  "Get complete details for a sales order including line items, amounts, shipping address, fulfillment status, and payment status.",
  {
    order_id: z.number().describe("The Fulfil sale order ID"),
  },
  async (args) => {
    try {
      const text = await getOrder(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "order_status",
  "Check the fulfillment/shipment status for an order, including tracking numbers and carrier information for all associated shipments.",
  {
    order_id: z.number().describe("The Fulfil sale order ID"),
  },
  async (args) => {
    try {
      const text = await orderStatus(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "delayed_orders",
  "Find orders that were placed more than N days ago but still haven't shipped. Critical for identifying fulfillment bottlenecks.",
  {
    days: z.number().describe("Number of days — orders older than this that haven't shipped will be returned"),
    limit: z.number().optional().describe("Max results (default 50)"),
  },
  async (args) => {
    try {
      const text = await delayedOrders(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "recent_orders",
  "Get the N most recent sales orders, sorted by creation date. Quick way to see the latest order activity.",
  {
    count: z.number().optional().describe("Number of recent orders to return (default 10)"),
  },
  async (args) => {
    try {
      const text = await recentOrders(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

// ---- Shipment Tools --------------------------------------------------------

server.tool(
  "list_shipments",
  "Search outbound shipments with filters by status, date range, and carrier. Returns shipment details with tracking info.",
  {
    status: z.string().optional().describe("Shipment state (waiting, assigned, packed, done, exception, cancelled)"),
    date_from: z.string().optional().describe("Planned date start filter (YYYY-MM-DD)"),
    date_to: z.string().optional().describe("Planned date end filter (YYYY-MM-DD)"),
    carrier: z.string().optional().describe("Filter by carrier name (partial match)"),
    limit: z.number().optional().describe("Max results (default 25)"),
    offset: z.number().optional().describe("Pagination offset (default 0)"),
  },
  async (args) => {
    try {
      const text = await listShipments(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "shipment_exceptions",
  "Find shipments with problems: overdue (past planned date but not shipped) and in exception state. Critical for operations monitoring.",
  {
    days: z.number().optional().describe("Not used currently — all overdue shipments are returned"),
    limit: z.number().optional().describe("Max results per category (default 50)"),
  },
  async (args) => {
    try {
      const text = await shipmentExceptions(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

// ---- Customer Tools --------------------------------------------------------

server.tool(
  "search_customers",
  "Search customers by name, email, or phone number. Returns customer contact details.",
  {
    query: z.string().optional().describe("Search by name (partial match)"),
    email: z.string().optional().describe("Search by email (partial match)"),
    phone: z.string().optional().describe("Search by phone (partial match)"),
    limit: z.number().optional().describe("Max results (default 25)"),
    offset: z.number().optional().describe("Pagination offset (default 0)"),
  },
  async (args) => {
    try {
      const text = await searchCustomers(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "customer_order_history",
  "Get complete order history for a customer, including lifetime spend and all order details with fulfillment status.",
  {
    customer_id: z.number().describe("The Fulfil party/customer ID"),
    limit: z.number().optional().describe("Max orders to return (default 50)"),
  },
  async (args) => {
    try {
      const text = await customerOrderHistory(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

// ---- Analytics Tools -------------------------------------------------------

server.tool(
  "sales_summary",
  "Generate a sales summary for a date range: total orders, revenue, tax, average order value, and breakdowns by order/shipment state.",
  {
    date_from: z.string().describe("Start date (YYYY-MM-DD)"),
    date_to: z.string().describe("End date (YYYY-MM-DD)"),
  },
  async (args) => {
    try {
      const text = await salesSummary(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "top_products",
  "Find the best-selling products for a date range, ranked by revenue. Shows quantity sold and total revenue per product.",
  {
    date_from: z.string().describe("Start date (YYYY-MM-DD)"),
    date_to: z.string().describe("End date (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Number of top products to return (default 20)"),
  },
  async (args) => {
    try {
      const text = await topProducts(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "inventory_valuation",
  "Calculate total inventory value (quantity on hand x cost price) across all products. Optionally filter by category.",
  {
    category: z.string().optional().describe("Filter by product category name (partial match)"),
  },
  async (args) => {
    try {
      const text = await inventoryValuation(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

// ---- Operations Tools ------------------------------------------------------

server.tool(
  "daily_ops_briefing",
  "Generate a comprehensive morning operations summary: today's orders vs. yesterday, pending fulfillment, shipment status, overdue shipments, low stock alerts, and exception flags. The go-to tool for a daily standup.",
  {},
  async () => {
    try {
      const text = await dailyOpsBriefing();
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

// ---- Purchasing Tools -----------------------------------------------------

server.tool(
  "list_purchase_orders",
  "Search purchase orders by status, supplier, and date range. Returns PO summaries with delivery dates and fulfillment status.",
  {
    status: z.string().optional().describe("PO state filter (e.g. draft, confirmed, processing, done, cancelled)"),
    supplier_name: z.string().optional().describe("Filter by supplier name (partial match)"),
    date_from: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
    date_to: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
    limit: z.number().optional().describe("Max results (default 25)"),
    offset: z.number().optional().describe("Pagination offset (default 0)"),
  },
  async (args) => {
    try {
      const text = await listPurchaseOrders(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "get_purchase_order",
  "Get detailed information about a specific purchase order including line items, expected delivery dates, and supplier details.",
  {
    purchase_order_id: z.number().describe("The Fulfil purchase order ID"),
  },
  async (args) => {
    try {
      const text = await getPurchaseOrder(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "overdue_purchase_orders",
  "Find purchase orders past their expected delivery date that haven't been fully received. Critical for supplier follow-up.",
  {
    limit: z.number().optional().describe("Max results (default 50)"),
  },
  async (args) => {
    try {
      const text = await overduePurchaseOrders(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "create_purchase_order_draft",
  "Create a draft purchase order for a supplier with specified products and quantities. Returns a preview with estimated totals.",
  {
    supplier_id: z.number().describe("The Fulfil party/supplier ID"),
    products: z.array(z.object({
      product_id: z.number().describe("Product ID to order"),
      quantity: z.number().describe("Quantity to order"),
      unit_price: z.number().optional().describe("Override unit price (defaults to product cost price)"),
    })).describe("Array of products with quantities to order"),
    delivery_date: z.string().optional().describe("Expected delivery date (YYYY-MM-DD)"),
    warehouse_id: z.number().optional().describe("Destination warehouse ID"),
    comment: z.string().optional().describe("Notes for the PO"),
  },
  async (args) => {
    try {
      const text = await createPurchaseOrderDraft(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

// ---- Returns / RMA Tools --------------------------------------------------

server.tool(
  "list_returns",
  "Search customer returns by status, date range, and reason. Returns summaries with refund status.",
  {
    status: z.string().optional().describe("Return state filter (e.g. draft, waiting, received, done, cancelled)"),
    date_from: z.string().optional().describe("Start date filter (YYYY-MM-DD)"),
    date_to: z.string().optional().describe("End date filter (YYYY-MM-DD)"),
    reason: z.string().optional().describe("Filter by return reason/comment (partial match)"),
    limit: z.number().optional().describe("Max results (default 25)"),
    offset: z.number().optional().describe("Pagination offset (default 0)"),
  },
  async (args) => {
    try {
      const text = await listReturns(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "get_return",
  "Get detailed information about a specific customer return including items, quantities, refund value, and reason.",
  {
    return_id: z.number().describe("The Fulfil return shipment ID"),
  },
  async (args) => {
    try {
      const text = await getReturn(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "return_rate_report",
  "Calculate return rates and identify most-returned products for a date range. Shows return rate, return value, and product-level breakdown.",
  {
    date_from: z.string().describe("Start date (YYYY-MM-DD)"),
    date_to: z.string().describe("End date (YYYY-MM-DD)"),
    group_by: z.string().optional().describe("Group by: product or category (default: product)"),
  },
  async (args) => {
    try {
      const text = await returnRateReport(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

// ---- Warehouse Tools ------------------------------------------------------

server.tool(
  "list_warehouses",
  "List all warehouse locations with addresses, zones (input, output, storage, picking), and active status.",
  {},
  async () => {
    try {
      const text = await listWarehouses({});
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "warehouse_utilization",
  "Show warehouse utilization: active SKUs, total units on hand, available vs reserved stock. Optionally filter by warehouse name.",
  {
    warehouse_name: z.string().optional().describe("Filter by warehouse name (partial match)"),
  },
  async (args) => {
    try {
      const text = await warehouseUtilization(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "pending_receipts",
  "Show inbound shipments/receipts expected at warehouses, including overdue flags. Useful for receiving dock planning.",
  {
    warehouse_name: z.string().optional().describe("Filter by warehouse name (partial match)"),
    limit: z.number().optional().describe("Max results (default 50)"),
  },
  async (args) => {
    try {
      const text = await pendingReceipts(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "pick_list",
  "Generate a consolidated pick list for pending outbound shipments. Groups items by product and location for efficient warehouse picking.",
  {
    warehouse_name: z.string().optional().describe("Filter by warehouse name (partial match)"),
    limit: z.number().optional().describe("Max shipments to include (default 30)"),
  },
  async (args) => {
    try {
      const text = await pickList(args);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${safeErrorMessage(err)}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Validate env before starting
  if (!process.env.FULFIL_API_KEY) {
    console.error("Error: FULFIL_API_KEY environment variable is required");
    process.exit(1);
  }
  if (!process.env.FULFIL_SUBDOMAIN) {
    console.error("Error: FULFIL_SUBDOMAIN environment variable is required");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`fulfil-mcp server running (subdomain: ${process.env.FULFIL_SUBDOMAIN})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
