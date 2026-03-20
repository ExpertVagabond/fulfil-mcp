/**
 * Fulfil.io REST API client
 *
 * Base URL: https://{subdomain}.fulfil.io/api/v2/
 * Auth: Bearer token
 * Domain filters use Tryton-style: [["field", "operator", "value"]]
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DomainFilter = [string, string, string | number | boolean | null | string[] | number[]];
export type Domain = DomainFilter[];

export interface SearchReadOptions {
  domain?: Domain;
  fields?: string[];
  offset?: number;
  limit?: number;
  order?: Array<[string, string]>;
}

export interface FulfilConfig {
  apiKey: string;
  subdomain: string;
  /** Max retries on transient failures (default 3) */
  maxRetries?: number;
  /** Base delay in ms between retries — doubled each attempt (default 1000) */
  retryDelay?: number;
}

export interface FulfilError {
  status: number;
  statusText: string;
  body: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Redact sensitive values (API keys) from error messages.
 */
function redactSensitive(message: string, apiKey: string): string {
  if (!apiKey) return message;
  return message.replace(new RegExp(apiKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "[REDACTED]");
}

/**
 * Validate a numeric resource ID.
 */
export function validateNumericId(id: number, label = "ID"): number {
  if (!Number.isFinite(id) || id < 0 || !Number.isInteger(id)) {
    throw new Error(`Invalid ${label}: must be a non-negative integer`);
  }
  return id;
}

export class FulfilClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly apiKey: string;

  constructor(config: FulfilConfig) {
    if (!config.apiKey) throw new Error("FULFIL_API_KEY is required");
    if (!config.subdomain) throw new Error("FULFIL_SUBDOMAIN is required");

    // Validate subdomain to prevent URL injection
    if (!/^[a-zA-Z0-9-]+$/.test(config.subdomain)) {
      throw new Error("FULFIL_SUBDOMAIN must contain only alphanumeric characters and hyphens");
    }

    this.apiKey = config.apiKey;
    this.baseUrl = `https://${config.subdomain}.fulfil.io/api/v2`;
    this.headers = {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelay = config.retryDelay ?? 1000;
  }

  // ---- low-level helpers ---------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          method,
          headers: this.headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (res.ok) {
          const text = await res.text();
          if (!text) return {} as T;
          return JSON.parse(text) as T;
        }

        // Transient server errors — retry
        if (res.status >= 500 && attempt < this.maxRetries) {
          lastError = new Error(
            `Fulfil API ${res.status}: ${res.statusText}`,
          );
          await this.sleep(this.retryDelay * Math.pow(2, attempt));
          continue;
        }

        // Rate-limited — retry with backoff
        if (res.status === 429 && attempt < this.maxRetries) {
          const retryAfter = res.headers.get("Retry-After");
          const delay = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : this.retryDelay * Math.pow(2, attempt);
          lastError = new Error("Fulfil API rate-limited (429)");
          await this.sleep(delay);
          continue;
        }

        // Non-retryable client error
        const errBody = await res.text();
        throw new Error(
          redactSensitive(
            `Fulfil API error ${res.status} ${res.statusText}: ${errBody}`,
            this.apiKey,
          ),
        );
      } catch (err: unknown) {
        if (err instanceof TypeError && attempt < this.maxRetries) {
          // Network error (DNS, connection refused, etc.)
          lastError = err;
          await this.sleep(this.retryDelay * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }
    }

    throw lastError ?? new Error("Fulfil API request failed after retries");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---- public API ----------------------------------------------------------

  /**
   * Search and read records from a Fulfil model.
   *
   * POST /api/v2/model/{model}/search_read
   */
  async searchRead<T = Record<string, unknown>>(
    model: string,
    options: SearchReadOptions = {},
  ): Promise<T[]> {
    const payload: Record<string, unknown> = {};
    if (options.domain && options.domain.length > 0) {
      payload.filters = options.domain;
    }
    if (options.fields && options.fields.length > 0) {
      payload.fields = options.fields;
    }
    if (options.offset !== undefined) {
      payload.offset = options.offset;
    }
    if (options.limit !== undefined) {
      payload.limit = options.limit;
    }
    if (options.order && options.order.length > 0) {
      payload.order = options.order;
    }

    return this.request<T[]>("PUT", `/model/${model}`, payload);
  }

  /**
   * Read a single record by ID.
   *
   * GET /api/v2/model/{model}/{id}
   */
  async read<T = Record<string, unknown>>(
    model: string,
    id: number,
    fields?: string[],
  ): Promise<T> {
    const params = fields && fields.length > 0
      ? `?fields=${fields.join(",")}`
      : "";
    return this.request<T>("GET", `/model/${model}/${id}${params}`);
  }

  /**
   * Count records matching a domain filter.
   */
  async count(model: string, domain: Domain = []): Promise<number> {
    const results = await this.searchRead(model, {
      domain,
      fields: ["id"],
      limit: 0,
    });
    return Array.isArray(results) ? results.length : 0;
  }

  /**
   * Read multiple records by IDs.
   *
   * POST /api/v2/model/{model}/read
   */
  async readMany<T = Record<string, unknown>>(
    model: string,
    ids: number[],
    fields?: string[],
  ): Promise<T[]> {
    if (ids.length === 0) return [];
    const payload: Record<string, unknown> = { ids };
    if (fields && fields.length > 0) {
      payload.fields = fields;
    }
    return this.request<T[]>("POST", `/model/${model}/read`, payload);
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _client: FulfilClient | undefined;

export function getClient(): FulfilClient {
  if (!_client) {
    const apiKey = process.env.FULFIL_API_KEY;
    const subdomain = process.env.FULFIL_SUBDOMAIN;
    if (!apiKey || !subdomain) {
      throw new Error(
        "Missing required environment variables: FULFIL_API_KEY and FULFIL_SUBDOMAIN",
      );
    }
    _client = new FulfilClient({ apiKey, subdomain });
  }
  return _client;
}
