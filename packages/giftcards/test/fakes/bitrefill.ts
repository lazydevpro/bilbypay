/**
 * In-process fake of the Bitrefill v2 endpoints we use. Shapes follow the research notes
 * (docs.bitrefill.com, 2026-09-25) and Bitrefill's own MCP server types; see src/bitrefill.ts.
 * Test-product behaviour mirrors docs/test-products: `*-fail` products fail after payment.
 */
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Invoice = { id: string; status: string; payment: { status: string; price?: number }; orders: { id: string; status: string; product_id: string; value: number }[]; body: any; polls: number };

export class FakeBitrefill {
  readonly log: { method: string; path: string; auth?: string; body?: any }[] = [];
  readonly invoices = new Map<string, Invoice>();
  balanceUsd = 100;
  pays = 0;
  /** Number of GET /invoices polls before an order is delivered. */
  deliveryPolls = 0;
  /** Throw the next /pay response away AFTER applying it. */
  dropPayResponse = 0;

  products = [
    { id: "starbucks-usa", name: "Starbucks USA", country_code: "US", currency: "USD", categories: ["food", "restaurants"], recipient_type: "none", image: "https://cdn.test/starbucks.png", in_stock: true, packages: [{ id: "starbucks-usa<&>5", value: "5", price: 5.03 }, { id: "starbucks-usa<&>10", value: "10", price: 10 }], range: { min: 5, max: 500, step: 0.01, price_rate: 1 } },
    { id: "netflix-usa", name: "Netflix USA", country_code: "US", currency: "USD", categories: ["streaming"], recipient_type: "none", image: "https://cdn.test/netflix.png", in_stock: true, packages: [{ id: "netflix-usa<&>25", value: "25", price: 25.5 }, { id: "netflix-usa<&>50", value: "50", price: 51 }] },
    { id: "uber-eur", name: "Uber EUR", country_code: "US", currency: "EUR", categories: ["travel"], recipient_type: "none", in_stock: true, packages: [{ id: "x", value: "25" }] },
    { id: "att-refill", name: "AT&T", country_code: "US", currency: "USD", categories: ["refill"], recipient_type: "phone_number", in_stock: true, range: { min: 5, max: 100, step: 1 } },
    { id: "test-gift-card-code", name: "Test gift card (code)", country_code: "XX", currency: "USD", categories: ["test"], recipient_type: "none", in_stock: true, packages: [{ id: "test-gift-card-code<&>1", value: "1" }, { id: "test-gift-card-code<&>5", value: "5" }] },
    { id: "test-gift-card-code-fail", name: "Test gift card (fail)", country_code: "XX", currency: "USD", categories: ["test"], recipient_type: "none", in_stock: true, packages: [{ id: "test-gift-card-code-fail<&>5", value: "5" }] },
  ];

  fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization") ?? undefined;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.log.push({ method, path: url.pathname + url.search, auth, body });
    if (!auth) return json(401, { message: "Unauthorized" });
    const path = url.pathname.replace(/^\/v2/, "");

    if (method === "GET" && path === "/products") {
      const includeTest = url.searchParams.get("include_test_products") === "true";
      const start = Number(url.searchParams.get("start") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const all = this.products.filter((p) => includeTest || !p.id.startsWith("test-"));
      // Tiny pages to exercise pagination.
      const page = all.slice(start, start + Math.min(limit, 50));
      return json(200, { meta: { _endpoint: "/products", start, limit, _next: start + limit < all.length ? `/products?start=${start + limit}` : undefined }, data: page });
    }
    let m = /^\/products\/([^/]+)$/.exec(path);
    if (method === "GET" && m) {
      const p = this.products.find((x) => x.id === decodeURIComponent(m![1]!));
      return p ? json(200, { meta: {}, data: p }) : json(404, { message: "Product not found" });
    }
    if (method === "POST" && path === "/invoices") {
      const line = body.products[0];
      const p = this.products.find((x) => x.id === line.product_id);
      if (!p) return json(404, { message: "Product not found" });
      const id = `inv_${this.invoices.size + 1}`;
      const inv: Invoice = { id, status: "unpaid", payment: { status: "unpaid", price: line.value }, orders: [{ id: `ord_${this.invoices.size + 1}`, status: "created", product_id: p.id, value: line.value }], body, polls: 0 };
      this.invoices.set(id, inv);
      if (body.auto_pay) this.pay(inv);
      return json(200, { meta: {}, data: this.view(inv) });
    }
    m = /^\/invoices\/([^/]+)\/pay$/.exec(path);
    if (method === "POST" && m) {
      const inv = this.invoices.get(m[1]!);
      if (!inv) return json(404, { message: "Invoice not found" });
      if (inv.payment.status !== "unpaid") return json(400, { message: "Invoice already paid" });
      if (inv.orders[0]!.value > this.balanceUsd) return json(400, { message: "Insufficient balance", error_code: "insufficient_balance" });
      this.pay(inv);
      if (this.dropPayResponse) {
        this.dropPayResponse--;
        throw new TypeError("fetch failed (pay response dropped)");
      }
      return json(200, { meta: {}, data: this.view(inv) });
    }
    m = /^\/invoices\/([^/]+)$/.exec(path);
    if (method === "GET" && m) {
      const inv = this.invoices.get(m[1]!);
      if (!inv) return json(404, { message: "Invoice not found" });
      inv.polls++;
      this.deliver(inv);
      return json(200, { meta: {}, data: this.view(inv) });
    }
    m = /^\/orders\/([^/]+)$/.exec(path);
    if (method === "GET" && m) {
      const inv = [...this.invoices.values()].find((i) => i.orders[0]!.id === m![1]);
      if (!inv) return json(404, { message: "Order not found" });
      const o = inv.orders[0]!;
      return json(200, {
        meta: {},
        data: {
          id: o.id,
          status: o.status,
          product: { id: o.product_id },
          ...(o.status === "delivered"
            ? { redemption_info: { code: `BR-${o.id}-CODE`, pin: "9876", link: null, barcode_format: "CODE128", barcode_value: "123456789012", instructions: "Show at the till", expiration_date: null } }
            : {}),
        },
      });
    }
    if (method === "GET" && path === "/accounts/balance") return json(200, { meta: {}, data: { balance: this.balanceUsd, currency: "USD" } });
    return json(404, { message: `no route ${method} ${path}` });
  };

  private pay(inv: Invoice) {
    this.pays++;
    this.balanceUsd -= inv.orders[0]!.value;
    inv.payment.status = "complete";
    inv.status = "complete";
    inv.orders[0]!.status = "pending";
    this.deliver(inv);
  }

  private deliver(inv: Invoice) {
    const o = inv.orders[0]!;
    if (o.status !== "pending" || inv.polls < this.deliveryPolls) return;
    o.status = o.product_id.endsWith("-fail") ? "failed" : "delivered";
    if (o.status === "failed") this.balanceUsd += o.value; // test products refund
  }

  private view(inv: Invoice) {
    return { id: inv.id, status: inv.status, payment: inv.payment, orders: inv.orders.map((o) => ({ id: o.id, status: o.status, product: { id: o.product_id } })) };
  }
}
