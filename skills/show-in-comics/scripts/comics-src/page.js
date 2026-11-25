(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const views = new Map($$('svg.view').map(v => [v.dataset.path, v]));
  const canvas = $('#canvas'), panel = $('#panel'), trail = $('#trail');
  const bar = { minus: $('#zoom-out'), pct: $('#zoom-pct'), plus: $('#zoom-in'), fit: $('#fit') };
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  // view path → { z, left, top }: the zoom the view's SVG is drawn at and the
  // canvas scroll, saved when the view is left. z is the shown view's zoom.
  const places = new Map();
  const STEP = 1.25, MAX = 3;
  let view = null, path = '', tab = 'view', z = 1;
  // What the view has selected: nothing, a node (a card or the boundary's
  // owner), or an edge, whose outside end then shows as a chip.
  let sel = { kind: 'none' };

  const href = (p, s) => '#/' + p + (s ? '?sel=' + s : '');
  const go = h => { if (location.hash !== h) location.hash = h; };
  const segs = p => p ? p.split('/') : [];

  // Up a level, with the card of the view just left selected.
  function up() {
    const s = segs(path), last = s.pop();
    go(href(s.join('/'), last));
  }

  function parse() {
    let h = location.hash.slice(1);
    try { h = decodeURIComponent(h); } catch { h = ''; }
    const [p, q = ''] = h.split('?');
    return { p: p.replace(/^\/+|\/+$/g, ''), key: q.startsWith('sel=') ? q.slice(4) : '' };
  }

  function fill(el, id) {
    el.replaceChildren($('#' + id).content.cloneNode(true));
  }

  // A panel's change list holds only ids; each line is copied from the
  // Changes tab without its "cited by" links.
  const lines = new Map($$('.chg > li').map(li => [li.dataset.id, li]));
  function fillChanges(el) {
    $$('ul.changes', el).forEach(ul => ul.replaceChildren(...ul.dataset.ids.split(' ').map(id => {
      const li = document.createElement('li');
      li.append(...[...lines.get(id).childNodes].filter(n => !n.matches?.('.cites')).map(n => n.cloneNode(true)));
      return li;
    })));
  }

  // Each ancestor in the trail selects the card that leads back here.
  function renderCrumbs() {
    const s = segs(path);
    trail.replaceChildren();
    for (let i = 0; i <= s.length; i++) {
      const p = s.slice(0, i).join('/');
      if (i) trail.append(Object.assign(document.createElement('span'), { className: 'sep', textContent: '›' }));
      const el = document.createElement(i === s.length ? 'span' : 'a');
      el.textContent = views.get(p).dataset.title;
      if (i < s.length) el.href = href(p, s[i]);
      trail.append(el);
    }
  }

  // The zoom that shows the whole view, at most 100%. A canvas capped by
  // max-height grows with its view, so there only the width has to fit.
  function fitZoom() {
    const w = +view.getAttribute('width'), h = +view.getAttribute('height');
    const room = getComputedStyle(canvas).maxHeight === 'none' ? canvas.clientHeight : Infinity;
    return Math.min(1, canvas.clientWidth / w, room / h);
  }
  const lowest = () => Math.min(fitZoom(), 0.25);

  // The one writer of zoom and scroll. The SVG is resized, not transformed,
  // so its text stays crisp.
  function apply(p) {
    z = p.z;
    view.style.width = +view.getAttribute('width') * z + 'px';
    view.style.height = +view.getAttribute('height') * z + 'px';
    canvas.scrollTo(p.left, p.top);
    controls();
  }

  function controls() {
    bar.pct.textContent = Math.round(z * 100) + '%';
    bar.minus.disabled = z <= lowest() + 1e-4;
    bar.plus.disabled = z >= MAX - 1e-4;
    bar.fit.title = `Fit to screen (${Math.round(fitZoom() * 100)}%)`;
  }

  // Zooms around a point on screen, the canvas centre by default, keeping
  // the point under it in place.
  function zoomAt(next, x, y) {
    next = Math.round(Math.min(MAX, Math.max(lowest(), next)) * 1e4) / 1e4;
    const c = canvas.getBoundingClientRect(), r = view.getBoundingClientRect();
    x ??= c.left + canvas.clientLeft + canvas.clientWidth / 2;
    y ??= c.top + canvas.clientTop + canvas.clientHeight / 2;
    const ux = (x - r.left) / z, uy = (y - r.top) / z;
    apply({ z: next, left: canvas.scrollLeft, top: canvas.scrollTop });
    const n = view.getBoundingClientRect();
    canvas.scrollBy(n.left + ux * next - x, n.top + uy * next - y);
  }

  // One step is ×1.25 and stops at 100% on the way past it.
  function step(dir) {
    const next = z * STEP ** dir;
    zoomAt((z - 1) * (next - 1) < 0 ? 1 : next);
  }

  function reveal(el) {
    const c = canvas.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.left < c.left || r.right > c.right) canvas.scrollLeft += r.left + r.width / 2 - c.left - c.width / 2;
    if (r.top < c.top || r.bottom > c.bottom) canvas.scrollTop += r.top + r.height / 2 - c.top - c.height / 2;
  }

  function showTab(t) {
    tab = t;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    $$('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + t));
  }

  function enter(p) {
    if (view) {
      places.set(path, { z, left: canvas.scrollLeft, top: canvas.scrollTop });
      view.classList.remove('on');
    }
    view = views.get(p);
    path = p;
    view.classList.add('on');
    canvas.classList.toggle('deep', p !== '');
    renderCrumbs();
    fill($('#tab-view'), view.dataset.t);
    // A view not seen yet opens fitted when that keeps it at 70% or more.
    const f = fitZoom();
    apply(places.get(p) ?? { z: f >= 0.7 ? f : 1, left: 0, top: 0 });
  }

  function selection(key) {
    const els = key ? $$('[data-sel]', view).filter(e => e.dataset.sel === key) : [];
    if (!els.length) return { kind: 'none' };
    return { kind: key.includes('>') ? 'edge' : 'node', key, els };
  }

  function select(next) {
    $$('.sel, .hl', canvas).forEach(e => e.classList.remove('sel', 'hl'));
    sel = next;
    panel.classList.toggle('selected', sel.kind !== 'none');
    if (sel.kind === 'none') return;
    sel.els.forEach(e => e.classList.add('sel')); // an edge's line, pill and chip
    if (sel.kind === 'node') {
      $$('.edge, .pill', view).filter(e => e.dataset.ends.split(' ').includes(sel.key)).forEach(e => e.classList.add('hl'));
    }
    $('#close').href = href(path);
    fill($('#body'), sel.els[0].dataset.t);
    fillChanges($('#body'));
    panel.scrollTop = 0;
    reveal(sel.els[sel.els.length - 1]);
  }

  // Where a zoom between two views starts or ends in view svg at path p: the
  // card that holds the deeper view, or the boundary of p's own view.
  function anchor(svg, p, other) {
    const a = segs(p), b = segs(other);
    const within = (x, y) => x.length < y.length && x.every((s, i) => s === y[i]);
    let el = null;
    if (within(a, b)) el = $(`.node[data-sel="${b[a.length]}"] .card:not(.back)`, svg);
    else if (within(b, a)) el = $('.bd', svg);
    if (!el) return null;
    const r = el.getBoundingClientRect(), c = canvas.getBoundingClientRect();
    const x0 = Math.max(r.left, c.left), y0 = Math.max(r.top, c.top);
    const x1 = Math.min(r.right, c.right), y1 = Math.min(r.bottom, c.bottom);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // Going down, the card grows into the boundary while the view fades in;
  // going up, the boundary shrinks back into the card.
  function zoom(from, to, down) {
    if (still.matches || !from || !to) return;
    const box = document.createElement('div');
    box.className = 'zoom';
    document.body.append(box);
    const card = getComputedStyle(document.documentElement).getPropertyValue('--card').trim();
    const at = (r, solid) => ({ left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', backgroundColor: solid ? card : 'transparent' });
    const opts = { duration: 250, easing: 'cubic-bezier(.2, .7, .3, 1)' };
    box.animate([at(from, down), at(to, !down)], opts).finished.then(() => box.remove());
    view.animate([{ opacity: 0 }, { opacity: 1 }], opts);
  }

  function show() {
    let { p, key } = parse();
    if (!views.has(p)) {
      p = '';
      key = '';
      if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
    }
    if (views.get(p) === view) {
      select(selection(key));
      return;
    }
    const was = path, from = view && anchor(view, path, p);
    enter(p);
    select(selection(key));
    if (from) zoom(from, anchor(view, p, was), segs(p).length > segs(was).length);
  }

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    showTab(b.dataset.tab);
    go(href(path));
  });

  const zoomKeys = { '+': () => step(1), '=': () => step(1), '-': () => step(-1), '0': () => zoomAt(1) };
  addEventListener('keydown', e => {
    if (e.target.matches?.('input, textarea')) return;
    if (e.key === 'Escape') {
      if (sel.kind !== 'none') go(href(path));
      else if (path) up();
    } else if ((e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) && path) {
      e.preventDefault();
      up();
    } else if (zoomKeys[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      zoomKeys[e.key]();
    }
  });

  $('#filter').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $$('.chg > li').forEach(li => { li.hidden = q !== '' && !li.textContent.toLowerCase().includes(q); });
  });

  // Drag the canvas to pan; a drag never counts as a click.
  let drag = null;
  const onScrollbar = e => {
    const r = canvas.getBoundingClientRect();
    return e.clientX >= r.left + canvas.clientLeft + canvas.clientWidth || e.clientY >= r.top + canvas.clientTop + canvas.clientHeight;
  };
  canvas.addEventListener('dragstart', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || onScrollbar(e)) return;
    drag = { x: e.clientX, y: e.clientY, l: canvas.scrollLeft, t: canvas.scrollTop, moved: false };
  });
  addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      canvas.classList.add('dragging');
    }
    if (drag.moved) {
      canvas.scrollLeft = drag.l - dx;
      canvas.scrollTop = drag.t - dy;
    }
  });
  addEventListener('pointerup', () => {
    canvas.classList.remove('dragging');
    setTimeout(() => { drag = null; });
  });
  // An empty click inside the boundary clears the selection; outside it, it
  // goes up a level like Backspace.
  canvas.addEventListener('click', e => {
    if (drag?.moved) {
      e.preventDefault();
      e.stopPropagation();
    } else if (!e.target.closest('a') && !onScrollbar(e)) {
      if (path && !e.target.closest('.boundary')) up();
      else go(href(path));
    }
  }, true);

  // Ctrl or Cmd with the wheel zooms around the pointer, and so does a
  // trackpad pinch, which arrives as a wheel with ctrlKey. A wheel notch is
  // one step; a plain wheel scrolls.
  canvas.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const dy = e.deltaY * [1, 33, 800][e.deltaMode], notch = Math.log(STEP) * 100;
    zoomAt(z * Math.exp(-Math.max(-notch, Math.min(notch, dy)) / 100), e.clientX, e.clientY);
  }, { passive: false });

  bar.minus.addEventListener('click', () => step(-1));
  bar.plus.addEventListener('click', () => step(1));
  bar.pct.addEventListener('click', () => zoomAt(1));
  bar.fit.addEventListener('click', () => apply({ z: fitZoom(), left: 0, top: 0 }));
  addEventListener('resize', controls);
  addEventListener('hashchange', show);
  showTab(tab);
  show();
})();
