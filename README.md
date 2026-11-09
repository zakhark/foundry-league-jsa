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
npm run all            # fetch + build
npm run serve          # http://localhost:8080
```

## Run it in a container

```sh
cp .env.example .env           # then put the sheet ID in .env
docker compose up -d --build   # http://localhost:8080
```

The `builder` container re-downloads the sheet and rebuilds every 15 minutes (`REFRESH_SECONDS`), and `nginx` serves the result.

## Free hosting on GitHub Pages (recommended)

1. Push this folder to a GitHub repository (the `main` branch).
2. Add the `SHEET_ID` repository secret (see above).
3. In the repo, go to **Settings → Pages → Source** and pick **GitHub Actions**.
4. The workflow in `.github/workflows/deploy.yml` builds and publishes the site on every push and on game nights and the day after: 9, 10 and 11 PM on Fri/Sun/Mon, then 2 AM, 10 AM, 2 PM, 4 PM, 6 PM and 8 PM the next day (Eastern Standard Time; one hour later during daylight saving). It also runs when you click **Actions → Build and deploy → Run workflow** after entering scores.

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
- Look and feel: `src/style.css`. Team colours are picked from words in team names (`COLOR_WORDS` in `scripts/build.js`).
- Team YouTube and Instagram links: fill in `team-links.json`, or add a **Team Links** tab to the spreadsheet with columns `Team`, `YouTube` and `Instagram` (the tab overrides the file). Buttons for them appear on that team's page. Only `https://youtube.com/...`, `https://youtu.be/...` and `https://instagram.com/<handle>` links are accepted.
- Team logos: put an image named after the team in `src/logos/`, e.g. `reapers.jpg` or `kraken-cold-ones.png` (PNG, JPG, WebP or SVG; square works best). Use the team's page name from its URL: `teams/kraken-cold-ones.html` → `kraken-cold-ones`. The logo appears on the team page, on the Teams list and next to the team name across the site. Teams without a logo show their initials in the team colour.
- Game videos: `npm run videos` scans the channels in `team-links.json` and saves matches to `seasons/<season>/game-videos.json`. It matches videos by the date and opponent in the title, e.g. "Reapers vs Whalers October 19 2026". The scheduled GitHub build and the container run this automatically. Entries you add or fix by hand in that file are kept. Each game with a video gets a "Watch" button on its game page and a ▶ icon in the schedules.
- Rink game center links: `npm run game-center` opens the rink's TimeToScore schedule page in a local Chrome or Edge, matches its games to ours by date and teams, and saves the IDs in `seasons/<season>/game-center.json`. Run it once per season, or when the rink adds games; the build itself never contacts the rink's site. Game pages then link to the rink's game center and official scoresheet PDF, and team pages to the rink's team page. The rink's schedule page may not list every game, especially early in the season. For those, pass the rink's game IDs from their game-center links: `npm run game-center -- --games 86188,88259-88270`. If no browser is found, save the rendered schedule page and pass it: `npm run game-center -- page.html`. When a new season starts, run `npm run game-center -- --new-season "<the rink's schedule URL for the new season>"`.

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
