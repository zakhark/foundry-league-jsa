// Links our games and teams to the rink's TimeToScore game center.
//
//   npm run game-center                 # renders the rink's schedule page with a local Chrome/Edge
//   npm run game-center -- page.html    # or reads a saved, already-rendered copy of that page
//   npm run game-center -- --games 86188,88259-88270
//                                       # or opens specific rink game pages (for games the
//                                       # schedule page doesn't list, e.g. early-season ones)
//   npm run game-center -- --new-season "https://foundryadulthockey.com/schedule/?league=9&season=177&level=628"
//                                       # starts over for a new season: takes the rink's
//                                       # league/season/level from its schedule URL
//
// Our game numbers restart every season, so game-center.json records which of
// our seasons it belongs to ("ourSeason", from the S## Rosters tab). The site
// ignores it when the workbook is on a different season, and this script
// refuses to add to it until it's started over with --new-season.
//
// The rink's schedule page is built in the browser by a script, so it has to be
// rendered first. The schedule is set for the season, so run this once per
// season (or when the rink adds games). The results are saved in
// seasons/<season>/game-center.json; the site build only reads that file and never contacts the
// rink's site.
//
// Games are matched by date and the two teams. Rink game IDs that are already
// in game-center.json are kept.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');
const { load, seasonDir } = require('./data');

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

function findBrowser() {
  const candidates = [
    process.env.BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

function renderPage(url) {
  const browser = findBrowser();
  if (!browser) throw new Error('No Chrome or Edge found. Set BROWSER=/path/to/chrome, or pass a saved copy of the page.');
  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gc-'));
  try {
    return execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--virtual-time-budget=20000',
      `--user-data-dir=${profile}`, '--dump-dom', url,
    ], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

// Reads game rows from the rendered page.
// Reads one rendered game page: "Friday, September 4, 2026 · 09:10 PM · ..." plus
// the away and home team names. Team IDs aren't shown there, so they're omitted.
function parseGamePage(html, id) {
  const text = (cls) => [...html.matchAll(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</`, 'g'))].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
  const meta = text('game-meta')[0] || '';
  const d = /(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})/.exec(meta);
  const names = text('game-team-name').filter(Boolean);
  if (!d || names.length < 2) return null;
  const ymd = `${d[3]}-${String(MONTHS[d[1].slice(0, 3)]).padStart(2, '0')}-${d[2].padStart(2, '0')}`;
  return { id: String(id), ymd, teams: [{ name: names[0] }, { name: names[1] }] };
}

function parseRows(html) {
  const rows = [];
  let year = '', date = '';
  // Rows can carry extra classes/attributes (e.g. today's games: class="sched-row is-today"
  // id="today-anchor") and date rows extra markup (a "TODAY" pill), so match loosely.
  const re = /<tr class="sched-month-row"[^>]*id="month-(\d{4})-\d\d"|<tr class="sched-date-row"[^>]*>\s*<td[^>]*>([^<]*)|<tr class="sched-row\b[^"]*"[^>]*data-game-id="(\d+)"[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) { year = m[1]; continue; }
    if (m[2]) { date = m[2]; continue; }
    const teams = [...m[4].matchAll(/team=(\d+)[^"]*"[\s\S]*?sched-team-nick">([^<]*)</g)].map((x) => ({ id: x[1], name: x[2].trim() }));
    const md = /(\w{3}) (\d{1,2})$/.exec(date.trim());
    if (teams.length !== 2 || !md || !year) continue;
    rows.push({ id: m[3], ymd: `${year}-${String(MONTHS[md[1]]).padStart(2, '0')}-${md[2].padStart(2, '0')}`, teams });
  }
  return rows;
}

// "Green Goombas (F)" -> "greengoombas", "unDucks" -> "unducks"
const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');

function main() {
  const D = load(config.dataFile);
  const FILE = path.join(seasonDir(D.season), 'game-center.json');
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  let args = process.argv.slice(2);
  let saved = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : null;

  if (args[0] === '--new-season') {
    let u;
    try { u = new URL(args[1]); } catch { u = null; }
    const ids = u && ['league', 'season', 'level'].map((k) => Number(u.searchParams.get(k)));
    if (!ids || ids.some((n) => !n)) {
      throw new Error('Usage: npm run game-center -- --new-season "<rink schedule URL with league=, season= and level=>"');
    }
    const [league, season, level] = ids;
    if (saved && saved.season === season && saved.league === league && saved.level === level && saved.ourSeason !== String(D.season)) {
      throw new Error(`That URL is still the rink's season ${season}, the one game-center.json already uses. Use the rink's schedule URL for the new season.`);
    }
    console.log(`Starting over for our season ${D.season} (rink league ${league}, season ${season}, level ${level})`);
    saved = { site: `${u.protocol}//${u.host}`, league, season, level, ourSeason: String(D.season) };
    args = args.slice(2);
  } else if (!saved) {
    throw new Error('No game-center.json yet. Start with: npm run game-center -- --new-season "<rink schedule URL>"');
  } else if (saved.ourSeason !== String(D.season)) {
    throw new Error(
      `game-center.json is for season ${saved.ourSeason}, but the workbook is on season ${D.season}. ` +
        'Start over with: npm run game-center -- --new-season "<the rink\'s schedule URL for the new season>"'
    );
  }

  const gc = {
    _comment: 'Links to the rink\'s TimeToScore game center for one of our seasons. Written by "npm run game-center"; safe to edit by hand.',
    teams: {}, games: {},
    ...saved,
  };
  const scheduleUrl = `${gc.site}/schedule/?league=${gc.league}&season=${gc.season}&level=${gc.level}`;

  let rows;
  if (args[0] === '--games') {
    // Specific rink game IDs, e.g. "86188,88259-88270": open each game page.
    const ids = (args[1] || '').split(',').flatMap((part) => {
      const [a, b] = part.split('-').map(Number);
      return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
    }).filter(Boolean);
    if (!ids.length) throw new Error('Usage: npm run game-center -- --games 86188,88259-88270');
    rows = [];
    for (const id of [...new Set(ids)]) {
      const url = `${gc.site}/game-center-widget/?game=${id}&league=${gc.league}&season=${gc.season}`;
      const r = parseGamePage(renderPage(url), id);
      if (r) { rows.push(r); console.log(`  ${id}: ${r.ymd} ${r.teams[0].name} @ ${r.teams[1].name}`); } else console.warn(`  ${id}: couldn't read the game page`);
    }
  } else {
    console.log(args[0] ? `Reading ${args[0]}` : `Rendering ${scheduleUrl}`);
    rows = parseRows(args[0] ? fs.readFileSync(args[0], 'utf8') : renderPage(scheduleUrl));
    if (!rows.length) throw new Error('No games found on the page. Did it render? (A saved copy must be the rendered page.)');
    console.log(`${rows.length} games on the rink's schedule`);
  }

  const ourTeams = new Map(D.standings.map((t) => [norm(t.name), t.name]));
  const byKey = new Map();
  for (const r of rows) {
    for (const t of r.teams) {
      const ours = ourTeams.get(norm(t.name));
      if (!ours) console.warn(`  rink team "${t.name}" doesn't match any of our teams`);
      else if (t.id) gc.teams[ours] = Number(t.id);
    }
    byKey.set(`${r.ymd}|${r.teams.map((t) => norm(t.name)).sort().join('|')}`, r);
  }

  let added = 0;
  const missing = [];
  for (const g of D.games) {
    if (g.tbd || !g.date) continue;
    const key = `${g.date.toISOString().slice(0, 10)}|${[norm(g.home), norm(g.away)].sort().join('|')}`;
    const r = byKey.get(key);
    if (!r) { if (!gc.games[g.num]) missing.push(`#${g.num} ${g.dateText} ${g.away} @ ${g.home}`); continue; }
    if (gc.games[g.num] !== Number(r.id)) added++;
    gc.games[g.num] = Number(r.id);
  }

  gc.games = Object.fromEntries(Object.entries(gc.games).sort((a, b) => a[0] - b[0]));
  fs.writeFileSync(FILE, `${JSON.stringify(gc, null, 2)}\n`);
  console.log(`${added} new or changed game link(s); ${Object.keys(gc.games).length} games and ${Object.keys(gc.teams).length} teams linked. Saved ${FILE}.`);
  if (missing.length) console.log(`Not on the rink's schedule (${missing.length}):\n  ${missing.join('\n  ')}`);
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
