# Hockey league website

A static website generated from the league Google Sheet. It has standings, a filterable schedule, box scores for every game, team pages, player pages, goalie stats, the sub list and game videos.

The spreadsheet stays the single source of truth. Keep entering scores and stats there as you do now, and the site rebuilds from it.

## How it works

1. `npm run fetch` downloads the sheet as `data/sheet.xlsx`. The sheet must be shared as **Anyone with the link can view**.
2. `npm run build` reads the raw tabs, calculates the standings and stats, and writes plain HTML to `dist/`.

The build only reads these tabs:

| Tab | Used for |
| --- | --- |
| Full Season Schedule & Standing (columns A–AA) | Games, scores, OT/SO, starting goalies |
| Player Stats (Source Data) | Goals, shootout goals and penalties per game |
| S## Rosters (e.g. `S15 Rosters`) | Rosters, numbers, positions, captains |
| Sub List | Sub appearances |
| Schedule Updates | The "schedule changes" section |
| Team Links (optional) | Team YouTube and Instagram links |

No other tab is ever read, including Probation List, Notes and Season Comments, so none of their content can end up on the site.

Standings and stats are calculated from the raw data. The formatted summary tabs are not copied. The totals match the sheet's own standings, including the rule that the shootout-winning goal doesn't count toward GF/GA or shutouts.

At the end of each build, a short list of **data notes** is printed. It flags things worth fixing in the sheet, such as a player in the stats who isn't on a roster, or a score that doesn't match the goals entered.

## The spreadsheet ID is a secret

The sheet's ID (the long part of its URL) is **not** in the code. Anyone who has it can open every tab of the sheet, including hidden ones, so it's kept out of this public repository and out of build logs. Provide it as `SHEET_ID`:

- **Locally / Docker:** copy `.env.example` to `.env` and fill it in. `.env` is ignored by git and Docker.
- **GitHub Actions:** add it as a repository secret:
  ```sh
  gh secret set SHEET_ID -R <owner>/<repo>
  ```
- **Cloudflare Pages / Netlify:** add a `SHEET_ID` environment variable in the project settings.

## Run it locally

```sh
npm install
cp .env.example .env   # then put the sheet ID in .env
npm run all            # fetch + rink scores + build
npm run serve          # http://localhost:3000 (or the next free port; it prints the address)
```

## Run it in a container

```sh
cp .env.example .env           # then put the sheet ID in .env
docker compose up -d --build   # http://localhost:3000
```

The `builder` container re-downloads the sheet and rebuilds every 15 minutes (`REFRESH_SECONDS`), and `nginx` serves the result.

## Free hosting on GitHub Pages (recommended)

1. Push this folder to a GitHub repository (the `main` branch).
2. Add the `SHEET_ID` repository secret (see above).
3. In the repo, go to **Settings → Pages → Source** and pick **GitHub Actions**.
4. The workflow in `.github/workflows/deploy.yml` builds and publishes the site on every push and on game nights and the day after: 9, 10 and 11 PM on Fri/Sun/Mon, then 2 AM, 10 AM, 2 PM, 4 PM, 6 PM and 8 PM the next day (Eastern Standard Time; one hour later during daylight saving). It also runs when you click **Actions → Build and deploy → Run workflow** after entering scores. To test a branch without publishing it, pick the branch there and untick **Publish the site** (or `gh workflow run deploy.yml --ref <branch> -f deploy=false`); the built site is attached to the run as an artifact.

## Also publishing to Cloudflare Pages (optional)

The same workflow can upload each build to Cloudflare Pages too, so both sites always match. The upload runs as its own `deploy-cloudflare` job, next to the GitHub Pages `deploy` job, so if one host has a problem the other still updates. The job is skipped until the Cloudflare secrets exist.

1. Create the Pages project once. With Node installed, run `npx wrangler login`, then `npx wrangler pages project create foundry-league-jsa --production-branch main`. The site will be at `https://foundry-league-jsa.pages.dev` (or the name Cloudflare reports if that one is taken). To use a different project name, also set a repository **variable** `CLOUDFLARE_PROJECT` to that name.
2. Create an API token: Cloudflare dashboard → **My Profile → API Tokens → Create Token → Create Custom Token**, with one permission, **Account → Cloudflare Pages → Edit**.
3. Find your account ID: run `npx wrangler whoami`, or look on the **Workers & Pages** overview page.
4. Add both as repository secrets:
   ```sh
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```
5. Run the workflow (**Actions → Build and deploy → Run workflow**). The `deploy-cloudflare` job publishes the site.

Other static hosts, such as Netlify, can also build the site themselves: build command `npm run all`, output directory `dist`, plus the `SHEET_ID` environment variable.

## Customising

- League name, points per win/OTL, etc.: `scripts/config.js`. The league name can also be set with the `LEAGUE_NAME` environment variable.
- Team names: `teamRenames` in `scripts/config.js` shows a team under a different name than the sheet uses (currently "Sk8 Balls" → "Sk8Balls"). It applies everywhere: pages, team page URLs (`teams/sk8balls.html`), logos (`src/logos/sk8balls.png`), calendars, BenchApp files and the sheet's comments. `team-links.json` and the `seasons/` files can use either spelling.
- Look and feel: `src/style.css`. Team colours are picked from words in team names (`COLOR_WORDS` in `scripts/build.js`).
- Team YouTube and Instagram links: fill in `team-links.json`, or add a **Team Links** tab to the spreadsheet with columns `Team`, `YouTube` and `Instagram` (the tab overrides the file). Buttons for them appear on that team's page. Only `https://youtube.com/...`, `https://youtu.be/...` and `https://instagram.com/<handle>` links are accepted.
- Team logos: put an image named after the team in `src/logos/`, e.g. `reapers.jpg` or `kraken-cold-ones.png` (PNG, JPG, WebP or SVG; square works best). Use the team's page name from its URL: `teams/kraken-cold-ones.html` → `kraken-cold-ones`. The logo appears on the team page, on the Teams list and next to the team name across the site. Teams without a logo get a generated placeholder with their initials in the team colour.
- Game videos: `npm run videos` scans the channels in `team-links.json` and saves matches to `seasons/<season>/game-videos.json`. It matches videos by the date and opponent in the title, e.g. "Reapers vs Whalers October 19 2026". The scheduled GitHub build and the container run this automatically. Entries you add or fix by hand in that file are kept. Each game with a video gets a "Watch" button on its game page and a ▶ icon in the schedules.
- Rink game center links: `npm run game-center` opens the rink's TimeToScore schedule page in a local Chrome or Edge, matches its games to ours by date and teams, and saves the IDs in `seasons/<season>/game-center.json`. Run it once per season, or when the rink adds games; the build itself never contacts the rink's site. Game pages then link to the rink's game center and official scoresheet PDF, and team pages to the rink's team page. The rink's schedule page may not list every game, especially early in the season. For those, pass the rink's game IDs from their game-center links: `npm run game-center -- --games 86188,88259-88270`. If no browser is found, save the rendered schedule page and pass it: `npm run game-center -- page.html`. When a new season starts, run `npm run game-center -- --new-season "<the rink's schedule URL for the new season>"`.
- Scores from the rink before the sheet has them: `npm run rink-scores` looks at games that started in the last 36 hours (`rinkScores.hours` in `scripts/config.js`) and still have no score in the sheet. It opens their rink game-center pages in a local Chrome or Edge and saves what it finds to `data/rink-scores.json`, which isn't committed. A game the rink marks Final (or Final/OT, Final/SO) is shown as the result with a small "rink" tag and counts in the standings; its scorers and penalties appear once the sheet is updated. A game still marked Live shows its score as "Live", or "Unofficial" after it should have ended, but isn't counted. As soon as the sheet has a score, the sheet's score is used. The scheduled GitHub build runs this before building; `npm run all` does too. It's best effort: with no browser, or if the rink's site is down, the site builds without it. The container doesn't run it, because its image has no browser.
- Black Bear TV streams: the rink streams games on [Black Bear TV](https://blackbearsports.tv) (a subscription is needed to watch), and keeps them for about 30 days. `npm run blackbear` asks Black Bear TV's events API for the adult-league games at our rink that are finished or live, matches them to our games by date and teams, and saves the watch IDs to `data/blackbear.json` (not committed). Each of those games gets a "Black Bear TV" button on its game page; once a game is gone from Black Bear TV, its button goes too. It needs `BLACKBEAR_API_KEY`, the key blackbearsports.tv's own pages use (in your browser's dev tools, the `api_key=` of a request to `/api/events`): put it in `.env` locally and set it as the `BLACKBEAR_API_KEY` repository secret for GitHub Actions. Like the sheet ID, keep it out of tracked files. Black Bear TV's IDs for the rink and league, and team names it spells differently (e.g. "Ducks" for UnDucks), are under `blackbear` in `scripts/config.js`. The scheduled GitHub build, `npm run all` and the container run it. It's best effort: with no key, or if the API fails, the site builds without these links.
- Team calendars and BenchApp files: every build writes `calendar/<team>.ics` and `benchapp/<team>.csv`. Team pages link to their own files, and the Schedule page has a collapsed "BenchApp import & team calendars" section with every team's files. Both include short instructions.
  - The `.ics` files are calendar feeds people can subscribe to, in phone and computer calendars or BenchApp's calendar sync. Each game keeps the same event ID, so moved games update instead of duplicating.
  - The `.csv` files follow BenchApp's "Import Events" template (dates as DD/MM/YYYY).
  - Settings in `scripts/config.js`:
    - `timeZone`: the sheet's times are local times there.
    - `gameMinutes`: how long each event lasts.
    - `arenas`: full names and street addresses for the sheet's arena codes (the event location; the rink goes in the notes).
    - `benchAppNames`: team names to use in the BenchApp files and calendars when BenchApp spells them differently from the sheet. BenchApp matches teams by exact name. Empty by default; for a name change everywhere, use `teamRenames` instead.
    - `siteUrl`: used for links inside events; it can also be set with `SITE_URL`.

## Seasons

Each season has its own folder, `seasons/<n>/` (e.g. `seasons/15/`). It holds that season's game videos and rink game-center links, which are tied to game numbers that restart every season. The current season number comes from the workbook's `S## Rosters` tab. Team logos and team links are shared by all seasons.

When a season is over, it's frozen: `npm run freeze-season` saves the season's parsed data to `seasons/<n>/archive.json`. That's only what the site shows (schedule, scores, goals and penalties, rosters, subs), never the workbook or its private tabs. A frozen season builds without its spreadsheet: `node scripts/build.js --archive 15 --out dist-archive`.

### Season rollover checklist

1. **Freeze the old season** once its last game (including playoffs) is in the sheet: `npm run fetch && npm run freeze-season`. Commit `seasons/<n>/archive.json`.
2. **Switch to the new spreadsheet.** Put its ID in `.env` and update the GitHub secret: `gh secret set SHEET_ID -R <owner>/<repo>`. Make sure it's shared as "Anyone with the link can view" and has the same tabs (with the roster tab renamed, e.g. `S16 Rosters`).
3. **Fetch it:** `npm run fetch && npm run build`. Check the build's data notes, e.g. for players not on a roster.
4. **Link the rink's game center:** `npm run game-center -- --new-season "<the rink's schedule URL for the new season>"`.
5. **New teams:** add their logos to `src/logos/` and their links to `team-links.json`.
6. Commit on a branch, open a PR and merge. The site then shows the new season.


Showing archived seasons on the site (a season switcher, with past seasons under `/seasons/<n>/`) is planned before season 16.
