/**
 * Paradise Surfside - Weather Proxy (Tempest/WeatherFlow)
 * - Keeps TEMPEST_TOKEN private (stored as a Worker secret)
 * - Returns a tiny JSON payload your landing page can safely fetch
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Only serve the one endpoint
    if (url.pathname !== "/api/weather") {
      return new Response("Not found", { status: 404 });
    }

    // CORS: allow your GitHub Pages domain (and your custom domain if you use one)
    const allowedOrigins = new Set([
      "https://davidleetaylor07.github.io",          // change to your actual GH pages origin if different
      "https://paradisesurfsidesc.com",              // your custom domain
      "https://www.paradisesurfsidesc.com"
    ]);

    const origin = request.headers.get("Origin") || "";
    const corsOrigin = allowedOrigins.has(origin) ? origin : "";

    // Handle preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(corsOrigin),
      });
    }

    // ---- Config (store token in Worker secrets) ----
    // IMPORTANT: do NOT hardcode the token here.
    const stationId = env.TEMPEST_STATION_ID || "204460";
    const token = env.TEMPEST_TOKEN; // wrangler secret put TEMPEST_TOKEN

    if (!token) {
      return json(
        { ok: false, error: "Missing TEMPEST_TOKEN" },
        500,
        corsOrigin
      );
    }

    // Use Tempest/WeatherFlow "better_forecast" (includes current_conditions)
    // Docs reference this endpoint and unit params. :contentReference[oaicite:0]{index=0}
    const upstream = new URL("https://swd.weatherflow.com/swd/rest/better_forecast");
    upstream.searchParams.set("station_id", stationId);
    upstream.searchParams.set("units_temp", "f");
    upstream.searchParams.set("units_wind", "mph");
    upstream.searchParams.set("units_pressure", "inhg");
    upstream.searchParams.set("units_precip", "in");
    upstream.searchParams.set("units_distance", "mi");
    upstream.searchParams.set("token", token);

    // Cache briefly at the edge (keeps it snappy and reduces API calls)
    const cacheKey = new Request(upstream.toString(), { method: "GET" });
    const cache = caches.default;

    let resp = await cache.match(cacheKey);
    if (!resp) {
      resp = await fetch(cacheKey, {
        headers: { "Accept": "application/json" },
      });

      // Cache successful responses for 60s
      if (resp.ok) {
        ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      }
    }

    if (!resp.ok) {
      return json(
        { ok: false, error: `Upstream HTTP ${resp.status}` },
        502,
        corsOrigin
      );
    }

    const data = await resp.json();

    // Shape a small, stable payload for your UI
    const cc = data?.current_conditions || {};
    const tempF = Number(cc?.air_temperature);
    const conditions = (cc?.conditions || "").toString().trim();
    const ts = Number(cc?.time || 0); // epoch seconds in many Tempest responses

    // Basic icon mapping (you can tune this later)
    const icon = pickIcon(conditions);

    const payload = {
      ok: true,
      station_id: Number(stationId),
      temp_f: Number.isFinite(tempF) ? tempF : null,
      condition: conditions || null,
      icon,
      updated_iso: ts ? new Date(ts * 1000).toISOString() : null,
      source: "tempest_station",
      label: "Current Weather · At the House",
    };

    return json(payload, 200, corsOrigin);
  }
};

function corsHeaders(origin) {
  const h = new Headers();
  if (origin) h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type");
  h.set("Access-Control-Max-Age", "86400");
  return h;
}

function json(obj, status, origin) {
  const h = corsHeaders(origin);
  h.set("Content-Type", "application/json; charset=utf-8");
  // prevent stale browser caches
  h.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(obj), { status, headers: h });
}

function pickIcon(conditions) {
  const c = (conditions || "").toLowerCase();
  if (c.includes("thunder")) return "⛈️";
  if (c.includes("snow")) return "❄️";
  if (c.includes("rain") || c.includes("drizzle")) return "🌧️";
  if (c.includes("fog") || c.includes("mist")) return "🌫️";
  if (c.includes("cloud")) return "⛅";
  if (c.includes("clear") || c.includes("sun")) return "☀️";
  return "⛅";
}
