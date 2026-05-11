/**
 * weather-worker/worker.js
 * Date - 2026-05-11
 * Version - 2.0.0
 * Notes - Added /api/pool, /api/ecobee, /api/service-visits, /api/rain-history, /api/command
 * Author - David Taylor
 */

// ── Hubitat helpers ───────────────────────────────────────────────────────────

function hubBase(env) {
  const cloudId = '788ef13a-15cc-41ae-808a-2826dbabe598';
  const appId   = env.HUBITAT_APP_ID || '93';
  return `https://cloud.hubitat.com/api/${cloudId}/apps/${appId}`;
}

function hubUrl(base, path, token) {
  return `${base}${path}?access_token=${encodeURIComponent(token)}`;
}

async function hubGet(base, path, token) {
  try {
    const r = await fetch(hubUrl(base, path, token), { cf: { cacheTtl: 0, cacheEverything: false } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function attr(device, name) {
  if (!device) return null;
  if (Array.isArray(device.attributes)) {
    const a = device.attributes.find(a => a.name === name);
    if (a) return a.currentValue ?? null;
  }
  return device[name] ?? null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── /api/pool ─────────────────────────────────────────────────────────────────
// 85=relay1/speed2  86=relay2/speed3  11=heater fireman  10=water temp
async function handlePool(env) {
  const base = hubBase(env);
  const tok  = env.HUBITAT_TOKEN;
  const [d85, d86, d11, d10] = await Promise.all([
    hubGet(base, '/devices/85', tok),
    hubGet(base, '/devices/86', tok),
    hubGet(base, '/devices/11', tok),
    hubGet(base, '/devices/10', tok),
  ]);

  const r1 = attr(d85, 'switch') === 'on';
  const r2 = attr(d86, 'switch') === 'on';

  const rawTemp = attr(d10, 'temperature');
  const temp_f  = rawTemp !== null ? Math.round(num(rawTemp) * 10) / 10 : null;

  const month = new Date().getMonth() + 1;
  const runtime_target_hrs = (month >= 4 && month <= 10) ? 8 : 6;

  return {
    ok:     true,
    pump:   { speed: r2 ? 3 : r1 ? 2 : 0, rpm: r2 ? 3000 : r1 ? 2000 : 0, relay1_on: r1, relay2_on: r2 },
    water:  { temp_f, runtime_target_hrs },
    heater: { on: attr(d11, 'switch') === 'on' },
  };
}

// ── /api/ecobee ───────────────────────────────────────────────────────────────
// 2=Paradise Upstairs  3=Main Floor
async function handleEcobee(env) {
  const base = hubBase(env);
  const tok  = env.HUBITAT_TOKEN;
  const [d2, d3, ev2, ev3] = await Promise.all([
    hubGet(base, '/devices/2',        tok),
    hubGet(base, '/devices/3',        tok),
    hubGet(base, '/devices/2/events', tok),
    hubGet(base, '/devices/3/events', tok),
  ]);

  const parseDevice = d => d ? {
    temperature:     num(attr(d, 'temperature')),
    coolingSetpoint: num(attr(d, 'coolingSetpoint')),
    heatingSetpoint: num(attr(d, 'heatingSetpoint')),
    operatingState:  attr(d, 'thermostatOperatingState') || attr(d, 'operatingState') || 'idle',
    humidity:        num(attr(d, 'humidity')),
    mode:            attr(d, 'thermostatMode')    || attr(d, 'mode')    || null,
    fanMode:         attr(d, 'thermostatFanMode') || attr(d, 'fanMode') || null,
  } : null;

  const month    = new Date().getMonth() + 1;
  const isSummer = month >= 4 && month <= 10;

  function parseEvents(evts, unitName) {
    if (!Array.isArray(evts)) return [];
    return evts
      .filter(e => ['coolingSetpoint', 'heatingSetpoint', 'thermostatOperatingState'].includes(e.name))
      .slice(0, 20)
      .map(e => {
        const d    = e.epoch ? new Date(e.epoch) : new Date(e.date || e.isoDate || 0);
        const hour = d.getHours();
        const duringPeak = isSummer ? (hour >= 15 && hour < 18) : (hour >= 6 && hour < 9);
        return {
          date:       d.toISOString(),
          name:       e.name === 'thermostatOperatingState' ? 'operatingState' : e.name,
          value:      e.value,
          unit:       unitName,
          duringPeak,
        };
      });
  }

  const events = [
    ...parseEvents(ev2, 'Paradise Upstairs'),
    ...parseEvents(ev3, 'Main Floor'),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

  return { ok: true, upstairs: parseDevice(d2), main_floor: parseDevice(d3), events };
}

// ── /api/service-visits ───────────────────────────────────────────────────────
// 42=pump room door  43=pump room motion  76/45/41/73/75/46/74=leak sensors
const LEAK_IDS = [76, 45, 41, 73, 75, 46, 74];

async function handleServiceVisits(env) {
  const base = hubBase(env);
  const tok  = env.HUBITAT_TOKEN;
  const devs = await Promise.all([
    hubGet(base, '/devices/42', tok),
    hubGet(base, '/devices/43', tok),
    ...LEAK_IDS.map(id => hubGet(base, `/devices/${id}`, tok)),
  ]);

  const [d42, d43, ...leakDevs] = devs;

  const leak_sensors = LEAK_IDS.map((id, i) => {
    const d = leakDevs[i];
    if (!d) return { id, status: 'offline', battery: null, daysSince: 999, water: 'unknown' };

    const water   = attr(d, 'water') || (attr(d, 'contact') === 'wet' ? 'wet' : 'dry');
    const battery = num(attr(d, 'battery'));
    const lastAct = attr(d, 'lastActivity') || attr(d, 'lastCheckin') || attr(d, 'lastUpdateTime');
    const daysSince = lastAct ? (Date.now() - new Date(lastAct).getTime()) / 86400000 : 999;

    const status = water === 'wet' ? 'wet' : daysSince > 7 ? 'warn' : 'dry';
    return { id, status, battery: battery !== null ? Math.round(battery) : null, daysSince, water };
  });

  const wet  = leak_sensors.filter(s => s.status === 'wet').length;
  const warn = leak_sensors.filter(s => s.status === 'warn' || s.status === 'offline').length;
  const ok   = leak_sensors.filter(s => s.status === 'dry').length;

  // Service schedule matches ParadisePoolService.groovy
  const month = new Date().getMonth() + 1;
  const dow   = new Date().getDay();
  const service_days = (month >= 6 && month <= 8) ? ['Monday', 'Wednesday', 'Friday'] : ['Thursday'];
  const DAY_NAMES    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  return {
    ok: true,
    is_service_day: service_days.includes(DAY_NAMES[dow]),
    service_days,
    pump_room: {
      door_contact: attr(d42, 'contact') || 'unknown',
      door_battery: d42 ? (num(attr(d42, 'battery')) !== null ? Math.round(num(attr(d42, 'battery'))) : null) : null,
      motion:       attr(d43, 'motion') || 'unknown',
    },
    leak_sensors,
    summary: { wet, warn, ok },
  };
}

// ── /api/rain-history ─────────────────────────────────────────────────────────
async function handleRainHistory(stationId, token) {
  // Resolve Tempest device ID from station
  let deviceId = null;
  try {
    const r = await fetch(`https://swd.weatherflow.com/swd/rest/stations/${stationId}?token=${encodeURIComponent(token)}`);
    if (r.ok) {
      const j   = await r.json();
      const sta = (j?.stations || [])[0] || j;
      const dev = (sta.devices || []).find(d => d.device_type === 'ST') || (sta.devices || [])[0];
      deviceId  = dev?.device_id ?? null;
    }
  } catch {}

  if (!deviceId) return { ok: false, error: 'Could not resolve Tempest device ID from station' };

  // Fetch 30 days in parallel (offset 0=today … 29=29 days ago)
  const offsets  = Array.from({ length: 30 }, (_, i) => i);
  const dayResps = await Promise.all(
    offsets.map(async offset => {
      try {
        const url = `https://swd.weatherflow.com/swd/rest/observations/device/${deviceId}?token=${encodeURIComponent(token)}&day_offset=${offset}`;
        const r = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
        return r.ok ? await r.json() : null;
      } catch { return null; }
    })
  );

  // Aggregate each day → rain total + temp range
  const data = offsets.map((offset, i) => {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const date   = d.toISOString().slice(0, 10);
    const j      = dayResps[i];
    const obsArr = Array.isArray(j?.obs) ? j.obs : Array.isArray(j?.obs?.obs) ? j.obs.obs : null;

    if (!obsArr?.length) return { date, rain_in: 0, is_rain_day: false, max_temp_f: null, min_temp_f: null };

    let totalMm = 0, maxC = -Infinity, minC = Infinity;
    for (const obs of obsArr) {
      if (Array.isArray(obs)) {
        // v1 array: [7]=temp_c  [12]=precip_mm  [18]=precip_daily_mm
        const r = Number(obs[12]); if (Number.isFinite(r)) totalMm += r;
        const t = Number(obs[7]);  if (Number.isFinite(t)) { if (t > maxC) maxC = t; if (t < minC) minC = t; }
      } else if (obs && typeof obs === 'object') {
        const r = Number(obs.precip ?? obs.rain_mm); if (Number.isFinite(r)) totalMm += r;
        const t = Number(obs.air_temperature);       if (Number.isFinite(t)) { if (t > maxC) maxC = t; if (t < minC) minC = t; }
      }
    }

    const rain_in    = Math.round(totalMm * 0.03937 * 100) / 100;
    const max_temp_f = maxC > -Infinity ? Math.round(maxC * 9 / 5 + 32) : null;
    const min_temp_f = minC <  Infinity ? Math.round(minC * 9 / 5 + 32) : null;
    return { date, rain_in, is_rain_day: rain_in > 0.01, max_temp_f, min_temp_f };
  }).reverse(); // oldest first

  return { ok: true, data };
}

// ── /api/pm-bookings ─────────────────────────────────────────────────────────
// KV key: "bookings" → JSON array of booking objects
async function handlePmBookingsGet(env) {
  const raw = await env.PM_BOOKINGS.get('bookings');
  const bookings = raw ? JSON.parse(raw) : [];
  return { ok: true, bookings };
}

async function handlePmBookingsPut(body, env) {
  let bookings;
  try { bookings = JSON.parse(body); }
  catch { return { ok: false, error: 'Invalid JSON' }; }
  if (!Array.isArray(bookings)) return { ok: false, error: 'Expected array' };
  await env.PM_BOOKINGS.put('bookings', JSON.stringify(bookings));
  return { ok: true, count: bookings.length };
}

// ── /api/lock-codes ───────────────────────────────────────────────────────────
// Device 1 = Front Door Z-Wave lock. lockCodes attribute = JSON map of slot → {name, code}
async function handleLockCodes(env) {
  const base = hubBase(env);
  const tok  = env.HUBITAT_TOKEN;
  const d = await hubGet(base, '/devices/1', tok);
  if (!d) return { ok: false, error: 'Could not reach Hubitat' };

  // lockCodes attribute value is a JSON string: {"31":{"name":"Guest","code":"194559"},...}
  const raw = attr(d, 'lockCodes');
  let codes = {};
  if (raw) {
    try { codes = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw)); }
    catch {}
  }

  // Normalize: keys are slot numbers (strings), values have .code and .name
  const normalized = {};
  for (const [slot, entry] of Object.entries(codes)) {
    const s = parseInt(slot);
    if (s >= 31 && s <= 250) {
      normalized[s] = {
        code: entry?.code ?? entry?.userCode ?? entry ?? null,
        name: entry?.name ?? null,
      };
    }
  }

  return { ok: true, codes: normalized, count: Object.keys(normalized).length };
}

// ── /api/command ──────────────────────────────────────────────────────────────
const ALLOWED_COMMANDS = {
  11: ['on', 'off'],              // heater fireman switch (AquaCal SuperQuiet 120)
   1: ['setCode', 'deleteCode'],  // front door lock — PM code management
};

async function handleCommand(body, env) {
  let deviceId, command, params;
  try { ({ deviceId, command, params } = JSON.parse(body)); }
  catch { return { ok: false, error: 'Invalid JSON body' }; }

  if (!ALLOWED_COMMANDS[deviceId]?.includes(command)) {
    return { ok: false, error: 'Command not in allowlist' };
  }

  // Validate setCode params: [slot (31-250), pin (4-8 digits), label (string)]
  if (command === 'setCode') {
    const [slot, pin] = params || [];
    if (!slot || slot < 31 || slot > 250)       return { ok: false, error: 'Slot must be 31–250' };
    if (!pin  || !/^\d{4,8}$/.test(String(pin))) return { ok: false, error: 'PIN must be 4–8 digits' };
  }
  if (command === 'deleteCode') {
    const [slot] = params || [];
    if (!slot || slot < 31 || slot > 250) return { ok: false, error: 'Slot must be 31–250' };
  }

  const base = hubBase(env);
  const tok  = env.HUBITAT_TOKEN;

  // Build path — append params as URL segments (Hubitat Maker API convention)
  let path = `/devices/${deviceId}/${command}`;
  if (Array.isArray(params) && params.length > 0) {
    path += '/' + params.map(p => encodeURIComponent(String(p))).join('/');
  }

  try {
    const r = await fetch(hubUrl(base, path, tok), {
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!r.ok) return { ok: false, error: `Hubitat error ${r.status}` };
    return { ok: true, deviceId, command };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ── /api/send-email ───────────────────────────────────────────────────────────
async function handleSendEmail(body, env) {
  let data;
  try { data = JSON.parse(body); } catch { return { ok: false, error: 'Invalid JSON' }; }

  const { to, guest, pin, ci, co, ci_time, co_time } = data;
  if (!to || !guest || !pin || !ci || !co) return { ok: false, error: 'Missing required fields' };

  const firstName = guest.split(' ')[0];
  const fmt = d => {
    const [y, m, day] = d.split('-');
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return `${months[parseInt(m)-1]} ${parseInt(day)}, ${y}`;
  };
  const fmt12 = t => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };

  const ciDisplay = `${fmt(ci)} at ${fmt12(ci_time) || '4:00 PM'} EDT`;
  const coDisplay = `${fmt(co)} at ${fmt12(co_time) || '10:00 AM'} EDT`;
  const nights    = Math.round((new Date(co) - new Date(ci)) / 86400000);
  const subject   = `Your Paradise Access Code — ${ci.slice(5).replace('-','/')}/${ci.slice(0,4)}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 16px">
<tr><td align="center">
<table width="100%" style="max-width:560px;background:#071525;border-radius:16px;overflow:hidden">

  <!-- Header -->
  <tr><td style="background:#071525;padding:32px 32px 24px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.1)">
    <div style="font-size:28px;font-weight:900;color:#f2c14b;letter-spacing:0.04em">PARADISE</div>
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:4px;letter-spacing:0.12em;text-transform:uppercase">714B S Ocean Blvd · Surfside Beach, SC</div>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:32px 32px 0">
    <p style="margin:0;font-size:18px;color:#ffffff;font-weight:600">Hi ${firstName},</p>
    <p style="margin:12px 0 0;font-size:15px;color:rgba(255,255,255,0.72);line-height:1.6">
      Your door code is ready. You're all set to check in on <strong style="color:#ffffff">${fmt(ci)}</strong>.
    </p>
  </td></tr>

  <!-- PIN block -->
  <tr><td style="padding:24px 32px">
    <div style="background:rgba(242,193,75,0.1);border:1px solid rgba(242,193,75,0.35);border-radius:12px;padding:24px;text-align:center">
      <div style="font-size:11px;color:#f2c14b;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Front Door Code</div>
      <div style="font-size:48px;font-weight:900;color:#f2c14b;letter-spacing:0.2em;font-family:monospace">${pin}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:8px">Enter on the keypad at the front door</div>
    </div>
  </td></tr>

  <!-- Stay details -->
  <tr><td style="padding:0 32px 24px">
    <table width="100%" style="border-collapse:collapse">
      <tr>
        <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,0.08)">
          <div style="font-size:11px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.08em">Check-In</div>
          <div style="font-size:14px;color:#ffffff;margin-top:3px;font-weight:500">${ciDisplay}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,0.08)">
          <div style="font-size:11px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.08em">Check-Out</div>
          <div style="font-size:14px;color:#ffffff;margin-top:3px;font-weight:500">${coDisplay}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,0.08)">
          <div style="font-size:11px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.08em">Stay</div>
          <div style="font-size:14px;color:#ffffff;margin-top:3px;font-weight:500">${nights} night${nights !== 1 ? 's' : ''}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Guest guide links -->
  <tr><td style="padding:0 32px 24px">
    <div style="font-size:11px;color:rgba(255,255,255,0.45);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">Guest Guide</div>
    <table width="100%" cellspacing="0" cellpadding="0"><tr>
      <td style="padding:0 6px 8px 0" width="50%">
        <a href="https://paradisesurfsidesc.com/guest/" style="display:block;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:10px 12px;text-decoration:none;color:#ffffff;font-size:13px;font-weight:600">🏠 House Guide</a>
      </td>
      <td style="padding:0 0 8px 6px" width="50%">
        <a href="https://paradisesurfsidesc.com/guest/wifi.html" style="display:block;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:10px 12px;text-decoration:none;color:#ffffff;font-size:13px;font-weight:600">📶 WiFi</a>
      </td>
    </tr><tr>
      <td style="padding:0 6px 0 0" width="50%">
        <a href="https://paradisesurfsidesc.com/guest/pool.html" style="display:block;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:10px 12px;text-decoration:none;color:#ffffff;font-size:13px;font-weight:600">🏊 Pool</a>
      </td>
      <td style="padding:0 0 0 6px" width="50%">
        <a href="https://paradisesurfsidesc.com/guest/parking.html" style="display:block;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:10px 12px;text-decoration:none;color:#ffffff;font-size:13px;font-weight:600">🚗 Parking</a>
      </td>
    </tr></table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);text-align:center">
    <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.45)">Questions? Reply to this email or call/text <strong style="color:rgba(255,255,255,0.65)">404-406-8471</strong></p>
    <p style="margin:10px 0 0;font-size:13px;color:rgba(255,255,255,0.45)">David Taylor · Paradise · Surfside Beach, SC</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Paradise <no-reply@paradisesurfsidesc.com>',
        to:      [to],
        subject,
        html,
      }),
    });
    const j = await r.json();
    if (!r.ok) return { ok: false, error: j.message || `Resend error ${r.status}` };
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ── /api/weather ──────────────────────────────────────────────────────────────
function extractObsArray(j) {
  if (Array.isArray(j?.obs))          return j.obs;
  if (Array.isArray(j?.obs?.obs))     return j.obs.obs;
  if (Array.isArray(j?.observations)) return j.observations;
  if (Array.isArray(j?.data?.obs))    return j.data.obs;
  return null;
}

function getTempF(obs) {
  if (obs && !Array.isArray(obs) && typeof obs === 'object') {
    const tF = num(obs.temp_f) ?? num(obs.tempF) ?? num(obs.air_temp_f);
    if (tF !== null) return tF;
    const tC = num(obs.air_temperature) ?? num(obs.temp_c);
    if (tC !== null) return tC * 9 / 5 + 32;
  }
  if (Array.isArray(obs)) {
    const candidates = [7, 6, 8, 9, 5].map(i => num(obs[i])).filter(v => v !== null && v >= -40 && v <= 60);
    if (candidates.length) return candidates[0] * 9 / 5 + 32;
  }
  return null;
}

function getObsEpoch(obs, j) {
  if (Array.isArray(obs)) { const t = num(obs[0]); if (t !== null) return t; }
  if (obs && !Array.isArray(obs)) {
    const t = num(obs.time_epoch) ?? num(obs.epoch) ?? num(obs.timestamp) ?? num(obs.time);
    if (t !== null) return t;
  }
  return num(j?.time_epoch) ?? num(j?.timestamp) ?? null;
}

function getExtended(obs) {
  const msToMph = ms => ms !== null ? Math.round(ms * 2.23694 * 10) / 10 : null;
  const mbToInHg = mb => mb !== null ? Math.round(mb * 0.02953 * 1000) / 1000 : null;
  const mmToIn  = mm => mm !== null ? Math.round(mm * 0.03937 * 100) / 100 : null;
  const compass = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

  if (Array.isArray(obs)) {
    const windAvgMs   = num(obs[2]),  windGustMs = num(obs[3]), windDeg    = num(obs[4]);
    const pressureMb  = num(obs[6]),  humidity   = num(obs[8]), uv         = num(obs[10]);
    const solar       = num(obs[11]), rainMm     = num(obs[12]), rainDailyMm = num(obs[18]);
    const tempC       = num(obs[7]);
    let dew_f = null;
    if (tempC !== null && humidity !== null) {
      const lnRH = Math.log(Math.max(humidity, 1) / 100);
      const dewC = (243.04 * (lnRH + 17.625 * tempC / (243.04 + tempC))) /
                   (17.625 - (lnRH + 17.625 * tempC / (243.04 + tempC)));
      dew_f = Math.round(dewC * 9 / 5 + 32);
    }
    return {
      wind_mph:      msToMph(windAvgMs),
      wind_gust_mph: msToMph(windGustMs),
      wind_dir_deg:  windDeg,
      wind_dir:      windDeg !== null ? compass[Math.round(windDeg / 22.5) % 16] : null,
      humidity:      humidity !== null ? Math.round(humidity) : null,
      pressure_inhg: mbToInHg(pressureMb),
      rain_today_in: mmToIn(rainDailyMm ?? rainMm),
      dew_point_f:   dew_f,
      uv, solar,
    };
  }
  if (obs && typeof obs === 'object') {
    const windAvgMs   = num(obs.wind_avg)    ?? num(obs.wind_speed);
    const windGustMs  = num(obs.wind_gust);
    const windDeg     = num(obs.wind_direction);
    const pressureMb  = num(obs.station_pressure) ?? num(obs.pressure);
    const humidity    = num(obs.relative_humidity) ?? num(obs.humidity);
    const uv          = num(obs.uv);
    const solar       = num(obs.solar_radiation) ?? num(obs.solar);
    const rainDailyMm = num(obs.local_daily_rain_accumulated) ?? num(obs.rain_accumulated);
    const tempC       = num(obs.air_temperature) ?? num(obs.temp_c);
    let dew_f = null;
    if (tempC !== null && humidity !== null) {
      const lnRH = Math.log(Math.max(humidity, 1) / 100);
      const dewC = (243.04 * (lnRH + 17.625 * tempC / (243.04 + tempC))) /
                   (17.625 - (lnRH + 17.625 * tempC / (243.04 + tempC)));
      dew_f = Math.round(dewC * 9 / 5 + 32);
    }
    return {
      wind_mph:      msToMph(windAvgMs),
      wind_gust_mph: msToMph(windGustMs),
      wind_dir_deg:  windDeg,
      wind_dir:      windDeg !== null ? compass[Math.round(windDeg / 22.5) % 16] : null,
      humidity:      humidity !== null ? Math.round(humidity) : null,
      pressure_inhg: mbToInHg(pressureMb),
      rain_today_in: mmToIn(rainDailyMm),
      dew_point_f:   dew_f,
      uv, solar,
    };
  }
  return {};
}

function getCondition(uv, solar, rainIn, isNight) {
  if (rainIn > 0.01) return ['🌧️', 'Rain'];
  if (isNight)       return ['🌙', 'Clear (Night)'];
  if (uv >= 8)       return ['☀️',  'Very Sunny'];
  if (uv >= 3)       return ['☀️',  'Sunny'];
  if (solar < 50)    return ['☁️',  'Overcast'];
  if (solar < 250)   return ['⛅',  'Partly Cloudy'];
  return             ['☀️',  'Clear'];
}

async function fetchPoolTempFallback(env) {
  // Fallback using original app ID 90 path if the pool endpoint isn't used
  try {
    const tok = env.HUBITAT_TOKEN;
    if (!tok) return null;
    const base = hubBase(env);
    const d = await hubGet(base, '/devices/10', tok);
    const val = num(attr(d, 'temperature'));
    return val !== null ? Math.round(val * 10) / 10 : null;
  } catch { return null; }
}

async function handleWeather(env) {
  const token     = env.TEMPEST_TOKEN;
  const stationId = env.TEMPEST_STATION_ID || '204460';

  if (!token) return { ok: false, error: 'Missing TEMPEST_TOKEN secret' };

  const apiUrl = `https://swd.weatherflow.com/swd/rest/observations/station/${stationId}?token=${encodeURIComponent(token)}`;
  const [r, poolTempF] = await Promise.all([
    fetch(apiUrl, { cf: { cacheTtl: 0, cacheEverything: false } }),
    env.HUBITAT_TOKEN ? fetchPoolTempFallback(env) : Promise.resolve(null),
  ]);
  const j = await r.json();

  if (!r.ok) return { ok: false, error: 'Tempest API error', status: r.status };

  const obsArr = extractObsArray(j);
  if (!Array.isArray(obsArr) || obsArr.length === 0) return { ok: false, error: 'No observations found' };

  const obs    = obsArr[0];
  const tempF  = getTempF(obs);
  if (tempF === null) throw new Error('Could not determine temperature');

  const ext      = getExtended(obs);
  const isNight  = (ext.solar ?? 0) <= 5 && (ext.uv ?? 0) <= 0.2;
  const [icon, condition] = getCondition(ext.uv ?? 0, ext.solar ?? 0, ext.rain_today_in ?? 0, isNight);
  const obsEpoch    = getObsEpoch(obs, j);
  const updated_iso = obsEpoch !== null ? new Date(obsEpoch * 1000).toISOString() : new Date().toISOString();

  return {
    ok:          true,
    station_id:  Number(stationId),
    temp_f:      Math.round(tempF),
    pool_temp_f: poolTempF,
    condition, icon,
    night:       isNight,
    updated_iso,
    label:       'Live at Paradise · 714B S Ocean Blvd',
    source:      'tempest_station',
    ...ext,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    const ALLOWED_ORIGINS = new Set([
      'https://paradisesurfsidesc.github.io',
      'https://paradisesurfsidesc.com',
      'https://www.paradisesurfsidesc.com',
    ]);
    const origin     = request.headers.get('Origin') || '';
    const corsOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://paradisesurfsidesc.com';

    const cors = {
      'Access-Control-Allow-Origin':  corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age':       '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });

    try {
      if (pathname === '/api/weather') {
        return json(await handleWeather(env));
      }

      if (pathname === '/api/pool') {
        if (!env.HUBITAT_TOKEN) return json({ ok: false, error: 'Missing HUBITAT_TOKEN' }, 500);
        return json(await handlePool(env));
      }

      if (pathname === '/api/ecobee') {
        if (!env.HUBITAT_TOKEN) return json({ ok: false, error: 'Missing HUBITAT_TOKEN' }, 500);
        return json(await handleEcobee(env));
      }

      if (pathname === '/api/service-visits') {
        if (!env.HUBITAT_TOKEN) return json({ ok: false, error: 'Missing HUBITAT_TOKEN' }, 500);
        return json(await handleServiceVisits(env));
      }

      if (pathname === '/api/rain-history') {
        if (!env.TEMPEST_TOKEN) return json({ ok: false, error: 'Missing TEMPEST_TOKEN' }, 500);
        return json(await handleRainHistory(env.TEMPEST_STATION_ID || '204460', env.TEMPEST_TOKEN));
      }

      if (pathname === '/api/pm-bookings') {
        if (!env.PM_BOOKINGS) return json({ ok: false, error: 'KV not configured' }, 500);
        if (request.method === 'GET')  return json(await handlePmBookingsGet(env));
        if (request.method === 'POST') return json(await handlePmBookingsPut(await request.text(), env));
        return json({ ok: false, error: 'Method not allowed' }, 405);
      }

      if (pathname === '/api/lock-codes') {
        if (!env.HUBITAT_TOKEN) return json({ ok: false, error: 'Missing HUBITAT_TOKEN' }, 500);
        return json(await handleLockCodes(env));
      }

      if (pathname === '/api/command') {
        if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
        if (!env.HUBITAT_TOKEN) return json({ ok: false, error: 'Missing HUBITAT_TOKEN' }, 500);
        return json(await handleCommand(await request.text(), env));
      }

      if (pathname === '/api/send-email') {
        if (request.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
        if (!env.RESEND_KEY) return json({ ok: false, error: 'Missing RESEND_KEY' }, 500);
        return json(await handleSendEmail(await request.text(), env));
      }

      return json({ ok: false, error: 'Not found' }, 404);

    } catch (err) {
      return json({ ok: false, error: String(err?.message || err) }, 500);
    }
  },
};
