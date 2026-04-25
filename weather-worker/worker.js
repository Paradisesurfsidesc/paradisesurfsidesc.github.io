/**
 * weather-worker/worker.js
 * Date - 2026-04-19
 * Version - 1.1.0
 * Notes - Added wind, humidity, pressure, rain, dew point; improved condition detection
 * Author - David Taylor
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== '/api/weather') {
      return new Response('Not found', { status: 404 });
    }

    const allowedOrigins = new Set([
      'https://paradisesurfsidesc.github.io',
      'https://paradisesurfsidesc.com',
      'https://www.paradisesurfsidesc.com',
    ]);
    const origin = request.headers.get('Origin') || '';
    const corsOrigin = allowedOrigins.has(origin) ? origin : '';

    const headers = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    const stationId = env.TEMPEST_STATION_ID || '204460';
    const token = env.TEMPEST_TOKEN;

    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing TEMPEST_TOKEN secret' }), { status: 500, headers });
    }

    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

    function extractObsArray(j) {
      if (Array.isArray(j?.obs))            return j.obs;
      if (Array.isArray(j?.obs?.obs))       return j.obs.obs;
      if (Array.isArray(j?.observations))   return j.observations;
      if (Array.isArray(j?.data?.obs))      return j.data.obs;
      return null;
    }

    function getTempF(obs) {
      if (obs && !Array.isArray(obs) && typeof obs === 'object') {
        const tF = num(obs.temp_f) ?? num(obs.tempF) ?? num(obs.air_temp_f);
        if (tF !== null) return tF;
        const tC = num(obs.air_temperature) ?? num(obs.temp_c) ?? num(obs.air_temp_c);
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

    // WeatherFlow Tempest obs array indices (v1 format):
    // [0]=epoch [1]=wind_lull [2]=wind_avg [3]=wind_gust [4]=wind_dir
    // [5]=wind_interval [6]=pressure_mb [7]=temp_c [8]=humidity
    // [9]=lux [10]=uv [11]=solar [12]=rain_mm [13]=precip_type
    // [18]=rain_daily_mm
    function getExtended(obs) {
      const msToMph = ms => ms !== null ? Math.round(ms * 2.23694 * 10) / 10 : null;
      const mbToInHg = mb => mb !== null ? Math.round(mb * 0.02953 * 1000) / 1000 : null;
      const mmToIn  = mm => mm !== null ? Math.round(mm * 0.03937 * 100) / 100 : null;
      const compass = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

      if (Array.isArray(obs)) {
        const windAvgMs  = num(obs[2]);
        const windGustMs = num(obs[3]);
        const windDeg    = num(obs[4]);
        const pressureMb = num(obs[6]);
        const humidity   = num(obs[8]);
        const uv         = num(obs[10]);
        const solar      = num(obs[11]);
        const rainMm     = num(obs[12]);
        const rainDailyMm = num(obs[18]);
        const tempC      = num(obs[7]);

        // Dew point (Magnus formula)
        let dew_f = null;
        if (tempC !== null && humidity !== null) {
          const lnRH = Math.log(Math.max(humidity, 1) / 100);
          const dewC = (243.04 * (lnRH + 17.625 * tempC / (243.04 + tempC))) /
                       (17.625 - (lnRH + 17.625 * tempC / (243.04 + tempC)));
          dew_f = Math.round(dewC * 9 / 5 + 32);
        }

        return {
          wind_mph:       msToMph(windAvgMs),
          wind_gust_mph:  msToMph(windGustMs),
          wind_dir_deg:   windDeg,
          wind_dir:       windDeg !== null ? compass[Math.round(windDeg / 22.5) % 16] : null,
          humidity:       humidity !== null ? Math.round(humidity) : null,
          pressure_inhg:  mbToInHg(pressureMb),
          rain_today_in:  mmToIn(rainDailyMm ?? rainMm),
          dew_point_f:    dew_f,
          uv:             uv,
          solar:          solar,
        };
      }

      if (obs && !Array.isArray(obs) && typeof obs === 'object') {
        const windAvgMs  = num(obs.wind_avg) ?? num(obs.wind_speed);
        const windGustMs = num(obs.wind_gust);
        const windDeg    = num(obs.wind_direction);
        const pressureMb = num(obs.station_pressure) ?? num(obs.pressure);
        const humidity   = num(obs.relative_humidity) ?? num(obs.humidity);
        const uv         = num(obs.uv);
        const solar      = num(obs.solar_radiation) ?? num(obs.solar);
        const rainDailyMm = num(obs.local_daily_rain_accumulated) ?? num(obs.rain_accumulated);
        const tempC      = num(obs.air_temperature) ?? num(obs.temp_c);

        let dew_f = null;
        if (tempC !== null && humidity !== null) {
          const lnRH = Math.log(Math.max(humidity, 1) / 100);
          const dewC = (243.04 * (lnRH + 17.625 * tempC / (243.04 + tempC))) /
                       (17.625 - (lnRH + 17.625 * tempC / (243.04 + tempC)));
          dew_f = Math.round(dewC * 9 / 5 + 32);
        }

        const msToMph2  = ms => ms !== null ? Math.round(ms * 2.23694 * 10) / 10 : null;
        const mbToInHg2 = mb => mb !== null ? Math.round(mb * 0.02953 * 1000) / 1000 : null;
        const mmToIn2   = mm => mm !== null ? Math.round(mm * 0.03937 * 100) / 100 : null;
        const compass2  = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

        return {
          wind_mph:       msToMph2(windAvgMs),
          wind_gust_mph:  msToMph2(windGustMs),
          wind_dir_deg:   windDeg,
          wind_dir:       windDeg !== null ? compass2[Math.round(windDeg / 22.5) % 16] : null,
          humidity:       humidity !== null ? Math.round(humidity) : null,
          pressure_inhg:  mbToInHg2(pressureMb),
          rain_today_in:  mmToIn2(rainDailyMm),
          dew_point_f:    dew_f,
          uv:             uv,
          solar:          solar,
        };
      }

      return {};
    }

    function getCondition(uv, solar, rainIn, isNight) {
      if (rainIn > 0.01)   return ['🌧️', 'Rain'];
      if (isNight)         return ['🌙', 'Clear (Night)'];
      if (uv >= 8)         return ['☀️',  'Very Sunny'];
      if (uv >= 3)         return ['☀️',  'Sunny'];
      if (solar < 50)      return ['☁️',  'Overcast'];
      if (solar < 250)     return ['⛅',  'Partly Cloudy'];
      return               ['☀️',  'Clear'];
    }

    async function fetchPoolTemp(hubitatToken) {
      try {
        const url = `https://cloud.hubitat.com/api/788ef13a-15cc-41ae-808a-2826dbabe598/apps/90/devices/10?access_token=${encodeURIComponent(hubitatToken)}`;
        const r = await fetch(url, { cf: { cacheTtl: 0, cacheEverything: false } });
        if (!r.ok) return null;
        const d = await r.json();
        const attr = Array.isArray(d.attributes)
          ? d.attributes.find(a => a.name === 'temperature')
          : null;
        const val = attr ? Number(attr.currentValue) : null;
        return Number.isFinite(val) ? Math.round(val * 10) / 10 : null;
      } catch {
        return null;
      }
    }

    try {
      const apiUrl = `https://swd.weatherflow.com/swd/rest/observations/station/${stationId}?token=${encodeURIComponent(token)}`;
      const [r, poolTempF] = await Promise.all([
        fetch(apiUrl, { cf: { cacheTtl: 0, cacheEverything: false } }),
        env.HUBITAT_TOKEN ? fetchPoolTemp(env.HUBITAT_TOKEN) : Promise.resolve(null),
      ]);
      const j = await r.json();

      if (!r.ok) {
        return new Response(JSON.stringify({ ok: false, error: 'Tempest API error', status: r.status }), { status: 502, headers });
      }

      const obsArr = extractObsArray(j);
      if (!Array.isArray(obsArr) || obsArr.length === 0) {
        return new Response(JSON.stringify({ ok: false, error: 'No observations found' }), { status: 500, headers });
      }

      const obs    = obsArr[0];
      const tempF  = getTempF(obs);
      if (tempF === null) throw new Error('Could not determine temperature');

      const ext    = getExtended(obs);
      const isNight = (ext.solar ?? 0) <= 5 && (ext.uv ?? 0) <= 0.2;
      const [icon, condition] = getCondition(ext.uv ?? 0, ext.solar ?? 0, ext.rain_today_in ?? 0, isNight);

      const obsEpoch  = getObsEpoch(obs, j);
      const updatedISO = obsEpoch !== null ? new Date(obsEpoch * 1000).toISOString() : new Date().toISOString();

      return new Response(JSON.stringify({
        ok:           true,
        station_id:   Number(stationId),
        temp_f:       Math.round(tempF),
        pool_temp_f:  poolTempF,
        condition,
        icon,
        night:        isNight,
        updated_iso:  updatedISO,
        label:        'Live at Paradise · 714B S Ocean Blvd',
        source:       'tempest_station',
        ...ext,
      }), { status: 200, headers });

    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: 'Weather fetch failed', message: String(err?.message || err) }), { status: 500, headers });
    }
  },
};
