"""Builds src/data/fooddb.json: official restaurant items (per serving) + everyday staples (per 100 g).

Inputs: the research JSON files (fooddb-A/B/C.json, one object per menu item, per serving, with source URL)
and generic.py. Output rows are compact; the app converts them to its Food records on demand.
Row: [id, brand, name, variant, category, aliases, servings[[label, grams]], unitOnly, kcal, protein, carbs, fat,
      fiber, sugar, sodiumMg, region, source]  — nutrients per 100 g when unitOnly is false (grams known),
      otherwise per first serving (grams are pseudo: 100 per serving).
"""
import json, re, sys, unicodedata
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from generic import GENERIC

def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

rows, seen, dropped = [], set(), []
def add(row):
    rid = row[0]
    i = 2
    while rid in seen:
        rid = f"{row[0]}-{i}"; i += 1
    row[0] = rid; seen.add(rid); rows.append(row)

r1 = lambda v: None if v is None else round(float(v), 1)

for path in sys.argv[1:]:
    for x in json.load(open(path)):
        k, p, c, f = x["kcal"], x["protein"], x["carbs"], x["fat"]
        est = 4 * p + 4 * c + 9 * f
        if k >= 30 and abs(est - k) / k > 0.2:
            dropped.append(f'{x["brand"]} {x["name"]}'); continue
        s = x["serving"]; g = s.get("grams")
        multi = [(m["label"], m["count"]) for m in (x.get("multi") or []) if m.get("count")]
        if x.get("pieces") and x["pieces"] > 1 and not any("1 piece" in m[0] for m in multi):
            multi.insert(0, ("1 piece", 1 / x["pieces"]))
        if g:
            fac = 100 / g
            servings = [[s["label"], round(g, 1)]] + [[l, round(g * n, 1)] for l, n in multi]
            unit_only = False
        else:
            fac = 1
            servings = [[s["label"], 100]] + [[l, round(100 * n, 1)] for l, n in multi]
            unit_only = True
        brand = x["brand"]; name = x["name"]; var = x.get("variant")
        add([f"db-{slug(brand)}-{slug(name)}{'-' + slug(var) if var else ''}", brand, name, var, x.get("category") or "other",
             sorted({a.lower() for a in (x.get("aliases") or [])}), servings, unit_only,
             r1(k * fac), r1(p * fac), r1(c * fac), r1(f * fac),
             r1(x["fiber"] * fac) if x.get("fiber") is not None else None,
             r1(x["sugar"] * fac) if x.get("sugar") is not None else None,
             round(x["sodiumMg"] * fac) if x.get("sodiumMg") is not None else None,
             x.get("region") or "CA", x.get("source") or ""])

for (name, aliases, cat, k, p, c, f, fib, sug, servings) in GENERIC:
    add([f"db-generic-{slug(name)}", "", name, None, cat, sorted(set(aliases)), [[l, g] for l, g in servings], False,
         k, p, c, f, fib, sug, None, "USDA", "USDA FoodData Central (SR Legacy)"])

out = Path(__file__).resolve().parents[2] / "src" / "data" / "fooddb.json"
out.write_text(json.dumps({"version": 1, "rows": rows}, separators=(",", ":"), ensure_ascii=False))
print(f"{len(rows)} rows → {out} ({out.stat().st_size // 1024} KB); dropped {len(dropped)}: {dropped}")
