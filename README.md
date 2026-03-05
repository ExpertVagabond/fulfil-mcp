# fulfil-mcp

**MCP server for [Fulfil.io](https://fulfil.io) ERP** -- 29 tools for inventory management, order processing, shipment tracking, customer lookup, purchasing, returns, warehouse operations, and business analytics.

Built on the [Model Context Protocol](https://modelcontextprotocol.io) for seamless integration with Claude Desktop, Claude Code, and any MCP-compatible client. Connects to Fulfil.io's REST API v2 with automatic retries, exponential backoff, and rate-limit handling.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.0-orange)](https://modelcontextprotocol.io)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)

---

## Tools (29)

### Inventory (5 tools)

| Tool | Description |
|------|-------------|
| `list_products` | Search products by name, SKU, or category with pagination |
| `get_product` | Detailed product info -- pricing, weight, categories, availability |
| `check_inventory` | Stock levels: on-hand, available, forecast, recent movements |
| `low_stock_alert` | Products at or below a reorder threshold |
| `inventory_by_location` | Stock breakdown across warehouse locations |

### Orders (5 tools)

| Tool | Description |
|------|-------------|
| `list_orders` | Search orders by status, customer, date range |
| `get_order` | Full order details -- line items, amounts, shipping, payment |
| `order_status` | Shipment and fulfillment tracking with carrier info |
| `delayed_orders` | Orders not shipped within N days (fulfillment bottlenecks) |
| `recent_orders` | Latest N orders by creation date |

### Shipments (2 tools)

| Tool | Description |
|------|-------------|
| `list_shipments` | Search outbound shipments by status, date, carrier |
| `shipment_exceptions` | Overdue and exception-state shipments |

### Customers (2 tools)

| Tool | Description |
|------|-------------|
| `search_customers` | Find customers by name, email, or phone |
| `customer_order_history` | Full order history with lifetime spend |

### Analytics (3 tools)

| Tool | Description |
|------|-------------|
| `sales_summary` | Revenue, AOV, tax, and state breakdowns for a date range |
| `top_products` | Best sellers ranked by revenue |
| `inventory_valuation` | Total inventory value (quantity x cost price) |

### Purchasing (4 tools)

| Tool | Description |
|------|-------------|
| `list_purchase_orders` | Search POs by status, supplier, date range |
| `get_purchase_order` | PO details -- line items, delivery dates, supplier info |
| `overdue_purchase_orders` | POs past expected delivery that aren't fully received |
| `create_purchase_order_draft` | Create a draft PO with products, quantities, and pricing |

### Returns (3 tools)

| Tool | Description |
|------|-------------|
| `list_returns` | Search returns by status, date, reason |
| `get_return` | Return details -- items, quantities, refund value, reason |
| `return_rate_report` | Return rates and most-returned products for a date range |

### Warehouse (4 tools)

| Tool | Description |
|------|-------------|
| `list_warehouses` | All warehouses with addresses, zones, and active status |
| `warehouse_utilization` | Active SKUs, units on hand, available vs reserved stock |
| `pending_receipts` | Inbound shipments expected at warehouses with overdue flags |
| `pick_list` | Consolidated pick list grouped by product and location |

### Operations (1 tool)

| Tool | Description |
|------|-------------|
| `daily_ops_briefing` | Morning ops summary: orders, fulfillment, shipments, low stock, exceptions |

---

## Quick Start

### Install

```bash
git clone https://github.com/ExpertVagabond/fulfil-mcp.git
cd fulfil-mcp
npm install
npm run build
```

### Configure Credentials

Set environment variables:

```bash
export FULFIL_API_KEY="your-fulfil-api-key"
export FULFIL_SUBDOMAIN="your-tenant-subdomain"
```

Or use credential files:

```bash
mkdir -p ~/.fulfil-mcp
echo "your-fulfil-api-key" > ~/.fulfil-mcp/api-key
echo "your-tenant-subdomain" > ~/.fulfil-mcp/subdomain
chmod 600 ~/.fulfil-mcp/*
```

### Run

```bash
# Direct
FULFIL_API_KEY=xxx FULFIL_SUBDOMAIN=yyy node dist/index.js

# Via wrapper (reads from env or credential files)
./fulfil-mcp-wrapper.sh
```

---

## Claude Desktop Configuration

Add to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "fulfil": {
      "command": "node",
      "args": ["/path/to/fulfil-mcp/dist/index.js"],
      "env": {
        "FULFIL_API_KEY": "your-api-key",
        "FULFIL_SUBDOMAIN": "your-tenant"
      }
    }
  }
}
```

## Claude Code Configuration

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "fulfil": {
      "command": "/path/to/fulfil-mcp/fulfil-mcp-wrapper.sh",
      "env": {
        "FULFIL_API_KEY": "your-api-key",
        "FULFIL_SUBDOMAIN": "your-tenant"
      }
    }
  }
}
```

---

## Usage Examples

Once connected, ask Claude natural-language questions and it will call the appropriate tools:

**Inventory**
> "Which products are below 10 units in stock?"
> "Show me the stock breakdown for product 4521 across all warehouses."

**Orders**
> "List all orders from the last 7 days that haven't shipped yet."
> "Get the full details for order 18923."

**Operations**
> "Give me the daily ops briefing."
> "Are there any shipment exceptions I should know about?"

**Purchasing**
> "Show overdue purchase orders from our suppliers."
> "Create a draft PO for supplier 312 with 500 units of product 891."

**Analytics**
> "What were our top 10 products by revenue last month?"
> "Generate a sales summary for Q4 2025."

**Returns**
> "What's our return rate for the past 90 days?"
> "Which products have the highest return rates?"

**Warehouse**
> "List all warehouses and their utilization."
> "Generate a pick list for the main warehouse."

---

## Architecture

```
src/
  index.ts              MCP server setup + 29 tool registrations
  api.ts                Fulfil.io REST client (retries, rate-limits, backoff)
  tools/
    inventory.ts        Product search, stock levels, low stock alerts
    orders.ts           Sales orders, fulfillment status, delayed orders
    shipments.ts        Outbound shipments, exceptions
    customers.ts        Customer search, order history
    analytics.ts        Sales summaries, top products, valuations
    operations.ts       Daily ops briefing
    purchasing.ts       Purchase orders, overdue POs, draft creation
    returns.ts          Returns, return rate reports
    warehouse.ts        Warehouse listing, utilization, receipts, pick lists
```

### API Client

The `FulfilClient` class handles all communication with the Fulfil.io REST API v2:

- **Automatic retries** with exponential backoff on 5xx errors and network failures
- **Rate-limit handling** with `Retry-After` header support
- **Tryton-style domain filters** for flexible record queries
- **Singleton pattern** -- one client instance per server lifecycle

### Fulfil.io API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/model/{model}` | `PUT` | Search records with domain filters |
| `/model/{model}/{id}` | `GET` | Read a single record by ID |
| `/model/{model}/read` | `POST` | Read multiple records by ID array |

Key models: `product.product`, `product.template`, `sale.sale`, `sale.line`, `stock.shipment.out`, `stock.shipment.in`, `stock.move`, `stock.location`, `party.party`, `purchase.purchase`, `purchase.line`

---

## Development

```bash
# Watch mode (recompile on change)
npm run dev

# Build
npm run build

# Run
npm start
```

### Requirements

- Node.js >= 18
- TypeScript 5.3+
- A Fulfil.io account with API access

---

## Contributing

Contributions are welcome. To add a new tool:

1. Create or extend a file in `src/tools/` with the tool implementation
2. Export the handler function from that file
3. Register the tool in `src/index.ts` with a Zod schema and description
4. Run `npm run build` to verify compilation
5. Open a pull request

Please keep tool descriptions clear and specific -- they serve as documentation for both humans and AI models.

---

## License

[MIT](LICENSE)
