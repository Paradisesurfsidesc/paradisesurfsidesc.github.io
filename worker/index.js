// worker/index.js
// Date - 2026-04-25
// Version - 1.2.1
// Notes - Added facebook-june UTM redirect

const BASE = 'https://paradisesurfsidesc.com';
const BOOK = 'https://www.southerncoastvacations.com/myrtle-beach-vacation-rentals/paradise';

const REDIRECTS = {
  'facebook-summer': `${BASE}/?utm_source=facebook&utm_medium=paid&utm_campaign=summer2026`,
  'facebook-june':   `${BASE}/?utm_source=facebook&utm_medium=paid&utm_campaign=june2026`,
  'facebook-pool':   `${BASE}/?utm_source=facebook&utm_medium=paid&utm_campaign=pool-feature`,
  'instagram':       `${BASE}/?utm_source=instagram&utm_medium=social&utm_campaign=organic`,
  'email-april':     `${BASE}/?utm_source=email&utm_medium=newsletter&utm_campaign=april2026`,
  'book':            `${BOOK}?utm_source=paradise&utm_medium=website&utm_campaign=book`,
  'guest':           `${BASE}/guest/?utm_source=qr&utm_medium=print&utm_campaign=in-property`,
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/events') {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=300',
      };

      try {
        const icsUrl = env.ICS_URL;
        if (!icsUrl) return new Response(JSON.stringify({ ok: false, error: 'ICS_URL not configured' }), { status: 500, headers: corsHeaders });

        const r = await fetch(icsUrl);
        if (!r.ok) return new Response(JSON.stringify({ ok: false, error: `ICS fetch failed: ${r.status}` }), { status: 502, headers: corsHeaders });

        const text = await r.text();

        // Unfold ICS lines (RFC 5545 line folding)
        const unfolded = text.replace(/\r?\n[ \t]/g, '');

        const vevents = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];

        function getField(vevent, key) {
          const m = vevent.match(new RegExp(`(?:^|\\n)${key}(?:;[^:]*)?:([^\\n]+)`, 'm'));
          return m ? m[1].trim() : null;
        }

        function parseICSDate(str) {
          if (!str) return null;
          // All-day: YYYYMMDD
          if (/^\d{8}$/.test(str)) return `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`;
          // With time: YYYYMMDDTHHMMSSZ or local
          const m = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
          if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ''}`).toISOString();
          return null;
        }

        const now = new Date().toISOString();
        const events = [];

        for (const vevent of vevents) {
          const summary = getField(vevent, 'SUMMARY');
          const dtstart = getField(vevent, 'DTSTART');
          const dtend = getField(vevent, 'DTEND');
          const description = getField(vevent, 'DESCRIPTION');
          const location = getField(vevent, 'LOCATION');
          const eventUrl = getField(vevent, 'URL');

          if (!summary) continue;

          const startISO = parseICSDate(dtstart);
          if (!startISO) continue;

          // Only include future or today's events
          if (startISO < now.slice(0, 10)) continue;

          events.push({
            summary: summary.replace(/\\n/g, ' ').replace(/\\,/g, ','),
            start: startISO,
            end: parseICSDate(dtend),
            description: description ? description.replace(/\\n/g, ' ').replace(/\\,/g, ',') : null,
            location: location || null,
            url: eventUrl || null,
          });
        }

        events.sort((a, b) => a.start.localeCompare(b.start));

        return new Response(JSON.stringify({ ok: true, count: events.length, events }), { headers: corsHeaders });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), { status: 500, headers: corsHeaders });
      }
    }

    if (pathname.startsWith('/go/')) {
      const slug = pathname.slice(4).replace(/\/$/, '');
      const dest = REDIRECTS[slug];
      if (dest) return Response.redirect(dest, 302);
      return new Response('Not found', { status: 404 });
    }

    return Response.redirect(BOOK, 302);
  }
};
