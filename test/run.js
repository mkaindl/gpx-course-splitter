#!/usr/bin/env node
/* Regression suite for Course Splitter.
 *
 * Each block below pins a behaviour that was expensive to get right and is
 * easy to undo by accident. Run with:  npm test  (from this directory)
 */

const {chromium} = require("playwright");
const fx = require("./fixtures");
const T = require("./lib");
const {section, check, near} = T;

const MAX_PTS = 450;

/* Locate course k+1's first point inside course k and measure the shared tail.
   Courses are contiguous slices of one reduced line, so the coordinates match
   exactly — no tolerance needed. */
function overlapKm(a, b){
  const [lat, lon] = b[0];
  const i = a.findIndex(p => p[0] === lat && p[1] === lon);
  return i < 0 ? NaN : T.length(a.slice(i)) / 1000;
}
/* Rebuild the reduced line by dropping each course's overlapping tail. */
function reconstruct(P){
  const all = [];
  for(let k = 0; k < P.length; k++){
    if(k === P.length - 1){ all.push(...P[k]); break; }
    const [lat, lon] = P[k+1][0];
    all.push(...P[k].slice(0, P[k].findIndex(p => p[0] === lat && p[1] === lon)));
  }
  return all;
}

(async () => {
  const browser = await chromium.launch();
  const offences = [];
  const track = page => offences.push(...page.offences.splice(0));

  /* ---------------------------------------------------------------- */
  section("Reduction");
  {
    const page = await T.openApp(browser);
    const route = fx.winding();
    await T.loadGPX(page, route.text);
    const s = await T.stats(page);

    check("original point count read correctly", s.origPts === route.n, `${s.origPts} vs ${route.n}`);
    near("original distance", s.origDist, route.trueLength / 1000, 0.2, " km");
    check("reduction actually reduces", s.kept < route.n / 5, `${s.kept} of ${route.n} kept`);

    const reduced = reconstruct((await T.courses(page)).map(f => T.trkpts(f.text)));
    near("reduced line keeps its length", T.length(reduced) / 1000, s.origDist, 0.35, " km");

    /* by-point-count mode should land on the number asked for */
    await T.clickMode(page, "#mCount");
    for(const target of [300, 1200, 5000]){
      await T.setControl(page, "#targetN", target);
      const k = (await T.stats(page)).kept;
      /* The tolerance is searched until the count fits, so the cap is the
         contract and landing just under it is the quality. */
      check(`target ${target} points`, k <= target && k >= target * 0.98,
            `asked ${target}, got ${k}`);
    }
    track(page); await page.close();
  }

  /* ---------------------------------------------------------------- */
  section("Split and overlap");
  {
    const page = await T.openApp(browser);
    await T.loadGPX(page, fx.winding().text);
    await T.setControl(page, "#maxPts", MAX_PTS);

    for(const req of [0, 0.3, 1, 2.5, 5]){
      await T.setControl(page, "#overlap", req);
      const s = await T.stats(page);
      const P = (await T.courses(page)).map(f => T.trkpts(f.text));

      check(`overlap ${req} km: course count matches the UI`, P.length === s.segments,
            `${P.length} files vs "${s.segments}" shown`);
      check(`overlap ${req} km: every course fits under ${MAX_PTS} points`,
            P.every(p => p.length <= MAX_PTS), `sizes ${P.map(p => p.length).join(", ")}`);

      const line = reconstruct(P);
      check(`overlap ${req} km: courses rejoin into the reduced line`,
            line.length === s.kept, `${line.length} distinct points vs ${s.kept} kept`);

      /* A cut can only fall on a retained vertex, so the overlap can overshoot
         what was asked by at most one vertex gap — and must never undershoot,
         which would leave a gap with no time to switch courses. */
      const maxGap = Math.max(...T.gaps(line)) / 1000;
      const measured = [];
      for(let k = 0; k + 1 < P.length; k++) measured.push(overlapKm(P[k], P[k+1]));

      check(`overlap ${req} km: every seam found`, measured.every(m => !Number.isNaN(m)),
            `measured ${measured.map(m => m.toFixed(3)).join(", ")}`);
      check(`overlap ${req} km: never less than requested`,
            measured.every(m => m >= req - 1e-6),
            `measured ${measured.map(m => m.toFixed(3)).join(", ")} km`);
      check(`overlap ${req} km: overshoot within one vertex gap (<= ${(req + maxGap).toFixed(2)} km)`,
            measured.every(m => m <= req + maxGap + 1e-6),
            `measured ${measured.map(m => m.toFixed(3)).join(", ")} km, max gap ${maxGap.toFixed(3)} km`);

      /* the distance paid for the overlap must show up in the total */
      const sum = P.reduce((a, p) => a + T.length(p), 0) / 1000;
      near(`overlap ${req} km: course lengths sum to route + overlaps`,
           sum - T.length(line) / 1000, measured.reduce((a, b) => a + b, 0), 0.02, " km");
    }
    track(page); await page.close();
  }

  /* ---------------------------------------------------------------- */
  /* The note reads "Ascent is approximately <reduced> m against <original> m".
     The ORIGINAL figure is the one that measures the ascent algorithm: the
     reduced line has already been through Douglas-Peucker, which throws away
     noise wiggles along with everything else and so flatters the result.
     Assert on the original; keep an eye on the reduced one separately. */
  const ascents = async route => {
    const page = await T.openApp(browser);
    await T.loadGPX(page, route.text);
    const note = (await T.stats(page)).note;
    track(page); await page.close();
    const reduced = note.match(/approximately\s+([\d]+)\s*m/);
    const original = note.match(/against\s+([\d]+)\s*m/);
    return {reduced: reduced ? +reduced[1] : NaN, original: original ? +original[1] : NaN};
  };
  const errPct = (got, want) => (got - want) / want * 100;

  section("Ascent (noise handling)");
  for(const c of fx.eleCases){
    const route = c.fx();
    const a = await ascents(route);
    const e = errPct(a.original, route.trueAscent);
    check(`${c.name}: within ${c.maxErrPct}% of true ascent`, Math.abs(e) <= c.maxErrPct,
          `true ${Math.round(route.trueAscent)} m, reported ${a.original} m (${e >= 0 ? "+" : ""}${e.toFixed(1)}%)`);
    /* thinning the line must not quietly rewrite how much climbing it claims */
    check(`${c.name}: reduced line reports comparable ascent`,
          Math.abs(errPct(a.reduced, a.original)) <= 30,
          `original ${a.original} m vs reduced ${a.reduced} m`);
  }

  section("Ascent (known weakness, pinned)");
  /* The smoothing window is +/-20 m of travel. Once point spacing approaches
     that, the window holds barely one neighbour and stops filtering, so input
     that is both widely spaced and independently noisy passes through almost
     unsmoothed. Pinned rather than ignored: if this is ever fixed these bounds
     will fail, which is the point — tighten them then. */
  for(const c of fx.eleKnownWeak){
    const route = c.fx();
    const a = await ascents(route);
    const e = errPct(a.original, route.trueAscent);
    const [lo, hi] = c.errPctRange;
    check(`${c.name}: overestimates by ${lo}-${hi}%`, e >= lo && e <= hi,
          `true ${Math.round(route.trueAscent)} m, reported ${a.original} m (+${e.toFixed(1)}%). ` +
          `Outside this range means the behaviour changed; if it improved, tighten the bound.`);
  }

  /* ---------------------------------------------------------------- */
  section("GPX output format");
  {
    const page = await T.openApp(browser);
    await T.loadGPX(page, fx.winding().text);
    const files = await T.courses(page);          // reading the ZIP verifies its CRC32s
    const every = (what, fn) => check(what, files.every(fn),
          files.filter(f => !fn(f)).map(f => f.name).join(", ") || `${files.length} courses`);
    every("GPX 1.1 namespace", f => f.text.includes('xmlns="http://www.topografix.com/GPX/1/1"'));
    every("writes trk/trkseg/trkpt", f => /<trk>[\s\S]*<trkseg>[\s\S]*<trkpt/.test(f.text));
    /* Garmin Connect rejects route points as "not a course file" */
    every("no rtept or wpt", f => !/<(rtept|wpt)\b/.test(f.text));
    const parsed = await page.evaluate(ts => ts.map(t =>
      !new DOMParser().parseFromString(t, "application/xml").querySelector("parsererror")),
      files.map(f => f.text));
    check("every course parses as XML", parsed.every(Boolean));
    track(page); await page.close();
  }

  /* ---------------------------------------------------------------- */
  section("Preview rendering");
  {
    const page = await T.openApp(browser);
    await T.loadGPX(page, fx.winding().text);
    /* The old bug rounded view coordinates once and scaled by transform,
       collapsing neighbouring points into the same cell: 94 % of edges came
       out perfectly horizontal or vertical. */
    const flat = await T.axisParallelFraction(page);
    check("route is not drawn as stair-steps", flat < 0.15,
          `${(flat * 100).toFixed(1)}% of edges axis-parallel (bug produced 94%)`);

    await page.click("#zIn"); await page.click("#zIn"); await page.click("#zIn");
    await T.settle(page);
    const flatZoomed = await T.axisParallelFraction(page);
    check("still smooth after zooming in", flatZoomed < 0.15,
          `${(flatZoomed * 100).toFixed(1)}% axis-parallel`);
    track(page); await page.close();
  }

  /* ---------------------------------------------------------------- */
  section("Input handling");
  {
    const page = await T.openApp(browser);
    /* the app repairs route-point files that Garmin Connect refuses */
    await T.loadGPX(page, fx.winding({n: 4000, tag: "rtept"}).text);
    const s = await T.stats(page);
    check("accepts rtept input", s.error === null && s.origPts === 4000, s.error || `${s.origPts} pts`);
    const out = await T.courses(page);
    check("rewrites rtept input as a track", out.every(f => /<trkpt/.test(f.text) && !/<rtept/.test(f.text)));
    track(page); await page.close();
  }
  {
    /* A prefixed file is ordinary GPX; matching the qualified name missed it. */
    const page = await T.openApp(browser);
    await T.loadGPX(page, fx.prefixed(fx.winding({n: 4000}).pts), "prefixed.gpx");
    const s = await T.stats(page);
    check("accepts namespace-prefixed GPX", s.error === null && s.origPts === 4000,
          s.error || `${s.origPts} pts`);
    track(page); await page.close();
  }
  for(const [name, text] of Object.entries(fx.malformed)){
    const page = await T.openApp(browser);
    await T.loadGPX(page, text, "bad.gpx");
    const s = await T.stats(page);
    check(`rejects "${name}" with a message`, !!s.error, s.error ? `"${s.error}"` : "no error shown");
    /* an exception here would surface as a pageerror offence */
    track(page); await page.close();
  }

  /* ---------------------------------------------------------------- */
  section("Example route");
  {
    /* Drawn by the page, not recorded, so the figures below are exact and a
       change to the generator is meant to fail these. */
    const TRUE_ASCENT = 1400;   // total positive variation of the clean profile
    const NAIVE_ASCENT = 8443;  // what summing positive deltas would report

    const page = await T.openApp(browser);
    const shown = await page.$eval("#demo", el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }).catch(() => false);
    check("example is offered before any file is loaded", shown);

    await T.recompute(page, () => page.click("#demo"));
    const s = await T.stats(page);

    check("example loads without error", s.error === null, s.error || "");
    check("example is over 40 km", s.origDist > 40, `${s.origDist} km`);
    check("example is recorded densely enough to be worth thinning",
          s.origPts >= 10000, `${s.origPts} points`);
    check("example thins to a fraction of its points", s.kept < s.origPts / 5,
          `${s.kept} of ${s.origPts}`);
    check("example needs splitting", s.segments > 1, `${s.segments} courses`);

    /* The point of the noisy elevation: the demo has to exercise the noise
       handling, not flatter it. Reported ascent must land near the truth and
       nowhere near what a naive sum of positive deltas would give. */
    const m = s.note.match(/against\s+(\d+)\s*m/);
    const reported = m ? +m[1] : NaN;
    check("example ascent is near the true figure",
          Math.abs(reported - TRUE_ASCENT) / TRUE_ASCENT < 0.15,
          `true ${TRUE_ASCENT} m, reported ${reported} m`);
    check("example elevation is noisy enough to exercise the smoothing",
          reported < NAIVE_ASCENT * 0.6,
          `a naive sum over this profile gives ${NAIVE_ASCENT} m; reported ${reported} m`);

    const courses = await T.courses(page);
    const first = courses.map(f => f.text);

    /* Someone can download these and put them on a watch. The route is
       invented but the terrain under it is real, so the warning has to travel
       with the files, not just sit on the page: the course name is the label
       that survives a download and shows up in Garmin Connect. */
    check("example course filenames warn against following them",
          courses.every(f => /do-not-follow/.test(f.name)),
          courses.map(f => f.name).join(", "));
    check("the warning is inside the GPX, not only in the filename",
          courses.every(f => (f.text.match(/<name>[^<]*do-not-follow[^<]*<\/name>/g) || []).length >= 2),
          "expected the name in both metadata and trk");
    const warned = await page.$eval("#exNote", el => !el.classList.contains("hidden"));
    check("app warns on screen while the example is loaded", warned);

    /* Placed at Point Nemo, the oceanic pole of inaccessibility, roughly
       2700 km from the nearest land. Nothing to walk or ride into. */
    const all = courses.flatMap(f => T.trkpts(f.text));
    const lats = all.map(p => p[0]), lons = all.map(p => p[1]);
    const inOcean = Math.min(...lats) > -49.5 && Math.max(...lats) < -48.0
                 && Math.min(...lons) > -124.5 && Math.max(...lons) < -122.0;
    check("example is out in the South Pacific, not on land", inOcean,
          `lat ${Math.min(...lats).toFixed(3)}..${Math.max(...lats).toFixed(3)}, ` +
          `lon ${Math.min(...lons).toFixed(3)}..${Math.max(...lons).toFixed(3)}`);

    /* A route that crosses itself is not a plausible tour. The generator is
       built as a single-valued offset over a smooth spine precisely so this
       cannot happen; integrating a free heading, which is the obvious
       approach, produced ten crossings. */
    const line = reconstruct(courses.map(f => T.trkpts(f.text)));
    const crossings = T.selfIntersections(T.toPlane(line));
    check("example route never crosses itself", crossings === 0,
          `${crossings} crossing(s) over ${line.length} points`);

    track(page); await page.close();

    /* No Math.random in the generator: two visitors must get the same route. */
    const again = await T.openApp(browser);
    await T.recompute(again, () => again.click("#demo"));
    const second = (await T.courses(again)).map(f => f.text);
    track(again); await again.close();
    check("example route is deterministic across visits",
          first.length === second.length && first.every((t, i) => t === second[i]),
          `${first.length} vs ${second.length} courses`);

    /* ...and the warning must not stick to a real file loaded afterwards */
    const real = await T.openApp(browser);
    await T.recompute(real, () => real.click("#demo"));
    await T.loadGPX(real, fx.winding({n: 6000}).text, "my-ride.gpx");
    const stuck = await real.$eval("#exNote", el => !el.classList.contains("hidden"));
    check("warning clears when a real file is loaded next", !stuck);
    const names = await real.$$eval(".file-name", es => es.map(e => e.textContent));
    check("a real file keeps its own name", names.every(n => /^my-ride_/.test(n)),
          names.join(", "));
    track(real); await real.close();
  }

  /* ---------------------------------------------------------------- */
  section("Legal pages");
  {
    const fs = require("fs"), pathm = require("path");
    const root = pathm.join(__dirname, "..");

    /* The Impressum link has to be reachable from the app at all times.
       The disclaimer footer is revealed only once a file is loaded, so the
       legal links live in their own always-visible footer. */
    const app = await T.openApp(browser);
    const footer = await app.$eval("#legal", el => {
      const r = el.getBoundingClientRect();
      return {shown: r.width > 0 && r.height > 0,
              links: [...el.querySelectorAll("a")].map(a => a.getAttribute("href"))};
    }).catch(() => null);
    check("app shows a legal footer before any file is loaded", !!footer && footer.shown,
          footer ? "" : "no #legal element found");
    for(const target of ["impressum.html", "datenschutz.html"])
      check(`app links to ${target}`, !!footer && footer.links.includes(target),
            footer ? `found ${footer.links.join(", ")}` : "");
    track(app); await app.close();

    for(const name of ["impressum.html", "datenschutz.html"]){
      const page = await T.openPage(browser, name);

      /* keeps the operator's contact details out of search results; the legal
         duty is about a visitor reaching the page, not about being indexed */
      const robots = await page.$eval('meta[name="robots"]', e => e.content).catch(() => "");
      check(`${name}: noindex for search engines`, /noindex/.test(robots), `robots="${robots}"`);

      /* .todo marks content that still has to be filled in. Publishing an
         Impressum that says so is worse than publishing none, so it is a gate
         rather than a warning — as is the placeholder scan further down. */
      const todo = await page.$$eval(".todo", els => els.map(e => e.textContent.trim().slice(0, 50)));
      check(`${name}: nothing left to fill in`, todo.length === 0, todo.join(" | "));

      /* The address is assembled by script and has no markup fallback, so a
         page that ships without it shows a placeholder sentence and nothing. */
      const mail = await page.$eval("#mail", el => {
        const a = el.querySelector('a[href^="mailto:"]');
        return a && a.textContent.includes("@") ? a.getAttribute("href") : null;
      }).catch(() => null);
      check(`${name}: contact address renders`, !!mail, mail || "no mailto link in #mail");

      track(page); await page.close();
    }

    /* every local reference must resolve, or the page ships broken */
    for(const name of ["impressum.html", "datenschutz.html"]){
      const html = fs.readFileSync(pathm.join(root, name), "utf8");
      const refs = [...html.matchAll(/(?:href|src)="(?!https?:|mailto:|#)([^"]+)"/g)].map(m => m[1]);
      const missing = refs.filter(r => !fs.existsSync(pathm.join(root, r)));
      check(`${name}: all local references resolve`, missing.length === 0,
            missing.length ? `missing: ${missing.join(", ")}` : `checked ${refs.length}`);
    }
    const css = fs.readFileSync(pathm.join(root, "assets", "legal.css"), "utf8");
    const fontRefs = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map(m => m[1]);
    const missingFonts = fontRefs.filter(f => !fs.existsSync(pathm.join(root, "assets", f)));
    check("legal.css: all font files present", missingFonts.length === 0 && fontRefs.length > 0,
          missingFonts.length ? `missing: ${missingFonts.join(", ")}` : `${fontRefs.length} faces`);

    /* Garmin is named throughout the app as a Bestimmungshinweis (§ 23 Nr. 3
       MarkenG). That is permitted, provided nothing suggests endorsement, so
       the disclaimer has to stay put. */
    const imp = fs.readFileSync(pathm.join(root, "impressum.html"), "utf8");
    check("Impressum disclaims affiliation with Garmin",
          /keiner Verbindung zu\s+Garmin/.test(imp) && /not affiliated with/.test(imp));

    /* The OFL asks that the notices travel with the fonts, and index.html is
       the distribution — one file people copy around. Nothing else catches
       their loss: the page renders identically without them, so there is no
       runtime signal, and trimming a comment block is an ordinary edit. */
    const appHtml = fs.readFileSync(pathm.join(root, "index.html"), "utf8");
    check("index.html keeps the font notices with the fonts",
          /SIL Open Font License/.test(appHtml) && /NOT covered by that licence/.test(appHtml));
  }

  /* ---------------------------------------------------------------- */
  /* Deliberately fails until the real details are filled in. Publishing an
     Impressum that still reads "[VOLLSTANDIGER NAME]" is worse than not
     publishing one, so this is a gate rather than a warning. */
  section("Publish gate");
  {
    const fs = require("fs"), pathm = require("path");
    for(const name of ["impressum.html", "datenschutz.html", "LICENSE"]){
      const html = fs.readFileSync(pathm.join(__dirname, "..", name), "utf8");
      const left = [...new Set((html.match(/\[[A-ZÄÖÜ][A-ZÄÖÜ0-9 .\-]*\]/g) || []))];
      check(`${name}: no unfilled placeholders`, left.length === 0,
            left.length ? `still to fill in: ${left.join(", ")}` : "");
    }
  }

  /* ---------------------------------------------------------------- */
  section("Privacy");
  {
    const page = await T.openApp(browser);
    await T.loadGPX(page, fx.winding({n: 3000}).text);
    await T.setControl(page, "#overlap", 2);
    await T.courses(page);
    track(page); await page.close();

    const network = offences.filter(o => !/^(pageerror|console error)/.test(o));
    check("no request ever leaves the page", network.length === 0,
          network.length ? network.slice(0, 5).join("\n          ") : "");
    const errors = offences.filter(o => /^(pageerror|console error)/.test(o));
    check("no uncaught errors in any scenario", errors.length === 0,
          errors.length ? errors.slice(0, 5).join("\n          ") : "");
  }

  await browser.close();
  process.exit(T.summary());
})().catch(e => { console.error("\n\x1b[31mharness crashed:\x1b[0m", e); process.exit(2); });
