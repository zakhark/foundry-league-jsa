// Goal analytics from tagged game video (files made by the league's video tool).
// See docs/superpowers/specs/2026-11-20-game-analytics-design.md.
// Only goals a person confirmed (verified: true) are ever used.

// Lazy: data.js requires this module, so a top-level require would be a cycle.
const data = () => require('./data');

// The file format the site reads; published as src/formats/analytics-v1.schema.json.
const SCHEMA = 'analytics-v1';
const PERIODS = new Set(['1', '2', '3', 'OT']);
const MAX_VIDEO_SECONDS = 6 * 3600;

function parseFileName(file) {
  const m = /^(\d+)-([a-z0-9-]+)\.json$/.exec(file);
  return m ? { num: Number(m[1]), slug: m[2] } : null;
}

const isoDate = (d) => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '');
const inRange = (p, needed) =>
  p == null ? !needed : Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 100 && Math.abs(p.y) <= 42.5;
const person = (p) => (p && typeof p.name === 'string' && p.name.trim() ? { name: p.name.trim(), jersey: String(p.jersey ?? '') } : null);

// Checks one file against the schedule. Returns { skip: reason } when the whole
// file can't be used, else the game, the submitter's slug, the usable goals and
// notes about goals that were dropped.
function checkFile({ file, json, gameByNum, ttsByNum, canonTeam }) {
  const { slugify, isYouTube } = data();
  const name = parseFileName(file);
  if (!name) return { skip: 'the name must be <game #>-<team or league>.json' };
  if (!json || json.schema !== SCHEMA) return { skip: `schema is "${json && json.schema}", the site reads ${SCHEMA}` };
  const info = json.game || {};
  if (Number(info.num) !== name.num) return { skip: `game.num is ${info.num}, but the file name says ${name.num}` };
  const by = String((json.submittedBy && json.submittedBy.team) || '');
  const bySlug = by.toLowerCase() === 'league' ? 'league' : slugify(canonTeam(by));
  if (bySlug !== name.slug) return { skip: `submittedBy.team "${by}" doesn't match "${name.slug}" in the file name` };
  const game = gameByNum.get(name.num);
  if (!game) return { skip: `there's no game #${name.num}` };
  if (info.date !== isoDate(game.date) || canonTeam(info.away) !== game.away || canonTeam(info.home) !== game.home) {
    return { skip: `it's for ${info.away} at ${info.home} on ${info.date}, but game #${game.num} is ${game.away} at ${game.home} on ${isoDate(game.date)}` };
  }
  const tts = ttsByNum.get(game.num);
  if (info.ttsGameId != null && tts != null && Number(info.ttsGameId) !== Number(tts)) {
    return { skip: `ttsGameId ${info.ttsGameId} isn't game #${game.num}'s rink id (${tts})` };
  }
  if (!game.played || game.fromRink) return { skip: `game #${game.num} has no score in the sheet yet` };
  if (name.slug !== 'league' && name.slug !== slugify(game.home) && name.slug !== slugify(game.away)) {
    return { skip: `"${name.slug}" isn't a team in game #${game.num}` };
  }

  const youtubeUrl = isYouTube(info.youtubeUrl) ? info.youtubeUrl : null;
  const notes = [];
  const goals = [];
  const seen = new Set();
  for (const g of Array.isArray(json.goals) ? json.goals : []) {
    if (!g || g.verified !== true) continue;
    const label = `goal ${g.score}`;
    const period = String(g.period);
    const team = canonTeam(g.team);
    const score = /^(\d+)-(\d+)$/.exec(String(g.score));
    let problem = '';
    if (!PERIODS.has(period)) problem = `period "${g.period}" isn't 1, 2, 3 or OT`;
    else if (team !== game.home && team !== game.away) problem = `team "${g.team}" isn't in this game`;
    else if (!score) problem = 'the score isn\'t "<home>-<away>"';
    else if (!inRange(g.shot, true) || !inRange(g.pass, false)) problem = 'a shot or pass position is off the rink';
    else if (seen.has(g.score)) problem = 'another goal in this file has the same score';
    if (problem) {
      notes.push(`${label} dropped: ${problem}`);
      continue;
    }
    seen.add(g.score);
    const t = g.videoTime;
    goals.push({
      period, team,
      home: Number(score[1]), away: Number(score[2]),
      videoTime: Number.isInteger(t) && t >= 0 && t <= MAX_VIDEO_SECONDS ? t : null,
      scorer: person(g.scorer),
      assists: [person(g.assist1), person(g.assist2)].filter(Boolean),
      shot: { x: g.shot.x, y: g.shot.y },
      pass: g.pass ? { x: g.pass.x, y: g.pass.y } : null,
      youtubeUrl,
    });
  }
  return { game, slug: name.slug, goals, notes };
}

// One version of each goal across all files for a game. Goals are the same goal
// when they have the same score. For a goal by team T, T's own file wins, then
// the league's, then the opponent's.
function pickGoals(game, entries) {
  const { slugify } = data();
  const rank = (slug, team) => (slug === slugify(team) ? 0 : slug === 'league' ? 1 : 2);
  const best = new Map();
  for (const { slug, goals } of entries) {
    for (const goal of goals) {
      const key = `${goal.home}-${goal.away}`;
      const r = rank(slug, goal.team);
      if (!best.has(key) || r < best.get(key).r) best.set(key, { r, goal: { ...goal, source: slug } });
    }
  }
  return [...best.values()].map((b) => b.goal).sort((a, b) => a.home + a.away - (b.home + b.away));
}

// Matches scorers and assisters to roster names (goal.scorer.player and
// goal.assists[i].player, null when unmatched). Where the video has every goal a
// team scored in a game with a matched scorer, that team's goal events in the
// game are replaced by the video's. Shootout goals and penalties are never touched.
function correctEvents({ events, games, picked, canonPlayer, isRoster, warn, realGoals }) {
  const match = (p, team) => {
    if (!p) return;
    const name = canonPlayer(p.name, team);
    p.player = isRoster(name) ? name : null;
  };
  const replace = new Set(); // "<game>|<team>"
  const added = [];
  for (const g of games) {
    const goals = picked.get(g.num);
    if (!goals) continue;
    for (const goal of goals) {
      match(goal.scorer, goal.team);
      goal.assists.forEach((a) => match(a, goal.team));
      const at = `Game #${g.num}: video goal ${goal.home}-${goal.away} (${goal.team})`;
      if (!goal.scorer) warn(`${at} has no scorer; not counted`);
      else if (!goal.scorer.player) warn(`${at}: "${goal.scorer.name}" isn't on any roster; not counted`);
      for (const a of goal.assists) if (!a.player) warn(`${at}: assist "${a.name}" isn't on any roster; not counted`);
    }
    for (const side of ['home', 'away']) {
      const team = g[side];
      const mine = goals.filter((x) => x.team === team);
      if (mine.length !== realGoals(g, side) || mine.some((x) => !x.scorer || !x.scorer.player)) continue;
      const count = (list) => list.reduce((m, [p, q]) => m.set(p, (m.get(p) || 0) + q), new Map());
      const sheet = count(events.filter((e) => e.game === g.num && e.team === team && e.type === 'Goal').map((e) => [e.player, e.qty]));
      const video = count(mine.map((x) => [x.scorer.player, 1]));
      for (const p of new Set([...sheet.keys(), ...video.keys()])) {
        if ((sheet.get(p) || 0) !== (video.get(p) || 0)) {
          warn(`Game #${g.num}: video has ${p} ${video.get(p) || 0} goal(s), sheet has ${sheet.get(p) || 0}`);
        }
      }
      replace.add(`${g.num}|${team}`);
      for (const x of mine) {
        added.push({ game: g.num, period: x.period, team, number: x.scorer.jersey, player: x.scorer.player, type: 'Goal', detail: '', qty: 1, video: true });
      }
    }
  }
  return [...events.filter((e) => !(e.type === 'Goal' && replace.has(`${e.game}|${e.team}`))), ...added];
}

module.exports = { SCHEMA, parseFileName, checkFile, pickGoals, correctEvents };
