"""
Build per-season draft data for the Tangy Football web app.

For each season (2022-2026) this fetches:
  - the Sleeper draft (metadata + picks; snake or auction)
  - weekly NFL player stats (half-PPR) for every drafted player

and writes a compact JSON file per season to web/public/data/drafts/{season}.json.

Per-player production is summarized as the MEDIAN weekly fantasy points over
games played (gp >= 1). Median is used instead of mean because weekly fantasy
scores are right-skewed: one 40-point spike inflates the mean and makes a
boom-bust player look better than the steady producer he was most weeks.
Median answers "what did this pick give you in a typical week." Games played
and total points are included alongside so availability isn't hidden.

Re-run to refresh the in-progress season (2026); completed seasons never change.
"""

import json
import statistics
import sys
import time
from pathlib import Path

import requests

BASE = "https://api.sleeper.app/v1"
REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "web" / "public" / "data" / "drafts"

# season -> (league_id, draft_id)
SEASONS = {
    "2022": ("861690796477394944", "861690796846514176"),
    "2023": ("917137955070992384", "917137955070992385"),
    "2024": ("1121136670960701440", "1121136670960701441"),
    "2025": ("1227033344391254016", "1227033344399646720"),
    "2026": ("1323741311471194112", "1400320763667435520"),
}


def get(url: str, retries: int = 3):
    for attempt in range(retries):
        r = requests.get(url, timeout=60)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429:
            time.sleep(2 ** attempt)
            continue
        r.raise_for_status()
    raise RuntimeError(f"Failed after {retries} retries: {url}")


def build_season(season: str, league_id: str, draft_id: str) -> dict:
    print(f"[{season}] fetching draft {draft_id}...", flush=True)
    draft = get(f"{BASE}/draft/{draft_id}")
    picks = get(f"{BASE}/draft/{draft_id}/picks")
    league = get(f"{BASE}/league/{league_id}")
    users = get(f"{BASE}/league/{league_id}/users")
    rosters = get(f"{BASE}/league/{league_id}/rosters")

    draft_type = draft.get("type", "snake")
    settings = draft.get("settings", {})
    teams = settings.get("teams", 12)
    rounds = settings.get("rounds", 0)
    budget = settings.get("budget")

    last_scored = (league.get("settings") or {}).get("last_scored_leg") or 0
    weeks = list(range(1, min(last_scored, 18) + 1))
    print(f"[{season}] type={draft_type} picks={len(picks)} scored_weeks={len(weeks)}", flush=True)

    # roster_id lookup per pick
    user_to_roster = {r["owner_id"]: r["roster_id"] for r in rosters}
    slot_to_roster = {int(k): v for k, v in (draft.get("slot_to_roster_id") or {}).items()}

    drafted_ids = sorted({p["player_id"] for p in picks if p.get("player_id")})
    print(f"[{season}] fetching weekly stats for {len(drafted_ids)} drafted players...", flush=True)

    # player_id -> list of weekly half-PPR points (games played only)
    weekly: dict[str, list[float]] = {pid: [] for pid in drafted_ids}
    for week in weeks:
        stats = get(f"{BASE}/stats/nfl/regular/{season}/{week}")
        for pid in drafted_ids:
            s = stats.get(pid)
            if not s:
                continue
            if (s.get("gp") or 0) >= 1:
                weekly[pid].append(round(float(s.get("pts_half_ppr") or 0), 2))
        time.sleep(0.05)  # be polite to the free API

    out_picks = []
    for p in sorted(picks, key=lambda x: x.get("pick_no", 0)):
        meta = p.get("metadata") or {}
        pid = p.get("player_id")
        w = weekly.get(pid, [])
        games = len(w)
        median_ppg = round(statistics.median(w), 2) if w else 0.0
        total = round(sum(w), 2)

        if draft_type == "auction":
            roster_id = user_to_roster.get(p.get("picked_by"))
        else:
            roster_id = slot_to_roster.get(p.get("draft_slot"))

        first, last = meta.get("first_name", ""), meta.get("last_name", "")
        name = f"{first} {last}".strip() or pid
        amount = meta.get("amount")
        out_picks.append(
            {
                "pick_no": p.get("pick_no"),
                "round": p.get("round"),
                "draft_slot": p.get("draft_slot"),
                "roster_id": roster_id,
                "player_id": pid,
                "name": name,
                "position": meta.get("position"),
                "nfl_team": meta.get("team"),
                "amount": int(amount) if amount not in (None, "") else None,
                "weekly": w,
                "games": games,
                "median_ppg": median_ppg,
                "total": total,
            }
        )

    return {
        "season": season,
        "draft_id": draft_id,
        "type": draft_type,
        "rounds": rounds,
        "teams": teams,
        "budget": int(budget) if budget else None,
        "weeks_scored": len(weeks),
        "scoring": "half_ppr",
        "stat_note": "median weekly half-PPR points over games played (gp >= 1)",
        "picks": out_picks,
    }


def main() -> None:
    only = sys.argv[1:] or list(SEASONS)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for season in only:
        if season not in SEASONS:
            print(f"Unknown season {season}, skipping")
            continue
        league_id, draft_id = SEASONS[season]
        data = build_season(season, league_id, draft_id)
        path = OUT_DIR / f"{season}.json"
        path.write_text(json.dumps(data))
        print(f"[{season}] wrote {path} ({len(data['picks'])} picks)")


if __name__ == "__main__":
    main()
