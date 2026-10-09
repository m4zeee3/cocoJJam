"""Refresh app/src/data/prices.json with real NCR retail prices.

Source: WFP "Philippines - Food Prices" on HDX (monthly retail prices from the
Philippine Statistics Authority), license CC BY-IGO. The app bundles the result,
so prices work offline (UC-4.4). Rerun before each build:

    python backend/scripts/update_prices.py            # download the latest CSV
    python backend/scripts/update_prices.py --csv f.csv  # use a CSV you already have

Only the standard library is used. Rows that WFP doesn't cover keep their
existing values and stay marked as "sample".
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import statistics
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

HDX_PACKAGE = "https://data.humdata.org/api/3/action/package_show?id=wfp-food-prices-for-philippines"
PRICES_JSON = Path(__file__).resolve().parents[2] / "app" / "src" / "data" / "prices.json"
SOURCE = "PSA retail prices via WFP (HDX), NCR"
ATTRIBUTION = "Source: WFP Philippines Food Prices (HDX), data from the Philippine Statistics Authority. CC BY-IGO."

# App item -> WFP commodity. Every WFP price is per KG.
COMMODITY = {
    # The app's dataset: beef, pork, chicken, fish
    "bangus": "Fish (milkfish)",
    "galunggong": "Fish (roundscad)",
    "tilapia": "Fish (tilapia)",
    "pork": "Meat (pork)",
    "chicken": "Meat (chicken, whole)",
    "beef": "Meat (beef)",
    # Recipe-only ingredients
    "onion": "Onions (red)",
    "tomato": "Tomatoes",
    "garlic": "Garlic",
    "ginger": "Ginger",
    "kalamansi": "Calamansi",
    "kangkong": "Water spinach",
    "sitaw": "Beans (green, fresh)",
}

# The app prices some items per bundle; WFP is per kg. Rough weight of one bundle.
KG_PER_UNIT = {"bundle": 0.25}

# WFP gives one average per month, the app needs a usual range for Palengke
# verdicts: midpoint ± this share, rounded to ₱5 (₱1 under ₱50).
RANGE_SHARE = 0.07


def fetch_csv() -> str:
    with urllib.request.urlopen(HDX_PACKAGE, timeout=30) as r:
        package = json.load(r)["result"]
    url = next(res["url"] for res in package["resources"] if "Food Prices" in res["name"])
    print(f"Downloading {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=180) as r:
        return r.read().decode("utf-8")


def ncr_monthly(text: str) -> dict[str, dict[str, float]]:
    """commodity -> {YYYY-MM: mean retail PHP/kg across NCR markets}."""
    sums: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in csv.DictReader(io.StringIO(text)):
        if not row["admin1"].lower().startswith("national capital"):
            continue
        if row["pricetype"] != "Retail" or row["unit"].upper() != "KG":
            continue
        sums[row["commodity"]][row["date"][:7]].append(float(row["price"]))
    return {c: {m: statistics.fmean(v) for m, v in months.items()} for c, months in sums.items()}


def round_price(x: float) -> float:
    step = 1 if x < 50 else 5
    return round(x / step) * step


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--csv", type=Path, help="use this WFP CSV instead of downloading")
    args = ap.parse_args()

    text = args.csv.read_text() if args.csv else fetch_csv()
    monthly = ncr_monthly(text)
    data = json.loads(PRICES_JSON.read_text())
    items = data["items"]

    latest_months = []
    report = []
    for item, commodity in COMMODITY.items():
        series = monthly.get(commodity)
        if item not in items or not series:
            report.append(f"  skip {item}: no WFP data for {commodity!r}")
            continue
        row = items[item]
        per_unit = KG_PER_UNIT.get(row["unit"], 1.0)
        months = sorted(series)[-12:]
        history = [round(series[m] * per_unit, 1) for m in months]
        mid = history[-1]
        old_mid = (row["low"] + row["high"]) / 2
        row["low"] = round_price(mid * (1 - RANGE_SHARE))
        row["high"] = round_price(mid * (1 + RANGE_SHARE))
        row["avg"] = round(statistics.fmean(history), 1)
        row["history"] = history
        row["source"] = f"{SOURCE}, {months[-1]}"
        # Cuts keep their spread around the new average (UC-6.4).
        for cut in row.get("variants", {}).values():
            scale = mid / old_mid
            cut["low"] = round_price(cut["low"] * scale)
            cut["high"] = round_price(cut["high"] * scale)
        change = (mid - row["avg"]) / row["avg"]
        # Reason tags are curated by the team; drop one the data no longer supports.
        if abs(change) < 0.05 and "reason" in row:
            row.pop("reason")
            row.pop("reason_title", None)
            report.append(f"  {item}: dropped its reason tag (change is now {change:+.0%})")
        elif change >= 0.05 and "reason" not in row:
            report.append(f"  {item}: {change:+.0%} vs 12-month average, add a curated reason tag")
        latest_months.append(months[-1])
        report.append(f"  {item:11s} ₱{mid:7.1f}/{row['unit']:6s} avg ₱{row['avg']:7.1f}  {change:+5.0%}  ({months[-1]})")

    for item, row in items.items():
        row.setdefault("source", "sample")

    if latest_months:
        month = min(latest_months)  # the month every refreshed row has
        data["as_of"] = month
        data["updated"] = f"{month}-15"
    data["source"] = SOURCE
    data["attribution"] = ATTRIBUTION
    PRICES_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print("\n".join(report))
    print(f"Wrote {PRICES_JSON} (as of {data['as_of']})")


if __name__ == "__main__":
    main()
