// Freezes the current season: saves its parsed data to seasons/<n>/archive.json
// so the season can still be built after the league moves to a new spreadsheet.
//
//   npm run freeze-season
//
// Run it when the season (including playoffs) is over, right before switching
// to the next season's sheet. Running it again overwrites the archive with the
// latest data. The archive holds only what the site shows: schedule, scores,
// goals and penalties, rosters and subs. The workbook itself, with its private
// tabs, is never saved.
const fs = require('fs');
const config = require('./config');
const { freeze } = require('./data');

if (!fs.existsSync(config.dataFile)) {
  console.error(`${config.dataFile} not found. Run "npm run fetch" first.`);
  process.exit(1);
}
const r = freeze(config.dataFile);
console.log(`Froze season ${r.season}: ${r.games} games and ${r.events} goals/penalties saved to ${r.file}.`);
console.log(`Check it builds: node scripts/build.js --archive ${r.season} --out dist-archive`);
