// node --test scripts/
const test = require('node:test');
const assert = require('node:assert');
const { descriptionMoments } = require('./find-videos');

test('reads the description styles the team channels use', () => {
  assert.deepStrictEqual(descriptionMoments('Jersey Shore Arena\n\n0:00 1st Period\n04:45 Flamingos 1-0\n1:04:44 UnDucks: \n'), [
    { t: 0, label: '1st Period' },
    { t: 285, label: 'Flamingos 1-0' },
    { t: 3884, label: 'UnDucks' },
  ]);
  assert.deepStrictEqual(descriptionMoments('@6:30 0:1\n@1:08:27 2:3 (SO)'), [
    { t: 390, label: '0:1' },
    { t: 4107, label: '2:3 (SO)' },
  ]);
  assert.deepStrictEqual(descriptionMoments('2nd Period: 21:01\n\n23:53\nKraken 1-2\n\n23:29\nUnDucks 2-2\nFinal Score:'), [
    { t: 1261, label: '2nd Period' },
    { t: 1409, label: 'UnDucks 2-2' },
    { t: 1433, label: 'Kraken 1-2' },
  ]);
});

test('ignores descriptions without a list of moments', () => {
  assert.deepStrictEqual(descriptionMoments(''), []);
  assert.deepStrictEqual(descriptionMoments('Puck drop 7:30 PM\nAt 9:15 pm too\n12:00'), []);
});
