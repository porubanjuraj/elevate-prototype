/* Elevate Energy – desktop prototype
 * Page = Figma "Homepage" (1280 px design width, scaled with CSS zoom).
 * Scroll drives two fixed canvases (design frame 1280x832, rendered 1920x1248):
 *   cv1 (below content, opaque frames): scene 1  hero 4 cells -> 1 cell -> blueprint        scroll 0 .. 832 (design px)
 *   cv2 (above content, transparent):  scene 2  P cell->rack, Q rack->stack, R stack->drone  pinned P0 .. R1, then scrolls away with the page
 */
(() => {
  'use strict';
  const FW = 1280, FH = 832;
  /* ------------ tunables (design px) ------------ */
  const P_LEN = 1500;            // scroll distance while the product viewport (2 slides) is pinned
  const P_PRE = 182;             // scroll distance before the pin for the scan-in of the cell (P frames 1..26)
  const P_HOLD0 = 0.2, P_HOLD1 = 0.8;  // share of the pin: cell holds (slide 1) until 20%, turns into the rack 20..80%, rack holds (slide 2)
  const B_LEN = 1800;            // scroll distance while the Benefits box is pinned (3 text slides, stack turns once)
  const BOX_H = 545, BOX_C = 272.5;  // benefits box height / half
  const R_LEN = 940;             // scroll distance while the Applications heading + drone box are pinned (drone assembly, original pace ~5 px/frame)
  const R_A   = 150;             // R ends when viewport top = applications.top + R_A
  const DX = { q: 0, r: 0 };     // horizontal canvas shift (design px) reached at end of Q / kept until R end (alignment with Figma boxes)
  const DY = { q: 0, r: 0 };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const params = new URLSearchParams(location.search);

  const apin = $('#apin'), bpin = $('#bpin'), bslides = $$('.bslide');
  const page = $('#page'), pin1 = $('#pin1'), cv1 = $('#cv1'), cv2 = $('#cv2');
  const c1 = cv1.getContext('2d'), c2 = cv2.getContext('2d');
  let lenis = null, dirty = false;
  let S = 1, A = {};                                 // zoom factor, anchors

  /* ------------ frame sequences ------------ */
  class Seq {
    constructor(name, n, ext) { this.name = name; this.n = n; this.ext = ext; this.img = new Array(n + 1); this.state = new Uint8Array(n + 1); this.loaded = 0; }
    url(i) { return `frames/${this.name}/${this.name}_${String(i).padStart(4, '0')}.${this.ext}`; }
    load(i) {
      if (this.state[i]) return Promise.resolve();
      this.state[i] = 1;
      return new Promise(res => {
        const im = new Image();
        im.onload = () => { this.img[i] = im; this.state[i] = 2; this.loaded++; dirty = true; res(); };
        im.onerror = () => { this.state[i] = 3; res(); };
        im.src = this.url(i);
      });
    }
    nearest(i) {                                      // best available frame around i
      if (this.state[i] === 2) return i;
      for (let d = 1; d < this.n; d++) {
        if (i - d >= 1 && this.state[i - d] === 2) return i - d;
        if (i + d <= this.n && this.state[i + d] === 2) return i + d;
      }
      return 0;
    }
  }
  const SEQ = { s1: new Seq('s1', 240, 'jpg'), p: new Seq('p', 150, 'webp'), q: new Seq('q', 170, 'webp'), b: new Seq('b', 180, 'webp'), r: new Seq('r', 188, 'webp') };
  const queue = [];
  for (const k of ['s1', 'p', 'q', 'b', 'r']) for (let i = 1; i <= SEQ[k].n; i++) queue.push([k, i]);
  let loadedTotal = 0; const TOTAL = queue.length;
  async function pump(first) {
    let idx = 0;
    const worker = async () => {
      while (idx < queue.length) { const [k, i] = queue[idx++]; await SEQ[k].load(i); loadedTotal++; progress(); }
    };
    await Promise.all(Array.from({ length: first }, worker));
  }
  const loaderEl = $('#loader'), pct = $('#loadpct'), bar = $('#loader .bar i');
  let ready = false;
  function progress() {
    const need = 40;                                  // enough of scene 1 to start
    const p = Math.min(1, SEQ.s1.loaded / need);
    pct.textContent = Math.round(p * 100) + '%'; bar.style.width = p * 100 + '%';
    if (!ready && p >= 1) start();
  }
  function ensureAround(seq, i, w = 14) {            // prioritise frames around the current one
    for (let d = 0; d <= w; d++) { if (i + d <= seq.n) seq.load(i + d); if (i - d >= 1) seq.load(i - d); }
  }

  /* ------------ layout / anchors ------------ */
  const docTop = el => (el.getBoundingClientRect().top + scrollY) / S;
  function layout() {
    S = innerWidth / FW;
    page.style.zoom = S;
    const fh = innerHeight / S;                         // pinned product viewport = the window (content is bottom-anchored when shorter than the 832 design frame)
    page.style.setProperty('--fh', fh + 'px');
    pin1.style.height = (fh + P_LEN) + 'px';
    A.dataTop = docTop($('#data'));
    A.p0 = docTop(pin1);
    A.p1 = A.p0 + P_LEN;
    A.benefits = docTop($('#benefits'));
    A.apps = docTop($('#applications'));
    const vh0 = innerHeight / S;
    bpin.style.height = (BOX_H + B_LEN) + 'px';
    A.bpin = docTop(bpin);
    A.q1 = A.bpin + BOX_C - vh0 / 2;                 // Q ends / pin starts when the box centre reaches the viewport centre
    A.b1 = A.q1 + B_LEN;                             // pin ends
    page.style.setProperty('--rlen', R_LEN + 'px');
    A.apin = docTop(apin);
    A.rs = A.apin - ((vh0 - 723) / 2 - 306);          // pin starts when the drone box (723 tall) is centred in the window: drone assembly begins; until then only the cells stay
    A.r1 = A.rs + R_LEN;
    A.end1 = A.dataTop;                              // scene 1 reaches its last frame when the data section is at the top
    last.f1 = last.f2 = -1;
    update(scrollY);
  }

  /* ------------ drawing ------------ */
  const last = { f1: -1, f2: -1, k2: '' };
  function drawSeq(ctx, seq, i, w = 1920, h = 1248, clear = false) {
    const j = seq.nearest(i); if (!j) return;
    if (clear) ctx.clearRect(0, 0, w, h);
    ctx.drawImage(seq.img[j], 0, 0, w, h);
  }
  const slide1 = $('#slide1'), slide2 = $('#slide2'), reveals = $$('[data-reveal]'), specEls = $$('.specs .spec');
  /* split the headline text into words > characters (reveal order = reading order) */
  for (const r of reveals) {
    const h = $('.base', r), text = h.textContent.trim();
    h.textContent = ''; h.setAttribute('aria-label', text);
    r._chars = [];
    r._n = text.replace(/ /g, '').length;
    text.split(' ').forEach((word, wi, arr) => {
      const w = document.createElement('span'); w.className = 'w'; w.setAttribute('aria-hidden', 'true');
      for (const ch of word) { const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch; w.appendChild(s); r._chars.push({ el: s, r: 0, a: -1 }); }
      h.appendChild(w); if (wi < arr.length - 1) h.appendChild(document.createTextNode(' '));
    });
  }
  const hud = $('#hud');

  function update(y) {
    const D = y / S;
    const sh = Math.min(0, innerHeight / S - FH);
    const dyR = (innerHeight / S - 723) / 2 - 158 + 43;  // drone end pose: canvas rows 223..730 (centre 476.5) land on the centre of the centred box (box top + 361.5)
    const dyB = innerHeight / S / 2 - 542;               // while the box is pinned its centre sits at the viewport centre; the stack's centre is at canvas y = 542

    /* ---- scene 1 ---- */
    const u1 = clamp(D / A.end1);
    const f1 = 1 + Math.round(u1 * (SEQ.s1.n - 1));
    ensureAround(SEQ.s1, f1);
    const ty1 = -Math.max(0, D - A.end1);
    cv1.style.transform = `translate3d(0,${ty1 * S}px,0)`;
    cv1.style.visibility = D > A.end1 + FH ? 'hidden' : 'visible';
    if (f1 !== last.f1 || SEQ.s1.loaded !== last.l1) { drawSeq(c1, SEQ.s1, f1); last.f1 = f1; last.l1 = SEQ.s1.loaded; }

    /* ---- scene 2 ---- */
    let seq, fi, ty2, dx = 0, dy = 0;
    if (D <= A.p0) { seq = SEQ.p; fi = D <= A.p0 - P_PRE ? 1 : 1 + Math.round((D - (A.p0 - P_PRE)) / P_PRE * 25); ty2 = A.p0 - D + sh; }
    else if (D <= A.p1) { seq = SEQ.p; fi = 26 + Math.round(clamp(((D - A.p0) / P_LEN - P_HOLD0) / (P_HOLD1 - P_HOLD0)) * (SEQ.p.n - 26)); ty2 = sh; }
    else if (D <= A.q1) { const u = (D - A.p1) / (A.q1 - A.p1); seq = SEQ.q; fi = 1 + Math.round(u * (SEQ.q.n - 1)); ty2 = 0; dx = DX.q * smooth(0, 1, u); dy = lerp(sh, dyB, smooth(0, 1, u)); }
    else if (D <= A.b1) { seq = SEQ.b; fi = 1 + Math.round(clamp((D - A.q1) / B_LEN) * (SEQ.b.n - 1)); ty2 = 0; dy = dyB; }
    else if (D <= A.rs) { seq = SEQ.b; fi = SEQ.b.n; ty2 = 0; dy = dyB; }          // only the cells (final pose of the turn = start pose of R)
    else if (D <= A.r1) { const u = (D - A.rs) / (A.r1 - A.rs); seq = SEQ.r; fi = 1 + Math.round(u * (SEQ.r.n - 1)); ty2 = 0; dx = lerp(DX.q, DX.r, smooth(0, 1, u)); dy = lerp(dyB, dyR, smooth(0, 1, u)); }
    else { seq = SEQ.r; fi = SEQ.r.n; ty2 = -(D - A.r1); dx = DX.r; dy = dyR; }
    ensureAround(seq, fi);
    cv2.style.transform = `translate3d(${dx * S}px,${(ty2 + dy) * S}px,0)`;
    cv2.style.visibility = (ty2 > FH || ty2 < -FH) ? 'hidden' : 'visible';
    const key = seq.name + fi;
    if (key !== last.k2 || seq.loaded !== last.l2) { drawSeq(c2, seq, fi, 1920, 1248, true); last.k2 = key; last.l2 = seq.loaded; }

    /* ---- product copy fades while the cell turns into the rack ---- */
    const up = clamp((D - A.p0) / P_LEN);
    const o1 = 1 - smooth(P_HOLD0, P_HOLD0 + 0.15, up), o2 = smooth(P_HOLD1 - 0.15, P_HOLD1, up);
    slide1.style.opacity = o1; slide1.style.transform = `translateY(${(1 - o1) * -24}px)`; slide1.style.visibility = o1 < 0.01 ? 'hidden' : 'visible';
    slide2.style.opacity = o2; slide2.style.transform = `translateY(${(1 - o2) * 24}px)`; slide2.style.visibility = o2 < 0.01 ? 'hidden' : 'visible';

    /* ---- benefits: 3 text slides while the box is pinned ---- */
    const ub = (D - A.q1) / B_LEN;
    const bo = [1 - smooth(0.29, 0.37, ub), smooth(0.29, 0.37, ub) * (1 - smooth(0.62, 0.70, ub)), smooth(0.62, 0.70, ub)];
    bslides.forEach((el, i) => { el.style.opacity = bo[i]; el.style.visibility = bo[i] < 0.01 ? 'hidden' : 'visible'; el.style.transform = `translateY(${(i === 0 ? -(1 - bo[0]) : (1 - bo[i])) * 18}px)`; });

    /* ---- data numbers: appear only when the blueprint is in place (not over the transition) ---- */
    specEls.forEach((el, i) => {
      const t = smooth(A.end1 - 300 + i * 70, A.end1 - 190 + i * 70, D);
      el.style.opacity = t; el.style.transform = `translateY(${(1 - t) * 28}px)`;
    });

    /* ---- headlines: characters colour in from left to right with a soft leading edge, scrubbed by scroll (like trionn.com) ---- */
    const vh = innerHeight / S;
    for (const r of reveals) {
      const top = r.getBoundingClientRect().top / S;
      const p = clamp((vh * 0.78 - top) / (vh * 0.6));
      const F = 0.22, N = r._n;
      r._chars.forEach((c, i) => {
        const a = clamp((p * (1 + F) - i / (N - 1)) / F);
        if (a !== c.a) { c.a = a; c.el.style.opacity = (0.22 + 0.78 * a).toFixed(3); }
      });
    }

    if (params.has('debug')) { hud.hidden = false; hud.textContent = `D ${D.toFixed(0)}  s1 ${f1}  ${seq.name} ${fi}  p0 ${A.p0.toFixed(0)} p1 ${A.p1.toFixed(0)} q1 ${A.q1.toFixed(0)} b1 ${A.b1.toFixed(0)} rs ${A.rs.toFixed(0)} r1 ${A.r1.toFixed(0)}  loaded ${loadedTotal}/${TOTAL}`; }
  }

  /* ------------ fade-up for text blocks ------------ */
  const riseEls = $$('.benefit-header,.apps-top,.apps-copy,.company-top .btn,.facts,.card,.f-left,.f-right');
  riseEls.forEach(e => e.classList.add('rs'));
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.15 }) : null;
  riseEls.forEach(e => io ? io.observe(e) : e.classList.add('in'));

  /* ------------ in-page links ------------ */
  $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href'); if (id.length < 2) return;
    const t = document.querySelector(id); if (!t) return;
    e.preventDefault();
    let D = docTop(t);    const y = D * S;
    if (lenis) lenis.scrollTo(y, { duration: 1.6 }); else scrollTo({ top: y, behavior: 'smooth' });
  }));

  /* ------------ start ------------ */
  function start() {
    ready = true;
    loaderEl.classList.add('done');
    document.body.classList.add('ready');
    layout();
    if (params.has('y')) scrollTo(0, parseFloat(params.get('y')) * S);
    update(scrollY);
  }
  function loop(t) { if (lenis) lenis.raf(t); if (dirty && ready) { dirty = false; update(scrollY); } requestAnimationFrame(loop); }
  addEventListener('scroll', () => update(scrollY), { passive: true });
  addEventListener('resize', layout);
  if (window.Lenis && !params.has('native')) {
    lenis = new Lenis({ lerp: 0.12, wheelMultiplier: 1 });
    lenis.on('scroll', () => update(scrollY));
  }
  requestAnimationFrame(loop);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { layout(); });
  layout();
  pump(8);
  // safety: start even if frames are missing
  setTimeout(() => { if (!ready) start(); }, 15000);
  window.__elevate = { SEQ, A: () => A, layout, update, DX, DY };
})();
