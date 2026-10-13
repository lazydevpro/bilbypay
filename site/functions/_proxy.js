// Shared by /c/* and /og/*: forward to the API's public routes when API_ORIGIN is configured.
// Returns undefined when there is no API (or it is unreachable) so the caller can serve a fallback.
export async function proxyToApi(context) {
  const origin = (context.env.API_ORIGIN ?? "").replace(/\/$/, "");
  if (!origin) return undefined;
  const url = new URL(context.request.url);
  try {
    const res = await fetch(origin + url.pathname + url.search, {
      method: "GET",
      headers: { Accept: context.request.headers.get("Accept") ?? "*/*" },
      redirect: "manual",
    });
    return res.status >= 500 ? undefined : res;
  } catch {
    return undefined;
  }
}
