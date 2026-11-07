---
name: Bug report
about: Something does not work as documented
labels: bug
---

**What happened**

A clear description of the problem.

**What you expected**

What should have happened instead.

**Steps to reproduce**

1.
2.
3.

**Diagnostics**

If the problem involves playback or the progress bar, please paste the output of
this, run in the browser console while the panel is open:

```js
__vinylDebug()
```

It reports the audio element's `duration`, `readyState`, `seekable` range, and
whether the in-memory buffer is in use. That distinguishes "the source cannot be
scrubbed" from "the seek was ignored", which are different bugs.

**Environment**

- Harness version:
- Operating system:
- Plugin version (from `package.json`):

**Anything else**

Logs, screenshots, or a note about whether it ever worked.
