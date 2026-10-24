// Panel runtime: renders the canvas screens (panel/screens/*.dc.html) unchanged.
// Each screen is a template ({{path}}, <sc-for>, <sc-if>, on* handlers) plus a
// Component class whose renderVals() returns the values. Screens render in their
// own shadow root so their styles stay apart, and re-render by patching the DOM
// in place so inputs keep focus and the rain animation never restarts.
// Why no framework: the panel CSP allows inline scripts only, with no eval.
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
        // React-style onChange: fires per keystroke on text and range inputs.
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

  // Patches the live children of `a` to match the freshly built children of `b`.
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

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      this.state = Object.assign({}, this.state, typeof patch === 'function' ? patch(this.state) : patch);
      if (this.__render) this.__render();
    }
  }

  // In-page links between screens: "Lanes.dc.html" and the "#lanes" anchors.
  function targetOf(href) {
    if (!href) return null;
    const m = /([A-Za-z]+)\.dc\.html$/.exec(href);
    if (m) return m[1];
    const h = /^#([a-z]+)$/.exec(href);
    return h ? h[1].charAt(0).toUpperCase() + h[1].slice(1) : null;
  }

  const BASE_CSS = ':host{display:block;height:100vh}main{scrollbar-width:thin;scrollbar-color:#143d22 transparent}main>*{flex-shrink:0}';
  const mounted = {};
  let current = null;

  function mount(name) {
    const def = window.MK_SCREENS[name];
    const tpl = document.getElementById('tpl-' + name);
    const host = document.createElement('div');
    host.className = 'mk-screen';
    host.dataset.screen = name;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BASE_CSS + def.css;
    const view = document.createElement('div');
    root.append(style, view);
    const inst = new def.Component({});
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
        if (link) { e.preventDefault(); const t = targetOf(link.getAttribute('href')); if (t && window.MK_SCREENS[t]) go(t); }
      });
    }
    document.body.appendChild(host);
    inst.__render();
    return (mounted[name] = host);
  }

  function go(name) {
    if (!window.MK_SCREENS[name]) name = window.MK_START;
    if (current === name) return;
    const host = mounted[name] || mount(name);
    for (const k in mounted) mounted[k].hidden = k !== name;
    host.hidden = false;
    current = name;
    try { history.replaceState(null, '', '#' + name); } catch (_) { /* sandboxed frame */ }
  }

  window.DCLogic = DCLogic;
  window.MK = { go };
  window.MK_BOOT = () => go((location.hash || '').slice(1) || window.MK_START);
})();
