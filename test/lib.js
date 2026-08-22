/* Test harness: drives the real UI in a headless browser and reads the real
   outputs. The app keeps its internals inside an IIFE, so there is nothing to
   reach into — every assertion here goes through the same surface a user
   touches. */

const path = require("path");

/* ---------------- assertions ---------------- */
const results = [];
let group = "";

const section = name => { group = name; console.log(`\n\x1b[1m${name}\x1b[0m`); };

function check(name, pass, detail){
  results.push({group, name, pass});
  const mark = pass ? "\x1b[32m  PASS\x1b[0m" : "\x1b[31m  FAIL\x1b[0m";
  console.log(`${mark}  ${name}${detail ? `\n          ${detail}` : ""}`);
}
const near = (name, got, want, tol, unit = "") =>
  check(name, Math.abs(got - want) <= tol,
        `expected ${want}${unit} +/- ${tol}${unit}, got ${round(got)}${unit}`);
const between = (name, got, lo, hi, unit = "") =>
  check(name, got >= lo && got <= hi,
        `expected ${round(lo)}..${round(hi)}${unit}, got ${round(got)}${unit}`);
const round = v => typeof v === "number" ? +v.toFixed(3) : v;

function summary(){
  const bad = results.filter(r => !r.pass);
  console.log(`\n${"-".repeat(58)}`);
  if(!bad.length){ console.log(`\x1b[32mAll ${results.length} checks passed.\x1b[0m`); return 0; }
  console.log(`\x1b[31m${bad.length} of ${results.length} checks FAILED:\x1b[0m`);
  for(const b of bad) console.log(`  - ${b.group} / ${b.name}`);
  return 1;
}

/* ---------------- ZIP reader (stored entries, verifies CRC32) ----------------
   Deliberately hand-rolled: the app writes ZIPs with its own CRC32, so reading
   them back with an independent implementation is part of the test. */
const crcTable = (() => {
  const t = new Int32Array(256);
  for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = u8 => {
  let c = 0xFFFFFFFF;
  for(let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
function readZip(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for(let i = buf.length - 22; i >= 0; i--) if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  if(eocd < 0) throw new Error("no end-of-central-directory record");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = [];
  for(let k = 0; k < count; k++){
    if(dv.getUint32(off, true) !== 0x02014b50) throw new Error("bad central directory header");
    const crc = dv.getUint32(off + 16, true), csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true), elen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nlen));
    const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnl + lel;
    const data = buf.subarray(start, start + csize);
    if(crc32(data) !== crc) throw new Error(`CRC32 mismatch in ${name}`);
    out.push({name, text: new TextDecoder().decode(data)});
    off += 46 + nlen + elen + clen;
  }
  return out;
}

/* ---------------- geometry ---------------- */
const R = 6371000, d2r = Math.PI / 180;
const trkpts = text => [...text.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map(m => [+m[1], +m[2]]);
const hop = (a, b) => Math.hypot((b[1] - a[1]) * d2r * R * Math.cos(a[0] * d2r), (b[0] - a[0]) * d2r * R);
function length(P){ let L = 0; for(let i = 1; i < P.length; i++) L += hop(P[i-1], P[i]); return L; }
function gaps(P){ const g = []; for(let i = 1; i < P.length; i++) g.push(hop(P[i-1], P[i])); return g; }

/* ---------------- page driver ---------------- */
const APP = "file://" + path.resolve(__dirname, "..", "index.html");

async function openApp(browser){
  const page = await browser.newPage({viewport: {width: 900, height: 1200}});
  const offences = [];                       // any request that leaves the machine
  page.on("request", r => {
    const u = r.url();
    if(!/^(file|data|blob|about):/.test(u)) offences.push(u);
  });
  page.on("pageerror", e => offences.push("pageerror: " + e.message));
  page.on("console", m => { if(m.type() === "error") offences.push("console error: " + m.text()); });
  await page.goto(APP);
  page.offences = offences;
  return page;
}

/* Run an action and wait for the recompute it triggers, rather than guessing at
   the app's 130 ms debounce with a fixed sleep.

   Every recompute rebuilds the course list from scratch, so marking the current
   entries and waiting for an unmarked one is a signal that holds even when the
   figures come out identical — setting a control to the value it already has
   still resolves. A rejected file renders no list at all and shows the error
   instead, so either outcome ends the wait. */
async function recompute(page, act){
  await page.$$eval("#files .file", els => els.forEach(e => e.dataset.stale = "1"));
  await act();
  await page.waitForFunction(() =>
    [...document.getElementById("files").children].some(e => !e.dataset.stale) ||
    !document.getElementById("err").classList.contains("hidden"), null, {timeout: 30000});
}

/* One painted frame. Zoom and pan redraw through requestAnimationFrame and do
   not recompute, so they wait on this rather than on the above. */
const settle = page => page.evaluate(() =>
  new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

const loadGPX = (page, text, name = "route.gpx") =>
  recompute(page, () => page.setInputFiles("#fileInput",
    {name, mimeType: "application/gpx+xml", buffer: Buffer.from(text)}));

const setControl = (page, id, value) =>
  recompute(page, () => page.$eval(id, (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event("input", {bubbles: true}));
  }, String(value)));

const clickMode = (page, id) => recompute(page, () => page.click(id));

/* Pull every produced course. Uses the ZIP when there is more than one, which
   exercises the hand-rolled writer; falls back to the per-file Save button. */
async function courses(page){
  const hasZip = await page.$('#bulk button:has-text("Download ZIP")');
  const grab = async selector => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click(selector)]);
    const chunks = [];
    for await (const c of await dl.createReadStream()) chunks.push(c);
    return {buf: Buffer.concat(chunks), name: dl.suggestedFilename()};
  };
  if(hasZip){
    const {buf} = await grab('#bulk button:has-text("Download ZIP")');
    return readZip(buf);
  }
  const {buf, name} = await grab('.file .btn:has-text("Save")');
  return [{name, text: buf.toString()}];
}

const stats = page => page.evaluate(() => {
  const t = id => (document.getElementById(id).textContent || "").trim();
  return {
    origPts:  +t("oPts"),
    origDist: parseFloat(t("oDist")),
    kept:     +t("nPts"),
    eps:      parseFloat(t("nEps")),
    segments: +t("nSeg"),
    note:     t("lossNote"),
    error:    document.getElementById("err").classList.contains("hidden") ? null : t("err"),
  };
});

/* Fraction of drawn edges that are exactly horizontal or vertical. A correct
   projection gives a few percent; the stair-stepping bug gave 94 %. */
const axisParallelFraction = page => page.evaluate(() => {
  const d = document.querySelector("#map path").getAttribute("d");
  const pts = [...d.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map(m => [+m[1], +m[2]]);
  let flat = 0;
  for(let i = 1; i < pts.length; i++)
    if(pts[i][0] === pts[i-1][0] || pts[i][1] === pts[i-1][1]) flat++;
  return pts.length > 1 ? flat / (pts.length - 1) : 0;
});

module.exports = {
  section, check, near, between, summary, results,
  readZip, crc32, trkpts, length, gaps, hop,
  openApp, loadGPX, settle, setControl, clickMode, courses, stats, axisParallelFraction,
};
