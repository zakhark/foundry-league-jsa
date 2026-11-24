// node --test scripts/
const test = require('node:test');
const assert = require('node:assert');
const { parseFileName, checkFile } = require('./analytics');

const game77 = { num: 77, date: new Date(Date.UTC(2026, 10, 16)), away: 'Sk8Balls', home: 'Whalers', played: true };
const gameByNum = new Map([[77, game77], [78, { ...game77, num: 78, played: false }]]);
const ttsByNum = new Map([[77, 88328]]);
const canonTeam = (n) => (n === 'Sk8 Balls' ? 'Sk8Balls' : n);

const goal = (over = {}) => ({
  period: 1, team: 'Whalers', score: '1-0', videoTime: 95,
  scorer: { name: 'Ryan Chichester', jersey: '22' }, assist1: null, assist2: null,
  shot: { x: 87, y: 28 }, pass: null, verified: true, ...over,
});
const file = (over = {}, goals = [goal()]) => ({
  schema: 'analytics-v1',
  game: { num: 77, ttsGameId: 88328, blackbearId: 110413, date: '2026-11-16', away: 'Sk8Balls', home: 'Whalers',
    youtubeUrl: 'https://www.youtube.com/watch?v=BXMjXpxCO5o', ...over.game },
  submittedBy: over.submittedBy || { team: 'Sk8Balls' },
  goals,
});
const check = (name, json) => checkFile({ file: name, json, gameByNum, ttsByNum, canonTeam });

test('parses file names', () => {
  assert.deepStrictEqual(parseFileName('77-sk8balls.json'), { num: 77, slug: 'sk8balls' });
  assert.deepStrictEqual(parseFileName('5-kraken-cold-ones.json'), { num: 5, slug: 'kraken-cold-ones' });
  assert.equal(parseFileName('88328.analytics-v1.json'), null);
  assert.equal(parseFileName('77-Sk8Balls.json'), null);
});

test('accepts a valid file and normalises goals', () => {
  const r = check('77-sk8balls.json', file({}, [
    goal(),
    goal({ team: 'Sk8Balls', score: '2-1', period: 'OT', assist1: { name: 'A B', jersey: '9' }, assist2: null,
      pass: { x: 40, y: -10 } }),
  ]));
  assert.equal(r.skip, undefined);
  assert.equal(r.game, game77);
  assert.equal(r.slug, 'sk8balls');
  assert.deepStrictEqual(r.notes, []);
  assert.deepStrictEqual(r.goals[0], {
    period: '1', team: 'Whalers', home: 1, away: 0, videoTime: 95,
    scorer: { name: 'Ryan Chichester', jersey: '22' }, assists: [], shot: { x: 87, y: 28 }, pass: null,
    youtubeUrl: 'https://www.youtube.com/watch?v=BXMjXpxCO5o',
  });
  assert.equal(r.goals[1].period, 'OT');
  assert.equal(r.goals[1].home, 2);
  assert.equal(r.goals[1].away, 1);
  assert.deepStrictEqual(r.goals[1].assists, [{ name: 'A B', jersey: '9' }]);
});

test('skips a file whose game.num differs from its name', () => {
  assert.match(check('76-sk8balls.json', file()).skip, /76/);
});

test('skips a file whose submittedBy.team disagrees with its slug', () => {
  assert.ok(check('77-whalers.json', file()).skip);
  assert.ok(check('77-league.json', file()).skip);
  assert.equal(check('77-league.json', file({ submittedBy: { team: 'league' } })).skip, undefined);
  assert.equal(check('77-sk8balls.json', file({ submittedBy: { team: 'Sk8 Balls' } })).skip, undefined);
});

test("skips a file whose teams don't match the game", () => {
  assert.ok(check('77-sk8balls.json', file({ game: { away: 'Reapers' } })).skip);
  assert.ok(check('77-sk8balls.json', file({ game: { date: '2026-11-15' } })).skip);
});

test('skips a file whose ttsGameId differs from game-center.json', () => {
  assert.ok(check('77-sk8balls.json', file({ game: { ttsGameId: 88329 } })).skip);
});

test('accepts a file without ttsGameId', () => {
  assert.equal(check('77-sk8balls.json', file({ game: { ttsGameId: undefined } })).skip, undefined);
});

test('skips an unknown or unplayed game, a wrong schema and a team not in the game', () => {
  assert.ok(check('99-sk8balls.json', file({ game: { num: 99 } })).skip);
  assert.ok(check('78-sk8balls.json', file({ game: { num: 78 } })).skip);
  assert.ok(check('77-sk8balls.json', { ...file(), schema: 'analytics-v2' }).skip);
  assert.ok(check('77-reapers.json', file({ submittedBy: { team: 'Reapers' } })).skip);
  assert.ok(check('bad.json', file()).skip);
});

test('drops unverified goals silently and bad goals with a note', () => {
  const r = check('77-sk8balls.json', file({}, [
    goal(),
    goal({ score: '2-0', verified: false }),
    goal({ score: '3-0', shot: { x: 150, y: 0 } }),
    goal({ score: '1-0' }),
    goal({ score: '4-0', team: 'Reapers' }),
    goal({ score: '5-0', period: 4 }),
    goal({ score: 'x' }),
    goal({ score: '6-0', pass: { x: 0, y: 50 } }),
  ]));
  assert.equal(r.goals.length, 1);
  assert.equal(r.notes.length, 6);
});

test('blanks a bad videoTime or a non-YouTube link', () => {
  const r = check('77-sk8balls.json', file({ game: { youtubeUrl: 'https://evil.example/x' } }, [goal({ videoTime: -5 })]));
  assert.equal(r.goals[0].videoTime, null);
  assert.equal(r.goals[0].youtubeUrl, null);
});

// ---------- Task 3: one version per goal, goal-count corrections ----------
const { pickGoals, correctEvents } = require('./analytics');

const G = (team, home, away, scorer, over = {}) => ({
  period: '1', team, home, away, videoTime: 10,
  scorer: scorer ? { name: scorer, jersey: '1' } : null, assists: [], shot: { x: 80, y: 0 }, pass: null, youtubeUrl: null, ...over,
});

test("scoring team's own file wins, then league, then opponent", () => {
  const whalersGoal = (who) => G('Whalers', 1, 0, who);
  const picked = pickGoals(game77, [
    { slug: 'sk8balls', goals: [whalersGoal('Opponent Pick')] },
    { slug: 'league', goals: [whalersGoal('League Pick')] },
    { slug: 'whalers', goals: [whalersGoal('Own Pick')] },
  ]);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].scorer.name, 'Own Pick');
  assert.equal(picked[0].source, 'whalers');
  const noOwn = pickGoals(game77, [
    { slug: 'sk8balls', goals: [whalersGoal('Opponent Pick')] },
    { slug: 'league', goals: [whalersGoal('League Pick')] },
  ]);
  assert.equal(noOwn[0].scorer.name, 'League Pick');
});

test('a goal only the opponent tagged is still used', () => {
  const picked = pickGoals(game77, [
    { slug: 'whalers', goals: [G('Whalers', 1, 0, 'A'), G('Sk8Balls', 1, 1, 'B')] },
    { slug: 'sk8balls', goals: [G('Sk8Balls', 1, 1, 'C')] },
  ]);
  assert.deepStrictEqual(picked.map((g) => g.scorer.name), ['A', 'C']);
});

const roster = new Set(['Ann Ace', 'Bob Bolt', 'Cy Cole', 'Dee Dunn']);
const canonPlayer = (n) => (n === 'Annie Ace' ? 'Ann Ace' : n);
const realGoals = (g, side) => (side === 'home' ? g.homeScore : g.awayScore) - (g.so && g.winner === g[side] ? 1 : 0);
const played = (over = {}) => ({ ...game77, homeScore: 2, awayScore: 1, winner: 'Whalers', ...over });
const ev = (team, player, qty = 1, type = 'Goal', period = '1') => ({ game: 77, period, team, number: '', player, type, detail: '', qty });
const run = (game, goals, events) => {
  const notes = [];
  const out = correctEvents({ events, games: [game], picked: new Map([[77, goals]]), canonPlayer, isRoster: (n) => roster.has(n), warn: (m) => notes.push(m), realGoals });
  return { out, notes };
};

test('complete team: sheet goals replaced and a note per changed player', () => {
  const goals = [G('Whalers', 1, 0, 'Annie Ace'), G('Whalers', 2, 0, 'Bob Bolt', { period: '2' }), G('Sk8Balls', 2, 1, 'Zed Unknown')];
  const { out, notes } = run(played(), goals, [ev('Whalers', 'Ann Ace', 2), ev('Sk8Balls', 'Cy Cole'), ev('Whalers', 'Dee Dunn', 1, 'Penalty')]);
  const whalers = out.filter((e) => e.team === 'Whalers' && e.type === 'Goal');
  assert.deepStrictEqual(whalers.map((e) => [e.player, e.period, e.qty, e.video]), [['Ann Ace', '1', 1, true], ['Bob Bolt', '2', 1, true]]);
  assert.ok(out.some((e) => e.type === 'Penalty'));
  assert.ok(out.some((e) => e.team === 'Sk8Balls' && e.player === 'Cy Cole' && !e.video), 'incomplete Sk8Balls keep the sheet');
  assert.ok(notes.some((n) => /Ann Ace 1 goal.*sheet has 2/.test(n)));
  assert.ok(notes.some((n) => /Bob Bolt 1 goal.*sheet has 0/.test(n)));
  assert.equal(goals[0].scorer.player, 'Ann Ace');
  assert.equal(goals[2].scorer.player, null);
});

test('incomplete team keeps sheet goals', () => {
  const { out } = run(played({ homeScore: 3 }), [G('Whalers', 1, 0, 'Ann Ace'), G('Whalers', 2, 0, 'Bob Bolt')], [ev('Whalers', 'Ann Ace', 3)]);
  assert.deepStrictEqual(out.map((e) => [e.player, e.qty, !!e.video]), [['Ann Ace', 3, false]]);
});

test('a goal with no or unmatched scorer leaves the team incomplete', () => {
  for (const who of [null, 'Zed Unknown']) {
    const { out, notes } = run(played(), [G('Whalers', 1, 0, 'Ann Ace'), G('Whalers', 2, 0, who)], [ev('Whalers', 'Ann Ace', 2)]);
    assert.deepStrictEqual(out.map((e) => [e.player, e.qty]), [['Ann Ace', 2]]);
    assert.ok(notes.some((n) => (who ? /Zed Unknown.*isn't on any roster/ : /no scorer/).test(n)));
  }
});

test('shootout: completeness uses realGoals, SO Goal events untouched', () => {
  const game = played({ homeScore: 2, awayScore: 1, so: true, winner: 'Whalers' }); // 1-1 after OT, Whalers win the SO
  const { out } = run(game, [G('Whalers', 1, 0, 'Bob Bolt')], [ev('Whalers', 'Ann Ace'), ev('Whalers', 'Cy Cole', 1, 'SO Goal', 'SO')]);
  assert.deepStrictEqual(out.map((e) => [e.player, e.type, !!e.video]), [['Cy Cole', 'SO Goal', false], ['Bob Bolt', 'Goal', true]]);
});

test('assists are matched to roster names', () => {
  const goals = [G('Whalers', 1, 0, 'Ann Ace', { assists: [{ name: 'Annie Ace', jersey: '' }, { name: 'Nope', jersey: '' }] })];
  run(played({ homeScore: 1, awayScore: 0 }), goals, []);
  assert.deepStrictEqual(goals[0].assists.map((a) => a.player), ['Ann Ace', null]);
});

test('skips a game whose score so far only comes from the rink', () => {
  const byNum = new Map([[77, { ...game77, fromRink: true }]]);
  assert.match(checkFile({ file: '77-sk8balls.json', json: file(), gameByNum: byNum, ttsByNum, canonTeam }).skip, /no score in the sheet/);
});

// ---------- The published format (src/formats/) ----------
test("the published analytics schema's example passes the site's checks", () => {
  const schema = require('../src/formats/analytics-v1.schema.json');
  const { SCHEMA } = require('./analytics');
  assert.equal(schema.properties.schema.const, SCHEMA);
  const ex = schema.examples[0];
  const [y, m, d] = ex.game.date.split('-').map(Number);
  const game = { num: ex.game.num, date: new Date(Date.UTC(y, m - 1, d)), away: ex.game.away, home: ex.game.home, played: true };
  const slug = ex.submittedBy.team.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const r = checkFile({ file: `${ex.game.num}-${slug}.json`, json: ex, gameByNum: new Map([[game.num, game]]), ttsByNum: new Map([[game.num, ex.game.ttsGameId]]), canonTeam: (n) => n });
  assert.equal(r.skip, undefined);
  assert.deepStrictEqual(r.notes, []);
  assert.equal(r.goals.length, ex.goals.filter((g) => g.verified).length);
});
