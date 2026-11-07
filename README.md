# Vinyl player

**A cartoon vinyl record player for Bilibili audio, running as a panel inside the
DeepSeek Harness Web GUI.**

Search for music, drop a record on the platter, and keep listening while you work
elsewhere in the app. The deck sits in the middle, a crate of records and a
favourites shelf sit underneath it, and playback never stops when you navigate away.

![turntable](tools/deck-preview.svg)

> **Not affiliated with Bilibili.** This is an unofficial plugin. It reads public
> audio streams from Bilibili's own web endpoints — endpoints it does not own and
> which may change or stop working at any time. Use it for personal, lawful
> listening only. See [Disclaimer and legal notice](#disclaimer-and-legal-notice).

---

## Contents

- [What you get](#what-you-get)
- [Install](#install)
- [Using it](#using-it)
- [How it works](#how-it-works)
- [The hard part: seeking](#the-hard-part-seeking)
- [Diagnosis](#diagnosis)
- [Tests](#tests)
- [Project layout](#project-layout)
- [FAQ](#faq)
- [Disclaimer and legal notice](#disclaimer-and-legal-notice)
- [Licence](#licence)

---

## What you get

| | |
| --- | --- |
| **A front-facing turntable** | Drawn entirely in SVG: flat fills, bold outlines, chunky offset shadows. Every disc is a true circle — never a squashed ellipse. |
| **The tonearm is the transport** | Drag it onto the record to play; lift it back onto its rest to pause. It tracks the pointer around a real pivot and is keyboard operable. |
| **A record crate** | Search results become sleeves. Hover one to swell it; drag it onto the platter to play it. |
| **A favourites shelf** | Drag a sleeve onto it to collect the record. Favourites survive a reload. |
| **Background playback** | The `<audio>` element lives in a shell overlay, so closing the panel does not stop the music, and the sidebar entry stays in sync with the deck. |
| **A scrubbable progress bar** | Three layers: played, buffered (grey), and not-yet-loaded. |
| **Nothing written to disk** | Audio is streamed. The in-memory copy used to make seeking work is revoked the moment the track changes. |

The panel layout:

```
+---------------------------------------------+
|  search                                     |
|                                             |
|              +-------------+                |
|              |  turntable  |   <- the deck  |
|              +-------------+                |
|         now playing  .  transport           |
|                                             |
|   +-----------+          +-----------+      |
|   |  record   |          | favorites |      |
|   |  crate    |          |  shelf    |      |
|   +-----------+          +-----------+      |
+---------------------------------------------+
```

## Install

Requirements: DeepSeek Harness with a Web GUI profile, a network path to
`bilibili.com` and `*.hdslb.com`, and Node 20+ only if you want to run the tests.

```bash
# install the bundle into the current profile
dsh plugin install-bundle ./vinyl-room
```

Or point the plugin manager at an absolute path:

```bash
dsh plugin_manager install_bundle target=/absolute/path/to/vinyl-room
```

The bundle ships its own `cordis.patch.yml`, so installing is enough — there is no
separate enable step. Reload the Web GUI afterwards (a hard refresh, `Ctrl+F5`).

Verify it loaded by opening the sidebar: a record-player entry labelled
**黑胶唱片机** / **Vinyl player** should be there.

## Using it

| Action | Result |
| --- | --- |
| Search, then click a sleeve | Plays that record |
| Drag a sleeve onto the platter | Plays it |
| Drag a sleeve onto the favourites shelf | Collects it, without playing |
| Drag the tonearm onto the record | Play |
| Drag the tonearm back to its rest | Pause |
| Drag the progress bar | Scrub. The grey band is already buffered |
| Click the heart on a sleeve | Add to / remove from favourites |
| Prev / stop / replay / next | Move through parts and tracks |

The only thing persisted is the favourites list, stored under
`vinyl-room:favorites.v1` in `localStorage`.

## How it works

The bundle has two halves.

### Host (`index.js`)

Bilibili's API cannot be called from a browser — it needs a cookie bootstrap and
WBI request signing. So the Host half does that work and exposes five routes:

| Route | Purpose |
| --- | --- |
| `/api/search` | Video search, used as the music catalogue |
| `/api/resolve` | Part list for one video |
| `/api/play` | Resolve a playable audio stream and issue a media token |
| `/api/cover` | Same-origin artwork proxy, restricted to Bilibili image hosts |
| `/media?t=…` | Range-aware proxy for the audio itself |

Design notes that matter:

- **The media token is opaque and expires after 50 minutes.** A copied URL stops
  working; the proxy cannot be turned into a permanent relay.
- **The cover proxy only talks to `*.hdslb.com` and `*.biliimg.com` over HTTPS.**
  It cannot be used as an open proxy.
- **A non-image response is rejected, not cached.** An upstream error page can never
  be served to the browser as image bytes.
- **Audio responses are marked `no-store`.** Nothing about the track is retained by
  the browser or an intermediary, while `Range` still works.

### Client (`lib/client.js`)

The panel: the deck, the shelves, and a small store shared by the sidebar entry and
the panel. It is a Cordis client module served as-is, so it uses
`React.createElement` rather than JSX, and ships its own `<style>` block.

## The hard part: seeking

Scrubbing a streamed, fragmented audio track turned out to be the hardest part of
this project. Four separate faults each produced the same user-visible symptom —
*"the bar moves but the music doesn't"* — and each needed a different fix. They are
documented here because the reasoning is not obvious from the code.

**1. The bar snaps back mid-drag.**
`timeupdate` fires several times a second, so a slider bound directly to it fights
the pointer. While dragging, the bar follows local scrub state; only release commits.

**2. A commit bounces back.**
A fragmented DASH stream keeps reporting the *old* position until the target
fragment has loaded. A committed seek therefore parks its target and holds it until
the element's own `seeked` event confirms arrival. A position report cannot release
that hold — the element can briefly report a value *near* the target before falling
back. Nothing may re-assign `currentTime` while a seek is in flight either, because
a fresh assignment aborts the seek and the track visibly jumps back.

**3. The audio never moves, though the bar does.**
Two causes stacked up:

- a seek was gated on a finite `duration`, but a fragmented stream reports
  `Infinity`, `NaN`, or a first-fragment duration until its index loads. The gate is
  now `readyState >= 1`, which is all the spec requires;
- the target was clamped to that short reported duration, which pinned every later
  seek inside the first fragment. The request is now passed through unclamped and
  the element decides what it can reach.

**4. The source is not seekable at all.**
Some desktop shells serve plugin routes through a custom protocol bridge
(`h-app://…`) that does not forward `Range` support. The element then reports
`seekable: []`, and in that state a browser *silently ignores every* `currentTime`
assignment — no error, no movement. The plugin detects this by fetching the track
into memory and swapping the element onto a Blob URL, which is always seekable. The
swap happens at the current position so the transition is inaudible, and the Blob is
revoked when the track changes or the panel unmounts.

## Diagnosis

On a live page, the client exposes two console helpers:

```js
__vinylDebug()      // element state: duration, readyState, seekable range, buffer
__vinylSeek(120)    // seek straight through the store; returns the same report
```

`__vinylDebug()` includes two fields worth checking first:

```js
{
  attached: true,       // false => the <audio> element is not mounted
  buffered: true,       // true  => the in-memory Blob is in use (seekable)
  canSeek: true,        // false => the browser reports no seekable range
  seekable: [[0, 226.8]],
  duration: 226.84,
  currentTime: 38.02,
  readyState: 4,
}
```

If `canSeek` is `false`, the source itself cannot be scrubbed — that is fault 4 above.
If `canSeek` is `true` but the audio still does not move, the seek is not reaching
the element, which points at the commit path.

## Tests

The suite is offline-first: it renders the real components with a stub React and
inspects the resulting element tree, so it needs no browser and no network.

```bash
npm test              # 14 suites, 319 checks
npm run test:browser  # optional: drives real headless Edge
```

| Suite | Covers |
| --- | --- |
| `buffer-check` | The grey buffer band; the loading state never sticks |
| `unseekable-check` | An element with an empty `seekable` range; the Blob fallback |
| `seekland-check` | A seek is assigned once and confirmed by `seeked` |
| `seekguard-check` | Stale position reports cannot pull the bar back |
| `seekapply-check` | Seeking before metadata; `Infinity` durations |
| `seek-check` | The drag lifecycle, clamping, keyboard, buffer fill |
| `label-check` | The label artwork pipeline and its fallback |
| `cover-check` | The cover proxy: cache headers, non-image rejection |
| `layout-check` | The cabinet contains the platter and the controls |
| `round-check` | Every disc is a circle, never an ellipse |
| `artifact-check` | The serialised SVG still holds those invariants |
| `arm-check` | The tonearm's pivot, swing, and where the stylus lands |
| `client-check` | Client behaviour, i18n parity, drag payloads |
| `host-check` | The Host routes end to end against live Bilibili |

The browser probes (`tools/e2e-probe.mjs`, `store-probe.mjs`, `bar-probe.mjs`,
`blob-probe.mjs`) exist because static tests cannot see how a real media element
behaves. Two of the four seek faults above were invisible to static analysis and were
only reproducible in a real engine — worth remembering before extending a suite.

## Project layout

```
index.js              Host half: Bilibili client, routes, media proxy
lib/client.js         Client half: the panel, the deck, the store
cordis.patch.yml      Bundle patch that registers the plugin
locale/{en,zh}.json   Panel strings
icon.svg              Sidebar icon
tools/*.mjs           Test suites (see above)
```

## FAQ

**The music plays but the progress bar does nothing.**
Run `__vinylDebug()` and check `canSeek`. This is the fourth seek fault described
above; the Blob fallback should have made it `true`.

**Search returns nothing.**
Bilibili rate-limits anonymous requests. Wait a moment and retry. If it persists,
the endpoint has probably changed — see the disclaimer.

**Does this download music?**
No. Audio is streamed from Bilibili's own servers while it plays. The in-memory
copy used to make seeking work is released when the track changes or the panel
closes, and nothing is written to disk.

**Why not use Bilibili's official player?**
Because it cannot be embedded here. This plugin requests audio the same way a
logged-out visitor's browser does, and renders its own UI around it.

**Why is the deck a flat front view rather than 3D?**
An earlier version applied a perspective projection, which *by definition* turns a
circle into an ellipse. The requirement was a round record, so the projection was
removed entirely and the deck is drawn straight-on.

## Disclaimer and legal notice

**No affiliation.** This is an unofficial, community-made plugin. It is not
produced, endorsed, sponsored by, or affiliated with Bilibili or DeepSeek.

**How it works.** The plugin makes the same kind of requests a logged-out visitor's
browser makes to Bilibili's public web endpoints, in order to locate audio that
Bilibili already serves publicly. It does not bypass paywalls, DRM, or access
controls, and it does not download, decrypt, or redistribute any content.

**No content is included or hosted.** This repository contains no audio, video, or
artwork. Everything played is fetched at runtime from Bilibili's own servers, and
nothing is written to disk: audio is streamed, and the temporary in-memory copy used
to make seeking work is released when the track changes or the panel closes.

**Fragility.** Those endpoints are undocumented and internal. Bilibili may change
them at any time, which can break this plugin without notice. Nothing here should be
treated as a stable API.

**Your responsibility.** By using this plugin you agree that:

- you will use it only for personal, lawful listening;
- you are responsible for complying with Bilibili's terms of service and with the
  copyright law of your jurisdiction;
- the authors provide no content and accept no liability for how you use the tool.

If you are a rights holder and believe this project is problematic, please open an
issue and it will be addressed promptly.

**Trademarks.** "Bilibili" and all related marks belong to their respective owners
and are used here only to describe what this plugin interoperates with.

## Licence

Released under the [MIT Licence](LICENSE). The disclaimer above describes how this
project is meant to be used; it is not a limitation on the licence grant.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
invariants that past bugs came from breaking, and [SECURITY.md](SECURITY.md) for how
to report a proxy or token problem privately.
