# Brief for the video tool: name analytics exports by league game number

For the agent working in the video tool's repo (`foundry-hockey-videos-automation`).
The league site will only accept analytics files named and labelled with the
league's own game number. This brief says what the site expects; how to build
it in the tool is up to you.

## The formats are published

Follow these; they are the contract, versioned, and the site checks against them:

- Analytics files: `<SITE_URL>formats/analytics-v1.schema.json` (JSON Schema, with an example).
- The game list: `<SITE_URL>formats/games-v1.schema.json`. `games.json` carries `"schema": "games-v1"`;
  refuse to use it if that's a version the tool doesn't know.

Validate each export against the analytics schema before writing it. The rest of this
brief explains the lookup and naming, which a schema can't express.

## Background

Today `--export-v1` and the validator UI's **Export v1 JSON** write
`<ttsGameId>.analytics-v1.json` (or `<blackbearId>...`). The site numbers games
1, 2, 3 … per season (game numbers restart every season). It now publishes a
lookup file so the tool can find that number.

## What the site publishes

`<SITE_URL>games.json`, current season only, rebuilt with the site:

```json
{ "schema": "games-v1", "season": 15,
  "games": [{ "num": 77, "date": "2026-11-16", "away": "Sk8Balls", "home": "Whalers",
              "ttsGameId": 88328, "blackbearId": 110413 }] }
```

- `ttsGameId` (TimeToScore `game_id`) is there for every game and never expires.
- `blackbearId` is only there while Black Bear TV lists the game (~30 days), otherwise `null`.
- Team names are the site's spelling (e.g. `Sk8Balls`, not `Sk8 Balls`).
- Default `SITE_URL`: `https://foundry-league-jsa.pages.dev/` (the main site), overridable in `.env`
  (useful for testing against a local build, e.g. `http://localhost:<port>/`).

## What the tool must do

1. **Look up the game number** when exporting: match `ttsGameId` first; only if
   that's missing or not found, match `blackbearId`. If both match different
   games, `ttsGameId` wins.
2. **`--game-num <n>`** overrides the lookup (for games no longer findable, or offline).
3. **Never guess.** If there's no `--game-num` and no match (or `games.json`
   can't be fetched), write no file, exit non-zero, and say so, e.g.
   `No game in <SITE_URL>games.json matches ttsGameId 88328 / blackbearId 110413. Pass --game-num <n>.`
4. **Write the number into the file** as `game.num` (a number).
5. **Name the file `<num>-<slug>.json`**, e.g. `77-sk8balls.json`:
   - `<slug>` = `submittedBy.team` lowercased, each run of non-alphanumeric
     characters replaced by `-`, leading/trailing `-` removed
     (`Sk8Balls` → `sk8balls`, `Kraken Cold Ones` → `kraken-cold-ones`);
   - or `league` when the owner tags a game for the league: support
     `--team league`, which writes `"submittedBy": { "team": "league" }`.
6. **Tell the user where it goes:** `seasons/<season>/analytics/` in the site repo,
   using `season` from `games.json`.
7. Apply the same to the validator UI's export button, not just the CLI flag.
8. Update the README (Option D and the generated-files table).

## The file format (unchanged except `game.num`)

```json
{
  "schema": "analytics-v1",
  "game": { "num": 77, "ttsGameId": 88328, "blackbearId": 110413, "date": "2026-11-16",
            "away": "Sk8Balls", "home": "Whalers",
            "youtubeUrl": "https://www.youtube.com/watch?v=..." },
  "submittedBy": { "team": "Sk8Balls" },
  "goals": [{ "period": 1, "team": "Whalers", "score": "1-0", "videoTime": 95,
              "scorer": { "name": "Ryan Chichester", "jersey": "22" },
              "assist1": null, "assist2": null,
              "shot": { "x": 87, "y": 28 }, "pass": null, "verified": true }]
}
```

Keep everything else exactly as it is today: `score` as `"<home>-<away>"`,
`period` 1/2/3 or `"OT"`, coordinates in feet with centre ice at (0, 0) and the
attacking net on +x, no shootout goals. Team names in `game.away`/`game.home`/
`goals[].team`/`submittedBy.team` should use the site's spelling from `games.json`.

## What the site will reject (so the tool should get right)

The site skips the whole file, with a note to the league owner, when:
- the filename number ≠ `game.num`;
- the filename slug doesn't match `submittedBy.team`;
- `date`, `away`/`home` or `ttsGameId` don't match that game on the site.

It ignores any goal without `verified: true`, and any extra fields (xG, zones, notes).

## Done when

- Tests cover the lookup: found by `ttsGameId`; falls back to `blackbearId`;
  `ttsGameId` wins on disagreement; no match → no file, non-zero exit.
- `npm run analytics -- --export-v1 downloads/110413-validated.analytics.json --team Sk8Balls --verified`
  writes `77-sk8balls.json` with `"num": 77` (against a `games.json` that has game 77 → 88328).
