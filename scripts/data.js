// Reads the league workbook and turns it into a clean data model.
//
// Only these tabs are read: the schedule, the raw per-game stat events, the
// season roster, the sub list, schedule updates and the optional Team Links tab.
// Other tabs (e.g. internal notes or disciplinary lists) are never read, so
// they can never end up on the website.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const config = require('./config');

const LINKS_FILE = 'team-links.json';
const SEASONS_DIR = 'seasons';
const isYouTube = (url) => /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(String(url || ''));
const isInstagram = (url) => /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]+\/?$/i.test(String(url || ''));
const LINK_VALIDATORS = { youtube: isYouTube, instagram: isInstagram };

const SHEETS = {
  schedule: 'Full Season Schedule & Standing',
  events: 'Player Stats (Source Data)',
  subs: 'Sub List',
  updates: 'Schedule Updates',
  links: /^team links$/i, // optional: columns "Team" and "YouTube"
  rosters: /^S(\d+) Rosters$/,
};

// "Sk8 Balls" -> "Sk8Balls" (config.teamRenames), matched case-insensitively.
const RENAMES = new Map(Object.entries(config.teamRenames || {}).map(([from, to]) => [from.toLowerCase(), to]));
const renameTeam = (name) => (name && RENAMES.get(String(name).toLowerCase())) || name;
// The same renames inside free text from the sheet, e.g. schedule comments.
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const renameInText = (text) => {
  let t = text;
  for (const [from, to] of RENAMES) t = t && t.replace(new RegExp(`\\b${escRe(from)}\\b`, 'gi'), to);
  return t;
};

const warnings = [];
const warn = (msg) => warnings.push(msg);

function getSheet(wb, name) {
  const real = name instanceof RegExp ? wb.SheetNames.find((n) => name.test(n)) : name;
  const ws = real && wb.Sheets[real];
  if (!ws) throw new Error(`Sheet not found: ${name}`);
  return { name: real, ws };
}

function rowsOf(ws) {
  return XLSX.utils
    .sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true })
    .map((r) => r.map((v) => String(v).replace(/\s+/g, ' ').trim()));
}

// Drops everything above the header row (the first row containing `marker`).
function fromHeader(rows, marker, sheetName) {
  const i = rows.findIndex((r) => r.includes(marker));
  if (i < 0) throw new Error(`${sheetName}: header row with "${marker}" not found`);
  return rows.slice(i);
}

// Returns a lookup function for the first column with a given header.
function columns(header, sheetName) {
  return (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${sheetName}: missing column "${name}"`);
    return i;
  };
}

const int = (v) => {
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

function parseDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s || '');
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  return new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2])));
}

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'x'
  );
}

function parseWorkbook(file) {
  const wb = XLSX.readFile(file, { cellStyles: false });

  // ---------- Team name canonicalisation ----------
  const teamNames = new Map(); // lowercase -> canonical
  const canonTeam = (name) => {
    if (!name) return '';
    name = renameTeam(name);
    const key = name.toLowerCase();
    if (!teamNames.has(key)) teamNames.set(key, name);
    return teamNames.get(key);
  };

  // ---------- Rosters ----------
  const rosterSheet = getSheet(wb, SHEETS.rosters);
  const season = rosterSheet.name.match(SHEETS.rosters)[1];
  const R = fromHeader(rowsOf(rosterSheet.ws), 'Player Name', rosterSheet.name);
  const rc = columns(R[0], rosterSheet.name);
  const roster = [];
  for (const r of R.slice(1)) {
    const team = r[rc('Team')];
    const name = r[rc('Player Name')];
    if (!team || !name) continue;
    roster.push({
      team: canonTeam(team),
      name,
      number: r[rc('Jersey #')],
      position: r[rc('Position')] || 'Skater',
      captain: r[rc('Captain')],
    });
  }

  // ---------- Player name matching ----------
  // The game sheets sometimes use a short form of a rostered name
  // ("Matt Angarone" vs "Matthew Angarone"). Map those to the roster name.
  const parts = (n) => {
    const w = n.toLowerCase().split(' ');
    return { first: w[0], last: w.slice(1).join(' ') };
  };
  const NICK = {
    mike: 'michael', mikey: 'michael', bob: 'robert', bobby: 'robert', rob: 'robert', bill: 'william',
    will: 'william', jim: 'james', jimmy: 'james', tony: 'anthony', dick: 'richard', rick: 'richard',
    bert: 'albert', ted: 'edward', ed: 'edward', eddie: 'edward', jack: 'john', johnny: 'john',
    peggy: 'margaret', liz: 'elizabeth', beth: 'elizabeth', kate: 'katherine', kathy: 'katherine',
  };
  const firstKey = (f) => (NICK[f] || f).slice(0, 3);
  const similar = (a, b) => {
    const x = parts(a), y = parts(b);
    return x.last && x.last === y.last && firstKey(x.first) === firstKey(y.first);
  };
  const aliasCache = new Map();
  const canonPlayer = (name, teamName) => {
    if (!name) return name;
    const key = `${name.toLowerCase()}|${teamName || ''}`;
    if (aliasCache.has(key)) return aliasCache.get(key);
    let found = roster.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!found) found = roster.find((r) => r.team === teamName && similar(r.name, name));
    if (!found) {
      const any = [...new Set(roster.filter((r) => similar(r.name, name)).map((r) => r.name))];
      if (any.length === 1) found = { name: any[0] };
    }
    const result = found ? found.name : name;
    if (result !== name) warn(`Treating "${name}" as roster player "${result}"`);
    aliasCache.set(key, result);
    return result;
  };

  // ---------- Schedule ----------
  const sched = getSheet(wb, SHEETS.schedule);
  const S = fromHeader(rowsOf(sched.ws), 'Home Team', sched.name);
  const sc = columns(S[0], sched.name);
  const games = [];
  const scheduleNotes = []; // e.g. "No Games, Labor Day"
  let playoffs = false;
  for (const r of S.slice(1)) {
    if (/^playoffs?$/i.test(r[sc('Home Team')])) {
      playoffs = true;
      continue;
    }
    const num = int(r[sc('Game #')]);
    if (!num) continue;
    const home = canonTeam(r[sc('Home Team')]);
    const away = canonTeam(r[sc('Away Team')]);
    const base = {
      num,
      week: int(r[sc('Week #')]),
      dateText: r[sc('Date')],
      date: parseDate(r[sc('Date')]),
      day: r[sc('Day')],
      time: r[sc('Time')],
      arena: r[sc('Arena')],
      rink: r[sc('Rink')],
      comment: renameInText(r[sc('Comments')]),
      playoff: playoffs,
    };
    if (!home || !away) {
      if (base.comment) scheduleNotes.push(base);
      else if (playoffs) games.push({ ...base, home: '', away: '', tbd: true, played: false });
      continue;
    }
    const hs = int(r[sc('Home Score')]);
    const as = int(r[sc('Away Score')]);
    const played = hs !== null && as !== null;
    const g = {
      ...base,
      home,
      away,
      homeScore: hs,
      awayScore: as,
      played,
      ot: r[sc('OT?')] === 'Yes',
      so: r[sc('SO?')] === 'Yes',
      tie: r[sc('Tie?')] === 'Yes',
      homeGoalie: canonPlayer(r[sc('Starting Goalie (Home)')], home),
      awayGoalie: canonPlayer(r[sc('Starting Goalie (Away)')], away),
    };
    if (played) {
      if (g.tie || hs === as) {
        g.tie = true;
        g.winner = g.loser = '';
      } else {
        g.winner = hs > as ? home : away;
        g.loser = hs > as ? away : home;
      }
    }
    games.push(g);
  }
  games.sort((a, b) => a.num - b.num);
  const gameByNum = new Map(games.map((g) => [g.num, g]));

  // ---------- Stat events ----------
  const ev = getSheet(wb, SHEETS.events);
  const E = fromHeader(rowsOf(ev.ws), 'Player', ev.name);
  const ec = columns(E[0], ev.name);
  const events = [];
  for (const r of E.slice(1)) {
    const game = int(r[ec('Game #')]);
    const type = r[ec('Type')];
    const player = canonPlayer(r[ec('Player')], canonTeam(r[ec('Team')]));
    if (!game || !type || !player) continue;
    if (!gameByNum.has(game)) warn(`Stat event for unknown game #${game} (${player})`);
    events.push({
      game,
      period: r[ec('Period')],
      team: canonTeam(r[ec('Team')]),
      number: r[ec('Player #')],
      player,
      type, // "Goal" | "SO Goal" | "Penalty"
      detail: r[ec('Comments')],
      qty: int(r[ec('Qty')]) ?? 1,
    });
  }

  // ---------- Subs ----------
  const sub = getSheet(wb, SHEETS.subs);
  const B = fromHeader(rowsOf(sub.ws), 'Sub Player Name', sub.name);
  const bc = columns(B[0], sub.name);
  const subs = [];
  for (const r of B.slice(1)) {
    const game = int(r[bc('Game #')]);
    const mainTeam = r[bc('Main Team')] === 'SUB' ? '' : canonTeam(r[bc('Main Team')]);
    const player = canonPlayer(r[bc('Sub Player Name')], mainTeam);
    if (!game || !player) continue;
    subs.push({
      game,
      player,
      mainTeam,
      team: canonTeam(r[bc('Sub Team')]),
      opponent: canonTeam(r[bc('Opponent')]),
    });
  }

  // ---------- Schedule updates ----------
  const upd = getSheet(wb, SHEETS.updates);
  const U = fromHeader(rowsOf(upd.ws), 'Change Reason', upd.name);
  const scheduleUpdates = [];
  const slot = (r, o) => ({
    num: r[o], week: r[o + 1], date: r[o + 2], day: r[o + 3], time: r[o + 4],
    arena: r[o + 5], rink: r[o + 6], home: renameTeam(r[o + 7]), away: renameTeam(r[o + 8]),
  });
  for (const r of U.slice(1)) {
    if (!int(r[0])) continue;
    scheduleUpdates.push({
      from: slot(r, 0), to: slot(r, 10), reason: renameInText(r[20]), changed: r[21], comments: renameInText(r[22]),
    });
  }

  // ---------- Team Links tab (optional) ----------
  const sheetLinks = [];
  const linkSheetName = wb.SheetNames.find((n) => SHEETS.links.test(n));
  if (linkSheetName) {
    const L = fromHeader(rowsOf(wb.Sheets[linkSheetName]), 'Team', linkSheetName);
    const header = L[0];
    for (const r of L.slice(1)) {
      const team = r[header.indexOf('Team')];
      for (const [kind, column] of [['youtube', 'YouTube'], ['instagram', 'Instagram']]) {
        const i = header.indexOf(column);
        if (!team || i < 0 || !r[i]) continue;
        // Validate here, not only when building pages: these links also go into
        // the public season archive, so anything else (e.g. a spreadsheet URL
        // typed into the wrong column) must never be kept.
        if (LINK_VALIDATORS[kind](r[i])) sheetLinks.push({ team, kind, url: r[i], source: linkSheetName });
        else warn(`Ignoring ${column} link for ${team} from ${linkSheetName}: not a valid ${column} URL`);
      }
    }
  }

  return { season: String(season), roster, games, scheduleNotes, events, subs, scheduleUpdates, sheetLinks };
}

// Where a season's own files live: game videos, rink game center links and,
// once the season is over, its frozen archive.
const seasonDir = (season) => path.join(SEASONS_DIR, String(season));

// Attaches team links, game videos and rink links to parsed season data, then
// calculates everything. Works the same for a live workbook and an archive.
function assemble(raw) {
  const { season, roster, games, scheduleNotes, events, subs, scheduleUpdates } = raw;
  const gameByNum = new Map(games.map((g) => [g.num, g]));
  const teamNames = new Map();
  for (const n of [...roster.map((r) => r.team), ...games.flatMap((g) => [g.home, g.away])]) {
    if (n && !teamNames.has(n.toLowerCase())) teamNames.set(n.toLowerCase(), n);
  }
  const canonTeam = (name) => {
    if (!name) return '';
    const n = renameTeam(name);
    return teamNames.get(n.toLowerCase()) || n;
  };
  const VIDEOS_FILE = path.join(seasonDir(season), 'game-videos.json');
  const GAME_CENTER_FILE = path.join(seasonDir(season), 'game-center.json');

  // ---------- Team links (optional) ----------
  // From "team-links.json" and/or an optional "Team Links" tab. The tab wins.
  const teamLinks = new Map();
  const LINK_KINDS = {
    youtube: { label: 'YouTube', column: 'YouTube', valid: isYouTube },
    instagram: { label: 'Instagram', column: 'Instagram', valid: isInstagram },
  };
  const addLink = (teamName, kind, url, source) => {
    if (!teamName || !url) return;
    const k = LINK_KINDS[kind];
    if (!k.valid(url)) {
      warn(`Ignoring ${k.label} link for ${teamName} from ${source}: not a valid ${k.label} URL (${url})`);
      return;
    }
    const name = canonTeam(teamName);
    if (!teamLinks.has(name)) teamLinks.set(name, {});
    teamLinks.get(name)[kind] = url;
  };
  if (fs.existsSync(LINKS_FILE)) {
    const json = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
    for (const [name, v] of Object.entries(json)) {
      if (name.startsWith('_') || !v) continue;
      for (const kind of Object.keys(LINK_KINDS)) addLink(name, kind, v[kind], LINKS_FILE);
    }
  }
  for (const l of raw.sheetLinks || []) addLink(l.team, l.kind, l.url, l.source);
  for (const name of teamLinks.keys()) {
    if (!roster.some((r) => r.team === name)) warn(`Team links given for "${name}", which is not a current team`);
  }

  // ---------- Game videos (optional; see scripts/find-videos.js) ----------
  for (const g of games) g.videos = [];
  if (fs.existsSync(VIDEOS_FILE)) {
    const json = JSON.parse(fs.readFileSync(VIDEOS_FILE, 'utf8'));
    for (const [num, list] of Object.entries(json)) {
      if (num.startsWith('_')) continue;
      const g = gameByNum.get(Number(num));
      if (!g) { warn(`${VIDEOS_FILE}: no game #${num}`); continue; }
      for (const v of [].concat(list || [])) {
        if (!v || !isYouTube(v.url)) { warn(`${VIDEOS_FILE}: game #${num} has a non-YouTube link (${v && v.url})`); continue; }
        g.videos.push({ team: canonTeam(v.team || ''), url: v.url, title: v.title || '' });
      }
    }
  }

  // ---------- Rink game center links (optional; see scripts/game-center.js) ----------
  const gameCenterTeams = new Map();
  const gcRaw = fs.existsSync(GAME_CENTER_FILE) ? JSON.parse(fs.readFileSync(GAME_CENTER_FILE, 'utf8')) : null;
  // Game numbers restart every season, so only use links made for this season.
  if (gcRaw && String(gcRaw.ourSeason) !== String(season)) {
    warn(`${GAME_CENTER_FILE} is for season ${gcRaw.ourSeason}, not ${season}; rink links are left out. Run: npm run game-center -- --new-season "<rink schedule URL>"`);
  }
  if (gcRaw && String(gcRaw.ourSeason) === String(season)) {
    const gc = gcRaw;
    const q = `league=${gc.league}&season=${gc.season}`;
    for (const [num, id] of Object.entries(gc.games || {})) {
      const g = gameByNum.get(Number(num));
      if (!g) { warn(`${GAME_CENTER_FILE}: no game #${num}`); continue; }
      g.gameCenter = {
        url: `${gc.site}/game-center-widget/?game=${id}&${q}`,
        scoresheet: `https://stats.blackbear.timetoscore.com/generate-scorecard.php?game_id=${id}`,
      };
    }
    for (const [name, id] of Object.entries(gc.teams || {})) {
      gameCenterTeams.set(canonTeam(name), `${gc.site}/team-page/?team=${id}&${q}`);
    }
  }

  return build({ season, roster, games, scheduleNotes, events, subs, scheduleUpdates, teamLinks, gameCenterTeams });
}

// Live season: read the workbook.
function load(file) {
  return assemble(parseWorkbook(file));
}

// ---------- Season archives ----------
// When a season is over, "npm run freeze-season" saves its parsed data to
// seasons/<n>/archive.json. That's only what the site shows anyway (schedule,
// scores, goals and penalties, rosters, subs); the raw workbook with its
// private tabs is never saved. Archived seasons then build without the sheet.
const archiveFile = (season) => path.join(seasonDir(season), 'archive.json');

function freeze(file) {
  const raw = parseWorkbook(file);
  const out = archiveFile(raw.season);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({ _comment: `Frozen copy of season ${raw.season}, made by "npm run freeze-season".`, frozenAt: new Date().toISOString(), ...raw }, null, 1)}\n`);
  return { season: raw.season, file: out, games: raw.games.length, events: raw.events.length };
}

function loadArchive(season) {
  const raw = JSON.parse(fs.readFileSync(archiveFile(season), 'utf8'));
  for (const g of [...raw.games, ...raw.scheduleNotes]) g.date = g.date ? new Date(g.date) : null;
  return assemble(raw);
}

// ---------- Derived stats ----------
function build(d) {
  const P = config.points;

  // Teams
  const teams = new Map();
  const team = (name) => {
    if (!teams.has(name)) {
      teams.set(name, {
        name, slug: slugify(name),
        gp: 0, w: 0, l: 0, otl: 0, t: 0, pts: 0, gf: 0, ga: 0, pim: 0,
        results: [], // 'W' | 'L' | 'OTL' | 'T' in game order
        h2h: new Map(),
        roster: [], goalies: [],
        links: d.teamLinks.get(name) || {},
        gameCenter: d.gameCenterTeams.get(name) || '',
      });
    }
    return teams.get(name);
  };
  d.roster.forEach((p) => team(p.team).roster.push(p));
  d.games.filter((g) => !g.tbd).forEach((g) => { team(g.home); team(g.away); });

  // In a shootout the winner's final score includes one extra "goal" for the
  // shootout win. Like the spreadsheet, that goal doesn't count toward GF/GA.
  const realGoals = (g, side) => {
    const s = side === 'home' ? g.homeScore : g.awayScore;
    return g.so && g.winner === g[side] ? s - 1 : s;
  };
  const other = (side) => (side === 'home' ? 'away' : 'home');

  const record = (rec, res) => { rec[res === 'OTL' ? 'otl' : res.toLowerCase()]++; };
  for (const g of d.games) {
    if (!g.played || g.playoff) continue;
    for (const side of ['home', 'away']) {
      const t = team(g[side]);
      const opp = side === 'home' ? g.away : g.home;
      const gf = realGoals(g, side);
      const ga = realGoals(g, other(side));
      const res = g.tie ? 'T' : g.winner === t.name ? 'W' : g.ot ? 'OTL' : 'L';
      t.gp++; t.gf += gf; t.ga += ga;
      record(t, res);
      t.results.push(res);
      if (!t.h2h.has(opp)) t.h2h.set(opp, { gp: 0, w: 0, l: 0, otl: 0, t: 0, gf: 0, ga: 0 });
      const h = t.h2h.get(opp);
      h.gp++; h.gf += gf; h.ga += ga;
      record(h, res);
    }
  }
  for (const t of teams.values()) {
    t.pts = t.w * P.win + t.otl * P.otLoss + t.t * P.tie;
    t.pct = t.gp ? t.pts / (t.gp * P.win) : 0;
    t.diff = t.gf - t.ga;
    const last = t.results[t.results.length - 1];
    let n = 0;
    for (let i = t.results.length - 1; i >= 0 && t.results[i] === last; i--) n++;
    t.streak = last ? `${last === 'OTL' ? 'OTL' : last}${n}` : '';
    t.last5 = t.results.slice(-5);
  }
  const standings = [...teams.values()]
    .filter((t) => t.roster.length || t.gp)
    .sort((a, b) => b.pts - a.pts || b.pct - a.pct || b.w - a.w || b.diff - a.diff || b.gf - a.gf || a.name.localeCompare(b.name));
  standings.forEach((t, i) => { t.rank = i + 1; });
  // Per-game rates, since teams have played different numbers of games, and
  // league ranks by them: offense by GF/G (higher is better), defense by GA/G
  // (lower is better). Tied teams share a rank. Teams without games get none.
  for (const t of standings) {
    t.gfpg = t.gp ? t.gf / t.gp : null;
    t.gapg = t.gp ? t.ga / t.gp : null;
  }
  const active = standings.filter((t) => t.gp);
  for (const t of active) {
    t.offRank = 1 + active.filter((o) => o.gfpg > t.gfpg).length;
    t.defRank = 1 + active.filter((o) => o.gapg < t.gapg).length;
  }

  // Players: rostered players plus anyone appearing in events or the sub list.
  const players = new Map();
  const player = (name) => {
    const key = name.toLowerCase();
    if (!players.has(key)) {
      players.set(key, {
        name, slug: slugify(name), team: '', teams: [], number: '', position: '', captain: '',
        goals: 0, soGoals: 0, pim: 0, penalties: 0, subGames: 0, teamGoals: 0, teamGoalPct: null,
        log: new Map(), // game num -> { team, goals, soGoals, pim, penalties: [] }
      });
    }
    return players.get(key);
  };
  for (const r of d.roster) {
    const p = player(r.name);
    p.teams.push(r.team);
    if (!p.team) Object.assign(p, { team: r.team, number: r.number, position: r.position, captain: r.captain });
    if (!p.number && r.number) p.number = r.number;
    if (r.captain) p.captain = r.captain;
  }
  const logFor = (p, game, teamName) => {
    if (!p.log.has(game)) p.log.set(game, { team: teamName, goals: 0, soGoals: 0, pim: 0, penalties: [] });
    return p.log.get(game);
  };
  for (const e of d.events) {
    const p = player(e.player);
    const entry = logFor(p, e.game, e.team);
    if (e.type === 'Goal') { p.goals += e.qty; entry.goals += e.qty; }
    else if (e.type === 'SO Goal') { p.soGoals += e.qty; entry.soGoals += e.qty; }
    else if (e.type === 'Penalty') {
      p.penalties++; p.pim += e.qty; entry.pim += e.qty;
      entry.penalties.push(e.detail || 'Penalty');
      if (teams.has(e.team)) teams.get(e.team).pim += e.qty;
    } else warn(`Unknown stat type "${e.type}" in game #${e.game}`);
    if (!p.team) warn(`${e.player} (game #${e.game}, ${e.team}) is not on any roster`);
  }
  for (const s of d.subs) {
    const p = player(s.player);
    p.subGames++;
    logFor(p, s.game, s.team).sub = true;
  }
  // Players listed on a team's roster only get stats credited for games they
  // played for that team; goals scored while subbing are flagged separately.
  for (const p of players.values()) {
    p.subGoals = 0;
    for (const [, e] of p.log) if (p.team && !p.teams.includes(e.team)) p.subGoals += e.goals;
  }
  // Share of their team's goals: regular-season goals for their (first) roster
  // team, divided by that team's GF. Like GF, playoff games don't count.
  const gameByNum = new Map(d.games.map((g) => [g.num, g]));
  for (const p of players.values()) {
    p.teamGoals = 0;
    for (const [num, e] of p.log) {
      const g = gameByNum.get(num);
      if (p.team && e.team === p.team && g && !g.playoff) p.teamGoals += e.goals;
    }
    const t = p.team && teams.get(p.team);
    p.teamGoalPct = t && t.gf ? p.teamGoals / t.gf : null;
  }

  // Goalies: from starting goalies in the schedule.
  const goalies = new Map();
  // A goalie's "main" team is one whose roster they are on; other starts are as a sub.
  const isRosterGoalie = (name, teamName) =>
    d.roster.some((r) => r.team === teamName && r.name.toLowerCase() === name.toLowerCase());
  for (const g of d.games) {
    if (!g.played || g.playoff) continue;
    for (const side of ['home', 'away']) {
      const name = g[`${side}Goalie`];
      if (!name) { warn(`Game #${g.num}: no ${side} goalie recorded`); continue; }
      const teamName = g[side];
      const key = `${name.toLowerCase()}|${teamName}`;
      if (!goalies.has(key)) {
        goalies.set(key, {
          name, slug: slugify(name), team: teamName, main: isRosterGoalie(name, teamName),
          gp: 0, w: 0, l: 0, otl: 0, t: 0, ga: 0, sho: 0,
        });
      }
      const s = goalies.get(key);
      const ga = realGoals(g, other(side));
      s.gp++; s.ga += ga;
      if (ga === 0) s.sho++;
      record(s, g.tie ? 'T' : g.winner === teamName ? 'W' : g.ot ? 'OTL' : 'L');
      player(name);
    }
  }
  const goalieList = [...goalies.values()].map((s) => ({
    ...s,
    pts: s.w * P.win + s.otl * P.otLoss + s.t * P.tie,
    gaa: s.gp ? s.ga / s.gp : 0,
  }));
  goalieList.forEach((s) => teams.get(s.team) && teams.get(s.team).goalies.push(s));

  // Per-game details and sanity checks.
  for (const g of d.games) {
    g.events = d.events.filter((e) => e.game === g.num);
    g.subs = d.subs.filter((s) => s.game === g.num);
    if (g.played) {
      const goals = (t) => g.events.filter((e) => e.team === t && e.type === 'Goal').reduce((n, e) => n + e.qty, 0);
      g.homeGoals = realGoals(g, 'home');
      g.awayGoals = realGoals(g, 'away');
      if (goals(g.home) !== g.homeGoals || goals(g.away) !== g.awayGoals) {
        warn(`Game #${g.num}: score ${g.homeGoals}-${g.awayGoals} (excl. shootout) but goal events add up to ${goals(g.home)}-${goals(g.away)}`);
      }
    }
  }

  return {
    ...d,
    teams,
    standings,
    players: [...players.values()].sort((a, b) => a.name.localeCompare(b.name)),
    goalies: goalieList,
    warnings,
  };
}

module.exports = { load, loadArchive, freeze, seasonDir, archiveFile, slugify };
