# fulfil-mcp

MCP server for [Fulfil.io](https://fulfil.io) ERP — inventory, orders, shipments, customers, analytics, and daily operations.

Built for Claude Code integration. Connects to Fulfil.io's REST API v2 with automatic retries, rate-limit handling, and comprehensive error reporting.

## 18 Tools

| Category | Tool | Description |
|----------|------|-------------|
| **Inventory** | `list_products` | Search products by name, SKU, category |
| | `get_product` | Detailed product info by ID |
| | `check_inventory` | Stock levels + recent movements |
| | `low_stock_alert` | Products below threshold |
| | `inventory_by_location` | Stock breakdown by warehouse |
| **Orders** | `list_orders` | Search orders by status, customer, date |
| | `get_order` | Full order details with line items |
| | `order_status` | Shipment/fulfillment tracking |
| | `delayed_orders` | Orders not shipped within N days |
| | `recent_orders` | Latest N orders |
| **Shipments** | `list_shipments` | Search shipments by status, date, carrier |
| | `shipment_exceptions` | Overdue + exception shipments |
| **Customers** | `search_customers` | Find customers by name, email, phone |
| | `customer_order_history` | Customer's orders + lifetime spend |
| **Analytics** | `sales_summary` | Revenue, AOV, state breakdowns |
| | `top_products` | Best sellers by revenue |
| | `inventory_valuation` | Total inventory value |
| **Operations** | `daily_ops_briefing` | Full morning ops summary |

## Setup

### 1. Install and build

```bash
cd /Volumes/Virtual\ Server/projects/fulfil-mcp
npm install
npm run build
```

### 2. Configure credentials

Option A — Environment variables:
```bash
export FULFIL_API_KEY="your-api-key"
export FULFIL_SUBDOMAIN="your-tenant"
```

Option B — Vault files:
```bash
mkdir -p "/Volumes/Virtual Server/configs/credentials/fulfil"
echo "your-api-key" > "/Volumes/Virtual Server/configs/credentials/fulfil/api-key"
echo "your-tenant" > "/Volumes/Virtual Server/configs/credentials/fulfil/subdomain"
chmod 600 "/Volumes/Virtual Server/configs/credentials/fulfil/"*
```

### 3. Add to Claude Code MCP config

Add to `~/.mcp.json` (or the VS-mounted equivalent):

```json
{
  "mcpServers": {
    "fulfil": {
      "command": "/Volumes/Virtual Server/projects/fulfil-mcp/fulfil-mcp-wrapper.sh",
      "args": [],
      "env": {
        "FULFIL_API_KEY": "your-api-key",
        "FULFIL_SUBDOMAIN": "your-tenant"
      }
    }
  }
}
```

Or without env vars (uses vault files):

```json
{
  "mcpServers": {
    "fulfil": {
      "command": "/Volumes/Virtual Server/projects/fulfil-mcp/fulfil-mcp-wrapper.sh"
    }
  }
}
```

### 4. Test

```bash
# Direct run (requires env vars)
FULFIL_API_KEY=xxx FULFIL_SUBDOMAIN=yyy node dist/index.js

# Via wrapper
./fulfil-mcp-wrapper.sh
```

## Fulfil.io API Reference

- Base URL: `https://{subdomain}.fulfil.io/api/v2/`
- Auth: `Authorization: Bearer {api_key}`
- Search: `PUT /model/{model}` with JSON body containing `filters`, `fields`, `limit`, `offset`, `order`
- Read: `GET /model/{model}/{id}?fields=field1,field2`
- Domain filters use Tryton-style: `[["field", "operator", "value"]]`

### Key Models

| Model | Description |
|-------|-------------|
| `product.product` | Product variants |
| `product.template` | Product templates |
| `sale.sale` | Sales orders |
| `sale.line` | Sales order lines |
| `stock.shipment.out` | Outbound shipments |
| `stock.move` | Stock movements |
| `stock.location` | Warehouse locations |
| `party.party` | Customers/parties |

## Architecture

```
src/
  index.ts          # MCP server setup + tool registration
  api.ts            # Fulfil.io REST client (retries, rate-limits)
  tools/
    inventory.ts    # Product + stock tools
    orders.ts       # Sales order tools
    shipments.ts    # Shipment tools
    customers.ts    # Customer tools
    analytics.ts    # Sales + inventory analytics
    operations.ts   # Daily ops briefing
```

## License

MIT
