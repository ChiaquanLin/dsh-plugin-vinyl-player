# Contributing

Thanks for looking. This is a small, hobby-scale plugin; the notes below keep
changes reviewable.

## Before you change anything

```bash
node tools/count-checks.mjs
```

369 checks across 17 suites. They run offline: React is stubbed and the components
are rendered into a plain object tree, so no browser is needed. Keep them green.

The optional browser suites need Microsoft Edge and network access:

```bash
node tools/e2e-probe.mjs
```

## The invariants

Several past bugs came from breaking these, and each is pinned by a test:

- **Every disc is a true `<circle>`.** Never draw one with `scale()` or a
  perspective projection; a projected circle is an ellipse.
- **The record spins about its own centre.** `vr-disc-spin` relies on
  `transform-box: fill-box`, because an SVG `transform-origin` otherwise resolves
  against the viewBox. The artwork is drawn around local `(0, 0)` so the two
  centres coincide.
- **The tonearm rotates about `PIVOT`.** It is a `<g>` inside the SVG rotated with
  `rotate(angle, PIVOT.x, PIVOT.y)`; the arm base is centred on the same point.
- **A seek is assigned once.** Re-assigning `currentTime` while a seek is in flight
  aborts it, and the track visibly bounces back.
- **The cover proxy only talks to allow-listed image hosts.** Do not widen it.
- **Nothing is written to disk.** Audio is streamed; the in-memory Blob used to
  make seeking work is revoked on track change and on unmount.

## Style

- The Host half is plain ESM, no build step. The Client half is a Cordis client
  module; it cannot use JSX, because it is served as-is.
- Prefer a comment that explains *why* a line is there over one that restates what
  it does. Several non-obvious workarounds exist because of specific browser
  behaviour; if you touch one, keep its explanation accurate.
- Keep user-facing strings in `locale/en.json` and `locale/zh.json`, and keep the
  two dictionaries at key parity — `client-check` asserts it.

## Adding a test

Put it in `tools/`, follow the existing shape (a `check(label, ok, detail)`
helper, a count at the end, a non-zero exit on failure), and register it in
`package.json`'s `test` script so it runs with the rest.

If a bug is only reproducible in a real media element, add a browser probe rather
than extending a static suite — half the seek defects in this project were
invisible to static analysis.

## Legal

Contributions must not add content (audio, video, artwork) to the repository, and
must not add code that bypasses paywalls, DRM, or access controls. See the
disclaimer in the README.
