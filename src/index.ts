#!/usr/bin/env node

/**
 * fulfil-mcp — MCP server for Fulfil.io ERP
 *
 * Provides tools for inventory, orders, shipments, customers,
 * analytics, and daily operations via Fulfil.io REST API v2.
 *
 * Environment variables:
 *   FULFIL_API_KEY     — Fulfil.io API key (Bearer token)
 *   FULFIL_SUBDOMAIN   — Fulfil.io tenant subdomain
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
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
