// Builds the static website from data/sheet.xlsx into dist/.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { load, slugify } = require('./data');

if (!fs.existsSync(config.dataFile)) {
  console.error(`${config.dataFile} not found. Run "npm run fetch" first.`);
  process.exit(1);
}

const D = load(config.dataFile);
const OUT = config.outDir;
const LEAGUE = config.leagueName;
const SEASON = `Season ${D.season}`;
const builtAt = new Date();

// ---------- helpers ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : '–');
const pct = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '–');
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const rec = (r) => `${r.w}-${r.l}-${r.otl}${r.t ? `-${r.t}` : ''}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateLabel = (g) => (g.date ? `${DAYS[g.date.getUTCDay()]}, ${MONTHS[g.date.getUTCMonth()]} ${g.date.getUTCDate()}` : esc(g.dateText) || 'TBD');
const place = (g) => [g.arena, g.rink].filter(Boolean).map(esc).join(' · ');

const teamOf = (name) => D.teams.get(name);
const playerByName = new Map(D.players.map((p) => [p.name.toLowerCase(), p]));

// Team colour: picked from words in the team name, else derived from the name.
const COLOR_WORDS = {
  orange: '#f28c28', yellow: '#e6b800', green: '#3aa655', black: '#2b2b2b', red: '#d64545', blue: '#2f6fdb',
  white: '#9aa5b1', flamingo: '#f06fa8', whaler: '#1f5f8b', kraken: '#147d7d', reaper: '#5b4b8a', duck: '#2d8a57',
  kodiak: '#8a5a2b', goomba: '#3aa655', squadron: '#2b2b2b', ice: '#4aa3df', river: '#3b7dd8', sk8: '#c0392b',
};
function teamColor(name) {
  const n = String(name).toLowerCase();
  for (const [w, c] of Object.entries(COLOR_WORDS)) if (n.includes(w)) return c;
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 45%)`;
}

// Links. `r` is the relative path back to the site root ('' or '../').
// Team logos: put an image named after the team's slug in src/logos/,
// e.g. src/logos/reapers.jpg or src/logos/kraken-cold-ones.png.
const LOGO_DIR = path.join('src', 'logos');
const LOGO_EXT = /\.(png|jpe?g|webp|svg)$/i;
const logoFiles = fs.existsSync(LOGO_DIR) ? fs.readdirSync(LOGO_DIR).filter((f) => LOGO_EXT.test(f)) : [];
const logoOf = (name) => {
  const f = logoFiles.find((x) => x.replace(LOGO_EXT, '') === slugify(name));
  return f ? `logos/${f}` : '';
};
// Small team marker: the logo if there is one, otherwise a coloured dot.
const teamMark = (name, r) => {
  const logo = logoOf(name);
  return logo
    ? `<img class="mark" src="${r}${logo}" alt="" width="20" height="20" loading="lazy">`
    : `<span class="dot" style="background:${teamColor(name)}"></span>`;
};

const teamLink = (name, r, opts = {}) => {
  if (!name) return '<span class="muted">TBD</span>';
  const t = teamOf(name);
  const dot = teamMark(name, r);
  if (!t) return `<span class="team">${dot}${esc(name)}</span>`;
  return `<a class="team${opts.bold ? ' strong' : ''}" href="${r}teams/${t.slug}.html">${dot}${esc(name)}</a>`;
};
const playerLink = (name, r) => {
  const p = playerByName.get(String(name).toLowerCase());
  return p ? `<a href="${r}players/${p.slug}.html">${esc(p.name)}</a>` : esc(name);
};
const gameLink = (g, r, text) => `<a href="${r}games/${g.num}.html">${text}</a>`;
const YT_ICON = '<svg class="yt-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#ff0000" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8z"/><path fill="#fff" d="M9.6 15.6 15.8 12 9.6 8.4z"/></svg>';
const IG_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><defs><linearGradient id="ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".35" stop-color="#fa7e1e"/><stop offset=".6" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig)"/><circle cx="12" cy="12" r="4.3" fill="none" stroke="#fff" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.3" fill="#fff"/></svg>';
// YouTube / Instagram buttons for a team page header.
function teamSocial(t) {
  const links = [];
  if (t.links.youtube) links.push(`<a class="yt" href="${esc(t.links.youtube)}" target="_blank" rel="noopener">${YT_ICON}YouTube</a>`);
  if (t.links.instagram) {
    const handle = t.links.instagram.replace(/\/+$/, '').split('/').pop();
    links.push(`<a class="yt ig" href="${esc(t.links.instagram)}" target="_blank" rel="noopener">${IG_ICON}@${esc(handle)}</a>`);
  }
  return links.length ? `<div class="social">${links.join('')}</div>` : '';
}
// Play icon next to a result, linking to the game's (first) video.
const videoLink = (g) => {
  if (!g.videos || !g.videos.length) return '';
  const more = g.videos.length > 1 ? ` (${g.videos.length} videos on the game page)` : '';
  return ` <a class="vid" href="${esc(g.videos[0].url)}" target="_blank" rel="noopener" title="Watch video${more}" aria-label="Watch video">${YT_ICON}</a>`;
};

// Games that have video, newest first.
const videoGames = () => D.games.filter((g) => g.videos && g.videos.length).sort((a, b) => (b.date || 0) - (a.date || 0) || b.num - a.num);
const youTubeId = (url) => {
  const m = /[?&]v=([\w-]{11})/.exec(url) || /youtu\.be\/([\w-]{11})/.exec(url) || /\/(?:live|shorts|embed)\/([\w-]{11})/.exec(url);
  return m ? m[1] : '';
};
// A card with the video thumbnail, the result and a button per team video.
function videoCard(g, r) {
  const id = youTubeId(g.videos[0].url);
  const teams = [g.home, g.away].map((n) => (teamOf(n) ? teamOf(n).slug : '')).join(' ');
  const side = (s) => `<span class="team${g.played && g.winner === g[s] ? ' strong' : ''}">${teamMark(g[s], r)}${esc(g[s])}</span>${g.played ? `<b>${g[`${s}Score`]}</b>` : ''}`;
  const result = g.played ? `Final${g.so ? ' / SO' : g.ot ? ' / OT' : ''}` : '';
  return `<div class="card video-card" data-teams="${teams}">
  <a class="thumb" href="${esc(g.videos[0].url)}" target="_blank" rel="noopener" aria-label="Watch ${esc(g.away)} at ${esc(g.home)}">
    ${id ? `<img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt="" loading="lazy" width="320" height="180">` : ''}
    <span class="play">${YT_ICON}</span>
  </a>
  <div class="vc-body">
    <div class="meta"><span>${dateLabel(g)}</span><span>${result}</span></div>
    <a class="vc-score" href="${r}games/${g.num}.html"><div class="line">${side('away')}</div><div class="line">${side('home')}</div></a>
    <div class="vc-links">${g.videos.map((v) => `<a href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.title)}">${YT_ICON}${esc(v.team || 'Video')}</a>`).join('')}<a class="muted" href="${r}games/${g.num}.html">Box score</a></div>
  </div>
</div>`;
}

function scoreText(g) {
  if (!g.played) return '';
  const suffix = g.so ? ' SO' : g.ot ? ' OT' : '';
  return `${g.awayScore}–${g.homeScore}${suffix}`;
}

// ---------- layout ----------
const NAV = [
  ['index.html', 'Standings'],
  ['schedule.html', 'Schedule'],
  ['teams/index.html', 'Teams'],
  ['players.html', 'Players'],
  ['goalies.html', 'Goalies'],
  ['subs.html', 'Subs'],
  ['videos.html', 'Videos'],
];

function page({ file, title, body, desc }) {
  const depth = file.split('/').length - 1;
  const r = '../'.repeat(depth);
  const nav = NAV.map(([href, label]) => {
    const active = file === href || (href === 'teams/index.html' && file.startsWith('teams/'))
      || (href === 'players.html' && file.startsWith('players/'))
      || (href === 'schedule.html' && file.startsWith('games/'));
    return `<a href="${r}${href}"${active ? ' aria-current="page"' : ''}>${label}</a>`;
  }).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ? `${title} · ${LEAGUE}` : LEAGUE)}</title>
<meta name="description" content="${esc(desc || `${LEAGUE} ${SEASON} standings, schedule and stats`)}">
<link rel="icon" href="${r}logo.png" type="image/png">
<link rel="apple-touch-icon" href="${r}logo.png">
<link rel="stylesheet" href="${r}style.css">
</head>
<body>
<header class="site">
  <div class="wrap bar">
    <a class="brand" href="${r}index.html"><img src="${r}logo.png" alt="" width="40" height="40"><span>${esc(LEAGUE)}<small>${esc(SEASON)}</small></span></a>
    <button class="menu" aria-expanded="false" aria-controls="nav">Menu</button>
  </div>
  <nav id="nav" class="wrap">${nav}</nav>
</header>
<main class="wrap">
${body}
</main>
<footer class="wrap">
  Updated ${builtAt.toUTCString().replace(/:\d\d GMT/, ' UTC')} from the league spreadsheet.
</footer>
<script src="${r}app.js"></script>
</body>
</html>
`;
  const out = path.join(OUT, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
}

// Sortable table. cols: [{ label, cls, sort: 'num'|'text'|false, title }]
function table(cols, rows, opts = {}) {
  const head = cols
    .map((c) => `<th${c.cls ? ` class="${c.cls}"` : ''}${c.title ? ` title="${esc(c.title)}"` : ''}${c.sort !== false && opts.sortable ? ` data-sort="${c.sort || 'num'}"` : ''}>${c.label}</th>`)
    .join('');
  return `<div class="table-wrap"><table${opts.id ? ` id="${opts.id}"` : ''}${opts.sortable ? ' class="sortable"' : ''}>
<thead><tr>${head}</tr></thead>
<tbody>
${rows.join('\n')}
</tbody></table></div>`;
}
const td = (v, cls, sortVal) => `<td${cls ? ` class="${cls}"` : ''}${sortVal !== undefined ? ` data-v="${esc(sortVal)}"` : ''}>${v}</td>`;

function form(results) {
  return `<span class="form">${results.map((x) => `<i class="r-${x.toLowerCase()}" title="${x}">${x === 'OTL' ? 'O' : x}</i>`).join('')}</span>`;
}

// ---------- shared blocks ----------
function standingsTable(r, compact = false) {
  const cols = [
    { label: '#', cls: 'num' }, { label: 'Team', sort: 'text' }, { label: 'GP', cls: 'num' },
    { label: 'W', cls: 'num' }, { label: 'L', cls: 'num' }, { label: 'OTL', cls: 'num', title: 'Overtime / shootout losses' },
    { label: 'PTS', cls: 'num' }, { label: 'P%', cls: 'num' , title: 'Points percentage' },
    { label: 'GF', cls: 'num' }, { label: 'GA', cls: 'num' }, { label: 'DIFF', cls: 'num' },
  ];
  if (!compact) cols.push({ label: 'PIM', cls: 'num', title: 'Penalty minutes' }, { label: 'Streak', sort: false }, { label: 'Last 5', sort: false });
  const rows = D.standings.map((t) => {
    const cells = [
      td(t.rank, 'num'), td(teamLink(t.name, r, { bold: true }), '', t.name), td(t.gp, 'num'),
      td(t.w, 'num'), td(t.l, 'num'), td(t.otl, 'num'), td(`<b>${t.pts}</b>`, 'num', t.pts), td(pct(t.pct), 'num', t.pct),
      td(t.gf, 'num'), td(t.ga, 'num'), td(signed(t.diff), `num ${t.diff > 0 ? 'pos' : t.diff < 0 ? 'neg' : ''}`, t.diff),
    ];
    if (!compact) cells.push(td(t.pim, 'num'), td(esc(t.streak)), td(form(t.last5)));
    return `<tr>${cells.join('')}</tr>`;
  });
  return table(cols, rows, { sortable: true });
}

function gameCard(g, r) {
  const status = g.played
    ? `<span class="final">Final${g.so ? ' / SO' : g.ot ? ' / OT' : ''}</span>`
    : `<span>${esc(g.time) || 'TBD'}</span>`;
  const line = (side) => {
    const won = g.played && g.winner === g[side];
    const score = g.played ? `<b class="score">${g[`${side}Score`]}</b>` : '';
    const name = g[side]
      ? `<span class="team">${teamMark(g[side], r)}${esc(g[side])}</span>`
      : '<span class="muted">TBD</span>';
    return `<div class="line${won ? ' won' : ''}">${name}${score}</div>`;
  };
  return `<a class="card game-card" href="${r}games/${g.num}.html">
  <div class="meta"><span>${dateLabel(g)}</span>${status}</div>
  ${line('away')}
  ${line('home')}
  <div class="meta"><span>${place(g)}</span><span>${g.videos.length ? `${YT_ICON} ` : ''}Game ${g.num}${g.playoff ? ' · Playoffs' : ''}</span></div>
</a>`;
}

function scheduleRows(games, r, perspective) {
  return games.map((g) => {
    const teams = [g.home, g.away].filter(Boolean).map((n) => (teamOf(n) ? teamOf(n).slug : slugify(n))).join(' ');
    let result = g.played ? gameLink(g, r, scoreText(g)) : gameLink(g, r, 'Preview');
    if (perspective && g.played) {
      const res = g.tie ? 'T' : g.winner === perspective ? 'W' : g.ot ? 'OTL' : 'L';
      const us = g.home === perspective ? g.homeScore : g.awayScore;
      const them = g.home === perspective ? g.awayScore : g.homeScore;
      result = `<i class="badge r-${res.toLowerCase()}">${res}</i> ${gameLink(g, r, `${us}–${them}${g.so ? ' SO' : g.ot ? ' OT' : ''}`)}`;
    }
    const matchup = perspective
      ? `${g.home === perspective ? 'vs' : '@'} ${teamLink(g.home === perspective ? g.away : g.home, r)}`
      : `${teamLink(g.away, r)} <span class="muted">@</span> ${teamLink(g.home, r)}`;
    return `<tr data-teams="${teams}"${g.played ? '' : ' class="upcoming"'}>${[
      td(g.num, 'num'), td(dateLabel(g), 'nowrap', g.date ? g.date.toISOString() : ''), td(esc(g.time), 'nowrap'),
      td(place(g), 'nowrap'), td(matchup), td(result + videoLink(g), 'nowrap'),
    ].join('')}</tr>`;
  });
}
const SCHEDULE_COLS = [
  { label: 'Game', cls: 'num' }, { label: 'Date' }, { label: 'Time' }, { label: 'Where' }, { label: 'Matchup' }, { label: 'Result' },
];

// ---------- static assets ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['style.css', 'app.js', 'logo.png']) fs.copyFileSync(path.join('src', f), path.join(OUT, f));
if (logoFiles.length) {
  fs.mkdirSync(path.join(OUT, 'logos'), { recursive: true });
  for (const f of logoFiles) fs.copyFileSync(path.join(LOGO_DIR, f), path.join(OUT, 'logos', f));
  const known = new Set([...D.teams.values()].map((t) => t.slug));
  for (const f of logoFiles) {
    if (!known.has(f.replace(LOGO_EXT, ''))) D.warnings.push(`src/logos/${f} doesn't match any team (expected e.g. ${[...known][0]}.png)`);
  }
}

// ---------- Home / standings ----------
{
  const r = '';
  const played = D.games.filter((g) => g.played);
  const lastWeek = played.length ? Math.max(...played.map((g) => g.week || 0)) : 0;
  const recent = played.filter((g) => g.week === lastWeek);
  const upcoming = D.games.filter((g) => !g.played && !g.tbd).slice(0, config.upcomingCount);
  const scorers = [...D.players].filter((p) => p.goals).sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name)).slice(0, 10);
  const pim = [...D.players].filter((p) => p.pim).sort((a, b) => b.pim - a.pim || a.name.localeCompare(b.name)).slice(0, 5);
  const goalies = D.goalies.filter((g) => g.main && g.gp >= 3).sort((a, b) => a.gaa - b.gaa).slice(0, 5);
  const leaderList = (items, val) => `<ol class="leaders">${items.map((p) => `<li><span>${playerLink(p.name, r)} <small class="muted">${esc(p.team)}</small></span><b>${val(p)}</b></li>`).join('')}</ol>`;

  const body = `
<h1>${esc(SEASON)} Standings</h1>
<p class="lede">${played.filter((g) => !g.playoff).length} games played · ${D.games.filter((g) => !g.played && !g.tbd).length} remaining. ${config.points.win} points for a win, ${config.points.otLoss} for an overtime or shootout loss.</p>
${standingsTable(r)}

<div class="grid-2">
  <section>
    <h2>Latest results <small class="muted">Week ${lastWeek}</small></h2>
    <div class="cards">${recent.map((g) => gameCard(g, r)).join('') || '<p class="muted">No games played yet.</p>'}</div>
  </section>
  <section>
    <h2>Up next</h2>
    <div class="cards">${upcoming.map((g) => gameCard(g, r)).join('') || '<p class="muted">No upcoming games.</p>'}</div>
    <p><a href="schedule.html">Full schedule →</a></p>
  </section>
</div>
${videoGames().length ? `
<h2 class="split"><span>Latest videos</span><a class="small" href="videos.html">All ${videoGames().length} game videos →</a></h2>
<div class="video-grid">${videoGames().slice(0, 4).map((g) => videoCard(g, r)).join('')}</div>` : ''}

<h2>Leaders</h2>
<div class="grid-3">
  <section class="panel"><h3>Goals</h3>${leaderList(scorers, (p) => p.goals)}<a href="players.html">All players →</a></section>
  <section class="panel"><h3>Goals against avg <small class="muted">min. 3 GP</small></h3>${leaderList(goalies, (g) => fmt2(g.gaa))}<a href="goalies.html">All goalies →</a></section>
  <section class="panel"><h3>Penalty minutes</h3>${leaderList(pim, (p) => p.pim)}</section>
</div>`;
  page({ file: 'index.html', title: '', body });
}

// ---------- Schedule ----------
{
  const r = '';
  const weeks = new Map();
  for (const g of D.games) {
    const key = g.playoff ? `p${g.week}` : g.week;
    if (!weeks.has(key)) weeks.set(key, { week: g.week, playoff: g.playoff, games: [], notes: [] });
    weeks.get(key).games.push(g);
  }
  for (const n of D.scheduleNotes) {
    const w = weeks.get(n.week);
    if (w && !w.notes.includes(n.comment)) w.notes.push(n.comment);
  }
  const options = D.standings.map((t) => `<option value="${t.slug}">${esc(t.name)}</option>`).join('');
  const sections = [...weeks.values()].map((w) => {
    const dates = w.games.map((g) => g.date).filter(Boolean);
    const range = dates.length ? `${MONTHS[dates[0].getUTCMonth()]} ${dates[0].getUTCDate()} – ${MONTHS[dates.at(-1).getUTCMonth()]} ${dates.at(-1).getUTCDate()}` : '';
    const notes = w.notes.map((n) => `<p class="note">${/schedule updates/i.test(n) ? 'Some games this week were moved — see <a href="#changes">schedule changes</a>.' : esc(n)}</p>`).join('');
    return `<section class="week" data-week>
  <h2>${w.playoff ? 'Playoffs · ' : ''}Week ${w.week} <small class="muted">${range}</small></h2>${notes}
  ${table(SCHEDULE_COLS, scheduleRows(w.games, r))}
</section>`;
  }).join('\n');

  const updates = D.scheduleUpdates.length
    ? `<h2 id="changes">Schedule changes</h2>
${table(
  [{ label: 'Matchup' }, { label: 'Was' }, { label: 'Now' }, { label: 'Why' }, { label: 'Changed' }],
  D.scheduleUpdates.map((u) => `<tr>${[
    td(`${teamLink(u.to.away, r)} @ ${teamLink(u.to.home, r)}`),
    td(`${esc(u.from.date)} ${esc(u.from.time)}<br><small class="muted">${esc(u.from.arena)} ${esc(u.from.rink)}</small>`, 'nowrap'),
    td(`<b>${esc(u.to.date)} ${esc(u.to.time)}</b><br><small class="muted">${esc(u.to.arena)} ${esc(u.to.rink)}</small>`, 'nowrap'),
    td(`${esc(u.reason)}${u.comments ? `<br><small class="muted">${esc(u.comments)}</small>` : ''}`),
    td(esc(u.changed), 'nowrap'),
  ].join('')}</tr>`)
)}`
    : '';

  const body = `
<h1>Schedule</h1>
<div class="toolbar">
  <label>Team <select data-filter="team"><option value="">All teams</option>${options}</select></label>
  <label class="check"><input type="checkbox" data-filter="upcoming"> Upcoming only</label>
  ${updates ? '<a href="#changes">Schedule changes</a>' : ''}
</div>
${sections}
${updates}`;
  page({ file: 'schedule.html', title: 'Schedule', body });
}

// ---------- Game pages ----------
for (const g of D.games) {
  const r = '../';
  const title = g.tbd ? `Game ${g.num}` : `${g.away} @ ${g.home}`;
  const periods = ['1', '2', '3', 'OT', 'SO'];
  const usedPeriods = periods.filter((p) => ['1', '2', '3'].includes(p) || g.events.some((e) => e.period === p) || (p === 'OT' && g.ot) || (p === 'SO' && g.so));
  const goalsIn = (team, p) => g.events.filter((e) => e.team === team && e.period === p && /goal/i.test(e.type)).reduce((n, e) => n + e.qty, 0);

  let body = `<p class="crumbs"><a href="${r}schedule.html">Schedule</a> › Game ${g.num}</p>
<div class="scoreboard">
  <div class="side${g.played && g.winner === g.away ? ' won' : ''}">${teamLink(g.away, r, { bold: true })}<small>Away${teamOf(g.away) ? ` · ${rec(teamOf(g.away))}` : ''}</small></div>
  <div class="center">${g.played ? `<div class="big">${g.awayScore}<span>–</span>${g.homeScore}</div><div>Final${g.so ? ' (SO)' : g.ot ? ' (OT)' : ''}</div>` : `<div class="big vs">vs</div><div>${esc(g.time) || 'TBD'}</div>`}</div>
  <div class="side${g.played && g.winner === g.home ? ' won' : ''}">${teamLink(g.home, r, { bold: true })}<small>Home${teamOf(g.home) ? ` · ${rec(teamOf(g.home))}` : ''}</small></div>
</div>
<p class="center-text muted">${dateLabel(g)} · ${esc(g.time)} · ${place(g)} · Week ${g.week ?? '–'}${g.playoff ? ' · Playoffs' : ''}</p>
${g.comment ? `<p class="note">${esc(g.comment)}</p>` : ''}
${g.videos.length ? `<div class="videos">${g.videos.map((v) => `<a class="yt" href="${esc(v.url)}" target="_blank" rel="noopener" title="${esc(v.title)}">${YT_ICON}Watch${v.team ? ` · ${esc(v.team)} video` : ''}</a>`).join('')}</div>` : ''}`;

  if (g.played) {
    const periodTable = table(
      [{ label: 'Team' }, ...usedPeriods.map((p) => ({ label: p, cls: 'num' })), { label: 'T', cls: 'num' }],
      [g.away, g.home].map((t) => `<tr>${td(teamLink(t, r))}${usedPeriods.map((p) => td(goalsIn(t, p), 'num')).join('')}${td(`<b>${t === g.home ? g.homeScore : g.awayScore}</b>`, 'num')}</tr>`)
    );
    const evRows = (type) => g.events
      .filter((e) => (type === 'goal' ? /goal/i.test(e.type) : e.type === 'Penalty'))
      .sort((a, b) => periods.indexOf(a.period) - periods.indexOf(b.period))
      .map((e) => `<tr>${[
        td(esc(e.period), 'num'), td(teamLink(e.team, r)), td(esc(e.number), 'num muted'), td(playerLink(e.player, r)),
        td(type === 'goal' ? (e.type === 'SO Goal' ? 'Shootout goal' : e.qty > 1 ? `${e.qty} goals` : '') : `${esc(e.detail || 'Penalty')} · ${e.qty} min`),
      ].join('')}</tr>`);
    const goals = evRows('goal');
    const pens = evRows('pen');
    const evCols = [{ label: 'Per', cls: 'num' }, { label: 'Team' }, { label: '#', cls: 'num' }, { label: 'Player' }, { label: '' }];
    body += `
<h2>Scoring by period</h2>${periodTable}
<div class="grid-2">
<section><h2>Goals</h2>${goals.length ? table(evCols, goals) : '<p class="muted">No goal details recorded.</p>'}</section>
<section><h2>Penalties</h2>${pens.length ? table(evCols, pens) : '<p class="muted">No penalties.</p>'}</section>
</div>
<h2>Goalies</h2>
${table([{ label: 'Team' }, { label: 'Goalie' }, { label: 'Decision' }], [g.away, g.home].map((t) => {
  const goalie = t === g.home ? g.homeGoalie : g.awayGoalie;
  const dec = g.tie ? 'T' : g.winner === t ? 'W' : g.ot ? 'OTL' : 'L';
  return `<tr>${td(teamLink(t, r))}${td(goalie ? playerLink(goalie, r) : '<span class="muted">Not recorded</span>')}${td(dec)}</tr>`;
}))}`;
  } else if (!g.tbd) {
    const h = teamOf(g.home) && teamOf(g.home).h2h.get(g.away);
    body += `<h2>Season series</h2>
<p>${h && h.gp ? `${esc(g.home)} are <b>${rec(h)}</b> against ${esc(g.away)} this season (${h.gf}–${h.ga} in goals).` : 'These teams have not played each other yet this season.'}</p>
${table([{ label: 'Team' }, { label: 'Rank', cls: 'num' }, { label: 'Record' }, { label: 'PTS', cls: 'num' }, { label: 'GF/G', cls: 'num' }, { label: 'GA/G', cls: 'num' }, { label: 'Last 5' }, { label: 'Goalie' }],
  [[g.away, g.awayGoalie], [g.home, g.homeGoalie]].filter(([t]) => teamOf(t)).map(([n, goalie]) => {
    const t = teamOf(n);
    return `<tr>${[td(teamLink(n, r)), td(t.rank, 'num'), td(rec(t)), td(t.pts, 'num'), td(fmt2(t.gf / t.gp), 'num'), td(fmt2(t.ga / t.gp), 'num'), td(form(t.last5)), td(goalie ? playerLink(goalie, r) : '–')].join('')}</tr>`;
  }))}`;
  }
  if (g.subs.length) {
    body += `<h2>Subs</h2>${table([{ label: 'Player' }, { label: 'Played for' }, { label: 'Regular team' }],
      g.subs.map((s) => `<tr>${td(playerLink(s.player, r))}${td(teamLink(s.team, r))}${td(s.mainTeam ? teamLink(s.mainTeam, r) : '<span class="muted">Sub pool</span>')}</tr>`))}`;
  }
  page({ file: `games/${g.num}.html`, title, body });
}

// ---------- Teams ----------
{
  const r = '../';
  const cards = D.standings.map((t) => `<a class="card team-card" href="${t.slug}.html" style="--team:${teamColor(t.name)}">
  <span class="rank">${t.rank}</span>
  ${logoOf(t.name) ? `<img class="card-logo" src="../${logoOf(t.name)}" alt="" width="48" height="48" loading="lazy">` : `<span class="card-logo initials" style="background:${teamColor(t.name)}" aria-hidden="true">${esc(t.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase())}</span>`}
  <b>${esc(t.name)}</b>
  <span>${rec(t)} · ${t.pts} pts</span>
  <span class="muted">${t.roster.length} players · GF ${t.gf} · GA ${t.ga}${[t.links.youtube && '▶ YouTube', t.links.instagram && 'Instagram'].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
</a>`).join('');
  page({ file: 'teams/index.html', title: 'Teams', body: `<h1>Teams</h1><div class="cards team-grid">${cards}</div>` });

  for (const t of D.standings) {
    const games = D.games.filter((g) => g.home === t.name || g.away === t.name);
    const roster = t.roster.map((rp) => {
      const p = playerByName.get(rp.name.toLowerCase());
      let goals = 0, so = 0, pim = 0, gp = 0;
      for (const [, e] of p.log) if (e.team === t.name) { goals += e.goals; so += e.soGoals; pim += e.pim; gp++; }
      return `<tr>${[
        td(esc(rp.number), 'num', Number(rp.number) || 999), td(`${playerLink(rp.name, r)}${rp.captain ? ' <i class="badge" title="Captain">C</i>' : ''}`, '', rp.name),
        td(esc(rp.position), '', rp.position), td(goals, 'num'), td(so || '', 'num', so), td(pim, 'num'),
      ].join('')}</tr>`;
    });
    const h2h = [...t.h2h.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([opp, h]) =>
      `<tr>${[td(teamLink(opp, r), '', opp), td(h.gp, 'num'), td(rec(h), '', h.w * 2 + h.otl + h.t), td(h.gf, 'num'), td(h.ga, 'num'), td(signed(h.gf - h.ga), `num ${h.gf > h.ga ? 'pos' : h.gf < h.ga ? 'neg' : ''}`, h.gf - h.ga)].join('')}</tr>`);
    const goalies = t.goalies.sort((a, b) => b.gp - a.gp).map((s) =>
      `<tr>${[td(playerLink(s.name, r)), td(s.main ? 'Regular' : 'Sub'), td(s.gp, 'num'), td(rec(s)), td(s.ga, 'num'), td(fmt2(s.gaa), 'num'), td(s.sho, 'num')].join('')}</tr>`);
    const subsUsed = D.subs.filter((s) => s.team === t.name);

    const body = `<p class="crumbs"><a href="index.html">Teams</a> › ${esc(t.name)}</p>
<div class="team-head${logoOf(t.name) ? ' has-logo' : ''}" style="--team:${teamColor(t.name)}">
  ${logoOf(t.name) ? `<img class="team-logo" src="${r}${logoOf(t.name)}" alt="${esc(t.name)} logo" width="96" height="96">` : ''}
  <div>
  <h1>${esc(t.name)}</h1>
  <p>${ordinal(t.rank)} place · ${rec(t)} · ${t.pts} points ${t.streak ? `· Streak ${esc(t.streak)}` : ''}</p>
  ${teamSocial(t)}
  </div>
</div>
<div class="tiles">
  ${tile('Points', t.pts)}${tile('P%', pct(t.pct))}${tile('Goals for', t.gf, `${fmt2(t.gf / (t.gp || 1))} / game`)}
  ${tile('Goals against', t.ga, `${fmt2(t.ga / (t.gp || 1))} / game`)}${tile('PIM', t.pim)}
</div>
<div class="tabs" data-tabs>
  <a href="#roster">Roster</a><a href="#games">Schedule</a><a href="#h2h">Head to head</a><a href="#goalies">Goalies</a>
</div>
<section id="roster"><h2>Roster</h2>
${table([{ label: '#', cls: 'num' }, { label: 'Player', sort: 'text' }, { label: 'Pos', sort: 'text' }, { label: 'G', cls: 'num', title: 'Goals for this team' }, { label: 'SO', cls: 'num', title: 'Shootout goals' }, { label: 'PIM', cls: 'num' }], roster, { sortable: true })}
<p class="muted small">Stats count games played for ${esc(t.name)} only.${subsUsed.length ? ` ${esc(t.name)} have used ${subsUsed.length} sub${subsUsed.length === 1 ? '' : 's'} this season.` : ''}</p>
</section>
<section id="games"><h2>Schedule &amp; results</h2>${table(SCHEDULE_COLS, scheduleRows(games, r, t.name))}</section>
<section id="h2h"><h2>Head to head</h2>${h2h.length ? table([{ label: 'Opponent', sort: 'text' }, { label: 'GP', cls: 'num' }, { label: 'Record' }, { label: 'GF', cls: 'num' }, { label: 'GA', cls: 'num' }, { label: 'Diff', cls: 'num' }], h2h, { sortable: true }) : '<p class="muted">No games played yet.</p>'}</section>
<section id="goalies"><h2>Goalies</h2>${goalies.length ? table([{ label: 'Goalie' }, { label: 'Role' }, { label: 'GP', cls: 'num' }, { label: 'Record' }, { label: 'GA', cls: 'num' }, { label: 'GAA', cls: 'num' }, { label: 'SHO', cls: 'num' }], goalies) : '<p class="muted">No games played yet.</p>'}</section>`;
    page({ file: `teams/${t.slug}.html`, title: t.name, body });
  }
}
function tile(label, value, sub) {
  return `<div class="tile"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
}
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------- Players ----------
{
  const r = '';
  const list = D.players.filter((p) => p.team || p.log.size || D.goalies.some((s) => s.name === p.name));
  const options = D.standings.map((t) => `<option value="${t.slug}">${esc(t.name)}</option>`).join('');
  const rows = list
    .sort((a, b) => b.goals - a.goals || b.soGoals - a.soGoals || a.name.localeCompare(b.name))
    .map((p) => {
      const teams = [...new Set([...p.teams, ...[...p.log.values()].map((e) => e.team)])].map((n) => (teamOf(n) ? teamOf(n).slug : '')).join(' ');
      return `<tr data-teams="${teams}" data-name="${esc(p.name.toLowerCase())}">${[
        td(playerLink(p.name, r), '', p.name),
        td(p.teams.length ? p.teams.map((n) => teamLink(n, r)).join('<br>') : '<span class="muted">Sub pool</span>', '', p.team || 'zzz'),
        td(esc(p.number), 'num', Number(p.number) || 999), td(esc(p.position || 'Sub'), '', p.position),
        td(p.goals, 'num'), td(p.soGoals || '', 'num', p.soGoals), td(p.subGoals || '', 'num', p.subGoals),
        td(p.pim, 'num'), td(p.subGames || '', 'num', p.subGames),
      ].join('')}</tr>`;
    });
  const body = `<h1>Players</h1>
<div class="toolbar">
  <label>Search <input type="search" data-filter="name" placeholder="Player name"></label>
  <label>Team <select data-filter="team"><option value="">All teams</option>${options}</select></label>
</div>
${table([
  { label: 'Player', sort: 'text' }, { label: 'Team', sort: 'text' }, { label: '#', cls: 'num' }, { label: 'Pos', sort: 'text' },
  { label: 'G', cls: 'num', title: 'Goals (all teams)' }, { label: 'SO', cls: 'num', title: 'Shootout goals' },
  { label: 'Sub G', cls: 'num', title: 'Goals scored while subbing for another team' },
  { label: 'PIM', cls: 'num', title: 'Penalty minutes' }, { label: 'Subbed', cls: 'num', title: 'Games played as a sub' },
], rows, { sortable: true })}
<p class="muted small">Click a column heading to sort. The league records goals only (no assists).</p>`;
  page({ file: 'players.html', title: 'Players', body });

  for (const p of list) {
    const pr = '../';
    const log = [...p.log.entries()].sort((a, b) => a[0] - b[0]).map(([num, e]) => {
      const g = D.games.find((x) => x.num === num);
      if (!g) return '';
      const opp = g.home === e.team ? g.away : g.home;
      const res = g.played ? (g.tie ? 'T' : g.winner === e.team ? 'W' : g.ot ? 'OTL' : 'L') : '';
      return `<tr>${[
        td(gameLink(g, pr, `#${g.num}`), 'num', g.num), td(dateLabel(g), 'nowrap', g.date ? g.date.toISOString() : ''),
        td(`${teamLink(e.team, pr)}${e.sub || (p.team && !p.teams.includes(e.team)) ? ' <i class="badge" title="Played as a sub">sub</i>' : ''}`),
        td(`${g.home === e.team ? 'vs' : '@'} ${teamLink(opp, pr)}`),
        td(res ? `<i class="badge r-${res.toLowerCase()}">${res}</i>` : ''),
        td(e.goals || '', 'num', e.goals), td(e.soGoals || '', 'num', e.soGoals), td(e.pim ? `${e.pim} <small class="muted">${esc(e.penalties.join(', '))}</small>` : '', 'num', e.pim),
      ].join('')}</tr>`;
    });
    const asGoalie = D.goalies.filter((s) => s.name === p.name);
    const body = `<p class="crumbs"><a href="${pr}players.html">Players</a> › ${esc(p.name)}</p>
<div class="team-head" style="--team:${teamColor(p.team || 'sub')}">
  <h1>${p.number ? `<span class="muted">#${esc(p.number)}</span> ` : ''}${esc(p.name)}${p.captain ? ' <i class="badge" title="Captain">C</i>' : ''}</h1>
  <p>${p.teams.length ? p.teams.map((n) => teamLink(n, pr)).join(' · ') : 'Sub pool'}${p.position ? ` · ${esc(p.position)}` : ''}</p>
</div>
<div class="tiles">${tile('Goals', p.goals)}${tile('Shootout goals', p.soGoals)}${tile('PIM', p.pim)}${tile('Games subbed', p.subGames)}</div>
${asGoalie.length ? `<h2>Goaltending</h2>${table([{ label: 'Team' }, { label: 'Role' }, { label: 'GP', cls: 'num' }, { label: 'Record' }, { label: 'GA', cls: 'num' }, { label: 'GAA', cls: 'num' }, { label: 'SHO', cls: 'num' }],
  asGoalie.map((s) => `<tr>${[td(teamLink(s.team, pr)), td(s.main ? 'Regular' : 'Sub'), td(s.gp, 'num'), td(rec(s)), td(s.ga, 'num'), td(fmt2(s.gaa), 'num'), td(s.sho, 'num')].join('')}</tr>`))}` : ''}
<h2>Game log</h2>
${log.length ? table([{ label: 'Game', cls: 'num' }, { label: 'Date' }, { label: 'For', sort: 'text' }, { label: 'Opponent', sort: 'text' }, { label: 'Result', sort: 'text' }, { label: 'G', cls: 'num' }, { label: 'SO', cls: 'num' }, { label: 'PIM', cls: 'num' }], log, { sortable: true })
  : '<p class="muted">No goals, penalties or sub appearances recorded yet.</p>'}
<p class="muted small">The game log lists games where this player scored, took a penalty or subbed. Other appearances aren't recorded in the spreadsheet.</p>`;
    page({ file: `players/${p.slug}.html`, title: p.name, body });
  }
}

// ---------- Goalies ----------
{
  const r = '';
  const row = (s) => `<tr>${[
    td(playerLink(s.name, r), '', s.name), td(teamLink(s.team, r), '', s.team), td(s.gp, 'num'), td(s.w, 'num'), td(s.l, 'num'), td(s.otl, 'num'),
    td(pct(s.gp ? s.pts / (s.gp * config.points.win) : 0), 'num', s.gp ? s.pts / s.gp : 0), td(s.ga, 'num'), td(fmt2(s.gaa), 'num', s.gaa), td(s.sho, 'num'),
  ].join('')}</tr>`;
  const cols = [
    { label: 'Goalie', sort: 'text' }, { label: 'Team', sort: 'text' }, { label: 'GP', cls: 'num' }, { label: 'W', cls: 'num' }, { label: 'L', cls: 'num' },
    { label: 'OTL', cls: 'num' }, { label: 'P%', cls: 'num' }, { label: 'GA', cls: 'num' }, { label: 'GAA', cls: 'num', title: 'Goals against per game' }, { label: 'SHO', cls: 'num', title: 'Shutouts' },
  ];
  const byGaa = (a, b) => a.gaa - b.gaa || b.gp - a.gp;
  const body = `<h1>Goalies</h1>
<h2>Regular goalies</h2>${table(cols, D.goalies.filter((s) => s.main).sort(byGaa).map(row), { sortable: true })}
<h2>Sub goalies</h2>${table(cols, D.goalies.filter((s) => !s.main).sort(byGaa).map(row), { sortable: true })}
<p class="muted small">Based on the starting goalie of each game. Shootout goals don't count as goals against.</p>`;
  page({ file: 'goalies.html', title: 'Goalies', body });
}

// ---------- Subs ----------
{
  const r = '';
  const options = D.standings.map((t) => `<option value="${t.slug}">${esc(t.name)}</option>`).join('');
  const counts = D.standings.map((t) => [t, D.subs.filter((s) => s.team === t.name).length]).sort((a, b) => b[1] - a[1]);
  const rows = D.subs.map((s) => {
    const g = D.games.find((x) => x.num === s.game);
    const teams = [s.team, s.mainTeam].filter((n) => teamOf(n)).map((n) => teamOf(n).slug).join(' ');
    return `<tr data-teams="${teams}" data-name="${esc(s.player.toLowerCase())}">${[
      td(g ? gameLink(g, r, `#${g.num}`) : s.game, 'num', s.game), td(g ? dateLabel(g) : '', 'nowrap', g && g.date ? g.date.toISOString() : ''),
      td(playerLink(s.player, r), '', s.player), td(teamLink(s.team, r), '', s.team), td(teamLink(s.opponent, r), '', s.opponent),
      td(s.mainTeam ? teamLink(s.mainTeam, r) : '<span class="muted">Sub pool</span>', '', s.mainTeam || 'zzz'),
    ].join('')}</tr>`;
  });
  const body = `<h1>Subs</h1>
<p class="lede">${D.subs.length} sub appearances this season.</p>
<div class="tiles">${counts.map(([t, n]) => tile(teamLink(t.name, r), n)).join('')}</div>
<div class="toolbar">
  <label>Search <input type="search" data-filter="name" placeholder="Player name"></label>
  <label>Team <select data-filter="team"><option value="">All teams</option>${options}</select></label>
</div>
${table([{ label: 'Game', cls: 'num' }, { label: 'Date' }, { label: 'Player', sort: 'text' }, { label: 'Subbed for', sort: 'text' }, { label: 'Opponent', sort: 'text' }, { label: 'Regular team', sort: 'text' }], rows, { sortable: true })}`;
  page({ file: 'subs.html', title: 'Subs', body });
}

// ---------- Videos ----------
{
  const r = '';
  const games = videoGames();
  const withVideo = D.standings.filter((t) => games.some((g) => g.home === t.name || g.away === t.name));
  const options = withVideo.map((t) => `<option value="${t.slug}">${esc(t.name)}</option>`).join('');
  const channels = D.standings.filter((t) => t.links.youtube)
    .map((t) => `<a class="yt" href="${esc(t.links.youtube)}" target="_blank" rel="noopener">${YT_ICON}${esc(t.name)}</a>`).join('');
  const body = `<h1>Game videos</h1>
<p class="lede">${games.length} games from this season have video, filmed by the teams themselves. Newest first.</p>
${channels ? `<div class="social">${channels}</div>` : ''}
<div class="toolbar">
  <label>Team <select data-filter="team"><option value="">All teams</option>${options}</select></label>
</div>
${games.length ? `<div class="video-grid">${games.map((g) => videoCard(g, r)).join('\n')}</div>` : '<p class="muted">No game videos yet.</p>'}
<p class="muted small">Videos are matched to games automatically from the team YouTube channels. A missing or wrong link can be fixed in <code>game-videos.json</code>.</p>`;
  page({ file: 'videos.html', title: 'Videos', body });
}

// 404 page for static hosts
page({ file: '404.html', title: 'Not found', body: '<h1>Page not found</h1><p><a href="index.html">Back to standings</a></p>' });

const count = (dir) => fs.readdirSync(path.join(OUT, dir)).filter((f) => f.endsWith('.html')).length;
console.log(`Built ${count('.')} pages + ${count('games')} games, ${count('teams')} teams, ${count('players')} players into ${OUT}/`);
if (D.warnings.length) {
  console.log(`\n${new Set(D.warnings).size} data note(s) — worth checking in the spreadsheet:`);
  for (const w of [...new Set(D.warnings)]) console.log(`  - ${w}`);
}
