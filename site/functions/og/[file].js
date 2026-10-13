import { proxyToApi } from "../_proxy.js";

// Link-preview images referenced by the API's share page (its PUBLIC_BASE_URL points here).
export async function onRequestGet(context) {
  return (await proxyToApi(context)) ?? new Response("Not found", { status: 404 });
}
