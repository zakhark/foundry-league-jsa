// Team schedules for other apps:
//   - calendar/<team>.ics: iCalendar feeds people can
//     subscribe to (Google/Apple/Outlook calendars, BenchApp's calendar sync).
//     They are rebuilt with the site, so subscribers get time changes too.
//   - benchapp/<team>.csv: BenchApp's "Import Events" CSV template, filled in
//     with the team's games (https://www.benchapp.com/schedule/import).
const config = require('./config');

// ---------- times ----------
// "8:20 PM" -> { h: 20, m: 20 }, or null.
function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])\.?M\.?$/i.exec(String(s || '').trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'P') h += 12;
  return { h, m: Number(m[2]) };
}

// Offset of a time zone from UTC at a given instant, in minutes.
function tzOffset(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return (asUtc - ms) / 60000;
}

// A game's start as a real instant: its date and local time in config.timeZone.
// Returns null if the game has no usable time.
function startOf(g) {
  const t = parseTime(g.time);
  if (!g.date || !t) return null;
  const local = Date.UTC(g.date.getUTCFullYear(), g.date.getUTCMonth(), g.date.getUTCDate(), t.h, t.m);
  // Two passes settle the offset even next to a daylight-saving change.
  let ms = local - tzOffset(local, config.timeZone) * 60000;
  ms = local - tzOffset(ms, config.timeZone) * 60000;
  return new Date(ms);
}

const arenaOf = (g) => config.arenas[g.arena] || { name: g.arena || '', address: '' };
// The facility is the location; the rink inside it (e.g. "White rink") goes in the notes.
const locationOf = (g) => arenaOf(g).name;
const rinkOf = (g) => (g.rink ? `${g.rink} rink` : '');
const gameUrl = (g) => (config.siteUrl ? `${config.siteUrl.replace(/\/?$/, '/')}games/${g.num}.html` : '');
// Team names as BenchApp knows them (config.benchAppNames), used in both the CSV and the calendars.
const teamName = (n) => (config.benchAppNames || {})[n] || n;
const result = (g) => (g.played ? `Final: ${teamName(g.away)} ${g.awayScore}, ${teamName(g.home)} ${g.homeScore}${g.so ? ' (SO)' : g.ot ? ' (OT)' : ''}` : '');

// ---------- iCalendar ----------
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTime = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDate = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
// Lines longer than 75 bytes are folded onto continuation lines starting with a space.
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function ics({ name, games, season, builtAt }) {
  const stamp = icsTime(builtAt);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${config.leagueName}//Schedule//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`, `X-WR-TIMEZONE:${config.timeZone}`,
    // Ask subscribed apps to check for changes a few times a day.
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
  ];
  for (const g of games) {
    const start = startOf(g);
    const desc = [`Game ${g.num}${g.week ? ` · Week ${g.week}` : ''}${g.playoff ? ' · Playoffs' : ''}`, rinkOf(g), result(g), g.comment, gameUrl(g)].filter(Boolean).join('\n');
    const addr = arenaOf(g).address;
    lines.push(
      'BEGIN:VEVENT',
      // Stable per season and game number, so a changed time updates the event instead of adding one.
      `UID:s${season}-game-${g.num}@${slugifyHost(config.leagueName)}`,
      `DTSTAMP:${stamp}`,
      ...(start
        ? [`DTSTART:${icsTime(start)}`, `DTEND:${icsTime(new Date(start.getTime() + config.gameMinutes * 60000))}`]
        : [`DTSTART;VALUE=DATE:${icsDate(g.date)}`]), // no time yet: an all-day event
      `SUMMARY:${icsText(`${teamName(g.away)} @ ${teamName(g.home)}`)}`,
      `LOCATION:${icsText([locationOf(g), addr].filter(Boolean).join(', '))}`,
      `DESCRIPTION:${icsText(desc)}`,
      ...(gameUrl(g) ? [`URL:${gameUrl(g)}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
const slugifyHost = (s) => `${String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.schedule`;

// ---------- BenchApp CSV ----------
// Follows BenchApp's schedule-import-template.csv: a title row, a blank row,
// then the header. Dates must be DD/MM/YYYY, times like "9:00 PM", durations H:MM.
const BENCHAPP_HEADER = ['Type', 'Game Type', 'Title (Optional)', 'Away', 'Home', 'Date', 'Time', 'Duration', 'Location (Optional)', 'Address (Optional)', 'Notes (Optional)'];
const csvCell = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const pad = (n) => String(n).padStart(2, '0');

function benchAppCsv(games) {
  const blank = BENCHAPP_HEADER.map(() => '');
  const rows = [['Schedule Template', ...blank.slice(1)], blank, BENCHAPP_HEADER];
  const duration = `${Math.floor(config.gameMinutes / 60)}:${pad(config.gameMinutes % 60)}`;
  for (const g of games) {
    const t = parseTime(g.time);
    if (!g.date || !t) continue; // BenchApp needs a date and a time
    rows.push([
      'GAME', g.playoff ? 'PLAYOFF' : 'REGULAR', '', teamName(g.away), teamName(g.home),
      `${pad(g.date.getUTCDate())}/${pad(g.date.getUTCMonth() + 1)}/${g.date.getUTCFullYear()}`,
      `${t.h % 12 || 12}:${pad(t.m)} ${t.h < 12 ? 'AM' : 'PM'}`,
      duration, locationOf(g), arenaOf(g).address,
      [`Game ${g.num}`, rinkOf(g), g.comment].filter(Boolean).join(' - '),
    ]);
  }
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

module.exports = { ics, benchAppCsv, startOf, parseTime };
