// Fills in scores the league sheet doesn't have yet from the rink's game center.
//
//   npm run rink-scores
//
// On game nights the sheet is usually updated a day or so after the games, but
// the rink's scorekeeper enters scores during the game. This script looks at
// games that started in the last config.rinkScores.hours hours, have no score
// in the sheet and are linked in seasons/<n>/game-center.json, and renders
// their rink game pages with a local Chrome/Edge (like game-center.js; it never
// calls the TimeToScore API). What it finds is saved in data/rink-scores.json,
// which the build reads:
//   - "Final", "Final/OT", "Final/SO": shown as the result and counted in the
//     standings, marked as coming from the rink.
//   - "Live" (the game is on, or the scorekeeper hasn't closed it yet): the
//     score is shown, but the game isn't counted.
// As soon as the sheet has the score, the sheet wins and the rink's is ignored.
//
// Best effort: with no browser, or if the rink's site is down, it saves an
// empty file and exits normally, so the build goes on without rink scores.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { load, seasonDir } = require('./data');
const { startOf } = require('./calendar');
const { findBrowser, renderPage, norm, MONTHS } = require('./game-center');

const OUT = config.rinkScores.file;

const strip = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
const texts = (html, cls) => [...html.matchAll(new RegExp(`class="${cls}"[^>]*>([\\s\\S]*?)</div>`, 'g'))].map((m) => strip(m[1]));

// Reads a rendered rink game page: status, date, teams (away first), scores,
// and goals by period from the "Scoring Summary" table.
function parseResult(html) {
  const st = /class="game-status ([^"]*)"[^>]*>([^<]*)</.exec(html);
  const meta = (/class="game-meta"[^>]*>([^<]*)</.exec(html) || [])[1] || '';
  const d = /(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})/.exec(meta);
  const names = texts(html, 'game-team-name');
  const scores = texts(html, 'game-team-score').map((s) => (/^\d+$/.test(s) ? Number(s) : null));
  if (!st || !d || names.length !== 2 || scores.length !== 2 || scores.includes(null)) return null;
  const status = /final/i.test(st[2]) ? 'final' : /live/i.test(st[1] + st[2]) ? 'live' : '';
  const out = {
    status,
    statusText: st[2].trim(),
    ymd: `${d[3]}-${String(MONTHS[d[1].slice(0, 3)]).padStart(2, '0')}-${d[2].padStart(2, '0')}`,
    teams: names.map((name, i) => ({ name, score: scores[i] })),
    ot: /OT|SO/i.test(st[2]),
    so: /SO/i.test(st[2]),
  };
  // Goals by period: header "Team 1 2 3 OT1 SO T", then the away and home rows.
  const table = /<table class="game-summary-table">([\s\S]*?)<\/table>/.exec(html);
  if (table) {
    const heads = [...table[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => strip(m[1]));
    const rows = [...table[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(1)
      .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => strip(c[1])));
    const cols = heads.map((h, i) => [h.replace(/^OT\d*$/, 'OT'), i]).filter(([h]) => /^(1|2|3|OT|SO)$/.test(h));
    if (rows.length === 2 && cols.length) {
      out.periods = cols.map(([h, i]) => ({ period: h, goals: rows.map((r) => Number(r[i]) || 0) }));
    }
  }
  return out;
}

function main() {
  const D = load(config.dataFile, { rink: false }); // the sheet alone, so last run's rink scores are looked up again
  const gcFile = path.join(seasonDir(D.season), 'game-center.json');
  const gc = fs.existsSync(gcFile) ? JSON.parse(fs.readFileSync(gcFile, 'utf8')) : null;
  const result = { _comment: 'Scores from the rink\'s game center for games the sheet has no score for yet. Written by "npm run rink-scores"; not committed.', season: D.season, fetchedAt: new Date().toISOString(), games: {} };
  const save = () => {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  };

  const now = Date.now();
  const since = now - config.rinkScores.hours * 3600 * 1000;
  const ids = gc && String(gc.ourSeason) === String(D.season) ? gc.games || {} : {};
  const due = D.games.filter((g) => {
    if (g.played || g.tbd || !ids[g.num]) return false;
    const start = startOf(g);
    return start && start.getTime() <= now && start.getTime() >= since;
  });
  if (!due.length) {
    console.log(`No games without a score in the last ${config.rinkScores.hours} hours.`);
    save();
    return;
  }
  if (!findBrowser()) {
    console.log('No Chrome or Edge found (set BROWSER=/path/to/chrome); skipping rink scores.');
    save();
    return;
  }

  for (const g of due) {
    const label = `#${g.num} ${g.away} @ ${g.home}`;
    let r;
    try {
      r = parseResult(renderPage(`${gc.site}/game-center-widget/?game=${ids[g.num]}&league=${gc.league}&season=${gc.season}`));
    } catch (e) {
      console.warn(`  ${label}: couldn't open the rink's page (${e.message.split('\n')[0]})`);
      continue;
    }
    if (!r || !r.status) { console.log(`  ${label}: no score at the rink yet`); continue; }
    // Make sure it's the same game: same date and teams, in either order.
    const [a, h] = r.teams;
    const flip = norm(a.name) === norm(g.home) && norm(h.name) === norm(g.away);
    if (!flip && !(norm(a.name) === norm(g.away) && norm(h.name) === norm(g.home))) {
      console.warn(`  ${label}: the rink's page is ${a.name} @ ${h.name}; skipped`);
      continue;
    }
    if (r.ymd !== g.date.toISOString().slice(0, 10)) {
      console.warn(`  ${label}: the rink's page is dated ${r.ymd}; skipped`);
      continue;
    }
    const [away, home] = flip ? [h, a] : [a, h];
    const entry = { status: r.status, statusText: r.statusText, awayScore: away.score, homeScore: home.score, ot: r.ot, so: r.so };
    if (r.periods) entry.periods = r.periods.map((p) => ({ period: p.period, away: p.goals[flip ? 1 : 0], home: p.goals[flip ? 0 : 1] }));
    result.games[g.num] = entry;
    console.log(`  ${label}: ${away.score}–${home.score} (${r.statusText} at the rink)`);
  }
  save();
  console.log(`Saved ${Object.keys(result.games).length} rink score(s) to ${OUT}.`);
}

try {
  main();
} catch (e) {
  // Never stop the build over this.
  console.warn(`Rink scores skipped: ${e.message}`);
}
