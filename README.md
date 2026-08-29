# Course Splitter

Prepare long GPX routes for Garmin watches. Thins the track down without
losing corners, then cuts it into overlapping courses small enough that the
watch draws them at full resolution.

**Everything runs in the browser.** The GPX file never leaves the device.

## Why

Load a long course onto a Garmin watch and the line it draws is often a poor
likeness of the route: switchbacks cut off, hairpins straightened. The watch
isn't broken — it's thinning the course to fit memory, and by all appearances
it keeps every nth point, saving as much on a straight road as through a set of
switchbacks.

Douglas–Peucker drops the points that sit on a straight line anyway and keeps
the ones carrying a bend, so a route can lose most of its points and still look
right. What's left gets cut into courses that slip under the watch's limit.

The limit isn't published. Reports from watches without built-in maps put it
around 450–500 points. Treat the defaults as a starting point and check a
tricky corner in the preview.

## Features

- Reduce by accuracy (max deviation in metres) or by target point count
- Split into courses with adjustable overlap, so there's time to switch
  courses mid-activity
- Zoomable preview comparing the original against the reduced line
- Distance and ascent before/after
- Reads `trkpt`, `rtept` and `wpt`; always writes a proper GPX track, which
  fixes files that Garmin Connect rejects as "not a course file"
- Share sheet on mobile, individual downloads or a ZIP on desktop
- An example route, for trying the tool without a GPX file to hand

## Example route

"Load an example route" loads a generated 43 km course with switchback climbs,
for trying the tool without a GPX file to hand. **It is not a real route.**

## Usage

Open `index.html` — that's the whole app. A single self-contained file with no
build step and no dependencies.

## Tests

A regression suite lives in `test/`. It drives the real page in a headless
browser and checks the real outputs.

```sh
cd test && npm install && npm test
```

See `test/README.md` for what each group guards and why.

## Licence

The application code is under the **MIT License** — see `LICENSE`.

The embedded fonts are **not** covered by MIT. Barlow Condensed and IBM Plex
are subsetted WOFF2 under the **SIL Open Font License 1.1**, and the notices in
the header of `index.html` and in `assets/` must stay with them wherever the
file goes. `index.html` is self-contained, so it carries both notices itself.

## Disclaimer

Provided as is, with no warranty of any kind. Output is not guaranteed to be
correct or complete — check every course against your original route before you
set off, and carry a backup means of navigation.
