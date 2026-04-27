# CLAUDE.md — Paradise Surfside Beach Website

## Project Overview

Static marketing/guest site for **Paradise**, a 5-bedroom vacation rental at 714B S Ocean Blvd, Surfside Beach, SC 29575. Managed by Southern Coast Vacations. Hosted on GitHub Pages at `paradisesurfsidesc.com` (custom domain via Cloudflare).

**Owner:** David Taylor  
**Booking:** https://www.southerncoastvacations.com/myrtle-beach-vacation-rentals/paradise  
**Live site:** https://paradisesurfsidesc.com

---

## Architecture

### GitHub Pages (static site)
All `.html` files in the repo root are served directly. No build step.

### Cloudflare Workers (two workers)

**1. `worker/` — Main redirect + calendar worker**
- Deployed at `paradisesurfsidesc.com` (root domain)
- Handles `/go/<slug>` UTM redirects (see REDIRECTS object in `worker/index.js`)
- Handles `/api/events` — fetches ICS calendar from `env.ICS_URL` and returns JSON
- Falls through to SCV booking link for all other paths

**2. `weather-worker/` — Weather + pool worker**
- Deployed at `paradise-weather.paradise-surfsidesc.workers.dev`
- Endpoint: `/api/weather`
- Fetches WeatherFlow Tempest API (`env.TEMPEST_TOKEN`, station ID 219019)
- Fetches Hubitat Maker API for pool temp (`env.HUBITAT_TOKEN`, device ID 10)
- Returns: `temp_f`, `condition`, `icon`, `wind_mph`, `humidity`, `pressure_mb`, `rain_in`, `dew_point_f`, `pool_temp_f`

**Secrets (set via `wrangler secret put`):**
- `weather-worker`: `TEMPEST_TOKEN`, `HUBITAT_TOKEN`
- `worker`: `ICS_URL`

---

## Site Structure

### Public pages
| File | Purpose |
|------|---------|
| `index.html` | Home / hero — landing page with booking CTA |
| `paradise-info.html` | Property details — bedrooms, pool, amenities |
| `plan-your-stay.html` | Hub page linking to all activity/dining categories |
| `reviews.html` | Guest reviews page — VRBO, SCV, Google |
| `dining.html` | Owner's dining picks + category links |
| `dining-entertainment.html` | Hub for dining + entertainment |
| `things-to-do.html` | Activities and attractions |
| `attractions.html` | Local attractions |
| `events.html` | Local events (pulls from `/api/events`) |
| `restaurants.html` | Restaurant listings |
| `golf.html` | Golf listings |
| `breweries.html` | Brewery listings |
| `nearby.html` | Nearby destinations |
| `local-cams.html` | Live webcam embeds + links |
| `weather.html` | Live weather + pool temp dashboard |
| `photos.html` | Photo gallery |
| `tour.html` | Virtual tour |
| `videos.html` | Video gallery |
| `floor-plans.html` | Floor plan images |
| `signup.html` | Klaviyo email + SMS signup form |
| `privacy.html` | Privacy policy |

### Guest-only pages (`/guest/`)
Check-in, checkout, WiFi, pool, house rules, trash, parking, help & contacts.

---

## Design System

All styles in `assets/styles.css`. All site JS in `assets/site.js`.

**CSS variables:** `--bg`, `--surface`, `--text`, `--muted`, `--accent`, `--card`, `--cardBorder`

**Dark theme** throughout. Standard layout pattern:
```html
<section class="page" aria-label="...">
  <div class="page-header">
    <h1>...</h1>
    <p>...</p>
  </div>
  <div class="grid">
    <!-- .card or <a class="card"> elements -->
  </div>
  <div class="page-footer">
    <a class="btn secondary" href="...">← Back</a>
  </div>
</section>
```

**Grid:** CSS `auto-fill` grid of `.card` elements. Cards can be `<div class="card">` (non-linked) or `<a class="card" href="...">` (linked).

**Buttons:** `.btn.primary` (accent fill) and `.btn.secondary` (outline).

---

## site.js Key Functions

- `injectHeader()` — Builds header HTML. Detects guest pages via `pathname.includes('/guest/')`. Guest pages get guest nav; all others get public nav.
- `applyHeaderTheme()` — Hero pages (`/` or `/index.html`) get `is-dark`; all others get `is-solid`.
- `setupScrollTheme()` — On hero page, toggles dark/solid as user scrolls past hero.
- `applyHeroImage()` — Day/night hero image based on hour (night = before 7am or after 7pm).
- `loadWeather()` — Fetches weather worker, updates `#weatherChip` in header. Polls every 5 min.
- `loadGA4()` — Injects Google Analytics (G-HFN4RF1QVT).
- `loadKlaviyo()` — Injects Klaviyo onsite JS (company_id: UhvABe).

---

## Integrations

### Klaviyo
- Company ID: `UhvABe`
- List ID: `SbCFKU`
- API revision: `2026-04-15`
- Signup form in `signup.html` posts to `/client/subscriptions/` endpoint
- Email consent (required) + SMS consent (shown when phone number entered)
- `loadKlaviyo()` in site.js handles sitewide onsite JS; static script also in `index.html` head for crawler detection

### Google Analytics
- GA4 property: `G-HFN4RF1QVT`

### Google Rich Results
- `index.html` has JSON-LD: `LodgingBusiness` + `AggregateRating` (4.8/5, 90 reviews) + sample reviews
- `reviews.html` has JSON-LD: `LodgingBusiness` + `AggregateRating` + 7 review items
- Google Place ID: `ChIJEVKysONAAIkRKoSdCEXCYRY`

---

## UTM Redirects (`/go/<slug>`)

Managed in `worker/index.js` REDIRECTS object. Add new slugs there and redeploy.

| Slug | Destination |
|------|------------|
| `facebook-summer` | `/?utm_source=facebook&utm_medium=paid&utm_campaign=summer2026` |
| `facebook-june` | `/?utm_source=facebook&utm_medium=paid&utm_campaign=june2026` |
| `facebook-pool` | `/?utm_source=facebook&utm_medium=paid&utm_campaign=pool-feature` |
| `instagram` | `/?utm_source=instagram&utm_medium=social&utm_campaign=organic` |
| `email-april` | `/?utm_source=email&utm_medium=newsletter&utm_campaign=april2026` |
| `book` | SCV booking link with UTM |
| `guest` | `/guest/` with QR/print UTM |

---

## Deploying Workers

```bash
# From weather-worker/ directory
wrangler deploy

# Set secrets
wrangler secret put TEMPEST_TOKEN
wrangler secret put HUBITAT_TOKEN

# From worker/ directory
wrangler deploy
wrangler secret put ICS_URL
```

---

## Content Notes

- Property sleeps up to 16 guests; 5 bed / 3 bath
- Private saltwater pool (heated)
- Located directly across from the beach on S Ocean Blvd
- "The Family Friendly Beach" — Surfside Beach motto
- Owner favorites in dining: Neal & Pam's, Surf Diner, Surfside Charlie's, Sundown, Pizza Hyena, Gracious Pig, The Quay, Conch Cafe, Beer Belly Deli
- Reviews: VRBO 9.6/10, Southern Coast Vacations 4.8/5, Google 4.8/5 (~90 reviews)

---

## File Header Convention

All files start with:
```html
<!-- filename.html -->
<!-- Date - YYYY-MM-DD -->
<!-- Version - X.X.X -->
<!-- Notes - Brief change summary -->
<!-- Author - David Taylor -->
```

JS files use `//` comment style for the same header.
