// Progressive enhancements: mobile menu, sortable tables, filters.
(function () {
  // Mobile menu
  const btn = document.querySelector('.menu');
  const nav = document.getElementById('nav');
  if (btn && nav) {
    btn.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
  }

  // Keep --header-h equal to the sticky header's real height (it changes with
  // the phone menu and font size), so tabs and toolbars stick just below it.
  const header = document.querySelector('header.site');
  if (header && 'ResizeObserver' in window) {
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
    }).observe(header);
  }

  // Sortable tables: click a heading to sort; click again to reverse.
  document.querySelectorAll('table.sortable').forEach((table) => {
    const heads = table.querySelectorAll('th');
    heads.forEach((th, col) => {
      if (!th.dataset.sort) return;
      th.tabIndex = 0;
      const run = () => {
        const numeric = th.dataset.sort === 'num';
        // Numbers default to high-to-low, text to A-Z.
        const desc = th.getAttribute('aria-sort') ? th.getAttribute('aria-sort') === 'ascending' : numeric;
        heads.forEach((h) => h.removeAttribute('aria-sort'));
        th.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
        const body = table.tBodies[0];
        const val = (tr) => {
          const cell = tr.children[col];
          const v = cell.dataset.v !== undefined ? cell.dataset.v : cell.textContent.trim();
          if (!numeric) return v.toLowerCase();
          const n = parseFloat(v.replace(/[^\d.+-]/g, ''));
          return Number.isFinite(n) ? n : -Infinity;
        };
        const rows = Array.from(body.rows);
        rows.sort((a, b) => {
          const x = val(a), y = val(b);
          const c = x < y ? -1 : x > y ? 1 : 0;
          return desc ? -c : c;
        });
        rows.forEach((r) => body.appendChild(r));
      };
      th.addEventListener('click', run);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); } });
    });
  });

  // Game video: clicking the thumbnail swaps in the YouTube player; camera
  // buttons switch between the teams' videos of the same game.
  document.querySelectorAll('[data-player]').forEach((box) => {
    const frame = box.querySelector('.frame');
    const open = box.querySelector('[data-open]');
    const id = /^[\w-]{11}$/;
    const play = (videoId, start) => {
      if (!id.test(videoId)) return;
      const playing = frame.querySelector('iframe');
      if (start !== undefined && playing && playing.dataset.id === videoId) {
        // Same video already playing: seek instead of reloading the player.
        playing.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [start, true] }), '*');
        playing.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
        return;
      }
      const iframe = document.createElement('iframe');
      iframe.dataset.id = videoId;
      iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&enablejsapi=1${start ? `&start=${start}` : ''}`;
      iframe.title = 'Game video';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin'; // YouTube refuses embeds without a referrer
      frame.replaceChildren(iframe);
    };
    // Marks a camera as the current one (its button, its moments, "Open on YouTube").
    const setCamera = (videoId) => {
      const angle = [...box.querySelectorAll('.angle')].find((a) => a.dataset.id === videoId);
      if (!angle) return;
      box.querySelectorAll('.angle').forEach((a) => a.setAttribute('aria-pressed', String(a === angle)));
      box.querySelectorAll('.moments').forEach((l) => { l.hidden = l.dataset.for !== videoId; });
      if (open) open.href = angle.href;
    };
    box.play = play; // used by the goal map below
    box.setCamera = setCamera;
    box.addEventListener('click', (e) => {
      const facade = e.target.closest('.facade');
      const angle = e.target.closest('.angle');
      const moment = e.target.closest('.moments a');
      if (facade) {
        e.preventDefault();
        play(facade.dataset.id);
      } else if (moment) {
        e.preventDefault();
        play(moment.dataset.id, Number(moment.dataset.t));
        frame.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (angle) {
        e.preventDefault();
        setCamera(angle.dataset.id);
        const f = frame.querySelector('.facade');
        if (f) { // not playing yet: just show the other camera's thumbnail
          f.dataset.id = angle.dataset.id;
          f.href = angle.href;
          f.querySelector('img').src = `https://i.ytimg.com/vi/${angle.dataset.id}/hqdefault.jpg`;
        } else play(angle.dataset.id);
      }
    });
  });

  // Goal map (game pages): filters (team, period), toggles (heatmap, pass
  // lines, jersey numbers), a dot or row tap highlights both, and ▶ jumps the
  // video player above to that goal.
  document.querySelectorAll('[data-goalmap]').forEach((map) => {
    const player = document.querySelector('[data-player]');
    const canvas = map.querySelector('.gm-heat');
    const controls = map.querySelector('.gm-controls');
    if (controls) controls.hidden = false;
    const filter = { team: 'all', period: 'all' };
    const items = (i) => map.querySelectorAll(`.gm-goal[data-i="${i}"], .gm-list li[data-i="${i}"]`);
    const highlight = (i) => {
      const wasOn = items(i)[0] && items(i)[0].classList.contains('on');
      map.querySelectorAll('.on').forEach((el) => el.classList.remove('on'));
      if (!wasOn) items(i).forEach((el) => el.classList.add('on'));
    };
    // Heatmap: a Gaussian blob per visible goal, summed and coloured
    // transparent → blue → cyan → yellow → orange → red. Rink feet → canvas pixels.
    const STOPS = [[0.04, 37, 99, 235, 0], [0.25, 37, 99, 235, 115], [0.45, 6, 182, 212, 165], [0.65, 250, 204, 21, 195], [0.85, 249, 115, 22, 220], [1, 220, 38, 38, 240]];
    const colour = (t) => {
      if (t <= STOPS[0][0]) return [0, 0, 0, 0];
      for (let i = 1; i < STOPS.length; i++) {
        if (t <= STOPS[i][0]) {
          const a = STOPS[i - 1], b = STOPS[i], f = (t - a[0]) / (b[0] - a[0]);
          return [1, 2, 3, 4].map((k) => Math.round(a[k] + f * (b[k] - a[k])));
        }
      }
      return STOPS[STOPS.length - 1].slice(1);
    };
    const drawHeat = () => {
      if (!canvas || !canvas.getContext) return;
      const W = canvas.width, H = canvas.height, scale = W / 200, sigma = 11 * scale, two = 2 * sigma * sigma, rad = Math.ceil(sigma * 2.8);
      const density = new Float32Array(W * H);
      map.querySelectorAll('.gm-goal:not([hidden])').forEach((g) => {
        const gx = (Number(g.dataset.x) + 100) * scale, gy = (Number(g.dataset.y) + 42.5) * scale;
        for (let y = Math.max(0, Math.floor(gy - rad)); y <= Math.min(H - 1, Math.ceil(gy + rad)); y++) {
          for (let x = Math.max(0, Math.floor(gx - rad)); x <= Math.min(W - 1, Math.ceil(gx + rad)); x++) {
            density[y * W + x] += Math.exp(-((x - gx) ** 2 + (y - gy) ** 2) / two);
          }
        }
      });
      const max = density.reduce((m, v) => (v > m ? v : m), 0);
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(W, H);
      if (max > 0) density.forEach((v, i) => img.data.set(colour(v / max), i * 4));
      ctx.putImageData(img, 0, 0);
    };
    const apply = () => {
      // An attribute, not el.hidden: the dots are SVG elements, which have no .hidden property.
      map.querySelectorAll('.gm-goal, .gm-list li').forEach((el) => el.toggleAttribute('hidden',
        (filter.team !== 'all' && el.dataset.team !== filter.team) || (filter.period !== 'all' && el.dataset.period !== filter.period)));
      drawHeat();
    };
    map.addEventListener('click', (e) => {
      const seek = e.target.closest('a[data-seek]');
      const button = e.target.closest('.gm-seg button');
      const item = e.target.closest('.gm-goal, .gm-list li');
      if (seek && player && player.play) {
        e.preventDefault();
        player.setCamera(seek.dataset.id);
        player.play(seek.dataset.id, Number(seek.dataset.t));
        player.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (button) {
        const key = 'teamFilter' in button.dataset ? 'teamFilter' : 'period';
        filter[key === 'teamFilter' ? 'team' : 'period'] = button.dataset[key];
        button.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
        apply();
      } else if (item && !e.target.closest('a')) highlight(item.dataset.i);
    });
    map.addEventListener('change', (e) => {
      const t = e.target.dataset && e.target.dataset.toggle;
      if (t) map.classList.toggle(`no-${t}`, !e.target.checked);
    });
    map.addEventListener('keydown', (e) => {
      const dot = e.target.closest('.gm-goal');
      if (dot && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); highlight(dot.dataset.i); }
    });
    apply();
  });

  // Rows that open a page when clicked anywhere (schedule rows open the game).
  // Clicks on links inside the row, or while selecting text, are left alone.
  document.querySelectorAll('tr[data-href]').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('a, button, input, select') || String(window.getSelection())) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey) window.open(tr.dataset.href, '_blank');
      else location.href = tr.dataset.href;
    });
  });

  // Calendar links: "Copy link" copies the full https address; on Apple
  // devices "Subscribe" uses webcal:// so Calendar subscribes instead of
  // importing a one-time copy.
  if (/iPhone|iPad|Macintosh/.test(navigator.userAgent)) {
    document.querySelectorAll('[data-subscribe]').forEach((a) => { a.href = a.href.replace(/^https?:/, 'webcal:'); });
  }
  document.querySelectorAll('[data-copy]').forEach((copy) => {
    copy.addEventListener('click', async () => {
      const url = new URL(copy.dataset.copy, location.href).href;
      try {
        await navigator.clipboard.writeText(url);
        const label = copy.textContent;
        copy.textContent = 'Copied!';
        setTimeout(() => { copy.textContent = label; }, 1500);
      } catch {
        window.prompt('Copy this calendar link:', url);
      }
    });
  });

  // Filters: team select, name search, "Show" (all games / results / upcoming)
  // and "Stats" (players' team / sub / total numbers).
  // The team, show and stats choices are kept in the URL (?team=reapers&show=results),
  // so filtered views can be linked to.
  const team = document.querySelector('[data-filter="team"]');
  const name = document.querySelector('[data-filter="name"]');
  const which = document.querySelector('[data-filter="show"]');
  const view = document.querySelector('[data-filter="view"]');
  if (!team && !name && !which && !view) return;

  const params = new URLSearchParams(location.search);
  if (team && params.get('team')) team.value = params.get('team');
  if (which && ['results', 'upcoming'].includes(params.get('show'))) which.value = params.get('show');
  if (view && ['team', 'sub', 'total'].includes(params.get('stats'))) view.value = params.get('stats');
  if (view) document.querySelectorAll('.view-title').forEach((h) => { h.hidden = true; });

  const apply = () => {
    const t = team ? team.value : '';
    const q = name ? name.value.trim().toLowerCase() : '';
    const w = which ? which.value : '';
    document.querySelectorAll('tbody tr, .video-card').forEach((tr) => {
      if (tr.dataset.teams === undefined && tr.dataset.name === undefined) return;
      const show =
        (!t || (tr.dataset.teams || '').split(' ').includes(t)) &&
        (!q || (tr.dataset.name || '').includes(q)) &&
        (!w || (w === 'upcoming') === tr.classList.contains('upcoming'));
      tr.hidden = !show;
    });
    // Stats views: [data-view] lists the views an element belongs to (tables, tiles, game-log rows).
    if (view) document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = !el.dataset.view.split(' ').includes(view.value); });
    // Hide schedule weeks with no visible games.
    document.querySelectorAll('[data-week]').forEach((sec) => {
      sec.hidden = !sec.querySelector('tbody tr:not([hidden])');
    });
    if (team || which || view) {
      const url = new URL(location.href);
      for (const [key, value] of [['team', t], ['show', w], ['stats', view && view.value !== 'team' ? view.value : '']]) {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      history.replaceState(null, '', url);
    }
  };
  [team, name, which, view].forEach((el) => el && el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', apply));
  apply();
})();
