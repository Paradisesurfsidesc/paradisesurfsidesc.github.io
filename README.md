# Paradise Guide (v1) + Worker (Events + Redirects)

## What this includes
- Static guest guide site (GitHub Pages friendly)
- Live Surfside Town Events feed (via Cloudflare Worker)
- /go/* redirect system (server-side logging-ready)

## 1) Deploy the site (GitHub Pages)
Upload everything **except** the /worker folder to your GitHub Pages repo (or upload all, it won't hurt, but /worker isn't used by Pages).

## 2) Deploy the Worker (Cloudflare)
1. Install wrangler and login:
   - `npm i -g wrangler`
   - `wrangler login`
2. From the /worker folder:
   - `wrangler deploy`
3. Copy the deployed Worker URL.

## 3) Wire the Events page to your Worker
Edit:
- `events/index.html`

Set:
- `window.PARADISE_EVENTS_API_BASE = "https://YOUR-WORKER-URL.workers.dev";`

## 4) Update redirects
Edit:
- `worker/index.js` -> REDIRECTS map
Add slugs like:
- vmb-events
- surfside-town-events
- stay
- perks, golf, etc.

Your site can link to `/go/<slug>` and the Worker will 302 redirect.

---
Tip: Keep content pages clean; track campaigns using different entry links to your pages (UTMs) while routing outbound clicks through /go/*.
