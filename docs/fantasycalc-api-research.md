# FantasyCalc API Notes

[FantasyCalc](https://fantasycalc.com) publishes fantasy trade values calculated from millions of real trades, updated several times a day. Its API is undocumented and needs no key. Cache responses rather than calling it on every request.

## What the app uses

The trade analyzer and trade finder load current redraft values from `web/app/api/trade-data/route.ts` (cached for 6 hours):

```
https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=0.5
```

- `numQbs`: 1, or 2 for superflex (the app picks it from the league's lineup slots)
- `ppr`: 0, 0.5 or 1 (the app uses the league's points per reception)
- `numTeams`: league size

Each row has the player (with `sleeperId`, which is how the app matches Sleeper players), `value` and `redraftValue`, `overallRank`, `positionRank` and `trend30Day`. If the call fails, the tools still work without market values.

## Other endpoints

- **Value history and real trades for one player:** `https://api.fantasycalc.com/trades/implied/{player_id}?isDynasty=false&numQbs=1&ppr=0.5&numTeams=12`. It returns `historicalValues`, daily values going back about 3-4 months, and `impliedValues`, up to 1,000 real trades involving the player. This would suit a value-trend chart.
- **One player:** `https://api.fantasycalc.com/players/{player_id}?isDynasty=false&numQbs=1`
- **Player IDs:** `https://api.fantasycalc.com/players/database/searchable?isDynasty=false`, or from a player's page URL (`fantasycalc.com/players/puka-nacua-9822` is ID 9822). These are FantasyCalc's IDs, not Sleeper's.
- **Last update time:** `https://api.fantasycalc.com/values/last-updated`
