# Regression suite

The app is one dependency-free HTML file; these tests are separate and need
Node and Playwright.

```sh
cd test
npm ci                            # the lockfile pins the browser build npm test expects
npx playwright install chromium   # skip if a browser is already available
npm test
```

The suite drives the real page in a headless browser and reads the real
outputs. The app keeps its internals inside an IIFE, so there is nothing to
reach into — every assertion goes through the surface a user touches: the file
picker, the sliders, the produced GPX files.

## What it pins, and why

Most of these guard a fix that took real work and would be easy to undo.

| Group | Guards |
|---|---|
| Reduction | Douglas–Peucker preserves route length; the by-point-count mode lands on the number asked for |
| Split and overlap | every course fits under the point cap, the courses rejoin into exactly the reduced line, and the overlap is never *less* than requested |
| Ascent | reported climb against profiles whose true ascent is known, across four noise levels |
| Ascent (known weakness) | pins a case the current code gets wrong, so a change is visible |
| GPX output format | GPX 1.1 namespace and `trk`/`trkseg`/`trkpt`, never `rtept` — Garmin Connect rejects route points as "not a course file" |
| Preview rendering | the route is not drawn as stair-steps |
| Input handling | `rtept` and namespace-prefixed input are accepted and rewritten as a track; malformed files produce a message, not an exception |
| Privacy | no request of any kind leaves the page, and no scenario logs an uncaught error |

## Two things worth knowing before you change a bound

**Overlap can overshoot, and that is correct.** A course can only be cut at a
point the reduction kept, so the cut lands on the first retained vertex at or
past the requested distance. The overlap is therefore always *at least* what
was asked and at most one vertex gap more. Undershooting would be the dangerous
direction — it would leave a seam with no time to switch courses — so the test
asserts the floor strictly and the ceiling against the measured vertex gap.

On a realistically winding route the overshoot is small: about 50–90 m on a
5 km overlap. On a route with long perfectly straight runs it is not, because
the reduction collapses a straight to two vertices and a cut inside one has to
jump to its far end — a 5 km request measured 9.1 km on such a synthetic. That
is the mechanism working as designed, not a defect, but it is why the fixtures
use a continuously curving route.

**Ascent is asserted on the original line, not the reduced one.** The UI reports
both ("approximately X m against Y m"). The reduced line has already been
through Douglas–Peucker, which discards noise wiggles along with everything
else, so its figure flatters the ascent code. The original is the honest metric.

## Fixtures

`fixtures.js` generates routes with a seeded PRNG, so every run is identical and
any failure reproduces. Elevation noise comes in a `walk` and a `white` model,
described where they are implemented; the difference between them is what the
pinned weakness above is about.
