<div align="center">

# Vinyl player

**A cartoon turntable for Bilibili audio, living inside the DeepSeek Harness Web GUI.**

Search for music · drop a record on the platter · keep listening while you work

[![MIT](https://img.shields.io/badge/licence-MIT-3da639?style=flat-square)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-ready-4f8cff?style=flat-square)](https://github.com/topics/dsh-plugin)
[![tests](https://img.shields.io/badge/tests-319%20passing-3da639?style=flat-square)](#tests)

<img src="docs/deck.svg" alt="The vinyl player panel: a cartoon turntable with a record on the platter, a wooden cabinet, a speed selector and a volume knob" width="560">

</div>

---

## What it is

A record player, not a music app. There is no list of files, no playlist sidebar,
no transport bar full of buttons — there is a **turntable**. You search for a song,
a record appears in a crate, you drag that record onto the platter, and it plays.

The whole panel is drawn as an illustration: a wooden cabinet, a spinning black
disc with a paper label, a chrome tonearm, a speed selector and a volume knob. It
is meant to feel like a small object sitting on your desk rather than another tab.

And because the audio lives outside the panel, **you can close the panel and the
music keeps playing** while you work elsewhere in the app.

## The panel

<div align="center">

| Turntable | Records |
| :--: | :--: |
| <img src="docs/deck.svg" width="380" alt="The turntable: record on the platter, tonearm engaged"> | <img src="docs/diagram.svg" width="380" alt="Panel layout: the deck in the middle, with the record crate and favourites shelf underneath"> |

*Left: the deck itself. Right: how the panel is arranged.*

</div>

The deck is the centre of the panel. Underneath it sit two shelves:

- the **record crate** — whatever your last search turned up
- the **favourites shelf** — the records you kept

Hover a sleeve and it swells toward you. Drag it onto the platter and it plays.
Drag it onto the favourites shelf and it is collected.

## The tonearm is the transport

There is no play button on the deck. To play, **drag the tonearm onto the record**.
To pause, **lift it back onto its rest**. The arm follows your pointer around its
pivot, and it works from the keyboard too.

This is the whole interaction, and it is why the panel has no transport bar: the
gesture that starts the music is the gesture a real turntable uses.

Secondary controls — previous, stop, replay, next — sit underneath, along with a
progress bar you can drag. The grey band ahead of the thumb shows how much of the
track is already buffered.

## Features

| | |
| --- | --- |
| **A drawn, not assembled, interface** | Every part of the deck is vector artwork: gradients for the brushed metal and the vinyl sheen, a real paper label, a perspective-free front view. |
| **Drag as the only verb** | Drag to play, drag to collect, drag to scrub. No settings panel, no menus. |
| **Playback that outlives the panel** | Close the panel, keep the music. The sidebar entry keeps the current record in view. |
| **A crate and a shelf** | Search results become sleeves; the ones you keep get their own shelf and survive a reload. |
| **Honest buffering** | The progress bar shows played, buffered, and not-yet-loaded as three separate bands. |
| **Both languages** | English and 简体中文, following the app's locale. |
| **Nothing written to disk** | Audio is streamed and released the moment you change track. |

## Install

```bash
dsh plugin install-bundle ./vinyl-room
```

Then reload the Web GUI. A **黑胶唱片机 / Vinyl player** entry appears in the
sidebar; open it and you have a turntable.

Requirements: a DeepSeek Harness Web GUI profile, and a network path to
`bilibili.com`.

## Using it

| Do this | And this happens |
| --- | --- |
| Type in the search box | The crate fills with records |
| Click a sleeve | It plays |
| Drag a sleeve onto the platter | It plays |
| Drag a sleeve onto the favourites shelf | It is collected, without playing |
| Drag the tonearm onto the record | Play |
| Drag the tonearm back to its rest | Pause |
| Drag the progress bar | Scrub through the track |
| Click the heart on a sleeve | Keep it, or let it go |

## How it fits together

The bundle has two halves, and they exist because a browser cannot talk to
Bilibili directly.

**The host half** does the talking: it obtains an anonymous visitor cookie, signs
its requests, and exposes four endpoints the panel can call — search, resolve a
video's track list, resolve a playable stream, and proxy artwork. Audio itself is
proxied through the host too, so range requests work and nothing is cached.

**The client half** is everything you see: the deck, the shelves, the drag and drop,
and a small shared store that keeps the sidebar and the panel in agreement.

```
index.js              Host half — Bilibili client, routes, media proxy
lib/client.js         Client half — the panel, the deck, the store
cordis.patch.yml      Registers the plugin with the harness
locale/{en,zh}.json   Panel strings
icon.svg              Sidebar icon
docs/*.svg            The images in this README
tools/*.mjs           Test suites
```

## Tests

```bash
npm test              # 14 suites, 319 checks, no browser or network needed
npm run test:browser  # optional: drives a real headless Edge
```

The offline suites render the real components with a stub React and inspect the
result, which is how the deck's geometry is verified — every disc is asserted to be
a `<circle>`, the cabinet is asserted to contain its platter, and the tonearm's
stylus is asserted to land where it should. The optional browser suites cover what
static checks cannot see, such as how a real media element responds to a seek.

## Legal

This is an unofficial project. It is not affiliated with, endorsed by, or
sponsored by Bilibili, and it contains no audio, video, or artwork — everything
played is streamed at runtime from Bilibili's own servers.

It does not bypass paywalls, DRM, or access controls, and it writes nothing to
disk. You are responsible for complying with Bilibili's terms of service and with
the copyright law of your jurisdiction. For personal, lawful listening only.

Please read [LEGAL.md](LEGAL.md) before using it.

## Licence

[MIT](LICENSE) © ChiaquanLin

---

<div align="center">
<sub>Issues and pull requests welcome. See <a href="CONTRIBUTING.md">CONTRIBUTING.md</a> and <a href="SECURITY.md">SECURITY.md</a>.</sub>
</div>
