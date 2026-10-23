"""Pre-build the week-by-week odds history for completed seasons into
web/public/data/odds-history/{season}.json.

Re-running the odds model as of the draft and after every week takes a few seconds per
season, and a finished season never changes, so completed seasons are built once from the
app's own /api/odds-history/{season} route. Start the app first (cd web && npm run dev), then:

    uv run python scripts/build_odds_history.py [season ...] [--url http://localhost:3000]

With no seasons, builds every completed season the app knows about.
"""

import argparse
import json
from pathlib import Path

import requests

OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "data" / "odds-history"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("seasons", nargs="*")
    parser.add_argument("--url", default="http://localhost:3000")
    args = parser.parse_args()

    seasons = args.seasons
    if not seasons:
        league = requests.get(f"{args.url}/api/league", timeout=120).json()
        current = league["league"]["season"]
        seasons = [s for s in league.get("availableSeasons", []) if s != current]

    OUT.mkdir(parents=True, exist_ok=True)
    for season in seasons:
        resp = requests.get(f"{args.url}/api/odds-history/{season}", timeout=600)
        if resp.status_code == 404:
            print(f"{season}: no Sleeper league (before Sleeper), skipped")
            continue
        resp.raise_for_status()
        data = resp.json()
        if not data.get("complete"):
            print(f"{season}: season not complete, skipped")
            continue
        path = OUT / f"{season}.json"
        path.write_text(json.dumps(data, separators=(",", ":")))
        print(f"{season}: {len(data['checkpoints'])} checkpoints -> {path.relative_to(OUT.parent.parent.parent.parent)}")


if __name__ == "__main__":
    main()
