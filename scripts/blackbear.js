// Links our games to their streams on Black Bear TV (blackbearsports.tv/watch/<id>).
//
//   npm run blackbear       (CI runs this before every build)
//
// Asks Black Bear TV's events API for the adult-league games at our rink that
// can be watched now (finished or live), matches them to our games by date and
// teams, and saves the watch IDs in data/blackbear.json (not committed) for the
// build. Black Bear TV keeps games for about 30 days, so this list is the
// source of truth: a game that's gone from it gets no link.
//
// The API key is the one blackbearsports.tv's own pages use. It's kept out of
// the code, like the sheet ID: BLACKBEAR_API_KEY in .env locally, and the
// BLACKBEAR_API_KEY repository secret in GitHub Actions.
//
// Best effort: with no key, or if the API fails, it saves an empty list and
// exits normally, so the site builds without Black Bear TV links.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { load } = require('./data');
const { norm } = require('./game-center');

const BB = config.blackbear;

// Every event page by page: [{ id, name: "Away @ Home", event_utc_ts }, ...]
async function fetchEvents(key) {
  const events = [];
  for (let offset = 0; ; offset += 100) {
    const q = new URLSearchParams({ limit: 100, offset, sort_direction: 'desc', location: BB.location, recursively_categories: 1, api_key: key });
    q.append('categories[]', BB.category);
    for (const s of ['finished', 'live']) q.append('stream_status[]', s);
    const res = await fetch(`${BB.api}/api/events?${q}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data, meta } = await res.json();
    events.push(...data);
    if (!data.length || events.length >= meta.total) return events;
  }
}

async function main() {
  const D = load(config.dataFile, { rink: false });
  const result = { _comment: 'Black Bear TV watch IDs by game number. Written by "npm run blackbear"; not committed.', season: D.season, games: {} };
  const save = () => {
    fs.mkdirSync(path.dirname(BB.file), { recursive: true });
    fs.writeFileSync(BB.file, `${JSON.stringify(result, null, 2)}\n`);
  };
  const key = process.env.BLACKBEAR_API_KEY;
  if (!key) {
    console.log('No BLACKBEAR_API_KEY set; skipping Black Bear TV links.');
    return save();
  }

  const events = await fetchEvents(key);
  const team = (name) => { const n = norm(name); return norm(BB.teamNames[name] || '') || n; };
  const pair = (a, b) => [team(a), team(b)].sort().join('|');
  const ymd = (ts) => new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: config.timeZone });
  for (const e of events) {
    const [away, home] = String(e.name).split(' @ ');
    if (!home || !Number.isInteger(e.id)) continue;
    const g = D.games.find((x) => x.date && !x.tbd && x.date.toISOString().slice(0, 10) === ymd(e.event_utc_ts) && pair(x.away, x.home) === pair(away, home));
    if (g) result.games[g.num] = e.id;
  }
  save();
  console.log(`${events.length} event(s) on Black Bear TV; ${Object.keys(result.games).length} of them are our games. Saved to ${BB.file}.`);
}

main().catch((e) => {
  // Never stop the build over this, but don't leave an old list behind either.
  fs.rmSync(BB.file, { force: true });
  console.warn(`Black Bear TV links skipped: ${e.message}`);
});
