/**
 * Paradise Worker (Cloudflare)
 * - /api/events?days=30  -> returns events from Surfside Town Events iCal feed as JSON
 * - /go/<slug>           -> logs + redirects (server-side truth)
 *
 * Configure env vars:
 *   ICS_URL   = https://www.surfsidebeach.org/common/modules/iCalendar/iCalendar.aspx?catID=29&feed=calendar
 *   LOG_KEY   = (optional) secret for your log endpoint, if you add one later
 *
 * Optional enhancements (later):
 * - Write logs to KV/D1/R2
 * - Send events to GA4 Measurement Protocol
 */

const REDIRECTS = {
  // Events
  "surfside-town-events": {
    url: "https://www.surfsidebeach.org/calendar.aspx?CID=29",
    category: "events",
    label: "Surfside Town Events (Full Calendar)"
  },
  "vmb-events": {
    url: "https://www.visitmyrtlebeach.com/events-calendar",
    category: "events",
    label: "Visit Myrtle Beach Events Calendar"
  },

  // Booking hub (replace later with your booking options page)
  "stay": {
    url: "https://www.southerncoastvacations.com/myrtle-beach-vacation-rentals/paradise",
    category: "booking",
    label: "Paradise Booking (Southern Coast Vacations)"
  }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname.startsWith("/api/events")) {
      return handleEvents(url, env);
    }

    if (url.pathname.startsWith("/go/")) {
      return handleGo(url, request, env, ctx);
    }

    return new Response("Not Found", { status: 404 });
  }
};

async function handleEvents(url, env) {
  const days = Math.min(parseInt(url.searchParams.get("days") || "30", 10), 90);
  const icsUrl = env.ICS_URL;
  if (!icsUrl) {
    return json({ error: "Missing ICS_URL env var" }, 500);
  }

  // Cache for 1 hour at the edge
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  const res = await fetch(icsUrl, { headers: { "User-Agent": "ParadiseEventsBot/1.0" } });
  if (!res.ok) return json({ error: "Failed to fetch ICS" }, 502);

  const text = await res.text();
  const events = parseICS(text);

  const now = new Date();
  const endWindow = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const filtered = events
    .filter(e => e.start && e.start >= now && e.start <= endWindow)
    .sort((a, b) => a.start - b.start)
    .slice(0, 150)
    .map(e => ({
      title: e.title,
      location: e.location || "",
      url: e.url || "",
      start: e.start ? e.start.toISOString() : null,
      end: e.end ? e.end.toISOString() : null
    }));

  const body = JSON.stringify({ updatedAt: new Date().toISOString(), source: "Town of Surfside Beach (Events)", events: filtered });

  const out = new Response(body, {
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600"
    }
  });

  ctxWait(cache.put(cacheKey, out.clone()));
  return out;
}

function ctxWait(promise) {
  // no-op wrapper; Cloudflare provides ctx in fetch handler
  return promise;
}

async function handleGo(url, request, env, ctx) {
  const slug = url.pathname.replace(/^\/go\//, "").replace(/\/+$/, "");
  const target = REDIRECTS[slug];
  if (!target) return new Response("Link not found", { status: 404 });

  // Server-side truth log (currently returns in response headers only).
  // Later: send to KV/D1 or GA4 Measurement Protocol.
  const log = {
    slug,
    category: target.category,
    label: target.label,
    referrer: request.headers.get("referer") || "direct",
    ua: request.headers.get("user-agent") || "",
    ts: new Date().toISOString()
  };
  // If you later add storage, do it via ctx.waitUntil(...)
  // ctx.waitUntil(saveLog(log, env))

  const res = Response.redirect(target.url, 302);
  res.headers.set("X-Paradise-Click", `${log.category}:${log.slug}`);
  return res;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" }
  });
}

function parseICS(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  // Unfold folded lines (RFC5545)
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.trimStart();
    else unfolded.push(line);
  }

  const events = [];
  let cur = null;

  for (const line of unfolded) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur) events.push(normalizeEvent(cur));
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(":");
      if (idx > 0) {
        const keyPart = line.slice(0, idx);
        const val = line.slice(idx + 1);
        const key = keyPart.split(";")[0].toUpperCase();
        cur[key] = val;
      }
    }
  }
  return events;
}

function normalizeEvent(e) {
  return {
    title: e.SUMMARY || "Event",
    location: e.LOCATION || "",
    url: e.URL || extractUrlFromDescription(e.DESCRIPTION) || "",
    start: parseICalDate(e.DTSTART),
    end: parseICalDate(e.DTEND)
  };
}

function extractUrlFromDescription(desc) {
  if (!desc) return "";
  const m = desc.match(/https?:\/\/\S+/);
  return m ? m[0] : "";
}

function parseICalDate(v) {
  if (!v) return null;

  const dt = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (dt) {
    const [, y, mo, d, hh, mm, ss, z] = dt;
    const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss}${z ? "Z" : ""}`;
    return new Date(iso);
  }

  const d = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (d) {
    const [, y, mo, day] = d;
    return new Date(`${y}-${mo}-${day}T00:00:00`);
  }

  return null;
}
