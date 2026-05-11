# CLAUDE.md — Paradise Surfside Beach · Full Ecosystem

**Owner:** David Taylor  
**Live site:** https://paradisesurfsidesc.com  
**Booking:** https://www.southerncoastvacations.com/myrtle-beach-vacation-rentals/paradise

Paradise is a 5-bedroom vacation rental at 714B S Ocean Blvd, Surfside Beach, SC 29575. Managed by Southern Coast Vacations (SCV). Sleeps 16 guests, 5 bed / 3 bath, private saltwater heated pool.

---

## Repository Structure

```
paradisesurfsidesc.github.io/
├── index.html                  Home / hero
├── paradise-info.html          Property details
├── plan-your-stay.html         Activity hub
├── reviews.html                Guest reviews
├── weather.html                Live weather + pool temp
├── dining.html                 Dining picks
├── dining-entertainment.html   Dining/entertainment hub
├── things-to-do.html
├── attractions.html
├── events.html                 Local events (pulls /api/events)
├── restaurants.html
├── golf.html
├── breweries.html
├── nearby.html
├── local-cams.html
├── photos.html
├── tour.html
├── videos.html
├── floor-plans.html
├── signup.html                 Klaviyo email + SMS signup
├── privacy.html
├── guest/                      Guest-only pages (CF Access gated)
│   ├── index.html
│   ├── checkin.html
│   ├── checkout.html
│   ├── wifi.html
│   ├── pool.html
│   ├── house.html
│   ├── trash.html
│   ├── parking.html
│   └── help.html
├── control/
│   └── index.html              Owner control dashboard (CF Access gated)
├── manage/
│   └── index.html              PM dashboard — SCV (CF Access gated)
├── admin/
│   └── index.html              Bookings/market admin (password-protected)
├── hubitat/
│   ├── ParadisePumpScheduler.groovy
│   ├── ParadiseDoorCodeManager.groovy
│   └── ParadisePoolService.groovy
├── worker/
│   └── index.js                Cloudflare Worker: redirects + /api/events
├── weather-worker/
│   └── worker.js               Cloudflare Worker: weather + pool + Hubitat proxy
├── assets/
│   ├── styles.css
│   └── site.js
└── robots.txt
```

---

## Architecture

### GitHub Pages
All `.html` files in repo root served directly. No build step.

### Cloudflare Workers

**`worker/` — Main redirect + calendar worker**
- URL: `paradisesurfsidesc.com` (root domain)
- `/go/<slug>` — UTM redirects (REDIRECTS object in `worker/index.js`)
- `/api/events` — fetches ICS calendar from `env.ICS_URL`, returns JSON
- All other paths → SCV booking link
- Secrets: `ICS_URL`
- Deploy: `cd worker && wrangler deploy`

**`weather-worker/` — Weather + pool + Hubitat proxy**
- URL: `paradise-weather.paradise-surfsidesc.workers.dev`
- Endpoints:
  - `GET /api/weather` — Tempest conditions + pool temp
  - `GET /api/rain-history` — 30 days daily rain/temp from Tempest
  - `GET /api/pool` — pump relay states, water temp, heater state
  - `GET /api/ecobee` — both Ecobee thermostat states + event log
  - `GET /api/service-visits` — leak sensors + pump room + service schedule
  - `POST /api/command` — proxies allowlisted device commands to Hubitat
- Secrets: `TEMPEST_TOKEN`, `TEMPEST_STATION_ID` (default 204460), `HUBITAT_TOKEN`, `HUBITAT_APP_ID` (default 93)
- Deploy: `cd weather-worker && wrangler deploy`

---

## Hubitat Hub

- Hub IP (local): 192.168.1.249
- Cloud ID: `788ef13a-15cc-41ae-808a-2826dbabe598`
- Maker API app ID: `93`
- Maker API token: `c6a25a8e-2590-4a49-b5be-7376b3a6d0c5`
- Cloud base: `https://cloud.hubitat.com/api/788ef13a-15cc-41ae-808a-2826dbabe598/apps/93`

### Key Devices
```
ID   Label                              Purpose
85   Zooz MultiRelay-Relay 1            Pump Speed 2 — 2,000 RPM
86   Zooz MultiRelay-Relay 2            Pump Speed 3 — 3,000 RPM
11   Pool Temp - Return/Heater Control  Heater fireman switch (ON = heater runs)
10   Pool Temp - In                     Pool water temperature sensor
2    Paradise Upstairs                  Ecobee thermostat
3    Main Floor                         Ecobee thermostat
1    Front Door                         Z-Wave lock — guest entry
42   Pump Room Leak Sensor              Contact sensor — pump room door
43   Pump Room Multi Sensor             Aeon Multisensor 6 — motion/temp
76   Leak - Downstairs Bathroom Sink    Zigbee moisture
45   Leak - Downstairs Dishwasher       Z-Wave contact
41   Leak - Downstairs Kitchen Sink     Aeotec Water PRO 7
73   Leak - Downstairs Toilet           Zigbee moisture
75   Leak - Master Bath Toilet          Zigbee moisture
46   Leak - Upstairs Laundry/HVAC       Z-Wave contact
74   Leak - Upstairs Toilet             Zigbee moisture
```

---

## Hubitat Groovy Apps (`hubitat/` directory)

### ParadisePumpScheduler.groovy
Controls ZEN16 pump speed around Santee Cooper RG-25 peak hours.

Summer (Apr–Oct): Speed 3 all day except Speed 2 during 3–6:15 PM peak and 11 PM–midnight  
Winter (Nov–Mar): Speed 2 all day, pump OFF 6–9:15 AM peak

Also: Ecobee cooling setpoint 76°F at 11 AM daily June–August  
Also: Heater off during peak, restored after if it was on

### ParadiseDoorCodeManager.groovy (v3.0.0)
STR guest lock code lifecycle manager for Front Door (device 1).

- Slots 1–10: Owner (manual only)
- Slots 11–30: Staff/PM/Cleaners (manual only)
- Slots 31–250: STR guests (auto-assigned, auto-expire)

Lifecycle: booking created → code pushed → confirmed via lock event → activates 4 PM check-in day → deleted 10 AM checkout day

### ParadisePoolService.groovy
Tracks Southstrand PM pool service visits via pump room door sensor (device 42).

Service schedule: Summer (Jun–Aug) = Mon/Wed/Fri; Shoulder + Winter = Thursday  
SC DHEC targets: Free chlorine 1–8 ppm, pH 7.0–7.8

---

## Control Dashboard (`control/index.html`)

Single-file HTML. Paradise brand (navy/gold/glass). Phone-first design.  
All data from Worker. Cloudflare Access: owner email only.

**7 screens (bottom tab bar):**
1. Overview — weather, peak banner, all system status tap cards
2. Pump — speed, relay states, schedule timeline, savings, event log
3. Temp/Heat — pool temp, heater toggle (`/api/command`), time-to-temp, energy cost
4. Chemicals — ORP/pH placeholders, rain chart, treatment log (localStorage)
5. HVAC/Energy — both Ecobees live, peak exposure costs, thermostat event log
6. Leak — 8 sensor cards green/yellow/red, battery%, last seen, 7-day stale alert
7. Service — pump room status, chemistry log, DHEC targets, visit history

localStorage keys: `paradise_treats`, `paradise_chem`, `paradise_svc`

---

## PM Dashboard (`manage/index.html`)

Single-file HTML. Paradise brand. Phone-friendly.  
Cloudflare Access: owner + Southern Coast Vacations PM email.  
Lock management only (slots 31–250). Cannot see pump/HVAC/energy.  
localStorage: `pm_bookings`

---

## Admin Dashboard (`admin/index.html`)

Password-protected (sessionStorage auth). Not indexed (`robots.txt` disallows `/admin/`).

**Login:** username `admin` / password `paradise2025`  
**Data storage:** `localStorage` key `paradise_bookings_v1` — per-browser, not synced

**Tabs:**
- Bookings — CRUD + revenue KPIs + year filter + next booking banner + 52-week pace grid
- Market Trends — 6 comp properties × 4 seasons, positioning vs avg
- Events — 2025/2026 local events calendar with impact badges
- SCV Portfolio — all 22 Southern Coast Vacations properties, filter by type

---

## Cloudflare Access (Zero Trust)

Team: `paradisesurfsidesc`  
Auth: One-time PIN to email. Session: 24 hours.

Policies needed:
- `paradisesurfsidesc.com/control/*` → owner email only
- `paradisesurfsidesc.com/manage/*` → owner + SCV PM email

Setup: dash.cloudflare.com → Zero Trust → Access → Applications → Self-hosted

---

## Design System

All public pages use `assets/styles.css` and `assets/site.js`.  
Control, manage, and admin dashboards are self-contained single-file HTML.

**CSS Variables:**
```
--bg:         #071525              Deep navy
--surface:    rgba(20,65,110,0.96) Ocean blue glass
--card:       rgba(255,255,255,0.07)
--cardBorder: rgba(255,255,255,0.16)
--text:       #ffffff
--muted:      rgba(255,255,255,0.72)
--accent:     #f2c14b              Warm gold
```

**Dark theme throughout.** Standard public page layout:
```html
<section class="page" aria-label="...">
  <div class="page-header"><h1>...</h1><p>...</p></div>
  <div class="grid"><!-- .card elements --></div>
  <div class="page-footer"><a class="btn secondary" href="...">← Back</a></div>
</section>
```

**File header convention:**
```html
<!-- filename.html -->
<!-- Date - YYYY-MM-DD -->
<!-- Version - X.X.X -->
<!-- Notes - Brief change summary -->
<!-- Author - David Taylor -->
```
JS files use `//` comment style.

---

## site.js Key Functions

- `injectHeader()` — builds nav; detects `/guest/` for guest nav
- `applyHeaderTheme()` — hero pages get `is-dark`; others get `is-solid`
- `setupScrollTheme()` — toggles dark/solid on scroll past hero
- `applyHeroImage()` — day/night hero image based on hour
- `loadWeather()` — fetches `/api/weather`, updates `#weatherChip`, polls every 5 min
- `loadGA4()` — injects GA4 (`G-HFN4RF1QVT`)
- `loadKlaviyo()` — injects Klaviyo onsite JS (company_id: `UhvABe`)

---

## Integrations

| Service | Purpose | Key/ID |
|---------|---------|--------|
| Tempest WeatherFlow | Weather station 204460 | `TEMPEST_TOKEN` in Worker |
| Hubitat Cloud | Device state + commands | `HUBITAT_TOKEN` in Worker |
| Klaviyo | Email/SMS list | Company `UhvABe`, List `SbCFKU` |
| Google Analytics | GA4 | `G-HFN4RF1QVT` |
| Cloudflare Workers | API proxy + auth | `paradisesurfsidesc` team |
| GitHub Pages | Static hosting | `paradisesurfsidesc.github.io` |

### Klaviyo
- API revision: `2026-04-15`
- `signup.html` posts to `/client/subscriptions/`
- Email consent required + SMS consent when phone entered

### Google Rich Results
- `index.html`: JSON-LD `LodgingBusiness` + `AggregateRating` (4.8/5, 90 reviews)
- `reviews.html`: JSON-LD with 7 review items
- Google Place ID: `ChIJEVKysONAAIkRKoSdCEXCYRY`

---

## UTM Redirects (`/go/<slug>`)

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

## Deploy Commands

```bash
# weather-worker (new endpoints in v2.0.0)
cd weather-worker
wrangler deploy
wrangler secret put TEMPEST_TOKEN
wrangler secret put HUBITAT_TOKEN
# Optional (have defaults):
wrangler secret put TEMPEST_STATION_ID   # default: 204460
wrangler secret put HUBITAT_APP_ID       # default: 93

# worker (redirects + events)
cd worker
wrangler deploy
wrangler secret put ICS_URL
```

---

## Pending / Phase 2

- ORP sensor → add device ID to Worker + control dashboard when installed
- pH sensor → same
- Flow meter → same
- PM email → add to Cloudflare Access policy when confirmed
- PM bookings → sync via Worker (currently localStorage only)
- Ecobee API → suspended by Ecobee, monitor for re-opening
- SCV booking feed → auto-create door codes from reservations
- Pump Room Multi Sensor (device 43) → batteries dead, replace
