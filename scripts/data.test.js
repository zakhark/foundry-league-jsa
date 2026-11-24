// node --test scripts/
const test = require('node:test');
const assert = require('node:assert');
const { makePlayerMatcher } = require('./data');

test('maps short and nickname forms to roster names', () => {
  const notes = [];
  const canon = makePlayerMatcher(
    [{ name: 'Matthew Angarone', team: 'Reapers' }, { name: 'Jeffrey Truszkowski', team: 'Sk8Balls' }],
    (m) => notes.push(m),
  );
  assert.equal(canon('Matt Angarone', 'Reapers'), 'Matthew Angarone');
  assert.equal(canon('Jefffrey Truszkowski', 'Sk8Balls'), 'Jeffrey Truszkowski');
  assert.equal(canon('Nobody Here', 'Reapers'), 'Nobody Here');
  assert.equal(notes.length, 2);
});

test('initials as a first name match the full first name', () => {
  const notes = [];
  const canon = makePlayerMatcher([{ name: 'JP Stabner', team: 'Sk8Balls' }, { name: 'Robert Kim', team: 'Reapers' }], (m) => notes.push(m));
  assert.equal(canon('John Stabner', 'Sk8Balls'), 'JP Stabner');
  assert.equal(canon('Robert Stabner', 'Sk8Balls'), 'Robert Stabner'); // first letter differs
  assert.equal(canon('Rk Kim', 'Reapers'), 'Robert Kim');
  assert.equal(notes.length, 2);
});
