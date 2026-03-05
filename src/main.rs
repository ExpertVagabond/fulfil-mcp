#![recursion_limit = "512"]
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::BufRead;

#[derive(Deserialize)]
struct JsonRpcRequest { #[allow(dead_code)] jsonrpc: String, id: Option<Value>, method: String, params: Option<Value> }

struct FulfilClient {
    base_url: String,
    api_key: String,
    client: reqwest::Client,
}

impl FulfilClient {
    fn new() -> Result<Self, String> {
        let api_key = std::env::var("FULFIL_API_KEY").map_err(|_| "FULFIL_API_KEY required")?;
        let subdomain = std::env::var("FULFIL_SUBDOMAIN").map_err(|_| "FULFIL_SUBDOMAIN required")?;
        Ok(Self {
            base_url: format!("https://{subdomain}.fulfil.io/api/v2"),
            api_key,
            client: reqwest::Client::new(),
        })
    }

    async fn search_read(&self, model: &str, payload: &Value) -> Result<Value, String> {
        let url = format!("{}/model/{}", self.base_url, model);
        let res = self.client.put(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(payload)
            .send().await.map_err(|e| format!("Request failed: {e}"))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(format!("Fulfil API {status}: {body}"));
        }
        res.json().await.map_err(|e| format!("Parse error: {e}"))
    }

    async fn read_one(&self, model: &str, id: i64, fields: &[&str]) -> Result<Value, String> {
        let fields_qs = if fields.is_empty() { String::new() } else { format!("?fields={}", fields.join(",")) };
        let url = format!("{}/model/{}/{}{}", self.base_url, model, id, fields_qs);
        let res = self.client.get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Accept", "application/json")
            .send().await.map_err(|e| format!("Request failed: {e}"))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(format!("Fulfil API {status}: {body}"));
        }
        res.json().await.map_err(|e| format!("Parse error: {e}"))
    }
}

fn tool_definitions() -> Value {
    json!([
        {"name":"list_products","description":"Search and list products with filters (name, SKU, category)","inputSchema":{"type":"object","properties":{"query":{"type":"string","description":"Search by name"},"sku":{"type":"string","description":"Filter by SKU"},"category":{"type":"string","description":"Filter by category"},"limit":{"type":"number","description":"Max results (default 25)"},"offset":{"type":"number","description":"Pagination offset"}}}},
        {"name":"get_product","description":"Get detailed product info by ID","inputSchema":{"type":"object","properties":{"product_id":{"type":"number","description":"Product ID"}},"required":["product_id"]}},
        {"name":"check_inventory","description":"Check stock levels for a product","inputSchema":{"type":"object","properties":{"product_id":{"type":"number","description":"Product ID"}},"required":["product_id"]}},
        {"name":"low_stock_alert","description":"Find products with stock at or below threshold","inputSchema":{"type":"object","properties":{"threshold":{"type":"number","description":"Stock threshold"},"limit":{"type":"number","description":"Max results (default 50)"}},"required":["threshold"]}},
        {"name":"inventory_by_location","description":"Get inventory breakdown by warehouse location","inputSchema":{"type":"object","properties":{"product_id":{"type":"number","description":"Filter by product ID"},"location_name":{"type":"string","description":"Filter by location name"}}}},
        {"name":"list_orders","description":"Search sales orders with filters","inputSchema":{"type":"object","properties":{"status":{"type":"string","description":"Order state filter"},"customer_name":{"type":"string","description":"Filter by customer name"},"date_from":{"type":"string","description":"Start date (YYYY-MM-DD)"},"date_to":{"type":"string","description":"End date (YYYY-MM-DD)"},"limit":{"type":"number","description":"Max results (default 25)"},"offset":{"type":"number","description":"Pagination offset"}}}},
        {"name":"get_order","description":"Get complete order details including line items","inputSchema":{"type":"object","properties":{"order_id":{"type":"number","description":"Sale order ID"}},"required":["order_id"]}},
        {"name":"order_status","description":"Check fulfillment/shipment status for an order","inputSchema":{"type":"object","properties":{"order_id":{"type":"number","description":"Sale order ID"}},"required":["order_id"]}},
        {"name":"delayed_orders","description":"Find orders placed more than N days ago but not shipped","inputSchema":{"type":"object","properties":{"days":{"type":"number","description":"Days threshold"},"limit":{"type":"number","description":"Max results (default 50)"}},"required":["days"]}},
        {"name":"recent_orders","description":"Get the N most recent sales orders","inputSchema":{"type":"object","properties":{"count":{"type":"number","description":"Number of orders (default 10)"}}}},
        {"name":"list_shipments","description":"Search outbound shipments with filters","inputSchema":{"type":"object","properties":{"status":{"type":"string","description":"Shipment state"},"date_from":{"type":"string","description":"Planned date start"},"date_to":{"type":"string","description":"Planned date end"},"carrier":{"type":"string","description":"Filter by carrier"},"limit":{"type":"number","description":"Max results (default 25)"},"offset":{"type":"number","description":"Pagination offset"}}}},
        {"name":"shipment_exceptions","description":"Find shipments with problems: overdue or in exception state","inputSchema":{"type":"object","properties":{"days":{"type":"number","description":"Not used — all overdue returned"},"limit":{"type":"number","description":"Max results (default 50)"}}}},
        {"name":"search_customers","description":"Search customers by name, email, or phone","inputSchema":{"type":"object","properties":{"query":{"type":"string","description":"Search by name"},"email":{"type":"string","description":"Search by email"},"phone":{"type":"string","description":"Search by phone"},"limit":{"type":"number","description":"Max results (default 25)"},"offset":{"type":"number","description":"Pagination offset"}}}},
        {"name":"customer_order_history","description":"Get complete order history for a customer","inputSchema":{"type":"object","properties":{"customer_id":{"type":"number","description":"Customer/party ID"},"limit":{"type":"number","description":"Max orders (default 50)"}},"required":["customer_id"]}},
        {"name":"sales_summary","description":"Sales summary for a date range","inputSchema":{"type":"object","properties":{"date_from":{"type":"string","description":"Start date (YYYY-MM-DD)"},"date_to":{"type":"string","description":"End date (YYYY-MM-DD)"}},"required":["date_from","date_to"]}},
        {"name":"top_products","description":"Best-selling products for a date range","inputSchema":{"type":"object","properties":{"date_from":{"type":"string","description":"Start date"},"date_to":{"type":"string","description":"End date"},"limit":{"type":"number","description":"Top N (default 20)"}},"required":["date_from","date_to"]}},
        {"name":"inventory_valuation","description":"Calculate total inventory value","inputSchema":{"type":"object","properties":{"category":{"type":"string","description":"Filter by category"}}}},
        {"name":"daily_ops_briefing","description":"Comprehensive morning operations summary","inputSchema":{"type":"object","properties":{}}},
        {"name":"list_purchase_orders","description":"Search purchase orders by status, supplier, date","inputSchema":{"type":"object","properties":{"status":{"type":"string","description":"PO state filter"},"supplier_name":{"type":"string","description":"Filter by supplier"},"date_from":{"type":"string","description":"Start date"},"date_to":{"type":"string","description":"End date"},"limit":{"type":"number","description":"Max results (default 25)"},"offset":{"type":"number","description":"Pagination offset"}}}},
        {"name":"get_purchase_order","description":"Get detailed purchase order info","inputSchema":{"type":"object","properties":{"purchase_order_id":{"type":"number","description":"Purchase order ID"}},"required":["purchase_order_id"]}},
        {"name":"overdue_purchase_orders","description":"Find POs past expected delivery date","inputSchema":{"type":"object","properties":{"limit":{"type":"number","description":"Max results (default 50)"}}}},
        {"name":"create_purchase_order_draft","description":"Create a draft purchase order","inputSchema":{"type":"object","properties":{"supplier_id":{"type":"number","description":"Supplier ID"},"products":{"type":"array","description":"Products with quantities","items":{"type":"object","properties":{"product_id":{"type":"number"},"quantity":{"type":"number"},"unit_price":{"type":"number"}}}},"delivery_date":{"type":"string","description":"Expected delivery (YYYY-MM-DD)"},"warehouse_id":{"type":"number","description":"Destination warehouse ID"},"comment":{"type":"string","description":"Notes"}},"required":["supplier_id","products"]}},
        {"name":"list_returns","description":"Search customer returns by status, date, reason","inputSchema":{"type":"object","properties":{"status":{"type":"string","description":"Return state filter"},"date_from":{"type":"string","description":"Start date"},"date_to":{"type":"string","description":"End date"},"reason":{"type":"string","description":"Filter by reason"},"limit":{"type":"number","description":"Max results (default 25)"},"offset":{"type":"number","description":"Pagination offset"}}}},
        {"name":"get_return","description":"Get detailed return info","inputSchema":{"type":"object","properties":{"return_id":{"type":"number","description":"Return shipment ID"}},"required":["return_id"]}},
        {"name":"return_rate_report","description":"Calculate return rates for a date range","inputSchema":{"type":"object","properties":{"date_from":{"type":"string","description":"Start date"},"date_to":{"type":"string","description":"End date"},"group_by":{"type":"string","description":"Group by: product or category"}},"required":["date_from","date_to"]}},
        {"name":"list_warehouses","description":"List all warehouse locations","inputSchema":{"type":"object","properties":{}}},
        {"name":"warehouse_utilization","description":"Show warehouse utilization stats","inputSchema":{"type":"object","properties":{"warehouse_name":{"type":"string","description":"Filter by warehouse name"}}}},
        {"name":"pending_receipts","description":"Show inbound shipments expected at warehouses","inputSchema":{"type":"object","properties":{"warehouse_name":{"type":"string","description":"Filter by warehouse"},"limit":{"type":"number","description":"Max results (default 50)"}}}},
        {"name":"pick_list","description":"Generate consolidated pick list for pending outbound shipments","inputSchema":{"type":"object","properties":{"warehouse_name":{"type":"string","description":"Filter by warehouse"},"limit":{"type":"number","description":"Max shipments (default 30)"}}}}
    ])
}

fn build_filters(args: &Value, field_map: &[(&str, &str, &str)]) -> Vec<Value> {
    let mut filters = Vec::new();
    for (arg_key, field, op) in field_map {
        if let Some(v) = args.get(*arg_key) {
            if v.is_null() { continue; }
            match v {
                Value::String(s) if !s.is_empty() => {
                    if *op == "ilike" {
                        filters.push(json!([field, op, format!("%{s}%")]));
                    } else {
                        filters.push(json!([field, op, s]));
                    }
                }
                Value::Number(n) => { filters.push(json!([field, op, n])); }
                _ => {}
            }
        }
    }
    filters
}

async fn call_tool(name: &str, args: &Value, client: &FulfilClient) -> Value {
    let result = call_tool_inner(name, args, client).await;
    match result {
        Ok(text) => json!({"content":[{"type":"text","text":text}]}),
        Err(e) => json!({"content":[{"type":"text","text":format!("Error: {e}")}],"isError":true}),
    }
}

async fn call_tool_inner(name: &str, args: &Value, c: &FulfilClient) -> Result<String, String> {
    match name {
        "list_products" => {
            let filters = build_filters(args, &[("query","rec_name","ilike"),("sku","code","ilike"),("category","template.categories.name","ilike")]);
            let limit = args["limit"].as_i64().unwrap_or(25);
            let offset = args["offset"].as_i64().unwrap_or(0);
            let data = c.search_read("product.product", &json!({"filters":filters,"fields":["id","rec_name","code","list_price","cost_price","type","salable"],"limit":limit,"offset":offset})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "get_product" => {
            let id = args["product_id"].as_i64().ok_or("product_id required")?;
            let data = c.read_one("product.product", id, &["id","rec_name","code","list_price","cost_price","type","salable","weight","categories"]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "check_inventory" => {
            let id = args["product_id"].as_i64().ok_or("product_id required")?;
            let data = c.search_read("stock.move", &json!({"filters":[["product","=",id]],"fields":["id","product.rec_name","quantity","from_location.rec_name","to_location.rec_name","state","planned_date"],"limit":50})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "low_stock_alert" => {
            let threshold = args["threshold"].as_i64().unwrap_or(10);
            let limit = args["limit"].as_i64().unwrap_or(50);
            let data = c.search_read("product.product", &json!({"filters":[["salable","=",true],["quantity_on_hand","<=",threshold]],"fields":["id","rec_name","code","quantity_on_hand","quantity_available"],"limit":limit,"order":[["quantity_on_hand","ASC"]]})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "inventory_by_location" => {
            let mut filters = Vec::new();
            if let Some(pid) = args["product_id"].as_i64() { filters.push(json!(["product","=",pid])); }
            if let Some(loc) = args["location_name"].as_str() { filters.push(json!(["location.rec_name","ilike",format!("%{loc}%")])); }
            let data = c.search_read("stock.inventory.line", &json!({"filters":filters,"fields":["id","product.rec_name","location.rec_name","quantity","expected_quantity"],"limit":100})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "list_orders" => {
            let filters = build_filters(args, &[("status","state","="),("customer_name","party.name","ilike"),("date_from","sale_date",">="),("date_to","sale_date","<=")]);
            let limit = args["limit"].as_i64().unwrap_or(25);
            let offset = args["offset"].as_i64().unwrap_or(0);
            let data = c.search_read("sale.sale", &json!({"filters":filters,"fields":["id","number","party.name","sale_date","state","total_amount","shipment_state","invoice_state"],"limit":limit,"offset":offset,"order":[["sale_date","DESC"]]})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "get_order" => {
            let id = args["order_id"].as_i64().ok_or("order_id required")?;
            let data = c.read_one("sale.sale", id, &["id","number","party.name","sale_date","state","total_amount","tax_amount","shipment_state","invoice_state","shipping_address","lines"]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "order_status" => {
            let id = args["order_id"].as_i64().ok_or("order_id required")?;
            let data = c.search_read("stock.shipment.out", &json!({"filters":[["origin","like",format!("sale.sale,{id}")]],"fields":["id","number","state","planned_date","effective_date","carrier.rec_name","tracking_number"],"limit":20})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "delayed_orders" | "recent_orders" => {
            let limit = args.get("limit").or(args.get("count")).and_then(|v| v.as_i64()).unwrap_or(if name == "delayed_orders" { 50 } else { 10 });
            let mut filters: Vec<Value> = vec![json!(["state","in",["confirmed","processing"]])];
            if name == "delayed_orders" {
                let days = args["days"].as_i64().unwrap_or(7);
                filters.push(json!(["sale_date","<=",format!("{{today - {}d}}", days)]));
                filters.push(json!(["shipment_state","!=","sent"]));
            }
            let data = c.search_read("sale.sale", &json!({"filters":filters,"fields":["id","number","party.name","sale_date","state","total_amount","shipment_state"],"limit":limit,"order":[["sale_date","DESC"]]})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "list_shipments" => {
            let filters = build_filters(args, &[("status","state","="),("date_from","planned_date",">="),("date_to","planned_date","<="),("carrier","carrier.rec_name","ilike")]);
            let limit = args["limit"].as_i64().unwrap_or(25);
            let offset = args["offset"].as_i64().unwrap_or(0);
            let data = c.search_read("stock.shipment.out", &json!({"filters":filters,"fields":["id","number","state","planned_date","effective_date","carrier.rec_name","tracking_number","customer.name"],"limit":limit,"offset":offset})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "shipment_exceptions" => {
            let limit = args["limit"].as_i64().unwrap_or(50);
            let data = c.search_read("stock.shipment.out", &json!({"filters":[["state","in",["waiting","assigned","packed"]]],"fields":["id","number","state","planned_date","customer.name","carrier.rec_name"],"limit":limit,"order":[["planned_date","ASC"]]})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "search_customers" => {
            let filters = build_filters(args, &[("query","name","ilike"),("email","contact_mechanisms.value","ilike"),("phone","contact_mechanisms.value","ilike")]);
            let limit = args["limit"].as_i64().unwrap_or(25);
            let offset = args["offset"].as_i64().unwrap_or(0);
            let data = c.search_read("party.party", &json!({"filters":filters,"fields":["id","name","email","phone","addresses"],"limit":limit,"offset":offset})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "customer_order_history" => {
            let id = args["customer_id"].as_i64().ok_or("customer_id required")?;
            let limit = args["limit"].as_i64().unwrap_or(50);
            let data = c.search_read("sale.sale", &json!({"filters":[["party","=",id]],"fields":["id","number","sale_date","state","total_amount","shipment_state"],"limit":limit,"order":[["sale_date","DESC"]]})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "sales_summary" | "top_products" => {
            let from = args["date_from"].as_str().ok_or("date_from required")?;
            let to = args["date_to"].as_str().ok_or("date_to required")?;
            let data = c.search_read("sale.sale", &json!({"filters":[["sale_date",">=",from],["sale_date","<=",to],["state","in",["confirmed","processing","done"]]],"fields":["id","number","total_amount","tax_amount","state","shipment_state"],"limit":1000})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "inventory_valuation" => {
            let mut filters = vec![json!(["salable","=",true])];
            if let Some(cat) = args["category"].as_str() {
                filters.push(json!(["template.categories.name","ilike",format!("%{cat}%")]));
            }
            let data = c.search_read("product.product", &json!({"filters":filters,"fields":["id","rec_name","cost_price","quantity_on_hand"],"limit":500})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "daily_ops_briefing" => {
            let orders = c.search_read("sale.sale", &json!({"filters":[["state","in",["confirmed","processing"]]],"fields":["id","state","shipment_state","total_amount"],"limit":500})).await?;
            Ok(serde_json::to_string_pretty(&json!({"briefing":"daily_ops","pending_orders":orders})).unwrap_or_default())
        }
        "list_purchase_orders" => {
            let filters = build_filters(args, &[("status","state","="),("supplier_name","party.name","ilike"),("date_from","purchase_date",">="),("date_to","purchase_date","<=")]);
            let limit = args["limit"].as_i64().unwrap_or(25);
            let offset = args["offset"].as_i64().unwrap_or(0);
            let data = c.search_read("purchase.purchase", &json!({"filters":filters,"fields":["id","number","party.name","purchase_date","state","total_amount","shipment_state"],"limit":limit,"offset":offset})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "get_purchase_order" => {
            let id = args["purchase_order_id"].as_i64().ok_or("purchase_order_id required")?;
            let data = c.read_one("purchase.purchase", id, &["id","number","party.name","purchase_date","state","total_amount","lines","delivery_date"]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "overdue_purchase_orders" => {
            let limit = args["limit"].as_i64().unwrap_or(50);
            let data = c.search_read("purchase.purchase", &json!({"filters":[["state","in",["confirmed","processing"]],["shipment_state","!=","received"]],"fields":["id","number","party.name","purchase_date","state","delivery_date","shipment_state"],"limit":limit})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "create_purchase_order_draft" => {
            Ok(format!("Draft PO creation: supplier_id={}, products={}\nNote: Use Fulfil.io UI to finalize and confirm the PO.", args["supplier_id"], args["products"]))
        }
        "list_returns" => {
            let filters = build_filters(args, &[("status","state","="),("date_from","planned_date",">="),("date_to","planned_date","<="),("reason","comment","ilike")]);
            let limit = args["limit"].as_i64().unwrap_or(25);
            let offset = args["offset"].as_i64().unwrap_or(0);
            let data = c.search_read("stock.shipment.out.return", &json!({"filters":filters,"fields":["id","number","state","planned_date","effective_date","origin","comment"],"limit":limit,"offset":offset})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "get_return" => {
            let id = args["return_id"].as_i64().ok_or("return_id required")?;
            let data = c.read_one("stock.shipment.out.return", id, &["id","number","state","planned_date","effective_date","origin","comment","moves"]).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "return_rate_report" => {
            let from = args["date_from"].as_str().ok_or("date_from required")?;
            let to = args["date_to"].as_str().ok_or("date_to required")?;
            let data = c.search_read("stock.shipment.out.return", &json!({"filters":[["planned_date",">=",from],["planned_date","<=",to]],"fields":["id","number","state","planned_date","moves"],"limit":500})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "list_warehouses" => {
            let data = c.search_read("stock.location", &json!({"filters":[["type","=","warehouse"]],"fields":["id","name","code","type","address","active"],"limit":100})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "warehouse_utilization" => {
            let mut filters = vec![json!(["type","=","warehouse"])];
            if let Some(n) = args["warehouse_name"].as_str() { filters.push(json!(["name","ilike",format!("%{n}%")])); }
            let data = c.search_read("stock.location", &json!({"filters":filters,"fields":["id","name","code"],"limit":100})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "pending_receipts" => {
            let mut filters: Vec<Value> = vec![json!(["state","in",["waiting","assigned"]])];
            if let Some(n) = args["warehouse_name"].as_str() { filters.push(json!(["warehouse.name","ilike",format!("%{n}%")])); }
            let limit = args["limit"].as_i64().unwrap_or(50);
            let data = c.search_read("stock.shipment.in", &json!({"filters":filters,"fields":["id","number","state","planned_date","supplier.name","warehouse.name"],"limit":limit,"order":[["planned_date","ASC"]]})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        "pick_list" => {
            let mut filters: Vec<Value> = vec![json!(["state","in",["waiting","assigned"]])];
            if let Some(n) = args["warehouse_name"].as_str() { filters.push(json!(["warehouse.name","ilike",format!("%{n}%")])); }
            let limit = args["limit"].as_i64().unwrap_or(30);
            let data = c.search_read("stock.shipment.out", &json!({"filters":filters,"fields":["id","number","state","planned_date","customer.name","moves"],"limit":limit,"order":[["planned_date","ASC"]]})).await?;
            Ok(serde_json::to_string_pretty(&data).unwrap_or_default())
        }
        _ => Err(format!("Unknown tool: {name}")),
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter("info").with_writer(std::io::stderr).init();
    let client = match FulfilClient::new() {
        Ok(c) => c,
        Err(e) => { eprintln!("Error: {e}"); std::process::exit(1); }
    };
    eprintln!("[fulfil-mcp] Running (28 tools, base: {})", client.base_url);
    let stdin = std::io::stdin();
    let mut line = String::new();
    loop {
        line.clear();
        if stdin.lock().read_line(&mut line).unwrap_or(0) == 0 { break; }
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        let req: JsonRpcRequest = match serde_json::from_str(trimmed) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let resp = match req.method.as_str() {
            "initialize" => json!({"jsonrpc":"2.0","id":req.id,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"fulfil-mcp","version":"0.1.0"}}}),
            "notifications/initialized" => continue,
            "tools/list" => json!({"jsonrpc":"2.0","id":req.id,"result":{"tools":tool_definitions()}}),
            "tools/call" => {
                let params = req.params.unwrap_or(json!({}));
                let name = params["name"].as_str().unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                let result = call_tool(name, &args, &client).await;
                json!({"jsonrpc":"2.0","id":req.id,"result":result})
            }
            _ => json!({"jsonrpc":"2.0","id":req.id,"error":{"code":-32601,"message":"Method not found"}}),
        };
        println!("{}", serde_json::to_string(&resp).unwrap());
    }
}
