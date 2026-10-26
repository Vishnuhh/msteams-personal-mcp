// Admin app: sign-in plus a side-rail layout with one view per area.
// Views: #overview (dashboard), #issues (root causes), #people, #person/<key>, #access, #tools, #cloud,
// #connections, #activity, #settings. Every view has loading, error, empty and session-expired states.
// Data: /admin/api/overview (shared, auto-refreshed while visible) plus per-view endpoints.
// Everything that came from Teams (names, app names, details) is inserted with textContent, never as HTML.

const MIN_PASSWORD = 12;

// Icons: Lucide paths (ISC licence), drawn at one stroke weight.
const ICONS = {
  overview: 'M3 3h8v10H3zM13 3h8v6h-8zM13 13h8v8h-8zM3 17h8v4H3z',
  issues: 'M22 12h-4l-3 9L9 3l-3 9H2',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  access: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  tools: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  cloud: 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z',
  connections: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  activity: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  wifi: 'M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01',
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
  --pad: clamp(16px, 2.6vw, 40px); --radius: 10px; --radius-s: 7px; --rail-w: 240px;
  --font: "Switzer", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
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
.link { font: inherit; background: none; border: 0; padding: 0; cursor: pointer; color: var(--ink-2); text-decoration: underline; text-underline-offset: .2em; }
.link:hover { color: var(--ink); }
.act { font: 600 var(--step-small)/1 var(--font); background: none; border: 0; padding: 6px 2px; cursor: pointer; color: var(--ink); text-decoration: underline; text-underline-offset: .2em; }
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
.input { font: 400 var(--step-body)/1.3 var(--font); color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-s); padding: 10px 12px; min-height: 42px; width: 100%; min-width: 0; }
.input:hover { border-color: #d3cac0; }
.input:focus-visible { outline-offset: 0; border-color: var(--accent); }
.pw { position: relative; }
.pw .input { padding-right: 44px; }
.pw button { position: absolute; right: 4px; top: 4px; bottom: 4px; width: 36px; border: 0; background: none; color: var(--ink-3); border-radius: 6px; cursor: pointer; display: grid; place-items: center; }
.pw button[aria-pressed="true"] { color: var(--accent); }
.msg-err { color: var(--bad); font-size: var(--step-small); margin: 0; }
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
.view { display: grid; gap: clamp(20px, 2.4vw, 32px); max-width: 1240px; animation: enter .35s var(--ease) both; }
@keyframes enter { from { opacity: 0; transform: translateY(6px); } }
.head { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 12px 24px; }
.head h1 { margin: 0; font-size: var(--step-h1); font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
.head p { margin: 6px 0 0; color: var(--ink-2); font-size: var(--step-small); max-width: 70ch; }
h2 { margin: 0 0 12px; font-size: var(--step-h2); font-weight: 600; letter-spacing: -0.015em; }
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
.stat { flex: 1 1 150px; background: var(--surface); padding: 14px 16px; display: grid; gap: 4px; min-width: 0; }
.stat b { font-size: var(--step-num); font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.stat span { color: var(--ink-2); font-size: var(--step-small); }

/* signature: the 14-day health strip */
.strip { display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); gap: 4px; }
.strip button { border: 0; padding: 0; cursor: pointer; display: grid; gap: 6px; background: none; color: var(--ink-3); font: 500 .7rem/1 var(--font); }
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

/* tables: rows become cards on narrow screens */
.tablewrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: var(--step-small); }
th { text-align: left; font-weight: 500; color: var(--ink-2); padding: 10px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; background: var(--surface); position: sticky; top: 0; }
td { padding: 11px 12px; border-bottom: 1px solid var(--surface-2); vertical-align: middle; }
tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: #fbf9f6; }
td.num, th.num { text-align: right; }
td a.open { font-weight: 600; }
td .acts { display: flex; gap: 14px; justify-content: flex-end; white-space: nowrap; }
td.nw { white-space: nowrap; }
td.clip { max-width: 420px; min-width: 200px; }
td.clip span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; font-size: .75rem; font-weight: 600; white-space: nowrap; background: var(--surface-2); color: var(--ink-2); }
.pill.warn { background: var(--warn-bg); color: var(--warn); }
.pill.bad { background: var(--bad-bg); color: var(--bad); }
.pill.ok { background: var(--ok-bg); color: var(--ok); }
.pill.info { background: var(--info-bg); color: var(--info); }

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
.toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.toolbar .input { width: auto; min-width: 180px; flex: 1 1 200px; }
select.input { padding-right: 32px; }
.inline { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.inline .grow { flex: 1 1 240px; }
.inline label { display: flex; align-items: center; gap: 8px; color: var(--ink-2); font-size: var(--step-small); }
.inline input[type="number"] { width: 6em; }
.seg { display: inline-flex; background: var(--surface-2); border-radius: var(--radius-s); padding: 3px; gap: 3px; }
.seg button { font: 500 var(--step-small)/1 var(--font); border: 0; background: none; color: var(--ink-2); padding: 9px 14px; border-radius: 5px; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--surface); color: var(--ink); box-shadow: var(--shadow); }
.newlink { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: var(--ok-bg); color: var(--ok); border-radius: var(--radius-s); padding: 12px 14px; }
.newlink code { overflow-wrap: anywhere; flex: 1 1 280px; color: var(--ink); }
.bigcode { font-size: 1.5rem; font-weight: 600; letter-spacing: .06em; white-space: nowrap; user-select: all; font-variant-numeric: tabular-nums; }
details summary { cursor: pointer; color: var(--ink-2); font-size: var(--step-small); margin-top: 12px; }
.cause { display: grid; gap: 10px; }
.cause + .cause { border-top: 1px solid var(--surface-2); padding-top: 18px; margin-top: 4px; }
.cause header { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: baseline; justify-content: space-between; }
.cause h3 { margin: 0; font-size: var(--step-body); font-weight: 600; }
.cause p { margin: 0; font-size: var(--step-small); color: var(--ink-2); max-width: 75ch; }
.cause .lead { color: var(--ink); font-weight: 500; }
.cause ul { margin: 0; padding-left: 18px; font-size: var(--step-small); color: var(--ink-2); }

/* toasts + dialog */
.toasts { position: fixed; right: 16px; bottom: 16px; z-index: 50; display: grid; gap: 8px; width: min(380px, calc(100vw - 32px)); }
.toast { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border-radius: var(--radius-s); background: var(--ink); color: #fff; font-size: var(--step-small); box-shadow: var(--shadow); animation: enter .3s var(--ease) both; }
.toast.bad { background: var(--bad); }
dialog { border: 0; border-radius: 14px; padding: 0; width: min(440px, calc(100vw - 32px)); box-shadow: 0 20px 60px -20px rgb(0 0 0 / .45); color: var(--ink); }
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
}
@media (max-width: 720px) {
  table.cards thead { display: none; }
  table.cards, table.cards tbody, table.cards tr, table.cards td { display: block; width: 100%; }
  table.cards tr { padding: 10px 0; border-bottom: 1px solid var(--surface-2); }
  table.cards td { border: 0; padding: 4px 4px; display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 10px; text-align: left; }
  table.cards td::before { content: attr(data-label); color: var(--ink-3); font-size: .78rem; }
  table.cards td.num { text-align: left; }
  table.cards td .acts { justify-content: flex-start; }
  table.cards td.clip { max-width: none; min-width: 0; }
  table.cards td.nw { white-space: normal; }
  .strip i { height: 34px; }
  .strip button span { display: none; }
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
  var state = { data: null, loading: null, updatedAt: 0, view: 'overview', params: {}, issues: null };
  var REFRESH_MS = 60000;

  // ---------------------------------------------------------------- helpers
  function text(n, t) { n.textContent = t == null || t === '' ? '\\u2014' : String(t); return n; }
  function el(tag, cls, t) { var n = document.createElement(tag); if (cls) n.className = cls; if (t !== undefined) text(n, t); return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function icon(name, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls || 'ic'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[name]); s.appendChild(p); return s;
  }
  function when(iso) { if (!iso) return '\\u2014'; var d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function day(iso) { return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '\\u2014'; }
  function ago(ms) { var s = Math.round((Date.now() - ms) / 1000); if (s < 45) return 'just now'; var m = Math.round(s / 60); if (m < 60) return m + ' min ago'; return Math.round(m / 60) + ' h ago'; }
  function num(n) { return n == null ? '\\u2014' : Number(n).toLocaleString(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function tool(n) { return String(n || '').replace(/^teams_/, '').replace(/_/g, ' '); }
  function facts(dl, pairs) { clear(dl); pairs.forEach(function (p) { dl.appendChild(el('dt', '', p[0])); dl.appendChild(el('dd', '', p[1])); }); }
  function personLink(p) { var a = el('a', 'open', p.name || 'Unknown person'); a.href = '#person/' + encodeURIComponent(p.key); return a; }
  function emptyRow(tbody, cols, msg) { var tr = el('tr'); var td = el('td', 'empty', msg); td.colSpan = cols; tr.appendChild(td); tbody.appendChild(tr); }
  function cells(tr, labels, values) {
    values.forEach(function (v, i) { v.setAttribute('data-label', labels[i] || ''); tr.appendChild(v); });
    return tr;
  }
  function td(child, cls) { var t = el('td', cls || ''); if (child && child.nodeType) t.appendChild(child); else text(t, child); return t; }
  function pill(label, kind) { return el('span', 'pill' + (kind ? ' ' + kind : ''), label); }

  // ---------------------------------------------------------------- feedback: toasts, dialog, busy buttons, loading
  function toast(msg, bad) {
    var t = el('div', 'toast' + (bad ? ' bad' : '')); t.setAttribute('role', bad ? 'alert' : 'status');
    t.appendChild(icon(bad ? 'alert' : 'check')); t.appendChild(el('span', '', msg));
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

  // ---------------------------------------------------------------- network: one place for every status
  function ApiError(status, message) { this.status = status; this.message = message; }
  async function api(path, opts) {
    opts = opts || {}; opts.headers = Object.assign({ 'X-Admin': '1' }, opts.headers || {});
    var r;
    try { r = await fetch(path, opts); } catch (e) { throw new ApiError(0, navigator.onLine ? 'The server could not be reached. Check your connection and try again.' : 'You are offline.'); }
    if (r.status === 401) { sessionEnded(); throw new ApiError(401, 'Your session ended.'); }
    var j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) {
      var msg = (j && j.error) || (r.status === 429 ? 'Too many requests. Wait a minute and try again.' : r.status >= 500 ? 'The server had a problem (' + r.status + '). Try again in a moment.' : 'Request failed (' + r.status + ').');
      throw new ApiError(r.status, msg);
    }
    return j;
  }
  function post(path, body) { return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  async function act(btn, fn, okMsg, busyLabel) {
    busy(btn, true, busyLabel);
    try { await fn(); if (okMsg) toast(okMsg); return true; }
    catch (e) { if (e.status !== 401) toast(e.message || 'That did not work.', true); return false; }
    finally { busy(btn, false); }
  }

  // ---------------------------------------------------------------- sign-in and session
  var configured = document.body.getAttribute('data-configured') === '1';
  function showOnly(id) { ['boot', 'signinWrap', 'notset', 'app'].forEach(function (x) { if ($(x)) $(x).hidden = x !== id; }); }
  function sessionEnded() {
    if (!$('app').hidden) { $('signinNote').hidden = false; }
    state.data = null; showOnly('signinWrap'); $('u').focus();
  }
  $('pwToggle').addEventListener('click', function () {
    var show = $('p').type === 'password'; $('p').type = show ? 'text' : 'password';
    this.setAttribute('aria-pressed', String(show)); this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  $('signinForm').addEventListener('submit', async function (e) {
    e.preventDefault(); var btn = $('signinBtn'); $('err').textContent = '';
    if (!$('u').value.trim() || !$('p').value) { $('err').textContent = 'Enter your username and password.'; return; }
    busy(btn, true, 'Signing in');
    try {
      var r = await fetch('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('u').value.trim(), password: $('p').value }) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) { $('err').textContent = r.status === 429 ? 'Too many attempts. Wait a minute and try again.' : (j.error || 'Sign-in failed.'); $('p').select(); return; }
      $('p').value = ''; $('signinNote').hidden = true; await load(true);
    } catch (e2) { $('err').textContent = 'The server could not be reached. Check your connection.'; }
    finally { busy(btn, false); }
  });
  $('out').addEventListener('click', async function () {
    var ok = await confirmDialog('Sign out?', 'You will need your username and password to sign in again.', 'Sign out');
    if (!ok) return;
    try { await api('/admin/logout', { method: 'POST' }); } catch (e) {}
    state.data = null; $('signinNote').hidden = true; showOnly('signinWrap');
  });

  // ---------------------------------------------------------------- loading the shared data
  async function load(force) {
    if (state.loading && !force) return state.loading;
    var btn = $('refresh'); btn.setAttribute('aria-busy', 'true'); $('refreshIcon').classList.add('spinning');
    state.loading = (async function () {
      try {
        state.data = await api('/admin/api/overview'); state.updatedAt = Date.now();
        showOnly('app'); updateMenu(state.data); route(true);
      } catch (e) {
        if (e.status === 401) return;
        if (!state.data) { showOnly('app'); stateBox($('v-' + state.view + '-body') || $('viewError'), 'The dashboard could not load.', e.message, function () { load(true); }, true); }
        else toast(e.message, true);
      } finally {
        btn.removeAttribute('aria-busy'); $('refreshIcon').classList.remove('spinning'); stamp();
      }
    })();
    try { await state.loading; } finally { state.loading = null; }
  }
  function stamp() { text($('stamp'), state.updatedAt ? 'Updated ' + ago(state.updatedAt) : ''); }
  setInterval(stamp, 20000);
  setInterval(function () { if (!document.hidden && state.data && navigator.onLine && (state.view === 'overview' || state.view === 'issues')) load(true); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && state.data && Date.now() - state.updatedAt > REFRESH_MS) load(true); });
  window.addEventListener('offline', function () { $('offline').hidden = false; });
  window.addEventListener('online', function () { $('offline').hidden = true; if (state.data) load(true); });

  function updateMenu(d) {
    setBadge('c-people', d.people.length); setBadge('c-connections', d.connections.length);
    setBadge('c-access', (d.access && d.access.waiting) || 0, true);
    var issuesToday = d.issuesToday || 0; setBadge('c-issues', issuesToday, true);
    text($('ver'), 'v' + d.version);
  }
  function setBadge(id, n, hot) { var b = $(id); if (!b) return; b.textContent = n ? String(n) : ''; b.hidden = !n; b.className = 'badge' + (hot && n ? ' hot' : ''); }

  // ---------------------------------------------------------------- views
  var VIEWS = ['overview', 'issues', 'people', 'person', 'access', 'tools', 'cloud', 'connections', 'activity', 'settings'];
  var TITLES = { overview: 'Overview', issues: 'Issues', people: 'People', person: 'Person', access: 'Access', tools: 'Tools', cloud: 'Cloud', connections: 'Connections', activity: 'Activity', settings: 'Settings' };

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
  function toolTable(tbody, tools, withPeople) {
    clear(tbody); if (!tools.length) return emptyRow(tbody, 6, 'No tool calls in the last 30 days.');
    var labels = ['Tool', 'Calls'].concat(withPeople ? ['People'] : []).concat(['Avg time', 'Avg size', 'Errors']);
    tools.forEach(function (t) {
      var vals = [td(tool(t.name)), td(num(t.calls), 'num')].concat(withPeople ? [td(num(t.people), 'num')] : [])
        .concat([td(num(t.avgMs) + ' ms', 'num'), td(t.avgKb + ' KB', 'num'), td(t.errorRate + '%', 'num')]);
      tbody.appendChild(cells(el('tr'), labels, vals));
    });
  }
  function alertsList(box, alerts, allClear) {
    clear(box);
    if (!alerts.length) { if (allClear) { var ok = el('div', 'allclear'); ok.appendChild(icon('check')); ok.appendChild(el('span', '', 'All clear: no issues need your attention.')); box.appendChild(ok); } return; }
    alerts.forEach(function (a) {
      var row = el(a.link ? 'a' : 'div', 'alert' + (a.level === 'bad' ? ' bad' : ''));
      if (a.link) row.href = a.link;
      row.appendChild(icon('alert')); row.appendChild(el('span', 'grow', a.text));
      if (a.link) { var w = el('span', 'why', 'See why'); w.appendChild(icon('arrow')); row.appendChild(w); }
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

  function renderOverview(d) {
    alertsList($('alerts'), d.alerts, true);
    var k = d.totals;
    [['people', 'People'], ['activeToday', 'Active today'], ['active7', 'Active, 7 days'], ['requestsToday', 'Requests today'], ['toolCallsToday', 'Tool calls today'], ['changesToday', 'Changes today']]
      .forEach(function (p) { text($('k-' + p[0]), num(k[p[0]])); });
    if (d.issueDays) healthStrip($('ovStrip'), d.issueDays, null);
    cols($('daily'), d.daily.map(function (x) { return { v: x.requests, label: day(x.day) }; }));
    text($('dailyFrom'), day(d.daily[0] && d.daily[0].day));
    rank($('topPeople'), d.people.slice(0, 5).map(function (p) { return { label: personLink(p), v: p.share, text: p.share + '%' }; }), 'No usage yet.');
    rank($('topTools'), d.tools.slice(0, 5).map(function (t) { return { label: el('span', '', tool(t.name)), v: t.calls, text: num(t.calls) }; }), 'No tool calls yet.');
    var c = d.cloud, cs = clear($('cloudSummary'));
    if (!c || !c.configured) cs.appendChild(el('p', 'muted', 'Cloud usage is not set up yet. See Cloud.'));
    else if (c.error) cs.appendChild(el('p', 'muted', 'Cloudflare analytics could not be read right now.'));
    else {
      cs.appendChild(el('div', 'big', '$' + c.costNow.toFixed(2))); cs.appendChild(el('p', 'muted', 'this month on ' + c.plan));
      var top = c.limits.slice().sort(function (a, b) { return b.percent - a.percent; })[0];
      if (top) { var row = el('div', 'limitrow'); row.style.marginTop = '14px'; row.appendChild(el('span', '', 'Closest free limit: ' + top.label + ', ' + top.percent + '%'));
        var m = el('div', 'meter'); var i = el('i', top.percent >= 80 ? 'hot' : ''); i.style.width = Math.min(100, top.percent) + '%'; m.appendChild(i); row.appendChild(m); cs.appendChild(row); }
    }
  }

  async function renderIssues() {
    var p = state.params, box = $('issuesBody');
    if (!state.issues) skeleton(box, ['mid', 'tall', '', '', '']);
    var q = ['kind', 'key', 'tool', 'day'].filter(function (k) { return p[k]; }).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
    var r;
    try { r = await api('/admin/api/issues' + (q ? '?' + q : '')); }
    catch (e) { if (e.status !== 401) stateBox(box, 'Issues could not load.', e.message, renderIssues, true); return; }
    state.issues = r; clear(box);

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
    if (active.length) {
      active.forEach(function (k) {
        var label = k === 'day' ? day(p.day) : k === 'tool' ? tool(p.tool) : (r.events[0] && r.events[0].person) || 'One person';
        var c = el('button', 'chip'); c.type = 'button'; c.setAttribute('aria-pressed', 'true'); c.appendChild(el('span', '', label)); c.appendChild(icon('x')); c.setAttribute('aria-label', 'Remove filter: ' + label);
        c.onclick = function () { setParam(k, null); }; bar.appendChild(c);
      });
    }
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
      var right = el('div', 'inline'); right.appendChild(pill(plural(s.count, 'event', 'events') + (s.today ? ', ' + s.today + ' today' : ''), s.kind === 'admin_signin_failed' || s.kind === 'access_denied' ? 'bad' : 'warn')); h.appendChild(right); c.appendChild(h);
      if (s.cause) c.appendChild(el('p', 'lead', 'Main cause: ' + s.cause + '. Last seen ' + when(s.lastAt) + '.'));
      c.appendChild(el('p', '', s.means));
      if (s.details.length) {
        var ul = el('ul'); s.details.forEach(function (x) { ul.appendChild(el('li', '', x.value + (x.count > 1 ? ' (' + x.count + '\\u00d7)' : ''))); }); c.appendChild(ul);
      }
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
    t.innerHTML = '<thead><tr><th>When</th><th>Issue</th><th>Person</th><th>Tool</th><th>Details</th></tr></thead>';
    var tb = el('tbody'); t.appendChild(tb); wrap.appendChild(t); list.appendChild(wrap);
    if (!r.events.length) emptyRow(tb, 5, 'No events match these filters.');
    r.events.forEach(function (e) {
      var who = e.key ? personLink({ key: e.key, name: e.person }) : el('span', 'faint', 'Unknown');
      tb.appendChild(cells(el('tr'), ['When', 'Issue', 'Person', 'Tool', 'Details'], [
        td(when(e.at), 'nw'), td(pill(e.label, e.kind === 'admin_signin_failed' || e.kind === 'access_denied' ? 'bad' : 'warn')), td(who, 'nw'), td(e.tool ? tool(e.tool) : '\\u2014'), (function () { var c = el('td', 'clip'); c.appendChild(el('span', '', e.detail || '\\u2014')); c.title = e.detail || ''; return c; })(),
      ]));
    });
    if (r.events.length >= 300) list.appendChild(el('p', 'muted', 'Showing the latest 300 events. Narrow the filters to see older ones.'));
    box.appendChild(list);
  }
  function setParam(k, v) {
    var p = Object.assign({}, state.params); if (v) p[k] = v; else delete p[k];
    var q = Object.keys(p).filter(function (x) { return p[x]; }).map(function (x) { return x + '=' + encodeURIComponent(p[x]); }).join('&');
    location.hash = '#issues' + (q ? '?' + q : '');
  }

  function renderPeople(d) {
    var tb = clear($('people'));
    if (!d.people.length) return emptyRow(tb, 10, 'No usage recorded yet. People appear here after their first tool call.');
    var max = Math.max.apply(null, d.people.map(function (p) { return p.share; }).concat([1]));
    var labels = ['Person', 'Apps', 'Requests', 'Share', 'Tool calls', 'Changes', 'Searches', 'Errors', 'Top tool', 'Last active'];
    d.people.forEach(function (p) {
      var share = el('td'); var w = el('div', 'inline'); var bar = el('i'); bar.style.cssText = 'display:block;height:8px;border-radius:4px;background:var(--ink);width:' + Math.max(2, p.share / max * 90) + 'px'; w.appendChild(bar); w.appendChild(el('span', 'num', p.share + '%')); share.appendChild(w);
      tb.appendChild(cells(el('tr'), labels, [td(personLink(p)), td(p.apps.join(', ') || '\\u2014'), td(num(p.totals.requests), 'num'), share,
        td(num(p.totals.toolCalls), 'num'), td(num(p.totals.changes), 'num'), td(num(p.totals.searches), 'num'), td(num(p.totals.errors), 'num'), td(tool(p.topTool) || '\\u2014'), td(when(p.lastActive))]));
    });
    text($('privacy'), d.privacy);
  }

  function renderTools(d) { toolTable($('tools'), d.tools, true); heat($('hours'), d.hours); }

  function renderCloud(d) {
    var c = d.cloud, box = clear($('cloud'));
    if (!c || !c.configured) { stateBox(box, 'Cloud usage is not set up.', (c && c.note) || 'Add a read-only CF_ANALYTICS_TOKEN secret to see costs and free-plan limits here.'); return; }
    if (c.error) { stateBox(box, 'Cloudflare analytics could not be read.', c.error, function () { load(true); }, true); return; }
    var g = el('div', 'grid2');
    var left = el('section', 'panel'); left.appendChild(el('div', 'big', '$' + c.costNow.toFixed(2)));
    left.appendChild(el('p', 'muted', 'Spent this month on ' + c.plan + '. At this pace the paid plan would cost about $' + c.paidEstimate.total.toFixed(2) + ' a month ($5 base plus usage).'));
    var dl = el('dl', 'facts'); dl.style.marginTop = '16px';
    facts(dl, [['Requests this month', num(c.month.requests)], ['Projected for 30 days', num(c.projectedMonth.requests)], ['Errors this month', num(c.month.errors)],
      ['CPU per request (median, today)', c.today.cpuP50Ms + ' ms'], ['Database rows read / written this month', num(c.month.rowsRead) + ' / ' + num(c.month.rowsWritten)]]);
    left.appendChild(dl);
    var right = el('section', 'panel'); right.appendChild(el('h2', '', 'Free plan limits'));
    c.limits.forEach(function (l) {
      var row = el('div', 'limitrow'); row.appendChild(el('span', '', l.label + ': ' + num(l.used) + ' of ' + num(l.limit) + ' (' + l.percent + '%)'));
      var m = el('div', 'meter'); var i = el('i', l.percent >= 80 ? 'hot' : ''); i.style.width = Math.min(100, l.percent) + '%'; m.appendChild(i); row.appendChild(m); right.appendChild(row);
    });
    right.appendChild(el('p', 'muted', 'From Cloudflare analytics, a few minutes behind. Updated ' + when(c.asOf) + '.'));
    g.appendChild(left); g.appendChild(right); box.appendChild(g);
  }

  function renderConnections(d) {
    var onlyOld = state.params.filter === 'refresh';
    $('connAll').setAttribute('aria-pressed', String(!onlyOld)); $('connOld').setAttribute('aria-pressed', String(onlyOld));
    var list = d.connections.filter(function (c) { return !onlyOld || !c.toolsUpToDate; });
    text($('connOldN'), num(d.connections.filter(function (c) { return !c.toolsUpToDate; }).length));
    text($('connAllN'), num(d.connections.length));
    var tb = clear($('conn'));
    if (!list.length) return emptyRow(tb, 7, onlyOld ? 'Everyone has the current tool list.' : 'No connections yet.');
    var labels = ['Person', 'App', 'Created', 'Last used', 'Ends if unused', 'Tools', ''];
    list.forEach(function (c) {
      var b = el('button', 'act bad', 'End'); b.type = 'button'; b.setAttribute('aria-label', 'End connection for ' + (c.person || 'unknown person'));
      b.addEventListener('click', async function () {
        if (!await confirmDialog('End this connection?', 'The app using it (' + (c.app || 'unknown app') + ') will need to sign in again.', 'End connection', true)) return;
        if (await act(b, function () { return post('/admin/api/connections/' + c.id + '/end'); }, 'Connection ended.')) load(true);
      });
      var a = el('td'); var w = el('div', 'acts'); w.appendChild(b); a.appendChild(w);
      tb.appendChild(cells(el('tr'), labels, [td(c.person || 'Unknown', 'nw'), td(c.app || 'Unknown app'), td(when(c.createdAt), 'nw'), td(when(c.lastUsedAt), 'nw'), td(day(c.expiresAt), 'nw'),
        td(c.toolsUpToDate ? pill('Up to date', 'ok') : pill('Needs refresh', 'warn')), a]));
    });
  }

  function renderActivity(d) {
    var a = d.adoption;
    facts($('adoption'), [['Active today / 7 days / 30 days', a.activeToday + ' / ' + a.active7 + ' / ' + a.active30], ['New people this week', a.newThisWeek],
      ['Connected but never used', a.neverUsed], ['Idle for 30+ days', a.idle30], ['Ending within 14 days (unused)', a.expiring14],
      ['Apps', Object.keys(a.appMix).map(function (x) { return x + ' ' + a.appMix[x]; }).join(', ') || '\\u2014'], ['Registered apps', d.totals.registeredApps], ['Connections', d.totals.connections]]);
    var names = { signin: 'Sign-ins', signout: 'Sign-outs', expired: 'Expired (90 days unused)', signin_not_allowed: 'Refused sign-ins', signin_bad_access_code: 'Wrong access code',
      rate_limited_ip: 'Rate-limited (per IP)', rate_limited_user: 'Rate-limited (per person)', rate_limited_heavy: 'Search limit hit', rate_limited_write: 'Change limit hit', daily_write_cap: 'Daily change cap hit',
      admin_signin_failed: 'Failed admin sign-ins', admin_ended_connection: 'Connections ended by admin', access_denied: 'Connections cut off', invite_accepted: 'Invites accepted', error: 'Server errors', cleanup_run: 'Nightly cleanups' };
    var keys = Object.keys(names).filter(function (m) { return d.events[m] !== undefined; });
    if (keys.length) facts($('events'), keys.map(function (m) { return [names[m], num(d.events[m])]; }));
    else { clear($('events')); $('events').appendChild(el('dd', 'empty', 'Nothing in the last 14 days.')); }
  }

  function renderSettings(d) {
    var s = d.settings, l = d.limits, m = d.microsoft;
    facts($('settings'), [['Version', 'v' + d.version], ['Access', s.restricted ? 'Restricted (see Access)' : 'Open to any personal account'], ['Access code required', s.accessCodeRequired ? 'Yes' : 'No'],
      ['Allow-list', s.allowListSize ? plural(s.allowListSize, 'account', 'accounts') : 'Off'], ['Personal URLs', s.personalUrls ? 'On' : 'Off (connectors only)'], ['New-connection notes', s.alerts ? 'On' : 'Off'], ['Last nightly cleanup', d.lastCleanup || 'Not yet']]);
    facts($('limits'), [['Requests', l.requestsPerMinute + ' a minute per person'], ['Searches across chats', l.searchesPerMinute + ' a minute per person'],
      ['Changes', l.changesPerMinute + ' a minute and ' + l.changesPerDay + ' a day per person'], ['Connections end after', l.inactiveDays + ' days unused']]);
    facts($('microsoft'), [['Shown to people as', m.shownAs], ['Microsoft app id', m.clientId], ['Where people manage it', m.permissionsPage.replace('https://', '')]]);
    text($('msnote'), m.note);
  }

  async function renderPerson(key) {
    var box = $('personBody'); skeleton(box); text($('pName'), 'Loading person');
    var d;
    try { d = await api('/admin/api/person/' + encodeURIComponent(key)); }
    catch (e) { if (e.status !== 401) { text($('pName'), 'Person'); stateBox(box, e.status === 404 ? 'No usage or connections for this person yet.' : 'This person could not load.', e.status === 404 ? '' : e.message, e.status === 404 ? null : function () { renderPerson(key); }, e.status !== 404); } return; }
    var p = d.person; clear(box);
    text($('pName'), p.name || 'Unknown person'); document.title = (p.name || 'Person') + ' \\u00b7 Admin';
    $('pIssues').href = '#issues?key=' + encodeURIComponent(key);
    var tpl = $('personTpl').content.cloneNode(true); box.appendChild(tpl);
    [['pReq', p.totals.requests], ['pTools', p.totals.toolCalls], ['pChanges', p.totals.changes], ['pSearch', p.totals.searches]].forEach(function (x) { text($(x[0]), num(x[1])); });
    facts($('pFacts'), [['First connected', day(p.firstConnected)], ['Last active', when(p.lastActive)], ['Active days (30)', p.activeDays], ['Apps', p.apps.join(', ')],
      ['Connections', p.connections], ['Share of all requests', p.share + '%'], ['Data returned to Claude (30 days)', num(p.totals.kb) + ' KB'], ['Calls to Microsoft (30 days)', num(p.totals.teamsCalls)]]);
    cols($('pDaily'), d.daily.map(function (x) { return { v: x.toolCalls, label: day(x.day), w: x.changes }; }), function (v) { return v.w > 0; });
    heat($('pHours'), d.hours);
    toolTable($('pToolTable'), d.tools, false);
    var avg = p.totals.toolCalls ? Math.round(p.totals.ms / p.totals.toolCalls) : 0;
    facts($('pHealth'), [['Errors (30 days)', num(p.totals.errors)], ['Refused by limits', num(p.totals.rateLimited)], ['Slowed down by Microsoft', num(p.totals.throttled)], ['Average tool time', avg + ' ms']]);
    text($('pCapToday'), p.today.changes + ' of ' + p.dailyCap + ' changes used today (' + p.capUsedToday + '%)');
    var mi = $('pCapMeter'); mi.style.width = Math.min(100, p.capUsedToday) + '%'; mi.className = p.capUsedToday >= 80 ? 'hot' : '';
    $('pCap').value = d.capOverride == null ? '' : d.capOverride; $('pCap').placeholder = String(d.defaultCap);
    $('pCapForm').onsubmit = async function (e) {
      e.preventDefault(); var v = $('pCap').value.trim();
      if (v !== '' && !/^[0-9]+$/.test(v)) { $('pCapMsg').textContent = 'Enter a whole number, or leave it empty for the default.'; return; }
      $('pCapMsg').textContent = '';
      await act($('pCapSave'), function () { return post('/admin/api/person/' + encodeURIComponent(key) + '/limit', { dailyWrites: v === '' ? null : Number(v) }); }, v === '' ? 'Back to the default limit.' : 'Saved: ' + v + ' changes a day.', 'Saving');
    };
    $('pCsv').href = '/admin/api/person/' + encodeURIComponent(key) + '/csv';
    $('pEnd').onclick = async function () {
      if (!await confirmDialog('End all connections for ' + (p.name || 'this person') + '?', 'Every app they connected will need to sign in again.', 'End all', true)) return;
      var r2 = null;
      if (await act($('pEnd'), async function () { r2 = await post('/admin/api/person/' + encodeURIComponent(key) + '/end'); }, null, 'Ending')) toast('Ended ' + plural((r2 && r2.ended) || 0, 'connection', 'connections') + '.');
    };
  }

  // ---------------------------------------------------------------- access
  function how(p, groups) {
    var v = p.via || '';
    if (v.indexOf('group:') === 0) return 'Group: ' + (groups[v.slice(6)] || 'a Teams group');
    if (v.indexOf('invite:') === 0) return 'Invite' + (v.length > 7 ? ': ' + v.slice(7) : '');
    return { admin: 'Approved by you', 'admin account': 'Your admin account', 'allow-list': 'Allow-list', 'connected before': 'Connected before access was restricted', 'left group': 'Left their group' }[v] || '\\u2014';
  }
  function decide(p, action, title, body, okMsg) {
    return async function () {
      var btn = this;
      if (title && !await confirmDialog(title, body, action.charAt(0).toUpperCase() + action.slice(1), action === 'block' || action === 'remove')) return;
      if (await act(btn, function () { return post('/admin/api/access/people/' + p.key + '/' + action); }, okMsg)) load(true);
    };
  }
  function actBtn(label, cls, fn) { var b = el('button', 'act' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function actsCell(buttons) { var t = el('td'); var w = el('div', 'acts'); buttons.forEach(function (b) { w.appendChild(b); }); t.appendChild(w); return t; }

  async function renderAccess() {
    var box = $('accessBody'); if (!box.dataset.ready) skeleton(box);
    var a;
    try { a = await api('/admin/api/access'); } catch (e) { if (e.status !== 401) stateBox(box, 'Access could not load.', e.message, renderAccess, true); return; }
    if (!box.dataset.ready) { clear(box); box.appendChild($('accessTpl').content.cloneNode(true)); box.dataset.ready = '1'; wireAccess(); }
    renderMe();
    var groups = a.groupNames || {};
    $('modeRestricted').setAttribute('aria-pressed', String(a.restricted)); $('modeOpen').setAttribute('aria-pressed', String(!a.restricted));
    text($('modeNote'), a.restricted
      ? 'Restricted' + (a.restrictedSince ? ' since ' + day(a.restrictedSince) : '') + ': only members of your groups, invited and approved people can connect. Everyone else is refused, nothing of theirs is stored, and they wait here.'
      : 'Open: any personal Microsoft account can connect to this server.');
    var waiting = a.people.filter(function (p) { return p.status === 'pending' || p.status === 'review'; });
    text($('waitingCount'), waiting.length ? '(' + waiting.length + ')' : '');
    var tb = clear($('aWaiting'));
    if (!waiting.length) emptyRow(tb, 5, 'Nobody is waiting.');
    waiting.forEach(function (p) {
      tb.appendChild(cells(el('tr'), ['Person', 'Why', 'When', 'Tries', ''], [td(p.status === 'review' ? personLink(p) : el('span', '', p.name || 'Unknown person')),
        td(p.status === 'review' ? 'Already connected (still works)' : p.via === 'left group' ? 'Left their group' : 'Asked to join'), td(when(p.requestedAt || p.updatedAt)), td(p.status === 'pending' ? num(p.attempts) : '\\u2014', 'num'),
        actsCell([actBtn('Approve', '', decide(p, 'approve', null, null, (p.name || 'Person') + ' approved.')),
          p.status === 'review' ? actBtn('Remove', 'bad', decide(p, 'remove', 'Remove ' + (p.name || 'this person') + '?', 'Their connections end now.', 'Removed.'))
            : actBtn('Block', 'bad', decide(p, 'block', 'Block ' + (p.name || 'this person') + '?', 'They will not be able to ask again.', 'Blocked.'))])]));
    });
    tb = clear($('aGroups'));
    if (!a.groups.length) emptyRow(tb, 4, 'No groups yet. Search your group chats below to add one.');
    a.groups.forEach(function (g) {
      var idc = td(el('code', '', g.id.length > 22 ? g.id.slice(0, 22) + '\\u2026' : g.id)); idc.title = g.id;
      tb.appendChild(cells(el('tr'), ['Group', 'Chat id', 'People in', ''], [td(g.name || 'Name shows after the first check'), idc, td(num(g.members), 'num'),
        actsCell([actBtn('Remove', 'bad', async function () {
          var b = this;
          if (!await confirmDialog('Remove this group?', 'Its members lose access at their next daily check, unless another group or an approval lets them in.', 'Remove group', true)) return;
          if (await act(b, function () { return post('/admin/api/access/groups/remove', { conversationId: g.id }); }, 'Group removed.')) { state.mine = null; load(true); }
        })])]));
    });
    tb = clear($('aInvites'));
    if (!a.invites.length) emptyRow(tb, 5, 'No invite links yet.');
    a.invites.forEach(function (i) {
      tb.appendChild(cells(el('tr'), ['Label', 'Uses left', 'Used', 'Ends', ''], [td(i.label || '\\u2014'), td(num(i.usesLeft), 'num'), td(num(i.used), 'num'), td(i.active ? day(i.expiresAt) : pill('Ended')),
        actsCell(i.active ? [actBtn('Revoke', 'bad', async function () {
          var b = this;
          if (!await confirmDialog('Revoke this invite link?', 'People who already joined keep access.', 'Revoke', true)) return;
          if (await act(b, function () { return post('/admin/api/access/invites/' + i.id + '/revoke'); }, 'Invite revoked.')) load(true);
        })] : [])]));
    });
    var allowed = a.people.filter(function (p) { return p.status === 'member' || p.status === 'approved'; });
    allowed.sort(function (x, y) { return (y.key === a.adminKey) - (x.key === a.adminKey); });
    tb = clear($('aAllowed'));
    if (!allowed.length) emptyRow(tb, 4, 'Nobody yet.');
    allowed.forEach(function (p) {
      var name = td(personLink(p)); if (p.key === a.adminKey) name.appendChild(el('span', 'faint', ' (you)'));
      tb.appendChild(cells(el('tr'), ['Person', 'How', 'Since', ''], [name, td(how(p, groups)), td(day(p.updatedAt)),
        actsCell(p.key === a.adminKey ? [] : [actBtn('Remove', 'bad', decide(p, 'remove', 'Remove ' + (p.name || 'this person') + '?', 'Their connections end now; they can ask again or get in through a group.', 'Removed.')),
          actBtn('Block', 'bad', decide(p, 'block', 'Block ' + (p.name || 'this person') + '?', 'Their connections end now and they cannot get back in.', 'Blocked.'))])]));
    });
    var blocked = a.people.filter(function (p) { return p.status === 'blocked'; });
    tb = clear($('aBlocked'));
    if (!blocked.length) emptyRow(tb, 3, 'Nobody is blocked.');
    blocked.forEach(function (p) {
      tb.appendChild(cells(el('tr'), ['Person', 'Since', ''], [td(p.name || 'Unknown person'), td(day(p.updatedAt)), actsCell([actBtn('Unblock', '', decide(p, 'unblock', null, null, 'Unblocked.'))])]));
    });
  }

  var linkTimer = null;
  async function renderMe() {
    var me; try { me = await api('/admin/api/teams'); } catch (e) { return; }
    $('meLinked').hidden = !me.linked; $('meUnlinked').hidden = me.linked || !$('meCode').hidden;
    if (me.linked) { text($('meName'), me.name || 'Your account'); text($('meSince'), 'linked ' + day(me.linkedAt)); }
    $('gPick').hidden = !me.linked; $('gNeedLink').hidden = me.linked;
    if (me.linked) loadMine(false);
  }
  async function loadMine(force) {
    if (!force && state.mine && Date.now() - state.mineAt < 60000) return showMine();
    var tb = clear($('gResults')); var tr = el('tr'); var c = el('td'); c.colSpan = 3; skeleton(c, ['', '', '']); tr.appendChild(c); tb.appendChild(tr);
    text($('gSearchNote'), 'Loading your group chats (this can take a few seconds)');
    try { var j = await api('/admin/api/access/my-groups'); state.mine = j.groups; state.mineAt = Date.now(); showMine(); }
    catch (e) { clear($('gResults')); $('gSearchNote').textContent = e.message; if (e.status === 409) { $('gPick').hidden = true; $('gNeedLink').hidden = false; } }
  }
  function label(g) { return g.title || ('Untitled group' + (g.lastFrom ? ', last message from ' + g.lastFrom : '')); }
  function showMine() {
    var q = $('gSearch').value.trim().toLowerCase();
    var list = state.mine.filter(function (g) { return !q || label(g).toLowerCase().indexOf(q) >= 0; });
    $('gSearchNote').textContent = q ? list.length + ' of your ' + state.mine.length + ' group chats match.' : 'You are in ' + state.mine.length + ' group chats.';
    var tb = clear($('gResults'));
    if (!list.length) emptyRow(tb, 3, q ? 'No group chat matches "' + q + '".' : 'No group chats found.');
    list.forEach(function (g) {
      tb.appendChild(cells(el('tr'), ['Group chat', 'Last active', ''], [td(label(g)), td(when(g.lastActive)), g.added ? actsCell([pill('Added', 'ok')]) : actsCell([actBtn('Add', '', async function () {
        var b = this;
        if (await act(b, function () { return post('/admin/api/access/groups', { conversationId: g.id, name: g.title || '' }); }, 'Group added: ' + label(g) + '.')) { g.added = true; showMine(); load(true); }
      })])]));
    });
  }
  function wireAccess() {
    async function setMode(mode, btn) {
      if (mode === 'open' && !await confirmDialog('Open access to everyone?', 'Any personal Microsoft account will be able to connect to this server.', 'Open access', true)) return;
      if (await act(btn, function () { return post('/admin/api/access/mode', { mode: mode }); }, mode === 'open' ? 'Access is open.' : 'Access is restricted.')) load(true);
    }
    $('modeRestricted').addEventListener('click', function () { setMode('restricted', this); });
    $('modeOpen').addEventListener('click', function () { setMode('open', this); });
    $('groupForm').addEventListener('submit', async function (e) {
      e.preventDefault(); $('gMsg').textContent = '';
      var id = $('gId').value.trim();
      if (!/^19:[A-Za-z0-9_.-]+@thread[.](v2|skype)$/.test(id)) { $('gMsg').textContent = 'That is not a group chat id. It looks like 19:...@thread.v2.'; return; }
      if (await act($('groupAdd'), function () { return post('/admin/api/access/groups', { conversationId: id, name: $('gName').value.trim() }); }, 'Group added.', 'Adding')) { $('gId').value = ''; $('gName').value = ''; load(true); }
    });
    $('inviteForm').addEventListener('submit', async function (e) {
      e.preventDefault(); $('iMsg').textContent = '';
      var j = null;
      if (await act($('inviteCreate'), async function () { j = await post('/admin/api/access/invites', { label: $('iLabel').value.trim(), uses: Number($('iUses').value), days: Number($('iDays').value) }); }, 'Invite link created.', 'Creating')) {
        $('newLinkText').textContent = j.link; $('newLink').hidden = false; $('iLabel').value = ''; load(true);
      }
    });
    $('copyLink').addEventListener('click', function () { var b = this; navigator.clipboard.writeText($('newLinkText').textContent).then(function () { toast('Invite link copied.'); }, function () { toast('Copy failed: select the link and copy it.', true); }); });
    $('meLink').addEventListener('click', async function () {
      var b = this, j = null;
      if (!await act(b, async function () { j = await post('/admin/api/teams/link/start'); }, null, 'Getting a code')) return;
      $('meUnlinked').hidden = true; $('meCode').hidden = false;
      text($('meUserCode'), j.userCode); $('meUrl').href = j.verificationUrl; text($('meUrl'), j.verificationUrl.replace('https://', '').replace('http://', ''));
      $('meCopy').onclick = function () { navigator.clipboard.writeText(j.userCode).then(function () { toast('Code copied.'); }); };
      pollLink(j.interval);
    });
    $('meUnlink').addEventListener('click', async function () {
      var b = this;
      if (!await confirmDialog('Unlink your Teams account?', 'Your account keeps its access; group search stops until you link again.', 'Unlink', true)) return;
      if (await act(b, function () { return post('/admin/api/teams/unlink'); }, 'Teams account unlinked.')) { state.mine = null; load(true); }
    });
    $('gSearch').addEventListener('input', function () { if (state.mine) showMine(); });
    $('gReload').addEventListener('click', function () { loadMine(true); });
  }
  function pollLink(sec) {
    clearTimeout(linkTimer);
    linkTimer = setTimeout(async function () {
      var j;
      try { j = await post('/admin/api/teams/link/poll'); } catch (e) { j = { status: 'error', error: e.message }; }
      if (j.status === 'pending') return pollLink((j.interval || 5) + 1);
      $('meCode').hidden = true;
      if (j.status === 'linked') { toast('Teams account linked: ' + (j.name || 'your account') + '.'); state.mine = null; load(true); return; }
      $('meUnlinked').hidden = false; toast(j.error || 'Linking failed. Try again.', true);
    }, Math.max(4, sec) * 1000);
  }

  // ---------------------------------------------------------------- routing
  var RENDER = { overview: renderOverview, people: renderPeople, tools: renderTools, cloud: renderCloud, connections: renderConnections, activity: renderActivity, settings: renderSettings };
  function parseHash() {
    var h = decodeURIComponent((location.hash || '#overview').slice(1));
    var q = h.indexOf('?'); var path = q >= 0 ? h.slice(0, q) : h; var query = q >= 0 ? h.slice(q + 1) : '';
    var parts = path.split('/'); var view = VIEWS.indexOf(parts[0]) >= 0 ? parts[0] : 'overview';
    var params = {};
    query.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) params[kv.slice(0, i)] = kv.slice(i + 1); });
    if (view === 'issues' && parts[1]) params.kind = parts[1];
    if (view === 'connections' && parts[1]) params.filter = parts[1];
    return { view: view, arg: parts.slice(1).join('/'), params: params };
  }
  function route(keepScroll) {
    var r = parseHash(); var changed = r.view !== state.view;
    state.view = r.view; state.params = r.params;
    VIEWS.forEach(function (v) { $('v-' + v).hidden = v !== r.view; });
    Array.prototype.forEach.call(document.querySelectorAll('.menu a'), function (a) {
      var target = a.getAttribute('href').slice(1); var on = target === r.view || (r.view === 'person' && target === 'people');
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = TITLES[r.view] + ' \\u00b7 Admin';
    if (changed && !keepScroll) { window.scrollTo(0, 0); var h1 = document.querySelector('#v-' + r.view + ' h1'); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); } }
    if (r.view === 'person') return renderPerson(r.arg);
    if (r.view === 'issues') return renderIssues();
    if (r.view === 'access') return renderAccess();
    if (state.data) RENDER[r.view](state.data);
  }
  window.addEventListener('hashchange', function () { if (!state.data) load(); else route(); });
  $('refresh').addEventListener('click', function () { state.issues = state.view === 'issues' ? state.issues : null; load(true); });
  $('connAll').addEventListener('click', function () { location.hash = '#connections'; });
  $('connOld').addEventListener('click', function () { location.hash = '#connections/refresh'; });

  // ---------------------------------------------------------------- start
  if (!navigator.onLine) $('offline').hidden = false;
  if (!configured) showOnly('notset');
  else load();
})();`;

const stat = (id, label) => `<div class="stat"><b id="${id}">&nbsp;</b><span>${label}</span></div>`;
const navItem = (id, label, badge) => `<li><a href="#${id}">${svg(id)}<span class="label grow">${label}</span>${badge ? `<span class="badge" id="${badge}" hidden></span>` : ''}</a></li>`;
const table = (id, headers) => `<div class="tablewrap"><table class="cards"><thead><tr>${headers.map((h) => `<th${/^(Calls|People|Avg|Errors|Requests|Tool calls|Changes|Searches|Uses left|Used|Tries|People in)/.test(h) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody id="${id}"></tbody></table></div>`;

export function renderAdminPage({ configured }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin · Teams Personal MCP</title><meta name="robots" content="noindex"><meta name="theme-color" content="#1f1a17">
<link rel="preconnect" href="https://api.fontshare.com"><link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=switzer@400,500,600&display=swap" rel="stylesheet">
<style>${CSS}</style></head>
<body data-configured="${configured ? '1' : '0'}">
<div class="offline" id="offline" hidden role="status">${svg('wifi')}<span>You are offline. The page will refresh when the connection is back.</span></div>

<div class="center" id="boot" role="status"><div class="boot"><span class="spin"></span><span>Checking your session</span></div></div>

<div class="center" id="signinWrap" hidden>
  <form class="signin" id="signinForm" novalidate>
    <div><h1>Admin</h1></div>
    <p>Teams Personal MCP. Sign in with the admin username and password set in Cloudflare.</p>
    <p class="notice" id="signinNote" hidden>Your session ended. Sign in again to carry on where you were.</p>
    <label class="field" for="u">Username<input class="input" id="u" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
    <label class="field" for="p">Password<span class="pw"><input class="input" id="p" type="password" autocomplete="current-password" required><button type="button" id="pwToggle" aria-pressed="false" aria-label="Show password">${svg('eye')}</button></span></label>
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
      ${navItem('tools', 'Tools')}
      ${navItem('cloud', 'Cloud')}
      ${navItem('connections', 'Connections', 'c-connections')}
      ${navItem('activity', 'Activity')}
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

  <main class="content" id="main">
    <div id="viewError"></div>

    <section class="view" id="v-overview" aria-labelledby="h-overview">
      <div class="head"><div><h1 id="h-overview">Overview</h1><p>Today at a glance. Anything that needs you is listed first; each item links to its cause.</p></div></div>
      <div class="alerts" id="alerts" aria-live="polite"></div>
      <div class="stats">${stat('k-people', 'People')}${stat('k-activeToday', 'Active today')}${stat('k-active7', 'Active, 7 days')}${stat('k-requestsToday', 'Requests today')}${stat('k-toolCallsToday', 'Tool calls today')}${stat('k-changesToday', 'Changes today')}</div>
      <section class="panel"><div class="head" style="margin-bottom:12px"><h2 style="margin:0">Health, last 14 days</h2><a class="link" href="#issues">All issues</a></div><div class="strip" id="ovStrip"></div></section>
      <div class="grid2">
        <section class="panel"><h2>Requests per day</h2><div class="cols" id="daily"></div><div class="axis"><span id="dailyFrom"></span><span>today</span></div></section>
        <section class="panel"><h2>Cloud</h2><div id="cloudSummary"></div></section>
      </div>
      <div class="grid2">
        <section class="panel"><div class="head" style="margin-bottom:12px"><h2 style="margin:0">Top people</h2><a class="link" href="#people">All people</a></div><ul class="rank" id="topPeople"></ul></section>
        <section class="panel"><div class="head" style="margin-bottom:12px"><h2 style="margin:0">Top tools</h2><a class="link" href="#tools">All tools</a></div><ul class="rank" id="topTools"></ul></section>
      </div>
    </section>

    <section class="view" id="v-issues" hidden aria-labelledby="h-issues">
      <div class="head"><div><h1 id="h-issues">Issues</h1><p>What went wrong, for whom, in which tool, and what to do. Pick a day, kind, person or tool to narrow it down.</p></div></div>
      <div id="issuesBody"></div>
    </section>

    <section class="view" id="v-people" hidden aria-labelledby="h-people">
      <div class="head"><div><h1 id="h-people">People</h1><p>Last 30 days. Select a name for their usage, limits and issues.</p></div></div>
      <section class="panel">${table('people', ['Person', 'Apps', 'Requests', 'Share', 'Tool calls', 'Changes', 'Searches', 'Errors', 'Top tool', 'Last active'])}</section>
      <p class="muted" id="privacy"></p>
    </section>

    <section class="view" id="v-person" hidden aria-labelledby="pName">
      <div class="head"><div><h1 id="pName">Person</h1></div><div class="inline"><a class="btn quiet small" id="pIssues" href="#issues">${svg('issues')}Issues for this person</a><a class="link" href="#people">All people</a></div></div>
      <div id="personBody"></div>
      <template id="personTpl">
        <div class="stats">${stat('pReq', 'Requests, 30 days')}${stat('pTools', 'Tool calls')}${stat('pChanges', 'Changes')}${stat('pSearch', 'Searches')}</div>
        <div class="grid2">
          <section class="panel"><h2>About</h2><dl class="facts" id="pFacts"></dl></section>
          <section class="panel"><h2>Daily change limit</h2>
            <p class="muted" id="pCapToday"></p><div class="meter" style="margin:10px 0 16px"><i id="pCapMeter"></i></div>
            <form class="inline" id="pCapForm" novalidate><label for="pCap">Changes a day</label><input class="input" id="pCap" inputmode="numeric" style="width:7em"><button class="btn quiet" type="submit" id="pCapSave">Save</button></form>
            <p class="msg-err" id="pCapMsg" role="alert" style="margin-top:8px"></p>
            <div class="inline" style="margin-top:12px"><a class="btn quiet" id="pCsv" href="#" download>Export CSV</a><button class="btn danger" type="button" id="pEnd">End all connections</button></div>
          </section>
        </div>
        <div class="grid2">
          <section class="panel"><h2>Tool calls per day</h2><div class="cols" id="pDaily"></div><p class="muted" style="margin-top:8px">Red days include changes to Teams.</p></section>
          <section class="panel"><h2>When they use it (UTC)</h2><div class="heat" id="pHours"></div><div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></section>
        </div>
        <div class="grid2">
          <section class="panel"><h2>Their tools</h2>${table('pToolTable', ['Tool', 'Calls', 'Avg time', 'Avg size', 'Errors'])}</section>
          <section class="panel"><h2>Health</h2><dl class="facts" id="pHealth"></dl></section>
        </div>
      </template>
    </section>

    <section class="view" id="v-access" hidden aria-labelledby="h-access">
      <div class="head"><div><h1 id="h-access">Access</h1><p>Who can use this server.</p></div></div>
      <div id="accessBody"></div>
      <template id="accessTpl">
        <section class="panel">
          <div class="head" style="margin-bottom:8px"><h2 style="margin:0">Who can connect</h2><div class="seg" role="group" aria-label="Who can connect"><button type="button" id="modeRestricted" aria-pressed="false">Restricted</button><button type="button" id="modeOpen" aria-pressed="false">Open</button></div></div>
          <p class="muted" id="modeNote"></p>
        </section>
        <section class="panel">
          <div class="head" id="meLinked" hidden style="align-items:center"><p style="margin:0;color:var(--ink)">Your Teams account: <b id="meName"></b> <span class="faint" id="meSince"></span>. It always has access and is used here only to list your group chats.</p><button class="btn quiet small" type="button" id="meUnlink">Unlink</button></div>
          <div class="head" id="meUnlinked" hidden style="align-items:center"><p style="margin:0">Link your own Teams account: it always has access, and you can pick groups from your group chats.</p><button class="btn" type="button" id="meLink">Link my Teams account</button></div>
          <div id="meCode" hidden><p class="muted">Enter this code at <a id="meUrl" target="_blank" rel="noopener"></a> and sign in with your personal Microsoft account.</p>
            <div class="inline" style="margin-top:10px"><span class="bigcode" id="meUserCode"></span><button class="btn quiet small" type="button" id="meCopy">Copy code</button></div>
            <p class="muted inline" style="margin-top:10px"><span class="spin"></span>Waiting for you to approve at Microsoft</p></div>
        </section>
        <section class="panel"><h2>Waiting <span class="faint" id="waitingCount"></span></h2>${table('aWaiting', ['Person', 'Why', 'When', 'Tries', ''])}</section>
        <section class="panel"><h2>Teams groups</h2>
          <p class="muted" style="margin-bottom:12px">Members of these group chats get in automatically and are re-checked daily; leaving the group ends their access.</p>
          ${table('aGroups', ['Group', 'Chat id', 'People in', ''])}
          <div id="gPick" hidden style="margin-top:18px">
            <div class="toolbar"><input class="input" id="gSearch" type="search" placeholder="Search your group chats" aria-label="Search your group chats" autocomplete="off"><button class="btn quiet" type="button" id="gReload">${svg('refresh')}Reload</button></div>
            <p class="muted" id="gSearchNote" role="status" style="margin:10px 0 4px"></p>
            <div class="tablewrap" style="max-height:440px;overflow-y:auto"><table class="cards"><thead><tr><th>Your group chats</th><th>Last active</th><th></th></tr></thead><tbody id="gResults"></tbody></table></div>
          </div>
          <p class="muted" id="gNeedLink" hidden style="margin-top:14px">Link your Teams account above to search and add your group chats.</p>
          <details><summary>Add by chat id</summary>
            <form class="inline" id="groupForm" novalidate style="margin-top:10px"><input class="input grow" id="gId" placeholder="19:...@thread.v2" aria-label="Group chat id" spellcheck="false" autocomplete="off"><input class="input" id="gName" placeholder="Name (optional)" aria-label="Group name" style="width:auto;flex:1 1 160px"><button class="btn quiet" type="submit" id="groupAdd">Add group</button></form>
          </details>
          <p class="msg-err" id="gMsg" role="alert" style="margin-top:8px"></p>
        </section>
        <section class="panel"><h2>Invite links</h2>
          <p class="muted" style="margin-bottom:12px">For people outside your groups, such as customers. Whoever signs in through the link has access until you remove them.</p>
          <form class="inline" id="inviteForm" novalidate><input class="input grow" id="iLabel" placeholder="Label, for example Acme team" aria-label="Invite label" maxlength="80"><label>Uses <input class="input" id="iUses" type="number" min="1" max="500" value="1"></label><label>Days <input class="input" id="iDays" type="number" min="1" max="30" value="7"></label><button class="btn quiet" type="submit" id="inviteCreate">Create link</button></form>
          <p class="msg-err" id="iMsg" role="alert" style="margin-top:8px"></p>
          <div class="newlink" id="newLink" hidden style="margin-top:12px"><code id="newLinkText"></code><button class="btn small" type="button" id="copyLink">Copy link</button><span>Shown once. Send it to the people you invite.</span></div>
          <div style="margin-top:14px">${table('aInvites', ['Label', 'Uses left', 'Used', 'Ends', ''])}</div>
        </section>
        <section class="panel"><h2>People with access</h2>${table('aAllowed', ['Person', 'How', 'Since', ''])}</section>
        <section class="panel"><h2>Blocked</h2>${table('aBlocked', ['Person', 'Since', ''])}</section>
      </template>
    </section>

    <section class="view" id="v-tools" hidden aria-labelledby="h-tools">
      <div class="head"><div><h1 id="h-tools">Tools</h1><p>Last 30 days. Avg size is what each call returns to the assistant: larger results use more of people's Claude context.</p></div></div>
      <section class="panel">${table('tools', ['Tool', 'Calls', 'People', 'Avg time', 'Avg size', 'Errors'])}</section>
      <section class="panel"><h2>Busiest hours (UTC)</h2><div class="heat" id="hours"></div><div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></section>
    </section>

    <section class="view" id="v-cloud" hidden aria-labelledby="h-cloud">
      <div class="head"><div><h1 id="h-cloud">Cloud</h1><p>Cloudflare usage and cost.</p></div></div>
      <div id="cloud"></div>
    </section>

    <section class="view" id="v-connections" hidden aria-labelledby="h-conn">
      <div class="head"><div><h1 id="h-conn">Connections</h1><p>Each app someone connected. "Needs refresh" means that app still has an older tool list; Claude shows them a note.</p></div>
        <div class="chips" role="group" aria-label="Filter connections"><button class="chip" type="button" id="connAll" aria-pressed="true">All <span class="n" id="connAllN"></span></button><button class="chip" type="button" id="connOld" aria-pressed="false">Needs refresh <span class="n" id="connOldN"></span></button></div></div>
      <section class="panel">${table('conn', ['Person', 'App', 'Created', 'Last used', 'Ends if unused', 'Tools', ''])}</section>
    </section>

    <section class="view" id="v-activity" hidden aria-labelledby="h-act">
      <div class="head"><div><h1 id="h-act">Activity</h1></div></div>
      <div class="grid2">
        <section class="panel"><h2>Adoption and upkeep</h2><dl class="facts" id="adoption"></dl></section>
        <section class="panel"><h2>Events, last 14 days</h2><dl class="facts" id="events"></dl></section>
      </div>
    </section>

    <section class="view" id="v-settings" hidden aria-labelledby="h-set">
      <div class="head"><div><h1 id="h-set">Settings</h1></div></div>
      <div class="grid2">
        <section class="panel"><h2>Server</h2><dl class="facts" id="settings"></dl></section>
        <section class="panel"><h2>Limits per person</h2><dl class="facts" id="limits"></dl></section>
      </div>
      <section class="panel"><h2>On Microsoft's side</h2><dl class="facts" id="microsoft"></dl><p class="muted" id="msnote" style="margin-top:12px;max-width:72ch"></p></section>
    </section>
  </main>
</div>

<dialog id="confirm" aria-labelledby="confirmTitle"><form method="dialog"><h2 id="confirmTitle"></h2><p id="confirmBody"></p>
  <div class="row"><button class="btn quiet" value="cancel" id="confirmCancel">Cancel</button><button class="btn" value="ok" id="confirmOk">Confirm</button></div></form></dialog>
<div class="toasts" id="toasts" aria-live="polite"></div>
<script>window.__ICONS = ${JSON.stringify(ICONS)};</script>
<script>${SCRIPT}</script>
</body></html>`;
}
