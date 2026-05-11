# CLAUDE.md — Paradise Surfside Beach · Full Ecosystem

> Project context for Claude Code and Claude AI. Covers the complete Paradise automation and web ecosystem.
> Last updated: 2026-05-11

---

## Overview

**Paradise** is a 5-bedroom vacation rental at 714B S Ocean Blvd, Surfside Beach, SC 29575.
Managed by Southern Coast Vacations (SCV). Owner: David Taylor.

This repo (`paradisesurfsidesc/paradisesurfsidesc.github.io`) contains:
- Public marketing website
- Guest-facing pages
- Owner control dashboard (`/control/`)
- Property manager dashboard (`/manage/`)
- Cloudflare Workers (in subdirectories)

---

## Repository Structure

```
paradisesurfsidesc.github.io/
├── index.html
├── paradise-info.html
├── plan-your-stay.html
├── reviews.html
├── weather.html
├── [other public pages]
├── guest/                      Guest-only pages
├── control/
│   └── index.html              Owner control dashboard (Cloudflare Access gated)
├── manage/
│   └── index.html              PM dashboard - Southern Coast Vacations (Cloudflare Access gated)
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
├── images/
├── robots.txt
└── CLAUDE.md
```

---

## Design System

All public pages use assets/styles.css and assets/site.js.
Control and manage dashboards are self-contained single-file HTML.

### CSS Variables
```
--bg:         #071525              Deep navy - primary background
--surface:    rgba(20,65,110,0.96) Ocean blue glass
--card:       rgba(255,255,255,0.07)
--cardBorder: rgba(255,255,255,0.16)
--text:       #ffffff
--muted:      rgba(255,255,255,0.72)
--accent:     #f2c14b              Warm gold - primary accent
--blue:       rgba(31,105,160,0.85)
```

### Typography
- Headings: Georgia, "Times New Roman", serif
- Body: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif
- Monospace/data: "DM Mono", "Courier New", monospace

### File Header Convention
```
<!-- filename.html -->
<!-- Date - YYYY-MM-DD -->
<!-- Version - X.X.X -->
<!-- Notes - Brief change summary -->
<!-- Author - David Taylor -->
```

---

## Cloudflare Workers

### Worker 1: worker/index.js
- URL: paradisesurfsidesc.com (root domain)
- Handles: /go/<slug> UTM redirects, /api/events calendar, fallthrough to SCV booking
- Secrets: ICS_URL
- Deploy: cd worker && wrangler deploy

### Worker 2: weather-worker/worker.js
- URL: paradise-weather.paradise-surfsidesc.workers.dev
- Endpoints:
  - GET /api/weather          Current Tempest conditions + pool temp
  - GET /api/rain-history     60 days daily rain/temp from Tempest
  - GET /api/pool             All pool device states in one call
  - GET /api/ecobee           Both Ecobee states + event log with peak flagging
  - GET /api/service-visits   Leak sensors + pump room + service day detection
  - POST /api/command         Proxies allowlisted device commands to Hubitat cloud
- Secrets: TEMPEST_TOKEN, TEMPEST_STATION_ID, HUBITAT_TOKEN
- Deploy: cd weather-worker && wrangler deploy

### Worker Secrets
```
TEMPEST_TOKEN         WeatherFlow API token
TEMPEST_STATION_ID    204460
HUBITAT_TOKEN         c6a25a8e-2590-4a49-b5be-7376b3a6d0c5
```

---

## Hubitat Hub

- Hub IP (local): 192.168.1.249
- Cloud ID: 788ef13a-15cc-41ae-808a-2826dbabe598
- Maker API app ID: 93
- Maker API token: c6a25a8e-2590-4a49-b5be-7376b3a6d0c5
- Cloud base: https://cloud.hubitat.com/api/788ef13a-15cc-41ae-808a-2826dbabe598/apps/93

### Key Devices
```
ID  Label                              Purpose
85  Zooz MultiRelay-Relay 1            Pump Speed 2 - 2,000 RPM
86  Zooz MultiRelay-Relay 2            Pump Speed 3 - 3,000 RPM
11  Pool Temp - Return/Heater Control  Heater fireman switch (ON=heater runs)
10  Pool Temp - In                     Pool water temperature sensor
2   Paradise Upstairs                  Ecobee thermostat
3   Main Floor                         Ecobee thermostat
1   Front Door                         Z-Wave lock - guest entry
42  Pump Room Leak Sensor              Contact sensor - pump room door
43  Pump Room Multi Sensor             Aeon Multisensor 6 - motion/temp (battery dead)
76  Leak - Downstairs Bathroom Sink    Zigbee moisture
45  Leak - Downstairs Dishwasher       Z-Wave contact
41  Leak - Downstairs Kitchen Sink     Aeotec Water PRO 7
73  Leak - Downstairs Toilet           Zigbee moisture
75  Leak - Master Bath Toilet          Zigbee moisture
46  Leak - Upstairs Laundry/HVAC       Z-Wave contact
74  Leak - Upstairs Toilet             Zigbee moisture
```

---

## Hubitat Groovy Apps (source in hubitat/ directory)

### ParadisePumpScheduler.groovy
Controls ZEN16 pump speed around Santee Cooper RG-25 peak hours.

Summer (Apr-Oct):
- 12:00 AM - 3:00 PM  Speed 3 (Relay 2 on)
- 3:00 PM - 6:15 PM   Speed 2 (Relay 1 on) - peak window
- 6:15 PM - 11:00 PM  Speed 3 (Relay 2 on)
- 11:00 PM - midnight Speed 2 (Relay 1 on) - night

Winter (Nov-Mar):
- All day              Speed 2 (Relay 1 on)
- 6:00 AM - 9:15 AM   Pump OFF - peak window

Also: Ecobee cooling setpoint 76F at 11 AM daily June-August
Also: Heater off during peak, restored after if it was on

### ParadiseDoorCodeManager.groovy v3.0.0
STR guest lock code lifecycle manager for Front Door (device 1).

Slot map:
- 1-10:   Owner (manual only, never auto-assigned)
- 11-30:  Staff / PM / Cleaners (manual only)
- 31-250: STR guests (auto-assigned, auto-expire)

Lifecycle:
1. Booking created -> code pushed to lock (pending confirmation)
2. Lock confirms via codeChanged event
3. 4:00 PM check-in day -> code activates
4. 10:00 AM checkout day -> deleteCode -> booking archived

Bug fixes in v3.0.0:
- setCode confirmation via lock event subscription
- Hard stop on slot collision
- Edit syncs to lock immediately
- Slot bounded to 31-250 for PM
- Collision check uses state + live lockCodes attribute
- SecureRandom PIN generation

### ParadisePoolService.groovy
Tracks Southstrand PM pool service visits.

Detection: pump room door contact (device 42) + motion (device 43, battery dead)
Snapshots: 6 AM before + 6 PM after on service days
No-show alert: 8 PM if no door event detected

Service schedule:
- Winter (Nov-Mar):    Thursday
- Shoulder (Apr-May, Sep-Oct): Thursday
- Summer (Jun-Aug):    Monday, Wednesday, Friday

SC DHEC targets: Free chlorine 1-8 ppm, pH 7.0-7.8

---

## Control Dashboard (control/index.html)

Single-file HTML. Paradise brand (navy/gold/glass). Phone-first design.
All data from Worker - works local network AND remotely.
Cloudflare Access: owner email only.

7 screens (bottom tab bar):
1. Overview    - weather, peak banner, all system status tap cards
2. Pump        - speed, relay states, schedule timeline, savings, event log
3. Temp/Heat   - pool temp, heater toggle (fires /api/command), time-to-temp, energy cost
4. Chemicals   - ORP/pH/flow placeholders, rain chart, treatment log (localStorage)
5. HVAC/Energy - both Ecobees live, peak exposure costs, thermostat event log
6. Leak        - 8 sensor cards green/yellow/red, battery%, last seen, 7-day stale alert
7. Service     - pump room status, chemistry log, SC DHEC targets, visit history

localStorage: paradise_treats, paradise_chem, paradise_svc

---

## PM Dashboard (manage/index.html)

Single-file HTML. Paradise brand. Phone-friendly.
Cloudflare Access: owner + Southern Coast Vacations PM.

Lock management only - slots 31-250. Cannot see pump/HVAC/energy.
localStorage: pm_bookings (future: sync via Worker)

---

## Cloudflare Access

Team: paradisesurfsidesc
Plan: Free tier (Zero Trust)

Policies needed:
- paradisesurfsidesc.com/control/*  ->  owner email only
- paradisesurfsidesc.com/manage/*   ->  owner + SCV PM email

Auth: One-time PIN to email. Session: 24 hours.

Setup steps:
1. dash.cloudflare.com -> Zero Trust -> Access -> Applications
2. Add application -> Self-hosted
3. Domain: paradisesurfsidesc.com, Path: control
4. Policy: Include -> Emails -> your email
5. Repeat for /manage with both emails

---

## robots.txt

Should disallow:
- /control/
- /manage/
- /admin/
- /guest/

---

## Integrations

Service              Purpose                    Key/ID
Tempest WeatherFlow  Weather station 204460     TEMPEST_TOKEN in Worker
Hubitat Cloud        Device state + commands    HUBITAT_TOKEN in Worker
Klaviyo              Email/SMS list             Company UhvABe, List SbCFKU
Google Analytics     GA4                        G-HFN4RF1QVT
Cloudflare Workers   API proxy + auth           paradisesurfsidesc team
GitHub Pages         Static hosting             paradisesurfsidesc.github.io

---

## Pending / Phase 2

- ORP sensor      -> add device ID to Worker and dashboard when installed
- pH sensor       -> same
- Flow meter      -> same
- PM email        -> add to Cloudflare Access policy when confirmed
- PM bookings     -> sync via Worker (currently localStorage only)
- Ecobee API      -> suspended by Ecobee, monitor for re-opening
- SCV booking feed -> auto-create door codes from reservations
- Pump Room Multi Sensor (device 43) -> replace batteries
