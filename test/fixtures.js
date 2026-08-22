/* Synthetic GPX fixtures with known ground truth.
   Deterministic: a seeded PRNG keeps every run byte-identical, so a failure
   is always reproducible. */

const R = 6371000, d2r = Math.PI / 180;

/* mulberry32 — small, fast, good enough for reproducible noise */
function rng(seed){
  return function(){
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const gpx = (body, tag = "trkpt") => tag === "rtept"
  ? `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="fixture" xmlns="http://www.topografix.com/GPX/1/1"><rte>${body}</rte></gpx>`
  : `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="fixture" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Fixture</name><trkseg>${body}</trkseg></trk></gpx>`;

const rows = (pts, tag) => pts.map(p => p.ele == null
  ? `<${tag} lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"/>`
  : `<${tag} lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${p.ele.toFixed(2)}</ele></${tag}>`).join("");

function planar(pts){
  let L = 0;
  for(let i = 1; i < pts.length; i++){
    const dx = (pts[i].lon - pts[i-1].lon) * d2r * R * Math.cos(pts[i-1].lat * d2r);
    const dy = (pts[i].lat - pts[i-1].lat) * d2r * R;
    L += Math.hypot(dx, dy);
  }
  return L;
}

/* A continuously curving route — no perfectly straight run anywhere, so
   Douglas-Peucker keeps vertices at a fairly even spacing. This is what a
   recorded ride or hike looks like, and the overlap tests depend on it: a cut
   can only land on a retained vertex, so the long vertex gaps that a synthetic
   straight line produces would let the cut overshoot by kilometres.
 *
 * noise models:
 *   "walk"  autocorrelated drift plus a small white term. This is what a real
 *           barometer or GPS produces — the error wanders rather than jumping
 *           independently at every sample.
 *   "white" independent error per point. Real recordings rarely look like this,
 *           but a track that another tool has already decimated does, because
 *           throwing away points destroys the correlation between neighbours.
 */
function winding({n = 12000, spacing = 7.5, seed = 7, ele = true, noise = 0, model = "walk", tag = "trkpt"} = {}){
  const next = rng(seed), pts = [], clean = [];
  let lat = 47.05, lon = 11.25, walk = 0;
  for(let i = 0; i < n; i++){
    const t = i / n;
    /* heading wanders continuously; the fast term gives switchback-scale bends */
    const head = 2.9 * Math.sin(t * 11) + 1.1 * Math.sin(t * 137) + 0.5 * Math.sin(t * 611);
    lat += spacing * Math.cos(head) / (R * d2r);
    lon += spacing * Math.sin(head) / (R * d2r * Math.cos(lat * d2r));

    const e = 1200 + 620 * Math.sin(t * 8.1) + 260 * Math.sin(t * 23.7) + 90 * Math.sin(t * 61.3);
    clean.push(e);
    let err = 0;
    if(noise){
      if(model === "white") err = (next() * 2 - 1) * noise;
      else {
        walk += (next() * 2 - 1) * noise * 0.15;
        walk = Math.max(-noise, Math.min(noise, walk));
        err = walk + (next() * 2 - 1) * noise * 0.25;
      }
    }
    pts.push({lat, lon, ele: ele ? e + err : null});
  }
  /* true ascent from the clean profile, before any noise was added */
  let up = 0;
  for(let i = 1; i < clean.length; i++) if(clean[i] > clean[i-1]) up += clean[i] - clean[i-1];
  return {text: gpx(rows(pts, tag), tag), pts, trueAscent: up, trueLength: planar(pts), n};
}

module.exports = {
  winding,

  /* Realistic elevation error. These are the meaningful regression guards:
     tighten them if the ascent code improves, never loosen them to make a
     change pass. */
  eleCases: [
    {name: "DEM planning route, no noise", fx: () => winding({seed: 3,  noise: 0}),   maxErrPct: 5},
    {name: "recorded GPS +/-1.5 m",        fx: () => winding({seed: 5,  noise: 1.5}), maxErrPct: 5},
    {name: "recorded GPS +/-5 m",          fx: () => winding({seed: 11, noise: 5}),   maxErrPct: 8},
    {name: "recorded GPS +/-8 m",          fx: () => winding({seed: 21, noise: 8}),   maxErrPct: 12},
    {name: "recorded GPS +/-8 m, 25 m spacing",
     fx: () => winding({seed: 23, noise: 8, n: 4000, spacing: 25}),                   maxErrPct: 25},
  ],

  /* Known weakness, pinned so a change shows up rather than passing unnoticed.
     The smoothing window is +/-20 m of travel, so once point spacing approaches
     that, the window holds barely one neighbour and stops filtering. Input that
     is both widely spaced and independently noisy therefore passes through
     nearly unsmoothed and ascent runs high. If this is ever fixed these bounds
     should fail — tighten them then. */
  eleKnownWeak: [
    {name: "decimated, uncorrelated +/-5 m at 25 m spacing",
     fx: () => winding({seed: 11, noise: 5, model: "white", n: 4000, spacing: 25}), errPctRange: [90, 180]},
    {name: "decimated, uncorrelated +/-8 m at 25 m spacing",
     fx: () => winding({seed: 21, noise: 8, model: "white", n: 4000, spacing: 25}), errPctRange: [200, 320]},
  ],

  /* Namespace-prefixed GPX. Perfectly ordinary, and some exporters emit it,
     but it is invisible to a parser that matches on the qualified name. */
  prefixed: pts => `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx:gpx version="1.1" creator="fixture" xmlns:gpx="http://www.topografix.com/GPX/1/1">` +
    `<gpx:trk><gpx:trkseg>` + pts.map(p =>
      `<gpx:trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">` +
      `<gpx:ele>${p.ele.toFixed(2)}</gpx:ele></gpx:trkpt>`).join("") +
    `</gpx:trkseg></gpx:trk></gpx:gpx>`,

  malformed: {
    "not XML":        "this is not xml at all {{{",
    "empty gpx":      gpx(""),
    "one point only": gpx(`<trkpt lat="47.0" lon="11.0"/>`),
  },
};
