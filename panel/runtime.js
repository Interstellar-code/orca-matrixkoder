// Panel runtime: renders the canvas screens (panel/screens/*.dc.html).
// WIRE.1 data layer: fetches /api/state every 5 s with session token,
// distributes data to active screens, keeps local UI state across refreshes,
// and displays a stale banner if the server is unreachable.
(function () {
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const ONE = /^\{\{\s*([^}]+?)\s*\}\}$/;
  const ANY = /\{\{\s*([^}]+?)\s*\}\}/g;
  const PROPS = { checked: 1, value: 1, selected: 1, disabled: 1 };

  function get(scope, path) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    let v = scope;
    for (const k of path.split('.')) {
      if (v == null) return undefined;
      v = v[k];
    }
    return v;
  }
  const single = (s) => { const m = ONE.exec(s || ''); return m ? m[1] : null; };
  const interp = (s, scope) => s.replace(ANY, (_, p) => { const v = get(scope, p); return v == null || v === false ? '' : String(v); });
  const propVal = (k, v) => (k === 'value' ? (v == null ? '' : String(v)) : !!v);

  // Builds real DOM from a template node and appends it to `out`.
  function build(node, scope, out) {
    if (node.nodeType === 3) { out.appendChild(document.createTextNode(interp(node.data, scope))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'sc-for') {
      const as = node.getAttribute('as');
      (get(scope, single(node.getAttribute('list'))) || []).forEach((item, i) => {
        const sc = Object.create(scope);
        sc[as] = item;
        sc[as + 'Index'] = i;
        for (const c of node.childNodes) build(c, sc, out);
      });
      return;
    }
    if (tag === 'sc-if') {
      if (get(scope, single(node.getAttribute('value')))) for (const c of node.childNodes) build(c, scope, out);
      return;
    }
    const el = node.namespaceURI === HTML_NS ? document.createElement(tag) : document.createElementNS(node.namespaceURI, tag);
    const type = node.getAttribute('type');
    for (const a of node.attributes) {
      const n = a.name, path = single(a.value);
      if (n.startsWith('hint-')) continue;
      if (/^on[a-z]+$/.test(n)) {
        const fn = path && get(scope, path);
        if (typeof fn !== 'function') continue;
        let ev = n.slice(2);
        if (ev === 'change' && tag === 'input' && type !== 'checkbox' && type !== 'radio') ev = 'input';
        (el.__h || (el.__h = {}))[ev] = fn;
        continue;
      }
      if (path && PROPS[n]) {
        const v = get(scope, path);
        (el.__p || (el.__p = {}))[n] = v;
        if (n === 'value') el.setAttribute('value', propVal(n, v));
        else if (v) el.setAttribute(n, '');
        continue;
      }
      el.setAttribute(n, interp(a.value, scope));
    }
    for (const c of node.childNodes) build(c, scope, el);
    if (el.__p) for (const k in el.__p) el[k] = propVal(k, el.__p[k]);
    out.appendChild(el);
  }

  // Patches the live children of `a` to match freshly built children of `b`.
  function morph(a, b) {
    const fresh = Array.from(b.childNodes);
    fresh.forEach((bn, i) => {
      const an = a.childNodes[i];
      if (!an) { a.appendChild(bn); return; }
      if (an.nodeType !== bn.nodeType || (an.nodeType === 1 && (an.namespaceURI !== bn.namespaceURI || an.localName !== bn.localName))) {
        a.replaceChild(bn, an);
        return;
      }
      if (an.nodeType !== 1) { if (an.data !== bn.data) an.data = bn.data; return; }
      for (const at of Array.from(an.attributes)) if (!bn.hasAttribute(at.name)) an.removeAttribute(at.name);
      for (const at of bn.attributes) if (an.getAttribute(at.name) !== at.value) an.setAttribute(at.name, at.value);
      an.__h = bn.__h;
      if (bn.__p) for (const k in bn.__p) { const v = propVal(k, bn.__p[k]); if (an[k] !== v) an[k] = v; }
      morph(an, bn);
    });
    while (a.childNodes.length > fresh.length) a.removeChild(a.lastChild);
  }

  function makeNestedPatch(path, newVal) {
    const parts = path.split('.');
    const patch = {};
    let cur = patch;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = newVal;
    return patch;
  }

  function createBinding(key, comp) {
    const snap = window.MK_DATA || {};
    const settings = snap.settings || {};
    const values = settings.values || {};
    const schema = (settings.schema && settings.schema[key]) || null;
    let val = get(values, key);
    if (val === undefined && schema && schema.default !== undefined) {
      val = schema.default;
    }
    const min = schema && schema.min !== undefined ? schema.min : null;
    const max = schema && schema.max !== undefined ? schema.max : null;
    const options = schema && Array.isArray(schema.options) ? schema.options : null;
    const type = schema && schema.type ? schema.type : (typeof val === 'number' ? 'int' : typeof val === 'boolean' ? 'bool' : 'string');

    const save = (newVal) => {
      let v = newVal;
      if (type === 'int' || type === 'number') {
        v = typeof v === 'number' ? Math.round(v) : parseInt(v, 10);
        if (isNaN(v)) v = schema && schema.default !== undefined ? schema.default : 0;
        if (min !== null && v < min) v = min;
        if (max !== null && v > max) v = max;
      }
      const patch = makeNestedPatch(key, v);
      if (window.MK_DATA && window.MK_DATA.settings) {
        if (!window.MK_DATA.settings.values) window.MK_DATA.settings.values = {};
        let cur = window.MK_DATA.settings.values;
        const parts = key.split('.');
        for (let i = 0; i < parts.length - 1; i++) {
          if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = v;
      }
      if (key.startsWith('look.')) {
        applyLook();
      }
      if (comp && typeof comp.action === 'function') {
        return comp.action('settings.save', { patch });
      }
      return window.MK.action('settings.save', { patch });
    };

    return {
      key,
      value: val,
      val,
      min,
      max,
      options,
      type,
      default: schema ? schema.default : null,
      schema,
      save,
      set: save,
      step: (delta) => {
        const curNum = typeof val === 'number' ? val : (parseInt(val, 10) || 0);
        return save(curNum + delta);
      },
      less: () => {
        const curNum = typeof val === 'number' ? val : (parseInt(val, 10) || 0);
        return save(curNum - 1);
      },
      more: () => {
        const curNum = typeof val === 'number' ? val : (parseInt(val, 10) || 0);
        return save(curNum + 1);
      },
      inc: () => {
        const curNum = typeof val === 'number' ? val : (parseInt(val, 10) || 0);
        return save(curNum + 1);
      },
      dec: () => {
        const curNum = typeof val === 'number' ? val : (parseInt(val, 10) || 0);
        return save(curNum - 1);
      },
      cycle: () => {
        if (!options || !options.length) return;
        const idx = options.indexOf(val);
        const next = options[(idx + 1) % options.length];
        return save(next);
      },
      is: (expected) => val === expected,
      toggle: () => save(!val),
      change: (e) => {
        if (!e || !e.target) return;
        if (e.target.type === 'checkbox') save(e.target.checked);
        else if (type === 'int' || type === 'number') save(parseInt(e.target.value, 10));
        else save(e.target.value);
      },
      input: (e) => {
        if (!e || !e.target) return;
        if (type === 'int' || type === 'number') save(parseInt(e.target.value, 10));
        else save(e.target.value);
      },
    };
  }

  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
    }
    setState(patch) {
      this.state = Object.assign({}, this.state, typeof patch === 'function' ? patch(this.state) : patch);
      if (this.__render) this.__render();
    }
    action(name, args) {
      return window.MK.action(name, args);
    }
    getData(screenName) {
      const d = window.MK_DATA || {};
      if (!screenName) return d;
      return d[screenName] || {};
    }
    getBadges() {
      return (window.MK_DATA && window.MK_DATA.badges) || { lanes: 0, waiting: 0, inbox: 0, bugs: 0 };
    }
    getMeta() {
      return (window.MK_DATA && window.MK_DATA.meta) || {};
    }
    bind(key) {
      return createBinding(key, this);
    }
  }

  // In-page navigation helper
  function targetOf(href) {
    if (!href) return null;
    const m = /([A-Za-z]+)\.dc\.html$/.exec(href);
    if (m) {
      if (m[1] === 'Overview') return 'Main';
      return m[1];
    }
    const h = /^#([a-z]+)$/i.exec(href);
    if (h) {
      const lower = h[1].toLowerCase();
      if (lower === 'overview' || lower === 'main') return 'Main';
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
    return null;
  }

  const BASE_CSS = ':host{display:block;height:100vh}main{scrollbar-width:thin;scrollbar-color:#143d22 transparent}main>*{flex-shrink:0}';
  const mounted = {};
  const instances = {};
  let current = null;

  const ZOOM_MAP = { S: '0.9', M: '1', L: '1.15' };
  let currentZoom = '1';

  function isMotionReduced(reduceMotion) {
    if (reduceMotion === 'on') return true;
    if (reduceMotion === 'off') return false;
    try {
      if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return true;
      }
    } catch (_) {}
    return false;
  }

  function applyLook() {
    const snap = window.MK_DATA || {};
    const settings = snap.settings || {};
    const values = settings.values || {};
    const look = values.look || {};
    const rain = look.rain || {};
    const rainEnabled = rain.enabled !== undefined ? rain.enabled : true;
    const brightness = typeof rain.brightness === 'number' ? rain.brightness : 60;
    const speed = rain.speed || 'normal';
    const reduceMotion = look.reduceMotion || 'os';
    const textSize = look.textSize || 'M';
    const density = look.density || 'comfy';

    const motionReduced = isMotionReduced(reduceMotion);
    const rainActive = rainEnabled && !motionReduced;
    currentZoom = ZOOM_MAP[textSize] || '1';

    // CSS variables on root
    const root = document.documentElement;
    if (root && root.style) {
      root.style.setProperty('--mk-zoom', currentZoom);
      root.style.setProperty('--mk-text-size', textSize);
      root.style.setProperty('--mk-density', density);
      root.style.setProperty('--mk-rain-brightness', `${brightness}%`);
      root.style.setProperty('--mk-rain-speed', speed);
      root.style.setProperty('--mk-rain-enabled', rainActive ? '1' : '0');
    }

    // Classes on documentElement and body
    const targets = [document.documentElement, document.body].filter(Boolean);
    targets.forEach((el) => {
      // Density
      el.classList.remove('compact', 'comfy', 'density-compact', 'density-comfy');
      el.classList.add(density);
      el.classList.add('density-' + density);

      // Text size
      el.classList.remove('text-size-s', 'text-size-m', 'text-size-l');
      el.classList.add('text-size-' + textSize.toLowerCase());

      // Motion
      el.classList.remove('reduce-motion', 'motion-reduce');
      if (motionReduced) {
        el.classList.add('reduce-motion', 'motion-reduce');
      }

      // Rain
      el.classList.remove('rain-on', 'rain-off');
      el.classList.add(rainActive ? 'rain-on' : 'rain-off');
    });

    // Apply zoom and density to each mounted screen host
    for (const k in mounted) {
      if (mounted[k]) {
        mounted[k].style.zoom = currentZoom;
        mounted[k].classList.remove('compact', 'comfy', 'density-compact', 'density-comfy');
        mounted[k].classList.add(density);
        mounted[k].classList.add('density-' + density);
      }
    }

    // Re-render mounted screen instances
    for (const k in instances) {
      if (instances[k] && typeof instances[k].__render === 'function') {
        instances[k].__render();
      }
    }
  }

  // Rain effect utility
  const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789';
  function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
  function makeRain(seed) {
    const snap = window.MK_DATA || {};
    const settings = snap.settings || {};
    const values = settings.values || {};
    const look = values.look || {};
    const rain = look.rain || {};
    const enabled = rain.enabled !== undefined ? rain.enabled : true;
    const brightness = typeof rain.brightness === 'number' ? rain.brightness : 60;
    const speed = rain.speed || 'normal';
    const reduceMotion = look.reduceMotion || 'os';

    const motionReduced = isMotionReduced(reduceMotion);
    if (!enabled || motionReduced) {
      return [];
    }

    let speedMult = 1.0;
    if (speed === 'slow') speedMult = 1.6;
    else if (speed === 'fast') speedMult = 0.6;

    const brightScale = Math.max(0, Math.min(100, brightness)) / 60;

    const R = rng(seed), out = [];
    for (let i = 0; i < 30; i++) {
      const n = 14 + Math.floor(R() * 26), g = [];
      for (let k = 0; k < n; k++) g.push(GLYPHS[Math.floor(R() * GLYPHS.length)]);
      const dur = (7 + R() * 9) * speedMult, delay = -R() * dur, op = Math.min(1, (0.16 + R() * 0.22) * brightScale);
      out.push({ glyphs: g.join('\n'), style: 'left:' + (i * 14.6 + R() * 4).toFixed(1) + 'px;opacity:' + op.toFixed(2) + ';animation-duration:' + dur.toFixed(1) + 's;animation-delay:' + delay.toFixed(1) + 's' });
    }
    return out;
  }

  // Shared navigation tabs
  const TABS_SPEC = [
    ['projects', 'Projects', 'M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z', 'Projects.dc.html'],
    ['overview', 'Overview', 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z', 'Main.dc.html'],
    ['lanes', 'Lanes', 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9', 'Lanes.dc.html'],
    ['plan', 'Plan', 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', 'Plan.dc.html'],
    ['waiting', 'Waiting', 'M12 8v4M12 16h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'Waiting.dc.html'],
    ['events', 'Events', 'M22 12h-4l-3 9L9 3l-3 9H2', 'Events.dc.html'],
    ['inbox', 'Inbox', 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z', 'Inbox.dc.html'],
    ['bugs', 'Bugs', 'M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 0 1 6 0v1.1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 13H3M21 13h-3.5M6 7.5 3.5 6M18 7.5 20.5 6', 'Bugs.dc.html'],
    ['todo', 'Todo', 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', 'Todo.dc.html'],
  ];

  function formatBadge(id, count) {
    if (!count || count <= 0) return null;
    const s = String(count);
    if (id === 'lanes') return [s, 'background:#0a2f2c;color:#4fd1c5'];
    if (id === 'waiting') return [s, 'background:#e8b04a;color:#1a1204'];
    if (id === 'inbox') return [s, 'background:#0f2a17;color:#b9e8c4'];
    if (id === 'bugs') return [s, 'background:#3a1512;color:#ff9b8a'];
    return [s, 'background:#0d2a16;color:#19e35a'];
  }

  function getTabs(active, badges, onPick) {
    const bmap = badges || {};
    return TABS_SPEC.map(([id, label, icon, href]) => {
      const b = formatBadge(id, bmap[id]);
      const isCur = id === active;
      return {
        id,
        label,
        icon,
        href: href || '',
        isLink: !!href,
        isBtn: !href,
        cur: isCur ? 'page' : 'false',
        cls: 'tab' + (isCur ? ' on' : ''),
        hasBadge: !!b,
        badge: b ? b[0] : '',
        badgeStyle: b ? b[1] : '',
        pick: () => {
          if (onPick) onPick(id);
          const t = targetOf(href);
          if (t && window.MK_SCREENS[t]) go(t);
        },
      };
    });
  }

  // Settings sub-navigation tabs
  const SETTINGS_TABS_SPEC = [
    ['general', 'General', 'Settings.dc.html', 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'],
    ['routing', 'Routing & Quota', 'SettingsRouting.dc.html', 'M12 3v18M5 5h11l3 3-3 3H5zM19 13H8l-3 3 3 3h11'],
    ['work', 'Work', 'SettingsWork.dc.html', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z'],
    ['safety', 'Safety', 'SettingsSafety.dc.html', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
    ['notify', 'Notifications', 'SettingsNotify.dc.html', 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0'],
    ['look', 'Appearance', 'SettingsLook.dc.html', 'M12 3a9 9 0 1 0 9 9c0-1-1-1.5-2-1.5h-2a2 2 0 0 1-2-2V7c0-2-1.5-4-3-4zM7.5 10.5h.01M10.5 7h.01M15 8h.01'],
  ];

  function getSettingsTabs(active) {
    return SETTINGS_TABS_SPEC.map(([id, label, href, icon]) => ({
      id,
      label,
      href,
      icon,
      cls: 'stab' + (id === active ? ' on' : ''),
      cur: id === active ? 'page' : 'false',
    }));
  }

  // --- WIRE.1 Data Layer ---
  const urlParams = new URLSearchParams(window.location.search);
  const hashStr = (window.location.hash || '').slice(1);
  const hashParams = hashStr.includes('=') ? new URLSearchParams(hashStr) : new URLSearchParams();

  const token = urlParams.get('token') || urlParams.get('t') || hashParams.get('token') || hashParams.get('t') || '';
  const port = urlParams.get('port') || window.location.port;
  const host = window.location.hostname || '127.0.0.1';
  const apiBase = (port && host) ? `${window.location.protocol}//${host}:${port}` : '';

  let staleBannerEl = null;

  function ensureStaleBanner() {
    if (!staleBannerEl) {
      staleBannerEl = document.createElement('div');
      staleBannerEl.id = 'mk-stale-banner';
      staleBannerEl.className = 'mk-stale-banner';
      staleBannerEl.setAttribute('data-role', 'stale-banner');
      staleBannerEl.style.display = 'none';
      staleBannerEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg><span id="mk-stale-text">Connection lost · Stale data</span>`;
      document.body.prepend(staleBannerEl);
    }
    return staleBannerEl;
  }

  function showStaleBanner(text) {
    const el = ensureStaleBanner();
    const span = document.getElementById('mk-stale-text');
    if (span) span.textContent = text || 'Connection lost · Stale data';
    el.style.display = 'flex';
  }

  function hideStaleBanner() {
    const el = ensureStaleBanner();
    el.style.display = 'none';
  }

  function emptySnapshotFallback() {
    return {
      meta: { schema: 1, at: Date.now(), orca: '1.4.239', runtimeOk: true, repoId: null, planId: null, runId: null, stale: { ps: 0, orchestration: 0, git: 0, quota: 0 } },
      badges: { lanes: 0, waiting: 0, inbox: 0, bugs: 0 },
      projects: { machine: 'this Mac', active: 0, total: 0, lanesLive: 0, waiting: 0, waitingList: [], repos: [] },
      overview: { stage: 'plan', stageProgress: { plan: 0, build: 0, verify: 0, merge: 0 }, wave: [0, 0], lanesLive: 0, tasks: [0, 0], needsYou: 0, bus: null, decision: null, waves: [] },
      lanes: [],
      plan: { title: 'No plan', done: 0, total: 0, subtasks: 0, phases: [] },
      waiting: { open: [], resolved: [] },
      events: { cursor: 0, rows: [] },
      inbox: { dir: '', archived: 0, files: [] },
      bugs: { total: 0, needWork: 0, rows: [] },
      todo: { open: 0, done: 0, rows: [] },
      settings: {
        values: {},
        schema: {},
        migrationNotes: [],
        lastScreen: null,
        specTemplates: {},
        agents: [],
        baseBranch: 'main',
        version: '0.1.1',
      },
    };
  }

  window.MK_DATA = emptySnapshotFallback();
  window.MK_STALE = false;

  async function fetchState(screenName) {
    const screen = (screenName || current || window.MK_START || '').toLowerCase();
    const url = `${apiBase}/api/state?screen=${encodeURIComponent(screen)}`;
    try {
      const res = await fetch(url, {
        headers: {
          'x-mk-token': token,
          'Accept': 'application/json',
        },
      });
      if (res.ok) {
        const json = await res.json();
        window.MK_DATA = Object.assign({}, window.MK_DATA, json);
        window.MK_STALE = false;
        hideStaleBanner();
        applyLook();
      } else {
        window.MK_STALE = true;
        showStaleBanner(`Data may be stale · server returned ${res.status}`);
      }
    } catch (err) {
      window.MK_STALE = true;
      showStaleBanner('Data may be stale · connection to local worker lost');
      if (!window.MK_DATA) window.MK_DATA = emptySnapshotFallback();
    }
    // Re-render the active component while preserving local UI state
    if (current && instances[current] && instances[current].__render) {
      instances[current].__render();
    }
  }

  let toastEl = null;
  let toastTimer = null;

  function showToast(message, isError = true) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'mk-toast';
      toastEl.className = 'mk-toast';
      toastEl.setAttribute('role', 'alert');
      document.body.appendChild(toastEl);
    }
    const text = typeof message === 'object' && message ? (message.message || JSON.stringify(message)) : String(message);
    toastEl.textContent = text;
    toastEl.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;background:${isError ? '#3a1512' : '#08190d'};color:${isError ? '#ff9b8a' : '#19e35a'};border:1px solid ${isError ? '#7a2520' : '#145a2a'};border-radius:8px;padding:8px 16px;font-family:'Geist',system-ui,sans-serif;font-size:12.5px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.6);transition:opacity 0.2s;display:block;opacity:1;pointer-events:none`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = '0';
      setTimeout(() => { if (toastEl) toastEl.style.display = 'none'; }, 200);
    }, 4000);
  }

  async function action(name, args = {}) {
    const url = `${apiBase}/api/action`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mk-token': token,
        },
        body: JSON.stringify({ name, args }),
      });
      const json = await res.json();
      if (!json.ok) {
        const errMsg = (json.error && json.error.message) || (typeof json.error === 'string' ? json.error : 'Action refused');
        showToast(errMsg, true);
        await fetchState(current);
        return json;
      }
      // After successful action, refresh state immediately
      await fetchState(current);
      return json;
    } catch (err) {
      console.error('Action failed:', name, err);
      const errMsg = err.message || 'Connection error';
      showToast(errMsg, true);
      await fetchState(current);
      return { ok: false, error: { message: errMsg } };
    }
  }

  // 5-second polling loop
  let pollTimer = null;
  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    fetchState(current);
    pollTimer = setInterval(() => {
      fetchState(current);
    }, 5000);
  }

  function mount(name) {
    const def = window.MK_SCREENS[name];
    if (!def) return null;
    const tpl = document.getElementById('tpl-' + name);
    if (!tpl) return null;
    const host = document.createElement('div');
    host.className = 'mk-screen';
    host.dataset.screen = name;
    host.style.zoom = currentZoom;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BASE_CSS + def.css;
    const view = document.createElement('div');
    root.append(style, view);
    const inst = new def.Component({});
    instances[name] = inst;
    host.component = inst;
    inst.__render = () => {
      const frag = document.createDocumentFragment();
      const vals = inst.renderVals();
      for (const c of tpl.content.childNodes) build(c, vals, frag);
      morph(view, frag);
    };
    for (const type of ['click', 'input', 'change', 'keydown']) {
      root.addEventListener(type, (e) => {
        for (const el of e.composedPath()) {
          if (el === root) break;
          if (el.__h && el.__h[type]) { el.__h[type](e); break; }
        }
        if (type !== 'click') return;
        const link = e.composedPath().find((el) => el.localName === 'a' && el.hasAttribute('href'));
        if (link) {
          e.preventDefault();
          const t = targetOf(link.getAttribute('href'));
          if (t && window.MK_SCREENS[t]) go(t);
        }
      });
    }
    document.body.appendChild(host);
    inst.__render();
    return (mounted[name] = host);
  }

  function screenToRememberName(name) {
    if (!name) return 'projects';
    if (name === 'Main' || name === 'Overview') return 'overview';
    if (name.startsWith('Settings')) return 'settings';
    return name.toLowerCase();
  }

  function resolveStartScreen() {
    const snap = window.MK_DATA || {};
    const settings = snap.settings || {};
    const values = settings.values || {};
    const general = values.general || {};
    const openOnStart = general.openOnStart || 'last';
    let target = openOnStart;
    if (target === 'last') {
      target = settings.lastScreen || 'projects';
    }
    if (!target) target = 'projects';
    const lower = String(target).toLowerCase();
    if (lower === 'overview' || lower === 'main') return 'Main';
    if (lower === 'settings') return 'Settings';
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function go(name) {
    if (name === 'Overview') name = 'Main';
    if (!window.MK_SCREENS[name]) name = window.MK_START;
    if (current === name && mounted[name]) return;
    const isChange = current !== null && current !== name;
    const host = mounted[name] || mount(name);
    for (const k in mounted) mounted[k].hidden = k !== name;
    if (host) host.hidden = false;
    current = name;
    try {
      history.replaceState(null, '', '#' + (name === 'Main' ? 'overview' : name.toLowerCase()));
    } catch (_) { /* sandboxed frame */ }
    if (isChange) {
      action('ui.remember', { screen: screenToRememberName(name) });
    }
    fetchState(name);
  }

  window.DCLogic = DCLogic;
  window.MK_RAIN = makeRain;
  window.MK_TABS = getTabs;
  window.MK_STABS = getSettingsTabs;
  window.MK_BIND = (key, comp) => createBinding(key, comp);
  window.bind = (key) => createBinding(key);
  window.MK = {
    go,
    action,
    applyLook,
    refresh: () => fetchState(current),
    getState: () => window.MK_DATA,
    getToken: () => token,
    getApiBase: () => apiBase,
  };
  window.MK_BOOT = async () => {
    let initial = (location.hash || '').slice(1);
    if (initial.includes('=')) initial = '';
    if (initial) {
      const lower = initial.toLowerCase();
      if (lower === 'overview' || lower === 'main') initial = 'Main';
      else initial = lower.charAt(0).toUpperCase() + lower.slice(1);
    }
    if (!initial) {
      if (!window.MK_DATA || !window.MK_DATA.settings || !window.MK_DATA.settings.values || !Object.keys(window.MK_DATA.settings.values).length) {
        await fetchState();
      }
      initial = resolveStartScreen();
    }
    go(initial || window.MK_START);
    applyLook();
    startPolling();
  };
})();
