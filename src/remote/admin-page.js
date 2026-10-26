// Admin app: sign-in plus a side-rail layout with one view per area.
// Views: #overview, #issues, #people, #person/<key>, #access/<tab>, #group/<id>, #usage, #connections, #settings/<tab>.
// Every list is paged and searched on the server (10 a page). Actions update the row at once, then re-read the
// list once. Every view has loading, error, empty and session-expired states.
// Everything that came from Teams (names, app names, details) is inserted with textContent, never as HTML.
import { MIN_PASSWORD } from './admin-auth.js';

// Icons: Lucide paths (ISC licence), drawn at one stroke weight.
const ICONS = {
  overview: 'M3 3h8v10H3zM13 3h8v6h-8zM13 13h8v8h-8zM3 17h8v4H3z',
  issues: 'M22 12h-4l-3 9L9 3l-3 9H2',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  access: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  usage: 'M3 3v18h18M7 16l4-4 4 4 5-6',
  connections: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  back: 'M19 12H5M12 19l-7-7 7-7',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  wifi: 'M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01',
  prev: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
};
const svg = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICONS[name]}"/></svg>`;

const CSS = `
:root {
  --ground: #f6f3ef; --surface: #ffffff; --surface-2: #f0ebe5; --surface-3: #e6dfd7; --line: #e3dcd3;
  --ink: #1d1916; --ink-2: #554c44; --ink-3: #6f665d;
  --rail: #1f1a17; --rail-2: #2c2521; --rail-ink: #f4ede7; --rail-muted: #b9ada2;
  --accent: #cf4329; --accent-press: #b2361f; --accent-ink: #ffffff; --accent-soft: #fbe6e0;
  --warn: #7c5200; --warn-bg: #fcefd2; --bad: #9c2618; --bad-bg: #fbe1dc; --ok: #1b6643; --ok-bg: #def1e6; --info: #284a80; --info-bg: #e3ebf7;
  --step-small: 0.875rem; --step-body: 1rem; --step-h2: 1.125rem; --step-h1: clamp(1.5rem, 1.15rem + 1.2vw, 2rem); --step-num: clamp(1.35rem, 1.1rem + 0.8vw, 1.75rem);
  --pad: clamp(16px, 2.6vw, 40px); --radius: 12px; --radius-s: 7px; --rail-w: 232px;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --ease: cubic-bezier(.16, 1, .3, 1);
  --shadow: 0 1px 2px rgb(31 26 23 / .06), 0 8px 24px -12px rgb(31 26 23 / .18);
}
*, *::before, *::after { box-sizing: border-box; }
html { scrollbar-color: var(--surface-3) transparent; }
body { margin: 0; background: var(--ground); color: var(--ink); font: 400 var(--step-body)/1.5 var(--font); -webkit-font-smoothing: antialiased; caret-color: var(--accent); }
::selection { background: var(--accent-soft); color: var(--ink); }
a { color: inherit; text-underline-offset: .2em; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
[tabindex="-1"]:focus { outline: none; }
code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: .88em; }
[hidden] { display: none !important; }
.ic { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.num, td.num, th.num { font-variant-numeric: tabular-nums; }
.skip { position: absolute; left: 12px; top: -48px; z-index: 60; background: var(--ink); color: #fff; padding: 10px 14px; border-radius: var(--radius-s); text-decoration: none; font-weight: 600; }
.skip:focus { top: 12px; }

/* buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 0 16px; border-radius: var(--radius-s);
  border: 1px solid transparent; font: 500 var(--step-small)/1 var(--font); cursor: pointer; text-decoration: none; white-space: nowrap;
  background: var(--accent); color: var(--accent-ink); transition: background-color .15s var(--ease), transform .15s var(--ease); }
.btn:hover { background: var(--accent-press); }
.btn:active { transform: translateY(1px); }
.btn.quiet { background: var(--surface); color: var(--ink); border-color: var(--line); }
.btn.quiet:hover { background: var(--surface-2); }
.btn.danger { background: var(--bad); }
.btn.danger:hover { background: #7f1d12; }
.btn.small { min-height: 32px; padding: 0 12px; }
.btn[disabled], .btn[aria-busy="true"] { opacity: .65; cursor: progress; transform: none; }
.link { font: inherit; background: none; border: 0; padding: 0; min-height: 24px; cursor: pointer; color: var(--ink-2); text-decoration: underline; text-underline-offset: .2em; }
.link:hover { color: var(--ink); }
.act { font: 600 var(--step-small)/1 var(--font); background: none; border: 0; padding: 4px 2px; min-height: 28px; min-width: 24px; cursor: pointer; color: var(--ink); text-decoration: underline; text-underline-offset: .2em; }
.act:hover { color: var(--accent-press); }
.act.bad { color: var(--bad); }
.act[disabled] { opacity: .5; cursor: progress; }
.spinning { animation: spin .8s linear infinite; }
.spin { width: 15px; height: 15px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: spin .7s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }

/* boot + sign-in */
.center { min-height: 100vh; display: grid; place-items: center; padding: var(--pad); }
.boot { display: flex; align-items: center; gap: 12px; color: var(--ink-2); }
.signin { width: min(400px, 100%); background: var(--surface); border-radius: 14px; box-shadow: var(--shadow); padding: clamp(24px, 4vw, 36px); display: grid; gap: 16px; }
.signin h1 { margin: 0; font-size: var(--step-h1); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
.signin p { margin: 0; color: var(--ink-2); font-size: var(--step-small); }
.field { display: grid; gap: 6px; font-size: var(--step-small); font-weight: 500; color: var(--ink-2); }
.field .hint { font-weight: 400; color: var(--ink-3); }
.input { font: 400 var(--step-body)/1.3 var(--font); color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-s); padding: 10px 12px; min-height: 42px; width: 100%; min-width: 0; }
.input:hover { border-color: #d3cac0; }
.input:focus-visible { outline-offset: 0; border-color: var(--accent); }
.input[aria-invalid="true"] { border-color: var(--bad); }
textarea.input { min-height: 84px; resize: vertical; }
.pw { position: relative; }
.pw .input { padding-right: 44px; }
.pw button { position: absolute; right: 4px; top: 4px; bottom: 4px; width: 36px; border: 0; background: none; color: var(--ink-3); border-radius: 6px; cursor: pointer; display: grid; place-items: center; }
.pw button[aria-pressed="true"] { color: var(--accent); }
.codein { letter-spacing: .3em; font-variant-numeric: tabular-nums; font-size: 1.25rem; text-align: center; }
.msg-err { color: var(--bad); font-size: var(--step-small); margin: 0; }
.msg-err:empty { display: none; }
.notice { padding: 10px 12px; border-radius: var(--radius-s); background: var(--info-bg); color: var(--info); font-size: var(--step-small); }

/* shell */
.app { display: grid; grid-template-columns: var(--rail-w) minmax(0, 1fr); min-height: 100vh; }
.rail { background: var(--rail); color: var(--rail-ink); position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 20px; padding: 20px 12px; }
.brandline { display: grid; gap: 2px; padding: 0 10px; }
.brandline a { font-weight: 600; letter-spacing: -0.02em; text-decoration: none; }
.brandline span { color: var(--rail-muted); font-size: var(--step-small); }
.menu { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.menu a { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: var(--radius-s); text-decoration: none; color: var(--rail-muted); font-size: .95rem; transition: background-color .15s var(--ease), color .15s var(--ease); }
.menu a:hover { background: var(--rail-2); color: var(--rail-ink); }
.menu a[aria-current="page"] { background: var(--accent); color: #fff; }
.menu .grow { flex: 1; }
.badge { min-width: 22px; padding: 2px 7px; border-radius: 999px; font-size: .75rem; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums; background: var(--rail-2); color: var(--rail-ink); }
.badge.hot { background: #f2b33d; color: #2a1d05; }
.menu a[aria-current="page"] .badge { background: rgb(255 255 255 / .22); color: #fff; }
.railfoot { margin-top: auto; display: grid; gap: 4px; padding: 0 2px; font-size: var(--step-small); }
.railfoot button, .railfoot a { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-s); border: 0; background: none; color: var(--rail-muted); font: inherit; cursor: pointer; text-decoration: none; text-align: left; }
.railfoot button:hover, .railfoot a:hover { background: var(--rail-2); color: var(--rail-ink); }
.railfoot .stamp { padding: 4px 10px 0; color: var(--rail-muted); font-size: .78rem; }
.content { min-width: 0; padding: clamp(20px, 3vw, 36px) var(--pad) 72px; }
.view { display: grid; gap: clamp(20px, 2.4vw, 28px); max-width: 1240px; animation: enter .35s var(--ease) both; }
@keyframes enter { from { opacity: 0; transform: translateY(6px); } }
.stack { display: grid; gap: clamp(20px, 2.4vw, 28px); min-width: 0; }
.stack:empty, .slot:empty { display: none; }
.tight { gap: 14px; }
.head { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px 24px; }
.head h1 { margin: 0; font-size: var(--step-h1); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
.head p { margin: 6px 0 0; color: var(--ink-2); font-size: var(--step-small); max-width: 70ch; }
.crumb { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; font-size: var(--step-small); color: var(--ink-2); text-decoration: none; margin-bottom: 6px; }
.crumb:hover { color: var(--ink); text-decoration: underline; }
h2 { margin: 0 0 12px; font-size: var(--step-h2); font-weight: 600; letter-spacing: -0.015em; }
.panelhead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin-bottom: 12px; }
.panelhead h2 { margin: 0; }
.panel { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: clamp(16px, 2vw, 24px); min-width: 0; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: clamp(16px, 2vw, 24px); }
.muted { color: var(--ink-2); font-size: var(--step-small); margin: 0; }
.faint { color: var(--ink-3); }

/* alerts */
.alerts { display: grid; gap: 8px; }
.alerts:empty { display: none; }
.alert { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--radius-s); background: var(--warn-bg); color: var(--warn); font-size: var(--step-small); font-weight: 500; text-decoration: none; }
.alert.bad { background: var(--bad-bg); color: var(--bad); }
.alert .grow { flex: 1; min-width: 0; }
.alert .why { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; font-weight: 600; }
a.alert:hover .why { text-decoration: underline; }
.allclear { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: var(--radius-s); background: var(--ok-bg); color: var(--ok); font-size: var(--step-small); font-weight: 500; }

/* stats */
.stats { display: flex; flex-wrap: wrap; gap: 1px; background: var(--line); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); }
.stat { flex: 1 1 150px; background: var(--surface); padding: 14px 16px; display: grid; gap: 4px; min-width: 0; align-content: start; }
.stat b { font-size: var(--step-num); font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.stat span { color: var(--ink-2); font-size: var(--step-small); }
.stat .delta { font-size: .75rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--ink-3); }
.stat .delta.up { color: var(--ok); }
.stat .delta.down { color: var(--bad); }

/* the 14-day health strip */
.strip { display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); gap: 4px; }
.strip button { border: 0; padding: 0; cursor: pointer; display: grid; gap: 6px; background: none; color: var(--ink-3); font: 500 .7rem/1 var(--font); min-height: 24px; }
.strip i { display: block; height: 44px; border-radius: 6px; background: var(--ok-bg); transition: transform .15s var(--ease); }
.strip i[data-level="1"] { background: #f6dd9c; }
.strip i[data-level="2"] { background: #eeb04c; }
.strip i[data-level="3"] { background: #d9622f; }
.strip i[data-level="4"] { background: var(--bad); }
.strip button:hover i, .strip button[aria-pressed="true"] i { transform: translateY(-2px); box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: .78rem; color: var(--ink-2); margin-top: 10px; align-items: center; }
.legend i { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -2px; margin-right: 4px; }

/* charts */
.cols { display: flex; align-items: flex-end; gap: 3px; height: 140px; border-bottom: 1px solid var(--line); }
.cols i { flex: 1; background: var(--ink); min-height: 1px; border-radius: 3px 3px 0 0; opacity: .85; }
.cols i.w { background: var(--accent); opacity: 1; }
.axis { display: flex; justify-content: space-between; color: var(--ink-3); font-size: .75rem; margin-top: 6px; }
.heat { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 3px; }
.heat i { aspect-ratio: 1; border-radius: 3px; background: var(--accent); }
.rank { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: var(--step-small); }
.rank li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(60px, 120px) 56px; gap: 12px; align-items: center; }
.rank li > :first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rank li i { display: block; height: 8px; background: var(--ink); border-radius: 4px; }
.rank li .n { text-align: right; font-variant-numeric: tabular-nums; color: var(--ink-2); }
.meter { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
.meter i { display: block; height: 100%; background: var(--ink); border-radius: 4px; }
.meter i.hot { background: var(--bad); }
.limitrow { display: grid; gap: 6px; margin-bottom: 14px; font-size: var(--step-small); }
.big { font-size: var(--step-num); font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.facts { display: grid; grid-template-columns: minmax(120px, max-content) minmax(0, 1fr); gap: 8px 20px; font-size: var(--step-small); margin: 0; }
.facts dt { color: var(--ink-2); }
.facts dd { margin: 0; overflow-wrap: anywhere; }

/* tabs */
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
.tabs a { display: inline-flex; align-items: center; gap: 8px; padding: 10px 12px; min-height: 40px; color: var(--ink-2); text-decoration: none; font-size: var(--step-small); font-weight: 500; white-space: nowrap; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tabs a:hover { color: var(--ink); }
.tabs a[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--accent); }
.tabs .n { min-width: 20px; padding: 1px 7px; border-radius: 999px; background: var(--surface-2); color: var(--ink-2); font-size: .75rem; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums; }
.tabs .n.hot { background: var(--warn-bg); color: var(--warn); }

/* tables: compact rows on phones, low-priority columns hidden on tablets */
.tablewrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: var(--step-small); }
th { text-align: left; font-weight: 500; color: var(--ink-2); padding: 10px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; background: var(--surface); }
th button.sort { font: inherit; color: inherit; background: none; border: 0; padding: 0; min-height: 24px; cursor: pointer; display: inline-flex; gap: 4px; align-items: center; }
th button.sort[aria-sort] { color: var(--ink); font-weight: 600; }
td { padding: 11px 12px; border-bottom: 1px solid var(--surface-2); vertical-align: middle; }
tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: #fbf9f6; }
tbody tr.gone td { opacity: .4; transition: opacity .2s var(--ease); }
tbody tr.picked td { background: var(--accent-soft); }
td.num, th.num { text-align: right; }
td a.open { font-weight: 600; }
td .acts { display: flex; gap: 14px; justify-content: flex-end; white-space: nowrap; }
td.nw { white-space: nowrap; }
td.clip { max-width: 420px; min-width: 200px; }
td.clip span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
th.pick, td.pick { width: 40px; padding-right: 0; }
.check { width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer; margin: 0; vertical-align: middle; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: .75rem; font-weight: 600; white-space: nowrap; background: var(--surface-2); color: var(--ink-2); }
.pill.warn { background: var(--warn-bg); color: var(--warn); }
.pill.bad { background: var(--bad-bg); color: var(--bad); }
.pill.ok { background: var(--ok-bg); color: var(--ok); }
.pill.info { background: var(--info-bg); color: var(--info); }
.sub { display: block; color: var(--ink-3); font-size: .78rem; margin-top: 2px; }

/* lists: toolbar, bulk bar, pager */
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.toolbar .search { position: relative; flex: 1 1 220px; min-width: 0; }
.toolbar .search .ic { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--ink-3); pointer-events: none; }
.toolbar .search .input { padding-left: 38px; }
.toolbar select.input { width: auto; flex: 0 1 auto; }
.bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 10px 12px; border-radius: var(--radius-s); background: var(--ink); color: #fff; font-size: var(--step-small); }
.bulk b { font-variant-numeric: tabular-nums; }
.bulk .grow { flex: 1; }
.bulk .btn.quiet { background: transparent; color: #fff; border-color: rgb(255 255 255 / .35); }
.bulk .btn.quiet:hover { background: rgb(255 255 255 / .1); }
.pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; font-size: var(--step-small); color: var(--ink-2); padding-top: 12px; }
.pager .row { display: flex; gap: 8px; }
.pager .btn { min-width: 40px; padding: 0 10px; }

/* states */
.sk { display: grid; gap: 12px; }
.sk i { display: block; height: 14px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2)); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
.sk i.tall { height: 120px; }
.sk i.mid { height: 44px; }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.state { display: grid; justify-items: start; gap: 10px; padding: 20px; border-radius: var(--radius-s); background: var(--surface-2); color: var(--ink-2); font-size: var(--step-small); }
.state strong { color: var(--ink); font-size: var(--step-body); }
.state.bad { background: var(--bad-bg); color: var(--bad); }
.state.bad strong { color: var(--bad); }
.empty { color: var(--ink-2); font-size: var(--step-small); padding: 16px 12px; }
.offline { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 8px 16px; background: var(--ink); color: #fff; font-size: var(--step-small); }

/* filters, forms */
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink-2); font: 500 var(--step-small)/1 var(--font); cursor: pointer; }
.chip:hover { background: var(--surface-2); }
.chip[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: #fff; }
.chip .n { font-variant-numeric: tabular-nums; opacity: .8; }
.inline { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.inline .grow { flex: 1 1 240px; }
.inline label { display: flex; align-items: center; gap: 8px; color: var(--ink-2); font-size: var(--step-small); }
.inline input[type="number"] { width: 6em; }
.seg { display: inline-flex; background: var(--surface-2); border-radius: var(--radius-s); padding: 3px; gap: 3px; }
.seg button { font: 500 var(--step-small)/1 var(--font); border: 0; background: none; color: var(--ink-2); padding: 9px 14px; border-radius: 5px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--surface); color: var(--ink); box-shadow: var(--shadow); }
.form { display: grid; gap: 16px; max-width: 640px; }
.form .row2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 16px; }
.toggle { display: flex; align-items: flex-start; gap: 12px; font-size: var(--step-small); cursor: pointer; }
.toggle input { margin-top: 2px; }
.toggle b { display: block; color: var(--ink); font-weight: 500; }
.toggle span { color: var(--ink-2); }
.divide { border: 0; border-top: 1px solid var(--surface-2); margin: 4px 0; }
.newlink { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: var(--ok-bg); color: var(--ok); border-radius: var(--radius-s); padding: 12px 14px; }
.newlink code { overflow-wrap: anywhere; flex: 1 1 280px; color: var(--ink); }
.bigcode { font-size: 1.5rem; font-weight: 600; letter-spacing: .06em; white-space: nowrap; user-select: all; font-variant-numeric: tabular-nums; }
.secret { font-size: 1.05rem; letter-spacing: .08em; overflow-wrap: anywhere; user-select: all; }
details summary { cursor: pointer; color: var(--ink-2); font-size: var(--step-small); margin-top: 12px; min-height: 24px; }
.cause { display: grid; gap: 10px; }
.cause + .cause { border-top: 1px solid var(--surface-2); padding-top: 18px; margin-top: 4px; }
.cause header { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: baseline; justify-content: space-between; }
.cause h3 { margin: 0; font-size: var(--step-body); font-weight: 600; }
.cause p { margin: 0; font-size: var(--step-small); color: var(--ink-2); max-width: 75ch; }
.cause .lead { color: var(--ink); font-weight: 500; }
.cause ul { margin: 0; padding-left: 18px; font-size: var(--step-small); color: var(--ink-2); }

/* toasts + dialogs */
.toasts { position: fixed; right: 16px; bottom: 16px; z-index: 50; display: grid; gap: 8px; width: min(380px, calc(100vw - 32px)); }
.toast { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: var(--radius-s); background: var(--ink); color: #fff; font-size: var(--step-small); box-shadow: var(--shadow); animation: enter .3s var(--ease) both; }
.toast.bad { background: var(--bad); }
.toast .grow { flex: 1; }
.toast button { background: none; border: 0; color: #fff; text-decoration: underline; font: 600 var(--step-small)/1 var(--font); cursor: pointer; padding: 2px; min-height: 24px; }
dialog { border: 0; border-radius: 14px; padding: 0; width: min(460px, calc(100vw - 32px)); box-shadow: 0 20px 60px -20px rgb(0 0 0 / .45); color: var(--ink); }
dialog::backdrop { background: rgb(31 26 23 / .45); }
dialog form { display: grid; gap: 14px; padding: 24px; }
dialog h2 { margin: 0; }
dialog p { margin: 0; color: var(--ink-2); font-size: var(--step-small); }
dialog .row { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }

@media (max-width: 960px) {
  .app { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; }
  .rail { position: sticky; top: 0; z-index: 10; height: auto; flex-direction: row; align-items: center; gap: 8px; padding: 8px 10px; overflow-x: auto; scrollbar-width: none; }
  .brandline, .railfoot .stamp, .railfoot .label { display: none; }
  .menu { display: flex; gap: 2px; }
  .menu a { white-space: nowrap; padding: 8px 10px; }
  .menu .label { display: none; }
  .menu a[aria-current="page"] .label { display: inline; }
  .railfoot { margin: 0; display: flex; gap: 2px; padding: 0; }
  .opt { display: none; }
}
@media (max-width: 720px) {
  table.cards thead { display: none; }
  table.cards, table.cards tbody { display: block; width: 100%; }
  table.cards tr { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 14px; padding: 12px 2px; border-bottom: 1px solid var(--surface-2); }
  table.cards tr:last-child { border-bottom: 0; }
  table.cards td { border: 0; padding: 0; display: inline-flex; align-items: baseline; gap: 6px; text-align: left; min-height: 24px; }
  table.cards td[data-label]:not([data-label=""])::before { content: attr(data-label); color: var(--ink-3); font-size: .75rem; }
  table.cards td.main { flex: 1 1 calc(100% - 50px); font-size: var(--step-body); }
  table.cards td.main::before { display: none; }
  table.cards td.pick { width: auto; order: -1; }
  table.cards td.endcell { flex-basis: 100%; }
  table.cards td.endcell .acts { justify-content: flex-start; gap: 18px; }
  table.cards td.clip { max-width: none; min-width: 0; flex-basis: 100%; }
  table.cards td.empty { flex-basis: 100%; }
  table.cards tbody tr:hover td { background: none; }
  table.cards td.opt { display: none; }
  table.cards td.main .sub { display: block; flex-basis: 100%; }
  table.cards td.main { flex-wrap: wrap; }
  .strip i { height: 34px; }
  .strip button span { display: none; }
  .head .inline { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
`;

const SCRIPT = `
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var ICONS = window.__ICONS;
  var state = { data: null, loading: null, updatedAt: 0, view: 'overview', arg: '', params: {} };
  var REFRESH_MS = 60000;
  var DASH = '\\u2014';

  // ---------------------------------------------------------------- helpers
  function text(n, t) { n.textContent = t == null || t === '' ? DASH : String(t); return n; }
  function el(tag, cls, t) { var n = document.createElement(tag); if (cls) n.className = cls; if (t !== undefined) text(n, t); return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function icon(name, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls || 'ic'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name]); s.appendChild(p); return s;
  }
  function when(iso) { if (!iso) return DASH; var d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function day(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : DASH; }
  function ago(ms) { var s = Math.round((Date.now() - ms) / 1000); if (s < 45) return 'just now'; var m = Math.round(s / 60); if (m < 60) return m + ' min ago'; return Math.round(m / 60) + ' h ago'; }
  function num(n) { return n == null ? DASH : Number(n).toLocaleString(); }
  function plural(n, one, many) { return num(n) + ' ' + (n === 1 ? one : many); }
  function tool(n) { return String(n || '').replace(/^teams_/, '').replace(/_/g, ' '); }
  function facts(dl, pairs) { clear(dl); pairs.forEach(function (p) { dl.appendChild(el('dt', '', p[0])); var dd = el('dd'); if (p[1] && p[1].nodeType) dd.appendChild(p[1]); else text(dd, p[1]); dl.appendChild(dd); }); }
  function personLink(p) { var a = el('a', 'open', p.name || 'Unknown person'); a.href = '#person/' + encodeURIComponent(p.key); return a; }
  function td(child, cls) { var t = el('td', cls || ''); if (child && child.nodeType) t.appendChild(child); else text(t, child); return t; }
  function pill(label, kind) { return el('span', 'pill' + (kind ? ' ' + kind : ''), label); }
  function actBtn(label, cls, fn, aria) { var b = el('button', 'act' + (cls ? ' ' + cls : ''), label); b.type = 'button'; if (aria) b.setAttribute('aria-label', aria); b.addEventListener('click', function () { fn.call(b, b); }); return b; }
  function actsCell(buttons) { var t = el('td', 'endcell'); var w = el('div', 'acts'); buttons.forEach(function (b) { if (b) w.appendChild(b); }); t.appendChild(w); return t; }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }
  function qs(o) { return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] != null; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function short(id) { return id.length > 24 ? id.slice(0, 24) + '\\u2026' : id; }
  var TAGS = { team: 'Team', customer: 'Customer', other: 'Other' };
  var STATUS = { member: ['Member', 'ok'], approved: ['Approved', 'ok'], pending: ['Asked to join', 'warn'], review: ['Under review', 'warn'], blocked: ['Blocked', 'bad'] };

  // ---------------------------------------------------------------- feedback: toasts, dialogs, busy buttons, loading
  function toast(msg, bad) {
    var t = el('div', 'toast' + (bad ? ' bad' : '')); t.setAttribute('role', bad ? 'alert' : 'status');
    t.appendChild(icon(bad ? 'alert' : 'check')); t.appendChild(el('span', 'grow', msg));
    $('toasts').appendChild(t); setTimeout(function () { t.remove(); }, bad ? 7000 : 3500);
  }
  function confirmDialog(title, body, okLabel, danger) {
    return new Promise(function (resolve) {
      var d = $('confirm'); text($('confirmTitle'), title); text($('confirmBody'), body);
      var ok = $('confirmOk'); ok.textContent = okLabel || 'Confirm'; ok.className = 'btn' + (danger ? ' danger' : '');
      d.onclose = function () { resolve(d.returnValue === 'ok'); };
      d.returnValue = ''; d.showModal(); $('confirmCancel').focus();
    });
  }
  // A small form in a dialog. fields: [{ id, label, type, value, hint, min, max, maxlength, options }]. validate(values) returns an
  // error string (shown inline, the dialog stays open) or nothing. Resolves with the values, or null when cancelled.
  function askDialog(o) {
    return new Promise(function (resolve) {
      var d = $('ask'), f = clear($('askForm'));
      f.appendChild(el('h2', '', o.title)); if (o.body) f.appendChild(el('p', '', o.body));
      var inputs = {};
      o.fields.forEach(function (x) {
        var lab = el('label', 'field'); lab.appendChild(document.createTextNode(x.label));
        var inp;
        if (x.type === 'select') { inp = el('select', 'input'); x.options.forEach(function (op) { var e = el('option', '', op[1]); e.value = op[0]; inp.appendChild(e); }); }
        else if (x.type === 'textarea') inp = el('textarea', 'input');
        else { inp = el('input', 'input'); inp.type = x.type || 'text'; if (x.type === 'number') inp.inputMode = 'numeric'; }
        if (x.value != null) inp.value = x.value; if (x.placeholder) inp.placeholder = x.placeholder;
        if (x.min != null) inp.min = x.min; if (x.max != null) inp.max = x.max; if (x.maxlength) inp.maxLength = x.maxlength;
        inp.autocomplete = 'off'; inp.setAttribute('aria-label', x.label); inputs[x.id] = inp; lab.appendChild(inp);
        if (x.hint) lab.appendChild(el('span', 'hint', x.hint));
        f.appendChild(lab);
      });
      var err = el('p', 'msg-err'); err.setAttribute('role', 'alert'); f.appendChild(err);
      var row = el('div', 'row'); var cancel = el('button', 'btn quiet', 'Cancel'); cancel.type = 'button';
      var ok = el('button', 'btn' + (o.danger ? ' danger' : ''), o.ok || 'Save'); ok.type = 'submit'; row.appendChild(cancel); row.appendChild(ok); f.appendChild(row);
      var done = false;
      function finish(v) { if (done) return; done = true; d.close(); resolve(v); }
      cancel.onclick = function () { finish(null); };
      d.oncancel = function (e) { e.preventDefault(); finish(null); };
      f.onsubmit = async function (e) {
        e.preventDefault(); var v = {}; Object.keys(inputs).forEach(function (k) { v[k] = inputs[k].value.trim(); inputs[k].removeAttribute('aria-invalid'); });
        var problem = o.validate ? o.validate(v) : null;
        if (problem) { err.textContent = problem[1] || problem; if (problem[0] && inputs[problem[0]] && problem[1]) { inputs[problem[0]].setAttribute('aria-invalid', 'true'); inputs[problem[0]].focus(); } return; }
        if (o.submit) {
          busy(ok, true, 'Saving');
          try { await o.submit(v); } catch (e2) { busy(ok, false); if (e2.status !== 401) err.textContent = e2.message; return; }
          busy(ok, false);
        }
        finish(v);
      };
      d.showModal(); var first = inputs[o.fields[0] && o.fields[0].id]; if (first) { first.focus(); if (first.select) first.select(); }
    });
  }
  function busy(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.dataset.label || btn.textContent; btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      clear(btn); btn.appendChild(el('span', 'spin')); if (label) btn.appendChild(el('span', '', label));
    } else {
      btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = btn.dataset.label || btn.textContent; delete btn.dataset.label;
    }
  }
  function skeleton(box, rows) {
    clear(box); var s = el('div', 'sk'); s.setAttribute('aria-busy', 'true'); s.appendChild(el('span', 'sr', 'Loading'));
    (rows || ['mid', '', '', 'tall', '']).forEach(function (k) { s.appendChild(el('i', k)); }); box.appendChild(s);
  }
  function stateBox(box, title, body, retry, bad) {
    clear(box); var s = el('div', 'state' + (bad ? ' bad' : '')); s.setAttribute('role', bad ? 'alert' : 'status');
    s.appendChild(el('strong', '', title)); if (body) s.appendChild(el('span', '', body));
    if (retry) { var b = el('button', 'btn quiet small', 'Try again'); b.type = 'button'; b.onclick = retry; s.appendChild(b); }
    box.appendChild(s);
  }
  function fieldError(input, msgEl, msg) { input.setAttribute('aria-invalid', 'true'); msgEl.textContent = msg; input.focus(); return false; }
  function fieldOk(input, msgEl) { input.removeAttribute('aria-invalid'); msgEl.textContent = ''; return true; }

  // ---------------------------------------------------------------- network: one place for every status
  function ApiError(status, message, body) { this.status = status; this.message = message; this.body = body; }
  async function api(path, opts) {
    opts = opts || {}; opts.headers = Object.assign({ 'X-Admin': '1' }, opts.headers || {});
    var r;
    try { r = await fetch(path, opts); } catch (e) { throw new ApiError(0, navigator.onLine ? 'The server could not be reached. Check your connection and try again.' : 'You are offline.'); }
    if (r.status === 401) { sessionEnded(); throw new ApiError(401, 'Your session ended.'); }
    var j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) {
      var msg = (j && j.error) || (r.status === 429 ? 'Too many requests. Wait a minute and try again.' : r.status >= 500 ? 'The server had a problem (' + r.status + '). Try again in a moment.' : 'Request failed (' + r.status + ').');
      throw new ApiError(r.status, msg, j);
    }
    return j;
  }
  function post(path, body) { return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  async function act(btn, fn, okMsg, busyLabel) {
    busy(btn, true, busyLabel);
    try { var r = await fn(); if (okMsg) toast(okMsg); return r === undefined ? true : r; }
    catch (e) { if (e.status !== 401) toast(e.message || 'That did not work.', true); return false; }
    finally { busy(btn, false); }
  }

  // ---------------------------------------------------------------- paged lists
  // o: { url(s) -> path, cols: [{ label, cls, sort }], row(item, list) -> [td...], empty(s) -> text, search, key(item),
  //      bulk: [{ action, label, danger }], onBulk(action, keys, list), tools(bar, list), size, rowClass(item) }
  function Paged(o) {
    var s = { page: 1, q: '', items: [], total: 0, picked: {}, extra: o.extra || {}, size: o.size || 10, loaded: false };
    var api_ = { s: s };
    var root = el('div', 'stack tight');
    var bar = el('div', 'toolbar');
    var search = null;
    if (o.search) {
      var sw = el('div', 'search'); sw.appendChild(icon('search'));
      search = el('input', 'input'); search.type = 'search'; search.placeholder = o.search; search.setAttribute('aria-label', o.search); search.autocomplete = 'off';
      search.addEventListener('input', debounce(function () { s.q = search.value.trim(); s.page = 1; load(); }, 300));
      sw.appendChild(search); bar.appendChild(sw);
    }
    if (o.tools) o.tools(bar, api_);
    if (bar.firstChild) root.appendChild(bar);
    var bulkBar = null, bulkCount = null, allBox = null;
    if (o.bulk) {
      bulkBar = el('div', 'bulk'); bulkBar.hidden = true; bulkBar.setAttribute('role', 'region'); bulkBar.setAttribute('aria-label', 'Selected people');
      bulkCount = el('b'); bulkBar.appendChild(bulkCount);
      var g = el('span', 'grow'); bulkBar.appendChild(g);
      o.bulk.forEach(function (b) {
        var btn = el('button', 'btn small ' + (b.danger ? 'danger' : 'quiet'), b.label); btn.type = 'button';
        btn.onclick = function () { o.onBulk(b, Object.keys(s.picked), api_, btn); }; bulkBar.appendChild(btn);
      });
      var none = el('button', 'btn small quiet', 'Clear'); none.type = 'button'; none.onclick = function () { s.picked = {}; render(); }; bulkBar.appendChild(none);
      root.appendChild(bulkBar);
    }
    var wrap = el('div', 'tablewrap'); var table = el('table', 'cards'); var thead = el('thead'); var htr = el('tr');
    if (o.bulk) {
      var th0 = el('th', 'pick'); allBox = el('input', 'check'); allBox.type = 'checkbox'; allBox.setAttribute('aria-label', 'Select everyone on this page');
      allBox.onchange = function () { s.items.forEach(function (it) { if (selectable(it)) { if (allBox.checked) s.picked[o.key(it)] = true; else delete s.picked[o.key(it)]; } }); render(); };
      th0.appendChild(allBox); htr.appendChild(th0);
    }
    o.cols.forEach(function (c) {
      var th = el('th', c.cls || '');
      if (c.sort) {
        var b = el('button', 'sort', c.label); b.type = 'button';
        b.onclick = function () { if (s.extra.sort === c.sort) s.extra.dir = s.extra.dir === 'asc' ? 'desc' : 'asc'; else { s.extra.sort = c.sort; s.extra.dir = c.sort === 'name' ? 'asc' : 'desc'; } s.page = 1; load(); };
        c.btn = b; th.appendChild(b);
      } else if (c.label) text(th, c.label);
      else th.appendChild(el('span', 'sr', 'Actions'));
      htr.appendChild(th);
    });
    thead.appendChild(htr); table.appendChild(thead); var tbody = el('tbody'); table.appendChild(tbody); wrap.appendChild(table); root.appendChild(wrap);
    var pager = el('div', 'pager'); var info = el('span', 'num'); var prow = el('div', 'row');
    var prev = el('button', 'btn quiet small'); prev.type = 'button'; prev.appendChild(icon('prev')); prev.setAttribute('aria-label', 'Previous page');
    var next = el('button', 'btn quiet small'); next.type = 'button'; next.appendChild(icon('next')); next.setAttribute('aria-label', 'Next page');
    prev.onclick = function () { if (s.page > 1) { s.page--; load(); } }; next.onclick = function () { if (s.page * s.size < s.total) { s.page++; load(); } };
    prow.appendChild(prev); prow.appendChild(next); pager.appendChild(info); pager.appendChild(prow); root.appendChild(pager);
    var errBox = el('div'); root.appendChild(errBox);
    function selectable(it) { return !o.canPick || o.canPick(it); }
    var seq = 0;
    async function load(silent) {
      var my = ++seq;
      if (!silent && !s.loaded) { clear(tbody); var tr = el('tr'); var c = el('td'); c.colSpan = 20; skeleton(c, ['', '', '']); tr.appendChild(c); tbody.appendChild(tr); }
      table.setAttribute('aria-busy', 'true');
      try {
        var r = await api(o.url(s));
        if (my !== seq) return;
        s.items = r.items || []; s.total = r.total || 0; s.page = r.page || s.page; s.last = r; s.loaded = true;
        if (s.items.length === 0 && s.page > 1 && s.total > 0) { s.page = Math.ceil(s.total / s.size); return load(silent); }
        clear(errBox); render();
        if (o.onLoad) o.onLoad(r, api_);
      } catch (e) {
        if (my !== seq || e.status === 401) return;
        if (o.onError && o.onError(e, api_)) return;
        clear(tbody); stateBox(errBox, 'This list could not load.', e.message, function () { load(); }, true);
      } finally { if (my === seq) table.removeAttribute('aria-busy'); }
    }
    function render() {
      clear(tbody);
      o.cols.forEach(function (c) { if (c.btn) { if (s.extra.sort === c.sort) { c.btn.setAttribute('aria-sort', s.extra.dir === 'asc' ? 'ascending' : 'descending'); c.btn.textContent = c.label + (s.extra.dir === 'asc' ? ' \\u2191' : ' \\u2193'); } else { c.btn.removeAttribute('aria-sort'); c.btn.textContent = c.label; } } });
      if (!s.items.length) { var tr = el('tr'); var c = el('td', 'empty', o.empty(s)); c.colSpan = 20; tr.appendChild(c); tbody.appendChild(tr); }
      var labels = o.cols.map(function (c) { return c.label || ''; });
      s.items.forEach(function (it) {
        var tr = el('tr', o.rowClass ? o.rowClass(it) : '');
        var key = o.key ? o.key(it) : null;
        if (o.bulk) {
          var pc = el('td', 'pick');
          if (selectable(it)) {
            var cb = el('input', 'check'); cb.type = 'checkbox'; cb.checked = Boolean(s.picked[key]); cb.setAttribute('aria-label', 'Select ' + (it.name || 'this person'));
            cb.onchange = function () { if (cb.checked) s.picked[key] = true; else delete s.picked[key]; tr.classList.toggle('picked', cb.checked); updateBulk(); };
            if (cb.checked) tr.classList.add('picked'); pc.appendChild(cb);
          }
          tr.appendChild(pc);
        }
        o.row(it, api_).forEach(function (cell, i) { cell.setAttribute('data-label', labels[i] || ''); if (o.cols[i] && o.cols[i].cls) cell.classList.add.apply(cell.classList, o.cols[i].cls.split(' ')); if (i === 0) cell.classList.add('main'); tr.appendChild(cell); });
        if (key) tr.dataset.key = key;
        tbody.appendChild(tr);
      });
      var from = s.total ? (s.page - 1) * s.size + 1 : 0, to = Math.min(s.total, s.page * s.size);
      text(info, s.total ? from + '\\u2013' + to + ' of ' + num(s.total) : '');
      pager.hidden = s.total <= s.size && s.page === 1;
      prev.disabled = s.page <= 1; next.disabled = s.page * s.size >= s.total;
      updateBulk();
    }
    function updateBulk() {
      if (!o.bulk) return;
      var n = Object.keys(s.picked).length; bulkBar.hidden = !n; text(bulkCount, n + ' selected');
      var pickable = s.items.filter(selectable);
      allBox.checked = pickable.length > 0 && pickable.every(function (it) { return s.picked[o.key(it)]; });
      allBox.indeterminate = !allBox.checked && pickable.some(function (it) { return s.picked[o.key(it)]; });
    }
    // Optimistic: drop rows at once, then re-read the page once (several quick actions share one re-read).
    var settle = debounce(function () { load(true); if (o.onChange) o.onChange(); }, 700);
    function drop(keys) {
      keys.forEach(function (k) { delete s.picked[k]; });
      var before = s.items.length; s.items = s.items.filter(function (it) { return keys.indexOf(o.key(it)) < 0; });
      s.total = Math.max(0, s.total - (before - s.items.length)); render(); settle();
    }
    function mark(key, on) { var tr = tbody.querySelector('tr[data-key="' + key + '"]'); if (tr) tr.classList.toggle('gone', on); }
    return Object.assign(api_, { el: root, load: load, render: render, drop: drop, mark: mark, settle: settle, search: search });
  }

  // ---------------------------------------------------------------- sign-in and session
  var configured = document.body.getAttribute('data-configured') === '1';
  function showOnly(id) { ['boot', 'signinWrap', 'notset', 'app'].forEach(function (x) { if ($(x)) $(x).hidden = x !== id; }); }
  function sessionEnded() {
    if (!$('app').hidden) { $('signinNote').hidden = false; }
    state.data = null; showOnly('signinWrap'); $('codeField').hidden = true; $('code').value = ''; $('u').focus();
  }
  $('pwToggle').addEventListener('click', function () {
    var show = $('p').type === 'password'; $('p').type = show ? 'text' : 'password';
    this.setAttribute('aria-pressed', String(show)); this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  $('signinForm').addEventListener('submit', async function (e) {
    e.preventDefault(); var btn = $('signinBtn'); $('err').textContent = '';
    if (!$('u').value.trim()) return fieldError($('u'), $('err'), 'Enter your username.');
    if (!$('p').value) return fieldError($('p'), $('err'), 'Enter your password.');
    var needCode = !$('codeField').hidden, code = $('code').value.replace(/ /g, '');
    if (needCode && !/^[0-9]{6}$/.test(code)) return fieldError($('code'), $('err'), 'Enter the 6-digit code from your authenticator app.');
    ['u', 'p', 'code'].forEach(function (x) { $(x).removeAttribute('aria-invalid'); });
    busy(btn, true, 'Signing in');
    try {
      var body = { username: $('u').value.trim(), password: $('p').value }; if (needCode) body.code = code;
      var r = await fetch('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        if (j.needCode) { $('codeField').hidden = false; $('code').value = ''; $('err').textContent = needCode ? j.error : ''; $('code').focus(); return; }
        $('err').textContent = r.status === 429 ? 'Too many attempts. Wait a minute and try again.' : (j.error || 'Sign-in failed.'); $('p').select(); return;
      }
      $('p').value = ''; $('code').value = ''; $('codeField').hidden = true; $('signinNote').hidden = true; await load(true);
    } catch (e2) { $('err').textContent = 'The server could not be reached. Check your connection.'; }
    finally { busy(btn, false); }
  });
  $('out').addEventListener('click', async function () {
    var ok = await confirmDialog('Sign out?', 'This session ends on the server too.', 'Sign out');
    if (!ok) return;
    try { await api('/admin/logout', { method: 'POST' }); } catch (e) {}
    state.data = null; $('signinNote').hidden = true; showOnly('signinWrap');
  });

  // ---------------------------------------------------------------- the shared overview
  async function load(force) {
    if (state.loading && !force) return state.loading;
    var btn = $('refresh'); btn.setAttribute('aria-busy', 'true'); $('refreshIcon').classList.add('spinning');
    state.loading = (async function () {
      try {
        state.data = await api('/admin/api/overview'); state.updatedAt = Date.now();
        showOnly('app'); updateMenu(state.data); route(true);
      } catch (e) {
        if (e.status === 401) return;
        if (!state.data) { showOnly('app'); stateBox($('viewError'), 'The dashboard could not load.', e.message, function () { clear($('viewError')); load(true); }, true); }
        else toast(e.message, true);
      } finally {
        btn.removeAttribute('aria-busy'); $('refreshIcon').classList.remove('spinning'); stamp();
      }
    })();
    try { await state.loading; } finally { state.loading = null; }
  }
  function stamp() { text($('stamp'), state.updatedAt ? 'Updated ' + ago(state.updatedAt) : ''); }
  setInterval(stamp, 20000);
  setInterval(function () { if (!document.hidden && state.data && navigator.onLine && state.view === 'overview') load(true); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.data && state.view === 'overview' && Date.now() - state.updatedAt > REFRESH_MS) load(true); });
  window.addEventListener('offline', function () { $('offline').hidden = false; });
  window.addEventListener('online', function () { $('offline').hidden = true; if (state.data) load(true); });

  function updateMenu(d) {
    setBadge('c-people', d.totals.people); setBadge('c-connections', d.totals.connections);
    setBadge('c-access', (d.access && d.access.waiting) || 0, true);
    setBadge('c-issues', d.issuesToday || 0, true);
    text($('ver'), 'v' + d.version);
  }
  function setBadge(id, n, hot) { var b = $(id); if (!b) return; b.textContent = n ? String(n) : ''; b.hidden = !n; b.className = 'badge' + (hot && n ? ' hot' : ''); }
  async function refreshCounts() { try { var d = await api('/admin/api/overview'); state.data = d; state.updatedAt = Date.now(); updateMenu(d); stamp(); } catch (e) {} }

  // ---------------------------------------------------------------- charts and shared bits
  function cols(box, values, accent) {
    clear(box); var max = Math.max.apply(null, values.map(function (v) { return v.v; }).concat([1]));
    values.forEach(function (v) { var i = el('i', accent && accent(v) ? 'w' : ''); i.style.height = (v.v / max * 100) + '%'; i.title = v.label + ': ' + num(v.v); box.appendChild(i); });
  }
  function heat(box, hours) {
    clear(box); var max = Math.max.apply(null, hours.concat([1]));
    hours.forEach(function (h, i) { var c = el('i'); c.style.opacity = (0.08 + 0.92 * h / max).toFixed(2); c.title = String(i).padStart(2, '0') + ':00 UTC: ' + num(h) + ' requests'; box.appendChild(c); });
  }
  function rank(list, items, emptyMsg) {
    clear(list); if (!items.length) { list.appendChild(el('li', 'empty', emptyMsg || 'Nothing yet.')); return; }
    var max = Math.max.apply(null, items.map(function (x) { return x.v; }).concat([1]));
    items.forEach(function (x) { var li = el('li'); li.appendChild(x.label); var bar = el('i'); bar.style.width = Math.max(3, x.v / max * 100) + '%'; li.appendChild(bar); li.appendChild(el('span', 'n', x.text)); list.appendChild(li); });
  }
  function toolRows(tbody, tools, withPeople) {
    clear(tbody);
    if (!tools.length) { var tr = el('tr'); var c = el('td', 'empty', 'No tool calls in the last 30 days.'); c.colSpan = 6; tr.appendChild(c); tbody.appendChild(tr); return; }
    var labels = ['Tool', 'Calls'].concat(withPeople ? ['People'] : []).concat(['Avg time', 'Avg size', 'Errors']);
    tools.forEach(function (t) {
      var vals = [td(tool(t.name), 'main'), td(num(t.calls), 'num')].concat(withPeople ? [td(num(t.people), 'num')] : [])
        .concat([td(num(t.avgMs) + ' ms', 'num'), td(t.avgKb + ' KB', 'num opt'), td(t.errorRate + '%', 'num')]);
      var tr = el('tr'); vals.forEach(function (v, i) { v.setAttribute('data-label', labels[i]); tr.appendChild(v); }); tbody.appendChild(tr);
    });
  }
  function alertsList(box, alerts, allClear) {
    clear(box);
    if (!alerts.length) { if (allClear) { var ok = el('div', 'allclear'); ok.appendChild(icon('check')); ok.appendChild(el('span', '', 'All clear: nothing needs your attention.')); box.appendChild(ok); } return; }
    alerts.forEach(function (a) {
      var row = el(a.link ? 'a' : 'div', 'alert' + (a.level === 'bad' ? ' bad' : ''));
      if (a.link) row.href = a.link;
      row.appendChild(icon('alert')); row.appendChild(el('span', 'grow', a.text));
      if (a.link) { var w = el('span', 'why', 'Open'); w.appendChild(icon('arrow')); row.appendChild(w); }
      box.appendChild(row);
    });
  }
  function healthStrip(box, days, selected) {
    clear(box);
    days.forEach(function (d) {
      var b = el('button'); b.type = 'button';
      var level = d.total === 0 ? 0 : d.total < 3 ? 1 : d.total < 10 ? 2 : d.total < 30 ? 3 : 4;
      var cell = el('i'); cell.setAttribute('data-level', String(level)); b.appendChild(cell);
      var dt = new Date(d.day + 'T00:00:00Z'); b.appendChild(el('span', '', String(dt.getUTCDate())));
      var parts = Object.keys(d.counts).filter(function (k) { return d.counts[k]; }).map(function (k) { return d.counts[k] + ' ' + k.replace(/_/g, ' '); });
      b.setAttribute('aria-label', day(d.day) + ': ' + (d.total ? parts.join(', ') : 'no issues'));
      b.title = b.getAttribute('aria-label');
      b.setAttribute('aria-pressed', String(selected === d.day));
      b.onclick = function () { location.hash = selected === d.day ? '#issues' : '#issues?day=' + d.day; };
      box.appendChild(b);
    });
  }
  function tabs(box, items, current) {
    clear(box); box.setAttribute('role', 'tablist');
    items.forEach(function (t) {
      var a = el('a'); a.href = t.href; a.setAttribute('role', 'tab'); a.setAttribute('aria-selected', String(t.id === current));
      a.appendChild(el('span', '', t.label));
      if (t.n != null) { var n = el('span', 'n' + (t.hot && t.n ? ' hot' : ''), num(t.n)); a.appendChild(n); }
      box.appendChild(a);
      if (t.id === current && box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, a.offsetLeft - box.offsetLeft - 24);
    });
  }

  // ---------------------------------------------------------------- overview
  function delta(id, pct) {
    var d = $(id); if (!d) return;
    if (pct == null) { d.textContent = 'no data yesterday'; d.className = 'delta'; return; }
    d.textContent = (pct > 0 ? '+' : '') + pct + '% vs yesterday'; d.className = 'delta' + (pct > 0 ? ' up' : pct < 0 ? ' down' : '');
  }
  function renderOverview(d) {
    alertsList($('alerts'), d.alerts, true);
    var k = d.totals;
    [['people', 'People'], ['activeToday', ''], ['active7', ''], ['requestsToday', ''], ['toolCallsToday', ''], ['changesToday', '']]
      .forEach(function (p) { text($('k-' + p[0]), num(k[p[0]])); });
    delta('d-requestsToday', d.vsYesterday.requestsToday); delta('d-toolCallsToday', d.vsYesterday.toolCallsToday); delta('d-changesToday', d.vsYesterday.changesToday);
    if (d.issueDays) healthStrip($('ovStrip'), d.issueDays, null);
    cols($('daily'), d.daily.map(function (x) { return { v: x.requests, label: day(x.day) }; }));
    text($('dailyFrom'), day(d.daily[0] && d.daily[0].day));
    rank($('topPeople'), d.topPeople.map(function (p) { return { label: personLink(p), v: p.share, text: p.share + '%' }; }), 'No usage yet.');
    rank($('topTools'), d.tools.slice(0, 5).map(function (t) { return { label: el('span', '', tool(t.name)), v: t.calls, text: num(t.calls) }; }), 'No tool calls yet.');
    var c = d.cloud, cs = clear($('cloudSummary'));
    if (!c || !c.configured) cs.appendChild(el('p', 'muted', 'Cloud usage is not set up yet. See Usage.'));
    else if (c.error) cs.appendChild(el('p', 'muted', 'Cloudflare analytics could not be read right now.'));
    else {
      cs.appendChild(el('div', 'big', '$' + c.costNow.toFixed(2))); cs.appendChild(el('p', 'muted', 'this month on ' + c.plan));
      var top = c.limits.slice().sort(function (a, b) { return b.percent - a.percent; })[0];
      if (top) { var row = el('div', 'limitrow'); row.style.marginTop = '14px'; row.appendChild(el('span', '', 'Closest free limit: ' + top.label + ', ' + top.percent + '%'));
        var m = el('div', 'meter'); var i = el('i', top.percent >= 80 ? 'hot' : ''); i.style.width = Math.min(100, top.percent) + '%'; m.appendChild(i); row.appendChild(m); cs.appendChild(row); }
    }
  }

  // ---------------------------------------------------------------- issues
  async function renderIssues() {
    var p = state.params, box = $('issuesBody');
    if (!box.firstChild) skeleton(box, ['mid', 'tall', '', '', '']);
    var q = qs({ kind: p.kind, key: p.key, tool: p.tool, day: p.day, page: p.page });
    var r;
    try { r = await api('/admin/api/issues' + (q ? '?' + q : '')); }
    catch (e) { if (e.status !== 401) stateBox(box, 'Issues could not load.', e.message, renderIssues, true); return; }
    if (state.view !== 'issues') return;
    clear(box);

    var stripPanel = el('section', 'panel'); stripPanel.appendChild(el('h2', '', 'Last ' + r.keepDays + ' days'));
    var strip = el('div', 'strip'); healthStrip(strip, r.days, p.day || null); stripPanel.appendChild(strip);
    var lg = el('div', 'legend'); [['var(--ok-bg)', 'No issues'], ['#f6dd9c', '1-2'], ['#eeb04c', '3-9'], ['#d9622f', '10-29'], ['var(--bad)', '30+']].forEach(function (x) { var s = el('span'); var i = el('i'); i.style.background = x[0]; s.appendChild(i); s.appendChild(document.createTextNode(x[1])); lg.appendChild(s); });
    stripPanel.appendChild(lg); box.appendChild(stripPanel);

    var bar = el('div', 'toolbar');
    var chips = el('div', 'chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Kind of issue');
    var counts = {}; r.summary.forEach(function (s) { counts[s.kind] = s.count; });
    var all = el('button', 'chip', 'All'); all.type = 'button'; all.setAttribute('aria-pressed', String(!p.kind)); all.onclick = function () { setParam('kind', null); }; chips.appendChild(all);
    Object.keys(r.kinds).forEach(function (k) {
      if (!counts[k] && p.kind !== k) return;
      var b = el('button', 'chip'); b.type = 'button'; b.appendChild(el('span', '', r.kinds[k].label)); b.appendChild(el('span', 'n', num(counts[k] || 0)));
      b.setAttribute('aria-pressed', String(p.kind === k)); b.onclick = function () { setParam('kind', p.kind === k ? null : k); }; chips.appendChild(b);
    });
    bar.appendChild(chips);
    var active = ['key', 'tool', 'day'].filter(function (k) { return p[k]; });
    active.forEach(function (k) {
      var label = k === 'day' ? day(p.day) : k === 'tool' ? tool(p.tool) : (r.personName || 'One person');
      var c = el('button', 'chip'); c.type = 'button'; c.setAttribute('aria-pressed', 'true'); c.appendChild(el('span', '', label)); c.appendChild(icon('x')); c.setAttribute('aria-label', 'Remove filter: ' + label);
      c.onclick = function () { setParam(k, null); }; bar.appendChild(c);
    });
    box.appendChild(bar);

    var causes = el('section', 'panel'); causes.appendChild(el('h2', '', 'What is causing them'));
    var shown = r.summary.filter(function (s) { return !p.kind || s.kind === p.kind; });
    if (!shown.length) {
      var ok = el('div', 'allclear'); ok.appendChild(icon('check'));
      ok.appendChild(el('span', '', p.kind || active.length ? 'No issues match these filters.' : 'No issues in the last ' + r.keepDays + ' days.'));
      causes.appendChild(ok);
    }
    shown.forEach(function (s) {
      var c = el('article', 'cause');
      var h = el('header'); h.appendChild(el('h3', '', s.label));
      h.appendChild(pill(plural(s.count, 'event', 'events') + (s.today ? ', ' + s.today + ' today' : ''), s.kind === 'admin_signin_failed' || s.kind === 'access_denied' ? 'bad' : 'warn')); c.appendChild(h);
      if (s.cause) c.appendChild(el('p', 'lead', 'Main cause: ' + s.cause + '. Last seen ' + when(s.lastAt) + '.'));
      c.appendChild(el('p', '', s.means));
      if (s.details.length) { var ul = el('ul'); s.details.forEach(function (x) { ul.appendChild(el('li', '', x.value + (x.count > 1 ? ' (' + x.count + '\\u00d7)' : ''))); }); c.appendChild(ul); }
      if (s.people.length > 1 || s.tools.length > 1) {
        var who = el('p'); who.appendChild(document.createTextNode('By person: '));
        s.people.forEach(function (x, i) { if (i) who.appendChild(document.createTextNode(', ')); if (x.key) { var a = el('a', '', x.name + ' ' + x.count); a.href = '#issues?kind=' + s.kind + '&key=' + x.key; who.appendChild(a); } else who.appendChild(document.createTextNode('unknown ' + x.count)); });
        if (s.tools.length) { who.appendChild(document.createTextNode('. By tool: ')); s.tools.forEach(function (x, i) { if (i) who.appendChild(document.createTextNode(', ')); var a = el('a', '', tool(x.value) + ' ' + x.count); a.href = '#issues?kind=' + s.kind + '&tool=' + x.value; who.appendChild(a); }); }
        c.appendChild(who);
      }
      var what = el('p'); what.appendChild(el('strong', '', 'What to do: ')); what.appendChild(document.createTextNode(s.action)); c.appendChild(what);
      causes.appendChild(c);
    });
    box.appendChild(causes);

    var list = el('section', 'panel'); list.appendChild(el('h2', '', 'Events'));
    var wrap = el('div', 'tablewrap'); var t = el('table', 'cards');
    var thead = el('thead'); var htr = el('tr'); ['When', 'Issue', 'Person', 'Tool', 'Details'].forEach(function (h, i) { htr.appendChild(el('th', i === 3 ? 'opt' : '', h)); }); thead.appendChild(htr); t.appendChild(thead);
    var tb = el('tbody'); t.appendChild(tb); wrap.appendChild(t); list.appendChild(wrap);
    if (!r.events.length) { var er = el('tr'); var ec = el('td', 'empty', 'No events match these filters.'); ec.colSpan = 5; er.appendChild(ec); tb.appendChild(er); }
    r.events.forEach(function (e) {
      var who = e.key ? personLink({ key: e.key, name: e.person }) : el('span', 'faint', 'Unknown');
      var tr = el('tr'); var dc = el('td', 'clip'); dc.appendChild(el('span', '', e.detail || DASH)); dc.title = e.detail || '';
      [[td(when(e.at), 'nw main'), 'When'], [td(pill(e.label, e.kind === 'admin_signin_failed' || e.kind === 'access_denied' ? 'bad' : 'warn')), 'Issue'], [td(who, 'nw'), 'Person'], [td(e.tool ? tool(e.tool) : DASH, 'opt'), 'Tool'], [dc, 'Details']]
        .forEach(function (x) { x[0].setAttribute('data-label', x[1]); tr.appendChild(x[0]); });
      tb.appendChild(tr);
    });
    if (r.total > r.size) {
      var pg = el('div', 'pager'); var from = (r.page - 1) * r.size + 1; pg.appendChild(el('span', 'num', from + '\\u2013' + Math.min(r.total, r.page * r.size) + ' of ' + num(r.total)));
      var row = el('div', 'row');
      var pv = el('button', 'btn quiet small'); pv.type = 'button'; pv.appendChild(icon('prev')); pv.setAttribute('aria-label', 'Previous page'); pv.disabled = r.page <= 1; pv.onclick = function () { setParam('page', String(r.page - 1), true); };
      var nx = el('button', 'btn quiet small'); nx.type = 'button'; nx.appendChild(icon('next')); nx.setAttribute('aria-label', 'Next page'); nx.disabled = r.page * r.size >= r.total; nx.onclick = function () { setParam('page', String(r.page + 1), true); };
      row.appendChild(pv); row.appendChild(nx); pg.appendChild(row); list.appendChild(pg);
    }
    box.appendChild(list);
  }
  function setParam(k, v, keepPage) {
    var p = Object.assign({}, state.params); if (v) p[k] = v; else delete p[k];
    if (!keepPage && k !== 'page') delete p.page;
    var q = qs(p);
    location.hash = '#issues' + (q ? '?' + q : '');
  }

  // ---------------------------------------------------------------- people
  var peopleList = null;
  function renderPeople() {
    if (peopleList) return peopleList.load(true);
    var tagChips = el('div', 'chips'); tagChips.setAttribute('role', 'group'); tagChips.setAttribute('aria-label', 'Filter by tag');
    peopleList = Paged({
      search: 'Search by name, organisation or app', extra: { sort: 'requests', dir: 'desc', tag: '' },
      url: function (s) { return '/admin/api/people?' + qs({ page: s.page, q: s.q, sort: s.extra.sort, dir: s.extra.dir, tag: s.extra.tag }); },
      key: function (p) { return p.key; },
      cols: [{ label: 'Person', sort: 'name' }, { label: 'Tag' }, { label: 'Apps', cls: 'opt' }, { label: 'Requests', cls: 'num', sort: 'requests' }, { label: 'Tool calls', cls: 'num', sort: 'toolCalls' },
        { label: 'Changes', cls: 'num opt', sort: 'changes' }, { label: 'Errors', cls: 'num opt', sort: 'errors' }, { label: 'Last active', sort: 'lastActive' }],
      row: function (p) {
        var name = el('td'); name.appendChild(personLink(p)); if (p.org) name.appendChild(el('span', 'sub', p.org));
        return [name, td(p.tag ? pill(TAGS[p.tag]) : DASH), td(p.apps.join(', ') || DASH), td(num(p.totals.requests)), td(num(p.totals.toolCalls)), td(num(p.totals.changes)), td(num(p.totals.errors)), td(when(p.lastActive), 'nw')];
      },
      empty: function (s) { return s.q || s.extra.tag ? 'Nobody matches.' : 'No usage in the last 30 days. People appear here after their first tool call.'; },
      tools: function (bar) { bar.appendChild(tagChips); },
      onLoad: function (r, list) {
        clear(tagChips);
        [['', 'All', r.all]].concat(Object.keys(TAGS).map(function (t) { return [t, TAGS[t], r.counts[t]]; })).forEach(function (x) {
          var b = el('button', 'chip'); b.type = 'button'; b.appendChild(el('span', '', x[1])); b.appendChild(el('span', 'n', num(x[2] || 0)));
          b.setAttribute('aria-pressed', String((list.s.extra.tag || '') === x[0])); b.onclick = function () { list.s.extra.tag = x[0]; list.s.page = 1; list.load(); };
          tagChips.appendChild(b);
        });
        text($('privacy'), r.privacy);
      },
    });
    $('peopleBody').appendChild(peopleList.el); peopleList.load();
  }

  // ---------------------------------------------------------------- one person
  function accessActions(status) {
    if (status === 'pending') return [['approve', 'Approve'], ['block', 'Block']];
    if (status === 'review') return [['approve', 'Approve'], ['remove', 'Remove']];
    if (status === 'member' || status === 'approved') return [['remove', 'Remove'], ['block', 'Block']];
    if (status === 'blocked') return [['unblock', 'Unblock']];
    return [['approve', 'Approve'], ['block', 'Block']];
  }
  var ACTION_TEXT = {
    approve: [null, null, 'approved'],
    block: ['Block ', 'Their connections end now and they cannot ask again.', 'blocked'],
    remove: ['Remove ', 'Their connections end now. They can ask again, or get in through a group.', 'removed'],
    unblock: [null, null, 'unblocked'],
  };
  async function decideOne(key, name, action, btn) {
    var t = ACTION_TEXT[action];
    if (t[0] && !await confirmDialog(t[0] + (name || 'this person') + '?', t[1], action.charAt(0).toUpperCase() + action.slice(1), true)) return false;
    return act(btn, function () { return post('/admin/api/access/people/' + key + '/' + action); }, (name || 'Person') + ' ' + t[2] + '.');
  }
  async function renderPerson(key) {
    var box = $('personBody'); skeleton(box); text($('pName'), 'Loading person'); $('pTag').hidden = true;
    var d;
    try { d = await api('/admin/api/person/' + encodeURIComponent(key)); }
    catch (e) { if (e.status !== 401) { text($('pName'), 'Person'); stateBox(box, e.status === 404 ? 'This person is not known to the server.' : 'This person could not load.', e.status === 404 ? 'They have no usage, connections or access record.' : e.message, e.status === 404 ? null : function () { renderPerson(key); }, e.status !== 404); } return; }
    if (state.view !== 'person') return;
    var p = d.person, isAccount = /^[0-9a-f]{64}$/.test(key); clear(box);
    text($('pName'), p.name || 'Unknown person'); document.title = (p.name || 'Person') + ' \\u00b7 Admin';
    if (d.meta.tag) { $('pTag').hidden = false; text($('pTag'), TAGS[d.meta.tag]); }
    $('pIssues').href = '#issues?key=' + encodeURIComponent(key);
    box.appendChild($('personTpl').content.cloneNode(true));

    // access
    var acc = d.access, ab = $('pAccess');
    if (!isAccount) { ab.appendChild(el('p', 'muted', 'This connection was made before the server knew the Teams account, so access is managed per connection.')); }
    else {
      var st = acc ? STATUS[acc.status] : null;
      var line = el('div', 'inline'); line.appendChild(st ? pill(st[0], st[1]) : pill('No access record'));
      if (acc) line.appendChild(el('span', 'muted', via(acc.via) + ', since ' + day(acc.since)));
      ab.appendChild(line);
      var btns = el('div', 'inline'); btns.style.marginTop = '14px';
      accessActions(acc && acc.status).forEach(function (a) {
        var b = el('button', 'btn small ' + (a[0] === 'block' || a[0] === 'remove' ? 'danger' : a[0] === 'approve' ? '' : 'quiet'), a[1]); b.type = 'button';
        b.onclick = async function () { if (await decideOne(key, p.name, a[0], b)) { refreshCounts(); renderPerson(key); } };
        btns.appendChild(b);
      });
      ab.appendChild(btns);
    }

    // details
    var m = d.meta; $('mTag').value = m.tag || ''; $('mOrg').value = m.org || ''; $('mNote').value = m.note || '';
    $('metaForm').hidden = !isAccount; $('metaNo').hidden = isAccount;
    $('metaForm').onsubmit = async function (e) {
      e.preventDefault();
      if ($('mOrg').value.length > 80) return fieldError($('mOrg'), $('mMsg'), 'Keep the organisation under 80 characters.');
      if ($('mNote').value.length > 500) return fieldError($('mNote'), $('mMsg'), 'Keep the note under 500 characters.');
      fieldOk($('mOrg'), $('mMsg'));
      var r = await act($('mSave'), function () { return post('/admin/api/person/' + key + '/meta', { tag: $('mTag').value || null, org: $('mOrg').value, note: $('mNote').value }); }, 'Details saved.', 'Saving');
      if (r && r.meta) { $('pTag').hidden = !r.meta.tag; if (r.meta.tag) text($('pTag'), TAGS[r.meta.tag]); }
    };

    // connections
    var cb = clear($('pConn'));
    if (!d.connections.length) { var er = el('tr'); var ec = el('td', 'empty', 'No connections.'); ec.colSpan = 4; er.appendChild(ec); cb.appendChild(er); }
    d.connections.forEach(function (c) {
      var tr = el('tr');
      var end = actBtn('End', 'bad', async function (b) {
        if (!await confirmDialog('End this connection?', (c.app || 'The app') + ' will need to sign in again.', 'End connection', true)) return;
        if (await act(b, function () { return post('/admin/api/connections/' + c.id + '/end'); }, 'Connection ended.')) { tr.remove(); refreshCounts(); }
      }, 'End connection for ' + (c.app || 'unknown app'));
      [[td(c.app || 'Unknown app', 'main'), 'App'], [td(when(c.lastUsedAt), 'nw'), 'Last used'], [td(c.toolsUpToDate ? pill('Up to date', 'ok') : pill('Needs refresh', 'warn')), 'Tools'], [actsCell([end]), '']]
        .forEach(function (x) { x[0].setAttribute('data-label', x[1]); tr.appendChild(x[0]); });
      cb.appendChild(tr);
    });
    $('pEnd').hidden = !d.connections.length;
    $('pEnd').onclick = async function () {
      if (!await confirmDialog('End all connections for ' + (p.name || 'this person') + '?', 'Every app they connected will need to sign in again.', 'End all', true)) return;
      var r2 = await act($('pEnd'), function () { return post('/admin/api/person/' + encodeURIComponent(key) + '/end'); }, null, 'Ending');
      if (r2) { toast('Ended ' + plural(r2.ended || 0, 'connection', 'connections') + '.'); clear($('pConn')); $('pEnd').hidden = true; refreshCounts(); }
    };

    // limit
    text($('pCapToday'), p.today.changes + ' of ' + p.dailyCap + ' changes used today (' + p.capUsedToday + '%)');
    var mi = $('pCapMeter'); mi.style.width = Math.min(100, p.capUsedToday) + '%'; mi.className = p.capUsedToday >= 80 ? 'hot' : '';
    $('pCap').value = d.capOverride == null ? '' : d.capOverride; $('pCap').placeholder = 'Default ' + d.defaultCap;
    $('pCapForm').hidden = !isAccount;
    $('pCapForm').onsubmit = async function (e) {
      e.preventDefault(); var v = $('pCap').value.trim();
      if (v !== '' && (!/^[0-9]+$/.test(v) || Number(v) > 5000)) return fieldError($('pCap'), $('pCapMsg'), 'Enter a whole number from 0 to 5000, or leave it empty for the default.');
      fieldOk($('pCap'), $('pCapMsg'));
      await act($('pCapSave'), function () { return post('/admin/api/person/' + encodeURIComponent(key) + '/limit', { dailyWrites: v === '' ? null : Number(v) }); }, v === '' ? 'Back to the default limit.' : 'Saved: ' + v + ' changes a day.', 'Saving');
    };
    $('pCsv').href = '/admin/api/person/' + encodeURIComponent(key) + '/csv';

    // usage
    $('pUsage').hidden = d.noUsage; $('pNoUsage').hidden = !d.noUsage;
    if (d.noUsage) return;
    [['pReq', p.totals.requests], ['pTools', p.totals.toolCalls], ['pChanges', p.totals.changes], ['pSearch', p.totals.searches]].forEach(function (x) { text($(x[0]), num(x[1])); });
    facts($('pFacts'), [['First connected', day(p.firstConnected)], ['Last active', when(p.lastActive)], ['Active days (30)', p.activeDays], ['Apps', p.apps.join(', ')],
      ['Share of all requests', p.share + '%'], ['Data returned to Claude', num(p.totals.kb) + ' KB'], ['Calls to Microsoft', num(p.totals.teamsCalls)],
      ['Errors', num(p.totals.errors)], ['Refused by limits', num(p.totals.rateLimited)], ['Slowed down by Microsoft', num(p.totals.throttled)],
      ['Average tool time', (p.totals.toolCalls ? Math.round(p.totals.ms / p.totals.toolCalls) : 0) + ' ms']]);
    cols($('pDaily'), d.daily.map(function (x) { return { v: x.toolCalls, label: day(x.day), w: x.changes }; }), function (v) { return v.w > 0; });
    heat($('pHours'), d.hours);
    toolRows($('pToolTable'), d.tools, false);
  }
  function via(v) {
    v = v || '';
    if (v.indexOf('group:') === 0) return 'Through a Teams group';
    if (v.indexOf('invite:') === 0) return 'Invite' + (v.length > 7 ? ': ' + v.slice(7) : '');
    return { admin: 'Approved by you', 'admin account': 'Your admin account', 'allow-list': 'Allow-list', 'connected before': 'Connected before access was restricted', 'left group': 'Left their group' }[v] || 'Asked to join';
  }

  // ---------------------------------------------------------------- access
  var access = { summary: null, lists: {}, tab: null };
  var ACCESS_TABS = [
    { id: 'requests', label: 'Requests', count: 'requests', hot: true },
    { id: 'review', label: 'Under review', count: 'review', hot: true },
    { id: 'groups', label: 'Groups', count: 'groups' },
    { id: 'invites', label: 'Invites', count: 'invitesActive' },
    { id: 'allowed', label: 'People with access', count: 'allowed' },
    { id: 'blocked', label: 'Blocked', count: 'blocked' },
  ];
  async function loadAccessSummary() {
    try { access.summary = await api('/admin/api/access/summary'); } catch (e) { if (e.status !== 401) toast(e.message, true); return null; }
    var a = access.summary;
    $('modeRestricted').setAttribute('aria-pressed', String(a.restricted)); $('modeOpen').setAttribute('aria-pressed', String(!a.restricted));
    text($('modeNote'), a.restricted
      ? 'Restricted' + (a.restrictedSince ? ' since ' + day(a.restrictedSince) : '') + ': members of your groups, invited and approved people can connect. Everyone else is refused, nothing of theirs is stored, and they wait under Requests.'
      : 'Open: any personal Microsoft account can connect to this server.');
    renderMe(a.teams);
    drawAccessTabs();
    setBadge('c-access', a.counts.requests + a.counts.review, true);
    return a;
  }
  function drawAccessTabs() {
    var c = access.summary ? access.summary.counts : {};
    tabs($('accessTabs'), ACCESS_TABS.map(function (t) { return { id: t.id, label: t.label, href: '#access/' + t.id, n: c[t.count], hot: t.hot }; }), access.tab);
  }
  var accessWired = false;
  function renderAccess(arg) {
    var tab = ACCESS_TABS.some(function (t) { return t.id === arg; }) ? arg : null;
    if (!accessWired) { wireAccess(); accessWired = true; }
    var first = !access.summary;
    var p = loadAccessSummary();
    if (!tab) {
      if (!first) tab = 'requests';
      else return p.then(function (a) { var c = a ? a.counts : {}; location.replace('#access/' + (c.requests ? 'requests' : c.review ? 'review' : 'groups')); });
    }
    access.tab = tab; drawAccessTabs();
    var body = $('accessPane');
    Array.prototype.forEach.call(body.children, function (n) { n.hidden = true; });
    var pane = $('pane-' + tab);
    if (!pane) { pane = el('div', 'stack tight'); pane.id = 'pane-' + tab; body.appendChild(pane); buildPane(tab, pane); }
    else if (access.lists[tab]) access.lists[tab].load(true);
    pane.hidden = false;
  }
  function afterAccessChange() { loadAccessSummary(); refreshCounts(); }
  var BULK = {
    requests: [{ action: 'approve', label: 'Approve' }, { action: 'block', label: 'Block', danger: true }],
    review: [{ action: 'approve', label: 'Approve' }, { action: 'remove', label: 'Remove', danger: true }],
    allowed: [{ action: 'remove', label: 'Remove', danger: true }, { action: 'block', label: 'Block', danger: true }],
    blocked: [{ action: 'unblock', label: 'Unblock' }],
  };
  var NOTES = {
    requests: 'People who tried to connect and were refused. Approving lets them in at their next sign-in.',
    review: 'People who connected before access was restricted. Their connections still work until you decide.',
    allowed: 'Everyone who can connect, and how they got in.',
    blocked: 'Blocked people cannot connect or ask again.',
  };
  function buildPane(tab, pane) {
    if (tab === 'groups') return buildGroups(pane);
    if (tab === 'invites') return buildInvites(pane);
    pane.appendChild(el('p', 'muted', NOTES[tab]));
    var list = Paged({
      search: 'Search by name or organisation',
      url: function (s) { return '/admin/api/access/people?' + qs({ status: tab, page: s.page, q: s.q }); },
      key: function (p) { return p.key; },
      canPick: function (p) { return !p.you; },
      cols: tab === 'requests' ? [{ label: 'Person' }, { label: 'Why' }, { label: 'Tries', cls: 'num opt' }, { label: 'When' }, { label: '' }]
        : tab === 'review' ? [{ label: 'Person' }, { label: 'Connections', cls: 'num' }, { label: 'Since' }, { label: '' }]
        : tab === 'allowed' ? [{ label: 'Person' }, { label: 'How' }, { label: 'Connections', cls: 'num opt' }, { label: 'Since', cls: 'opt' }, { label: '' }]
        : [{ label: 'Person' }, { label: 'Since' }, { label: '' }],
      row: function (p, l) {
        var name = el('td'); name.appendChild(personLink(p)); if (p.you) name.appendChild(el('span', 'faint', ' (you)'));
        if (p.org || p.tag) name.appendChild(el('span', 'sub', [p.tag ? TAGS[p.tag] : '', p.org || ''].filter(Boolean).join(', ')));
        var btns = p.you ? [] : accessActions(p.status).map(function (a) {
          return actBtn(a[1], a[0] === 'block' || a[0] === 'remove' ? 'bad' : '', async function (b) {
            l.mark(p.key, true);
            if (await decideOne(p.key, p.name, a[0], b)) { l.drop([p.key]); access.summary.counts[tab === 'requests' ? 'requests' : tab] = Math.max(0, (access.summary.counts[tab] || 1) - 1); drawAccessTabs(); }
            else l.mark(p.key, false);
          }, a[1] + ' ' + (p.name || 'this person'));
        });
        if (tab === 'requests') return [name, td(p.via === 'left group' ? 'Left their group' : 'Asked to join'), td(num(p.attempts)), td(when(p.requestedAt || p.updatedAt), 'nw'), actsCell(btns)];
        if (tab === 'review') return [name, td(num(p.connections)), td(day(p.updatedAt), 'nw'), actsCell(btns)];
        if (tab === 'allowed') return [name, td(p.groupName ? 'Group: ' + p.groupName : via(p.via)), td(num(p.connections)), td(day(p.updatedAt), 'nw'), actsCell(btns)];
        return [name, td(day(p.updatedAt), 'nw'), actsCell(btns)];
      },
      empty: function (s) { return s.q ? 'Nobody matches "' + s.q + '".' : { requests: 'Nobody is waiting.', review: 'Nobody is under review.', allowed: 'Nobody has access yet.', blocked: 'Nobody is blocked.' }[tab]; },
      bulk: BULK[tab],
      onBulk: async function (b, keys, l, btn) {
        if (b.danger && !await confirmDialog(b.label + ' ' + plural(keys.length, 'person', 'people') + '?', ACTION_TEXT[b.action][1], b.label, true)) return;
        keys.forEach(function (k) { l.mark(k, true); });
        var r = await act(btn, function () { return post('/admin/api/access/bulk', { keys: keys, action: b.action }); }, null, 'Working');
        if (!r) { keys.forEach(function (k) { l.mark(k, false); }); return; }
        toast(plural(r.done, 'person', 'people') + ' ' + ACTION_TEXT[b.action][2] + '.' + (r.failed ? ' ' + r.failed + ' skipped: ' + r.reason : ''), Boolean(r.failed));
        l.drop(keys); afterAccessChange();
      },
      onChange: afterAccessChange,
    });
    access.lists[tab] = list; pane.appendChild(list.el); list.load();
  }

  // groups tab: the access groups, plus a picker of the admin's own group chats
  function buildGroups(pane) {
    pane.appendChild(el('p', 'muted', 'Members of these group chats get in automatically and are re-checked daily; leaving the group ends their access.'));
    var list = Paged({
      search: 'Search access groups',
      url: function (s) { return '/admin/api/access/groups?' + qs({ page: s.page, q: s.q }); },
      key: function (g) { return g.id; },
      cols: [{ label: 'Group' }, { label: 'People in', cls: 'num' }, { label: 'Added', cls: 'opt' }, { label: '' }],
      row: function (g, l) {
        var name = el('td'); var a = el('a', 'open', g.name || 'Unnamed group'); a.href = '#group/' + encodeURIComponent(g.id); name.appendChild(a);
        return [name, td(num(g.members)), td(day(g.addedAt), 'nw'), actsCell([
          actBtn('Rename', '', function (b) { renameGroupDialog(g, function () { l.load(true); }); }, 'Rename ' + (g.name || 'group')),
          actBtn('Remove', 'bad', async function (b) { if (await removeGroup(g, b)) { l.drop([g.id]); if (picker) picker.load(true); } }, 'Remove ' + (g.name || 'group')),
        ])];
      },
      empty: function (s) { return s.q ? 'No access group matches.' : 'No access groups yet. Add one from your group chats below.'; },
      onChange: afterAccessChange,
    });
    access.lists.groups = list;
    var p1 = el('section', 'panel'); p1.appendChild(list.el); pane.appendChild(p1);

    var p2 = el('section', 'panel'); var h = el('div', 'panelhead'); h.appendChild(el('h2', '', 'Add from your group chats')); var note = el('span', 'muted'); note.setAttribute('role', 'status'); h.appendChild(note); p2.appendChild(h);
    var needLink = el('p', 'muted', 'Link your Teams account (above) to search and add the group chats you are in.'); needLink.hidden = true; p2.appendChild(needLink);
    var picker = Paged({
      search: 'Search your group chats',
      url: function (s) { return '/admin/api/access/my-groups?' + qs({ page: s.page, q: s.q, refresh: s.extra.refresh ? '1' : '' }); },
      key: function (g) { return g.id; },
      cols: [{ label: 'Group chat' }, { label: 'Last active' }, { label: '' }],
      row: function (g, l) {
        var t = el('td'); t.appendChild(el('span', '', g.title || 'Untitled group')); if (!g.title && g.lastFrom) t.appendChild(el('span', 'sub', 'Last message from ' + g.lastFrom));
        return [t, td(when(g.lastActive), 'nw'), g.added ? actsCell([pill('Added', 'ok')]) : actsCell([actBtn('Add', '', async function (b) {
          if (await addGroup({ conversationId: g.id, name: g.title || '' }, b)) { g.added = true; l.render(); list.load(true); afterAccessChange(); }
        }, 'Add ' + (g.title || 'group'))])];
      },
      empty: function (s) { return s.q ? 'No group chat matches "' + s.q + '".' : 'No group chats found.'; },
      tools: function (bar, l) {
        var b = el('button', 'btn quiet'); b.type = 'button'; b.appendChild(icon('refresh')); b.appendChild(el('span', '', 'Reload from Teams'));
        b.onclick = async function () { l.s.extra.refresh = true; busy(b, true, 'Reloading'); await l.load(true); l.s.extra.refresh = false; busy(b, false); };
        bar.appendChild(b);
      },
      onLoad: function (r, l) { needLink.hidden = true; l.el.hidden = false; text(note, 'You are in ' + plural(r.all, 'group chat', 'group chats') + (r.fetchedAt ? '. Read from Teams ' + when(r.fetchedAt) + '.' : '.')); },
      onError: function (e, l) { if (e.status === 409) { l.el.hidden = true; needLink.hidden = false; note.textContent = ''; return true; } return false; },
    });
    picker.el.hidden = true; p2.appendChild(picker.el);
    var det = el('details'); det.appendChild(el('summary', '', 'Add by chat id'));
    var f = el('form', 'inline'); f.noValidate = true; f.style.marginTop = '10px';
    var gid = el('input', 'input grow'); gid.placeholder = '19:...@thread.v2'; gid.setAttribute('aria-label', 'Group chat id'); gid.spellcheck = false; gid.autocomplete = 'off';
    var gname = el('input', 'input'); gname.placeholder = 'Name (optional)'; gname.setAttribute('aria-label', 'Group name'); gname.style.cssText = 'width:auto;flex:1 1 160px'; gname.maxLength = 80;
    var gbtn = el('button', 'btn quiet', 'Add group'); gbtn.type = 'submit';
    var gmsg = el('p', 'msg-err'); gmsg.setAttribute('role', 'alert'); gmsg.style.marginTop = '8px';
    f.appendChild(gid); f.appendChild(gname); f.appendChild(gbtn); det.appendChild(f); det.appendChild(gmsg); p2.appendChild(det);
    f.onsubmit = async function (e) {
      e.preventDefault(); var id = gid.value.trim();
      if (!/^19:[A-Za-z0-9_.-]+@thread[.](v2|skype)$/.test(id)) return fieldError(gid, gmsg, 'That is not a group chat id. It looks like 19:...@thread.v2.');
      fieldOk(gid, gmsg);
      if (await addGroup({ conversationId: id, name: gname.value.trim() }, gbtn)) { gid.value = ''; gname.value = ''; list.load(true); picker.load(true); afterAccessChange(); }
    };
    pane.appendChild(p2);
    list.load(); picker.load();
    access.picker = picker;
  }
  async function addGroup(body, btn) {
    try { busy(btn, true); await post('/admin/api/access/groups', body); toast('Group added.'); return true; }
    catch (e) {
      if (e.status === 409 && e.body && e.body.notMember) {
        busy(btn, false);
        if (!await confirmDialog('You are not in this group chat', e.message, 'Add anyway', true)) return false;
        return act(btn, function () { return post('/admin/api/access/groups', Object.assign({ force: true }, body)); }, 'Group added.');
      }
      if (e.status !== 401) toast(e.message, true); return false;
    } finally { busy(btn, false); }
  }
  async function removeGroup(g, btn) {
    if (!await confirmDialog('Remove ' + (g.name || 'this group') + '?', 'Its members lose access at their next daily check, unless another group or an approval lets them in.', 'Remove group', true)) return false;
    var ok = await act(btn, function () { return post('/admin/api/access/groups/remove', { conversationId: g.id }); }, 'Group removed.');
    if (ok) afterAccessChange();
    return ok;
  }
  function renameGroupDialog(g, done) {
    askDialog({
      title: 'Rename group', fields: [{ id: 'name', label: 'Name', value: g.name || '', maxlength: 80, hint: 'Only shown here. The Teams chat keeps its own name.' }],
      validate: function (v) { return v.name ? null : ['name', 'Give the group a name.']; },
      submit: function (v) { return post('/admin/api/access/groups/rename', { conversationId: g.id, name: v.name }); },
    }).then(function (v) { if (v) { toast('Group renamed.'); g.name = v.name; done(v.name); } });
  }

  // invites tab
  function buildInvites(pane) {
    var p1 = el('section', 'panel'); p1.appendChild(el('h2', '', 'New invite link'));
    p1.appendChild(el('p', 'muted', 'For people outside your groups, such as customers. Whoever signs in through the link has access until you remove them.'));
    var f = el('form', 'inline'); f.noValidate = true; f.style.marginTop = '12px';
    var lab = el('input', 'input grow'); lab.placeholder = 'Label, for example Acme team'; lab.setAttribute('aria-label', 'Invite label'); lab.maxLength = 80;
    function numField(label, v, max) { var l = el('label'); l.appendChild(document.createTextNode(label + ' ')); var i = el('input', 'input'); i.type = 'number'; i.min = 1; i.max = max; i.value = v; i.inputMode = 'numeric'; l.appendChild(i); f.appendChild(l); return i; }
    f.appendChild(lab); var uses = numField('Uses', 1, 500), days = numField('Days', 7, 30);
    var mk = el('button', 'btn quiet', 'Create link'); mk.type = 'submit'; f.appendChild(mk); p1.appendChild(f);
    var msg = el('p', 'msg-err'); msg.setAttribute('role', 'alert'); msg.style.marginTop = '8px'; p1.appendChild(msg);
    var nl = el('div', 'newlink'); nl.hidden = true; nl.style.marginTop = '12px'; var code = el('code'); var cp = el('button', 'btn small'); cp.type = 'button'; cp.appendChild(icon('copy')); cp.appendChild(el('span', '', 'Copy link'));
    nl.appendChild(code); nl.appendChild(cp); nl.appendChild(el('span', '', 'Shown once. Send it to the people you invite.')); p1.appendChild(nl);
    cp.onclick = function () { navigator.clipboard.writeText(code.textContent).then(function () { toast('Invite link copied.'); }, function () { toast('Copy failed: select the link and copy it.', true); }); };
    pane.appendChild(p1);
    var stateChips = el('div', 'chips'); stateChips.setAttribute('role', 'group'); stateChips.setAttribute('aria-label', 'Show invites');
    var list = Paged({
      search: 'Search by label', extra: { state: 'active' },
      url: function (s) { return '/admin/api/access/invites?' + qs({ state: s.extra.state, page: s.page, q: s.q }); },
      key: function (i) { return i.id; },
      cols: [{ label: 'Label' }, { label: 'Uses left', cls: 'num' }, { label: 'Used', cls: 'num' }, { label: 'Ends' }, { label: '' }],
      row: function (i, l) {
        return [td(i.label || 'No label'), td(num(i.usesLeft)), td(num(i.used)), td(i.active ? day(i.expiresAt) : pill('Ended'), 'nw'), actsCell([
          actBtn('Edit', '', function () { editInviteDialog(i, function () { l.load(true); afterAccessChange(); }); }, 'Edit invite ' + (i.label || '')),
          i.active ? actBtn('Revoke', 'bad', async function (b) {
            if (!await confirmDialog('Revoke this invite link?', 'People who already joined keep access.', 'Revoke', true)) return;
            if (await act(b, function () { return post('/admin/api/access/invites/' + i.id + '/revoke'); }, 'Invite revoked.')) { l.drop([i.id]); afterAccessChange(); }
          }, 'Revoke invite ' + (i.label || '')) : null,
        ])];
      },
      empty: function (s) { return s.q ? 'No invite matches.' : s.extra.state === 'ended' ? 'No ended invites.' : 'No active invite links.'; },
      tools: function (bar, l) {
        [['active', 'Active'], ['ended', 'Ended']].forEach(function (x) {
          var b = el('button', 'chip', x[1]); b.type = 'button'; b.setAttribute('aria-pressed', String(x[0] === 'active'));
          b.onclick = function () { l.s.extra.state = x[0]; l.s.page = 1; Array.prototype.forEach.call(stateChips.children, function (c) { c.setAttribute('aria-pressed', String(c === b)); }); l.load(); };
          stateChips.appendChild(b);
        });
        bar.appendChild(stateChips);
      },
    });
    access.lists.invites = list;
    var p2 = el('section', 'panel'); p2.appendChild(list.el); pane.appendChild(p2); list.load();
    f.onsubmit = async function (e) {
      e.preventDefault();
      var u = Number(uses.value), d = Number(days.value);
      if (!Number.isInteger(u) || u < 1 || u > 500) return fieldError(uses, msg, 'Uses must be a whole number from 1 to 500.');
      if (!Number.isInteger(d) || d < 1 || d > 30) return fieldError(days, msg, 'Days must be a whole number from 1 to 30.');
      fieldOk(uses, msg); days.removeAttribute('aria-invalid');
      var j = await act(mk, function () { return post('/admin/api/access/invites', { label: lab.value.trim(), uses: u, days: d }); }, 'Invite link created.', 'Creating');
      if (j) { code.textContent = j.link || j.url; nl.hidden = false; lab.value = ''; list.load(true); afterAccessChange(); }
    };
  }
  function editInviteDialog(i, done) {
    askDialog({
      title: 'Edit invite', body: i.active ? 'Ends ' + day(i.expiresAt) + ', ' + plural(i.usesLeft, 'use', 'uses') + ' left.' : 'This invite has ended. Add uses or days to open it again.',
      fields: [{ id: 'label', label: 'Label', value: i.label || '', maxlength: 80 },
        { id: 'addUses', label: 'Add uses', type: 'number', min: 1, max: 500, placeholder: '0', hint: 'Up to 500 left in total.' },
        { id: 'extendDays', label: 'Add days', type: 'number', min: 1, max: 30, placeholder: '0', hint: 'At most 60 days from today.' }],
      validate: function (v) {
        if (v.addUses && (!/^[0-9]+$/.test(v.addUses) || Number(v.addUses) < 1 || Number(v.addUses) + i.usesLeft > 500)) return ['addUses', 'Add 1 or more uses, up to 500 left in total.'];
        if (v.extendDays && (!/^[0-9]+$/.test(v.extendDays) || Number(v.extendDays) < 1 || Number(v.extendDays) > 30)) return ['extendDays', 'Add 1 to 30 days.'];
        if (v.label === (i.label || '') && !v.addUses && !v.extendDays) return ['label', 'Nothing to change.'];
        return null;
      },
      submit: function (v) {
        var body = {}; if (v.label !== (i.label || '')) body.label = v.label; if (v.addUses) body.addUses = Number(v.addUses); if (v.extendDays) body.extendDays = Number(v.extendDays);
        return post('/admin/api/access/invites/' + i.id + '/edit', body);
      },
    }).then(function (v) { if (v) { toast('Invite updated.'); done(); } });
  }

  // the admin's own Teams account
  var linkTimer = null;
  function renderMe(me) {
    if (!me) return;
    $('meLinked').hidden = !me.linked; $('meUnlinked').hidden = me.linked || !$('meCode').hidden;
    if (me.linked) { text($('meName'), me.name || 'Your account'); text($('meSince'), 'linked ' + day(me.linkedAt)); }
  }
  function wireAccess() {
    async function setMode(mode, btn) {
      if (access.summary && (mode === 'open') === !access.summary.restricted) return;
      if (mode === 'open' && !await confirmDialog('Open access to everyone?', 'Any personal Microsoft account will be able to connect to this server.', 'Open access', true)) return;
      if (await act(btn, function () { return post('/admin/api/access/mode', { mode: mode }); }, mode === 'open' ? 'Access is open.' : 'Access is restricted.')) afterAccessChange();
    }
    $('modeRestricted').addEventListener('click', function () { setMode('restricted', this); });
    $('modeOpen').addEventListener('click', function () { setMode('open', this); });
    $('meLink').addEventListener('click', async function () {
      var j = await act(this, function () { return post('/admin/api/teams/link/start'); }, null, 'Getting a code');
      if (!j) return;
      $('meUnlinked').hidden = true; $('meCode').hidden = false;
      text($('meUserCode'), j.userCode); $('meUrl').href = j.verificationUrl; text($('meUrl'), j.verificationUrl.replace('https://', '').replace('http://', ''));
      $('meCopy').onclick = function () { navigator.clipboard.writeText(j.userCode).then(function () { toast('Code copied.'); }); };
      pollLink(j.interval);
    });
    $('meUnlink').addEventListener('click', async function () {
      if (!await confirmDialog('Unlink your Teams account?', 'Your account keeps its access; group search stops until you link again.', 'Unlink', true)) return;
      if (await act(this, function () { return post('/admin/api/teams/unlink'); }, 'Teams account unlinked.')) { if (access.picker) access.picker.load(true); afterAccessChange(); }
    });
  }
  function pollLink(sec) {
    clearTimeout(linkTimer);
    linkTimer = setTimeout(async function () {
      var j;
      try { j = await post('/admin/api/teams/link/poll'); } catch (e) { j = { status: 'error', error: e.message }; }
      if (j.status === 'pending') return pollLink((j.interval || 5) + 1);
      $('meCode').hidden = true;
      if (j.status === 'linked') { toast('Teams account linked: ' + (j.name || 'your account') + '.'); if (access.picker) { access.picker.s.extra.refresh = true; await access.picker.load(true); access.picker.s.extra.refresh = false; } afterAccessChange(); return; }
      $('meUnlinked').hidden = false; toast(j.error || 'Linking failed. Try again.', true);
    }, Math.max(4, sec) * 1000);
  }

  // one access group
  var groupList = null;
  async function renderGroup(id) {
    var box = $('groupBody'); text($('gTitle'), 'Group');
    if (groupList && groupList.s.extra.id === id) { groupList.load(true); return; }
    clear(box);
    groupList = Paged({
      search: 'Search members', extra: { id: id },
      url: function (s) { return '/admin/api/access/group?' + qs({ id: id, page: s.page, q: s.q }); },
      key: function (p) { return p.key; },
      cols: [{ label: 'Person' }, { label: 'Last checked' }, { label: 'Member since', cls: 'opt' }],
      row: function (p) { return [td(personLink(p)), td(p.checkedDay || DASH, 'nw'), td(day(p.since), 'nw')]; },
      empty: function (s) { return s.q ? 'Nobody matches.' : 'Nobody has got in through this group yet. Members are added when they first connect.'; },
      onLoad: function (r) {
        var g = r.group; text($('gTitle'), g.name || 'Unnamed group'); document.title = (g.name || 'Group') + ' \\u00b7 Admin';
        facts($('gFacts'), [['People in through it', num(g.members)], ['Added', day(g.addedAt)], ['Chat id', short(g.id)]]);
        $('gRename').onclick = function () { renameGroupDialog(g, function (n) { text($('gTitle'), n); }); };
        $('gRemove').onclick = async function () { if (await removeGroup(g, $('gRemove'))) location.hash = '#access/groups'; };
      },
      onError: function (e) { if (e.status === 404 || e.status === 400) { stateBox(box, 'This group is not an access group any more.', '', null); return true; } return false; },
    });
    var p = el('section', 'panel'); p.appendChild(el('h2', '', 'Members')); p.appendChild(groupList.el); box.appendChild(p);
    groupList.load();
  }

  // ---------------------------------------------------------------- usage: tools, cloud, activity
  function renderUsage(d) {
    toolRows($('tools'), d.tools, true); heat($('hours'), d.hours);
    var c = d.cloud, box = clear($('cloud'));
    if (!c || !c.configured) stateBox(box, 'Cloud usage is not set up.', (c && c.note) || 'Add a read-only CF_ANALYTICS_TOKEN secret to see costs and free-plan limits here.');
    else if (c.error) stateBox(box, 'Cloudflare analytics could not be read.', c.error, function () { load(true); }, true);
    else {
      var g = el('div', 'grid2');
      var left = el('div'); left.appendChild(el('div', 'big', '$' + c.costNow.toFixed(2)));
      left.appendChild(el('p', 'muted', 'Spent this month on ' + c.plan + '. At this pace the paid plan would cost about $' + c.paidEstimate.total.toFixed(2) + ' a month ($5 base plus usage).'));
      var dl = el('dl', 'facts'); dl.style.marginTop = '16px';
      facts(dl, [['Requests this month', num(c.month.requests)], ['Projected for 30 days', num(c.projectedMonth.requests)], ['Errors this month', num(c.month.errors)],
        ['CPU per request (median, today)', c.today.cpuP50Ms + ' ms'], ['Database rows read / written', num(c.month.rowsRead) + ' / ' + num(c.month.rowsWritten)]]);
      left.appendChild(dl);
      var right = el('div'); right.appendChild(el('h2', '', 'Free plan limits'));
      c.limits.forEach(function (l) {
        var row = el('div', 'limitrow'); row.appendChild(el('span', '', l.label + ': ' + num(l.used) + ' of ' + num(l.limit) + ' (' + l.percent + '%)'));
        var m = el('div', 'meter'); var i = el('i', l.percent >= 80 ? 'hot' : ''); i.style.width = Math.min(100, l.percent) + '%'; m.appendChild(i); row.appendChild(m); right.appendChild(row);
      });
      right.appendChild(el('p', 'muted', 'From Cloudflare analytics, a few minutes behind. Updated ' + when(c.asOf) + '.'));
      g.appendChild(left); g.appendChild(right); box.appendChild(g);
    }
    var a = d.adoption;
    facts($('adoption'), [['Active today / 7 days / 30 days', a.activeToday + ' / ' + a.active7 + ' / ' + a.active30], ['New people this week', a.newThisWeek],
      ['Connected but never used', a.neverUsed], ['Idle for 30+ days', a.idle30], ['Ending within 14 days (unused)', a.expiring14],
      ['Apps', Object.keys(a.appMix).map(function (x) { return x + ' ' + a.appMix[x]; }).join(', ') || DASH], ['Registered apps', d.totals.registeredApps], ['Connections', d.totals.connections]]);
    var names = { signin: 'Sign-ins', signout: 'Sign-outs', expired: 'Expired (unused)', signin_not_allowed: 'Refused sign-ins', signin_bad_access_code: 'Wrong access code',
      rate_limited_ip: 'Rate-limited (per IP)', rate_limited_user: 'Rate-limited (per person)', rate_limited_heavy: 'Search limit hit', rate_limited_write: 'Change limit hit', daily_write_cap: 'Daily change cap hit',
      admin_signin_failed: 'Failed admin sign-ins', admin_ended_connection: 'Connections ended by admin', access_denied: 'Connections cut off', invite_accepted: 'Invites accepted', error: 'Server errors', cleanup_run: 'Nightly cleanups' };
    var keys = Object.keys(names).filter(function (m) { return d.events[m] !== undefined; });
    if (keys.length) facts($('events'), keys.map(function (m) { return [names[m], num(d.events[m])]; }));
    else { clear($('events')); $('events').appendChild(el('dd', 'empty', 'Nothing in the last 14 days.')); }
  }

  // ---------------------------------------------------------------- connections
  var connList = null, connChips = null;
  function drawConnChips(r) {
    r = r || connList.s.last || { counts: {} }; var chips = clear(connChips);
    [['all', 'All', r.counts.all], ['refresh', 'Needs refresh', r.counts.refresh]].forEach(function (x) {
      var b = el('button', 'chip'); b.type = 'button'; b.appendChild(el('span', '', x[1])); b.appendChild(el('span', 'n', num(x[2] || 0)));
      b.setAttribute('aria-pressed', String(connList.s.extra.filter === x[0])); b.onclick = function () { location.hash = x[0] === 'all' ? '#connections' : '#connections/refresh'; };
      chips.appendChild(b);
    });
  }
  function renderConnections() {
    var filter = state.arg === 'refresh' ? 'refresh' : 'all';
    if (connList) { connList.s.extra.filter = filter; connList.s.page = 1; drawConnChips(); return connList.load(true); }
    connChips = el('div', 'chips'); connChips.setAttribute('role', 'group'); connChips.setAttribute('aria-label', 'Filter connections');
    connList = Paged({
      search: 'Search by person or app', extra: { filter: filter },
      url: function (s) { return '/admin/api/connections?' + qs({ filter: s.extra.filter === 'refresh' ? 'refresh' : '', page: s.page, q: s.q }); },
      key: function (c) { return c.id; },
      cols: [{ label: 'Person' }, { label: 'App' }, { label: 'Created', cls: 'opt' }, { label: 'Last used' }, { label: 'Ends if unused', cls: 'opt' }, { label: 'Tools' }, { label: '' }],
      row: function (c, l) {
        var who = c.accountHash ? personLink({ key: c.accountHash, name: c.person }) : el('span', '', c.person || 'Unknown');
        return [td(who, 'nw'), td(c.app || 'Unknown app'), td(when(c.createdAt), 'nw'), td(when(c.lastUsedAt), 'nw'), td(day(c.expiresAt), 'nw'),
          td(c.toolsUpToDate ? pill('Up to date', 'ok') : pill('Needs refresh', 'warn')),
          actsCell([actBtn('End', 'bad', async function (b) {
            if (!await confirmDialog('End this connection?', 'The app using it (' + (c.app || 'unknown app') + ') will need to sign in again.', 'End connection', true)) return;
            l.mark(c.id, true);
            if (await act(b, function () { return post('/admin/api/connections/' + c.id + '/end'); }, 'Connection ended.')) { l.drop([c.id]); refreshCounts(); } else l.mark(c.id, false);
          }, 'End connection for ' + (c.person || 'unknown person'))])];
      },
      empty: function (s) { return s.q ? 'No connection matches.' : s.extra.filter === 'refresh' ? 'Everyone has the current tool list.' : 'No connections yet.'; },
      tools: function (bar) { bar.appendChild(connChips); },
      onLoad: function (r) { drawConnChips(r); },
    });
    $('connBody').appendChild(connList.el); connList.load();
  }

  // ---------------------------------------------------------------- settings: general, security, audit log
  var SETTINGS_TABS = [{ id: 'general', label: 'General' }, { id: 'security', label: 'Security' }, { id: 'audit', label: 'Audit log' }];
  var auditList = null;
  async function renderSettings(arg) {
    var tab = SETTINGS_TABS.some(function (t) { return t.id === arg; }) ? arg : 'general';
    tabs($('setTabs'), SETTINGS_TABS.map(function (t) { return { id: t.id, label: t.label, href: '#settings/' + t.id }; }), tab);
    ['general', 'security', 'audit'].forEach(function (t) { $('set-' + t).hidden = t !== tab; });
    if (tab === 'audit') return renderAudit();
    var box = $(tab === 'general' ? 'setGeneralState' : 'setSecurityState'); skeleton(box, ['', '', '']);
    var r;
    try { r = await api('/admin/api/settings'); } catch (e) { if (e.status !== 401) stateBox(box, 'Settings could not load.', e.message, function () { renderSettings(tab); }, true); return; }
    clear(box);
    if (tab === 'general') fillGeneral(r.settings); else fillSecurity(r.twoFactor);
  }
  function fillGeneral(s) {
    $('generalForm').hidden = false;
    $('sPersonal').checked = s.personalUrls; $('sAlerts').checked = s.alerts; $('sCap').value = s.dailyCap; $('sDays').value = s.inactiveDays;
    text($('sCodeState'), s.accessCodeRequired ? 'On' + (s.accessCodeFrom === 'variable' ? ', set by the ACCESS_CODE variable' : ', set here') : 'Off: no code needed to sign in.');
    $('sCodeRemove').hidden = !s.accessCodeRequired || s.accessCodeFrom === 'variable';
    $('sCodeReset').hidden = s.accessCodeFrom !== 'admin';
    text($('sHookState'), s.alertWebhook ? 'Sending to ' + s.alertWebhook : 'Off');
    $('sHookRemove').hidden = !s.alertWebhook;
    var d = state.data;
    if (d) {
      var l = d.limits, m = d.microsoft;
      facts($('setServer'), [['Version', 'v' + d.version], ['Access', d.settings.restricted ? 'Restricted (see Access)' : 'Open to any personal account'],
        ['Allow-list', s.allowListSize ? plural(s.allowListSize, 'account', 'accounts') + ' (ALLOWED_ACCOUNTS)' : 'Off'], ['Last nightly cleanup', d.lastCleanup || 'Not yet'],
        ['Requests', l.requestsPerMinute + ' a minute per person'], ['Searches across chats', l.searchesPerMinute + ' a minute per person'], ['Changes', l.changesPerMinute + ' a minute per person']]);
      facts($('microsoft'), [['Shown to people as', m.shownAs], ['Microsoft app id', m.clientId], ['Where people manage it', m.permissionsPage.replace('https://', '')]]);
      text($('msnote'), m.note);
    }
  }
  function saveSettings(btn, body, okMsg) {
    return act(btn, async function () { var r = await post('/admin/api/settings', body); fillGeneral(r.settings); load(true); return r; }, okMsg, 'Saving');
  }
  function wireSettings() {
    $('generalForm').addEventListener('submit', function (e) {
      e.preventDefault(); var cap = $('sCap').value.trim(), days = $('sDays').value.trim();
      if (!/^[0-9]+$/.test(cap) || Number(cap) > 5000) return fieldError($('sCap'), $('sMsg'), 'The daily change cap must be a whole number from 0 to 5000.');
      $('sCap').removeAttribute('aria-invalid');
      if (!/^[0-9]+$/.test(days) || Number(days) < 7 || Number(days) > 365) return fieldError($('sDays'), $('sMsg'), 'Connections must end after 7 to 365 unused days.');
      fieldOk($('sDays'), $('sMsg'));
      saveSettings($('sSave'), { personalUrls: $('sPersonal').checked, alerts: $('sAlerts').checked, dailyCap: Number(cap), inactiveDays: Number(days) }, 'Settings saved.');
    });
    $('codeForm').addEventListener('submit', async function (e) {
      e.preventDefault(); var c = $('sCode').value.trim();
      if (c.length < 6 || c.length > 64) return fieldError($('sCode'), $('sCodeMsg'), 'The access code must be 6 to 64 characters.');
      fieldOk($('sCode'), $('sCodeMsg'));
      if (await saveSettings($('sCodeSave'), { accessCode: c }, 'Access code set. Share it with the people who sign in.')) $('sCode').value = '';
    });
    $('sCodeRemove').addEventListener('click', async function () {
      if (!await confirmDialog('Turn the access code off?', 'People will be able to start a sign-in without a code. Access rules still apply.', 'Turn off', true)) return;
      saveSettings(this, { accessCode: null }, 'Access code off.');
    });
    $('sCodeReset').addEventListener('click', function () { var b = this; act(b, async function () { var r = await post('/admin/api/settings/reset', { key: 'accessCode' }); fillGeneral(r.settings); }, 'Back to the Cloudflare variable.'); });
    $('hookForm').addEventListener('submit', async function (e) {
      e.preventDefault(); var u = $('sHook').value.trim();
      if (!/^https:[/][/][^ /]+[.][^ /]+[/]/.test(u)) return fieldError($('sHook'), $('sHookMsg'), 'Enter an https:// address, for example https://hooks.slack.com/services/...');
      fieldOk($('sHook'), $('sHookMsg'));
      if (await saveSettings($('sHookSave'), { alertWebhook: u }, 'Alert webhook saved. Alerts are sent once a night.')) $('sHook').value = '';
    });
    $('sHookRemove').addEventListener('click', async function () { if (await confirmDialog('Stop sending alerts?', 'The nightly alert message stops.', 'Remove', true)) saveSettings(this, { alertWebhook: '' }, 'Alert webhook removed.'); });

    $('tfaStart').addEventListener('click', async function () {
      var j = await act(this, function () { return post('/admin/api/security/2fa/start'); }, null, 'Preparing');
      if (!j) return;
      $('tfaOff').hidden = true; $('tfaSetup').hidden = false;
      text($('tfaSecret'), j.secret.replace(/(.{4})/g, '$1 ').trim()); $('tfaUri').href = j.uri; $('tfaCode').value = ''; $('tfaCode').focus();
    });
    $('tfaCancel').addEventListener('click', function () { $('tfaSetup').hidden = true; $('tfaOff').hidden = false; });
    $('tfaConfirm').addEventListener('submit', async function (e) {
      e.preventDefault(); var c = $('tfaCode').value.replace(/ /g, '');
      if (!/^[0-9]{6}$/.test(c)) return fieldError($('tfaCode'), $('tfaMsg'), 'Enter the 6-digit code your app shows.');
      fieldOk($('tfaCode'), $('tfaMsg'));
      if (await act($('tfaConfirmBtn'), function () { return post('/admin/api/security/2fa/confirm', { code: c }); }, 'Two-factor is on. You will need a code at every sign-in.', 'Checking')) renderSettings('security');
    });
    $('tfaDisable').addEventListener('submit', async function (e) {
      e.preventDefault(); var c = $('tfaOffCode').value.replace(/ /g, '');
      if (!/^[0-9]{6}$/.test(c)) return fieldError($('tfaOffCode'), $('tfaOffMsg'), 'Enter the current 6-digit code to turn it off.');
      fieldOk($('tfaOffCode'), $('tfaOffMsg'));
      if (!await confirmDialog('Turn two-factor off?', 'Sign-in will need only the username and password.', 'Turn off', true)) return;
      if (await act($('tfaDisableBtn'), function () { return post('/admin/api/security/2fa/disable', { code: c }); }, 'Two-factor is off.', 'Checking')) { $('tfaOffCode').value = ''; renderSettings('security'); }
    });
    $('endOthers').addEventListener('click', async function () {
      if (!await confirmDialog('Sign out everywhere else?', 'Every other admin session ends now. This one stays signed in.', 'Sign out others', true)) return;
      var r = await act(this, function () { return post('/admin/api/security/sessions/end', { all: true }); }, null, 'Signing out');
      if (r) { toast('Signed out ' + plural(r.ended, 'other session', 'other sessions') + '.'); loadSessions(); }
    });
  }
  function fillSecurity(t) {
    $('tfaOn').hidden = !t.enabled; $('tfaOff').hidden = t.enabled; $('tfaSetup').hidden = true;
    loadSessions();
  }
  async function loadSessions() {
    var tb = clear($('sessions'));
    var r; try { r = await api('/admin/api/security/sessions'); } catch (e) { return; }
    r.items.forEach(function (x) {
      var tr = el('tr');
      var who = el('td'); who.appendChild(el('span', '', x.agent ? x.agent.slice(0, 60) : 'Unknown browser')); if (x.current) who.appendChild(el('span', 'sub', 'This session'));
      var end = x.current ? null : actBtn('End', 'bad', async function (b) { if (await act(b, function () { return post('/admin/api/security/sessions/end', { id: x.id }); }, 'Session ended.')) tr.remove(); }, 'End session');
      [[who, 'Browser'], [td(x.country || DASH), 'Country'], [td(when(x.createdAt), 'nw opt'), 'Signed in'], [td(when(x.lastSeen), 'nw'), 'Last used'], [actsCell([end]), '']]
        .forEach(function (c, i) { c[0].setAttribute('data-label', c[1]); if (i === 0) c[0].classList.add('main'); tr.appendChild(c[0]); });
      tb.appendChild(tr);
    });
    $('endOthers').hidden = r.items.length < 2;
  }
  function renderAudit() {
    if (auditList) return auditList.load(true);
    auditList = Paged({
      search: 'Search actions', size: 20,
      url: function (s) { return '/admin/api/audit?' + qs({ page: s.page, q: s.q, size: 20 }); },
      cols: [{ label: 'When' }, { label: 'Action' }, { label: 'About' }, { label: 'Details', cls: 'opt' }, { label: 'Country', cls: 'opt' }],
      row: function (x) { return [td(when(x.at), 'nw'), td(x.action), td(x.target || DASH), td(x.detail || DASH), td(x.country || DASH)]; },
      empty: function (s) { return s.q ? 'No action matches.' : 'No admin actions recorded yet.'; },
    });
    $('auditBody').appendChild(auditList.el); auditList.load();
  }

  // ---------------------------------------------------------------- routing
  var VIEWS = ['overview', 'issues', 'people', 'person', 'access', 'group', 'usage', 'connections', 'settings'];
  var MENU_OF = { person: 'people', group: 'access' };
  var OLD = { tools: 'usage', cloud: 'usage', activity: 'usage' };
  var TITLES = { overview: 'Overview', issues: 'Issues', people: 'People', person: 'Person', access: 'Access', group: 'Group', usage: 'Usage', connections: 'Connections', settings: 'Settings' };
  function parseHash() {
    var h = (location.hash || '#overview').slice(1);
    var q = h.indexOf('?'); var path = q >= 0 ? h.slice(0, q) : h; var query = q >= 0 ? h.slice(q + 1) : '';
    var parts = path.split('/'); var name = OLD[parts[0]] || parts[0];
    var view = VIEWS.indexOf(name) >= 0 ? name : 'overview';
    var params = {};
    query.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
    if (view === 'issues' && parts[1]) params.kind = parts[1];
    return { view: view, arg: decodeURIComponent(parts.slice(1).join('/')), params: params };
  }
  function route(keepScroll) {
    var r = parseHash(); var changed = r.view !== state.view || r.arg !== state.arg;
    state.view = r.view; state.arg = r.arg; state.params = r.params;
    VIEWS.forEach(function (v) { $('v-' + v).hidden = v !== r.view; });
    Array.prototype.forEach.call(document.querySelectorAll('.menu a'), function (a) {
      var target = a.getAttribute('href').slice(1); var on = target === r.view || MENU_OF[r.view] === target;
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = TITLES[r.view] + ' \\u00b7 Admin';
    if (changed && !keepScroll) { window.scrollTo(0, 0); var h1 = document.querySelector('#v-' + r.view + ' h1'); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); } }
    if (r.view === 'person') return renderPerson(r.arg);
    if (r.view === 'group') return renderGroup(r.arg);
    if (r.view === 'issues') return renderIssues();
    if (r.view === 'access') return renderAccess(r.arg);
    if (r.view === 'people') return renderPeople();
    if (r.view === 'connections') return renderConnections();
    if (r.view === 'settings') return renderSettings(r.arg);
    if (!state.data) return;
    if (r.view === 'usage') return renderUsage(state.data);
    renderOverview(state.data);
  }
  window.addEventListener('hashchange', function () { if (!state.data) load(); else route(); });
  $('refresh').addEventListener('click', function () { load(true); });
  wireSettings();

  // ---------------------------------------------------------------- start
  if (!navigator.onLine) $('offline').hidden = false;
  if (!configured) showOnly('notset');
  else load();
})();`;

const stat = (id, label, deltaId) => `<div class="stat"><b id="${id}">&nbsp;</b><span>${label}</span>${deltaId ? `<span class="delta" id="${deltaId}"></span>` : ''}</div>`;
const navItem = (id, label, badge) => `<li><a href="#${id}">${svg(id)}<span class="label grow">${label}</span>${badge ? `<span class="badge" id="${badge}" hidden></span>` : ''}</a></li>`;
const table = (id, headers) => `<div class="tablewrap"><table class="cards"><thead><tr>${headers.map((h) => {
  const [label, cls] = Array.isArray(h) ? h : [h, /^(Calls|People|Avg|Errors)/.test(h) ? 'num' : ''];
  return `<th${cls ? ` class="${cls}"` : ''}>${label || '<span class="sr">Actions</span>'}</th>`;
}).join('')}</tr></thead><tbody id="${id}"></tbody></table></div>`;

export function renderAdminPage({ configured }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin · Teams Personal MCP</title><meta name="robots" content="noindex"><meta name="theme-color" content="#1f1a17">
<style>${CSS}</style></head>
<body data-configured="${configured ? '1' : '0'}">
<a class="skip" href="#main">Skip to content</a>
<div class="offline" id="offline" hidden role="status">${svg('wifi')}<span>You are offline. The page will refresh when the connection is back.</span></div>

<div class="center" id="boot" role="status"><div class="boot"><span class="spin"></span><span>Checking your session</span></div></div>

<div class="center" id="signinWrap" hidden>
  <form class="signin" id="signinForm" novalidate>
    <div><h1>Admin</h1></div>
    <p>Teams Personal MCP. Sign in with the admin username and password set in Cloudflare.</p>
    <p class="notice" id="signinNote" hidden>Your session ended. Sign in again to carry on where you were.</p>
    <label class="field" for="u">Username<input class="input" id="u" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
    <label class="field" for="p">Password<span class="pw"><input class="input" id="p" type="password" autocomplete="current-password" required><button type="button" id="pwToggle" aria-pressed="false" aria-label="Show password">${svg('eye')}</button></span></label>
    <label class="field" for="code" id="codeField" hidden>Authenticator code<input class="input codein" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456"></label>
    <button class="btn" type="submit" id="signinBtn">Sign in</button>
    <p class="msg-err" id="err" role="alert"></p>
  </form>
</div>
${configured ? '' : `<div class="center" id="notset" hidden><div class="signin"><h1>Admin</h1><p>Admin sign-in is not set up yet. Set <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> (at least ${MIN_PASSWORD} characters) as Cloudflare secrets, then reload this page.</p></div></div>`}

<div class="app" id="app" hidden>
  <aside class="rail" aria-label="Admin menu">
    <div class="brandline"><a href="/">Teams Personal MCP</a><span>Admin</span></div>
    <nav><ul class="menu">
      ${navItem('overview', 'Overview')}
      ${navItem('issues', 'Issues', 'c-issues')}
      ${navItem('people', 'People', 'c-people')}
      ${navItem('access', 'Access', 'c-access')}
      ${navItem('usage', 'Usage')}
      ${navItem('connections', 'Connections', 'c-connections')}
      ${navItem('settings', 'Settings')}
    </ul></nav>
    <div class="railfoot">
      <button type="button" id="refresh" aria-label="Refresh data"><svg id="refreshIcon" class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.refresh}"/></svg><span class="label">Refresh</span></button>
      <a href="/changelog">${svg('doc')}<span class="label">Changelog</span></a>
      <button type="button" id="out">${svg('logout')}<span class="label">Sign out</span></button>
      <span class="stamp" id="stamp"></span>
      <span class="stamp" id="ver"></span>
    </div>
  </aside>

  <main class="content" id="main" tabindex="-1">
    <div class="stack" id="viewError"></div>

    <section class="view" id="v-overview" aria-labelledby="h-overview">
      <div class="head"><div><h1 id="h-overview">Overview</h1><p>Today at a glance. Anything that needs you is listed first; each item opens where you can fix it.</p></div></div>
      <div class="alerts" id="alerts" aria-live="polite"></div>
      <div class="stats">${stat('k-people', 'People')}${stat('k-activeToday', 'Active today')}${stat('k-active7', 'Active, 7 days')}${stat('k-requestsToday', 'Requests today', 'd-requestsToday')}${stat('k-toolCallsToday', 'Tool calls today', 'd-toolCallsToday')}${stat('k-changesToday', 'Changes today', 'd-changesToday')}</div>
      <section class="panel"><div class="panelhead"><h2>Health, last 14 days</h2><a class="link" href="#issues">All issues</a></div><div class="strip" id="ovStrip"></div></section>
      <div class="grid2">
        <section class="panel"><h2>Requests per day</h2><div class="cols" id="daily"></div><div class="axis"><span id="dailyFrom"></span><span>today</span></div></section>
        <section class="panel"><div class="panelhead"><h2>Cloud</h2><a class="link" href="#usage">Usage</a></div><div id="cloudSummary"></div></section>
      </div>
      <div class="grid2">
        <section class="panel"><div class="panelhead"><h2>Top people</h2><a class="link" href="#people">All people</a></div><ul class="rank" id="topPeople"></ul></section>
        <section class="panel"><div class="panelhead"><h2>Top tools</h2><a class="link" href="#usage">All tools</a></div><ul class="rank" id="topTools"></ul></section>
      </div>
    </section>

    <section class="view" id="v-issues" hidden aria-labelledby="h-issues">
      <div class="head"><div><h1 id="h-issues">Issues</h1><p>What went wrong, for whom, in which tool, and what to do. Pick a day, kind, person or tool to narrow it down.</p></div></div>
      <div class="stack" id="issuesBody"></div>
    </section>

    <section class="view" id="v-people" hidden aria-labelledby="h-people">
      <div class="head"><div><h1 id="h-people">People</h1><p>Last 30 days. Select a name for their access, details, limits and usage.</p></div></div>
      <section class="panel" id="peopleBody"></section>
      <p class="muted" id="privacy"></p>
    </section>

    <section class="view" id="v-person" hidden aria-labelledby="pName">
      <div class="head"><div><a class="crumb" href="#people">${svg('back')}People</a><div class="inline"><h1 id="pName">Person</h1><span class="pill info" id="pTag" hidden></span></div></div><div class="inline"><a class="btn quiet small" id="pIssues" href="#issues">${svg('issues')}Issues for this person</a></div></div>
      <div class="stack" id="personBody"></div>
      <template id="personTpl">
        <div class="grid2">
          <section class="panel"><h2>Access</h2><div id="pAccess"></div></section>
          <section class="panel"><h2>Details</h2>
            <form class="form" id="metaForm" novalidate>
              <div class="row2"><label class="field" for="mTag">Tag<select class="input" id="mTag"><option value="">None</option><option value="team">Team</option><option value="customer">Customer</option><option value="other">Other</option></select></label>
              <label class="field" for="mOrg">Organisation<input class="input" id="mOrg" maxlength="80" autocomplete="off"></label></div>
              <label class="field" for="mNote">Note <span class="hint">Only you see this.</span><textarea class="input" id="mNote" maxlength="500"></textarea></label>
              <div class="inline"><button class="btn quiet" type="submit" id="mSave">Save details</button><p class="msg-err" id="mMsg" role="alert"></p></div>
            </form>
            <p class="muted" id="metaNo" hidden>Details can be kept for a known Teams account only.</p>
          </section>
        </div>
        <div class="grid2">
          <section class="panel"><div class="panelhead"><h2>Connections</h2><button class="btn danger small" type="button" id="pEnd">End all</button></div>${table('pConn', ['App', 'Last used', 'Tools', ''])}</section>
          <section class="panel"><h2>Daily change limit</h2>
            <p class="muted" id="pCapToday"></p><div class="meter" style="margin:10px 0 16px"><i id="pCapMeter"></i></div>
            <form class="inline" id="pCapForm" novalidate><label for="pCap">Changes a day</label><input class="input" id="pCap" inputmode="numeric" style="width:9em"><button class="btn quiet" type="submit" id="pCapSave">Save</button></form>
            <p class="msg-err" id="pCapMsg" role="alert" style="margin-top:8px"></p>
            <div class="inline" style="margin-top:12px"><a class="btn quiet small" id="pCsv" href="#" download>Export usage CSV</a></div>
          </section>
        </div>
        <p class="state" id="pNoUsage" hidden><strong>No usage in the last 30 days.</strong><span>Usage shows here after their first tool call.</span></p>
        <div class="stack" id="pUsage">
          <div class="stats">${stat('pReq', 'Requests, 30 days')}${stat('pTools', 'Tool calls')}${stat('pChanges', 'Changes')}${stat('pSearch', 'Searches')}</div>
          <div class="grid2">
            <section class="panel"><h2>Tool calls per day</h2><div class="cols" id="pDaily"></div><p class="muted" style="margin-top:8px">Red days include changes to Teams.</p></section>
            <section class="panel"><h2>When they use it (UTC)</h2><div class="heat" id="pHours"></div><div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></section>
          </div>
          <div class="grid2">
            <section class="panel"><h2>Their tools</h2>${table('pToolTable', ['Tool', 'Calls', 'Avg time', ['Avg size', 'num opt'], 'Errors'])}</section>
            <section class="panel"><h2>About</h2><dl class="facts" id="pFacts"></dl></section>
          </div>
        </div>
      </template>
    </section>

    <section class="view" id="v-access" hidden aria-labelledby="h-access">
      <div class="head"><div><h1 id="h-access">Access</h1><p id="modeNote">Who can use this server.</p></div>
        <div class="seg" role="group" aria-label="Who can connect"><button type="button" id="modeRestricted" aria-pressed="false">Restricted</button><button type="button" id="modeOpen" aria-pressed="false">Open</button></div></div>
      <section class="panel">
        <div class="head" id="meLinked" hidden style="align-items:center"><p class="muted" style="margin:0;color:var(--ink)">Your Teams account: <b id="meName"></b> <span class="faint" id="meSince"></span>. It always has access and is used here only to list your group chats.</p><button class="btn quiet small" type="button" id="meUnlink">Unlink</button></div>
        <div class="head" id="meUnlinked" hidden style="align-items:center"><p class="muted" style="margin:0">Link your own Teams account: it always has access, and you can add groups from your group chats.</p><button class="btn" type="button" id="meLink">Link my Teams account</button></div>
        <div id="meCode" hidden><p class="muted">Enter this code at <a id="meUrl" target="_blank" rel="noopener"></a> and sign in with your personal Microsoft account.</p>
          <div class="inline" style="margin-top:10px"><span class="bigcode" id="meUserCode"></span><button class="btn quiet small" type="button" id="meCopy">Copy code</button></div>
          <p class="muted inline" style="margin-top:10px"><span class="spin"></span>Waiting for you to approve at Microsoft</p></div>
      </section>
      <nav class="tabs" id="accessTabs" aria-label="Access lists"></nav>
      <div id="accessPane"></div>
    </section>

    <section class="view" id="v-group" hidden aria-labelledby="gTitle">
      <div class="head"><div><a class="crumb" href="#access/groups">${svg('back')}Access groups</a><h1 id="gTitle">Group</h1></div>
        <div class="inline"><button class="btn quiet small" type="button" id="gRename">Rename</button><button class="btn danger small" type="button" id="gRemove">Remove group</button></div></div>
      <section class="panel"><dl class="facts" id="gFacts"></dl></section>
      <div class="stack" id="groupBody"></div>
    </section>

    <section class="view" id="v-usage" hidden aria-labelledby="h-usage">
      <div class="head"><div><h1 id="h-usage">Usage</h1><p>Last 30 days. Avg size is what each call returns to the assistant: larger results use more of people's Claude context.</p></div></div>
      <section class="panel"><h2>Tools</h2>${table('tools', ['Tool', 'Calls', 'People', 'Avg time', ['Avg size', 'num opt'], 'Errors'])}</section>
      <div class="grid2">
        <section class="panel"><h2>Busiest hours (UTC)</h2><div class="heat" id="hours"></div><div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></section>
        <section class="panel"><h2>Adoption and upkeep</h2><dl class="facts" id="adoption"></dl></section>
      </div>
      <section class="panel"><h2>Cloud</h2><div id="cloud"></div></section>
      <section class="panel"><h2>Events, last 14 days</h2><dl class="facts" id="events"></dl></section>
    </section>

    <section class="view" id="v-connections" hidden aria-labelledby="h-conn">
      <div class="head"><div><h1 id="h-conn">Connections</h1><p>Each app someone connected. "Needs refresh" means that app still has an older tool list; Claude shows them a note.</p></div></div>
      <section class="panel" id="connBody"></section>
    </section>

    <section class="view" id="v-settings" hidden aria-labelledby="h-set">
      <div class="head"><div><h1 id="h-set">Settings</h1><p>Changes here override the Cloudflare variables and apply within a minute.</p></div></div>
      <nav class="tabs" id="setTabs" aria-label="Settings sections"></nav>
      <div class="stack" id="set-general">
        <div class="slot" id="setGeneralState"></div>
        <section class="panel"><h2>Sign-in and limits</h2>
          <form class="form" id="generalForm" novalidate hidden>
            <label class="toggle"><input type="checkbox" class="check" id="sPersonal"><span><b>Personal URLs</b><span>People can copy a personal URL for apps that cannot sign in (Claude Code, Cursor). Off means connectors only.</span></span></label>
            <label class="toggle"><input type="checkbox" class="check" id="sAlerts"><span><b>New-connection notes</b><span>Each person gets a Teams note when a new app connects to their account.</span></span></label>
            <div class="row2">
              <label class="field" for="sCap">Daily change cap per person<input class="input" id="sCap" inputmode="numeric"><span class="hint">Sends, edits and reactions, 0 to 5000. A limit set on a person wins.</span></label>
              <label class="field" for="sDays">End connections unused for (days)<input class="input" id="sDays" inputmode="numeric"><span class="hint">7 to 365.</span></label>
            </div>
            <div class="inline"><button class="btn" type="submit" id="sSave">Save</button><p class="msg-err" id="sMsg" role="alert"></p></div>
          </form>
        </section>
        <div class="grid2">
          <section class="panel"><h2>Access code</h2><p class="muted" id="sCodeState"></p>
            <form class="inline" id="codeForm" novalidate style="margin-top:12px"><input class="input grow" id="sCode" type="password" autocomplete="new-password" placeholder="New code, 6 to 64 characters" aria-label="New access code"><button class="btn quiet" type="submit" id="sCodeSave">Set code</button></form>
            <p class="msg-err" id="sCodeMsg" role="alert" style="margin-top:8px"></p>
            <div class="inline" style="margin-top:10px"><button class="link" type="button" id="sCodeRemove" hidden>Turn the code off</button><button class="link" type="button" id="sCodeReset" hidden>Use the Cloudflare variable again</button></div>
          </section>
          <section class="panel"><h2>Alert webhook</h2><p class="muted" id="sHookState"></p>
            <form class="inline" id="hookForm" novalidate style="margin-top:12px"><input class="input grow" id="sHook" type="url" placeholder="https://hooks.slack.com/services/..." aria-label="Alert webhook address" autocomplete="off"><button class="btn quiet" type="submit" id="sHookSave">Save</button></form>
            <p class="msg-err" id="sHookMsg" role="alert" style="margin-top:8px"></p>
            <div class="inline" style="margin-top:10px"><button class="link" type="button" id="sHookRemove" hidden>Stop sending alerts</button></div>
          </section>
        </div>
        <div class="grid2">
          <section class="panel"><h2>Server</h2><dl class="facts" id="setServer"></dl></section>
          <section class="panel"><h2>On Microsoft's side</h2><dl class="facts" id="microsoft"></dl><p class="muted" id="msnote" style="margin-top:12px"></p></section>
        </div>
      </div>
      <div class="stack" id="set-security" hidden>
        <div class="slot" id="setSecurityState"></div>
        <section class="panel"><h2>Two-factor sign-in</h2>
          <div id="tfaOn" hidden>
            <p class="inline">${'<span class="pill ok">On</span>'}<span class="muted">Every sign-in needs a code from your authenticator app.</span></p>
            <form class="inline" id="tfaDisable" novalidate style="margin-top:14px"><input class="input codein" id="tfaOffCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" aria-label="Current code" style="width:10em"><button class="btn quiet" type="submit" id="tfaDisableBtn">Turn off</button></form>
            <p class="msg-err" id="tfaOffMsg" role="alert" style="margin-top:8px"></p>
          </div>
          <div id="tfaOff" hidden>
            <p class="muted">Off. Turn it on so a stolen password alone cannot open this page. Works with any authenticator app (Microsoft Authenticator, Google Authenticator, 1Password).</p>
            <button class="btn" type="button" id="tfaStart" style="margin-top:14px">Turn on two-factor</button>
          </div>
          <div id="tfaSetup" hidden class="stack tight">
            <p class="muted">1. In your authenticator app, add an account with this key (or open the link on your phone):</p>
            <p><code class="secret" id="tfaSecret"></code></p>
            <p><a class="link" id="tfaUri" href="#">Open in authenticator app</a></p>
            <form class="inline" id="tfaConfirm" novalidate><label for="tfaCode">2. Enter the code it shows</label><input class="input codein" id="tfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="123456" style="width:10em"><button class="btn" type="submit" id="tfaConfirmBtn">Turn on</button><button class="btn quiet" type="button" id="tfaCancel">Cancel</button></form>
            <p class="msg-err" id="tfaMsg" role="alert"></p>
          </div>
        </section>
        <section class="panel"><div class="panelhead"><h2>Signed-in sessions</h2><button class="btn quiet small" type="button" id="endOthers" hidden>Sign out everywhere else</button></div>
          <p class="muted" style="margin-bottom:10px">A session ends after 30 minutes without use, after 8 hours, at sign-out, or when the admin password changes.</p>
          ${table('sessions', ['Browser', 'Country', ['Signed in', 'opt'], 'Last used', ''])}
        </section>
      </div>
      <div class="stack" id="set-audit" hidden>
        <section class="panel"><h2>Audit log</h2><p class="muted" style="margin-bottom:12px">Every change made on this page, kept for 180 days.</p><div id="auditBody"></div></section>
      </div>
    </section>
  </main>
</div>

<dialog id="confirm" aria-labelledby="confirmTitle"><form method="dialog"><h2 id="confirmTitle"></h2><p id="confirmBody"></p>
  <div class="row"><button class="btn quiet" value="cancel" id="confirmCancel">Cancel</button><button class="btn" value="ok" id="confirmOk">Confirm</button></div></form></dialog>
<dialog id="ask"><form id="askForm" novalidate></form></dialog>
<div class="toasts" id="toasts" aria-live="polite"></div>
<script>window.__ICONS = ${JSON.stringify(ICONS)};</script>
<script>${SCRIPT}</script>
</body></html>`;
}
