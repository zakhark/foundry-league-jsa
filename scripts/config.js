// Site configuration. Edit these values to customise the site.
const fs = require('fs');

// Load KEY=VALUE pairs from a local .env file (not committed) into process.env.
// Real environment variables win over .env.
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

module.exports = {
  // Shown in the header and page titles.
  leagueName: process.env.LEAGUE_NAME || 'Foundry Adult Hockey League',

  // ID of the league Google Sheet (the long part of its URL). It is kept out of
  // the code on purpose, because anyone with it can open every tab of the
  // sheet, including hidden ones. Set it in .env locally (see .env.example)
  // and as the SHEET_ID repository secret for GitHub Actions.
  sheetId: process.env.SHEET_ID || '',

  // Where the downloaded workbook is stored and where the site is written.
  dataFile: 'data/sheet.xlsx',
  outDir: 'dist',

  // Standings points.
  points: { win: 2, otLoss: 1, tie: 1 },

  // Team names to show instead of the sheet's spelling, everywhere on the site
  // and in the calendar and BenchApp files. Applied when the sheet is read; the
  // old spelling also keeps working as a key in team-links.json and the
  // seasons/ files.
  teamRenames: {
    'Sk8 Balls': 'Sk8Balls',
  },

  // Number of upcoming games and latest results shown on the home page.
  upcomingCount: 8,
  recentCount: 8,

  // Team calendars (.ics) and BenchApp import files (.csv).
  // Game times in the sheet are local times in this time zone.
  timeZone: 'America/New_York',
  // How long a game takes, for calendar events and BenchApp ("H:MM").
  gameMinutes: 90,
  // Full names and street addresses for the sheet's arena codes, used as the
  // event location (the rink goes in the event notes). Unknown codes are shown as they are.
  arenas: {
    JSA: { name: 'Jersey Shore Arena', address: '1215 Wyckoff Rd, Wall Township, NJ 07727' },
    Howell: { name: 'Howell Ice Arena', address: '269 Squankum Rd, Farmingdale, NJ 07727' },
  },
  // Team names to use in BenchApp files and calendars when they differ from
  // the sheet. BenchApp matches teams by exact name, so these must be spelled
  // exactly as the teams are named in BenchApp.
  benchAppNames: {},
  // Scores from the rink's game center for games the sheet has no score for
  // yet (npm run rink-scores). Only games that started within the last 'hours'
  // hours are looked up, i.e. the game night and the day after. The build
  // ignores a file older than that.
  rinkScores: { file: 'data/rink-scores.json', hours: 36 },
  // Black Bear TV stream links (npm run blackbear). location and category are
  // Black Bear TV's IDs for Jersey Shore Arena and "Adult League". teamNames:
  // Black Bear TV's spelling -> ours, where they differ beyond case and spaces.
  blackbear: {
    file: 'data/blackbear.json',
    api: 'https://blackbear-ep-drbwhnh8gtdafucc.a03.azurefd.net',
    location: 91,
    category: 136,
    teamNames: { Ducks: 'UnDucks' },
  },
  // The public site address, used for links inside calendar events.
  siteUrl: process.env.SITE_URL || 'https://zakhark.github.io/foundry-league-jsa/',
};
