// worker/index.js
// Date - 2026-04-19
// Version - 1.1.0
// Notes - Added /go/* UTM redirect router; falls back to booking page

const BASE = 'https://paradisesurfsidesc.com';
const BOOK = 'https://www.southerncoastvacations.com/myrtle-beach-vacation-rentals/paradise';

const REDIRECTS = {
  'facebook-summer': `${BASE}/?utm_source=facebook&utm_medium=paid&utm_campaign=summer2026`,
  'facebook-pool':   `${BASE}/?utm_source=facebook&utm_medium=paid&utm_campaign=pool-feature`,
  'instagram':       `${BASE}/?utm_source=instagram&utm_medium=social&utm_campaign=organic`,
  'email-april':     `${BASE}/?utm_source=email&utm_medium=newsletter&utm_campaign=april2026`,
  'book':            `${BOOK}?utm_source=paradise&utm_medium=website&utm_campaign=book`,
  'guest':           `${BASE}/guest/?utm_source=qr&utm_medium=print&utm_campaign=in-property`,
};

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith('/go/')) {
      const slug = pathname.slice(4).replace(/\/$/, '');
      const dest = REDIRECTS[slug];
      if (dest) return Response.redirect(dest, 302);
      return new Response('Not found', { status: 404 });
    }

    return Response.redirect(BOOK, 302);
  }
};
