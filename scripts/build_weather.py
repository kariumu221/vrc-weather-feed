"""Builds public/weather.json: current weather for one representative city per time zone.

The VRChat world picks the entry whose UTC offset (and VRChat UI language) matches the visitor,
so no location is ever requested from the visitor. Data: Open-Meteo (CC BY 4.0), no API key needed.
Standard library only, so it runs on a bare GitHub Actions runner.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

# (name, lat, lon, standard UTC offset in minutes, observes DST, VRChat UI language hints)
# Order matters: earlier entries win when several share the same offset and no language matches.
LOCATIONS = [
    ("Pago Pago", -14.28, -170.70, -660, False, ""),
    ("Honolulu", 21.31, -157.86, -600, False, ""),
    ("Anchorage", 61.22, -149.90, -540, True, ""),
    ("Los Angeles", 34.05, -118.24, -480, True, ""),
    ("Denver", 39.74, -104.99, -420, True, ""),
    ("Phoenix", 33.45, -112.07, -420, False, ""),
    ("Chicago", 41.88, -87.63, -360, True, ""),
    ("Mexico City", 19.43, -99.13, -360, False, "es"),
    ("New York", 40.71, -74.01, -300, True, ""),
    ("Bogota", 4.71, -74.07, -300, False, "es"),
    ("Lima", -12.05, -77.04, -300, False, ""),
    ("Caracas", 10.48, -66.90, -240, False, "es"),
    ("Santiago", -33.45, -70.67, -240, True, ""),
    ("Sao Paulo", -23.55, -46.63, -180, False, "pt"),
    ("Buenos Aires", -34.60, -58.38, -180, False, "es"),
    ("Ponta Delgada", 37.74, -25.67, -60, True, ""),
    ("London", 51.51, -0.13, 0, True, "en"),
    ("Lisbon", 38.72, -9.14, 0, True, "pt"),
    ("Reykjavik", 64.15, -21.94, 0, False, ""),
    ("Accra", 5.60, -0.19, 0, False, ""),
    ("Berlin", 52.52, 13.40, 60, True, "de"),
    ("Paris", 48.86, 2.35, 60, True, "fr"),
    ("Madrid", 40.42, -3.70, 60, True, "es"),
    ("Rome", 41.90, 12.50, 60, True, "it"),
    ("Warsaw", 52.23, 21.01, 60, True, "pl"),
    ("Stockholm", 59.33, 18.07, 60, True, "sv"),
    ("Amsterdam", 52.37, 4.90, 60, True, "nl"),
    ("Lagos", 6.52, 3.38, 60, False, ""),
    ("Athens", 37.98, 23.73, 120, True, "el"),
    ("Kyiv", 50.45, 30.52, 120, True, "uk"),
    ("Helsinki", 60.17, 24.94, 120, True, "fi"),
    ("Cairo", 30.04, 31.24, 120, True, "ar"),
    ("Johannesburg", -26.20, 28.05, 120, False, ""),
    ("Moscow", 55.76, 37.62, 180, False, "ru"),
    ("Istanbul", 41.01, 28.98, 180, False, "tr"),
    ("Riyadh", 24.71, 46.68, 180, False, "ar"),
    ("Nairobi", -1.29, 36.82, 180, False, ""),
    ("Tehran", 35.69, 51.39, 210, False, "fa"),
    ("Dubai", 25.20, 55.27, 240, False, ""),
    ("Kabul", 34.53, 69.17, 270, False, ""),
    ("Karachi", 24.86, 67.01, 300, False, ""),
    ("Tashkent", 41.30, 69.24, 300, False, ""),
    ("New Delhi", 28.61, 77.21, 330, False, "hi"),
    ("Kathmandu", 27.72, 85.32, 345, False, ""),
    ("Dhaka", 23.81, 90.41, 360, False, ""),
    ("Almaty", 43.24, 76.89, 360, False, ""),
    ("Yangon", 16.84, 96.17, 390, False, ""),
    ("Bangkok", 13.76, 100.50, 420, False, "th"),
    ("Jakarta", -6.21, 106.85, 420, False, "id"),
    ("Hanoi", 21.03, 105.85, 420, False, "vi"),
    ("Shanghai", 31.23, 121.47, 480, False, "zh-cn,zh-hans,zh"),
    ("Taipei", 25.03, 121.57, 480, False, "zh-tw,zh-hant"),
    ("Hong Kong", 22.32, 114.17, 480, False, "zh-hk"),
    ("Singapore", 1.35, 103.82, 480, False, ""),
    ("Manila", 14.60, 120.98, 480, False, "fil,tl"),
    ("Perth", -31.95, 115.86, 480, False, ""),
    ("Tokyo", 35.68, 139.69, 540, False, "ja"),
    ("Seoul", 37.57, 126.98, 540, False, "ko"),
    ("Adelaide", -34.93, 138.60, 570, True, ""),
    ("Darwin", -12.46, 130.84, 570, False, ""),
    ("Sydney", -33.87, 151.21, 600, True, ""),
    ("Brisbane", -27.47, 153.03, 600, False, ""),
    ("Noumea", -22.28, 166.46, 660, False, ""),
    ("Auckland", -36.85, 174.76, 720, True, ""),
    ("Nuku'alofa", -21.14, -175.20, 780, False, ""),
    ("Kiritimati", 1.87, -157.43, 840, False, ""),
]

CURRENT_FIELDS = [
    "weather_code", "cloud_cover", "precipitation", "rain", "showers", "snowfall",
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "temperature_2m", "visibility",
]


def fetch_current(locations):
    params = {
        "latitude": ",".join(f"{l[1]:.2f}" for l in locations),
        "longitude": ",".join(f"{l[2]:.2f}" for l in locations),
        "current": ",".join(CURRENT_FIELDS),
        "wind_speed_unit": "ms",
        "timezone": "GMT",
    }
    url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(params, safe=",")
    req = urllib.request.Request(url, headers={"User-Agent": "VRChat-WeatherFeed/1.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.load(resp)
            return data if isinstance(data, list) else [data]
        except Exception as exc:  # network hiccup: retry a couple of times
            print(f"fetch attempt {attempt + 1} failed: {exc}", file=sys.stderr)
            time.sleep(10)
    raise SystemExit("Open-Meteo request failed")


def num(value, digits=1):
    return round(float(value), digits) if value is not None else 0


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "public"
    results = fetch_current(LOCATIONS)
    if len(results) != len(LOCATIONS):
        raise SystemExit(f"expected {len(LOCATIONS)} results, got {len(results)}")

    entries = []
    for (name, lat, lon, tz, dst, langs), res in zip(LOCATIONS, results):
        cur = res.get("current", {})
        entries.append({
            "n": name, "la": lat, "lo": lon, "tz": tz, "d": 1 if dst else 0, "lg": langs,
            "c": int(cur.get("weather_code") or 0),
            "cc": num(cur.get("cloud_cover"), 0),
            "p": num(cur.get("precipitation"), 2),
            "r": num((cur.get("rain") or 0) + (cur.get("showers") or 0), 2),
            "s": num(cur.get("snowfall"), 2),
            "ws": num(cur.get("wind_speed_10m")),
            "wd": num(cur.get("wind_direction_10m"), 0),
            "wg": num(cur.get("wind_gusts_10m")),
            "tp": num(cur.get("temperature_2m")),
            "vis": num(cur.get("visibility"), 0),
        })

    doc = {"v": 1, "t": int(time.time()), "src": "tz", "attr": "Weather data by Open-Meteo.com (CC BY 4.0)", "l": entries}
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "weather.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write("<!doctype html><meta charset=utf-8><title>Weather feed</title>"
                "<p>VRChat world weather feed. Data: <a href=https://open-meteo.com/>Open-Meteo.com</a> (CC BY 4.0).</p>")
    print(f"wrote {len(entries)} locations to {out_dir}/weather.json")


if __name__ == "__main__":
    main()
