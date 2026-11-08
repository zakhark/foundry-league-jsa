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

  // Filters: team select, name search, upcoming-only checkbox.
  const team = document.querySelector('[data-filter="team"]');
  const name = document.querySelector('[data-filter="name"]');
  const upcoming = document.querySelector('[data-filter="upcoming"]');
  if (!team && !name && !upcoming) return;

  const params = new URLSearchParams(location.search);
  if (team && params.get('team')) team.value = params.get('team');

  const apply = () => {
    const t = team ? team.value : '';
    const q = name ? name.value.trim().toLowerCase() : '';
    const u = upcoming ? upcoming.checked : false;
    document.querySelectorAll('tbody tr, .video-card').forEach((tr) => {
      if (tr.dataset.teams === undefined && tr.dataset.name === undefined) return;
      const show =
        (!t || (tr.dataset.teams || '').split(' ').includes(t)) &&
        (!q || (tr.dataset.name || '').includes(q)) &&
        (!u || tr.classList.contains('upcoming'));
      tr.hidden = !show;
    });
    // Hide schedule weeks with no visible games.
    document.querySelectorAll('[data-week]').forEach((sec) => {
      sec.hidden = !sec.querySelector('tbody tr:not([hidden])');
    });
    if (team) {
      const url = new URL(location.href);
      if (t) url.searchParams.set('team', t);
      else url.searchParams.delete('team');
      history.replaceState(null, '', url);
    }
  };
  [team, name, upcoming].forEach((el) => el && el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', apply));
  apply();
})();
