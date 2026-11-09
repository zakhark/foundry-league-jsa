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
    const play = (videoId) => {
      if (!id.test(videoId)) return;
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
      iframe.title = 'Game video';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin'; // YouTube refuses embeds without a referrer
      frame.replaceChildren(iframe);
    };
    box.addEventListener('click', (e) => {
      const facade = e.target.closest('.facade');
      const angle = e.target.closest('.angle');
      if (facade) {
        e.preventDefault();
        play(facade.dataset.id);
      } else if (angle) {
        e.preventDefault();
        box.querySelectorAll('.angle').forEach((a) => a.setAttribute('aria-pressed', String(a === angle)));
        if (open) open.href = angle.href;
        const f = frame.querySelector('.facade');
        if (f) { // not playing yet: just show the other camera's thumbnail
          f.dataset.id = angle.dataset.id;
          f.href = angle.href;
          f.querySelector('img').src = `https://i.ytimg.com/vi/${angle.dataset.id}/hqdefault.jpg`;
        } else play(angle.dataset.id);
      }
    });
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

  // Filters: team select, name search, and "Show" (all games / results / upcoming).
  // The team and show choices are kept in the URL (?team=reapers&show=results),
  // so filtered views can be linked to.
  const team = document.querySelector('[data-filter="team"]');
  const name = document.querySelector('[data-filter="name"]');
  const which = document.querySelector('[data-filter="show"]');
  if (!team && !name && !which) return;

  const params = new URLSearchParams(location.search);
  if (team && params.get('team')) team.value = params.get('team');
  if (which && ['results', 'upcoming'].includes(params.get('show'))) which.value = params.get('show');

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
    // Hide schedule weeks with no visible games.
    document.querySelectorAll('[data-week]').forEach((sec) => {
      sec.hidden = !sec.querySelector('tbody tr:not([hidden])');
    });
    if (team || which) {
      const url = new URL(location.href);
      for (const [key, value] of [['team', t], ['show', w]]) {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      history.replaceState(null, '', url);
    }
  };
  [team, name, which].forEach((el) => el && el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', apply));
  apply();
})();
