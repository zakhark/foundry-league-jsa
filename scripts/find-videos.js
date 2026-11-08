// Finds game videos on the team YouTube channels listed in team-links.json and
// records them in seasons/<season>/game-videos.json, matched to games by date and opponent.
//
//   npm run videos
//
// Video titles must contain the opponent and the game date, e.g.
// "Clockwork Orange vs Reapers 10/30/26", "Reapers vs Whalers October 19 2026"
// or "2026.11.06 Sk8balls vs Mid Ice Crisis".
//
// Existing entries in game-videos.json are kept (so you can add or fix links
// by hand); new matches are added. YouTube page layouts change from time to
// time, so if this stops finding videos, add links to game-videos.json manually.
const fs = require('fs');
const config = require('./config');
const path = require('path');
const { load, seasonDir } = require('./data');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const ymd = (y, m, d) => {
  y = Number(y);
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// Pulls a date out of a video title, or null.
function titleDate(t) {
  let m = /\b(20\d\d)[.\-/](\d{1,2})[.\-/](\d{1,2})\b/.exec(t);
  if (m) return ymd(m[1], +m[2], +m[3]);
  m = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})\b/.exec(t);
  if (m) return ymd(m[3], +m[1], +m[2]);
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b/i.exec(t);
  if (m) return ymd(m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return null;
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
// True if the title mentions the team, e.g. "Unducks" for "UnDucks", "Kodiak" for "Kodiaks".
function mentions(title, team) {
  const t = squash(title);
  if (t.includes(squash(team))) return true;
  return team
    .split(/\s+/)
    .map((w) => squash(w).replace(/s$/, ''))
    .filter((w) => w.length >= 4)
    .some((w) => t.includes(w));
}

async function channelVideos(url) {
  const videos = new Map();
  for (const tab of ['streams', 'videos']) {
    const res = await fetch(`${url.replace(/\/+$/, '')}/${tab}`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
        cookie: 'CONSENT=YES+1',
      },
    });
    if (!res.ok) { console.warn(`  ${tab}: HTTP ${res.status}`); continue; }
    const html = await res.text();
    const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
    if (!m) { console.warn(`  ${tab}: could not read the page (YouTube layout changed?)`); continue; }
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      const v = o.lockupViewModel;
      if (v && v.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
        const title = v.metadata && v.metadata.lockupMetadataViewModel && v.metadata.lockupMetadataViewModel.title.content;
        if (title) videos.set(v.contentId, title);
        return;
      }
      if (o.videoRenderer) { // older layout
        const r = o.videoRenderer;
        const title = r.title && ((r.title.runs || []).map((x) => x.text).join('') || r.title.simpleText);
        if (title) videos.set(r.videoId, title);
        return;
      }
      for (const k in o) walk(o[k]);
    })(JSON.parse(m[1]));
  }
  return videos;
}

async function main() {
  const D = load(config.dataFile);
  // Game numbers restart every season, so videos are stored per season.
  const VIDEOS_FILE = path.join(seasonDir(D.season), 'game-videos.json');
  fs.mkdirSync(path.dirname(VIDEOS_FILE), { recursive: true });
  const saved = fs.existsSync(VIDEOS_FILE) ? JSON.parse(fs.readFileSync(VIDEOS_FILE, 'utf8')) : {};
  const result = { _comment: saved._comment || 'Game videos by game number. Each entry: { "team": <whose channel>, "url": <video link>, "title": <video title> }. Edit freely; "npm run videos" only adds new matches.' };
  for (const [k, v] of Object.entries(saved)) if (!k.startsWith('_')) result[k] = v;

  let added = 0;
  for (const [team, links] of D.teamLinks) {
    if (!links.youtube) continue;
    console.log(`${team}: ${links.youtube}`);
    let videos;
    try {
      videos = await channelVideos(links.youtube);
    } catch (e) {
      console.warn(`  failed: ${e.message}`);
      continue;
    }
    console.log(`  ${videos.size} videos`);
    for (const [id, title] of videos) {
      const date = titleDate(title);
      if (!date) continue;
      const game = D.games.find(
        (g) => g.played && g.date && g.date.toISOString().slice(0, 10) === date && (g.home === team || g.away === team)
      );
      if (!game) continue; // not a game from this season
      const opp = game.home === team ? game.away : game.home;
      if (!mentions(title, opp)) {
        console.warn(`  skipped "${title}": game #${game.num} on that date is against ${opp}`);
        continue;
      }
      const list = (result[game.num] = result[game.num] || []);
      const url = `https://www.youtube.com/watch?v=${id}`;
      if (list.some((v) => v.url === url || v.team === team)) continue;
      list.push({ team, url, title });
      added++;
      console.log(`  + game #${game.num}: ${title}`);
    }
  }

  const ordered = { _comment: result._comment };
  for (const k of Object.keys(result).filter((k) => !k.startsWith('_')).sort((a, b) => a - b)) ordered[k] = result[k];
  fs.writeFileSync(VIDEOS_FILE, `${JSON.stringify(ordered, null, 2)}\n`);
  console.log(`\n${added} new video link(s); ${Object.keys(ordered).length - 1} games have videos. Saved ${VIDEOS_FILE}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
