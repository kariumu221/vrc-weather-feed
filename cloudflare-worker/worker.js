// City-level weather for the VRChat world.
// Cloudflare already knows the approximate location of each request (request.cf), so the visitor is never asked.
// Only visitors who turned on "Allow Untrusted URLs" in VRChat reach this Worker; everyone else uses the
// GitHub Pages feed. Nothing is logged or stored: the cache key holds only a coarse grid cell (0.1 degrees,
// about 10 km), and the IP address is used only as a salted one-way hash, kept in memory for a few minutes, to
// stop a single address from asking too often.
//
// Who gets an answer (anything else is refused with 403, without saying which check failed):
// - Requests with the access key: give the Worker a secret named ACCESS_KEY (Settings > Variables and Secrets)
//   and put the same value in the world's City Url as ?k=... Without ACCESS_KEY the Worker refuses everyone, so
//   a deleted secret can't quietly open it up. To change the key, put the old one in ACCESS_KEY_PREVIOUS while
//   the world is updated, then remove it.
// - Requests from VRChat's string loader: its User-Agent starts with "UnityPlayer/" (PC, Android) or "VRChat/"
//   (iOS), and it sends no browser fetch metadata (Origin, Sec-Fetch-*). A text variable ALLOW_ANY_AGENT = 1
//   turns this check off (for example if VRChat changes its User-Agent).
// The key travels with the world (VRChat even writes the URL to its own log), and a User-Agent can be faked, so
// both keep away casual use from elsewhere (a browser, another site or world) rather than being a true secret.
//
// Floods (DoS): Cloudflare absorbs network-level floods by itself. A flood of ordinary-looking requests is met in
// two places:
// - In front of the Worker (the real defence; README "DoS への対策"): on a custom domain, WAF rules block
//   requests without the key or VRChat's User-Agent and limit each address, before the Worker runs, so they don't
//   count toward the free daily quota (100,000 a day). The workers.dev address is then turned off.
// - In the Worker (here): refusals are cheap (the checks that cost nothing come first), each address is limited,
//   and Open-Meteo is protected: at most UPSTREAM_MAX_PER_MINUTE calls a minute per instance, and a pause after it
//   refuses or fails, so a flood from many places can't use up Open-Meteo's free limit. Requests that reach the
//   Worker still count toward its quota; when that runs out, the world simply uses the GitHub Pages feed until the
//   quota comes back (00:00 UTC).
// - On Workers Paid, which has no daily quota and no spending cap, the Cron Trigger's usage check ("Stopping before
//   the bill grows" below) blocks the address with a WAF rule before the included requests run out.
// Data: Open-Meteo.com (CC BY 4.0).

const CURRENT_FIELDS = [
  "weather_code", "cloud_cover", "precipitation", "rain", "showers", "snowfall",
  "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "temperature_2m", "visibility",
].join(",");

// Values from Open-Meteo are checked before they are cached or sent: a number in this range (or missing), else
// the answer is not used (502). The world checks the same ranges again.
const CURRENT_LIMITS = {
  weather_code: [0, 99], cloud_cover: [0, 100], precipitation: [0, 500], rain: [0, 500], showers: [0, 500],
  snowfall: [0, 500], wind_speed_10m: [0, 150], wind_direction_10m: [0, 360], wind_gusts_10m: [0, 200],
  temperature_2m: [-90, 60], visibility: [0, 1000000],
};

const CACHE_SECONDS = 1800; // 30 minutes; the world asks about once an hour
const UPSTREAM_TIMEOUT_MS = 8000;   // Open-Meteo
const GITHUB_TIMEOUT_MS = 10000;    // the published feed and GitHub's API (Cron Trigger)
const NAME_MAX = 40;                // the world shows at most this many characters of the place name
const USER_AGENT = "VRChat-WeatherFeed/1.0";
const VRCHAT_AGENTS = ["UnityPlayer/", "VRChat/"];

// Every answer: JSON that is never cached, can't be shown as a page, framed or read by other sites, and isn't indexed.
const RESPONSE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "x-robots-tag": "noindex, nofollow",
};

// Per address: at most RATE_MAX requests in RATE_WINDOW_MS, counted per Worker instance. Cloudflare spreads requests
// over many instances that don't share the count, so this only stops bursts that land on one instance (in a test,
// 38 requests in a row from one address were all answered). A visitor asks about once an hour (a few more while
// retrying); the margin leaves room for several players behind one connection (a household, a shared network).
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;
const rateBook = new Map();

// Calls to Open-Meteo, per Worker instance. Requests from many places at once (each a new 10 km cell, so the cache
// can't answer them) would otherwise become as many Open-Meteo calls and could use up its free daily limit. At most
// UPSTREAM_MAX_PER_MINUTE a minute, and none for UPSTREAM_PAUSE_MS after Open-Meteo refuses or fails (429, 5xx,
// timeout). Those visitors get 503 and see the regional feed until their next try; cells already in the cache are
// still answered. Real use is far below this: each visitor asks about once an hour.
const UPSTREAM_MAX_PER_MINUTE = 30;
const UPSTREAM_PAUSE_MS = 60 * 1000;
let upstreamWindowStart = 0;
let upstreamCalls = 0;
let upstreamPausedUntil = 0;
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
  return new Response(JSON.stringify(body), { status: status || 200, headers: RESPONSE_HEADERS });
}

function refuse(error, status) {
  return json({ v: 1, src: "ip", error: error }, status);
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Compares the SHA-256 of both in constant time, so how long a refusal takes tells nothing about the key (not
// even its length).
async function sameKey(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || !expected) return false;
  const a = await sha256(given);
  const b = await sha256(expected);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// The current key, or the previous one while a new key is being rolled out. Both are always checked.
async function keyAccepted(given, env) {
  const current = await sameKey(given, env.ACCESS_KEY);
  const previous = await sameKey(given, env.ACCESS_KEY_PREVIOUS);
  return current || previous;
}

// VRChat's string loader: "UnityPlayer/2022.3.22f1-DWR (UnityWebRequest/1.0, libcurl/...)" on PC and Android,
// "VRChat/<build> CFNetwork/..." on iOS. Browsers send their own User-Agent and fetch metadata.
function fromVRChat(request, env) {
  if (String(env.ALLOW_ANY_AGENT || "") === "1") return true;
  const h = request.headers;
  if (h.get("origin") || h.get("sec-fetch-mode") || h.get("sec-fetch-site") || h.get("sec-fetch-dest")) return false;
  const agent = h.get("user-agent") || "";
  return VRCHAT_AGENTS.some((prefix) => agent.startsWith(prefix));
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

function upstreamAvailable(now) {
  if (now < upstreamPausedUntil) return false;
  if (now - upstreamWindowStart >= 60 * 1000) {
    upstreamWindowStart = now;
    upstreamCalls = 0;
  }
  if (upstreamCalls >= UPSTREAM_MAX_PER_MINUTE) return false;
  upstreamCalls++;
  return true;
}

function pauseUpstream(now) {
  upstreamPausedUntil = now + UPSTREAM_PAUSE_MS;
}

function currentLooksRight(current) {
  if (!current || typeof current !== "object") return false;
  for (const name of Object.keys(CURRENT_LIMITS)) {
    const value = current[name];
    if (value === undefined || value === null) continue;
    const [min, max] = CURRENT_LIMITS[name];
    if (typeof value !== "number" || !isFinite(value) || value < min || value > max) return false;
  }
  return true;
}

// The place name as Cloudflare has it, as plain short text: no tags, angle brackets or control characters
// (the world shows it on the tablets).
function cleanName(name) {
  return String(name || "").replace(/<[^>]*>/g, "").replace(/[<>\u0000-\u001f\u007f]/g, "").trim().slice(0, NAME_MAX);
}

// fetch() that gives up after `ms` milliseconds (throws).
function fetchWithin(url, init, ms) {
  return fetch(url, Object.assign({}, init, { signal: AbortSignal.timeout(ms) }));
}

// ---- Starting the regional feed update (Cron Trigger) ----
// GitHub often runs the feed workflow's own schedule hours late, so this Worker starts it too. On its Cron Trigger
// (every 10 minutes) it reads the published weather.json and, when that is FEED_STALE_MINUTES old or more, asks
// GitHub to run the workflow (workflow_dispatch with force=false). The workflow checks the age again, so a run
// started twice, or one GitHub also started on its own, updates only once. Settings > Variables and Secrets:
//   GITHUB_REPO   (text)   owner/name of the feed repository
//   GITHUB_TOKEN  (secret) a fine-grained token for that repository only, with "Actions: Read and write"
//   FEED_URL      (text, optional) the published weather.json (https), if not https://<owner>.github.io/<name>/weather.json
//   GITHUB_BRANCH (text, optional) the branch with the workflow, if not main
// Without GITHUB_REPO and GITHUB_TOKEN this part does nothing. The token is only ever sent to api.github.com.
const FEED_STALE_MINUTES = 50;   // the same rule as the workflow's "Is the published data old?"
const FEED_WORKFLOW = "update-weather.yml";

// Minutes since the published feed was made; Infinity when it can't be read (then an update is due anyway).
async function feedAgeMinutes(feedUrl, now) {
  try {
    // The query string skips the Pages cache, which can serve the old file for up to 10 minutes.
    const res = await fetchWithin(feedUrl + (feedUrl.includes("?") ? "&" : "?") + "check=" + now,
      { headers: { "user-agent": USER_AGENT } }, GITHUB_TIMEOUT_MS);
    if (!res.ok) return Infinity;
    const t = Number((await res.json()).t);
    return t > 0 ? (now / 1000 - t) / 60 : Infinity;
  } catch (e) {
    return Infinity;
  }
}

async function startFeedUpdate(env, now) {
  const repo = env && env.GITHUB_REPO;
  const token = env && env.GITHUB_TOKEN;
  if (!repo || !token) return "not set up";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("GITHUB_REPO should look like owner/name");
  const branch = env.GITHUB_BRANCH || "main";
  if (!/^[\w./-]{1,100}$/.test(branch) || branch.includes("..")) throw new Error("GITHUB_BRANCH is not a branch name");
  const [owner, name] = repo.split("/");
  const feedUrl = env.FEED_URL || `https://${owner.toLowerCase()}.github.io/${name}/weather.json`;
  if (!/^https:\/\//.test(feedUrl)) throw new Error("FEED_URL should start with https://");
  if (await feedAgeMinutes(feedUrl, now) < FEED_STALE_MINUTES) return "fresh";
  const res = await fetchWithin(`https://api.github.com/repos/${repo}/actions/workflows/${FEED_WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      "authorization": "Bearer " + token,
      "accept": "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({ ref: branch, inputs: { force: "false" } }),
  }, GITHUB_TIMEOUT_MS);
  // Throwing marks the run as failed in the Worker's list of past cron events (an expired token shows up there).
  // Only the status goes into the message, never the token or GitHub's answer.
  if (!res.ok) throw new Error("GitHub did not start the feed update: " + res.status);
  return "started";
}

// ---- Stopping before the bill grows (Cron Trigger) ----
// Workers Paid has no spending cap: past the 10 million requests included in a billing period, each further million
// costs $0.30, and the budget alert only sends an e-mail. So on every Cron Trigger this Worker asks Cloudflare how
// many requests all Workers in the account have had today (UTC) and, once that reaches USAGE_DAILY_LIMIT, switches
// on a WAF custom rule that blocks the city weather's address. Blocked requests never reach a Worker, so nothing more
// is counted or billed, and the world uses the GitHub Pages feed. At 00:00 UTC (09:00 in Japan) the count starts
// again and the rule is switched off. A billing period has at most 31 days, and 31 x 250,000 = 7.75 million, so the
// margin to 10 million covers the minutes between a check and the block. Settings > Variables and Secrets:
//   CF_API_TOKEN      (secret) an API token with "Account Analytics: Read" and "Zone WAF: Edit" for that zone only
//   CF_ACCOUNT_ID     (text)   the account ID
//   CF_ZONE_ID        (text)   the zone ID of the domain the city weather uses
//   USAGE_DAILY_LIMIT (text, optional) requests a day before stopping, if not 250000 (set 1 to test the stop)
// The rule must already exist, named exactly STOP_RULE_NAME, with the action Block (README); this only switches it
// on and off. Without the three settings this part does nothing. The token is only ever sent to api.cloudflare.com.
const STOP_RULE_NAME = "使いすぎ自動停止";
const USAGE_DAILY_LIMIT = 250000;
const CF_API = "https://api.cloudflare.com/client/v4";
const CF_TIMEOUT_MS = 10000;
const CF_ID = /^[0-9a-f]{32}$/;

// Calls the Cloudflare API with the token and returns the parsed answer; anything but success throws. Only the
// status and Cloudflare's first error message go into the error, never the token.
async function cloudflareApi(env, path, init) {
  const res = await fetchWithin(CF_API + path, Object.assign({}, init, {
    headers: {
      "authorization": "Bearer " + env.CF_API_TOKEN,
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
  }), CF_TIMEOUT_MS);
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  const errors = body && Array.isArray(body.errors) ? body.errors : [];
  if (!res.ok || !body || body.success === false || errors.length) {
    const first = errors.length ? " " + String(errors[0].message || errors[0].code || "").slice(0, 120) : "";
    throw new Error(`Cloudflare API ${init.method} ${path.split("/").slice(0, 3).join("/")}: ${res.status}${first}`);
  }
  return body;
}

// Requests to all Workers in the account since 00:00 UTC today, as Cloudflare's analytics count them (a minute or
// two behind). Scheduled runs like this one are counted too.
async function requestsToday(env, now) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const body = await cloudflareApi(env, "/graphql", {
    method: "POST",
    body: JSON.stringify({
      query: "query ($accountTag: string, $start: string, $end: string) { viewer { accounts(filter: {accountTag: $accountTag}) { " +
        "workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $start, datetime_leq: $end}) { sum { requests } } } } }",
      variables: { accountTag: env.CF_ACCOUNT_ID, start: start.toISOString(), end: new Date(now).toISOString() },
    }),
  });
  const accounts = body.data && body.data.viewer && body.data.viewer.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) throw new Error("Cloudflare analytics did not return the account");
  const rows = accounts[0].workersInvocationsAdaptive;
  if (!Array.isArray(rows)) throw new Error("Cloudflare analytics did not return Worker requests");
  let total = 0;
  for (const row of rows) {
    const n = Number(row && row.sum && row.sum.requests);
    if (!isFinite(n) || n < 0) throw new Error("Cloudflare analytics returned an odd request count");
    total += n;
  }
  return total;
}

// Switches the stop rule on or off when it isn't already. Only a Block rule with exactly that name is touched.
async function setStopRule(env, on) {
  const zone = "/zones/" + env.CF_ZONE_ID;
  const ruleset = (await cloudflareApi(env, zone + "/rulesets/phases/http_request_firewall_custom/entrypoint", { method: "GET" })).result;
  const rule = ruleset && Array.isArray(ruleset.rules) ? ruleset.rules.find((r) => r.description === STOP_RULE_NAME) : null;
  if (!rule) throw new Error(`WAF custom rule "${STOP_RULE_NAME}" not found`);
  if (rule.action !== "block") throw new Error(`WAF custom rule "${STOP_RULE_NAME}" should have the action Block`);
  if ((rule.enabled !== false) === on) return on ? "stopped" : "open";
  // A rule update replaces the whole rule, so everything it has is sent back with only "enabled" changed.
  const update = Object.assign({}, rule, { enabled: on });
  delete update.id;
  delete update.version;
  delete update.last_updated;
  await cloudflareApi(env, `${zone}/rulesets/${ruleset.id}/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify(update) });
  return on ? "stopped now" : "reopened";
}

async function guardUsage(env, now) {
  if (!env || !env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_ZONE_ID) return "not set up";
  if (!CF_ID.test(env.CF_ACCOUNT_ID) || !CF_ID.test(env.CF_ZONE_ID)) throw new Error("CF_ACCOUNT_ID and CF_ZONE_ID should be 32-character IDs");
  const limit = Number(env.USAGE_DAILY_LIMIT) > 0 ? Number(env.USAGE_DAILY_LIMIT) : USAGE_DAILY_LIMIT;
  return await setStopRule(env, await requestsToday(env, now) >= limit);
}

export default {
  // The usage check runs on every Cron Trigger (README: every 2 minutes); the feed check only at minutes 0, 10, 20,
  // ..., as when the trigger ran every 10 minutes. One failing doesn't skip the other; a failure throws at the end,
  // which marks the run as failed in the Worker's list of past cron events. Returns what each part did.
  async scheduled(controller, env, ctx) {
    const now = Date.now();
    const done = [];
    const failed = [];
    try {
      done.push("usage: " + await guardUsage(env, now));
    } catch (e) {
      failed.push("usage: " + e.message);
    }
    if (new Date((controller && controller.scheduledTime) || now).getUTCMinutes() % 10 === 0) {
      try {
        done.push("feed: " + await startFeedUpdate(env, now));
      } catch (e) {
        failed.push("feed: " + e.message);
      }
    }
    if (failed.length) throw new Error(failed.join("; "));
    return done.join(", ");
  },

  async fetch(request, env, ctx) {
    env = env || {};
    if (request.method !== "GET") return refuse("method not allowed", 405);
    const url = new URL(request.url);
    if (url.pathname !== "/") return refuse("not found", 404);
    // The checks that cost nothing first, the key (two hashes) after them.
    if (!fromVRChat(request, env) || !(await keyAccepted(url.searchParams.get("k") || "", env))) return refuse("forbidden", 403);
    if (tooOften(await addressTag(request), Date.now())) return refuse("too many requests", 429);

    const cf = request.cf || {};
    const lat = Number(cf.latitude);
    const lon = Number(cf.longitude);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return refuse("location unavailable", 503);
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
      if (!currentLooksRight(current)) current = null;
    }
    if (!current) {
      if (!upstreamAvailable(now)) return refuse("busy", 503);
      const upstream = "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${gridLat}&longitude=${gridLon}` +
        `&current=${CURRENT_FIELDS}&wind_speed_unit=ms&timezone=GMT`;
      let res;
      try {
        res = await fetchWithin(upstream, { headers: { "user-agent": USER_AGENT } }, UPSTREAM_TIMEOUT_MS);
      } catch (e) {
        pauseUpstream(now);
        return refuse("upstream timeout", 504);
      }
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) pauseUpstream(now);
        return refuse("upstream " + res.status, 502);
      }
      try {
        current = (await res.json()).current;
      } catch (e) {
        current = null;
      }
      if (!currentLooksRight(current)) return refuse("upstream data", 502);
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
      n: cleanName(cf.city || cf.region || cf.country),
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
