# Game Analytics (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The static build publishes `games.json` (our game numbers with their rink and Black Bear ids), reads tagged-video analytics files named by our game number, shows a goal map on game pages, corrects goal counts, and shows assists on player pages. The video tool looks up the game number in `games.json`.

**Architecture:** A new pure module `scripts/analytics.js` parses and checks files, picks one version of each goal, and rewrites the sheet's goal events for fully tagged teams. `scripts/data.js` wires it in before `build()`, so everything downstream that reads `events` picks up corrections unchanged. `scripts/build.js` renders the map as static SVG; `src/app.js` adds tap-to-seek using the player from PR #14.

**Tech Stack:** Node (CommonJS), `node --test`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-20-game-analytics-design.md`

**Base branch:** `analytics-design` (already on top of `main`, which has PR #14's `play(videoId, start)` and `npm test`). Task 9 (the video tool) is handed off as a brief; nothing in this plan changes that repo.

## Global Constraints

- Files: `seasons/<n>/analytics/<num>-<slug>.json`, `<num>` = our game number (also in `game.num`), `<slug>` = a team's `slugify(name)` or `league` (must agree with `submittedBy.team`).
- `score` is the tool's string `"<home>-<away>"`. Otherwise the format is what the tool writes today; extra fields are ignored.
- Only goals with `verified: true` are used anywhere.
- Every correction is marked on the page ("video-verified") and listed in the build's data notes (`warn(...)`).
- No league-wide assist or points columns.
- Escape all file text with `esc()`; the only link accepted is `game.youtubeUrl` passing `isYouTube`.
- Pages work at phone width; wide content scrolls inside its box.
- No new dependencies. Commits carry no Claude attribution lines.
- One commit per task on the branch; squash before the PR if the owner prefers one.

## Review Focus

1. **A confirmed goal with no scorer, or a scorer that doesn't match the roster** (goal #12 in the sample file). Expected: on the map labelled as written (or "Unknown"), not counted, and that team is *not* complete for the game, so its sheet counts stay. Test in Task 3.
2. **Both captains' files plus a league file for one game, disagreeing on a scorer.** Expected: the scoring team's file wins, then `league`, then the opponent's. Test in Task 3.
3. **A file whose date, teams or `ttsGameId` don't match game `<num>`**, or a `game.num` that differs from the filename (a wrong lookup or a renamed file). Expected: the whole file is skipped with a data note, and the build still succeeds. Test in Task 2.
4. **The game page with JavaScript off, or a `youtubeUrl` that isn't one of the game's videos.** Expected: rows link to YouTube at `&t=<videoTime>s`, and there's no link when the URL isn't one of the game's videos. Checked in Task 5.
5. **A shootout game.** Expected: shootout goals stay from the sheet. A team's completeness compares against `realGoals` (excluding the SO winner's extra goal). Test in Task 3.

---

### Task 1: Share the player-name matcher

**Files:**
- Modify: `scripts/data.js:127-159` (move `parts`, `NICK`, `firstKey`, `similar`, `canonPlayer` out of `parseWorkbook`)
- Test: `scripts/data.test.js`

**Interfaces:**
- Produces: `makePlayerMatcher(roster: {name, team}[], warn: (msg) => void) => (name: string, teamName?: string) => string`, exported from `scripts/data.js`. It returns the roster name, or `name` unchanged if there's no match. It warns `Treating "<name>" as roster player "<result>"` exactly as today.

- [ ] **Step 1: Write the failing test** `scripts/data.test.js`

```js
test('maps short and nickname forms to roster names', () => {
  const notes = [];
  const canon = makePlayerMatcher([{ name: 'Matthew Angarone', team: 'Reapers' }, { name: 'Jeffrey Truszkowski', team: 'Sk8Balls' }], (m) => notes.push(m));
  assert.equal(canon('Matt Angarone', 'Reapers'), 'Matthew Angarone');
  assert.equal(canon('Jefffrey Truszkowski', 'Sk8Balls'), 'Jeffrey Truszkowski');
  assert.equal(canon('Nobody Here', 'Reapers'), 'Nobody Here');
  assert.equal(notes.length, 2);
});
```

- [ ] **Step 2:** `node --test scripts/data.test.js` → FAIL, `makePlayerMatcher` is not a function.
- [ ] **Step 3:** Move the code to module level as `makePlayerMatcher`. `parseWorkbook` calls `const canonPlayer = makePlayerMatcher(roster, warn)`.
- [ ] **Step 4:** `npm test` → PASS. Then `npm run build` and `git diff --no-index` the `dist/` against a copy made before the change: the only difference is the build timestamp.
- [ ] **Step 5:** Commit `Share the player-name matcher`.

### Task 2: Parse and check analytics files

**Files:**
- Create: `scripts/analytics.js`
- Test: `scripts/analytics.test.js` (fixture objects inline; no fixture files)

**Interfaces:**
- Produces:
  - `parseFileName(file: string) => { num: number, slug: string } | null`, for `/^(\d+)-([a-z0-9-]+)\.json$/`.
  - `checkFile({ file, json, gameByNum, ttsByNum, canonTeam }) => { game, slug, goals: Goal[], notes: string[] } | { skip: string }`
    - `gameByNum`: `Map<num, game>` of parsed games (`num`, `date` as a UTC Date, `home`, `away`, `played`).
    - `ttsByNum`: `Map<gameNum, ttsId>` from `game-center.json`.
    - `canonTeam`: the existing team canonicaliser.
  - `Goal = { period: '1'|'2'|'3'|'OT', team: string /*canonical*/, away: number, home: number, videoTime: number|null, scorer: {name, jersey}|null, assists: {name, jersey}[], shot: {x, y}, pass: {x, y}|null, youtubeUrl: string|null }`

Rules, all from the spec:
- Skip the whole file with a reason when:
  - the name doesn't parse;
  - `schema` isn't `analytics-v1`;
  - `game.num` doesn't equal the filename number;
  - `submittedBy.team` doesn't agree with the slug (`league` ↔ `league`, else `slugify(canonTeam(team))`);
  - no game has that number;
  - the date or teams differ from that game, or `game.ttsGameId` differs from `ttsByNum.get(num)` when both exist;
  - the game isn't `played`;
  - the slug isn't `league` and not `slugify` of either team.
- Drop goals without `verified === true`, without a note.
- Drop a goal with a note when:
  - `period` isn't 1, 2, 3 or "OT";
  - `team` isn't one of the two teams;
  - `score` doesn't match `/^\d+-\d+$/` (home first, then away);
  - the shot is out of range (`|x| ≤ 100`, `|y| ≤ 42.5`; the same for `pass` when present);
  - two goals in the file share a score.
- `videoTime` outside 0–21600 or non-integer → `null`.
- `youtubeUrl` that fails `isYouTube` → `null`.

- [ ] **Step 1: Write the failing tests:**
  - `accepts a valid file and normalises goals`: period `1` becomes `'1'`; score `"2-1"` becomes `home: 2, away: 1`; `assists` collects assist1 and assist2, skipping nulls.
  - `skips a file whose game.num differs from its name`
  - `skips a file whose submittedBy.team disagrees with its slug`
  - `skips a file whose teams don't match the game` (Review Focus 3)
  - `skips a file whose ttsGameId differs from game-center.json` (Review Focus 3)
  - `accepts a file without ttsGameId`
  - `skips a file for an unplayed game`
  - `skips a slug that isn't a team of the game or league`
  - `drops unverified goals silently and bad goals with a note`: one unverified, one with `shot.x = 150`, one duplicate score. Assert 1 goal is kept and `notes.length === 2`.
- [ ] **Step 2:** `node --test scripts/analytics.test.js` → FAIL (module missing).
- [ ] **Step 3:** Implement `parseFileName` and `checkFile` in `scripts/analytics.js`. Import `isYouTube` and `slugify` from `data.js` (export `isYouTube` there), or move both into the new module if a require cycle appears.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `Read analytics files`.

### Task 3: Pick one version of each goal; correct goal events

**Files:**
- Modify: `scripts/analytics.js`
- Test: `scripts/analytics.test.js`

**Interfaces:**
- Consumes: `Goal` from Task 2.
- Produces:
  - `pickGoals(game, entries: {slug, goals: Goal[]}[]) => Goal[]`. One goal per score, sorted by `away + home`, each tagged with `source: slug`. For a goal by team T, the priority is: the file with `slug === slugify(T)`, then `league`, then the other team's file.
  - `correctEvents({ events, games, picked: Map<gameNum, Goal[]>, canonPlayer, warn, realGoals }) => events[]`
    - Canonicalise every scorer and assist with `canonPlayer(name, team)`. A name counts as matched if the result is a roster name; pass `isRosterName` in, or compare against a roster `Set`.
    - For each game and each team, the team is complete when the number of its picked goals with a matched scorer equals `realGoals(game, side)`.
    - For complete teams, replace that team's `type === 'Goal'` events in that game with one event per goal: `{ game, period, team, number: jersey, player, type: 'Goal', detail: '', qty: 1, video: true }`. `SO Goal` and `Penalty` events are untouched.
    - Before replacing, warn once per player whose count changed: `Game #<n>: video has <player> <v> goal(s), sheet has <s>`.
    - Also attach `goal.scorer.player` and `goal.assists[i].player`: the canonical name when matched, else `null`.
    - Warn for each picked goal with no scorer (`Game #<n>: video goal <away>-<home> (<team>) has no scorer; not counted`) or an unmatched name (`Game #<n>: "<name>" (<team>) from video isn't on any roster; not counted`).

- [ ] **Step 1: Write the failing tests:**
  - `scoring team's own file wins, then league, then opponent` (Review Focus 2): three entries disagreeing on the scorer of the 1-0 goal.
  - `a goal only the opponent tagged is still used`
  - `complete team: sheet goals replaced and a note per changed player`
  - `incomplete team keeps sheet goals`: 2 of 3 goals tagged.
  - `a goal with no or unmatched scorer leaves the team incomplete` (Review Focus 1)
  - `shootout: completeness uses realGoals, SO Goal events untouched` (Review Focus 5)
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement both functions.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `Pick goals across files and correct goal counts`.

### Task 4: Publish `games.json`

**Files:**
- Modify: `scripts/data.js`: in the Black Bear block (~line 411) also set `g.blackbearId = id`; in the game-center block (~line 428) set `g.ttsId = Number(id)`.
- Modify: `scripts/build.js`: write `dist/games.json` next to the other generated files (~line 575).

**Interfaces:**
- Produces `dist/games.json`, read by the video tool (Task 9's brief):
  `{ "season": <n>, "games": [{ "num", "date": "YYYY-MM-DD", "away", "home", "ttsGameId": number|null, "blackbearId": number|null }] }`, sorted by `num`, team names as shown on the site (after renames), every scheduled game.
- Produces `g.ttsId` and `g.blackbearId`, used by Task 5.

- [ ] **Step 1:** Add the two fields in `data.js` and write the file in `build.js` (`JSON.stringify(obj, null, 1)`). Archive builds (`--archive <n>`) write it too.
- [ ] **Step 2: Verify:** `npm run build`, then `node -e` on `dist/games.json`: 90 games; game 77 has `ttsGameId: 88328`; each row has exactly the six fields above.
- [ ] **Step 3:** `npm test` → PASS. Commit `Publish games.json for the video tool`.

### Task 5: Wire analytics into the season data

**Files:**
- Modify: `scripts/data.js`:
  - `assemble()`: after game-center loading (~line 424) and before `build(...)`;
  - `build()`: the player log (~line 566), and a new pass for assists.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces, used by Tasks 6–8:
  - `g.analytics = { goals: Goal[] } | undefined` on each game with picked goals.
  - Events gain `video: true` when they come from video.
  - Log entries gain `video: true` when any of the game's goals for that player came from video.
  - Each player gains `p.assists: number` and `p.taggedGames: number[]` (sorted game numbers).
  - Each player gains `p.videoGoals: boolean`.

- [ ] **Step 1:** In `assemble()`:
  - Read `path.join(seasonDir(season), 'analytics')` if it exists (sorted filenames).
  - Build `gameByNum` and `ttsByNum` (from `g.ttsId`, Task 4).
  - Run `checkFile` per file, sending the reasons and notes to `warn` prefixed with the filename.
  - Group by game, `pickGoals`, `correctEvents`, set `g.analytics`.
  - Pass the corrected `events` to `build`.
- [ ] **Step 2:** In `build()`:
  - Set `entry.video = true` for video events.
  - For each player, add `assists` (from `goal.assists[].player`, any team).
  - `taggedGames` = games with `g.analytics` where the player is on the roster of `g.home` or `g.away`, or appears in the game's picked goals.
  - `videoGoals` = any log entry with `video`.
- [ ] **Step 3: Verify.** Make `seasons/15/analytics/77-sk8balls.json` as in Task 10, Step 1, without committing it yet. Then run `npm run build`:
  - the build passes;
  - data notes include `Treating "Jefffrey Truszkowski" as roster player ...` (if that's the roster spelling);
  - there's a note that goal 5-7 (#12) has no scorer;
  - Whalers count as incomplete, so their sheet goals stay;
  - Sk8Balls are complete if all 7 of their goals have matched scorers.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `Load analytics files into the season data`. Commit only code, not the data file.

### Task 6: Goal map on game pages

**Files:**
- Modify: `scripts/build.js`: a new `goalMap(g)` near `videoPlayer` (~line 164), called after `${videoPlayer(g)}` (~line 507); the goal-row mark in `evRows` (~line 526).
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `g.analytics.goals`, `teamColor(name)`, `youTubeId(url)`, `esc`, `playerLink`.
- Produces this markup, which Task 7 relies on:
  - `<section class="goalmap" data-goalmap>`;
  - an SVG of the attacking half (viewBox `0 -42.5 100 85`, x = 0 at centre ice, goal line at 89, net at 89–93, blue line at 25, faceoff dots at (69, ±22));
  - one `<g class="gm-goal" data-i="<n>" data-period="<p>">` per goal, holding a `<circle>` in `teamColor(team)`, plus a dashed `<line>` from pass to shot when a pass exists;
  - period buttons `<button data-period="all|1|2|3|OT" aria-pressed>`, showing only the periods present;
  - an `<ol class="gm-list">` with one `<li data-i="<n>" data-period>` per goal: period, score ("Sk8Balls 3–1"), scorer (`playerLink`, or the name as written in `esc()`, or "Unknown"), and assists in parentheses;
  - the seek link `<a href="https://www.youtube.com/watch?v=<id>&amp;t=<videoTime>s" data-seek data-id="<id>" data-t="<videoTime>">▶</a>`, only when `videoTime !== null` and `youTubeId(goal.youtubeUrl)` equals the id of one of `g.videos` (Review Focus 4).

- [ ] **Step 1:** Implement `goalMap(g)`. Return `''` when there's no `g.analytics`. Add the "video-verified" mark (`<small class="vv" title="Corrected from video">✓ video</small>`) to goal rows of events with `video`.
- [ ] **Step 2:** Add CSS:
  - the map and list sit side by side above 720px and stack below;
  - SVG `width: 100%`, rink lines in `var(--line)`, ice in `var(--surface)`;
  - `.gm-goal.on circle` is enlarged with a stroke;
  - `[hidden]` hides filtered goals.
- [ ] **Step 3: Verify.** Run `npm run build` and check `dist/games/77.html`:
  - 12 `gm-goal` elements;
  - every `▶` href contains `&amp;t=`;
  - no `<script` or unescaped `<` from the file text.
- [ ] **Step 4:** Commit `Goal map on game pages`.

### Task 7: Tap to highlight, filter and seek

**Files:**
- Modify: `src/app.js`, the `[data-player]` block from PR #14, plus a new `[data-goalmap]` block.

**Interfaces:**
- Consumes: Task 6's markup; PR #14's `play(videoId, start)` inside the `[data-player]` block.
- Produces: `box.play = play` set on each `[data-player]` element, and a `setCamera(box, videoId)` helper. That helper does what an `.angle` click does: `aria-pressed`, `open.href`, and showing that camera's `.moments` list.

- [ ] **Step 1:** Expose `play` and `setCamera` on the player box. Make the existing angle click use `setCamera`.
- [ ] **Step 2:** In a `[data-goalmap]` block:
  - clicking a `.gm-goal` or `li[data-i]` toggles `.on` on both elements with that `data-i`;
  - clicking `a[data-seek]` calls `preventDefault`, then `setCamera(box, id)` and `box.play(id, t)`, then scrolls the player into view;
  - period buttons set `hidden` on goals and rows whose `data-period` doesn't match, and update `aria-pressed`.
- [ ] **Step 3: Verify in the browser.** On `localhost:<port>/games/77.html`:
  - tapping goal 10's dot highlights its row;
  - ▶ seeks (the iframe's `src` has `start=` on the first play; later seeks report a `currentTime` within 3 s of `data-t`);
  - the P3 filter leaves 6 dots;
  - at a 390px viewport the map and list stack with no page-level horizontal scroll.
- [ ] **Step 4:** Commit `Tap a goal to jump to it in the video`.

### Task 8: Assists and marks on player and team pages

**Files:**
- Modify: `scripts/build.js`:
  - the player page tiles (~line 750) and its game log (~line 742);
  - the Players table goals cell (~line 715) and the note (~line 726);
  - the team roster G cell (~line 669).

**Interfaces:**
- Consumes: `p.assists`, `p.taggedGames`, `p.videoGoals`, and log `entry.video` from Task 5.

- [ ] **Step 1:**
  - Player page: when `p.taggedGames.length`, add the tile `tile('Assists', p.assists, 'in <n> video-tagged game(s)')`, plus a line listing those games as `gameLink`s.
  - Add the mark after the goals tile when `p.videoGoals`, and on game-log rows with `entry.video`.
- [ ] **Step 2:** Players table and team roster: add the mark next to goal totals for players with `videoGoals`. Extend the note to: `The league records goals only (no assists). Assists from video-tagged games are on player pages.`
- [ ] **Step 3: Verify:** `npm run build`. A Sk8Balls scorer's page from #77 shows the Assists tile and links game 77. A player in no tagged game shows no tile.
- [ ] **Step 4:** Commit `Assists from tagged games on player pages`.

### Task 9: Video tool changes (handed off)

**No changes in the video tool's repo from this plan.** The owner gives `docs/superpowers/specs/2026-11-23-video-tool-game-number-brief.md` to the agent in that repo. Tasks 1-8 don't depend on it; Task 10 can use a hand-edited file until it's done.

### Task 10: First real file and docs

**Files:**
- Create: `seasons/15/analytics/77-sk8balls.json`, **only with the owner's OK** (merging publishes it).
- Modify: `README.md` (`games.json`, how to add a file, the naming, what gets checked), `CLAUDE.md` (new requirement entry; local only), `SPEC.md` (local only).

- [ ] **Step 1:** Export it with the updated tool (Task 9's brief), which names the file and fills `game.num`. Before Task 9 is done, copy `C:\Users\Zakhar\src\zakhark\idea1\downloads\88328.analytics-v1.json` (a Sk8Balls submission, all 12 goals verified) and add `"num": 77` to `game` by hand.
- [ ] **Step 2:** Ask the owner whether to commit the file, and confirm `youtubeUrl` is one of game #77's videos in `game-videos.json`. If it isn't, the ▶ links won't show (by design).
- [ ] **Step 3:** Update the docs. Run `npm test` and `npm run build` one last time and check the data notes.
- [ ] **Step 4:** Commit `Docs for analytics files` (plus the data file if approved). Ask the owner before opening the PR.
