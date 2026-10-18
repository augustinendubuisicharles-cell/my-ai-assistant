// HTML pages, ported from job_alerts/templates (the Python site). Every value
// that comes from a user or the database goes through esc().
import COUNTRIES from "./countries.js";
import { cvDocx } from "./docx.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const STYLE = `
  :root { --bg:#f6f7f9; --card:#fff; --text:#1d2433; --muted:#5b6475; --accent:#2457d6; --border:#dfe3ea; --ok:#127a3e; --on-accent:#fff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12151b; --card:#1b2029; --text:#e8ebf1; --muted:#a2abbb; --accent:#7aa2ff; --border:#2c3340; --ok:#5fd18f; --on-accent:#0b1530; } }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:var(--bg); color:var(--text); }
  main { max-width:560px; margin:0 auto; padding:32px 16px 48px; }
  h1 { font-size:1.6rem; margin:0 0 4px; }
  p.lead { color:var(--muted); margin:0 0 24px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:20px; }
  label { display:block; font-weight:600; margin:16px 0 6px; }
  .hint { font-weight:400; color:var(--muted); font-size:.9rem; }
  input[type=email], input[type=text], select, textarea { width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text); font-size:1rem; }
  .row { display:flex; gap:10px; align-items:center; margin-top:14px; }
  button { margin-top:22px; width:100%; padding:12px; border:0; border-radius:8px; background:var(--accent); color:var(--on-accent); font-size:1rem; font-weight:600; cursor:pointer; }
  .hp { position:absolute; left:-9999px; }
  .ok { color:var(--ok); font-weight:600; }
  .small { font-size:.85rem; color:var(--muted); margin-top:18px; }
  a { color:var(--accent); }
  .status { padding:12px 16px; margin:0 0 16px; }
  .plan { --tone:var(--accent); position:relative; overflow:hidden; margin:0 0 16px; padding:20px; border-radius:16px; color:var(--text);
    background:linear-gradient(135deg, color-mix(in srgb, var(--tone) 16%, var(--card)), var(--card) 70%); border:1px solid color-mix(in srgb, var(--tone) 35%, var(--border));
    box-shadow:0 10px 30px -18px color-mix(in srgb, var(--tone) 70%, transparent); }
  .plan::after { content:""; position:absolute; right:-40px; top:-40px; width:140px; height:140px; border-radius:50%; background:color-mix(in srgb, var(--tone) 14%, transparent); }
  .plan.member { --tone:var(--ok); } .plan.off { --tone:#d92d20; }
  .plan-top { display:flex; justify-content:space-between; align-items:center; gap:10px; position:relative; z-index:1; }
  .badge { font-size:.78rem; font-weight:800; letter-spacing:.04em; text-transform:uppercase; padding:4px 10px; border-radius:99px; color:var(--tone); background:color-mix(in srgb, var(--tone) 14%, transparent); }
  .plan-price { font-weight:700; } .plan-price small { color:var(--muted); font-weight:500; }
  .plan-head { font-size:1.7rem; font-weight:800; margin:14px 0 0; letter-spacing:-.01em; position:relative; z-index:1; }
  .plan-sub { color:var(--muted); margin:2px 0 0; }
  .meter { height:8px; border-radius:99px; background:color-mix(in srgb, var(--tone) 15%, var(--bg)); margin:14px 0 0; overflow:hidden; }
  .meter span { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg, var(--tone), color-mix(in srgb, var(--tone) 60%, #fff)); }
  .plan-cta { display:flex; justify-content:center; gap:8px; margin-top:18px; padding:13px 16px; border-radius:12px; font-weight:700; text-decoration:none; position:relative; z-index:1;
    color:var(--on-accent); background:linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #7c3aed)); box-shadow:0 8px 20px -10px var(--accent); transition:transform .15s, box-shadow .15s; }
  .plan-cta:hover { transform:translateY(-1px); box-shadow:0 12px 24px -10px var(--accent); }
  .plan-cta span { transition:transform .15s; } .plan-cta:hover span { transform:translateX(3px); }
  .plan-note { font-size:.8rem; color:var(--muted); text-align:center; margin:10px 0 0; }
  @media (prefers-reduced-motion: reduce) { .plan-cta, .plan-cta span { transition:none; } }
  .price { font-size:1.2rem; margin:0 0 8px; }
  .price b { font-size:1.8rem; }
  .perks { padding-left:20px; margin:0; }
  .perks li { margin:6px 0; }
  footer { margin-top:28px; font-size:.85rem; color:var(--muted); text-align:center; }
  fieldset { border:0; padding:0; margin:16px 0 0; }
  legend { font-weight:600; padding:0; margin-bottom:2px; }
  .row { margin-top:8px; }
  [hidden] { display:none !important; }
  button:disabled { opacity:.7; cursor:wait; }
  .hero { text-align:center; margin:4px 0 22px; }
  .hero svg { width:132px; height:132px; display:block; margin:0 auto 10px; }
  .hero h1 { font-size:1.9rem; margin:0; }
  .hero p { color:var(--muted); margin:6px 0 0; font-size:1.05rem; }
  .pill { display:inline-block; margin-top:12px; padding:6px 14px; border-radius:20px; background:color-mix(in srgb, var(--ok) 14%, transparent); color:var(--ok); font-weight:700; font-size:.92rem; }
  .steps { list-style:none; margin:0; padding:0; }
  .steps li { position:relative; padding:0 0 18px 44px; }
  .steps li:last-child { padding-bottom:0; }
  .steps li::before { content:""; position:absolute; left:13px; top:30px; bottom:2px; width:2px; background:var(--border); }
  .steps li:last-child::before { display:none; }
  .steps .dot { position:absolute; left:0; top:0; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:.85rem; background:var(--bg); color:var(--muted); border:2px solid var(--border); }
  .steps .done .dot { background:var(--ok); border-color:var(--ok); color:#fff; }
  .steps .now .dot { background:var(--accent); border-color:var(--accent); color:var(--on-accent); }
  .steps .now .dot::after { content:""; position:absolute; inset:-6px; border-radius:50%; border:2px solid var(--accent); animation:pulse 1.6s ease-out infinite; }
  @keyframes pulse { from { opacity:.8; transform:scale(.8); } to { opacity:0; transform:scale(1.35); } }
  @keyframes rise { 0%,100% { transform:translateY(0); } 50% { transform:translateY(-6px); } }
  .float { animation:rise 3s ease-in-out infinite; transform-origin:center; }
  @media (prefers-reduced-motion: reduce) { .steps .now .dot::after, .float { animation:none; } }
  .steps b { display:block; }
  .steps span { color:var(--muted); font-size:.92rem; }
  .actions { display:grid; gap:10px; margin-top:18px; }
  .btn { display:block; text-align:center; padding:12px; border-radius:8px; font-weight:700; text-decoration:none; }
  .btn.primary { background:var(--accent); color:var(--on-accent); }
  .btn.ghost { border:1px solid var(--border); color:var(--text); background:var(--card); }
  .btn.wa { background:#1fa855; color:#fff; }
  .note { margin-top:16px; font-size:.9rem; color:var(--muted); text-align:center; }
  .plans { display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:12px; margin:28px 0 0; }
  .plans h2 { grid-column:1 / -1; font-size:1.3rem; margin:0; }
  .plan { position:relative; }
  .plan.best { border:2px solid var(--accent); }
  .plan .tag { position:absolute; top:-11px; right:14px; background:var(--accent); color:var(--on-accent); font-size:.75rem; font-weight:800; padding:3px 10px; border-radius:20px; }
  .plan h3 { margin:0; font-size:1.1rem; }
  .plan .cost { margin:4px 0 12px; color:var(--muted); }
  .plan .cost b { color:var(--text); font-size:1.5rem; }
  .launch { display:inline-block; margin-top:6px; padding:4px 10px; border-radius:10px; background:#fff1e6; color:#c2410c; font-size:.8rem; font-weight:700; }
  s { color:var(--muted); font-weight:400; }
  .plan ul { list-style:none; padding:0; margin:0; }
  .plan li { padding:5px 0 5px 26px; position:relative; }
  .plan li::before { content:"✓"; position:absolute; left:0; color:var(--ok); font-weight:800; }
  .plan li.no { color:var(--muted); }
  .plan li.no::before { content:"–"; color:var(--muted); }
  .home h1 { font-size:2.1rem; line-height:1.15; letter-spacing:-.5px; }
  .home h1 em { font-style:normal; color:var(--accent); }
  .home p.lead { font-size:1.08rem; margin-bottom:18px; }
  .cta { display:inline-block; padding:13px 22px; border-radius:10px; background:var(--accent); color:var(--on-accent); font-weight:800; text-decoration:none; margin:0 0 24px; }
  .why { display:grid; gap:12px; margin:0 0 22px; }
  .why .card { display:grid; grid-template-columns:48px 1fr; gap:14px; align-items:start; padding:16px 18px; }
  .why .ico { width:48px; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; }
  .why .ico svg { width:26px; height:26px; }
  .why h3 { margin:0 0 3px; font-size:1.05rem; }
  .why p { margin:0; color:var(--muted); font-size:.95rem; }
  .ico.blue { background:color-mix(in srgb, var(--accent) 14%, transparent); color:var(--accent); }
  .ico.gold { background:#fff3d6; color:#b7791f; }
  .ico.green { background:color-mix(in srgb, var(--ok) 14%, transparent); color:var(--ok); }
  @media (prefers-color-scheme: dark) { .ico.gold { background:#3a2f12; color:#ffc75a; } }
  .vs { margin:28px 0 0; }
  .vs h2 { font-size:1.3rem; margin:0 0 12px; }
  .vs table { width:100%; border-collapse:collapse; font-size:.9rem; table-layout:fixed; }
  .vs col.a { width:30%; } .vs col.b { width:33%; }
  .vs th, .vs td { padding:10px 6px; overflow-wrap:anywhere; border-bottom:1px solid var(--border); text-align:left; vertical-align:top; }
  .vs tr:last-child td { border-bottom:0; }
  .vs th { font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  .vs td.us { color:var(--ok); font-weight:700; }
  .vs td.them { color:var(--muted); }
  details.fold > summary { cursor:pointer; list-style:none; font-weight:700; color:var(--accent); padding:4px 0; }
  details.fold > summary::-webkit-details-marker { display:none; }
  details.fold > summary::after { content:"▾"; display:inline-block; margin-left:6px; transition:transform .2s; }
  details.fold[open] > summary::after { transform:rotate(180deg); }
  details.more { margin-top:18px; }
  details.pick { position:relative; }
  details.pick > summary { list-style:none; cursor:pointer; padding:10px 36px 10px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  details.pick > summary::-webkit-details-marker { display:none; }
  details.pick > summary::after { content:"▾"; position:absolute; right:12px; top:10px; color:var(--muted); }
  details.pick > summary.empty { color:var(--muted); }
  details.pick .opts { border:1px solid var(--border); border-radius:8px; padding:6px 12px 10px; margin-top:4px; background:var(--bg); }
  details.pick .row { margin:6px 0; }
  details.pick .row label { margin:0; font-weight:400; }
  details.pick .subs { margin:2px 0 10px 26px; padding:4px 0 2px 12px; border-left:2px solid var(--accent); }
  details.pick .subs[hidden] { display:none; }
  details.pick .subs .simh { margin:0 0 2px; font-size:.78rem; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  details.pick .subs .row { margin:4px 0; }
  details.info { margin-top:22px; text-align:center; }
  details.info[open] { text-align:left; }
  details.info > summary { text-align:center; }
  details.info .why { margin-top:16px; }
  .free { text-align:center; margin:12px 0 0; font-size:.9rem; color:var(--muted); }
  textarea { font:inherit; line-height:1.5; resize:vertical; }
  .invite { margin-top:16px; }
  .invite .bar { height:8px; border-radius:4px; background:var(--border); margin:10px 0 4px; overflow:hidden; }
  .invite .bar i { display:block; height:100%; background:var(--ok); }
  .brand { display:inline-flex; align-items:center; gap:10px; margin:0 0 20px; text-decoration:none; color:var(--text); font-size:1.35rem; font-weight:800; letter-spacing:-.3px; }
  .brand b { color:var(--accent); }
  .brand img { border-radius:9px; }
  .apps-link { display:flex; justify-content:space-between; align-items:center; margin:0 0 16px; padding:14px 18px; text-decoration:none; color:var(--text); font-weight:700; }
  .apps-link span { color:var(--accent); }
  .tiles { display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; margin:0 0 22px; }
  .tile { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:14px 12px; text-align:center; }
  .tile b { display:block; font-size:1.8rem; line-height:1.1; letter-spacing:-.02em; }
  .tile span { font-size:.82rem; color:var(--muted); font-weight:600; }
  .tile.int b { color:var(--accent); } .tile.off b { color:var(--ok); }
  .apps h2 { font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:22px 0 10px; }
  .app { padding:16px 18px; margin:0 0 10px; transition:border-color .3s; }
  .app.saved { border-color:var(--ok); box-shadow:0 0 0 3px color-mix(in srgb, var(--ok) 18%, transparent); }
  .app-top { display:flex; justify-content:space-between; gap:10px; align-items:baseline; }
  .app-top a { color:var(--text); font-weight:700; text-decoration:none; }
  .app-top time { color:var(--muted); font-size:.8rem; white-space:nowrap; }
  .wa-row { display:flex; gap:8px; margin-top:8px; }
  .wa-row input { flex:1; margin:0; }
  .wa-row button { width:auto; margin:0; padding:0 18px; }
  .app .prep { display:inline-block; margin-top:8px; font-size:.85rem; font-weight:700; text-decoration:none; }
  .app .co { color:var(--muted); font-size:.9rem; }
  .seg { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
  .seg button { width:auto; margin:0; padding:7px 13px; border-radius:99px; font-size:.85rem; font-weight:700; background:var(--bg); color:var(--muted); border:1px solid var(--border); }
  .seg button.on { background:var(--accent); color:var(--on-accent); border-color:var(--accent); }
  .seg button.on.good { background:var(--ok); border-color:var(--ok); color:#fff; }
  .seg button.skip { color:var(--muted); background:transparent; border-color:transparent; }
  .empty { text-align:center; color:var(--muted); padding:28px 20px; }
  .me-top { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
  .me-top form button { width:auto; margin:4px 0 0; padding:8px 14px; font-size:.85rem; background:transparent; color:var(--muted); border:1px solid var(--border); }
  .mtiles { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin:0 0 26px; }
  .mtile { display:flex; flex-direction:column; align-items:center; gap:8px; padding:14px 6px 12px; border-radius:16px; background:var(--card); border:1px solid var(--border); text-decoration:none; color:var(--text); transition:transform .15s, box-shadow .15s; }
  .mtile:hover { transform:translateY(-2px); box-shadow:0 10px 24px -16px var(--tone); }
  .mtile i { position:relative; width:46px; height:46px; border-radius:14px; display:grid; place-items:center; color:var(--tone); background:color-mix(in srgb, var(--tone) 14%, transparent); }
  .mtile i svg { width:24px; height:24px; }
  .mtile em { position:absolute; top:-6px; right:-8px; min-width:20px; height:20px; padding:0 6px; border-radius:99px; background:var(--tone); color:#fff; font:700 .7rem/20px system-ui, sans-serif; font-style:normal; text-align:center; }
  .mtile b { font-size:.82rem; font-weight:700; }
  .sheet { border:0; padding:0; width:min(420px, calc(100% - 24px)); border-radius:22px; background:var(--card); color:var(--text); box-shadow:0 30px 80px -20px #0b153080; }
  .sheet::backdrop { background:#0b153066; backdrop-filter:blur(3px); }
  .sheet form { padding:26px 24px 18px; text-align:center; }
  .sheet-ic { width:56px; height:56px; margin:0 auto 12px; border-radius:18px; display:grid; place-items:center; color:var(--accent); background:color-mix(in srgb, var(--accent) 14%, transparent); }
  .sheet-ic svg { width:28px; height:28px; }
  .sheet h2 { margin:0; font-size:1.3rem; }
  .sheet p { margin:6px 0 16px; color:var(--muted); }
  .sheet-perks { list-style:none; padding:14px 16px; margin:0 0 4px; text-align:left; border-radius:14px; background:var(--bg); }
  .sheet-perks li { padding:4px 0 4px 26px; position:relative; font-size:.92rem; }
  .sheet-perks li::before { content:"✓"; position:absolute; left:2px; color:var(--ok); font-weight:800; }
  .sheet .sheet-close { margin:10px 0 0; background:transparent; color:var(--muted); font-weight:600; }
  @media (max-width:560px) { .sheet { margin:auto auto 0; width:100%; max-width:100%; border-radius:22px 22px 0 0; } }
  .mjob { padding:14px 16px; margin:0 0 10px; }
  .more { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; margin:4px 0 0; padding:13px; border-radius:12px;
    border:1.5px solid var(--accent); background:transparent; color:var(--accent); font:inherit; font-weight:700; text-decoration:none; cursor:pointer; }
  .more svg { width:18px; height:18px; }
  .mjob .t { font-weight:700; }
  .mjob .links { display:flex; flex-wrap:wrap; gap:6px 16px; margin-top:8px; font-size:.9rem; font-weight:600; }
  .mjob .links a { text-decoration:none; }
  .mjob .links a.sub { color:var(--muted); }
  .chip-st { display:inline-block; font-size:.75rem; font-weight:700; padding:2px 9px; border-radius:99px; margin-left:6px; background:color-mix(in srgb, var(--ok) 14%, transparent); color:var(--ok); vertical-align:2px; }
  .jhead { display:flex; gap:14px; align-items:flex-start; margin:6px 0 14px; }
  .jav { flex:none; width:54px; height:54px; border-radius:16px; display:grid; place-items:center; font-weight:800; font-size:1.2rem; color:#fff; background:linear-gradient(135deg, var(--accent), #7c3aed); }
  .jhead h1 { font-size:1.45rem; line-height:1.25; margin:0; }
  .jhead .co { color:var(--muted); margin-top:2px; }
  .jchips { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 18px; }
  .jchips span { font-size:.82rem; font-weight:600; padding:5px 11px; border-radius:99px; background:var(--card); border:1px solid var(--border); }
  .jchips span.pay { color:var(--ok); border-color:color-mix(in srgb, var(--ok) 35%, var(--border)); background:color-mix(in srgb, var(--ok) 8%, var(--card)); }
  .jchips span.warn { color:#b54708; border-color:#f7c99a; background:#fff6ed; }
  .jsteps { padding:18px 18px 8px; margin:0 0 14px; }
  .jsteps h2, .jdesc h2 { font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 12px; }
  .jsteps ol { list-style:none; margin:0; padding:0; counter-reset:s; }
  .jsteps li { counter-increment:s; position:relative; padding:0 0 14px 40px; }
  .jsteps li::before { content:counter(s); position:absolute; left:0; top:-1px; width:26px; height:26px; border-radius:50%; display:grid; place-items:center; font-weight:800; font-size:.85rem; color:var(--accent); background:color-mix(in srgb, var(--accent) 13%, transparent); }
  .jsteps li b { display:block; }
  .jsteps li span { color:var(--muted); font-size:.9rem; }
  .jtools { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  .jtools a { font-size:.85rem; font-weight:700; text-decoration:none; padding:7px 13px; border-radius:99px; border:1px solid var(--border); background:var(--bg); }
  .jdesc { padding:18px; margin:0 0 14px; }
  .jdesc p { margin:0 0 10px; } .jdesc ul { margin:0 0 10px; padding-left:20px; } .jdesc li { margin:0 0 4px; }
  .jdesc details summary { cursor:pointer; color:var(--accent); font-weight:700; list-style:none; margin-top:4px; }
  .jdesc details[open] summary { display:none; }
  .jdid { padding:16px 18px; margin:0 0 14px; } .jdid .seg { margin-top:8px; } .jdid b { font-size:.95rem; }
  .applybar { position:sticky; bottom:0; margin:0 -16px; padding:12px 16px calc(12px + env(safe-area-inset-bottom)); background:linear-gradient(transparent, var(--bg) 30%); }
  .applybar .plan-cta { margin:0; } .applybar p { text-align:center; margin:6px 0 0; font-size:.8rem; color:var(--muted); }
  .hours { display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; padding:4px; border-radius:12px; background:var(--bg); border:1px solid var(--border); }
  .hours input { position:absolute; opacity:0; pointer-events:none; }
  .hours label { margin:0; padding:9px 4px; text-align:center; border-radius:9px; font-weight:600; font-size:.92rem; color:var(--muted); cursor:pointer; transition:background .15s, color .15s; }
  .hours input:checked + label { background:var(--card); color:var(--accent); box-shadow:0 1px 3px #0b15301f, 0 0 0 1px var(--border); }
  .hours input:focus-visible + label { outline:2px solid var(--accent); outline-offset:1px; }
  .copylink { display:flex; align-items:center; gap:8px; margin-top:12px; padding:6px 6px 6px 12px; border-radius:14px; background:var(--bg); border:1px solid var(--border); }
  .copylink .cl-ic { flex:none; width:20px; height:20px; color:var(--muted); display:grid; place-items:center; } .copylink .cl-ic svg { width:18px; height:18px; }
  .copylink input { flex:1; min-width:0; border:0; background:transparent; padding:6px 0; font-size:.9rem; color:var(--text); text-overflow:ellipsis; outline:none; }
  .copylink button { width:auto; margin:0; padding:9px 16px; border-radius:10px; font-size:.88rem; font-weight:700; background:var(--card); color:var(--accent); border:1px solid var(--border); box-shadow:0 1px 2px #0b153014; }
  .copylink button.ok { color:var(--ok); border-color:color-mix(in srgb, var(--ok) 40%, var(--border)); }
  a.quiet, footer a { color:var(--muted); text-decoration:none; font-weight:500; }
  a.quiet:hover, footer a:hover { color:var(--accent); }
  .toast { padding:10px 14px; margin:0 0 16px; border-radius:10px; background:color-mix(in srgb, var(--ok) 12%, transparent); color:var(--ok); font-weight:600; }
`;

// The home page: a blue hero with the form and floating example jobs, four steps, and a
// "What's harder for you right now?" picker. Kept short on words on purpose.
const LANDING_STYLE = `
  body.landing { font-family:"Plus Jakarta Sans", system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:var(--bg); }
  .landing .wrap { max-width:1180px; margin:0 auto; padding:0 24px; }
  .hero-band { position:relative; overflow:hidden; color:#fff; padding-bottom:56px;
    background:radial-gradient(1100px 520px at 12% -10%, #ffffffcc 0, #ffffff00 45%), radial-gradient(900px 600px at 85% 30%, #3d8bff 0, #3d8bff00 60%), linear-gradient(160deg, #1f6bff 0%, #0b4fd6 55%, #0a3fb3 100%); }
  .landing .nav { display:flex; justify-content:space-between; align-items:center; padding-top:24px; padding-bottom:24px; }
  .nav .brand { margin:0; color:#0b1a3a; font-size:1.5rem; }
  .nav .brand b { color:#1f5fe0; }
  .nav .brand img { width:44px; height:44px; border-radius:12px; box-shadow:0 8px 20px -8px #0b3fb380; }
  .nav .navlinks { display:flex; align-items:center; gap:6px; }
  .nav a.navplain { color:#fff; font-weight:600; text-decoration:none; padding:9px 12px; opacity:.9; }
  .nav a.navlink { color:#fff; font-weight:700; text-decoration:none; padding:9px 18px; border-radius:99px; background:#ffffff26; border:1px solid #ffffff40; backdrop-filter:blur(6px); }
  .hero-grid { display:grid; grid-template-columns:minmax(0,1.05fr) minmax(0,1fr); gap:56px; align-items:center; padding-top:18px; }
  .eyebrow { display:inline-flex; align-items:center; gap:8px; font-weight:700; font-size:.88rem; padding:7px 14px; border-radius:99px; background:#ffffff22; border:1px solid #ffffff3a; }
  .eyebrow i { width:8px; height:8px; border-radius:50%; background:#ff9f1c; box-shadow:0 0 0 4px #ff9f1c40; }
  .hero-copy h1 { font-size:clamp(2.6rem, 5.2vw, 4.4rem); line-height:1.02; letter-spacing:-.045em; font-weight:800; margin:18px 0 16px; color:#fff; }
  .hero-copy h1 span { display:block; }
  .hero-copy > p { font-size:1.15rem; line-height:1.5; margin:0 0 26px; color:#e6efff; max-width:30em; }
  .landing form.card { color:var(--text); border:0; border-radius:20px; padding:22px 22px 18px; box-shadow:0 30px 60px -30px #021a5a99, 0 2px 0 #ffffff inset; max-width:470px; }
  .landing form.card label:first-child { margin-top:0; }
  .landing form.card button { border-radius:12px; padding:14px; font-weight:800; font-size:1.05rem; background:linear-gradient(135deg, #1f6bff, #0b4fd6); color:#fff; box-shadow:0 12px 24px -12px #0b4fd6; }
  .stack { position:relative; display:grid; gap:14px; perspective:1200px; }
  .job { display:grid; grid-template-columns:52px 1fr auto; gap:14px; align-items:center; background:#fff; color:#0b1a3a; border-radius:18px; padding:16px 18px;
    box-shadow:0 24px 48px -24px #021a5ab3; transform:rotate(-1.2deg); animation:drift 7s ease-in-out infinite; }
  .job:nth-child(2) { transform:rotate(1deg) translateX(-26px) scale(1.04); z-index:2; animation-delay:-2s; }
  .job:nth-child(3) { transform:rotate(-.6deg) translateX(14px); animation-delay:-4s; opacity:.96; }
  .job:nth-child(4) { transform:rotate(.8deg) translateX(-8px); animation-delay:-5s; opacity:.9; }
  @keyframes drift { 0%,100% { translate:0 0; } 50% { translate:0 -7px; } }
  .job .av { width:52px; height:52px; border-radius:14px; display:grid; place-items:center; font-weight:800; color:#fff; font-size:1.05rem; }
  .job h3 { margin:0; font-size:1.05rem; color:#1450d8; letter-spacing:-.01em; }
  .job .chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:7px; }
  .job .chips span { font-size:.76rem; font-weight:600; color:#4a5672; background:#f1f4fa; border-radius:8px; padding:3px 8px; }
  .job .chips span.pay { color:#127a3e; background:#e7f6ed; }
  .job .when { font-size:.78rem; color:#7a8499; align-self:end; white-space:nowrap; }
  .job .tick { position:absolute; right:-18px; top:-18px; width:46px; height:46px; border-radius:50%; background:#22b45a; border:4px solid #fff; display:grid; place-items:center; box-shadow:0 10px 20px -8px #0a6b30; }
  .job .tick svg { width:22px; height:22px; }
  .job.best { position:relative; }
  .flow { list-style:none; margin:56px auto 0; padding:0 24px; display:grid; grid-template-columns:repeat(4, 1fr); gap:20px; max-width:1180px; counter-reset:f; }
  .flow li { display:flex; align-items:center; gap:14px; font-weight:700; color:#fff; position:relative; }
  .flow li:not(:last-child)::after { content:"›"; position:absolute; right:-6px; font-size:1.6rem; opacity:.6; }
  .flow .ic { flex:none; width:54px; height:54px; border-radius:50%; display:grid; place-items:center; background:#ffffff1f; border:1.5px solid #ffffff66; }
  .flow .ic svg { width:24px; height:24px; }
  .flow small { display:block; font-weight:500; color:#d6e4ff; font-size:.85rem; }
  .landing .harder { padding-top:96px; padding-bottom:20px; text-align:center; }
  .harder h2, .landing .plans h2 { font-size:clamp(2rem, 3.6vw, 3rem); letter-spacing:-.035em; line-height:1.08; margin:0 0 10px; font-weight:800; }
  .harder h2 em { font-style:italic; color:#1f6bff; position:relative; padding-right:.12em; }
  .harder h2 em::after { content:""; position:absolute; left:4%; right:4%; bottom:-4px; height:4px; border-radius:4px; background:#ff8a1c; }
  .harder > p { color:var(--muted); margin:0 0 30px; }
  .pills { display:flex; flex-wrap:wrap; justify-content:center; gap:14px; max-width:860px; margin:0 auto; }
  .pills button { width:auto; margin:0; display:inline-flex; align-items:center; gap:12px; padding:14px 22px 14px 14px; border-radius:16px; font:inherit; font-size:1.02rem; font-weight:600;
    color:#fff; background:#1f5fe0; box-shadow:0 14px 28px -16px #1f5fe0; transition:transform .15s, box-shadow .15s, background .15s; }
  .pills button:nth-child(even) { background:#ff7a10; box-shadow:0 14px 28px -16px #ff7a10; }
  .pills button:nth-child(odd) { transform:rotate(-1.2deg); } .pills button:nth-child(even) { transform:rotate(1.2deg); }
  .pills button:hover, .pills button[aria-pressed=true] { transform:rotate(0) translateY(-3px); box-shadow:0 18px 30px -14px #0b1a3a80; }
  .pills button[aria-pressed=true] { outline:3px solid color-mix(in srgb, currentColor 0%, #0b1a3a); outline-offset:2px; }
  .pills b { width:30px; height:30px; flex:none; border-radius:50%; border:2px solid #fff; display:grid; place-items:center; font-size:.9rem; }
  .answer { max-width:640px; margin:26px auto 0; min-height:64px; font-size:1.15rem; font-weight:600; color:var(--text); }
  .answer span { display:inline-block; padding:14px 22px; border-radius:16px; background:var(--card); border:1px solid var(--border); animation:pop .25s ease-out; }
  @keyframes pop { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  .hardwork { display:flex; align-items:center; justify-content:space-between; gap:20px; max-width:860px; margin:34px auto 0; padding:22px 26px; border-radius:22px; text-align:left;
    background:color-mix(in srgb, #1f6bff 9%, var(--card)); border:1px solid color-mix(in srgb, #1f6bff 20%, var(--border)); text-decoration:none; color:var(--text); }
  .hardwork strong { display:block; font-size:clamp(1.3rem, 2.4vw, 1.75rem); letter-spacing:-.025em; }
  .hardwork strong em { font-style:normal; color:#1f6bff; }
  .hardwork small { color:var(--muted); font-size:1rem; }
  .hardwork i { flex:none; width:58px; height:58px; border-radius:50%; background:#1f5fe0; color:#fff; display:grid; place-items:center; font-style:normal; font-size:1.6rem; transition:transform .15s; }
  .hardwork:hover i { transform:translateX(4px); }
  .landing .plans { max-width:860px; margin:88px auto 0; gap:18px; grid-template-columns:1fr 1fr; }
  .landing .plan { overflow:visible; } .landing .plan::after { display:none; }
  .landing .plans h2 { text-align:center; margin-bottom:12px; }
  .landing .plan { border-radius:22px; padding:26px; }
  .landing footer { margin:56px 0 40px; }
  @media (max-width: 900px) {
    .hero-grid { grid-template-columns:1fr; gap:36px; }
    .landing form.card { max-width:none; }
    .stack { max-width:520px; margin:0 auto; width:100%; }
    .job .tick { right:-6px; }
    .flow { grid-template-columns:1fr 1fr; gap:22px 16px; margin-top:44px; }
    .flow li::after { display:none; }
    .landing .plans { grid-template-columns:1fr; }
  }
  @media (max-width: 560px) {
    .landing .wrap { padding-left:16px; padding-right:16px; } .flow { padding:0 16px; }
    .landing .harder { padding-top:64px; } .harder h2, .landing .plans h2 { font-size:1.85rem; }
    .pills { gap:10px; } .pills button, .pills button:nth-child(odd), .pills button:nth-child(even) { transform:none; text-align:left; }
    .answer:empty { min-height:0; margin:0; }
    .nav .brand { font-size:1.25rem; } .nav .brand img { width:38px; height:38px; }
    .job { grid-template-columns:44px 1fr; padding:14px; } .job .av { width:44px; height:44px; } .job .when { display:none; }
    .job:nth-child(2) { transform:rotate(1deg) scale(1.02); } .job:nth-child(3), .job:nth-child(4) { transform:none; }
    .job:nth-child(4) { display:none; }
    .flow { grid-template-columns:1fr; }
    .pills button { width:100%; }
    .hardwork { padding:18px; }
  }
  @media (prefers-reduced-motion: reduce) { .job, .answer span { animation:none; } }
  /* Sign-up cards: one question at a time, email last. Without JavaScript every card shows at once. */
  .cards .progress { display:flex; gap:6px; margin-bottom:6px; }
  .cards .progress i { flex:1; height:5px; border-radius:5px; background:#e4e9f2; }
  .cards .progress i.on { background:#ff9f1c; }
  .cards .count { font-size:.8rem; color:var(--muted); font-weight:600; }
  .cards .step + .step { margin-top:22px; }
  .js .cards .step + .step { margin-top:0; }
  .js .cards .step:not(.now) { display:none; }
  .cards h2 { font-size:1.45rem; letter-spacing:-.025em; line-height:1.2; margin:10px 0 4px; font-weight:800; }
  .cards .sub { color:var(--muted); font-size:.9rem; margin:0 0 14px; }
  .cards .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .cards .chips input, .cards .opts input { position:absolute; opacity:0; pointer-events:none; }
  .cards .chips label { margin:0; padding:9px 14px; border-radius:99px; border:1.5px solid var(--border); font-weight:600; font-size:.92rem; cursor:pointer; }
  .cards .chips input:checked + label { background:#1f5fe0; border-color:#1f5fe0; color:#fff; }
  .cards .chips input:disabled + label { opacity:.45; cursor:default; }
  .cards .picked { display:flex; align-items:center; gap:10px; margin:-4px 0 14px; font-size:.9rem; color:var(--muted); }
  .cards .picked .dots { display:flex; gap:5px; } .cards .picked i { width:22px; height:6px; border-radius:6px; background:var(--border); transition:background .2s; }
  .cards .picked i.on { background:#ff8a1c; } .cards .picked b { font-weight:700; }
  .cards .next.wait { opacity:.55; }
  .cards .similar { margin:14px 0 4px; padding:12px; border-radius:16px; background:color-mix(in srgb, #ff8a1c 8%, var(--card)); animation:pop .25s ease-out; }
  .cards .similar .simh { margin:0 0 8px; font-size:.82rem; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#c2410c; }
  .cards .similar label { border-style:dashed; } .cards .similar label::before { content:"+ "; }
  .cards .similar input:checked + label::before { content:""; }
  .cards .chips label[hidden] { display:none; }
  .cards .chips input:focus-visible + label, .cards .opts input:focus-visible + label { outline:3px solid #1f6bff66; outline-offset:2px; }
  .cards .opts { display:grid; gap:10px; }
  .cards .opts label { margin:0; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:14px 16px; border-radius:14px;
    border:1.5px solid var(--border); font-weight:700; cursor:pointer; }
  .cards .opts label small { display:block; font-weight:500; color:var(--muted); font-size:.82rem; }
  .cards .opts label::after { content:""; flex:none; width:18px; height:18px; border-radius:50%; border:2px solid var(--border); }
  .cards .opts input:checked + label { border-color:#1f5fe0; background:color-mix(in srgb, #1f6bff 8%, var(--card)); }
  .cards .opts input:checked + label::after { border:6px solid #1f5fe0; }
  .cards .hours { margin-top:14px; }
  .cards .navrow { display:flex; gap:10px; margin-top:18px; }
  .cards .navrow button { margin:0; }
  .landing .cards button.back { width:auto; flex:none; padding:14px 18px; background:none; color:var(--muted); box-shadow:none; font-weight:700; }
  .cards #country_box[hidden] { display:none; }
`;

const FLOW_ICONS = {
  pick: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l7-7M16 5h3v3"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/></svg>`,
  mail: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M4 7l8 6 8-6"/></svg>`,
};
const TICK = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

// Example cards: the kind of jobs people get (no real company names or logos).
const SAMPLE_JOBS = [
  ["CS", "#111827", "Customer Support Specialist", ["Remote", "Full time", "Open to Nigeria"], "2 days ago"],
  ["DM", "#1f6bff", "Digital Marketing Associate", ["Remote", "Full time", "$1,500/mo"], "1 day ago", true],
  ["CW", "#f04a4a", "Content Writer", ["Remote", "Part time", "Worldwide"], "3 days ago"],
  ["DA", "#f59e0b", "Data Analyst", ["Remote", "Entry level", "Worldwide"], "5 days ago"],
];

const HARDER = [
  ["Finding high-paying jobs", "We show the pay, converted to naira, so you can see what's worth it."],
  ["Building a standout CV", "Members get their CV rewritten for every job, plus a cover letter."],
  ["Discovering global opportunities", "Remote jobs from companies worldwide that are open to your country."],
  ["Getting matched to relevant roles", "Your job titles first, then the closest roles. Never the same job twice."],
  ["Beating the crowd", "Only jobs from the last 7 days, in your inbox at 7am, before most people apply."],
];

function landing(ctx, formHtml) {
  const job = ([av, color, title, chips, when, best]) => `<div class="job${best ? " best" : ""}">
  <span class="av" style="background:${color}">${av}</span>
  <div><h3>${title}</h3><div class="chips">${chips.map((c) => `<span${c.startsWith("$") ? ' class="pay"' : ""}>${c}</span>`).join("")}</div></div>
  <span class="when">${when}</span>${best ? `<span class="tick">${TICK}</span>` : ""}</div>`;
  const step = (icon, title, sub) => `<li><span class="ic">${FLOW_ICONS[icon]}</span><span>${title}<small>${sub}</small></span></li>`;
  return `<section class="hero-band">
<nav class="wrap nav"><a class="brand" href="/"><img src="/favicon.svg" alt="" width="44" height="44"><span>Job<b>Alert</b></span></a>
<div class="navlinks"><a class="navplain" href="#plans">Plans</a><a class="navlink" href="/login">Log in</a></div></nav>
<div class="wrap hero-grid">
  <div class="hero-copy">
    <span class="eyebrow"><i></i>Fresh jobs every morning at 7am</span>
    <h1>Find the right job <span>faster.</span></h1>
    <p>Remote jobs that hire Nigerians, matched to you and checked for scams.</p>
    ${formHtml}
  </div>
  <div class="stack" aria-hidden="true">${SAMPLE_JOBS.map(job).join("")}</div>
</div>
<ol class="flow">
  ${step("pick", "Pick your jobs", "Up to 5 titles")}
  ${step("search", "We search 9 job boards", "Every morning")}
  ${step("shield", "We check every job", "Scams and closed jobs out")}
  ${step("mail", "Get them by email", "Never the same job twice")}
</ol>
</section>

${ctx.paidService ? `<section class="wrap trust-wrap">${trust(ctx)}</section>` : ""}

<section class="wrap harder">
  <h2>What's <em>harder</em> for you right now?</h2>
  <p>Tap one.</p>
  <div class="pills">${HARDER.map(([q, a], i) => `<button type="button" aria-pressed="false" data-a="${esc(a)}"><b>${i + 1}</b>${q}</button>`).join("")}</div>
  <div class="answer" aria-live="polite"></div>
  <a class="hardwork" href="#top"><span><strong>Let <em>JobAlert</em> do the hard work.</strong><small>${ctx.trialDays} days free. No card.</small></span><i>→</i></a>
</section>

<div class="wrap">${plans(ctx)}</div>
<script>
  (function () {
    var pills = document.querySelectorAll(".pills button"), out = document.querySelector(".answer");
    pills.forEach(function (b) { b.addEventListener("click", function () {
      pills.forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      out.innerHTML = ""; var s = document.createElement("span"); s.textContent = b.dataset.a; out.appendChild(s);
    }); });
    document.querySelector(".hardwork").addEventListener("click", function (e) {
      e.preventDefault(); document.getElementById("prefs").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  })();
</script>`;
}

const DESCRIPTION = "Remote jobs from companies abroad that actually hire Nigerians, checked for scams and never repeated, in your inbox every morning. 7 days free.";

export function page(ctx, body, { landing = false, og = null } = {}) {
  const footer = `<footer><a href="/terms">Terms and pricing</a>${
    ctx.contact ? ` &middot; <a href="mailto:${esc(ctx.contact)}">Contact</a>` : ""}</footer>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(og?.title || ctx.siteName)}</title>
<meta name="description" content="${esc(DESCRIPTION)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.png" type="image/png" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#2457d6">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(ctx.siteName)}">
<meta property="og:title" content="${esc(og?.title || `${ctx.siteName}: remote jobs that actually hire Nigerians`)}">
<meta property="og:description" content="${esc(og?.description || DESCRIPTION)}">
<meta property="og:url" content="${esc(ctx.baseUrl)}${esc(og?.path || "/")}">
<meta property="og:image" content="${esc(ctx.baseUrl)}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(ctx.siteName)}: remote jobs that actually hire Nigerians, in your inbox every morning">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(ctx.baseUrl)}/og.jpg">
<style>${STYLE}${landing ? LANDING_STYLE : ""}</style>${landing ? `
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">` : ""}
</head>
${landing ? `<body class="landing">${body}<div class="wrap">${footer}</div></body>` : `<body><main><a class="brand" href="/"><img src="/favicon.svg" alt="" width="36" height="36"><span>Job<b>Alert</b></span></a>
${body}
${footer}</main></body>`}
</html>`;
}

export function message(ctx, { heading, text, ok = false, link = null, linkText = null }) {
  return page(ctx, `<h1>${esc(heading)}</h1>
<div class="card"><p${ok ? ' class="ok"' : ""}>${esc(text)}</p>
${link ? `<p><a href="${esc(link)}">${esc(linkText)}</a></p>` : ""}</div>`);
}

// Illustrations for the welcome and check-your-inbox pages (inline SVG, brand colours).
const ART_ROCKET = `<svg viewBox="0 0 160 160" aria-hidden="true">
  <defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1f4d"/><stop offset="1" stop-color="#2457d6"/></linearGradient></defs>
  <circle cx="80" cy="80" r="76" fill="url(#g1)"/>
  <circle cx="38" cy="44" r="3" fill="#fff" opacity=".7"/><circle cx="124" cy="36" r="2.5" fill="#fff" opacity=".6"/><circle cx="130" cy="104" r="3" fill="#fff" opacity=".5"/>
  <g class="float">
    <path d="M80 30c18 12 24 34 18 58H62c-6-24 0-46 18-58z" fill="#fff"/>
    <circle cx="80" cy="62" r="9" fill="#2457d6"/><circle cx="80" cy="62" r="4" fill="#ffc75a"/>
    <path d="M62 78l-12 16 16-4zM98 78l12 16-16-4z" fill="#ffc75a"/>
    <path d="M70 94h20l-4 14h-12z" fill="#f5a524"/><path d="M74 108h12l-6 14z" fill="#ffc75a"/>
  </g>
</svg>`;

const ART_MAIL = `<svg viewBox="0 0 160 160" aria-hidden="true">
  <defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f1f4d"/><stop offset="1" stop-color="#2457d6"/></linearGradient></defs>
  <circle cx="80" cy="80" r="76" fill="url(#g2)"/>
  <g class="float">
    <rect x="34" y="52" width="92" height="62" rx="10" fill="#fff"/>
    <path d="M36 58l44 32 44-32" fill="none" stroke="#2457d6" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="122" cy="52" r="13" fill="#f5a524" stroke="#fff" stroke-width="4"/>
    <text x="122" y="57" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="15" font-weight="800" fill="#fff">1</text>
  </g>
</svg>`;

const steps = (list) => `<ol class="steps">${list.map(([state, title, detail], i) =>
  `<li class="${state}"><span class="dot">${state === "done" ? "&#10003;" : i + 1}</span><b>${esc(title)}</b><span>${esc(detail)}</span></li>`).join("")}</ol>`;

// "You're in": shown after confirming an email or paying.
// "Invite 2 friends, get a month free": earned when 2 invited friends become paying members.
// The WhatsApp share carries their invite link.
export function invite(ctx, { refLink, joined = 0, paid = 0, perReward = 2 }) {
  const share = `I get remote jobs that hire Nigerians in my inbox every morning, checked for scams. Free for ${ctx.trialDays} days: ${refLink}`;
  const n = paid % perReward, earned = Math.floor(paid / perReward);
  return `<div class="card invite"><b>🎁 Invite 2 friends, get a month free</b>
<p class="small" style="margin:6px 0 0">You get a free month for every 2 friends you invite who become members.</p>
<div class="bar"><i style="width:${Math.round((n / perReward) * 100)}%"></i></div>
<p class="small" style="margin:0">${n} of ${perReward} friends became members${joined ? ` &middot; ${joined} joined` : ""}${earned ? ` &middot; ${earned} free month${earned === 1 ? "" : "s"} earned` : ""}</p>
<div class="actions"><a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(share)}">Invite on WhatsApp</a></div>
<div class="copylink"><span class="cl-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg></span>
<input readonly value="${esc(refLink.replace(/^https?:\/\//, ""))}" aria-label="Your invite link" onclick="this.select()">
<button type="button" data-copy="${esc(refLink)}">Copy</button></div>
<script>document.querySelectorAll("[data-copy]").forEach(function(b){b.addEventListener("click",function(){var t=b.getAttribute("data-copy"),done=function(){b.textContent="Copied ✓";b.classList.add("ok");setTimeout(function(){b.textContent="Copy";b.classList.remove("ok");},2000);};
if(navigator.clipboard){navigator.clipboard.writeText(t).then(done,function(){b.previousElementSibling.select();});}else{b.previousElementSibling.select();document.execCommand("copy");done();}});});</script></div>`;
}

export function welcome(ctx, { title = "You're in! 🎉", until, trial = true, sub, soon = false, refLink, joined = 0, paid = 0 }) {
  return page(ctx, `<div class="hero">${ART_ROCKET}<h1>${esc(title)}</h1><p>Your jobs are on their way.</p>
<span class="pill">${trial ? "Free trial" : "Active"} until ${esc(until)}</span></div>
<div class="card">${steps([
    ["done", "Email confirmed", "You're all set"],
    ["now", "Searching for your jobs", "Remote and local job boards, checked for scams and dead links"],
    ["", "First matches in your inbox", soon ? "In a few minutes, then every morning" : "Tomorrow morning, and every morning after"],
  ])}
<div class="actions"><a class="btn ghost" href="/manage/${esc(sub.token)}">Change my preferences</a></div></div>
${refLink ? invite(ctx, { refLink, joined, paid }) : ""}
${ctx.fromEmail ? `<p class="note">📌 Add <b>${esc(ctx.fromEmail)}</b> to your contacts so your jobs don't land in spam.</p>` : ""}`);
}

export function checkInbox(ctx, email) {
  return page(ctx, `<div class="hero">${ART_MAIL}<h1>Check your inbox 📬</h1>
<p>We've sent a link to <b>${esc(email)}</b>.<br>Tap it and your jobs are on their way.</p></div>
<div class="card">${steps([
    ["done", "Signed up", "Your preferences are saved"],
    ["now", "Confirm your email", "Open the email from JobAlert and tap the button"],
    ["", "Get matched jobs", "Every morning, checked for scams and never repeated"],
  ])}</div>
<p class="note">Can't find it? Check Spam or Promotions${ctx.fromEmail ? `. It comes from <b>${esc(ctx.fromEmail)}</b>` : ""}.</p>`);
}

// "Is this real?": the answers people from an ad want before they pay. Facts only, no made-up reviews.
const TRUST_STYLE = `<style>
  .trust { max-width:860px; margin:0 auto; padding:24px; border-radius:22px; background:var(--card); border:1px solid var(--border); }
  .trust h2 { margin:0 0 14px; font-size:1.35rem; letter-spacing:-.02em; }
  .trust ul { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
  .trust li { display:flex; gap:12px; align-items:flex-start; }
  .trust li b { display:block; } .trust li span { display:block; color:var(--muted); font-size:.92rem; }
  .trust i { flex:none; width:30px; height:30px; border-radius:50%; display:grid; place-items:center; font-style:normal; font-weight:800;
    color:var(--ok); background:color-mix(in srgb, var(--ok) 14%, var(--card)); }
  .landing .trust-wrap { padding-top:72px; }
  .found .trust { margin-top:22px; padding:18px; }
  .trust .mail { display:inline-flex; align-items:center; gap:8px; margin-top:10px; padding:10px 16px; border-radius:999px;
    background:var(--accent); color:var(--on-accent); font-weight:700; font-size:.92rem; text-decoration:none; }
  .trust .mail:hover { filter:brightness(1.08); }
  .trust .mail svg { width:17px; height:17px; }
</style>`;

export function trust(ctx) {
  const row = (title, text, extra = "") => `<li><i>✓</i><div><b>${title}</b><span>${text}</span>${extra}</div></li>`;
  const mailIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
  return `${TRUST_STYLE}<section class="trust" aria-labelledby="trust_h"><h2 id="trust_h">Is this real?</h2><ul>
${row("Real jobs from real companies", "From over 1,000 companies' own career pages and trusted job boards.")}
${row("Every job is checked", "Scams, unpaid work and closed adverts are taken out before they reach you.")}
${row("Pay once, no surprises", `${esc(ctx.price)} for ${ctx.months} months. Nothing renews automatically.`)}
${ctx.contact ? row("Questions? Ask a person", "A real person reads and answers every message.",
    `<a class="mail" href="mailto:${esc(ctx.contact)}?subject=${encodeURIComponent(`Question about ${ctx.siteName}`)}">${mailIcon}Email us</a>`) : ""}
</ul></section>`;
}

// Right after confirming: their first jobs (3 shown, the rest blurred), with the membership offer.
// Until the first search has run, a short wait page that reloads itself.
const FOUND_STYLE = `<style>
  .found .hero { text-align:left; }
  .found .ready { font-size:.8rem; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#ff9f1c; }
  .found h1 { margin:6px 0 4px; }
  .fjob { border:1px solid var(--border); border-radius:14px; padding:13px 15px; margin-bottom:10px; background:var(--card); }
  .fjob b { display:block; } .fjob span { color:var(--muted); font-size:.88rem; }
  .fjob i { display:inline-block; margin-top:7px; font-style:normal; font-size:.75rem; font-weight:700; color:var(--ok); background:color-mix(in srgb, var(--ok) 12%, var(--card)); border-radius:20px; padding:3px 9px; }
  .blurred { position:relative; } .blurred .fjob { filter:blur(5px); opacity:.6; user-select:none; }
  .blurred em { position:absolute; inset:0; display:grid; place-items:center; font-style:normal; }
  .blurred em span { background:var(--card); border-radius:99px; padding:8px 16px; font-weight:800; box-shadow:0 6px 20px #0b153033; }
  a.unlock { display:block; text-align:center; text-decoration:none; margin-top:16px; padding:15px; border-radius:14px; background:#ffc75a; color:#1b2440; font-weight:800; font-size:1.1rem; }
  a.unlock small { display:block; font-size:.85rem; font-weight:600; margin-top:3px; }
  .found .trial { text-align:center; color:var(--muted); font-size:.92rem; margin-top:12px; }
  .found .trial a { font-weight:700; }
  .spin { width:44px; height:44px; border-radius:50%; border:4px solid var(--border); border-top-color:var(--accent); animation:spin 1s linear infinite; margin:10px 0 18px; }
  @keyframes spin { to { transform:rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation:none; } }
</style>`;

export function found(ctx, { sub, jobs, spares, state, tries = 0 }) {
  const t = esc(sub.token);
  if (state === "waiting") {
    const next = tries < 36 ? `<meta http-equiv="refresh" content="5;url=/found/${t}?n=${tries + 1}">` : "";
    return page(ctx, `${FOUND_STYLE}${next}<div class="found"><div class="hero"><div class="spin" role="status" aria-label="Searching"></div>
<h1>Finding your jobs 🔎</h1><p>${tries < 36 ? "This takes about a minute. Keep this page open." : "Still searching. Your jobs will be in your inbox shortly."}</p></div></div>`);
  }
  if (state === "none") {
    return page(ctx, `${FOUND_STYLE}<div class="found"><div class="hero"><h1>We're on it 🔎</h1>
<p>Nothing fits yet, but new jobs arrive every morning. Broader job titles find more.</p></div>
<a class="btn" href="/manage/${t}">Change my job titles</a></div>`);
  }
  const card = (j) => {
    const tags = String(j.matched || "").split(" · ").filter((m) => /^open to |entry-level|part-time|full-time/.test(m)).slice(0, 2);
    return `<div class="fjob"><b>${esc(j.title)}</b><span>${esc([j.company, j.location, j.pay].filter(Boolean).join(" · "))}</span>${
      tags.map((m) => `<br><i>✓ ${esc(m)}</i>`).join("")}</div>`;
  };
  const total = jobs.length + spares;
  return page(ctx, `${FOUND_STYLE}<div class="found"><div class="hero"><span class="ready">Your jobs are ready</span>
<h1>We found ${total} job${total === 1 ? "" : "s"} for you</h1></div>
${jobs.map(card).join("")}
${spares ? `<div class="blurred" aria-hidden="true"><div class="fjob"><b>Customer Success Associate</b><span>Remote · Worldwide</span></div>
<div class="fjob"><b>Operations Assistant</b><span>Remote · EMEA</span></div><em><span>+${spares} more job${spares === 1 ? "" : "s"}</span></em></div>` : ""}
${ctx.paidService ? `<a class="unlock" href="/pay/${t}">${spares ? "Unlock all" : "Get 5 jobs a day"}, ${esc(ctx.price)}<small>Get a tailored CV and cover letter for each job</small></a>` : ""}
<p class="trial">or <a href="/login/${t}">start the free trial</a></p>
${ctx.paidService ? trust(ctx) : ""}</div>`);
}

// Someone signed up again with an address that's already confirmed: nothing changes, and the
// manage link goes to their inbox, so only the address owner can change or pay.
export function welcomeBack(ctx, email) {
  return page(ctx, `<div class="hero">${ART_MAIL}<h1>Welcome back 👋</h1>
<p><b>${esc(email)}</b> is already signed up, so we didn't change anything.</p></div>
<div class="card"><p style="margin:0">We've emailed you a link to <b>manage your job alerts</b>. Open it to change your job titles,
location or level${ctx.paidService ? `, or to pay ${esc(ctx.price)} for ${ctx.months} months` : ""}.</p></div>
<p class="note">Can't find it? Check Spam or Promotions${ctx.fromEmail ? `. It comes from <b>${esc(ctx.fromEmail)}</b>` : ""}.</p>`);
}

// Why JobAlert: the three strengths, near the top of the home page.
const ICONS = {
  globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>`,
  inbox: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h4.5l1 2h5l1-2H20"/><path d="M9.5 9.5l1.8 1.8 3.4-3.6"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12.2l2.2 2.2 4.3-4.6"/></svg>`,
};

function strengths() {
  const item = (icon, color, title, text) =>
    `<div class="card"><span class="ico ${color}">${ICONS[icon]}</span><div><h3>${title}</h3><p>${text}</p></div></div>`;
  return `<section class="why" aria-label="Why JobAlert">
  ${item("globe", "blue", "Foreign jobs that accept Nigerians",
    "Remote roles from companies abroad, often paying in dollars or pounds. We check every one is open to applicants in Nigeria.")}
  ${item("inbox", "gold", "Done for you, every morning",
    "No scrolling through huge job boards. A short, matched list lands in your inbox each morning, and you never see the same job twice.")}
  ${item("shield", "green", "Scams and dead links filtered out",
    "We drop listings that ask you to pay, push you to WhatsApp or Telegram, or point to jobs that have closed.")}
</section>`;
}

// JobAlert vs doing it yourself (no named competitors: fair to everyone, and true).
function compare() {
  const row = (what, us, them) => `<tr><td>${what}</td><td class="us">✓ ${us}</td><td class="them">${them}</td></tr>`;
  return `<section class="vs card"><h2>Why not just search job boards?</h2><table><colgroup><col class="a"><col class="b"><col></colgroup>
<tr><th></th><th>JobAlert</th><th>On your own</th></tr>
${row("Remote jobs from abroad", "Every morning", "Mostly local listings")}
${row("Open to Nigerians?", "Checked for you", "Find out after applying")}
${row("Scams and closed jobs", "Filtered out", "Common, especially in WhatsApp groups")}
${row("Effort", "Read one email", "Hours of scrolling")}
${row("Repeats", "Never", "Same posts again and again")}
</table></section>`;
}

// "What you get": free trial vs member, shown under the sign-up form.
function plans(ctx) {
  const li = (text, yes = true) => `<li${yes ? "" : ' class="no"'}>${text}</li>`;
  return `<section class="plans" id="plans"><h2>What you get</h2>
<div class="card plan"><h3>Free trial</h3><p class="cost"><b>₦0</b> for ${ctx.trialDays} days, no card</p><ul>
  ${li("<b>3 jobs</b> every morning")}
  ${li("Searches your first <b>2 job titles</b>")}
  ${li("Remote jobs, or on-site near you")}
  ${li("Checked for scams, dead links and jobs you can't apply for from your country")}
  ${li("Never the same job twice")}
  ${li("Telegram alerts during the day", false)}
</ul></div>
<div class="card plan best"><span class="tag">BEST VALUE</span><h3>Member</h3><p class="cost">${ctx.paidService
    ? `<b>${esc(ctx.price)}</b>${was(ctx)} for ${ctx.months} months, paid once${ctx.launchLeft ? `<br>${launchNote(ctx)}` : ""}`
    : "<b>Coming soon</b>"}</p><ul>
  ${li("The <b>5 best jobs</b> every morning, <b>more whenever you ask</b>")}
  ${li("Searches all <b>5 job titles</b>")}
  ${li("<b>Telegram alerts</b> every two hours, so you apply first")}
  ${li("<b>Your CV tailored</b> to any job, an <b>AI cover letter</b> and <b>interview prep</b>")}
  ${li("Everything in the free trial")}
  ${li("No auto-renewal; we remind you before it ends")}
</ul></div></section>`;
}

// The home page's sign-up: four cards, one question each, email last (fields as in form(), so /subscribe is unchanged).
const QUICK_COUNTRIES = ["Nigeria", "Ghana", "Kenya", "South Africa"];

function signupCards(ctx, ref) {
  const bar = (n) => `<div class="progress">${[1, 2, 3, 4].map((i) => `<i${i <= n ? ' class="on"' : ""}></i>`).join("")}</div>
  <span class="count">${n < 4 ? `${n} of 4` : "Last step"}</span>`;
  const nav = (n, next = "Next") => `<div class="navrow">${n > 1 ? '<button type="button" class="back">Back</button>' : ""}${
    n < 4 ? `<button type="button" class="next">${next}</button>` : '<button type="submit" id="submit">Send me jobs</button>'}</div>`;
  const opt = (name, value, text, hint = "", checked = false) => `<input id="${name}_${esc(value || "any").replace(/\W/g, "_")}" name="${name}" type="radio" value="${esc(value)}"${chk(checked)}>
    <label for="${name}_${esc(value || "any").replace(/\W/g, "_")}"><span>${text}${hint ? `<small>${hint}</small>` : ""}</span></label>`;
  return `<form class="card cards" method="post" action="/subscribe" id="prefs" novalidate>
<section class="step now" data-step="1">${bar(1)}
  <h2>Pick 5 jobs you'd do</h2><p class="sub">More job titles, more matches</p>
  <div class="picked" aria-live="polite"><span class="dots">${"<i></i>".repeat(5)}</span><b>0 of 5</b></div>
  <div class="chips">${JOBS.map((j, i) => `<input id="job${i}" name="job" type="checkbox" value="${esc(j)}"><label for="job${i}">${esc(j)}</label>`).join("")}</div>
  <div class="similar" hidden><p class="simh">Similar jobs</p><div class="chips">${ALL_JOBS.filter((j) => !JOBS.includes(j)).map((j, i) =>
    `<input id="rel${i}" name="job" type="checkbox" value="${esc(j)}" data-for="${esc(JOBS.filter((b) => RELATED[b].includes(j)).join("|"))}"><label for="rel${i}" hidden>${esc(j)}</label>`).join("")}</div></div>
  <label for="other">Something else <span class="hint">Separate with commas</span></label>
  <input id="other" name="other" type="text" maxlength="200" placeholder="e.g. public relations">
  ${nav(1, "Pick 5 jobs")}
</section>
<section class="step" data-step="2">${bar(2)}
  <h2>Where do you live?</h2><p class="sub">We only send jobs open to your country</p>
  <div class="opts">${QUICK_COUNTRIES.map((c, i) => opt("country", c, esc(c), "", i === 0)).join("")}
  ${opt("country", "other", "Another country")}</div>
  <div id="country_box" hidden><label for="country_pick">Your country</label>
  <select id="country_pick" name="country_other"><option value="">Anywhere / don't filter</option>
    ${COUNTRIES.filter((c) => !QUICK_COUNTRIES.includes(c)).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></div>
  ${nav(2)}
</section>
<section class="step" data-step="3">${bar(3)}
  <h2>How much experience?</h2>
  <div class="opts">${opt("level", "entry", "Just starting", "Entry level, junior", true)}${opt("level", "mid", "A few years", "Mid level")}${opt("level", "any", "Any level")}</div>
  <label id="hours_label">Hours</label>
  <div class="hours" role="radiogroup" aria-labelledby="hours_label">
    ${[["any", "Any"], ["full", "Full-time"], ["part", "Part-time"]].map(([v, l]) =>
      `<input id="h_${v}" name="hours" type="radio" value="${v}"${chk(v === "any")}><label for="h_${v}">${l}</label>`).join("")}
  </div>
  ${nav(3)}
</section>
<section class="step" data-step="4">${bar(4)}
  <h2>Where should we send your jobs?</h2>
  <input id="email" name="email" type="email" required maxlength="320" placeholder="you@example.com" autocomplete="email">
  <label for="heard">How did you hear about us? <span class="hint">Optional</span></label>
  <select id="heard" name="heard"><option value="">Choose one</option>${HEARD.map((h) => `<option>${esc(h)}</option>`).join("")}</select>
  <input class="hp" name="website" tabindex="-1" autocomplete="off">${ref ? `
  <input type="hidden" name="ref" value="${esc(ref)}">` : ""}
  ${nav(4)}
  <p class="free">${ctx.trialDays} days free &middot; no card</p>
</section>
</form>`;
}

const SIGNUP_SCRIPT = `<script>
  (function () {
    var form = document.getElementById("prefs"), steps = form.querySelectorAll(".step"), at = 0;
    document.documentElement.classList.add("js");
    var boxes = form.querySelectorAll("input[name=job]"), other = document.getElementById("other");
    var countryBox = document.getElementById("country_box");
    function chosen() {
      var list = [];
      boxes.forEach(function (b) { if (b.checked) list.push(b.value); });
      other.value.split(",").forEach(function (w) { if (w.trim()) list.push(w.trim()); });
      return list;
    }
    var picked = form.querySelector(".picked"), next1 = steps[0].querySelector(".next");
    var similar = form.querySelector(".similar");
    function syncJobs() {
      var picks = []; boxes.forEach(function (b) { if (b.checked && !b.dataset.for) picks.push(b.value); });
      var any = false;
      form.querySelectorAll(".similar input").forEach(function (b) {
        var show = b.checked || b.dataset.for.split("|").some(function (p) { return picks.indexOf(p) >= 0; });
        b.nextElementSibling.hidden = !show; any = any || show;
      });
      similar.hidden = !any;
      var n = chosen().length;
      boxes.forEach(function (b) { b.disabled = !b.checked && n >= 5; });
      picked.querySelectorAll("i").forEach(function (d, i) { d.className = i < n ? "on" : ""; });
      picked.querySelector("b").textContent = Math.min(n, 5) + " of 5";
      next1.textContent = n >= 5 ? "Next" : n ? "Pick " + (5 - n) + " more" : "Pick 5 jobs";
      next1.classList.toggle("wait", n < 5);
    }
    function show(i) {
      steps[at].classList.remove("now"); at = i; steps[at].classList.add("now");
      var first = steps[at].querySelector("input:not([type=hidden]):not(.hp), select");
      if (first && at === 3) first.focus();
    }
    function ok() {
      if (at === 0) {
        var n = chosen().length;
        other.setCustomValidity(n < 5 ? "Pick " + (5 - n) + " more, or type your own (separate with commas)" : n > 5 ? "Pick only 5 jobs" : "");
        if (!other.reportValidity()) return false;
        other.setCustomValidity("");
      }
      return true;
    }
    form.addEventListener("input", syncJobs);
    form.addEventListener("change", function () {
      var c = form.querySelector("input[name=country]:checked");
      countryBox.hidden = !(c && c.value === "other");
    });
    form.querySelectorAll(".next").forEach(function (b) { b.addEventListener("click", function () { if (ok()) show(at + 1); }); });
    form.querySelectorAll(".back").forEach(function (b) { b.addEventListener("click", function () { show(at - 1); }); });
    form.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && at < 3 && e.target.tagName !== "BUTTON") { e.preventDefault(); if (ok()) show(at + 1); }
    });
    form.addEventListener("submit", function (e) {
      var email = document.getElementById("email");
      if (chosen().length < 5) { e.preventDefault(); show(0); ok(); return; }
      if (!email.checkValidity()) { e.preventDefault(); email.reportValidity(); return; }
      var b = document.getElementById("submit");
      b.disabled = true;
      b.textContent = "Sending...";
    });
    syncJobs();
  })();
</script>`;

const FORM_SCRIPT = `<script>
  (function () {
    var form = document.getElementById("prefs"), box = document.getElementById("city_box"), city = document.getElementById("city");
    function sync() {
      var onsite = document.getElementById("wt_onsite").checked;
      box.hidden = !onsite;
      city.required = onsite;
    }
    if (location.hash === "#plans") document.getElementById("plans").open = true;
    form.addEventListener("change", sync);
    sync();
    var jobs = document.getElementById("jobs"), boxes = jobs.querySelectorAll("input[type=checkbox]"),
        other = document.getElementById("other"), label = jobs.querySelector("summary");
    function chosen() {
      var list = [];
      boxes.forEach(function (b) { if (b.checked && list.indexOf(b.value) < 0) list.push(b.value); });
      other.value.split(",").forEach(function (w) { if (w.trim()) list.push(w.trim()); });
      return list;
    }
    function syncJobs() {
      var list = chosen();
      label.textContent = list.length ? list.join(", ") : "Choose jobs";
      label.className = list.length ? "" : "empty";
      jobs.querySelectorAll(".subs").forEach(function (g) {
        var parent = jobs.querySelector('.row > input[value="' + g.dataset.parent + '"]');
        g.hidden = !(parent.checked || g.querySelector("input:checked"));
      });
      boxes.forEach(function (b) { b.disabled = !b.checked && list.length >= 5; });
      other.setCustomValidity(list.length > 5 ? "Pick up to 5 jobs" : "");
    }
    jobs.addEventListener("input", function (e) {
      // A similar job listed under two picks (e.g. Data entry) stays ticked or unticked in both places.
      boxes.forEach(function (b) { if (b.value === e.target.value) b.checked = e.target.checked; });
      syncJobs();
    });
    syncJobs();
    form.addEventListener("submit", function (e) {
      if (!chosen().length) {
        e.preventDefault();
        jobs.open = true;
        other.setCustomValidity("Pick at least one job, or type your own");
        other.reportValidity();
        other.setCustomValidity("");
        return;
      }
      var b = document.getElementById("submit");
      b.disabled = true;
      b.textContent = "Sending...";
    });
  })();
</script>`;

const sel = (cond) => (cond ? " selected" : "");
const chk = (cond) => (cond ? " checked" : "");

// The plan card at the top of the manage page: where they stand, time left, and the pay button.
export function membershipCard(ctx, sub, member, now = new Date()) {
  const until = sub.paid_until ? new Date(sub.paid_until) : null;
  const active = Boolean(until && until > now);
  const daysLeft = active ? Math.ceil((until - now) / 86400000) : 0;
  const date = until ? until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
  const [kind, badge] = !active ? ["off", "Not active"] : member ? ["member", "Member"] : ["trial", "Free trial"];
  const headline = !active ? (until ? `Ended on ${date}` : "No jobs being sent")
    : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  const sub2 = !active ? "Join to start getting matched jobs every morning again." : `Active until ${date}`;
  // Bar: share of one paid period (or the trial) still left, so it visibly runs down.
  const span = member ? Math.max(daysLeft, ctx.months * 30) : ctx.trialDays;
  const pct = active ? Math.max(4, Math.min(100, Math.round((daysLeft / span) * 100))) : 0;
  const cta = !active ? "Reactivate my alerts" : member ? "Add 3 more months" : "Become a member";
  return `<section class="plan ${kind}">
  <div class="plan-top"><span class="badge">${badge}</span><span class="plan-price">${esc(ctx.price)} <small>/ ${ctx.months} months</small></span></div>
  <p class="plan-head">${esc(headline)}</p>
  <p class="plan-sub">${esc(sub2)}</p>
  ${active ? `<div class="meter" role="progressbar" aria-label="Time left" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>` : ""}
  <a class="plan-cta" href="/pay/${esc(sub.token)}">${esc(cta)} <span aria-hidden="true">→</span></a>
  <p class="plan-note">${member || active ? "Added on top of your current time · " : ""}One payment · No auto-renewal · Secure checkout by ${esc(ctx.provider)}</p>
</section>`;
}

export function form(ctx, { sub = null, action, button, heading, lead, status = "", member = false, telegramLink = null,
  whatsapp = false, ref = "", inviteBox = "" }) {
  const onsite = sub && !sub.remote_only;
  const words = String(sub?.keywords || "").split(",").map((w) => w.trim()).filter(Boolean);
  const listed = (w) => ALL_JOBS.find((j) => j.toLowerCase() === w.toLowerCase());
  const picked = words.map(listed).filter(Boolean);
  const other = words.filter((w) => !listed(w)).join(", ");
  // Home page: only the headline and a short form; everything else waits behind "See what you get".
  const statusBox = !sub || !status ? "" : ctx.paidService ? membershipCard(ctx, sub, member)
    : `<p class="card status">${esc(status)}</p>`;
  const telegramBox = !telegramLink ? "" : `<p class="card status">${sub.telegram_chat_id
    ? "Telegram alerts are on: new matches arrive there during the day. Send /stop to the bot to turn them off."
    : `Get new matches on Telegram during the day, before the morning email. <a href="${esc(telegramLink)}">Connect Telegram</a>`}</p>`;
  const whatsappBox = !whatsapp ? "" : `<form class="card status wa" method="post" action="/whatsapp/${esc(sub.token)}">
  <label for="wa" style="margin-top:0">${sub.whatsapp ? "WhatsApp alerts are on" : "Get new matches on WhatsApp during the day"}</label>
  <div class="wa-row"><input id="wa" name="whatsapp" type="tel" inputmode="tel" maxlength="20" placeholder="0803 123 4567"
    value="${sub.whatsapp ? `+${esc(sub.whatsapp)}` : ""}"><button type="submit">${sub.whatsapp ? "Save" : "Turn on"}</button></div>
  ${sub.whatsapp ? `<p class="small" style="margin:6px 0 0">Clear the number and save to turn them off.</p>` : ""}
</form>`;
  const intro = sub ? `<h1>${esc(heading)}</h1>
<p class="lead">${esc(lead)}</p>` : `<div class="home"><h1>Remote jobs that <em>actually hire Nigerians</em></h1>
<p class="lead">${esc(lead)}</p></div>`;
  const formHtml = `<form class="card" method="post" action="${esc(action)}" id="prefs">
  ${sub ? "" : `<label for="email">Your email</label>
  <input id="email" name="email" type="email" required maxlength="320" placeholder="you@example.com">`}
  <label id="jobs_label">What jobs do you want? <span class="hint">Pick 5 for more matches${sub && !member && !allTitlesTrial(sub) ? ". The free trial searches the first 2" : ""}</span></label>
  <details class="pick" id="jobs"><summary class="${picked.length || other ? "" : "empty"}" aria-labelledby="jobs_label">${
    esc([...picked, other].filter(Boolean).join(", ") || "Choose jobs")}</summary>
  <div class="opts">
    ${JOBS.map((j, i) => `<div class="row"><input id="job${i}" name="job" type="checkbox" value="${esc(j)}"${chk(picked.includes(j))}>
      <label for="job${i}">${esc(j)}</label></div>
    <div class="subs" data-parent="${esc(j)}"${picked.includes(j) || RELATED[j].some((r) => picked.includes(r)) ? "" : " hidden"}><p class="simh">Similar jobs</p>${
      RELATED[j].map((r, k) => `<div class="row"><input id="rel${i}_${k}" name="job" type="checkbox" value="${esc(r)}"${chk(picked.includes(r))}>
      <label for="rel${i}_${k}">${esc(r)}</label></div>`).join("")}</div>`).join("\n    ")}
    <label for="other">Something else <span class="hint">Separate with commas</span></label>
    <input id="other" name="other" type="text" maxlength="200" placeholder="e.g. public relations" value="${esc(other)}">
  </div></details>
  <label for="country">Where do you live?</label>
  <select id="country" name="country">
    <option value="">Anywhere / don't filter</option>
    ${COUNTRIES.map((c) => `<option value="${esc(c)}"${sel(sub?.country === c)}>${esc(c)}</option>`).join("")}
  </select>
  <label id="hours_label">Hours</label>
  <div class="hours" role="radiogroup" aria-labelledby="hours_label">
    ${[["any", "Any"], ["full", "Full-time"], ["part", "Part-time"]].map(([v, l]) =>
      `<input id="h_${v}" name="hours" type="radio" value="${v}"${chk((sub?.hours || "any") === v)}><label for="h_${v}">${l}</label>`).join("")}
  </div>
  <details class="fold more"${onsite || (sub && sub.level !== "entry") ? " open" : ""}><summary>More options</summary>
  <fieldset>
    <legend>How do you want to work?</legend>
    <div class="row"><input id="wt_remote" name="work_type" type="radio" value="remote"${chk(!onsite)}>
      <label for="wt_remote" style="margin:0">Remote <span class="hint">(work from anywhere)</span></label></div>
    <div class="row"><input id="wt_onsite" name="work_type" type="radio" value="onsite"${chk(onsite)}>
      <label for="wt_onsite" style="margin:0">On-site or hybrid</label></div>
  </fieldset>
  <div id="city_box"${onsite ? "" : " hidden"}>
    <label for="city">Preferred city or area <span class="hint">We'll look for jobs near here, plus remote ones</span></label>
    <input id="city" name="city" type="text" maxlength="120" placeholder="e.g. Lagos, Manchester" value="${esc(sub?.city)}">
  </div>
  <label for="level">Experience level</label>
  <select id="level" name="level">
    <option value="any"${sel(sub?.level === "any")}>Any level</option>
    <option value="entry"${sel(!sub || sub.level === "entry")}>Entry level / junior</option>
    <option value="mid"${sel(sub?.level === "mid")}>Mid level (no director/head roles)</option>
  </select>
  </details>
  ${sub ? "" : `<label for="heard">How did you hear about us? <span class="hint">Optional</span></label>
  <select id="heard" name="heard"><option value="">Choose one</option>${HEARD.map((h) => `<option>${esc(h)}</option>`).join("")}</select>`}
  <input class="hp" name="website" tabindex="-1" autocomplete="off">${ref ? `
  <input type="hidden" name="ref" value="${esc(ref)}">` : ""}
  <button type="submit" id="submit">${esc(button)}</button>
  ${sub ? "" : `<p class="free">${ctx.trialDays} days free &middot; no card</p>`}
</form>`;
  const script = FORM_SCRIPT;
  if (!sub) return page(ctx, landing(ctx, signupCards(ctx, ref)) + SIGNUP_SCRIPT, { landing: true });
  return page(ctx, `${intro}
${statusBox}${member ? `<a class="card apps-link" href="/login/${esc(sub.token)}">🏠 My dashboard: CV, cover letters, more jobs <span>&rarr;</span></a>
<a class="card apps-link" href="/applications/${esc(sub.token)}">📋 My applications <span>&rarr;</span></a>` : ""}${telegramBox}${whatsappBox}
${formHtml}
<details class="fold info" id="plans"><summary>${sub ? "How it works" : "See what you get"}</summary>
${sub ? "" : strengths() + plans(ctx) + compare()}
  ${ctx.paidService && !sub ? `<p class="small"><b>Free for ${ctx.trialDays} days, then ${esc(ctx.price)} for ${ctx.months} months</b>, paid once through ${esc(ctx.provider)} if you want to continue. Nothing renews automatically. <a href="/terms">Terms and refunds</a>.</p>` : ""}
  <p class="small">One email every morning with ${member ? "the 5 best" : "3"} new matches${member ? ", and 5 more on your dashboard whenever you ask" : ctx.paidService ? " (members get the 5 best and more whenever they ask, plus tailored CVs, cover letters and Telegram alerts)" : ""}. If your own titles are quiet, we add similar roles. Remote jobs that only hire from certain countries are left out if yours isn't one of them. We skip senior roles if you choose a lower level, and we filter out unpaid roles and listings with common scam signs. Every email has a one-click unsubscribe link. We only store your email and these preferences, never share them, and delete them when you unsubscribe.</p>
</details>
${inviteBox}
${sub ? `<p class="small" style="text-align:center"><a class="quiet" href="/unsubscribe/${esc(sub.token)}">Unsubscribe and delete my details</a></p>` : ""}
${script}`);
}

export function pay(ctx, { sub, heading, status }) {
  return page(ctx, `<h1>${esc(heading)}</h1>
<p class="lead">Alerts for ${esc(sub.email)}${status ? `. ${esc(status)}` : ""}</p>
<form class="card" method="post" action="/pay/${esc(sub.token)}" id="payform">
  <p class="price"><b>${esc(ctx.price)}</b>${was(ctx)} for ${ctx.months} months</p>${ctx.launchLeft ? `<p class="small">${launchNote(ctx)}</p>` : ""}
  <ul class="perks">
    <li>The 5 best new matches every morning across all 5 of your job titles, and 5 more whenever you ask (the trial gets 3 jobs a day${allTitlesTrial(sub) ? "" : " from 2 titles"})</li>
    <li>New matches on Telegram during the day, so you can apply first</li>
    <li>${sub.remote_only ? "Remote jobs" : `Jobs near ${esc(sub.city)}, plus remote ones`}, checked for scams and dead links</li>
    <li>One payment. Nothing renews automatically; we'll email you before it ends</li>
  </ul>
  <button type="submit" id="paybtn">Pay ${esc(ctx.price)} securely with ${esc(ctx.provider)}</button>
  <p class="small">You'll pay on ${esc(ctx.provider)}'s secure page by card or bank transfer. We never see your card details.
    See our <a href="/terms">terms and refund policy</a>.</p>
</form>
<p class="small"><a href="/manage/${esc(sub.token)}">Change my preferences</a> &middot;
  <a href="/unsubscribe/${esc(sub.token)}">Unsubscribe and delete my details</a></p>
<script>
  document.getElementById("payform").addEventListener("submit", function () {
    var b = document.getElementById("paybtn"); b.disabled = true; b.textContent = "Opening ${esc(ctx.provider)}...";
  });
</script>`);
}

export function terms(ctx) {
  return page(ctx, `<h1>Terms, pricing and refunds</h1>
<div class="card">
  <p><b>What you get.</b> ${esc(ctx.siteName)} emails you new job listings every morning (3 a day on the free trial, the 5 best a day for members, with more on request) that match the job titles, location and
    experience level you choose. We search public job boards and filter out listings that look unpaid, expired or like scams,
    but we don't employ anyone, can't guarantee a job, and you should always read a listing yourself before applying.</p>
  <p><b>Free trial.</b> Everyone gets ${ctx.trialDays} days of alerts free when they confirm their email. No card needed.</p>
  ${ctx.paidService ? `<p><b>Price.</b> ${esc(ctx.price)} for ${ctx.months} months, paid once through ${esc(ctx.provider)}. It does not renew automatically; we email
    you before it ends with a link to renew if you want to.</p>
  <p><b>Refunds.</b> If you're not happy within 7 days of paying, email us and we'll refund you in full. After that, payments
    aren't refundable, but you can stop the emails any time.</p>` : ""}
  <p><b>Your data.</b> We store your email, your preferences, a record of your payments and, if you use cover letters or tailored CVs,
    the CV you paste. Your CV is only used to write your letters and tailored CVs (it's sent to our AI provider, Anthropic, for that).
    We never share your details otherwise, and unsubscribing deletes your email, preferences and CV (payment records
    are kept for accounting).</p>
  ${ctx.contact ? `<p><b>Contact.</b> <a href="mailto:${esc(ctx.contact)}">${esc(ctx.contact)}</a></p>` : ""}
</div>
<p class="small"><a href="/">Back to sign-up</a></p>`);
}

export { COUNTRIES };

// Remote roles foreign companies most often hire for from abroad; anything else goes in "Something else".
export const HEARD = ["TikTok", "WhatsApp", "X (Twitter)", "Instagram", "LinkedIn", "Facebook", "A friend", "Campus or NYSC", "Google", "Other"];

// "₦3,500 ~~₦5,000~~" while the launch offer runs, with how many places are left.
const launchNote = (ctx) => (ctx.launchLeft ? `<span class="launch">Launch price for the first ${ctx.launchSpots} members: ${ctx.launchLeft} ${ctx.launchLeft === 1 ? "place" : "places"} left</span>` : "");
const was = (ctx) => (ctx.fullPrice ? ` <s>${esc(ctx.fullPrice)}</s>` : "");

export const JOBS = ["Virtual assistant", "Customer support", "Software developer", "Data analyst", "Content writer",
  "Social media manager", "Graphic designer", "Digital marketing", "Project manager", "Bookkeeper"];
// Similar titles offered on the sign-up card once someone picks one of JOBS, to keep their 5 picks in one field.
export const RELATED = {
  "Virtual assistant": ["Executive assistant", "Administrative assistant", "Personal assistant", "Data entry", "Operations assistant", "AI trainer"],
  "Customer support": ["Customer service", "Customer success", "Live chat agent", "Technical support", "Call centre agent"],
  "Software developer": ["Mobile developer", "Full stack developer", "Frontend developer", "Backend developer", "Web developer", "QA tester", "Machine learning engineer", "AI engineer"],
  "Data analyst": ["Business analyst", "Data scientist", "Research analyst", "BI analyst", "Data entry"],
  "Content writer": ["Copywriter", "Technical writer", "SEO writer", "Editor", "Proofreader", "Prompt engineer"],
  "Social media manager": ["Community manager", "Content creator", "Social media marketer", "Video editor"],
  "Graphic designer": ["UI/UX designer", "Brand designer", "Illustrator", "Motion designer", "Video editor"],
  "Digital marketing": ["SEO specialist", "Email marketing", "Marketing assistant", "Growth marketer", "PPC specialist"],
  "Project manager": ["Product manager", "Operations manager", "Scrum master", "Program coordinator"],
  "Bookkeeper": ["Accountant", "Accounts assistant", "Payroll officer", "Finance assistant"],
};
// Owner's rule (17 Oct 2026, same as payments.ALL_TITLES_TRIAL_FROM): trials started after this search all 5 titles.
export const allTitlesTrial = (sub) => !!sub?.created_at && new Date(sub.created_at) >= new Date("2026-10-17T14:42:00Z");
export const ALL_JOBS = [...new Set([...JOBS, ...Object.values(RELATED).flat()])];

// AI cover letter or tailored CV for one job (members). Shows the result once written, and the form to (re)write it.
// The tailored CV can also be downloaded as a Word file (.docx, docx.js), built in the browser from the text.
export function letterPage(ctx, { kind = "letter", sub, job, hasCv, cv = "", letter = "", left, error = "" }) {
  const isCv = kind === "cv", isPrep = kind === "prep";
  const noun = isCv ? "CV" : isPrep ? "prep sheet" : "letter";
  const cvField = `<label for="cv">Your CV <span class="hint">Paste the text once; we'll remember it</span></label>
  <textarea id="cv" name="cv" rows="8" maxlength="15000"${hasCv ? "" : " required"} placeholder="Paste your CV here">${esc(cv)}</textarea>`;
  const other = `/${isCv ? "letter" : "cv"}/${sub.token}?${new URLSearchParams({ t: job.title, c: job.company, u: job.url })}`;
  const otherText = isCv ? "Write a cover letter for it too" : isPrep ? "Get your CV tailored to this job" : "Get your CV tailored to this job too";
  const fileName = `CV - ${job.title}${job.company ? ` - ${job.company}` : ""}`.replace(/[^\w .,&()-]+/g, " ").slice(0, 120);
  return page(ctx, `<h1>${isCv ? "📄 Your CV for this job" : isPrep ? "🎤 Interview prep" : "✍️ Cover letter"}</h1>
<p class="lead">${esc(job.title)}${job.company ? ` at ${esc(job.company)}` : ""}</p>
${isCv && !letter ? `<p>We rewrite your CV for this job: a summary aimed at the role, your most relevant experience first,
and the advert's own words where they're true of you. Nothing is made up.</p>` : ""}
${isPrep && !letter ? `<p>The questions this interviewer is likely to ask, with answers built from your CV, plus questions to ask them.</p>` : ""}
${error ? `<p class="card status">${esc(error)}</p>` : ""}
${letter ? `<div class="card"><textarea id="letter" rows="${isCv || isPrep ? 24 : 16}" readonly>${esc(letter)}</textarea>
<div class="actions"><button type="button" id="copy" style="margin:0">Copy ${noun}</button>
${isCv ? `<button type="button" id="word" class="btn ghost" style="margin:0">Download for Word</button>` : ""}
${job.url ? `<a class="btn ghost" href="${esc(job.url)}">Open the job and apply</a>` : ""}</div>
<p class="note">${isCv ? "Check every line is true and your contact details are right before sending."
    : isPrep ? "Say the answers out loud a few times, in your own words. Good luck!"
    : "Read it through and add one detail only you know before sending."}
<a href="${esc(other)}">${otherText}</a></p></div>
<script>document.getElementById("copy").onclick=function(){var t=document.getElementById("letter");t.select();
navigator.clipboard?navigator.clipboard.writeText(t.value):document.execCommand("copy");this.textContent="Copied ✓";};
${isCv ? `var cvDocx=${cvDocx.toString().replace(/<\//g, "<\\/")};
document.getElementById("word").onclick=function(){
var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([cvDocx(document.getElementById("letter").value)],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}));
a.download=${JSON.stringify(fileName + ".docx").replace(/</g, "\\u003c")};document.body.appendChild(a);a.click();a.remove();};` : ""}</script>` : ""}
<form class="card" method="post" id="write"${letter ? ' style="margin-top:16px"' : ""}>
  ${hasCv ? `<details class="fold more" style="margin-top:0"><summary>Update my CV</summary>${cvField}</details>` : cvField}
  <button type="submit" id="go">${letter ? "Write it again" : isCv ? "Tailor my CV" : isPrep ? "Prepare me" : "Write my cover letter"}</button>
  <p class="free">${left} of 10 left today</p>
</form>
<script>document.getElementById("write").addEventListener("submit",function(){var b=document.getElementById("go");b.disabled=true;b.textContent="Writing... (about ${isCv || isPrep ? 40 : 20} seconds)";});</script>`);
}

// --- members' application tracker ---

const ANSWER_WORDS = { applied: "Applied", not_yet: "Not yet", skip: "Not for me", interview: "Interview", offer: "Offer", no_reply: "No reply" };

// Opened from the email's one-tap answers. The answer is only saved by the POST this page sends,
// so link checkers in mail apps that open every link can't answer for people.
export function answerPage(ctx, { job, answer }) {
  return page(ctx, `<div class="card empty"><p style="margin:0 0 6px"><b>${esc(job.title)}</b>${job.company ? ` &middot; ${esc(job.company)}` : ""}</p>
<form method="post" id="answer"><button type="submit" style="width:auto;padding:12px 28px">Save: ${esc(ANSWER_WORDS[answer])}</button></form></div>
<script>document.getElementById("answer").submit();</script>`);
}

const shortDate = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");

export function applications(ctx, { sub, rows, saved = 0, prep = false }) {
  const count = (...st) => rows.filter((r) => st.includes(r.status)).length;
  const applied = rows.filter((r) => r.status !== "not_yet");
  const waiting = rows.filter((r) => r.status === "not_yet");
  const card = (r, buttons) => `<form class="card app${r.id === saved ? " saved" : ""}" method="post" id="job${r.id}">
  <div class="app-top"><a href="/j/${esc(sub.token)}/${r.id}">${esc(r.title)}</a><time>${shortDate(r.status_at)}</time></div>
  ${r.company ? `<div class="co">${esc(r.company)}</div>` : ""}
  ${r.status === "interview" && prep ? `<a class="prep" href="/prep/${esc(sub.token)}?${esc(new URLSearchParams({ t: r.title, c: r.company || "", u: r.url || "" }).toString())}">🎤 Prepare for the interview</a>` : ""}
  <div class="seg">${buttons.map(([a, cls]) => `<button formaction="/job/${esc(sub.token)}/${r.id}/${a}" class="${cls || ""}${r.status === a ? " on" : ""}">${ANSWER_WORDS[a]}</button>`).join("")}</div>
</form>`;
  const body = !rows.length ? `<div class="card empty"><p style="margin:0">Nothing here yet.</p>
<p class="small" style="margin:8px 0 0">Open a job from your morning email and we'll ask the next day if you applied.</p></div>` : `
${waiting.length ? `<h2>Still deciding</h2>${waiting.map((r) => card(r, [["applied", "good"], ["not_yet"], ["skip", "skip"]])).join("")}` : ""}
${applied.length ? `<h2>Applied</h2>${applied.map((r) => card(r, [["applied"], ["interview"], ["offer", "good"], ["no_reply"]])).join("")}` : ""}`;
  return page(ctx, `<h1>My applications</h1>
<p class="lead">Every job you applied to, and where it stands.</p>
<div class="tiles"><div class="tile"><b>${applied.length}</b><span>Applied</span></div>
<div class="tile int"><b>${count("interview", "offer")}</b><span>Interviews</span></div>
<div class="tile off"><b>${count("offer")}</b><span>Offers</span></div></div>
<div class="apps">${body}</div>
<p class="small" style="text-align:center"><a href="/manage/${esc(sub.token)}">Back to my job alerts</a></p>
${saved ? `<script>var s=document.getElementById("job${saved}");s&&s.scrollIntoView({block:"center"});</script>` : ""}`);
}

// --- log in (emailed link, no passwords) and the members' area ---

export function loginPage(ctx, { error = "" } = {}) {
  return page(ctx, `<h1>Log in</h1>
<p class="lead">We'll email you a link. No password needed.</p>
${error ? `<p class="card status">${esc(error)}</p>` : ""}
<form class="card" method="post" action="/login">
  <label for="email" style="margin-top:0">Your email</label>
  <input id="email" name="email" type="email" required maxlength="320" placeholder="you@example.com" autocomplete="email">
  <button type="submit">Email me a log-in link</button>
</form>
<p class="small" style="text-align:center">New here? <a href="/">Get your first jobs free</a></p>`);
}

export function loginSent(ctx, email) {
  return page(ctx, `<div class="hero">${ART_MAIL}<h1>Check your inbox</h1>
<p>If <b>${esc(email)}</b> has a JobAlert account, a log-in link is on its way. It works once, for 30 minutes.</p></div>
<p class="small" style="text-align:center">Nothing after a few minutes? Check spam, or <a href="/login">try again</a>.</p>`);
}

export function signinPage(ctx) {
  return page(ctx, `<div class="card empty"><p style="margin:0 0 6px">Logging you in…</p>
<form method="post" id="signin"><button type="submit" style="width:auto;padding:12px 28px">Log me in</button></form></div>
<script>document.getElementById("signin").submit();</script>`);
}

const SAVED = { paid: "Payment received 🎉 You're a member. Tap My CV to add your CV for tailored CVs and cover letters.", cv: "Your CV is saved.", more: "Here are 5 more jobs.", nomore: "That's all for today. New jobs arrive tomorrow morning." };


const MI = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ME_ICONS = {
  apps: MI('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12l2 2 4-4"/>'),
  cv: MI('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  telegram: MI('<path d="M21 4 3 11l6 2 2 6 3-4 5 4z"/><path d="m9 13 8-6"/>'),
  more: MI('<path d="M12 5v14M5 12h14"/>'),
  settings: MI('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
};

// What the "unlock" card says when a trial user taps a member feature.
const UNLOCK = {
  apps: ["Application tracker", "See every job you've applied to and where each one stands."],
  cv: ["Tailored CVs", "We rewrite your CV for each job, in the advert's own words."],
  letter: ["Cover letters", "A cover letter written for each job, in one tap."],
  prep: ["Interview prep", "Likely interview questions for each job, with answers from your CV."],
  telegram: ["Telegram alerts", "New jobs on Telegram during the day, so you apply first."],
  more: ["More jobs", "Want more than today's picks? Members get 5 more good matches whenever they ask."],
};

// The join card that slides up when a trial user taps a member feature (any link with data-unlock="<UNLOCK key>").
function unlockSheet(ctx, join) {
  return `<dialog id="unlock" class="sheet"><form method="dialog">
  <span class="sheet-ic" id="u-ic"></span><h2 id="u-title"></h2><p id="u-text"></p>
  <ul class="sheet-perks"><li>5 best jobs every morning, more on request</li><li>Tailored CV and cover letter per job</li><li>Application tracker and Telegram alerts</li></ul>
  <a class="plan-cta" href="${join}">Join for ${esc(ctx.price)} <span aria-hidden="true">→</span></a>
  <button class="sheet-close" value="close">Not now</button>
</form></dialog>
<script>(function(){var d=document.getElementById("unlock"),U=${JSON.stringify(UNLOCK)},I=${JSON.stringify({ apps: ME_ICONS.apps, cv: ME_ICONS.cv, letter: ME_ICONS.cv, prep: ME_ICONS.cv, telegram: ME_ICONS.telegram, more: ME_ICONS.more })};
if(!d.showModal)return;document.querySelectorAll("[data-unlock]").forEach(function(a){a.addEventListener("click",function(e){var k=a.getAttribute("data-unlock");e.preventDefault();
document.getElementById("u-title").textContent=U[k][0];document.getElementById("u-text").textContent=U[k][1];
document.getElementById("u-ic").innerHTML=I[k];d.showModal();});});
d.addEventListener("click",function(e){if(e.target===d)d.close();});})();</script>`;
}

export function memberHome(ctx, { sub, member, jobs, applied = 0, interviews = 0, hasCv, letters = false, saved = "", spares = 0 }) {
  const t = esc(sub.token);
  const gate = (feature) => (member ? "" : ` data-unlock="${feature}"`);
  const tile = (href, icon, label, tone, feature = "", badge = "") =>
    `<a class="mtile" href="${href}" style="--tone:${tone}"${feature ? gate(feature) : ""}><i>${ME_ICONS[icon]}${badge ? `<em>${badge}</em>` : ""}</i><b>${label}</b></a>`;
  const q = (j) => esc(new URLSearchParams({ t: j.title, c: j.company || "", u: j.url || "" }).toString());
  const jobCard = (j) => `<div class="card mjob"><div class="t">${esc(j.title)}${j.status && j.status !== "skip"
    ? `<span class="chip-st">${esc({ applied: "Applied", not_yet: "Not yet", interview: "Interview", offer: "Offer", no_reply: "Applied" }[j.status] || "")}</span>` : ""}</div>
  <div class="small" style="margin:2px 0 0">${esc([j.company, j.source && `via ${j.source}`].filter(Boolean).join(" · "))}</div>
  <div class="links"><a href="/j/${t}/${j.id}">View and apply →</a>${letters || !member
    ? `<a class="sub" href="/cv/${t}?${q(j)}"${gate("cv")}>Tailored CV</a><a class="sub" href="/letter/${t}?${q(j)}"${gate("letter")}>Cover letter</a>` : ""}</div></div>`;
  const join = ctx.paidService ? `/pay/${t}` : "/terms";
  return page(ctx, `<div class="me-top"><div><h1>Hi there 👋</h1><p class="lead" style="margin-bottom:18px">${esc(sub.email)}</p></div>
<form method="post" action="/logout"><button type="submit">Log out</button></form></div>
${SAVED[saved] ? `<p class="toast">${SAVED[saved]}</p>` : ""}
${ctx.paidService ? membershipCard(ctx, sub, member) : ""}
<nav class="mtiles">
${tile(`/applications/${t}`, "apps", "Applications", "#2457d6", "apps", member && applied ? String(applied) : "")}
${tile("/me/cv", "cv", "My CV", "#7c3aed", "", hasCv ? "✓" : "")}
${tile(`/manage/${t}`, "telegram", "Telegram", "#0ea5e9", "telegram")}
${tile(`/manage/${t}`, "settings", "Settings", "#f97316")}
</nav>
<div class="apps" id="jobs"><h2>${jobs.length && Date.now() - new Date(jobs[0].sent_at) < 864e5 ? `Today's jobs · ${jobs.length}` : "Your latest jobs"}</h2>
${jobs.length ? jobs.map(jobCard).join("") : `<div class="card empty"><p style="margin:0">Your next jobs arrive tomorrow morning.</p></div>`}
${member ? (spares ? `<form method="post" action="/me/more"><button type="submit" class="more">${ME_ICONS.more}More jobs</button></form>` : "")
  : jobs.length ? `<a class="more" href="${join}" data-unlock="more">${ME_ICONS.more}More jobs</a>` : ""}</div>
${member ? "" : unlockSheet(ctx, join)}`);
}

// --- one job's page: the whole advert, how to apply, then one button to the employer's form ---

const ATS_HOSTS = /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|bamboohr\.com|recruitee\.com|teamtailor\.com|breezy\.hr|jobvite\.com|myworkdayjobs\.com|personio\.)/i;
// Same boards as SIGNUP_BOARDS in job_alerts/search.py, by name and by web address (older jobs have no source saved).
const SIGNUP_SOURCES = ["We Work Remotely", "Himalayas", "Jobicy", "RemoteOK"];
const SIGNUP_HOSTS = /(^|\.)(weworkremotely\.com|himalayas\.app|jobicy\.com|remoteok\.com)$/i;

// Plain-text advert (paragraph breaks and "• " bullets kept) -> paragraphs and lists.
function advertHtml(text) {
  let out = "", list = [];
  const flush = () => { if (list.length) out += `<ul>${list.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`; list = []; };
  for (const line of String(text).split("\n").map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^[•\-*·]\s*(.+)$/);
    if (m) list.push(m[1]); else { flush(); out += `<p>${esc(line)}</p>`; }
  }
  flush();
  return out;
}

export function jobPage(ctx, { sub, job, member, letters = false }) {
  const t = esc(sub.token);
  const host = (() => { try { return new URL(job.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const direct = ATS_HOSTS.test(host) || job.source === "Company careers page";
  const signup = SIGNUP_SOURCES.includes(job.source) || SIGNUP_HOSTS.test(host);
  const who = job.company || "the company";
  const via = direct ? "" : job.source || host;
  const initials = (job.company || job.title || "?").replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "J";
  const matched = String(job.matched || "").split(" · ").filter((m) => m && !/^posted |^matches "|^remote, |sign-up needed/.test(m) && m !== job.pay);
  const chips = [job.location && `<span>📍 ${esc(job.location)}</span>`, job.pay && `<span class="pay">💰 ${esc(job.pay)}</span>`,
    job.posted_at && `<span>🗓 Posted ${shortDate(job.posted_at)}</span>`, ...matched.map((m) => `<span>${esc(m)}</span>`),
    signup && `<span class="warn">Sign-up needed to apply</span>`].filter(Boolean).join("");
  const q = esc(new URLSearchParams({ t: job.title, c: job.company || "", u: job.url || "" }).toString());
  const gate = (f) => (member ? "" : ` data-unlock="${f}"`);
  const tools = letters || !member ? `<div class="jtools"><a href="/cv/${t}?${q}"${gate("cv")}>📄 Tailored CV</a><a href="/letter/${t}?${q}"${gate("letter")}>✍️ Cover letter</a><a href="/prep/${t}?${q}"${gate("prep")}>🎤 Interview prep</a></div>` : "";
  const how = direct ? `A short form on ${esc(who)}'s own site. No account needed.`
    : signup ? `${esc(via)} asks you to sign up before you can apply. Then use their Apply button.`
    : `Opens the advert on ${esc(via)}. Tap their Apply button.`;
  const desc = String(job.description || "").trim();
  const lines = desc.split("\n").filter((l) => l.trim());
  const advert = !desc ? `<p class="small" style="margin:0">The full advert is on ${direct ? `${esc(who)}'s site` : esc(via)}.</p>`
    : lines.length > 8 ? `${advertHtml(lines.slice(0, 6).join("\n"))}<details><summary>Read the full advert</summary>${advertHtml(lines.slice(6).join("\n"))}</details>`
    : advertHtml(desc);
  const button = direct ? `Apply on ${esc(who)}'s site` : `Go to the advert on ${esc(via)}`;
  const tracker = member ? `<form class="card jdid" method="post"><b>Did you apply?</b><div class="seg">${[["applied", "good"], ["not_yet"], ["skip", "skip"]]
    .map(([a, cls]) => `<button formaction="/job/${t}/${job.id}/${a}" class="${cls || ""}${job.status === a ? " on" : ""}">${ANSWER_WORDS[a]}</button>`).join("")}</div></form>` : "";
  const join = ctx.paidService ? `/pay/${t}` : "/terms";
  return page(ctx, `<div class="jhead"><span class="jav" aria-hidden="true">${esc(initials)}</span><div><h1>${esc(job.title)}</h1>
<div class="co">${esc([job.company, via && `via ${via}`].filter(Boolean).join(" · "))}</div></div></div>
<div class="jchips">${chips}</div>
<div class="card jsteps"><h2>How to apply</h2><ol>
  <li><b>Check it fits you</b><span>Read the advert below: what they need and where they hire.</span></li>
  <li><b>Get your CV ready</b><span>${letters || !member ? "One tap makes a CV and cover letter for this exact job." : "Have it ready as a PDF."}</span>${tools}</li>
  <li><b>Apply</b><span>${how}</span></li>
</ol></div>
<div class="card jdesc"><h2>About the job</h2>${advert}</div>
${tracker}
<div class="applybar"><a class="plan-cta" href="/go/${t}/${job.id}" target="_blank" rel="noopener">${button} <span aria-hidden="true">→</span></a>
<p>Apply early: new adverts get the most attention.</p></div>
<p class="small" style="text-align:center"><a href="/me">My dashboard</a></p>
${member ? "" : unlockSheet(ctx, join)}`);
}

export function cvPage(ctx, { cv, member }) {
  return page(ctx, `<h1>📄 My CV</h1>
<p class="lead">${member ? "We use it to tailor your CV and write cover letters for each job." : "Members get it tailored to every job, plus cover letters."}</p>
<form class="card" method="post" action="/me/cv">
  <label for="cv" style="margin-top:0">Paste your CV <span class="hint">Plain text is fine</span></label>
  <textarea id="cv" name="cv" rows="16" maxlength="15000" placeholder="Paste your CV here">${esc(cv)}</textarea>
  <button type="submit">Save my CV</button>
</form>
<p class="small" style="text-align:center"><a href="/me">Back</a></p>`);
}

const JOB_STYLE = `<style>
  .fj-hero { margin:4px 0 18px; padding:22px 20px; border-radius:20px; color:#fff; background:linear-gradient(135deg,#0f1f4d,#2457d6); }
  .fj-badge { display:inline-block; font-size:.75rem; font-weight:800; letter-spacing:.05em; text-transform:uppercase;
    background:#ffc75a; color:#1b2440; border-radius:99px; padding:4px 11px; }
  .fj-hero h1 { margin:12px 0 4px; font-size:1.65rem; line-height:1.2; letter-spacing:-.02em; color:#fff; }
  .fj-co { opacity:.85; font-weight:600; }
  .fj-chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
  .fj-chips span { background:#ffffff1f; border:1px solid #ffffff33; border-radius:99px; padding:6px 11px; font-size:.85rem; font-weight:600; }
  .fj-chips .pay { background:#ffc75a; color:#1b2440; border-color:#ffc75a; font-weight:800; }
  .fj h2 { font-size:1.05rem; margin:20px 0 8px; }
  .fj ul { margin:0; padding-left:20px; } .fj li { margin:5px 0; }
  .fj .muted { color:var(--muted); }
  .fj-apply { position:relative; margin-top:22px; border-radius:18px; border:2px solid #ffc75a; background:var(--card); padding:18px; overflow:hidden; }
  .fj-apply h2 { margin-top:0; }
  .fj-hidden { filter:blur(6px); opacity:.55; user-select:none; pointer-events:none; }
  .fj-peek { position:relative; margin:-4px 0 14px; }
  .fj-peek em { position:absolute; inset:0; display:grid; place-items:center; font-style:normal; }
  .fj-peek em span { background:var(--card); border-radius:99px; padding:7px 14px; font-weight:800; font-size:.88rem;
    box-shadow:0 6px 20px #0b153033; }
  .fj-gate { margin:0; }
  .fj-gate b { font-size:1.15rem; } .fj-gate p { margin:4px 0 10px; color:var(--muted); font-size:.92rem; }
  .fj-gate input[type=email] { width:100%; padding:13px 14px; border-radius:12px; border:1.5px solid var(--border); font-size:1rem;
    background:var(--card); color:var(--text); }
  .fj-gate button, a.fj-go { margin-top:10px; width:100%; display:block; text-align:center; text-decoration:none; padding:14px;
    border:0; border-radius:12px; background:#ffc75a; color:#1b2440; font-weight:800; font-size:1.05rem; cursor:pointer; }
  .fj-gate small { display:block; text-align:center; color:var(--muted); margin-top:8px; font-size:.8rem; }
  .fj-mail { font-size:1.05rem; } .fj-mail code { font-weight:700; background:none; }
  .fj-tip { margin-top:12px; font-size:.88rem; color:var(--muted); }
</style>`;

// A shareable job (src/featured.js). Locked: details show, "how to apply" is blurred behind a join form.
export function featuredJob(ctx, job, slug, { unlocked = false } = {}) {
  const how = `<h2>How to apply</h2>
<p class="fj-mail">Email your CV to <code>${esc(job.apply.email)}</code></p>
<p>Subject: <b>${esc(job.apply.subject)}</b></p>`;
  const mailto = `mailto:${job.apply.email}?subject=${encodeURIComponent(job.apply.subject)}`;
  const apply = unlocked
    ? `<div class="fj-apply">${how}<a class="fj-go" href="${esc(mailto)}">Apply by email</a>
<p class="fj-tip">💡 Members get a CV tailored to this job in one tap. Your daily matches start tomorrow morning.</p></div>`
    : `<div class="fj-apply"><h2>How to apply</h2><div class="fj-peek"><div class="fj-hidden" aria-hidden="true">
<p class="fj-mail">Email your CV to <code>careers@company-hiring.com</code></p><p>Subject: <b>Application for this role</b></p></div>
<em><span>Hidden until you join</span></em></div>
<form class="fj-gate" method="post" action="/subscribe">
<b>Join JobAlert free to see it</b>
<p>See how to apply, and get jobs like this in your inbox every morning.</p>
<input type="email" name="email" required placeholder="Your email" autocomplete="email" aria-label="Your email">
<input type="hidden" name="job" value="${esc(job.keywords)}"><input type="hidden" name="work_type" value="remote">
<input type="hidden" name="for" value="${esc(slug)}"><input type="hidden" name="heard" value="Job link">
<input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
<button type="submit">Join free &amp; see how to apply</button>
<small>${ctx.trialDays} days free · no card needed</small></form></div>`;
  const body = `${JOB_STYLE}<div class="fj"><div class="fj-hero">${job.urgent ? `<span class="fj-badge">🔥 Urgent hire</span>` : ""}
<h1>${esc(job.title)}</h1><div class="fj-co">${esc(job.company)}</div>
<div class="fj-chips"><span class="pay">${esc(job.pay)}</span><span>${esc(job.where)}</span><span>${esc(job.level)}</span></div></div>
<p>${esc(job.summary)}</p>
<h2>What you'll need</h2><ul>${job.needs.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
${job.nice?.length ? `<h2>Nice to have</h2><p class="muted">${job.nice.map(esc).join(" · ")}</p>` : ""}
${apply}</div>`;
  return page(ctx, body, { og: { title: `${job.title} at ${job.company}: ${job.pay}, remote`,
    description: `${job.where}. Join ${ctx.siteName} free to apply.`, path: `/job/${slug}` } });
}
