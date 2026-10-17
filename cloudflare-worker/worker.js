// City-level weather for the VRChat world.
// Cloudflare already knows the approximate location of each request (request.cf), so the visitor is never asked.
// Only visitors who turned on "Allow Untrusted URLs" in VRChat reach this Worker; everyone else uses the
// GitHub Pages feed. Nothing is logged or stored: the cache key holds only a coarse grid cell (0.1 degrees,
// about 10 km), and the IP address is used only as a salted one-way hash, kept in memory for a few minutes, to
// stop a single address from asking too often.
//
// Access from the world only: give the Worker a secret named ACCESS_KEY (Settings > Variables and Secrets) and put
// the same value in the world's City Url as ?k=... Requests without it are refused (403). The key travels with the
// world (VRChat even writes the URL to its own log), so it keeps away casual use from elsewhere rather than being a
// true secret; the per-address limit is what protects the free daily quota.
// Data: Open-Meteo.com (CC BY 4.0).

const CURRENT_FIELDS = [
  "weather_code", "cloud_cover", "precipitation", "rain", "showers", "snowfall",
  "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "temperature_2m", "visibility",
].join(",");

const CACHE_SECONDS = 1800; // 30 minutes; the world asks about once an hour

// Per address: at most RATE_MAX requests in RATE_WINDOW_MS. A visitor asks about once an hour (a few more while
// retrying); the margin leaves room for several players behind one connection (a household, a shared network).
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;
const rateBook = new Map();
// A random salt per Worker instance, so the address hashes in memory can't be turned back into addresses.
// Made on the first request: Workers can't make random values at startup.
let salt = "";

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

// Compares in constant time, so the key can't be guessed from how long a refusal takes.
function sameKey(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function addressTag(request) {
  if (!salt) salt = crypto.getRandomValues(new Uint8Array(16)).join(",");
  const address = request.headers.get("cf-connecting-ip") || "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + "|" + address));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

function tooOften(tag, now) {
  const entry = rateBook.get(tag);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    if (rateBook.size > 20000) rateBook.clear();
    rateBook.set(tag, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_MAX;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET") return json({ v: 1, src: "ip", error: "method not allowed" }, 405);
    const key = env && env.ACCESS_KEY;
    if (key && !sameKey(new URL(request.url).searchParams.get("k") || "", key)) {
      return json({ v: 1, src: "ip", error: "forbidden" }, 403);
    }
    if (tooOften(await addressTag(request), Date.now())) {
      return json({ v: 1, src: "ip", error: "too many requests" }, 429);
    }

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
