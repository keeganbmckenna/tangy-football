# Tangy Football - Web App

The Next.js app behind https://tangy-football.vercel.app. The [main README](../README.md) covers every feature, the project layout, caching and deployment; [FEATURES.md](../FEATURES.md) is a plain-language tour, and [docs/odds-models.md](../docs/odds-models.md) explains the odds models in `lib/analyze/`.

## Running it

Requires Node.js 20 or later.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Vitest in watch mode (`npx vitest run` runs once) |
| `npx tsc --noEmit` | Type check |
| `npm run test:coverage` | Tests with a coverage report |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm start` | Serve the production build |

## League

The app reads the `NEXT_PUBLIC_LEAGUE_ID` environment variable, falling back to the ID in `lib/config.ts`. To point it at another league, put this in `.env.local`:

```env
NEXT_PUBLIC_LEAGUE_ID=your_league_id_here
```

The ID is in the league's Sleeper URL: `https://sleeper.com/leagues/YOUR_LEAGUE_ID/...`. Use the current season's league; earlier seasons are found by following Sleeper's `previous_league_id` chain.

## Layout

- `app/` - the page (`page.tsx`, all tabs, with the tab and season in the address bar), API routes under `app/api/` (league, live, playoff-odds, trade-data, trades, history, draft), the manifest and icons
- `components/` - each tab's sections; `components/ui/` holds shared pieces
- `hooks/` - theme, your team, table sorting, chart hover and taps, team colors
- `lib/analyze/` - all the analytics (standings, play-all, brackets, playoff odds, live, draft, trades, trade and waiver finders, history), tested in `lib/__tests__/`
- `lib/` - Sleeper fetching, config and cache durations, league settings, shared types
- `lib/analyze/strengthModel.json` - the fitted odds-model weights, exported by `scripts/backtests/export_model.py`
- `public/data/` - pre-built draft data, trade history and odds history for completed seasons

## Stack

Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4, Recharts 3 and Vitest, with data from the Sleeper API.
