import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Services } from "../src/services";

// These requests stop at CORS/authentication, so they do not need a chain or database.
const services = {} as Services;
const origin = "http://127.0.0.1:8081";
const preflight = (from: string) => ({
  method: "OPTIONS",
  headers: {
    Origin: from,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,content-type",
  },
});

describe("configured browser origins", () => {
  it("allows the selected preview to preflight authenticated JSON requests without cookies", async () => {
    const app = createApp(services, { corsOrigins: `${origin}, http://localhost:8081` });
    const response = await app.request("/v1/actions", preflight(origin));
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Headers")?.toLowerCase().split(",")).toEqual(["authorization", "content-type"]);
    expect(response.headers.get("Access-Control-Allow-Methods")?.split(",")).toEqual(["GET", "POST", "OPTIONS"]);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(response.headers.get("Vary")).toContain("Origin");
    expect((await app.request("/v1/actions", preflight("http://localhost:8081"))).headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:8081");
  });

  it.each(["https://untrusted.example", "http://127.0.0.1:8082", "http://127.0.0.1:8081.evil.example", "null"])("does not authorize an unlisted origin: %s", async unlisted => {
    const app = createApp(services, { corsOrigins: origin });
    const response = await app.request("/v1/actions", preflight(unlisted));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("does not grant browser access when the origin list is empty", async () => {
    const app = createApp(services, { corsOrigins: "" });
    const response = await app.request("/v1/actions", preflight(origin));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("includes CORS on actual API errors without bypassing authentication", async () => {
    const app = createApp(services, { corsOrigins: origin });
    const response = await app.request("/v1/me", { headers: { Origin: origin } });
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it.each(["*", "null", `${origin}/`, `${origin}/path`, "https://*.example.com"])("rejects an origin configuration that is not an exact bare origin: %s", invalid => {
    expect(() => createApp(services, { corsOrigins: invalid })).toThrow("CORS_ORIGINS");
  });
});
