// City-level weather for the VRChat world.
// Cloudflare already knows the approximate location of each request (request.cf), so the visitor is never asked.
// Only visitors who turned on "Allow Untrusted URLs" in VRChat reach this Worker; everyone else uses the
// GitHub Pages feed. Nothing is logged or stored: the IP address is never read, and the cache key holds only
// a coarse grid cell (0.1 degrees, about 10 km).
// Data: Open-Meteo.com (CC BY 4.0).

const CURRENT_FIELDS = [
  "weather_code", "cloud_cover", "precipitation", "rain", "showers", "snowfall",
  "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "temperature_2m", "visibility",
].join(",");

const CACHE_SECONDS = 1800; // 30 minutes, the same as the world's refresh interval

// In-memory cache per Worker instance. The Cache API below only works on custom domains,
// so on *.workers.dev this is what keeps repeat requests from reaching Open-Meteo.
const memoryCache = new Map();

function round(value, digits) {
  const f = Math.pow(10, digits);
  return Math.round((Number(value) || 0) * f) / f;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const cf = request.cf || {};
    const lat = Number(cf.latitude);
    const lon = Number(cf.longitude);
    if (!isFinite(lat) || !isFinite(lon)) {
      return json({ v: 1, src: "ip", error: "location unavailable" }, 503);
    }

    const gridLat = round(lat, 1);
    const gridLon = round(lon, 1);
    const cache = caches.default;
    const cacheKey = new Request(`https://weather-cache.invalid/${gridLat}/${gridLon}`);

    const memoryKey = `${gridLat}/${gridLon}`;
    const now = Date.now();
    let current = null;
    const remembered = memoryCache.get(memoryKey);
    const cached = remembered && remembered.expires > now ? null : await cache.match(cacheKey);
    if (remembered && remembered.expires > now) {
      current = remembered.data;
    } else if (cached) {
      current = await cached.json();
    } else {
      const url = "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${gridLat}&longitude=${gridLon}` +
        `&current=${CURRENT_FIELDS}&wind_speed_unit=ms&timezone=GMT`;
      const res = await fetch(url, { headers: { "user-agent": "VRChat-WeatherFeed/1.0" } });
      if (!res.ok) return json({ v: 1, src: "ip", error: "upstream " + res.status }, 502);
      current = (await res.json()).current || {};
      ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(current), {
        headers: { "cache-control": `public, max-age=${CACHE_SECONDS}` },
      })));
    }
    if (!remembered || remembered.expires <= now) {
      if (memoryCache.size > 5000) memoryCache.clear();
      memoryCache.set(memoryKey, { expires: now + CACHE_SECONDS * 1000, data: current });
    }

    return json({
      v: 1,
      t: Math.floor(Date.now() / 1000),
      src: "ip",
      attr: "Weather data by Open-Meteo.com (CC BY 4.0)",
      n: cf.city || cf.region || cf.country || "",
      la: gridLat,
      lo: gridLon,
      c: Math.trunc(Number(current.weather_code) || 0),
      cc: round(current.cloud_cover, 0),
      p: round(current.precipitation, 2),
      r: round((Number(current.rain) || 0) + (Number(current.showers) || 0), 2),
      s: round(current.snowfall, 2),
      ws: round(current.wind_speed_10m, 1),
      wd: round(current.wind_direction_10m, 0),
      wg: round(current.wind_gusts_10m, 1),
      tp: round(current.temperature_2m, 1),
      vis: round(current.visibility, 0),
    });
  },
};
