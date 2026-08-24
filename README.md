# Course Splitter

Prepare long GPX routes for Garmin watches. Thins the track down without
losing corners, then cuts it into overlapping courses small enough that the
watch draws them at full resolution.

**Everything runs in the browser.** No uploads, no network requests, no
cookies, no storage. The GPX file never leaves the device.

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

"Load an example route" loads a generated 160 km course with switchback climbs,
for trying the tool without a GPX file to hand. Nothing was taken from anywhere
to build it, so there is no third-party map data in this repository and nothing
to attribute.

**It is not a real route.** It sits at Point Nemo, the point in the South
Pacific furthest from any land, so there is nothing underneath it to follow.
The courses come out named `example-do-not-follow_1of6.gpx`, and that name is
written into the GPX metadata too — it is what shows up in Garmin Connect long
after the page that warned about it is closed.

How the route is built, and why it is built that way, is commented in
`index.html`.

## Usage

Open `index.html` — that's the whole app. A single self-contained file with no
build step and no dependencies.

## Tests

A regression suite lives in `test/`. It drives the real page in a headless
browser and checks the real outputs — reduction, splitting and overlap, ascent
against profiles with known true climb, GPX output format, preview rendering,
and that nothing ever reaches the network.

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

## Legal pages

`impressum.html` and `datenschutz.html` are required of German site operators
(§ 18 Abs. 1 MStV and Art. 13 GDPR), and are linked from an always-visible
footer — the disclaimer footer appears only after a file is loaded, which would
not meet the "ständig verfügbar" requirement these links carry.

Both carry `noindex`, which keeps the contact details out of search results
without affecting the legal duty (that is about a visitor reaching the page,
not about being indexed). That covers the deployed pages only: if this
repository is ever made public, the same files stay readable — and indexable —
through GitHub's own file view.

The e-mail address is assembled in `assets/mail.js` from base64 parts and
appears nowhere in the markup, so an address regex over the raw HTML finds
nothing. The postal address stays selectable text — it has to remain readable
for screen readers, and an image would be OCR'd anyway.

A publish gate in the test suite fails on a leftover `[PLACEHOLDER]`, or on any
content still marked `.todo`.

## Disclaimer

Provided as is, with no warranty of any kind. Output is not guaranteed to be
correct or complete — check every course against your original route before you
set off, and carry a backup means of navigation.
