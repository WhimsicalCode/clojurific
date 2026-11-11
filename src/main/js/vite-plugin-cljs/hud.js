// The dev server's status in a corner of its pages (the plugin's hud option),
// like shadow-cljs' HUD: the modules a page is loading, a compile in
// progress, a hot reload being applied, and the dev server or its compiler
// gone. The plugin serves it as a module before the pages' scripts: it runs
// once it and @vite/client are loaded, while the page's own modules are
// still loading. The plugin's cljf:hud events tell it of compiles.

// Shown past this delay only, so quick hot reloads don't flash it
const DELAY = 300;
// and hidden past this one, so a compile and its hot reload show as one
const LINGER = 600;
// the module count of the page's last load, for the next load's percentage
const MODULES_KEY = 'cljf-hud:modules';

/**
 * The badge of status s: its text and whether it spins, null hides it.
 * s: {stopped, disconnected, compiling (ms since it started, else null),
 * reloading {done, total}, loading {done, expected}}, the first set wins.
 */
export function view(s) {
  if (s.stopped) return { text: 'ClojureScript watch stopped', busy: false };
  if (s.disconnected) return { text: 'Dev server disconnected', busy: false };
  if (s.compiling != null) {
    const seconds = Math.floor(s.compiling / 1000);
    return { text: seconds ? `Compiling… ${seconds}s` : 'Compiling…', busy: true };
  }
  if (s.reloading) {
    const { done, total } = s.reloading;
    return { text: `Reloading ${Math.min(done, total)}/${total}`, busy: true };
  }
  if (s.loading) {
    const { done, expected } = s.loading;
    const percent = expected ? ` (${Math.min(99, Math.floor((done / expected) * 100))}%)` : '';
    return { text: `Loading modules… ${done.toLocaleString('en-US')}${percent}`, busy: true };
  }
  return null;
}

const STYLE = `
  :host { all: initial; position: fixed; left: 8px; bottom: 8px; z-index: 2147483647; pointer-events: none; }
  div { display: flex; align-items: center; gap: 7px; padding: 5px 11px 5px 9px; border-radius: 14px;
        background: rgba(24, 24, 27, 0.88); color: #fff; border: 1px solid rgba(255, 255, 255, 0.3); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
        font: 500 12px/16px system-ui, -apple-system, sans-serif; font-variant-numeric: tabular-nums; }
  span.spinner { width: 10px; height: 10px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.3);
                 border-top-color: #fff; animation: spin 0.8s linear infinite; }
  [hidden] { display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

function start(hot) {
  const prefix = import.meta.url.slice(0, import.meta.url.indexOf('@id/'));
  const s = { stopped: false, disconnected: false, compiling: null, reloading: null, loading: null };
  // the compile's start, in this page's clock
  let compileStart = null;

  let host, text, spinner, showTimer, hideTimer, frame;
  const element = () => {
    if (host) return;
    host = document.createElement('cljf-hud');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${STYLE}</style><div role="status"><span class="spinner"></span><span class="text"></span></div>`;
    spinner = root.querySelector('.spinner');
    text = root.querySelector('.text');
  };
  const render = () => {
    frame = null;
    s.compiling = compileStart === null ? null : performance.now() - compileStart;
    const v = view(s);
    if (!v) {
      clearTimeout(showTimer);
      showTimer = null;
      if (host?.isConnected) {
        hideTimer ??= setTimeout(() => {
          hideTimer = null;
          host.remove();
        }, LINGER);
      }
      return;
    }
    clearTimeout(hideTimer);
    hideTimer = null;
    if (host?.isConnected) {
      text.textContent = v.text;
      spinner.hidden = !v.busy;
    } else if (!showTimer) {
      showTimer = setTimeout(() => {
        showTimer = null;
        element();
        document.documentElement.append(host);
        render();
      }, DELAY);
    }
  };
  const update = () => (frame ??= requestAnimationFrame(render));
  // the compile's elapsed seconds
  setInterval(() => compileStart !== null && update(), 1000);

  // Module fetches: the page's (until DOMContentLoaded, which follows its
  // module scripts) and a hot reload's, whose URLs carry its timestamp
  const nav = performance.getEntriesByType('navigation')[0];
  if (nav && !nav.domContentLoadedEventStart) {
    let expected = 0;
    try {
      expected = Number(localStorage.getItem(MODULES_KEY)) || 0;
    } catch {}
    s.loading = { done: 0, expected };
    addEventListener('DOMContentLoaded', () => {
      try {
        localStorage.setItem(MODULES_KEY, String(s.loading.done));
      } catch {}
      s.loading = null;
      update();
    }, { once: true });
  }
  let reloadStamp = null;
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (!entry.name.startsWith(prefix)) continue;
      if (s.loading) s.loading.done++;
      if (s.reloading && entry.name.includes(`t=${reloadStamp}`)) s.reloading.done++;
    }
    update();
  }).observe({ type: 'resource', buffered: true });

  hot.on('cljf:hud', ({ compiling, elapsed, stopped }) => {
    compileStart = compiling ? performance.now() - elapsed : null;
    s.stopped = stopped;
    update();
  });
  hot.on('vite:beforeUpdate', ({ updates }) => {
    const modules = updates.filter(u => u.type === 'js-update');
    if (!modules.length) return;
    reloadStamp = modules[0].timestamp;
    s.reloading = { done: 0, total: modules.length };
    update();
  });
  hot.on('vite:afterUpdate', () => {
    s.reloading = null;
    update();
  });
  hot.on('vite:ws:disconnect', () => {
    s.disconnected = true;
    update();
  });
  hot.on('vite:ws:connect', () => {
    s.disconnected = false;
    update();
  });
  // a page loaded mid-compile, or after the compiler exited
  hot.send('cljf:hud');
  update();
}

if (import.meta.hot && typeof document !== 'undefined') start(import.meta.hot);
