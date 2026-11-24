# Game analytics from tagged video (phase 1)

Date: 2026-11-20, revised 2026-11-23. Status: draft for the owner's approval.

## Why

The league's video tool (a separate repo) lets a person step through a game
video and confirm each goal: scorer, assists, where the shot came from and
where the pass came from. The owner wants that data on the site so that:

- game pages show where each goal was scored, linked to the moment in the video;
- player pages show assists, which the league sheet doesn't record at all;
- goal counts the sheet got wrong are corrected from what the video shows.

Later, team captains will tag their own games with the same tool.

## Phases

1. **This document:** the site reads analytics files kept in this repo.
2. Later: captains submit files through a Cloudflare Access login and a small
   Cloudflare function that opens a pull request. Until then, captains send
   files to the owner, who adds them by PR.
3. Later: a browser version of the tagging tool so captains don't have to
   install anything.

## Goals

- One file per game per submitter, added by PR like every other change.
- Confirmed goals correct the sheet's goal counts and add assists.
- A half-rink goal map on game pages, with each goal linked to the video.
- Assists on player pages, limited to tagged games and clearly labelled.

## Non-goals (phase 1)

- Submitting through the site, logins, a browser tagger (phases 2 and 3).
- Heatmaps on player and team pages, and a league-wide analytics page. Wait
  until enough games are tagged.
- xG, AI play descriptions, shot types.
- Merging the two repos or sharing code between them. The JSON format is the
  only contract.

## Anti-goals

- **AI guesses on the site.** Only goals a person confirmed (`verified: true`)
  are used, anywhere. Everything else in the file is ignored.
- **Silent changes to the sheet's numbers.** Every correction is marked on the
  page and listed in the build's data notes.
- **An assists leaderboard that rewards the teams that tag the most games.**
  No league-wide assist or points columns.
- A database, a server, or paid hosting.

## Constraints

- Static site built by `scripts/build.js`, published on merge to `main`.
  Free hosting only.
- The sheet stays the source of truth for everything the files don't cover.
  The sheet records **goals only** (per player, game and period, with a
  quantity) and no assists, so goals can't be matched to sheet rows one by one.
- Escape all text from the files in the HTML. Only accept YouTube links.
- Pages must work at phone width.
- Past seasons are rebuilt from `seasons/<n>/`, so the files live per season.

## Approaches considered

| | Approach | Trade-off | |
|---|---|---|---|
| A | JSON files in the repo, merged by the static build; changes by PR | $0, version history, review built in; captains can't submit directly yet | **Picked** |
| B | Database plus a dynamic site with an upload page | Captains upload directly; costs money or free-tier limits, a server to maintain, and loses review-by-PR | Rejected: the owner wants to approve every change, so a PR is enough |
| C | Merge the video-tool repo into this one | Shared code; but 4 GB videos, AI keys and Playwright next to a site that builds in CI | Rejected for now; the JSON format keeps the repos independent |

## Game numbers for the video tool (`games.json`)

The build publishes `games.json` at the site root for the current season (an
archived season gets its own under `/seasons/<n>/` once the season switcher
exists). Everything in it is already public on the game pages:

```json
{ "season": 15,
  "games": [{ "num": 42, "date": "2026-11-16", "away": "Sk8Balls", "home": "Whalers",
              "ttsGameId": 88328, "blackbearId": 110413 }] }
```

- `ttsGameId` comes from `seasons/<n>/game-center.json` and never expires.
- `blackbearId` comes from `data/blackbear.json`, so it's only there while
  Black Bear TV still lists the game (~30 days), otherwise `null`.

The video tool downloads this file and finds our game number by `ttsGameId`
first, then by `blackbearId`. It writes that number into the file and into the
filename. Changes to the tool live in its own repo; see "Changes to the video
tool" below.

## The file format (`analytics-v1`)

Made by the video tool's export. One file per game per submitter, at
`seasons/<n>/analytics/<num>-<slug>.json`, where `<num>` is our game number
(they restart each season, so the season comes from the folder) and `<slug>` is
the submitting team's slug used in page URLs (e.g. `42-sk8balls.json`) or
`league` for the owner's own tagging (`42-league.json`).

```json
{
  "schema": "analytics-v1",
  "game": { "num": 42, "ttsGameId": 88328, "blackbearId": 110413, "date": "2026-11-16",
            "away": "Sk8Balls", "home": "Whalers",
            "youtubeUrl": "https://www.youtube.com/watch?v=..." },
  "submittedBy": { "team": "Sk8Balls" },
  "goals": [{
    "period": 1, "team": "Whalers", "score": "1-0",
    "videoTime": 95,
    "scorer":  { "name": "Ryan Chichester", "jersey": "22" },
    "assist1": null, "assist2": null,
    "shot": { "x": 87, "y": 28 },
    "pass": null,
    "verified": true
  }]
}
```

This is what the tool writes today, plus `game.num`.

- `game.num`: our game number, the same as in the filename.
- `submittedBy.team`: the submitting team, or `"league"`. Must agree with the
  filename's slug.
- `period`: 1, 2, 3 or `"OT"`.
- `score`: the score after the goal as `"<home>-<away>"`, the order the tool
  writes it in (e.g. "1-0" for a home goal).
- `videoTime`: seconds into the video at `youtubeUrl`.
- `shot` / `pass`: feet on a standard 200×85 rink, centre ice at (0, 0), the
  shooter attacking the net on the +x side (goal line at x = 89).
- Regular-time and overtime goals only. Shootout goals stay from the sheet.
- Anything else the tool adds (xG, zones, AI notes) is ignored.

## How the build uses the files

### Loading and checks (`scripts/data.js`)

For each file in `seasons/<n>/analytics/`:

- The number in the filename must equal `game.num`, and the slug must agree
  with `submittedBy.team`. Otherwise the whole file is skipped with a data note.
- The game is found by that number in season `<n>`. Its date and both teams
  must match the file (team names through the usual renames), and so must
  `ttsGameId` when both the file and `game-center.json` have one. Otherwise the
  whole file is skipped with a data note, so a wrong lookup never attaches
  stats to the wrong game. Files for games that aren't played in the sheet yet
  are skipped the same way.
- The slug must be one of the game's two teams or `league`. Otherwise skip
  with a data note.
- Goals without `verified: true` are dropped. Numbers out of range, an unknown
  `team`, a malformed `score`, or two goals in one file with the same score
  drop that goal, with a data note.
- Names are mapped to roster names the same way sheet names are (nicknames,
  short forms). A scorer or assister that can't be matched is reported in the
  data notes. That goal still appears on the goal map, labelled as written, but
  doesn't count toward anyone's stats.

### Choosing one version of each goal

Goals from different files are the same goal when they have the same `score`.
For a goal scored by team A, the first file that has it confirmed wins:

1. team A's file;
2. the `league` file;
3. the opposing team's file.

The result is one list of confirmed goals per game.

### Correcting goal counts

The sheet can't be matched goal by goal, so corrections work per team per game:

- If the confirmed goals for a team in a game number exactly that team's goals
  in the final score (excluding the shootout), the video is complete for that
  team. Its per-player, per-period goal counts **replace** the sheet's for that
  team in that game. Each player whose count changed gets a data note
  ("Game #42: video has Kornfield 3 goals, sheet has 2").
- Otherwise the sheet's goal counts stay as they are, and the confirmed goals
  only add assists and map positions.

### Assists

Assists come only from confirmed goals, primary and secondary counted together
as "A". A player's assists are always shown next to the number of their games
that were tagged.

## What appears on the pages

- **Game page:** when the game has confirmed goals, a half-rink goal map below
  the video. One dot per goal in the scoring team's colour, a dashed line from
  the pass position when there is one, and period filters (All, 1, 2, 3, OT).
  Next to it, or below on a phone, a goal list: period, score, scorer and
  assists. Tapping a dot or a row highlights both and jumps the embedded
  player to `videoTime`, switching to that camera, using the seek code from
  the video-moments change (PR #14). If `youtubeUrl` isn't one of that game's
  videos, the row shows no video link. Without JavaScript, each row links to
  YouTube at that time. A goal from a corrected team carries a small
  "video-verified" mark.
- **Player page:** "Assists (video-tagged games): 3 in 2 games", plus which
  games those were. Corrected goal counts carry the "video-verified" mark.
- **Players table, standings, team pages:** goal totals include corrections
  (marked). No assist or points columns.
- The Players page's note "The league records goals only (no assists)" gets
  a line saying assists from tagged games are on player pages.

## Changes to the video tool (its own repo)

- Download `games.json` from the site and look up `game.num` by `ttsGameId`,
  then `blackbearId`.
- Write `game.num` into the export and name the file `<num>-<slug>.json`.
- If no game matches, stop and say so, and let the user give the number with
  `--game-num`. Never guess a number.

## Left to the builder

- The rink drawing (static SVG generated by the build), marker styling, and
  where exactly the mark and the tagged-games line go.
- Test layout. The file checks, the priority rule and the goal-count
  correction each need `node --test` tests.
- Updating `README.md` (how to add a file), `SPEC.md` and `CLAUDE.md`.

## Calls made in this document (not discussed with the owner)

- Goal counts are only replaced when the video covers all of a team's goals
  in that game. A partly tagged team keeps the sheet's counts.
- The `league` file ranks above the opposing captain's file.
- Unmatched names stay on the map but don't count.
- Primary and secondary assists are counted together.
- Depends on PR #14 (video moments) for the seek code.
- Files are named by our game number and carry it inside too (the owner's
  choice, 2026-11-23). The video tool looks it up in a published `games.json`.
- The site reads `score` and `submittedBy` as the tool writes them today,
  rather than asking the tool to change its format.
- The tool refuses to guess a game number; `--game-num` overrides.
