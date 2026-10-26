"""Replay every finished week's fantasy scoring play by play, for the win-probability history.

nflverse's play-by-play (play_by_play_{season}.parquet) has every play's wall-clock time, the
game clock and score, and the players involved. From it this builds, for each week of this
league's season, the timeline the Live tab would have seen:

  games     every NFL game's clock and score after each play
  players   each fantasy starter's points so far, after each play that changed them
  defense   each team defense's points so far from everything but points allowed (sacks,
            takeaways, touchdowns, safeties, blocked kicks); points allowed come from the score
  injuries  the final injury report status for the week (Out, Doubtful, Questionable)
  final     each starter's official points from Sleeper, so the replay ends exactly there

Scoring uses the league's own settings. Bonuses, stat corrections and anything the play-by-play
misses are made up by the gap to the official final, spread over the player's game.
web/scripts/build-win-history.ts turns these into win odds with the Live tab's own model.

    uv run python scripts/build_play_timelines.py 2025 [--weeks 1 2 3 | --recent 2]

Writes scripts/cache/timelines/{season}/{week}.json (git-ignored; the win history built from
it is what's committed). Downloads nflverse files into scripts/cache/nflverse/.
"""

import argparse
import csv
import gzip
import json
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "data" / "sleeper"
CACHE = ROOT / "scripts" / "cache"
OUT = CACHE / "timelines"
SLEEPER = "https://api.sleeper.app/v1"
LEAGUE_ID = "1323741311471194112"
# nflverse team codes that differ from Sleeper's
TEAM = {"LA": "LAR"}


def get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "tangy-football"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def download(url: str, path: Path) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "tangy-football"})
        with urllib.request.urlopen(req, timeout=300) as r:
            path.write_bytes(r.read())
    return path


def league_for(season: str) -> dict:
    """This league's Sleeper league for a season, following previous_league_id back"""
    league = get(f"{SLEEPER}/league/{LEAGUE_ID}")
    while league and league["season"] != season:
        prev = league.get("previous_league_id")
        league = get(f"{SLEEPER}/league/{prev}") if prev and prev != "0" else None
    if not league:
        raise SystemExit(f"No league for {season}")
    return league


def matchups(league: dict, week: int) -> list:
    path = ARCHIVE / league["season"] / "matchups" / f"{week}.json.gz"
    if path.exists():
        return json.load(gzip.open(path, "rt"))
    return get(f"{SLEEPER}/league/{league['league_id']}/matchups/{week}")


def crosswalk() -> dict:
    """nflverse (GSIS) player ID -> Sleeper ID, from DynastyProcess's table"""
    path = download("https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv", CACHE / "nflverse" / "db_playerids.csv")
    return {
        r["gsis_id"]: r["sleeper_id"]
        for r in csv.DictReader(open(path))
        if r.get("gsis_id") not in (None, "", "NA") and r.get("sleeper_id") not in (None, "", "NA")
    }


def injuries(season: str) -> dict:
    """week -> GSIS ID -> final report status"""
    url = f"https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv"
    try:
        path = download(url, CACHE / "nflverse" / f"injuries_{season}.csv")
    except Exception:  # Not published yet early in a season
        return {}
    out: dict = defaultdict(dict)
    for r in csv.DictReader(open(path)):
        if r.get("report_status"):
            out[int(r["week"])][r["gsis_id"]] = r["report_status"]
    return out


def epoch(t) -> int | None:
    if not isinstance(t, str) or not t:
        return None
    return int(datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp())


def num(x) -> float:
    """A play-by-play number, 0 when missing"""
    return 0.0 if x is None or pd.isna(x) else float(x)


def fg_points(dist: float, made: bool, s: dict) -> float:
    if made:
        band = "0_19" if dist < 20 else "20_29" if dist < 30 else "30_39" if dist < 40 else "40_49" if dist < 50 else "50p"
        return s.get(f"fgm_{band}", 0) + s.get("fgm_yds_over_30", 0) * max(0, dist - 30)
    band = "0_19" if dist < 20 else "20_29" if dist < 30 else "30_39" if dist < 40 else "40_49" if dist < 50 else "50p"
    return s.get(f"fgmiss_{band}", s.get("fgmiss", 0))


def play_points(p, s: dict, ids: dict) -> tuple[dict, dict]:
    """(Sleeper player ID -> points, team -> defense points) from one play"""
    pts: dict = defaultdict(float)
    dst: dict = defaultdict(float)
    sid = lambda g: ids.get(g) if isinstance(g, str) else None
    passer, rusher, receiver, kicker = sid(p.passer_player_id), sid(p.rusher_player_id), sid(p.receiver_player_id), sid(p.kicker_player_id)
    td_player = sid(p.td_player_id)
    two_point = p.two_point_conv_result == "success"

    if passer:
        pts[passer] += s.get("pass_yd", 0) * num(p.passing_yards)
        if p.pass_touchdown == 1:
            pts[passer] += s.get("pass_td", 0)
        if p.interception == 1:
            pts[passer] += s.get("pass_int", 0)
        if two_point and p.two_point_attempt == 1 and receiver:
            pts[passer] += s.get("pass_2pt", 0)
    if receiver:
        if p.complete_pass == 1:
            pts[receiver] += s.get("rec", 0)
        pts[receiver] += s.get("rec_yd", 0) * num(p.receiving_yards)
        if p.pass_touchdown == 1 and td_player == receiver:
            pts[receiver] += s.get("rec_td", 0)
        if two_point and p.two_point_attempt == 1:
            pts[receiver] += s.get("rec_2pt", 0)
    if rusher:
        pts[rusher] += s.get("rush_yd", 0) * num(p.rushing_yards)
        if p.rush_touchdown == 1 and td_player == rusher:
            pts[rusher] += s.get("rush_td", 0)
        if two_point and p.two_point_attempt == 1 and not receiver:
            pts[rusher] += s.get("rush_2pt", 0)
    if p.fumble_lost == 1 and sid(p.fumbled_1_player_id):
        pts[sid(p.fumbled_1_player_id)] += s.get("fum_lost", 0)
    if kicker:
        if p.field_goal_attempt == 1 and isinstance(p.field_goal_result, str):
            pts[kicker] += fg_points(num(p.kick_distance), p.field_goal_result == "made", s)
        if isinstance(p.extra_point_result, str):
            pts[kicker] += s.get("xpm", 0) if p.extra_point_result == "good" else s.get("xpmiss", 0)

    # Team defenses and special teams
    off, de = TEAM.get(p.posteam, p.posteam), TEAM.get(p.defteam, p.defteam)
    returns = p.play_type in ("kickoff", "punt")
    if isinstance(de, str) and not returns:
        if p.sack == 1:
            dst[de] += s.get("sack", 0)
        if p.interception == 1:
            dst[de] += s.get("int", 0)
        if p.fumble_lost == 1 and TEAM.get(p.fumble_recovery_1_team, p.fumble_recovery_1_team) == de:
            dst[de] += s.get("fum_rec", 0)
        if p.safety == 1:
            dst[de] += s.get("safe", 0)
        if (p.punt_blocked == 1 or (isinstance(p.field_goal_result, str) and p.field_goal_result == "blocked")):
            dst[de] += s.get("blk_kick", 0)
    td_team = TEAM.get(p.td_team, p.td_team) if isinstance(p.td_team, str) else None
    if td_team and td_team != off and not returns:
        dst[td_team] += s.get("def_td", 0)
    if returns and isinstance(off, str):
        # On kickoffs and punts nflverse's posteam is the receiving team
        yards = num(p.return_yards)
        dst[off] += s.get("def_kr_yd" if p.play_type == "kickoff" else "def_pr_yd", 0) * yards
        if td_team == off:
            dst[off] += s.get("def_st_td", 0)
    return pts, dst


def build(season: str, weeks: list[int] | None, recent: int | None = None) -> None:
    league = league_for(season)
    scoring = league.get("scoring_settings") or {}
    last = (league.get("settings") or {}).get("last_scored_leg") or 0
    pbp = pd.read_parquet(download(
        f"https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.parquet",
        CACHE / "nflverse" / f"play_by_play_{season}.parquet",
    ))
    ids = crosswalk()
    gsis_of = {v: k for k, v in ids.items()}
    reports = injuries(season)
    if recent:
        weeks = list(range(max(1, last - recent + 1), last + 1))
    for week in weeks or range(1, last + 1):
        if week > last:
            print(f"{season} week {week}: not scored yet, skipped")
            continue
        games_w = pbp[pbp.week == week]
        if games_w.empty:
            print(f"{season} week {week}: no play-by-play yet, skipped")
            continue
        ms = matchups(league, week)
        starters = {sid for m in ms for sid in (m.get("starters") or []) if sid and sid != "0"}
        final = {sid: (m.get("players_points") or {}).get(sid, 0) for m in ms for sid in (m.get("starters") or []) if sid and sid != "0"}

        games, players, defense = {}, defaultdict(list), defaultdict(list)
        totals, dtotals = defaultdict(float), defaultdict(float)
        for game_id, g in games_w.groupby("game_id", sort=False):
            g = g.sort_values(["qtr", "quarter_seconds_remaining"], ascending=[True, False], kind="stable")
            home, away = TEAM.get(g.home_team.iloc[0], g.home_team.iloc[0]), TEAM.get(g.away_team.iloc[0], g.away_team.iloc[0])
            snaps, t_last = [], None
            for p in g.itertuples():
                t = epoch(p.time_of_day) or t_last
                if t is None:
                    continue
                t_last = t
                hs, as_ = int(num(p.total_home_score)), int(num(p.total_away_score))
                snaps.append([t, int(num(p.qtr) or 1), int(num(p.quarter_seconds_remaining)), hs, as_])
                pts, dst = play_points(p, scoring, ids)
                for sid, v in pts.items():
                    if sid in starters and v:
                        totals[sid] += v
                        players[sid].append([t, round(totals[sid], 2)])
                for team, v in dst.items():
                    if team in starters and v:
                        dtotals[team] += v
                        defense[team].append([t, round(dtotals[team], 2)])
            if snaps:
                games[game_id] = {"home": home, "away": away, "snaps": snaps}

        week_reports = reports.get(week, {})
        injury = {sid: week_reports[gsis_of[sid]] for sid in starters if sid in gsis_of and gsis_of[sid] in week_reports}
        out = OUT / season / f"{week}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps({
            "season": season, "week": week, "games": games, "players": players, "defense": defense,
            "injuries": injury, "final": final,
        }, separators=(",", ":")))
        missing = [sid for sid in starters if sid not in players and not sid.isalpha() and final.get(sid, 0)]
        print(f"{season} week {week}: {len(games)} games, {len(players)} players, {len(defense)} defenses"
              f"{f', {len(missing)} scoring starters not found in the play-by-play' if missing else ''}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("seasons", nargs="+")
    parser.add_argument("--weeks", nargs="*", type=int)
    parser.add_argument("--recent", type=int, help="only the last N scored weeks")
    args = parser.parse_args()
    for season in args.seasons:
        build(season, args.weeks, args.recent)


if __name__ == "__main__":
    main()
