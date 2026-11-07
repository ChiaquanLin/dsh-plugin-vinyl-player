window.__ModuleLoader__.load({
  id: 'dsh-plugin-vinyl-player',
  factory(require) {
    'use strict';
    const React = require('react');
    const h = React.createElement;

    /** Locale namespace owned by this plugin. */
    const NS = 'vinyl-room';
    /** Panel id shared by the sidebar entry and the central panel key. */
    const PANEL_ID = 'vinyl-room';
    /** Host route prefix serving the Bilibili source. */
    const API_BASE = '/vinyl-room';
    /** Where collected records survive a reload. */
    const FAVORITES_KEY = 'vinyl-room:favorites.v1';
    /**
     * How long a committed seek outranks the audio element's own clock.
     *
     * After `currentTime` is set on a DASH stream, the browser keeps reporting
     * the previous position through `timeupdate` until the target fragment has
     * loaded. Mirroring those reports makes the progress bar jump back to where
     * the drag started, so the requested position wins until playback arrives or
     * this window closes.
     */
    const SEEK_GUARD_MS = 4000;
    /** A mirrored position within this distance of the seek target counts as arrival. */
    const SEEK_ARRIVED_S = 1.5;
    /**
     * How an unready seek is retried.
     *
     * Setting `currentTime` before metadata or seekable ranges exist is silently
     * discarded, so the request has to be repeated as the element becomes ready.
     * The delay grows with each attempt, which keeps a stream that is slow to
     * buffer from being hammered.
     */
    const SEEK_RETRY_MS = 250;
    const SEEK_MAX_ATTEMPTS = 6;

    /**
     * Tonearm geometry, in SVG user units.
     *
     * The pivot sits to the right of the disc. A positive SVG rotation is
     * clockwise on screen, which swings the stylus LEFT over the record; a
     * negative angle parks it on its rest to the right. The record spans
     * x 86..390, so the stylus first reaches it at about 34deg.
     *
     * `rotate(angle, PIVOT.x, PIVOT.y)` names the pivot explicitly, so the arm
     * turns about that point at every render size. It never depends on a DOM
     * box's centre, which is what previously rotated the arm about the wrong point.
     */
    const ARM_REST = -18;
    const ARM_PLAY = 42;
    const ARM_MIN = -22;
    const ARM_MAX = 52;
    /** At or beyond this angle the stylus counts as sitting on the record. */
    const ARM_ENGAGED = 34;

    /**
     * Front-view layout, in SVG user units.
     *
     * The vertical stack is derived, not eyeballed: a uniform margin, the disc's
     * diameter, a gap, the hardware row's height, and a matching margin. The
     * cabinet is tall enough to hold all of it, so neither the platter nor a
     * control is ever clipped by the housing — and the hardware row sits entirely
     * below the disc, so no control is drawn over the record.
     */
    const W = 600;
    const LAYOUT_MARGIN = 20;
    const LAYOUT_GAP = 14;
    const PLATTER = { cx: 238, cy: 226, r: 162 };
    const RECORD_R = 152;
    /** The hardware row: a speed selector and a volume knob, below the disc. */
    const CONTROLS = { y: 402, speed: { x: 74, w: 92 }, knob: { x: 486, r: 25 } };
    const CABINET = {
      x: 40,
      y: 44,
      w: 520,
      h: LAYOUT_MARGIN * 2 + PLATTER.r * 2 + LAYOUT_GAP + CONTROLS.knob.r * 2,
    };
    const H = CABINET.y + CABINET.h + 30;
    /** The tonearm's pivot. The drawn arm base is centred on exactly this point. */
    const PIVOT = { x: 472, y: 150 };
    /** Distance from the pivot to the stylus, i.e. the arm's effective length. */
    const ARM_LENGTH = 220;

    /** Every visible string this panel owns, in the two shipped languages. */
    const DICTIONARIES = {
      en: {
        panel: 'Vinyl player',
        searchPlaceholder: 'Search Bilibili for music\u2026',
        search: 'Search',
        searching: 'Searching Bilibili\u2026',
        shelf: 'Record crate',
        shelfEmpty: 'Search for a song, artist, or album \u2014 every result drops into the crate.',
        shelfEmptyHint: 'Try a song name, a singer, or a playlist title.',
        noResults: 'No playable videos matched that search.',
        favorites: 'Favorites',
        favoriteAdd: 'Add to favorites',
        favoriteRemove: 'Remove from favorites',
        favoriteDropHere: 'Drop to collect',
        favoritesEmpty: 'Nothing collected yet.',
        favoritesEmptyHint: 'Press the heart on a record in the crate.',
        nowSpinning: 'Now spinning',
        nothingPlaying: 'Platter is empty',
        play: 'Play',
        pause: 'Pause',
        stop: 'Stop',
        replay: 'Replay',
        next: 'Next record',
        previous: 'Previous record',
        side: 'Side',
        trackList: 'Track list',
        retry: 'Retry',
        clear: 'Empty the crate',
        dropHint: 'Drag a record onto the platter',
        dragHint: 'Drop the stylus on the record to play, lift it off to pause.',
        dropRelease: 'Release to drop the needle',
        speed: 'Speed',
        volume: 'Volume',
        muted: 'Muted',
        loadMore: 'Load more records',
        recordsCount: '{count} records',
        errBadQuery: 'Type a search keyword first.',
        errBadBvid: 'That record cannot be played.',
        errBadMedia: 'That track cannot be played.',
        errUpstream: 'Bilibili refused the request. Try again in a moment.',
        errNetwork: 'Could not reach Bilibili. Check the network connection.',
        errNoAudio: 'No audio stream is available for this record.',
        errExpired: 'The audio link expired. Pick the record again.',
      },
      zh: {
        panel: '\u9ed1\u80f6\u5531\u7247\u673a',
        searchPlaceholder: '\u641c\u7d22 Bilibili \u97f3\u4e50\u2026',
        search: '\u641c\u7d22',
        searching: '\u6b63\u5728\u641c\u7d22 Bilibili\u2026',
        shelf: '\u5531\u7247\u67b6',
        shelfEmpty: '\u5728\u4e0a\u65b9\u641c\u7d22\u6b4c\u66f2\u3001\u6b4c\u624b\u6216\u4e13\u8f91\uff0c\u6bcf\u6761\u7ed3\u679c\u90fd\u4f1a\u6446\u4e0a\u5531\u7247\u67b6\u3002',
        shelfEmptyHint: '\u8bd5\u8bd5\u6b4c\u540d\u3001\u6b4c\u624b\uff0c\u6216\u8005\u6b4c\u5355\u6807\u9898\u3002',
        noResults: '\u6ca1\u6709\u627e\u5230\u53ef\u64ad\u653e\u7684\u89c6\u9891\u3002',
        favorites: '\u6536\u85cf\u67b6',
        favoriteAdd: '\u6536\u85cf\u5531\u7247',
        favoriteRemove: '\u53d6\u6d88\u6536\u85cf',
        favoriteDropHere: '\u677e\u624b\u6536\u8fdb\u6536\u85cf\u67b6',
        favoritesEmpty: '\u6536\u85cf\u67b6\u8fd8\u7a7a\u7740\u3002',
        favoritesEmptyHint: '\u70b9\u5531\u7247\u4e0a\u7684\u5fc3\u5f62\u5c31\u80fd\u6536\u8d77\u6765\u3002',
        nowSpinning: '\u6b63\u5728\u64ad\u653e',
        nothingPlaying: '\u5531\u76d8\u4e0a\u7a7a\u7a7a\u5982\u4e5f',
        play: '\u64ad\u653e',
        pause: '\u6682\u505c',
        stop: '\u505c\u6b62',
        replay: '\u91cd\u653e',
        next: '\u4e0b\u4e00\u5f20',
        previous: '\u4e0a\u4e00\u5f20',
        side: '\u9762',
        trackList: '\u66f2\u76ee\u5217\u8868',
        retry: '\u91cd\u8bd5',
        clear: '\u6e05\u7a7a\u5531\u7247\u67b6',
        dropHint: '\u628a\u5531\u7247\u62d6\u5230\u5531\u76d8\u4e0a',
        dragHint: '\u628a\u5531\u9488\u653e\u5230\u5531\u7247\u4e0a\u5c31\u64ad\u653e\uff0c\u62ff\u5f00\u5c31\u6682\u505c\u3002',
        dropRelease: '\u677e\u5f00\u5c31\u80fd\u653e\u4e0b\u5531\u9488',
        speed: '\u8f6c\u901f',
        volume: '\u97f3\u91cf',
        muted: '\u5df2\u9759\u97f3',
        loadMore: '\u52a0\u8f7d\u66f4\u591a\u5531\u7247',
        recordsCount: '{count} \u5f20\u5531\u7247',
        errBadQuery: '\u8bf7\u5148\u8f93\u5165\u641c\u7d22\u5173\u952e\u8bcd\u3002',
        errBadBvid: '\u8fd9\u5f20\u5531\u7247\u65e0\u6cd5\u64ad\u653e\u3002',
        errBadMedia: '\u8fd9\u9996\u66f2\u76ee\u65e0\u6cd5\u64ad\u653e\u3002',
        errUpstream: 'Bilibili \u62d2\u7edd\u4e86\u8bf7\u6c42\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
        errNetwork: '\u65e0\u6cd5\u8fde\u63a5 Bilibili\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u3002',
        errNoAudio: '\u8fd9\u5f20\u5531\u7247\u6ca1\u6709\u53ef\u7528\u7684\u97f3\u9891\u6d41\u3002',
        errExpired: '\u97f3\u9891\u94fe\u63a5\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u9009\u62e9\u5531\u7247\u3002',
      },
    };

    /** Filled in `apply`; components resolve their copy through it. */
    let localeService = null;
    let translate = (key) => key;

    /** Read a registered string. */
    const text = (key, params) => translate(key, params);

    /** Failure codes the host returns, as localized sentences. */
    const ERROR_KEYS = {
      'bad-query': 'errBadQuery',
      'bad-bvid': 'errBadBvid',
      'bad-media': 'errBadMedia',
      upstream: 'errUpstream',
      network: 'errNetwork',
      'no-audio': 'errNoAudio',
      expired: 'errExpired',
    };
    const errorText = (code) => translate(ERROR_KEYS[code] ?? 'errUpstream');

    /** Format a duration in seconds as `m:ss`, or `h:mm:ss` past an hour. */
    const clock = (seconds) => {
      const total = Math.max(0, Math.round(Number(seconds) || 0));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const rest = total % 60;
      const pad = (value) => String(value).padStart(2, '0');
      return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
    };

    /** First visible character, used when no artwork exists. */
    const initial = (value) => {
      const trimmed = String(value ?? '').trim();
      return trimmed === '' ? '\u266a' : [...trimmed][0].toUpperCase();
    };

    /**
     * Same-origin cover proxy URL for one artwork address.
     *
     * Three properties matter here, and each was learned from a broken image:
     *
     *  - the URL is absolute. An SVG <image> resolves a relative href against the
     *    document base in some engines and against nothing in others, so a
     *    site-absolute path behaves differently between them.
     *  - it carries a version tag. Earlier builds requested the cover at a
     *    different path, and whatever the browser cached for it is still bound to
     *    that URL; bumping the tag gives every client a fresh entry instead of
     *    the stale broken one.
     *  - encodeURIComponent is applied to the upstream address, so the query
     *    stays a single well-formed parameter.
     */
    const COVER_VERSION = '2';
    const coverUrl = (cover) => {
      if (cover === '' || cover === undefined) return '';
      const path = `${API_BASE}/api/cover?u=${encodeURIComponent(cover)}&v=${COVER_VERSION}`;
      const origin = typeof window !== 'undefined' && window.location !== undefined ? window.location.origin : '';
      return origin === '' ? path : `${origin}${path}`;
    };

    /** Reject anything that is not a well-formed record row from the host. */
    const asRow = (value) => {
      if (value === null || typeof value !== 'object') return undefined;
      if (typeof value.bvid !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(value.bvid)) return undefined;
      return {
        bvid: value.bvid,
        title: typeof value.title === 'string' ? value.title : '',
        author: typeof value.author === 'string' ? value.author : '',
        cover: typeof value.cover === 'string' ? value.cover : '',
        duration: Number(value.duration) || 0,
      };
    };

    /**
     * Call one host endpoint.
     * @param path - route suffix under `/vinyl-room`.
     * @param query - query parameters to send.
     * @returns the parsed `{ ok: true, ... }` body, or `{ ok: false, code }`.
     */
    async function callHost(path, query) {
      const url = new URL(`${API_BASE}${path}`, window.location.origin);
      for (const [name, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
      }
      let response;
      try {
        response = await fetch(url.toString(), { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      } catch {
        return { ok: false, code: 'network' };
      }
      let body;
      try {
        body = await response.json();
      } catch {
        return { ok: false, code: 'upstream' };
      }
      if (body === null || typeof body !== 'object') return { ok: false, code: 'upstream' };
      if (body.ok === true) return body;
      return { ok: false, code: typeof body.code === 'string' ? body.code : 'upstream' };
    }

    /** Read the collected records, tolerating a cleared or blocked storage. */
    function loadFavorites() {
      try {
        const raw = window.localStorage.getItem(FAVORITES_KEY);
        if (raw === null) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map(asRow).filter((row) => row !== undefined);
      } catch {
        return [];
      }
    }

    /** Persist the collected records, ignoring a blocked storage. */
    function saveFavorites(rows) {
      try {
        window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(rows));
      } catch {
        /* a private window may refuse writes; the session still works */
      }
    }

    /**
     * The one playback owner: crate, collected records, the platter and the
     * transport. The room panel and the sidebar control both read this snapshot,
     * and the `<audio>` element lives in a root-scoped entry, so leaving the room
     * keeps the music running.
     */
    class RoomStore {
      constructor() {
        this.listeners = new Set();
        this.records = new Map();
        this.rows = new Map();
        this.audio = null;
        this.mirror = undefined;
        this.playToken = 0;
        /** Pending committed seek: { target, until }. Cleared once it lands. */
        this.seekGuard = undefined;
        /** A seek was handed to the element and its `seeked` event is awaited. */
        this.seeking = undefined;
        /**
         * The target the user last asked for. Retries compare against this so a
         * superseded seek never lands, while a seek still waiting for metadata
         * keeps retrying (it has not been parked on the element yet).
         */
        this.pendingSeek = undefined;
        /**
         * In-memory copy of the current track. The desktop shell's route bridge
         * drops Range support, so the element cannot seek the streaming URL; the
         * buffered Blob URL restores scrubbing. Nothing is persisted: the Blob is
         * revoked when the track changes or the element detaches.
         */
        this.bufferUrl = undefined;
        this.bufferToken = undefined;
        const favorites = loadFavorites();
        for (const row of favorites) this.rows.set(row.bvid, row);
        this.snapshot = {
          query: '',
          shelf: [],
          favorites,
          searching: false,
          loadingMore: false,
          searchError: '',
          searched: false,
          record: null,
          partIndex: 0,
          loadingRecord: false,
          status: 'idle',
          error: '',
          time: 0,
          buffered: 0,
          duration: 0,
          volume: 0.8,
          muted: false,
          speed: 33,
          playing: false,
          roomMounted: false,
          dropActive: false,
        };
      }

      subscribe = (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      };

      getSnapshot = () => this.snapshot;

      /** Monotonic clock used for the seek guard; injectable for tests. */
      now() {
        return Date.now();
      }

      /** Replace changed snapshot fields and notify subscribers once. */
      patch(next) {
        let changed = false;
        for (const key of Object.keys(next)) {
          if (this.snapshot[key] !== next[key]) {
            changed = true;
            break;
          }
        }
        if (!changed) return;
        this.snapshot = { ...this.snapshot, ...next };
        for (const listener of [...this.listeners]) {
          try {
            listener();
          } catch {
            /* a broken subscriber must not stop the transport */
          }
        }
      }

      /** Remember one row so any surface can resolve it back to a bvid. */
      remember(row) {
        if (row !== undefined && !this.rows.has(row.bvid)) this.rows.set(row.bvid, row);
        return row;
      }

      /** Find a row the crate or the favorites shelf already knows. */
      rowOf(bvid) {
        return this.rows.get(bvid) ?? this.snapshot.shelf.find((row) => row.bvid === bvid);
      }

      /** Mirror one `<audio>` element; the root-scoped player calls this on mount and unmount. */
      attach(audio) {
        if (this.audio === audio) return;
        this.detach();
        if (audio === null || audio === undefined) return;
        this.audio = audio;
        audio.volume = this.snapshot.volume;
        audio.muted = this.snapshot.muted;
        const sync = () => {
          const reported = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
          // How much has been downloaded, so the bar can show a grey buffer ahead
          // of the thumb. `buffered` covers what the element has decoded; the
          // in-memory copy used on this shell is the whole track.
          let buffered = 0;
          try {
            if (audio.buffered.length > 0) buffered = audio.buffered.end(audio.buffered.length - 1);
          } catch {
            buffered = 0;
          }
          if (this.bufferUrl !== undefined && Number.isFinite(audio.duration)) buffered = audio.duration;
          // While a committed seek is in flight the element still reports its old
          // position. Keep showing the requested one until the seek actually
          // completes, so the bar settles forward instead of snapping back.
          const guard = this.seekGuard;
          let time = reported;
          if (guard !== undefined) {
            const expired = this.now() >= guard.until;
            // A seek that was handed to the element is confirmed by its `seeked`
            // event, never by a position report: mid-seek the element can briefly
            // report a value near the target and then fall back.
            const pending = this.seeking !== undefined;
            const arrived = !pending && Math.abs(reported - guard.target) <= SEEK_ARRIVED_S;
            if (arrived || expired) {
              this.seekGuard = undefined;
              this.seeking = undefined;
              this.pendingSeek = undefined;
            } else {
              time = guard.target;
            }
          }
          this.patch({
            playing: !audio.paused && !audio.ended,
            time,
            buffered: Number.isFinite(buffered) ? buffered : 0,
            duration: Number.isFinite(audio.duration) ? audio.duration : 0,
          });
        };
        const onEnded = () => this.advance(1);
        const onError = () => {
          if (audio.error === null) return;
          this.patch({ status: 'error', error: 'expired', playing: false });
        };
        /** The element finished a seek: release the guard if it landed. */
        const settle = () => this.settleSeek();
        const names = ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'emptied'];
        this.mirror = { sync, onEnded, onError, names };
        for (const name of names) audio.addEventListener(name, sync);
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('error', onError);
        // A completed seek confirms the parked target; polling with fresh
        // assignments would abort the seek instead of confirming it.
        audio.addEventListener('seeked', settle);
        this.mirror.settle = settle;
        sync();
      }

      detach() {
        const audio = this.audio;
        const mirror = this.mirror;
        if (audio === null || mirror === undefined) return;
        for (const name of mirror.names) audio.removeEventListener(name, mirror.sync);
        audio.removeEventListener('ended', mirror.onEnded);
        audio.removeEventListener('error', mirror.onError);
        if (mirror.settle !== undefined) audio.removeEventListener('seeked', mirror.settle);
        this.releaseBuffer();
        this.audio = null;
        this.mirror = undefined;
      }

      /** Keyword search that refills the crate. */
      async search(rawQuery) {
        const keyword = String(rawQuery ?? '').trim();
        if (keyword === '') {
          this.patch({ searchError: 'bad-query' });
          return;
        }
        this.patch({ query: keyword, searching: true, searchError: '', searched: true, shelf: [] });
        const body = await callHost('/api/search', { q: keyword });
        if (body.ok !== true) {
          this.patch({ searching: false, searchError: body.code });
          return;
        }
        const rows = (body.items ?? []).map(asRow).filter((row) => row !== undefined);
        for (const row of rows) this.remember(row);
        this.patch({ searching: false, shelf: rows, searchError: '' });
      }

      /** Append the next result page. */
      async loadMore() {
        const { query, searching, loadingMore, shelf } = this.snapshot;
        if (query === '' || searching || loadingMore) return;
        this.patch({ loadingMore: true });
        const body = await callHost('/api/search', { q: query, page: Math.floor(shelf.length / 20) + 1 });
        if (body.ok !== true) {
          this.patch({ loadingMore: false, searchError: body.code });
          return;
        }
        const seen = new Set(shelf.map((row) => row.bvid));
        const extra = (body.items ?? [])
          .map(asRow)
          .filter((row) => row !== undefined && !seen.has(row.bvid));
        for (const row of extra) this.remember(row);
        this.patch({ loadingMore: false, shelf: [...shelf, ...extra] });
      }

      /** Add or remove one record on the favorites shelf. */
      toggleFavorite(bvid) {
        const row = this.remember(this.rowOf(bvid));
        if (row === undefined) return;
        const exists = this.snapshot.favorites.some((item) => item.bvid === bvid);
        const favorites = exists
          ? this.snapshot.favorites.filter((item) => item.bvid !== bvid)
          : [row, ...this.snapshot.favorites];
        saveFavorites(favorites);
        this.patch({ favorites });
      }

      /** Cached part list of one record. */
      async recordOf(bvid) {
        const cached = this.records.get(bvid);
        if (cached !== undefined) return cached;
        const body = await callHost('/api/resolve', { bvid });
        if (body.ok !== true) {
          this.patch({ loadingRecord: false, status: 'error', error: body.code });
          return undefined;
        }
        this.records.set(bvid, body.record);
        return body.record;
      }

      /**
       * Put one record on the platter and start its track. This is what a click,
       * a drop onto the disc, and the sidebar control all end up calling.
       * @param bvid - the record to play.
       * @param partIndex - which part of that record.
       * @param autoplay - start transport immediately.
       */
      async play(bvid, partIndex = 0, autoplay = true) {
        const token = (this.playToken += 1);
        if (this.rowOf(bvid) === undefined) return;
        this.patch({ loadingRecord: true, status: 'loading', error: '' });
        /**
         * Clear the loading flag on every exit path.
         *
         * Each early return used to leave `loadingRecord: true` behind, so the
         * play key's disc kept spinning forever after a resolve or play failure —
         * the transport looked permanently busy while audio played normally.
         */
        const release = (extra) => {
          if (token !== this.playToken) return;
          this.patch({ loadingRecord: false, ...(extra ?? {}) });
        };
        let record;
        try {
          record = await this.recordOf(bvid);
        } catch {
          release({ status: 'error', error: 'network' });
          return;
        }
        if (token !== this.playToken || record === undefined) {
          release(record === undefined ? { status: 'error', error: 'network' } : undefined);
          return;
        }
        const index = Math.min(Math.max(0, partIndex), record.parts.length - 1);
        this.patch({ record, partIndex: index, error: '' });
        let stream;
        try {
          stream = await callHost('/api/play', { bvid, cid: record.parts[index].cid });
        } catch {
          release({ status: 'error', error: 'network' });
          return;
        }
        if (token !== this.playToken) return;
        if (stream.ok !== true) {
          release({ status: 'error', error: stream.code });
          return;
        }
        this.patch({ loadingRecord: false, status: 'ready' });
        const audio = this.audio;
        if (audio === null) return;
        // A new track starts at zero; a guard left over from the previous one
        // would hold the bar at the old position.
        this.seekGuard = undefined;
        this.releaseBuffer();
        audio.src = stream.src;
        audio.load();
        if (autoplay) this.resume();
        // The desktop shell serves this route over its own `h-app://` bridge,
        // which does not forward Range support to the media element. The element
        // then reports an empty `seekable` range and silently ignores every
        // `currentTime` assignment, so playback continues from where it was while
        // the progress bar sits where it was dropped. Buffering the track into a
        // Blob URL gives the element a source it can always seek within.
        void this.bufferTrack(stream.src, token);
      }

      /**
       * Fetch the whole track into memory and swap the element onto a Blob URL.
       *
       * The audio is held only in memory and released on the next track or on
       * detach, so nothing is written to disk and nothing survives the session.
       * Playback starts immediately from the streaming URL; the swap happens once
       * the bytes are in hand, resuming at the same position so the transition is
       * inaudible.
       * @param src - the streaming URL currently on the element.
       * @param token - the play token, so a superseded load is discarded.
       */
      async bufferTrack(src, token) {
        if (typeof fetch !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
          return;
        }
        const audio = this.audio;
        if (audio === null) return;
        this.bufferToken = token;
        let blob;
        try {
          const response = await fetch(src, { credentials: 'same-origin' });
          if (response.ok !== true) return;
          const type = response.headers.get('content-type') ?? 'audio/mp4';
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength < 4096) return;
          blob = new Blob([bytes], { type });
        } catch {
          // A failed pre-fetch is not fatal: the streaming URL still plays, it
          // just cannot be scrubbed on this platform.
          return;
        }
        if (this.bufferToken !== token || this.playToken !== token) return;
        const element = this.audio;
        if (element === null) return;
        const at = Number.isFinite(element.currentTime) ? element.currentTime : 0;
        const wasPlaying = element.paused === false;
        const url = URL.createObjectURL(blob);
        this.releaseBuffer();
        this.bufferUrl = url;
        this.bufferToken = token;
        element.src = url;
        element.load();
        // Resume where the listener already was, so the swap is inaudible.
        const restore = () => {
          element.removeEventListener('loadedmetadata', restore);
          if (at > 0) this.applySeek(element, at);
        };
        element.addEventListener('loadedmetadata', restore);
        if (wasPlaying) this.resume();
      }

      /** Drop the in-memory track, if one is held. */
      releaseBuffer() {
        if (this.bufferUrl === undefined) return;
        try {
          URL.revokeObjectURL(this.bufferUrl);
        } catch {
          /* already revoked */
        }
        this.bufferUrl = undefined;
      }

      /** Start or resume transport. */
      resume() {
        const audio = this.audio;
        if (audio === null || audio.src === '') return;
        const started = audio.play();
        if (started !== undefined && typeof started.catch === 'function') {
          started.catch(() => this.patch({ playing: false }));
        }
      }

      /** Pause transport. */
      pause() {
        if (this.audio !== null) this.audio.pause();
      }

      /** Stop transport and return the needle to the start of the track. */
      stop() {
        const audio = this.audio;
        if (audio === null) return;
        audio.pause();
        // Rewinding is itself a seek; guard it so the element's stale clock does
        // not report the old position back before the jump lands.
        this.seekGuard = { target: 0, until: this.now() + SEEK_GUARD_MS };
        if (Number.isFinite(audio.duration)) audio.currentTime = 0;
        this.patch({ time: 0 });
      }

      /** Replay the current track from the beginning, resuming if paused. */
      replay() {
        const audio = this.audio;
        if (audio === null || audio.src === '') return;
        this.seekGuard = { target: 0, until: this.now() + SEEK_GUARD_MS };
        audio.currentTime = 0;
        this.patch({ time: 0 });
        this.resume();
      }

      /**
       * Play or pause. With nothing on the platter yet, start the first record
       * the crate or the favorites shelf holds.
       */
      toggle() {
        const snapshot = this.snapshot;
        if (snapshot.record === null || snapshot.status === 'error') {
          const target = snapshot.record ?? snapshot.shelf[0] ?? snapshot.favorites[0];
          if (target !== undefined) {
            const bvid = typeof target === 'string' ? target : target.bvid;
            const index = snapshot.record === null ? 0 : snapshot.partIndex;
            void this.play(bvid, index, true);
          }
          return;
        }
        if (snapshot.playing) this.pause();
        else this.resume();
      }

      /**
       * Choose what the platter should do, phrased the way the tonearm thinks:
       * the stylus is either down on the record or lifted off it.
       * @param engaged - true to play, false to pause.
       */
      setEngaged(engaged) {
        if (engaged) this.toggle();
        else if (this.snapshot.playing) this.pause();
      }

      /** Play the current record at another part. */
      playPart(partIndex) {
        const record = this.snapshot.record;
        if (record === null) return;
        if (partIndex === this.snapshot.partIndex && this.snapshot.status !== 'error') {
          this.toggle();
          return;
        }
        void this.play(record.bvid, partIndex, true);
      }

      /**
       * Step along the crate.
       * @param delta - +1 for the next record, -1 for the previous one.
       */
      advance(delta) {
        const { shelf, favorites, record } = this.snapshot;
        const list = shelf.length > 0 ? shelf : favorites;
        if (list.length === 0) return;
        const at = record === null ? -1 : list.findIndex((row) => row.bvid === record.bvid);
        const next = at === -1 ? (delta > 0 ? 0 : list.length - 1) : (at + delta + list.length) % list.length;
        void this.play(list[next].bvid, 0, true);
      }

      /** Seek within the current track. */
      /**
       * Seek within the current track.
       *
       * `commit` distinguishes a live drag from a settled seek. Setting
       * `currentTime` on every pointer move re-decodes the stream, which stalls
       * scrubbing on long recordings; during a drag the caller only previews the
       * new position, and the real seek happens once on release.
       * @param seconds - target position.
       * @param commit - true to move playback, false to preview only.
       */
      seek(seconds, commit = true) {
        const audio = this.audio;
        if (audio === null) return;
        /**
         * Trust the requested position, never collapse it against the element's
         * own duration.
         *
         * A fragmented stream reports `Infinity`, `NaN`, or a duration taken from
         * the first fragment only. Clamping to that short value pinned every later
         * seek inside the first fragment, which is why the audio refused to move
         * even though the bar did. The element itself rejects a position it cannot
         * reach, so the request is passed through unclamped.
         */
        const target = Math.max(0, seconds);
        // The bar follows the drag immediately, even before any decode happens.
        this.patch({ time: target });
        if (!commit) return;
        /**
         * A committed seek is authoritative for a moment.
         *
         * On a DASH stream the browser reports the OLD position through
         * `timeupdate` until the target fragment has loaded, so a naive mirror
         * writes that stale value straight back and the bar snaps to where the
         * drag started. This guard keeps the requested position until playback
         * actually arrives there (or the grace period expires).
         */
        this.seekGuard = { target, until: this.now() + SEEK_GUARD_MS };
        this.pendingSeek = target;
        this.applySeek(audio, target);
      }

      /**
       * A snapshot of everything that governs seeking, for diagnosis.
       *
       * Seeking depends on state spread across the element, the guard, and the
       * store. When it fails in a real browser this makes the cause visible
       * without guesswork: `window.__vinylDebug()` prints it.
       */
      describeSeek() {
        const audio = this.audio;
        if (audio === null) {
          return { attached: false, note: 'no audio element is attached; seek() returns immediately' };
        }
        const ranges = [];
        for (let i = 0; i < audio.seekable.length; i += 1) {
          ranges.push([Number(audio.seekable.start(i).toFixed(2)), Number(audio.seekable.end(i).toFixed(2))]);
        }
        return {
          attached: true,
          src: String(audio.src || '').slice(-40),
          /** A blob: source is locally buffered and always seekable. */
          buffered: String(audio.src || '').startsWith('blob:'),
          currentTime: Number(audio.currentTime.toFixed(2)),
          duration: Number.isFinite(audio.duration) ? Number(audio.duration.toFixed(2)) : String(audio.duration),
          readyState: audio.readyState,
          networkState: audio.networkState,
          paused: audio.paused,
          seeking: audio.seeking,
          seekable: ranges,
          /**
           * True when the element reports no usable range. On this desktop shell
           * the `h-app://` bridge drops Range support, so a streamed source
           * cannot be scrubbed; the buffered Blob fixes it and this flips to true.
           */
          canSeek: ranges.some((range) => range[1] > 0),
          storeTime: Number(this.snapshot.time.toFixed(2)),
          storeDuration: Number(this.snapshot.duration.toFixed(2)),
          seekGuard: this.seekGuard ?? null,
          pendingSeek: this.pendingSeek ?? null,
          handedSeek: this.seeking ?? null,
        };
      }

      /**
       * Move the element to a position, retrying until it takes.
       *
       * Assigning `currentTime` before metadata or seekable ranges exist is
       * silently discarded by the media element — no error, no movement, which is
       * exactly the "it does not jump to the track position" behaviour. The
       * assignment is therefore retried across metadata readiness and after the
       * element reports its new position, and abandoned once the value sticks.
       * @param audio - the element to move.
       * @param target - requested position in seconds.
       * @param attempt - retry counter; the caller omits it.
       */
      /**
       * Move the element to a position, retrying only while it cannot accept one.
       *
       * Assigning `currentTime` before metadata or seekable ranges exist is
       * silently discarded, so the request is parked and repeated as the element
       * becomes ready.
       *
       * The retry must stop the moment an assignment is accepted. Re-assigning
       * `currentTime` while a seek is still in flight ABORTS that seek, and the
       * element falls back to where it started — which is exactly the "it jumps
       * and then bounces back" behaviour. Verification therefore waits for the
       * element's own `seeked` event instead of polling with fresh assignments.
       * @param audio - the element to move.
       * @param target - requested position in seconds.
       * @param attempt - retry counter; the caller omits it.
       */
      applySeek(audio, target, attempt = 0) {
        if (this.audio !== audio) return; // the element was replaced mid-flight
        /**
         * Seek as soon as the element can hold a position at all.
         *
         * The previous gate also required a finite `duration`, but a fragmented
         * DASH stream reports `Infinity` (or a duration derived from the first
         * fragment only) until more of the index loads. Requiring it meant the
         * assignment never happened — the bar moved and the audio did not.
         * `readyState >= 1` (HAVE_METADATA) is the only condition the spec needs
         * for `currentTime` to be honoured, so that is the gate.
         */
        const ready = audio.readyState >= 1;
        if (!ready) {
          if (attempt >= SEEK_MAX_ATTEMPTS) return;
          const delay = SEEK_RETRY_MS * (attempt + 1);
          setTimeout(() => {
            // Abandon only if the element was replaced or the user aimed
            // somewhere else. A superseded target is dropped by comparison;
            // waiting for `seeking` here would cancel the retry before the
            // target has ever been parked.
            if (this.audio !== audio) return;
            if (this.pendingSeek !== target) return;
            this.applySeek(audio, target, attempt + 1);
          }, delay);
          return;
        }
        // Park the target so the arriving `seeked` event can confirm it, then hand
        // the element exactly one assignment.
        this.seeking = target;
        try {
          audio.currentTime = target;
        } catch {
          // Some engines throw for a position they cannot reach yet. Wait for
          // metadata rather than hammering the element.
          this.seeking = undefined;
          if (attempt >= SEEK_MAX_ATTEMPTS) return;
          setTimeout(() => {
            if (this.audio !== audio) return;
            if (this.pendingSeek !== target) return;
            this.applySeek(audio, target, attempt + 1);
          }, SEEK_RETRY_MS * (attempt + 1));
        }
      }

      /**
       * Confirm the element reached the parked seek target.
       *
       * Called from the element's `seeked` listener: once playback reports a
       * position near the target the guard is released, so later reports track
       * normally. A seek that never lands simply expires with the guard.
       */
      settleSeek() {
        const audio = this.audio;
        if (audio === null) return;
        const target = this.seeking;
        this.seeking = undefined;
        if (target === undefined) return;
        if (Math.abs(audio.currentTime - target) > SEEK_ARRIVED_S) return;
        this.seekGuard = undefined;
        this.pendingSeek = undefined;
      }

      /** Platter speed: the visual rotation and the label's stated rpm. */
      setSpeed(speed) {
        this.patch({ speed: speed === 45 ? 45 : 33 });
      }

      /** Highlight the platter while a record hovers over it. */
      setDropActive(active) {
        this.patch({ dropActive: Boolean(active) });
      }

      /**
       * Note whether the room panel is on screen. The sidebar control labels
       * itself from the shared transport either way.
       * @param mounted - true while the room panel is rendered.
       */
      setRoomMounted(mounted) {
        this.patch({ roomMounted: mounted });
      }

      setVolume(volume) {
        const value = Math.min(1, Math.max(0, Number(volume) || 0));
        if (this.audio !== null) {
          this.audio.volume = value;
          if (value > 0) this.audio.muted = false;
        }
        this.patch({ volume: value, muted: value === 0 ? this.snapshot.muted : false });
      }

      toggleMute() {
        const muted = !this.snapshot.muted;
        if (this.audio !== null) this.audio.muted = muted;
        this.patch({ muted });
      }

      /** Drop every record and stop the transport, keeping favorites. */
      clearShelf() {
        this.playToken += 1;
        this.records.clear();
        const audio = this.audio;
        if (audio !== null) {
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        }
        this.patch({
          shelf: [],
          query: '',
          searched: false,
          searching: false,
          searchError: '',
          record: null,
          partIndex: 0,
          status: 'idle',
          error: '',
          time: 0,
          duration: 0,
          playing: false,
        });
      }
    }

    const store = new RoomStore();

    /** Identity selector: keeps the subscription stable across renders. */
    const ENTIRE = (snapshot) => snapshot;

    /** Subscribe one component to a slice of the room snapshot. */
    function useRoom(select = ENTIRE) {
      const read = React.useCallback(() => select(store.getSnapshot()), [select]);
      return React.useSyncExternalStore(store.subscribe, read, read);
    }

    /** Re-render on locale changes and expose the current translator. */
    function useT() {
      const service = localeService;
      const subscribe = React.useCallback(
        (listener) => (service === null ? () => {} : service.subscribe(listener)),
        [service],
      );
      const revision = React.useSyncExternalStore(
        subscribe,
        () => (service === null ? 0 : service.getSnapshot().revision),
        () => (service === null ? 0 : service.getSnapshot().revision),
      );
      return React.useMemo(
        () => (key, params) => {
          void revision;
          return text(key, params);
        },
        [revision],
      );
    }

    //#region styles
    const STYLES = `
.vr-page{width:100%;min-width:0;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.55}
.vr-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.vr-body{max-width:1120px;margin:0 auto;padding:0 clamp(14px,2.6vw,30px) 34px}
.vr-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding-top:22px;margin-bottom:14px}
[data-platform=darwin] .vr-head{padding-top:calc(22px + var(--dsh-frame-top-clearance,0px))}
.vr-title{margin:0;font-size:19px;font-weight:600;line-height:26px;display:flex;align-items:center;gap:9px}
.vr-search{display:flex;align-items:center;gap:8px;flex:1 1 300px;max-width:470px}
.vr-field{position:relative;display:flex;flex:1;min-width:0}
.vr-field-icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);display:flex;color:var(--dsw-alias-label-secondary);pointer-events:none}
.vr-input{flex:1;min-width:0;height:36px;padding:0 12px 0 33px;border-radius:12px;border:2px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none;transition:border-color .15s,box-shadow .15s}
.vr-input::placeholder{color:var(--dsw-alias-label-secondary)}
.vr-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent)}
.vr-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:34px;padding:0 14px;border-radius:12px;border:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:transform .1s,background .15s,border-color .15s;white-space:nowrap;box-shadow:0 2px 0 var(--dsw-alias-border-l2)}
.vr-btn:hover{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.vr-btn:active{transform:translateY(2px);box-shadow:none}
.vr-btn:disabled{opacity:.5;cursor:default;transform:none}
.vr-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff;box-shadow:0 2px 0 color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,#000)}
.vr-btn-primary:hover{background:var(--dsw-alias-brand-primary);border-color:transparent;filter:brightness(1.06)}
.vr-btn-ghost{background:transparent;border-color:transparent;box-shadow:none;color:var(--dsw-alias-label-secondary);height:26px;padding:0 9px;font-size:12px;font-weight:500}
.vr-btn-ghost:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:transparent}

/* ================= photoreal turntable =================
   The deck is one inline SVG. Drawing the discs as real <circle> elements makes
   an oval impossible: a circle cannot be stretched by the CSS box model, a
   container's aspect ratio, or a missing aspect-ratio feature. The 3D look is a
   genuine perspective projection of the platter in the SVG itself, not a CSS
   transform that could fight the rotation animation. */
.vr-deck-area{position:relative;display:flex;flex-direction:column;align-items:center;gap:14px;padding:4px 0 22px;width:100%}
.vr-deck{position:relative;width:100%;max-width:560px;line-height:0}
.vr-deck svg{display:block;width:100%;height:auto;overflow:visible}
/* The tonearm is a <g> inside the SVG, rotated by rotate(angle, cx, cy). Its
   cursor and pointer handling live here; its geometry lives in the component so
   the pivot is expressed in the same user units as the drawing. */
.vr-arm{cursor:grab;touch-action:none;outline:none}
.vr-arm.vr-grabbing{cursor:grabbing}
.vr-arm:focus-visible{filter:drop-shadow(0 0 4px #7fd6ff)}
/* The record spins about its own centre. The transform-box property is what
   makes that true: without it, transform-origin resolves against the SVG
   viewBox, so a disc sitting off-centre in the canvas would orbit the canvas
   centre instead of spinning in place. The artwork is drawn around local (0,0),
   so the fill-box centre and the disc centre are the same point. */
.vr-disc-spin{transform-box:fill-box;transform-origin:center;will-change:transform;
  animation:vr-spin var(--vr-period,1.8s) linear infinite;animation-play-state:paused}
.vr-disc-spin.vr-on{animation-play-state:running}
/* the drop target is an SVG circle, so it is round by definition */
.vr-drop-target{cursor:pointer;outline:none}
.vr-drop-ring{opacity:0;transition:opacity .16s}
.vr-drop-target.vr-drop .vr-drop-ring{opacity:1}
.vr-drop-target:focus-visible .vr-drop-ring{opacity:1}
/* platter and record lighting respond to transport state */
.vr-hw-btn{font-family:inherit}
.vr-hw-btn:hover{filter:brightness(1.18)}
.vr-hw-btn:active{filter:brightness(.92)}
.vr-knob-hit{cursor:pointer;outline:none}
.vr-knob-hit:focus-visible{filter:drop-shadow(0 0 3px #7fd6ff)}
@keyframes vr-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.vr-disc-spin{animation:none}.vr-arm{transition:none}}
/* now playing strip under the deck */
.vr-plate-info{position:relative;text-align:center;min-height:40px;width:100%;max-width:520px}
.vr-plate-title{font-size:15px;font-weight:700;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vr-plate-sub{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* transport: secondary keys on the left, the play/pause key pinned to the right */
.vr-transport{position:relative;display:flex;align-items:center;width:100%;max-width:520px;gap:8px}
.vr-transport-seek{flex:1;min-width:0;display:flex;align-items:center;gap:9px;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.vr-keys{display:flex;align-items:center;gap:8px;flex:none}
.vr-play{display:grid;place-items:center;cursor:pointer;flex:none;width:52px;height:52px;border-radius:50%;
  color:#fff;background:var(--dsw-alias-brand-primary);border:2px solid #2b2118;
  box-shadow:0 4px 0 color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,#000);
  transition:transform .1s,box-shadow .1s,filter .15s}
.vr-play:hover:not(:disabled){filter:brightness(1.07)}
.vr-play:active:not(:disabled){transform:translateY(4px);box-shadow:none}
.vr-play:disabled{opacity:.4;cursor:default;transform:none}
.vr-play:focus-visible{outline:3px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.vr-key{display:grid;place-items:center;border-radius:50%;cursor:pointer;width:36px;height:36px;
  color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);
  border:2px solid var(--dsw-alias-border-l2);box-shadow:0 3px 0 var(--dsw-alias-border-l2);
  transition:transform .1s,box-shadow .1s,filter .15s}
.vr-key:hover:not(:disabled){filter:brightness(1.06)}
.vr-key:active:not(:disabled){transform:translateY(3px);box-shadow:none}
.vr-key:disabled{opacity:.4;cursor:default;transform:none}
/* the seek bar: a draggable track with three layers — played (brand colour),
   buffered-but-unplayed (grey), and not-yet-loaded (the base track). The fills
   are one gradient sized from --vr-progress and --vr-buffered, so they follow the
   thumb while dragging without re-laying out the element. */
.vr-progress{display:flex;align-items:center;gap:9px;width:100%;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.vr-range{appearance:none;-webkit-appearance:none;flex:1;min-width:0;height:22px;margin:0;background:transparent;outline:none;cursor:pointer;touch-action:none}
.vr-range::-webkit-slider-runnable-track{height:6px;border-radius:99px;
  background:linear-gradient(to right,
    var(--dsw-alias-brand-primary,#4f8cff) 0,
    var(--dsw-alias-brand-primary,#4f8cff) var(--vr-progress,0%),
    color-mix(in srgb,var(--dsw-alias-label-secondary,#8b93a7) 45%,transparent) var(--vr-progress,0%),
    color-mix(in srgb,var(--dsw-alias-label-secondary,#8b93a7) 45%,transparent) var(--vr-buffered,0%),
    var(--dsw-alias-border-l1,rgba(139,147,167,.28)) var(--vr-buffered,0%),
    var(--dsw-alias-border-l1,rgba(139,147,167,.28)) 100%)}
.vr-range::-moz-range-track{height:6px;border-radius:99px;background:var(--dsw-alias-border-l1,rgba(139,147,167,.28))}
.vr-range::-moz-range-progress{height:6px;border-radius:99px;background:var(--dsw-alias-brand-primary,#4f8cff)}
.vr-range::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:15px;height:15px;margin-top:-4.5px;border-radius:50%;background:#fff;border:3px solid var(--dsw-alias-brand-primary);box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .12s}
.vr-range::-moz-range-thumb{width:15px;height:15px;border-radius:50%;background:#fff;border:3px solid var(--dsw-alias-brand-primary)}
.vr-range:hover::-webkit-slider-thumb{transform:scale(1.12)}
.vr-range:active::-webkit-slider-thumb{transform:scale(1.25)}
.vr-range:disabled{cursor:default;opacity:.55}
.vr-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent),0 1px 3px rgba(0,0,0,.4)}
.vr-hint{position:relative;font-size:11.5px;color:var(--dsw-alias-label-secondary);text-align:center;display:flex;align-items:center;justify-content:center;gap:6px;min-width:0;width:100%;max-width:520px}
.vr-hint span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ---------- record shelves underneath the deck ---------- */
.vr-shelves{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:start}
@media (width<=820px){.vr-shelves{grid-template-columns:minmax(0,1fr)}}
.vr-rail{position:relative;min-width:0;display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:16px;
  border:2px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);transition:border-color .15s,background .15s}
/* a shelf accepting a dragged record announces itself */
.vr-rail.vr-drop-target{border-color:var(--dsw-alias-brand-primary);border-style:dashed;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,var(--dsw-alias-bg-layer-1))}
.vr-rail-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.vr-rail-title{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:700;min-width:0}
.vr-rail-count{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary);white-space:nowrap}
/* the grid must not clip a hovered card, so no overflow here; the rail scrolls instead */
.vr-rail-scroll{position:relative;min-width:0}
.vr-rail-grid{position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:10px;padding:3px}
.vr-rail-empty{padding:22px 12px;text-align:center;border:2px dashed var(--dsw-alias-border-l1);border-radius:12px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7}
.vr-rail-empty strong{display:block;color:var(--dsw-alias-label-primary);font-weight:700;margin-bottom:3px;font-size:12.5px}

/* one cartoon sleeve; hover swells it and lifts it above the surrounding cards */
.vr-card{position:relative;z-index:1;display:flex;flex-direction:column;gap:5px;padding:0;border:none;background:none;color:inherit;font:inherit;text-align:left;cursor:grab;min-width:0;border-radius:12px;transition:transform .16s cubic-bezier(.2,.9,.25,1);transform-origin:center}
.vr-card:hover,.vr-card:focus-visible{transform:scale(1.1);z-index:50}
.vr-card:focus-visible{outline:none}
.vr-card:active{cursor:grabbing}
.vr-card.vr-dragging{opacity:.4}
/* square sleeve: a record is a square object, not a rounded rectangle */
.vr-card-art{position:relative;aspect-ratio:1;border-radius:3px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);
  border:2px solid var(--dsw-alias-border-l2);box-shadow:0 3px 0 var(--dsw-alias-border-l2)}
.vr-card:hover .vr-card-art,.vr-card:focus-visible .vr-card-art{box-shadow:0 8px 18px -8px rgba(0,0,0,.55),0 3px 0 var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.vr-card.vr-playing .vr-card-art{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent),0 3px 0 var(--dsw-alias-brand-primary)}
.vr-card-art img{width:100%;height:100%;object-fit:cover;display:block}
.vr-card-title{font-size:11px;line-height:1.3;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.vr-card-sub{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vr-badge{position:absolute;left:4px;top:4px;height:17px;padding:0 6px;border-radius:99px;background:#EF476F;color:#fff;font-size:9.5px;font-weight:700;line-height:17px;display:grid;place-items:center;max-width:calc(100% - 8px);overflow:hidden;white-space:nowrap}
/* the heart: optically centred, so the glyph and its plate share one box */
.vr-heart{position:absolute;right:4px;top:4px;width:22px;height:22px;padding:0;display:flex;align-items:center;justify-content:center;line-height:0;border-radius:50%;background:rgba(255,255,255,.92);border:2px solid var(--dsw-alias-border-l2);color:#8c8c8c;cursor:pointer;opacity:0;transition:opacity .14s,color .14s,transform .14s,scale .14s}
.vr-heart svg{display:block;flex:none}
.vr-card:hover .vr-heart,.vr-heart.vr-on,.vr-heart:focus-visible{opacity:1}
.vr-heart:hover{scale:1.12;color:#EF476F}
.vr-heart.vr-on{color:#EF476F;border-color:#EF476F}
.vr-fallback{display:grid;place-items:center;width:100%;height:100%;font-size:22px;font-weight:700;color:var(--dsw-alias-label-secondary)}

/* ---------- notices ---------- */
.vr-msg{padding:9px 12px;border-radius:12px;font-size:12.5px;display:flex;align-items:center;gap:10px;margin-bottom:12px;border:2px solid transparent}
.vr-msg-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 34%,transparent);color:var(--dsw-alias-state-error-primary)}

/* ---------- tracks of a multi-part record ---------- */
.vr-tracks{position:relative;width:100%;max-width:520px;border-radius:14px;border:2px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);padding:10px 12px}
.vr-tracks-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:0 2px 6px}
.vr-track-list{display:flex;flex-direction:column;gap:1px;max-height:180px;overflow:auto;scrollbar-gutter:stable}
.vr-track{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;border:none;background:none;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer;transition:background .14s}
.vr-track:hover{background:var(--dsw-alias-bg-layer-2)}
.vr-track.vr-on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.vr-track-index{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}
.vr-track-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vr-track-time{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}

/* ---------- sidebar transport control ---------- */
.vr-side{position:relative;display:grid;place-items:center;width:100%;height:100%}
.vr-side-toggle{position:absolute;right:-4px;bottom:-4px;width:15px;height:15px;display:grid;place-items:center;border-radius:50%;
  background:var(--dsw-alias-brand-primary);color:#fff;border:1.5px solid var(--dsw-alias-bg-base);
  cursor:pointer;padding:0;transition:transform .12s,filter .12s}
.vr-side-toggle:hover{transform:scale(1.15);filter:brightness(1.1)}
.vr-side-toggle:active{transform:scale(.95)}
.vr-side-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.vr-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
`;

    /** Mount this plugin's stylesheet beside the components that use it. */
    function Styles() {
      return h('style', { 'data-vinyl-room': 'styles' }, STYLES);
    }
    //#endregion

    //#region icons
    const glyph = (props, children) =>
      h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: props.size ?? 18,
          height: props.size ?? 18,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: props.weight ?? 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: props.style,
        },
        children,
      );

    const IconDisc = (props) =>
      glyph(props, [h('circle', { key: 'c', cx: 12, cy: 12, r: 8.6 }), h('circle', { key: 'h', cx: 12, cy: 12, r: 2.2 })]);

    const IconPlay = (props) => glyph(props, h('path', { d: 'M8 5.4v13.2l11.2-6.6Z', fill: 'currentColor', stroke: 'none' }));

    const IconPause = (props) =>
      glyph(props, [
        h('rect', { key: 'a', x: 7.4, y: 5.4, width: 3.6, height: 13.2, rx: 1.2, fill: 'currentColor', stroke: 'none' }),
        h('rect', { key: 'b', x: 13, y: 5.4, width: 3.6, height: 13.2, rx: 1.2, fill: 'currentColor', stroke: 'none' }),
      ]);

    const IconStop = (props) =>
      glyph(props, h('rect', { x: 6.6, y: 6.6, width: 10.8, height: 10.8, rx: 2, fill: 'currentColor', stroke: 'none' }));

    const IconReplay = (props) =>
      glyph(props, [
        h('path', { key: 'a', d: 'M20 12a8 8 0 1 1-2.4-5.7' }),
        h('path', { key: 'b', d: 'M20 3.8v4.6h-4.6' }),
      ]);

    const IconNext = (props) =>
      glyph(props, [
        h('path', { key: 'a', d: 'M6 6.4v11.2l8.4-5.6Z', fill: 'currentColor', stroke: 'none' }),
        h('path', { key: 'b', d: 'M17.4 5.8v12.4' }),
      ]);

    const IconPrev = (props) =>
      glyph(props, [
        h('path', { key: 'a', d: 'M18 6.4v11.2l-8.4-5.6Z', fill: 'currentColor', stroke: 'none' }),
        h('path', { key: 'b', d: 'M6.6 5.8v12.4' }),
      ]);

    const IconSearch = (props) =>
      glyph(props, [h('circle', { key: 'a', cx: 11, cy: 11, r: 6.6 }), h('path', { key: 'b', d: 'M15.9 15.9 20.2 20.2' })]);

    const IconShelf = (props) =>
      glyph(props, [
        h('path', { key: 'a', d: 'M4 4h6.6v16H4z' }),
        h('path', { key: 'b', d: 'M13.4 4H20v16h-6.6z' }),
      ]);

    const IconHeart = (props) =>
      glyph(props, h('path', {
        key: 'h',
        d: 'M12 20.4 4.5 13a4.7 4.7 0 0 1 6.6-6.6l.9.9.9-.9A4.7 4.7 0 0 1 19.5 13Z',
        fill: props.filled === true ? 'currentColor' : 'none',
      }));

    /**
     * Sidebar panel glyph. It doubles as the transport control the panel no
     * longer floats over the page: a record that spins while playing, with a
     * play/pause badge in its corner. The badge stops the click so pressing it
     * toggles the music instead of navigating away.
     */
    function PanelIcon(props) {
      const snapshot = useRoom();
      const size = props.size ?? 18;
      const hasRecord = snapshot.record !== null;
      const playing = snapshot.playing;
      const label = playing ? translate('pause') : translate('play');
      return h(
        'span',
        { className: 'vr-side' },
        h(
          'svg',
          { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true },
          h('circle', {
            cx: 11,
            cy: 12,
            r: 8,
            stroke: 'currentColor',
            strokeWidth: 1.9,
            fill: hasRecord ? 'currentColor' : 'none',
            fillOpacity: hasRecord ? 0.16 : 0,
          }),
          h('circle', { cx: 11, cy: 12, r: 1.6, fill: 'currentColor' }),
          h('path', { d: 'M18.6 4.4v5.4', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }),
          h('circle', { cx: 18.6, cy: 4.4, r: 1.5, fill: 'currentColor' }),
        ),
        hasRecord
          ? h(
              'span',
              {
                className: 'vr-side-toggle',
                role: 'button',
                tabIndex: 0,
                'aria-label': label,
                title: label,
                'data-vinyl-room-toggle': 'true',
                onClick: (event) => {
                  // The sidebar row's own handler navigates; this badge must not.
                  event.preventDefault();
                  event.stopPropagation();
                  store.toggle();
                },
                onPointerDown: (event) => event.stopPropagation(),
                onKeyDown: (event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  event.stopPropagation();
                  store.toggle();
                },
              },
              h(playing ? IconPause : IconPlay, { size: 9, weight: 3 }),
            )
          : null,
      );
    }
    //#endregion

    /** One cover image that degrades to the record's initial. */
    function Cover(props) {
      const [failed, setFailed] = React.useState(false);
      React.useEffect(() => setFailed(false), [props.src]);
      if (props.src === '' || failed) {
        return h('span', { className: props.fallbackClassName ?? 'vr-fallback' }, initial(props.fallback));
      }
      return h('img', { src: props.src, alt: '', loading: 'lazy', draggable: false, onError: () => setFailed(true) });
    }

    /** MIME type carrying a dragged record's identity between a shelf and the deck. */
    const DRAG_TYPE = 'application/x-vinyl-record';
    /** Accept a row from either shelf as a drop payload. */
    const readDropPayload = (dataTransfer) => {
      if (dataTransfer === null || dataTransfer === undefined) return '';
      const custom = dataTransfer.getData(DRAG_TYPE);
      if (custom !== '') return custom;
      const plain = dataTransfer.getData('text/plain');
      return /^BV[0-9A-Za-z]{10}$/.test(plain) ? plain : '';
    };

    /**
     * The cartoon turntable. A flat, boldly outlined deck holds a round record.
     * The tonearm is the transport: drag it onto the record to play, lift it
     * back onto its rest to pause.
     */
    /**
     * A photoreal turntable drawn as one inline SVG.
     *
     * Every disc is a real <circle>, so it is round by construction — no CSS box
     * rule can stretch it. The 3D read comes from a true perspective projection
     * of two ellipses (plinth top, platter rim), layered gradients for brushed
     * metal and vinyl grooves, and a projected shadow instead of a CSS one.
     */
    function Turntable(props) {
      const [angle, setAngle] = React.useState(ARM_REST);
      const [grabbing, setGrabbing] = React.useState(false);
      /**
       * A cover that fails to decode must not leave the browser's broken-image
       * glyph on the label. When this flips, the label falls back to the record's
       * initial — and it resets whenever the artwork address changes, so a track
       * with a working cover is never stuck on the fallback.
       */
      const [coverFailed, setCoverFailed] = React.useState(false);
      const drag = React.useRef(null);
      /** The SVG root: the pointer is mapped through its screen matrix. */
      const svgRef = React.useRef(null);

      React.useEffect(() => {
        setCoverFailed(false);
      }, [props.cover]);

      const restingAngle = props.playing ? ARM_PLAY : ARM_REST;
      React.useEffect(() => {
        if (drag.current === null) setAngle(restingAngle);
      }, [restingAngle]);

      /**
       * The rotation that points the arm at the pointer, in degrees.
       *
       * The pivot is known in SVG user units, so the pointer is converted into
       * the same space through the element's own screen matrix. That keeps the
       * maths correct at any render size, and removes the previous dependence on
       * a DOM box whose centre was not the pivot at all.
       */
      const angleOf = (event) => {
        const svg = svgRef.current;
        if (svg === null || svg === undefined) return angle;
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const matrix = svg.getScreenCTM();
        if (matrix === null) return angle;
        const local = point.matrixTransform(matrix.inverse());
        // Straight below the pivot is 0deg; positive rotation swings left.
        const degrees = (Math.atan2(PIVOT.x - local.x, local.y - PIVOT.y) * 180) / Math.PI;
        return Math.min(ARM_MAX, Math.max(ARM_MIN, degrees));
      };

      const release = (event, commit) => {
        const state = drag.current;
        if (state === null || state === undefined) return;
        if (event?.currentTarget?.hasPointerCapture?.(state.id)) {
          event.currentTarget.releasePointerCapture(state.id);
        }
        drag.current = null;
        setGrabbing(false);
        if (!commit) {
          setAngle(restingAngle);
          return;
        }
        const engaged = state.angle >= ARM_ENGAGED;
        setAngle(engaged ? ARM_PLAY : ARM_REST);
        props.onEngage(engaged);
      };

      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const next = angleOf(event);
        drag.current = { id: event.pointerId, angle: next };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setGrabbing(true);
        setAngle(next);
      };

      const onPointerMove = (event) => {
        const state = drag.current;
        if (state === null || state === undefined || state.id !== event.pointerId) return;
        const next = angleOf(event);
        state.angle = next;
        setAngle(next);
      };

      const onKeyDown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        props.onEngage(!props.playing);
      };

      const armed = props.armed;
      const playing = props.playing;

      return h(
        'div',
        { className: 'vr-deck' },
        h(
          'svg',
          {
            ref: svgRef,
            viewBox: `0 0 ${W} ${H}`,
            role: 'img',
            'aria-label': `${props.title}`,
            preserveAspectRatio: 'xMidYMid meet',
          },
          // ---- shared paint: brushed metal, vinyl, plinth, light ----
          h(
            'defs',
            { key: 'defs' },
            h(
              'linearGradient',
              { id: 'vr-wood', x1: '0', y1: '0', x2: '0.35', y2: '1' },
              h('stop', { offset: '0', stopColor: '#6b4a30' }),
              h('stop', { offset: '0.34', stopColor: '#57391f' }),
              h('stop', { offset: '0.68', stopColor: '#3f2814' }),
              h('stop', { offset: '1', stopColor: '#2a1a0d' }),
            ),
            h(
              'linearGradient',
              { id: 'vr-wood-top', x1: '0', y1: '0', x2: '0.2', y2: '1' },
              h('stop', { offset: '0', stopColor: '#8a6340' }),
              h('stop', { offset: '0.5', stopColor: '#6d4830' }),
              h('stop', { offset: '1', stopColor: '#4a2f1b' }),
            ),
            h(
              'linearGradient',
              { id: 'vr-metal', x1: '0', y1: '0', x2: '1', y2: '1' },
              h('stop', { offset: '0', stopColor: '#f2f3f5' }),
              h('stop', { offset: '0.22', stopColor: '#9ba1a8' }),
              h('stop', { offset: '0.44', stopColor: '#e6e9ec' }),
              h('stop', { offset: '0.62', stopColor: '#767d85' }),
              h('stop', { offset: '0.82', stopColor: '#c9cfd5' }),
              h('stop', { offset: '1', stopColor: '#5d646b' }),
            ),
            h(
              'radialGradient',
              { id: 'vr-platter', cx: '0.38', cy: '0.3', r: '0.78' },
              h('stop', { offset: '0', stopColor: '#cfd4d9' }),
              h('stop', { offset: '0.42', stopColor: '#8d949b' }),
              h('stop', { offset: '0.72', stopColor: '#5a6067' }),
              h('stop', { offset: '1', stopColor: '#33383d' }),
            ),
            h(
              'radialGradient',
              { id: 'vr-vinyl', cx: '0.36', cy: '0.26', r: '0.82' },
              h('stop', { offset: '0', stopColor: '#2b2c31' }),
              h('stop', { offset: '0.55', stopColor: '#141519' }),
              h('stop', { offset: '0.88', stopColor: '#0a0a0d' }),
              h('stop', { offset: '1', stopColor: '#17181c' }),
            ),
            h(
              'radialGradient',
              { id: 'vr-label-paper', cx: '0.34', cy: '0.28', r: '0.8' },
              h('stop', { offset: '0', stopColor: '#f6d9a8' }),
              h('stop', { offset: '0.5', stopColor: '#e0b06a' }),
              h('stop', { offset: '1', stopColor: '#b8823f' }),
            ),
            h(
              'radialGradient',
              { id: 'vr-sheen', cx: '0.5', cy: '0.5', r: '0.5' },
              h('stop', { offset: '0.3', stopColor: '#ffffff', stopOpacity: '0' }),
              h('stop', { offset: '0.62', stopColor: '#ffffff', stopOpacity: '0.16' }),
              h('stop', { offset: '0.78', stopColor: '#ffffff', stopOpacity: '0.04' }),
              h('stop', { offset: '1', stopColor: '#ffffff', stopOpacity: '0' }),
            ),
            h(
              'radialGradient',
              { id: 'vr-vignette', cx: '0.5', cy: '0.45', r: '0.62' },
              h('stop', { offset: '0.55', stopColor: '#000000', stopOpacity: '0' }),
              h('stop', { offset: '1', stopColor: '#000000', stopOpacity: '0.42' }),
            ),
            h(
              'linearGradient',
              { id: 'vr-tube', x1: '0', y1: '0', x2: '1', y2: '0' },
              h('stop', { offset: '0', stopColor: '#6f767d' }),
              h('stop', { offset: '0.3', stopColor: '#eef1f3' }),
              h('stop', { offset: '0.55', stopColor: '#aab1b8' }),
              h('stop', { offset: '1', stopColor: '#5a6167' }),
            ),
            h(
              'filter',
              { id: 'vr-grain', x: '0', y: '0', width: '100%', height: '100%' },
              h('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.85', numOctaves: '3', seed: '7', result: 'noise' }),
              h('feColorMatrix', {
                in: 'noise',
                type: 'matrix',
                values: '0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.055 0',
              }),
            ),
            h(
              'filter',
              { id: 'vr-shadow', x: '-30%', y: '-30%', width: '160%', height: '160%' },
              h('feGaussianBlur', { stdDeviation: '10' }),
            ),
            // the plinth casts a soft shadow onto the page
            h(
              'filter',
              { id: 'vr-cast', x: '-20%', y: '-20%', width: '140%', height: '150%' },
              h('feGaussianBlur', { stdDeviation: '7' }),
            ),
            h(
              'linearGradient',
              { id: 'vr-tube2', x1: '0', y1: '0', x2: '1', y2: '0' },
              h('stop', { offset: '0', stopColor: '#606770' }),
              h('stop', { offset: '0.34', stopColor: '#f4f6f8' }),
              h('stop', { offset: '0.62', stopColor: '#9aa1a8' }),
              h('stop', { offset: '1', stopColor: '#4e555c' }),
            ),
          ),

          // ---- the shadow the cabinet throws on the page surface ----
          h('rect', {
            key: 'cast',
            x: 60,
            y: H - 34,
            width: W - 120,
            height: 22,
            rx: 11,
            fill: '#000',
            opacity: '0.32',
            filter: 'url(#vr-cast)',
          }),

          /* ================= FRONT VIEW =================
             The deck is seen straight on: the plinth is an upright rectangle and
             both the platter and the record are true circles. No perspective
             projection is applied, so nothing scales one axis differently from
             the other and a circle cannot become an ellipse. The cabinet is
             sized from CABINET, and the platter fits inside it with margin. */

          // ---- the plinth: an upright wooden cabinet with a lit top edge ----
          h('rect', {
            key: 'plinth',
            x: CABINET.x,
            y: CABINET.y,
            width: CABINET.w,
            height: CABINET.h,
            rx: 26,
            fill: 'url(#vr-wood)',
            stroke: '#1b1108',
            strokeOpacity: '0.55',
            strokeWidth: '2',
          }),
          // the top face catching the light, clipped to the cabinet's rounding
          h('rect', { key: 'plinth-topface', x: CABINET.x, y: CABINET.y, width: CABINET.w, height: 52, rx: 26, fill: 'url(#vr-wood-top)' }),
          h('rect', { key: 'topface-mask', x: CABINET.x, y: CABINET.y + 38, width: CABINET.w, height: 14, fill: 'url(#vr-wood)' }),
          // brushed grain over the whole cabinet
          h('rect', { key: 'grain', x: CABINET.x, y: CABINET.y, width: CABINET.w, height: CABINET.h, rx: 26, fill: 'url(#vr-grain)', opacity: '0.5' }),
          // the chrome trim that separates the top face from the front
          h('rect', { key: 'lip', x: CABINET.x, y: CABINET.y + 52, width: CABINET.w, height: 9, fill: 'url(#vr-metal)', opacity: '0.8' }),
          // the cabinet's front edge highlight
          h('rect', { key: 'edge', x: CABINET.x + 3, y: CABINET.y + 4, width: CABINET.w - 6, height: CABINET.h - 8, rx: 23, fill: 'none', stroke: '#ffffff', strokeOpacity: '0.1', strokeWidth: '1.2' }),

          // ---- platter: a true circle, centred on (250,236) ----
          h('circle', { key: 'platter-shadow', cx: PLATTER.cx, cy: PLATTER.cy + 10, r: PLATTER.r + 2, fill: '#000', opacity: '0.4', filter: 'url(#vr-shadow)' }),
          h('circle', { key: 'platter-rim', cx: PLATTER.cx, cy: PLATTER.cy, r: PLATTER.r, fill: 'url(#vr-platter)' }),
          h('circle', {
            key: 'platter-rim-line',
            cx: PLATTER.cx,
            cy: PLATTER.cy,
            r: PLATTER.r,
            fill: 'none',
            stroke: '#eef1f4',
            strokeOpacity: '0.55',
            strokeWidth: '1.6',
          }),
          h('circle', { key: 'platter-inner', cx: PLATTER.cx, cy: PLATTER.cy, r: PLATTER.r - 8, fill: '#22262a' }),
          // the felt mat the record rests on
          h('circle', { key: 'mat', cx: PLATTER.cx, cy: PLATTER.cy, r: RECORD_R, fill: '#191817' }),
          h('circle', { key: 'mat-edge', cx: PLATTER.cx, cy: PLATTER.cy, r: RECORD_R, fill: 'none', stroke: '#000', strokeOpacity: '0.5', strokeWidth: '2' }),

          // ---- the record: a true circle, drawn around its own centre ----
          h(
            'g',
            { key: 'deck-disc', transform: `translate(${PLATTER.cx},${PLATTER.cy})` },
            h(
              'g',
              {
                className: `vr-disc-spin${playing ? ' vr-on' : ''}`,
                style: { '--vr-period': props.speed === 45 ? '1.33s' : '1.8s' },
              },
              // vinyl body
              h('circle', { cx: 0, cy: 0, r: RECORD_R, fill: 'url(#vr-vinyl)' }),
              // groove rings: many thin circles read as a pressed disc
              ...Array.from({ length: 18 }, (_, index) =>
                h('circle', {
                  key: `g${index}`,
                  cx: 0,
                  cy: 0,
                  r: 146 - index * 6.4,
                  fill: 'none',
                  stroke: '#3a3b42',
                  strokeOpacity: index % 2 === 0 ? '0.55' : '0.28',
                  strokeWidth: index % 2 === 0 ? '0.7' : '0.45',
                }),
              ),
              // the run-out area and the paper label
              h('circle', { cx: 0, cy: 0, r: 58, fill: '#0d0e11' }),
              h('circle', { cx: 0, cy: 0, r: 55, fill: 'url(#vr-label-paper)' }),
              /* The artwork, printed on the paper label. It is drawn as a pattern
                 fill rather than an <image> + clipPath: an SVG image with a
                 relative href is resolved differently across browsers, and a
                 clipPath in objectBoundingBox units shifts when the element is
                 offset inside a rotating group. A pattern is anchored to the
                 circle's own geometry, so it clips exactly to the label and turns
                 with the disc. */
              props.cover === '' || coverFailed
                ? h(
                    'text',
                    {
                      x: 0,
                      y: 6,
                      textAnchor: 'middle',
                      fill: '#6b4a1c',
                      fontSize: '20',
                      fontWeight: '700',
                      style: { pointerEvents: 'none', userSelect: 'none' },
                    },
                    initial(props.title),
                  )
                : [
                    h(
                      'pattern',
                      {
                        key: 'label-pattern',
                        id: 'vr-label-art',
                        // user-space units: the tile is exactly the label's size,
                        // so the artwork is drawn once at a predictable scale.
                        // objectBoundingBox would multiply the image's own width by
                        // the label's, blowing the picture up by two orders of
                        // magnitude.
                        patternUnits: 'userSpaceOnUse',
                        x: -55,
                        y: -55,
                        width: 110,
                        height: 110,
                      },
                      h('image', {
                        href: props.cover,
                        x: -55,
                        y: -55,
                        width: 110,
                        height: 110,
                        preserveAspectRatio: 'xMidYMid slice',
                        // A decoding failure must not paint a broken-image glyph on
                        // the label; this swaps in the record's initial instead.
                        onError: () => setCoverFailed(true),
                      }),
                    ),
                    h('circle', { key: 'label-art', cx: 0, cy: 0, r: 55, fill: 'url(#vr-label-art)' }),
                  ],
              h('circle', { cx: 0, cy: 0, r: 55, fill: 'none', stroke: '#8a5c28', strokeOpacity: '0.55', strokeWidth: '0.8' }),
              // label print: an inner rule and the centre hole
              h('circle', { cx: 0, cy: 0, r: 42, fill: 'none', stroke: '#7a4f21', strokeOpacity: '0.35', strokeWidth: '0.6' }),
              h('circle', { cx: 0, cy: 0, r: 5, fill: '#1a1a1d' }),
              // light travelling across the grooves
              h('circle', { cx: 0, cy: 0, r: RECORD_R, fill: 'url(#vr-sheen)', style: { pointerEvents: 'none' } }),
            ),
          ),
          // the spindle, drawn as a front-view boss on top of the record
          h('circle', { key: 'spindle-base', cx: PLATTER.cx, cy: PLATTER.cy, r: 7, fill: '#dfe3e6' }),
          h('circle', { key: 'spindle-inner', cx: PLATTER.cx, cy: PLATTER.cy, r: 4.2, fill: '#aeb4b9' }),
          h('circle', { key: 'spindle-hole', cx: PLATTER.cx, cy: PLATTER.cy, r: 2, fill: '#33373b' }),

          // the drop target: a true circle over the record, no projection
          h('circle', {
            key: 'drop',
            className: `vr-drop-target${props.dropActive ? ' vr-drop' : ''}`,
            cx: PLATTER.cx,
            cy: PLATTER.cy,
            r: RECORD_R,
            fill: 'transparent',
            role: 'button',
            tabIndex: armed ? 0 : -1,
            'aria-label': `${armed ? (playing ? props.pauseLabel : props.playLabel) : props.emptyLabel}: ${props.title}`,
            onClick: () => {
              if (armed) props.onToggle();
            },
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              if (armed) props.onToggle();
            },
            onDragOver: (event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              if (!props.dropActive) props.onDropActive(true);
            },
            onDragLeave: () => props.onDropActive(false),
            onDrop: (event) => {
              event.preventDefault();
              props.onDropActive(false);
              const bvid = readDropPayload(event.dataTransfer);
              if (bvid !== '') props.onDrop(bvid);
            },
          }),
          h('circle', {
            key: 'drop-ring',
            className: 'vr-drop-ring',
            cx: PLATTER.cx,
            cy: PLATTER.cy,
            r: PLATTER.r - 8,
            fill: 'none',
            stroke: '#7fd6ff',
            strokeWidth: '3',
            strokeDasharray: '10 7',
            style: { pointerEvents: 'none' },
          }),

          // ---- tonearm base, seen straight on. Its centre IS the pivot, so the
          //      rotating collar and its housing never drift apart ----
          h('circle', { key: 'arm-base-shadow', cx: PIVOT.x, cy: PIVOT.y + 8, r: 40, fill: '#000', opacity: '0.4', filter: 'url(#vr-shadow)' }),
          h('circle', { key: 'arm-base', cx: PIVOT.x, cy: PIVOT.y, r: 38, fill: 'url(#vr-metal)' }),
          h('circle', { key: 'arm-base-in', cx: PIVOT.x, cy: PIVOT.y, r: 26, fill: '#2e3236' }),
          h('circle', { key: 'arm-base-boss', cx: PIVOT.x, cy: PIVOT.y, r: 13, fill: 'url(#vr-metal)' }),
          h('circle', { key: 'arm-base-hole', cx: PIVOT.x, cy: PIVOT.y, r: 5, fill: '#23272b' }),
          // the counterweight, stacked above the pivot on the same vertical axis
          h('circle', { key: 'arm-cw', cx: PIVOT.x, cy: PIVOT.y - 54, r: 19, fill: 'url(#vr-metal)' }),
          h('circle', { key: 'arm-cw-top', cx: PIVOT.x, cy: PIVOT.y - 54, r: 11, fill: '#3b4045' }),

          /* ---- deck hardware. It lives in the band BELOW the disc, so no control
             is ever drawn over the record, and every piece stays inside the
             cabinet's inner margin. ---- */
          h(
            'g',
            { key: 'speed', className: 'vr-hw-btn', role: 'group', 'aria-label': props.speedLabel },
            h('rect', {
              x: CONTROLS.speed.x,
              y: CONTROLS.y,
              width: CONTROLS.speed.w,
              height: 26,
              rx: 8,
              fill: '#2b2f33',
              stroke: '#14171a',
              strokeWidth: '1.4',
            }),
            ...[33, 45].map((value, index) =>
              h(
                'g',
                {
                  key: value,
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': `${props.speedLabel} ${value}`,
                  'aria-pressed': props.speed === value,
                  onClick: () => props.onSpeed(value),
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    props.onSpeed(value);
                  },
                  style: { cursor: 'pointer' },
                },
                h('rect', {
                  x: CONTROLS.speed.x + 4 + index * 43,
                  y: CONTROLS.y + 3,
                  width: 39,
                  height: 20,
                  rx: 6,
                  fill: props.speed === value ? 'url(#vr-metal)' : '#1c1f22',
                  stroke: props.speed === value ? '#dfe3e6' : '#0d0f11',
                  strokeWidth: '1',
                }),
                h(
                  'text',
                  {
                    x: CONTROLS.speed.x + 23.5 + index * 43,
                    y: CONTROLS.y + 17,
                    textAnchor: 'middle',
                    fill: props.speed === value ? '#1b1e21' : '#8c9298',
                    fontSize: '11',
                    fontWeight: '700',
                    style: { pointerEvents: 'none', userSelect: 'none' },
                  },
                  String(value),
                ),
              ),
            ),
          ),
          h(
            'g',
            {
              key: 'knob',
              className: 'vr-knob-hit',
              role: 'button',
              tabIndex: 0,
              'aria-label': `${props.volumeLabel} ${Math.round((props.muted ? 0 : props.volume) * 100)}%`,
              onClick: () => props.onMute(),
              onWheel: (event) => {
                event.preventDefault();
                props.onVolume((props.muted ? 0 : props.volume) + (event.deltaY < 0 ? 0.05 : -0.05));
              },
              style: { cursor: 'pointer' },
            },
            h('circle', { cx: CONTROLS.knob.x, cy: CONTROLS.y + 19, r: CONTROLS.knob.r + 1, fill: '#000', opacity: '0.4', filter: 'url(#vr-shadow)' }),
            h('circle', { cx: CONTROLS.knob.x, cy: CONTROLS.y + 13, r: CONTROLS.knob.r, fill: 'url(#vr-metal)' }),
            h('circle', { cx: CONTROLS.knob.x, cy: CONTROLS.y + 13, r: CONTROLS.knob.r - 7, fill: '#2a2e32' }),
            h('rect', {
              x: CONTROLS.knob.x - 1.6,
              y: CONTROLS.y,
              width: 3.2,
              height: 12,
              rx: 1.6,
              fill: '#e8ecef',
              // the pointer turns about the knob's own centre
              transform: `rotate(${Math.round((props.muted ? 0 : props.volume) * 300 - 150)} ${CONTROLS.knob.x} ${CONTROLS.y + 13})`,
            }),
          ),

          // a soft vignette on the housing, so the deck sits in its own light
          h('rect', {
            key: 'vignette',
            x: CABINET.x,
            y: CABINET.y,
            width: CABINET.w,
            height: CABINET.h,
            rx: 26,
            fill: 'url(#vr-vignette)',
            style: { pointerEvents: 'none' },
          }),

          /* ---- the tonearm, drawn in the SVG so its pivot is exact ----
             rotate(angle, PIVOT.x, PIVOT.y) names the centre of rotation
             explicitly, in the same user space as the drawing. The arm therefore
             turns about the pivot at any render size, with no dependence on a DOM
             box whose centre was previously somewhere else. */
          h(
            'g',
            {
              key: 'arm',
              className: `vr-arm${grabbing ? ' vr-grabbing' : ''}`,
              transform: `rotate(${angle} ${PIVOT.x} ${PIVOT.y})`,
              role: 'slider',
              tabIndex: 0,
              'aria-label': props.armLabel,
              'aria-valuemin': ARM_MIN,
              'aria-valuemax': ARM_MAX,
              'aria-valuenow': Math.round(angle),
              'aria-valuetext': playing ? props.pauseLabel : props.playLabel,
              onPointerDown,
              onPointerMove,
              onPointerUp: (event) => release(event, true),
              onPointerCancel: (event) => release(event, false),
              onKeyDown,
            },
            // the arm's collar at the pivot
            h('circle', { key: 'collar', cx: PIVOT.x, cy: PIVOT.y, r: 15, fill: 'url(#vr-metal)' }),
            h('circle', { key: 'collar-in', cx: PIVOT.x, cy: PIVOT.y, r: 8, fill: '#2b2f33' }),
            // the tube runs from the pivot down to the headshell
            h('rect', {
              key: 'tube',
              x: PIVOT.x - 2.6,
              y: PIVOT.y,
              width: 5.2,
              height: ARM_LENGTH - 46,
              fill: 'url(#vr-tube2)',
            }),
            // the headshell at the far end of the tube
            h(
              'g',
              { key: 'head', transform: `rotate(5 ${PIVOT.x} ${PIVOT.y + ARM_LENGTH - 30})` },
              h('rect', {
                x: PIVOT.x - 11,
                y: PIVOT.y + ARM_LENGTH - 48,
                width: 22,
                height: 34,
                rx: 5,
                fill: '#22262a',
                stroke: '#0d0f11',
                strokeWidth: '1.2',
              }),
              h('rect', {
                x: PIVOT.x - 8,
                y: PIVOT.y + ARM_LENGTH - 43,
                width: 16,
                height: 4,
                rx: 2,
                fill: 'url(#vr-metal)',
                opacity: '0.75',
              }),
              // the stylus itself, ending exactly at the arm's effective length
              h('rect', {
                x: PIVOT.x - 1.4,
                y: PIVOT.y + ARM_LENGTH - 18,
                width: 2.8,
                height: 16,
                rx: 1.4,
                fill: '#cfd4d9',
              }),
            ),
          ),
        ),
      );
    }

    /** One record tile in a shelf: hover swells it, drag drops it on the platter. */
    function RecordCard(props) {
      const row = props.row;
      const cover = coverUrl(row.cover);
      return h(
        'div',
        {
          className: `vr-card${props.playing ? ' vr-playing' : ''}${props.dragging ? ' vr-dragging' : ''}`,
          role: 'button',
          tabIndex: 0,
          draggable: true,
          title: row.title,
          'aria-label': `${row.title}${row.author === '' ? '' : ` \u2014 ${row.author}`}`,
          onClick: () => props.onPick(row),
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            props.onPick(row);
          },
          onDragStart: (event) => {
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData(DRAG_TYPE, row.bvid);
            event.dataTransfer.setData('text/plain', row.bvid);
            props.onDragStart();
          },
          onDragEnd: () => props.onDragEnd(),
        },
        h(
          'span',
          { className: 'vr-card-art' },
          props.playing ? h('span', { className: 'vr-badge' }, props.playingLabel) : null,
          cover === ''
            ? h('span', { className: 'vr-fallback' }, initial(row.title))
            : h(Cover, { src: cover, fallback: row.title }),
          h(
            'button',
            {
              type: 'button',
              className: `vr-heart${props.favorite ? ' vr-on' : ''}`,
              'aria-label': props.favorite ? props.removeLabel : props.addLabel,
              title: props.favorite ? props.removeLabel : props.addLabel,
              'aria-pressed': props.favorite,
              onClick: (event) => {
                event.stopPropagation();
                props.onFavorite(row);
              },
              onPointerDown: (event) => event.stopPropagation(),
            },
            h(IconHeart, { size: 12, filled: props.favorite }),
          ),
        ),
        h('span', { className: 'vr-card-title' }, row.title),
        h(
          'span',
          { className: 'vr-card-sub' },
          `${row.author || '\u2014'}${row.duration > 0 ? ` \u00b7 ${clock(row.duration)}` : ''}`,
        ),
      );
    }

    /**
     * The seek bar, dragged to scrub the track.
     *
     * Two problems are solved here, and both made the bar feel broken:
     *
     *  - `timeupdate` fires several times a second, so a slider bound straight to
     *    it snaps back mid-drag. While the pointer is down the bar follows local
     *    scrub state instead.
     *  - writing `currentTime` on every pointer move re-decodes the stream. Long
     *    recordings (a hundred-song compilation is over six hours) stall, and the
     *    thumb lags behind the pointer. The drag only previews the position; the
     *    real seek is committed once, on release.
     *
     * Pointer capture keeps the drag alive when the pointer leaves the bar, so a
     * fast scrub does not stop the moment it slips outside the track.
     */
    function SeekBar(props) {
      const [scrub, setScrub] = React.useState(null);
      /** Whether a pointer drag is in progress, so release commits exactly once. */
      const dragging = React.useRef(false);
      /* The latest previewed position. A ref, not the state variable, because the
         release handler runs inside the same gesture and React has not
         re-rendered with the newest state by then — reading state there commits a
         stale position, which sent the transport back to zero on every release. */
      const scrubRef = React.useRef(null);
      const max = Math.max(1, Math.round(props.duration));
      const current = scrub !== null ? scrub : Math.min(Math.round(props.time), max);
      // The track's filled portion, so the bar shows how far in the track is
      // without waiting for the thumb to move.
      const percent = Math.min(100, Math.max(0, (current / max) * 100));
      /**
       * How much has been downloaded.
       *
       * A grey band ahead of the played portion shows that the rest of the track
       * is ready, which matters most on a long recording: without it a listener
       * cannot tell whether a jump will be instant or stall while it fetches.
       * The buffer is never drawn behind the thumb, so it always reads as
       * "ahead of what you can already hear".
       */
      const bufferedSeconds = Number.isFinite(props.buffered) ? props.buffered : 0;
      const bufferedPercent = Math.min(100, Math.max(percent, (bufferedSeconds / max) * 100));

      const preview = (seconds) => {
        scrubRef.current = seconds;
        setScrub(seconds);
        props.onSeek(seconds, false);
      };

      const commit = (seconds) => {
        scrubRef.current = null;
        setScrub(null);
        props.onSeek(seconds, true);
      };

      /**
       * The position a pointer event points at, in seconds.
       *
       * The release event carries its own coordinates, and using them is what
       * makes the commit land where the pointer actually stopped. Reading the
       * last previewed value instead commits one step behind: `pointerup` arrives
       * after the final `pointermove`, so the drag ends short of where the user
       * let go — the track then plays from the wrong spot.
       */
      const secondsAt = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return null;
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        return Math.round(ratio * max);
      };

      const endDrag = (event, cancelled) => {
        if (!dragging.current) return;
        dragging.current = false;
        if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) {
          try {
            event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {
            /* already released */
          }
        }
        if (cancelled) {
          scrubRef.current = null;
          setScrub(null);
          return;
        }
        // Prefer the release event's own position; fall back to the last preview
        // only for events that carry no usable coordinate.
        const landed = event === undefined ? null : secondsAt(event);
        commit(landed ?? scrubRef.current ?? Math.round(props.time));
      };

      return h(
        'div',
        { className: 'vr-progress' },
        h('span', null, clock(current)),
        h('input', {
          type: 'range',
          className: 'vr-range',
          min: 0,
          max,
          step: 1,
          value: Math.min(current, max),
          disabled: props.disabled,
          'aria-label': props.label,
          'aria-valuetext': `${clock(current)} / ${clock(props.duration)}`,
          style: { '--vr-progress': `${percent}%`, '--vr-buffered': `${bufferedPercent}%` },
          onPointerDown: (event) => {
            if (props.disabled) return;
            dragging.current = true;
            // Capture keeps the drag alive outside the bar. It throws when the
            // pointer id is not active (synthetic events, or a pointer that left
            // the document), and the drag must still work in that case.
            try {
              event.currentTarget.setPointerCapture?.(event.pointerId);
            } catch {
              /* capture is an enhancement; the drag proceeds without it */
            }
          },
          onPointerMove: (event) => {
            if (!dragging.current) return;
            // Derive the target from the pointer position so the bar keeps
            // following even when the native thumb handling misses a step.
            const next = secondsAt(event);
            if (next !== null) preview(next);
          },
          onPointerUp: (event) => endDrag(event, false),
          onPointerCancel: (event) => endDrag(event, true),
          // Keyboard and click-to-jump still arrive as input/change.
          onInput: (event) => {
            const next = Number(event.target.value);
            if (dragging.current) preview(next);
            else commit(next);
          },
          onChange: (event) => {
            const next = Number(event.target.value);
            if (dragging.current) preview(next);
            else commit(next);
          },
          onKeyUp: () => setScrub(null),
          onBlur: () => {
            if (dragging.current) return;
            setScrub(null);
          },
        }),
        h('span', null, clock(props.duration)),
      );
    }

    /**
     * One shelf. The crate and the favorites shelf are the same component, so
     * their interaction and their skeleton stay identical. A shelf that accepts
     * records (the favorites) is also a drop target for the card drag.
     */
    function Rail(props) {
      const rows = props.rows;
      const accepts = props.acceptsDrop === true;
      const [over, setOver] = React.useState(false);
      return h(
        'section',
        {
          className: `vr-rail${accepts && over ? ' vr-drop-target' : ''}`,
          'aria-label': props.title,
          onDragOver: accepts
            ? (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
                if (!over) setOver(true);
              }
            : undefined,
          onDragLeave: accepts
            ? (event) => {
                if (event.currentTarget.contains(event.relatedTarget)) return;
                setOver(false);
              }
            : undefined,
          onDrop: accepts
            ? (event) => {
                event.preventDefault();
                setOver(false);
                const bvid = readDropPayload(event.dataTransfer);
                if (bvid !== '') props.onDropRecord(bvid);
              }
            : undefined,
        },
        h(
          'div',
          { className: 'vr-rail-head' },
          h(
            'span',
            { className: 'vr-rail-title' },
            h(IconShelf, { size: 14 }),
            props.title,
            rows.length > 0 ? h('span', { className: 'vr-rail-count' }, props.count) : null,
          ),
          props.action ?? null,
        ),
        rows.length === 0
          ? h(
              'div',
              { className: 'vr-rail-empty' },
              h('strong', null, accepts && over ? props.dropHint : props.emptyTitle),
              h('span', null, props.emptyHint),
            )
          : h(
              'div',
              { className: 'vr-rail-scroll' },
              h(
                'div',
                { className: 'vr-rail-grid' },
                rows.map((row) =>
                  h(RecordCard, {
                    key: row.bvid,
                    row,
                    favorite: props.isFavorite(row.bvid),
                    playing: props.playingBvid === row.bvid && props.playing,
                    dragging: props.draggingBvid === row.bvid,
                    playingLabel: props.playingLabel,
                    addLabel: props.addLabel,
                    removeLabel: props.removeLabel,
                    onPick: props.onPick,
                    onFavorite: props.onFavorite,
                    onDragStart: () => props.onDragStart(row.bvid),
                    onDragEnd: () => props.onDragEnd(),
                  }),
                ),
              ),
            ),
      );
    }

    /** The panel: the deck centred, the crate and favorites on one row beneath it. */
    function RoomPage() {
      const t = useT();
      const snapshot = useRoom();
      const [draft, setDraft] = React.useState('');
      const [manualError, setManualError] = React.useState('');
      const [draggingBvid, setDraggingBvid] = React.useState('');
      const searchRef = React.useRef(null);

      React.useEffect(() => {
        searchRef.current?.focus();
      }, []);

      React.useEffect(() => {
        store.setRoomMounted(true);
        return () => {
          store.setRoomMounted(false);
          store.setDropActive(false);
        };
      }, []);

      const record = snapshot.record;
      const part = record === null ? undefined : record.parts[snapshot.partIndex];
      const title = record === null ? '' : part !== undefined && record.parts.length > 1 ? part.title : record.title;
      const cover = record === null ? '' : coverUrl(record.cover);
      const failure = manualError !== '' ? manualError : snapshot.error;
      const favoriteIds = new Set(snapshot.favorites.map((row) => row.bvid));

      /** Every way of choosing a record ends here. */
      const pick = (row) => {
        if (record !== null && record.bvid === row.bvid) {
          store.toggle();
          return;
        }
        void store.play(row.bvid, 0, true);
      };
      const dropRecord = (bvid) => {
        setDraggingBvid('');
        store.setDropActive(false);
        void store.play(bvid, 0, true);
      };
      /** A record dropped on the favorites shelf is collected, not played. */
      const collectRecord = (bvid) => {
        setDraggingBvid('');
        if (!favoriteIds.has(bvid)) store.toggleFavorite(bvid);
      };

      const railProps = {
        isFavorite: (bvid) => favoriteIds.has(bvid),
        playingBvid: record === null ? '' : record.bvid,
        playing: snapshot.playing,
        playingLabel: t('nowSpinning'),
        draggingBvid,
        addLabel: t('favoriteAdd'),
        removeLabel: t('favoriteRemove'),
        onPick: pick,
        onFavorite: (row) => store.toggleFavorite(row.bvid),
        onDragStart: (bvid) => setDraggingBvid(bvid),
        onDragEnd: () => setDraggingBvid(''),
      };

      const hasAny = snapshot.shelf.length > 0 || snapshot.favorites.length > 0;

      return h(
        'div',
        { className: 'vr-page' },
        h(Styles),
        h(
          'div',
          { className: 'vr-scroll' },
          h(
            'div',
            { className: 'vr-body' },
            h(
              'header',
              { className: 'vr-head' },
              h('h1', { className: 'vr-title' }, h(IconDisc, { size: 19 }), t('panel')),
              h(
                'form',
                {
                  className: 'vr-search',
                  onSubmit: (event) => {
                    event.preventDefault();
                    if (draft.trim() === '') {
                      setManualError('bad-query');
                      return;
                    }
                    setManualError('');
                    void store.search(draft);
                  },
                },
                h(
                  'div',
                  { className: 'vr-field' },
                  h('span', { className: 'vr-field-icon' }, h(IconSearch, { size: 15 })),
                  h('input', {
                    ref: searchRef,
                    className: 'vr-input',
                    value: draft,
                    placeholder: t('searchPlaceholder'),
                    'aria-label': t('searchPlaceholder'),
                    spellCheck: false,
                    onChange: (event) => {
                      setDraft(event.target.value);
                      if (manualError !== '') setManualError('');
                    },
                  }),
                ),
                h(
                  'button',
                  { type: 'submit', className: 'vr-btn vr-btn-primary', disabled: snapshot.searching },
                  snapshot.searching ? t('searching') : t('search'),
                ),
              ),
            ),

            failure === ''
              ? null
              : h(
                  'div',
                  { className: 'vr-msg vr-msg-error', role: 'alert' },
                  h('span', null, errorText(failure)),
                  manualError === '' && record !== null
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'vr-btn vr-btn-ghost',
                          style: { marginLeft: 'auto' },
                          onClick: () => void store.play(record.bvid, snapshot.partIndex, true),
                        },
                        t('retry'),
                      )
                    : null,
                ),

            // the deck is the subject, and it sits in the middle
            h(
              'div',
              { className: 'vr-deck-area' },
              h(Turntable, {
                title: title === '' ? t('nothingPlaying') : title,
                cover,
                armed: record !== null,
                playing: snapshot.playing && snapshot.error === '',
                dropActive: snapshot.dropActive,
                speed: snapshot.speed,
                volume: snapshot.volume,
                muted: snapshot.muted,
                playLabel: t('play'),
                pauseLabel: t('pause'),
                emptyLabel: t('nothingPlaying'),
                armLabel: t('dragHint'),
                speedLabel: t('speed'),
                volumeLabel: t('volume'),
                onToggle: () => store.toggle(),
                onEngage: (engaged) => store.setEngaged(engaged),
                onDrop: dropRecord,
                onDropActive: (active) => store.setDropActive(active),
                onSpeed: (value) => store.setSpeed(value),
                onVolume: (value) => store.setVolume(value),
                onMute: () => store.toggleMute(),
              }),
              h(
                'div',
                { className: 'vr-plate-info' },
                h('div', { className: 'vr-plate-title' }, record === null ? t('nothingPlaying') : title),
                h(
                  'div',
                  { className: 'vr-plate-sub' },
                  record === null
                    ? snapshot.dropActive
                      ? t('dropRelease')
                      : t('dropHint')
                    : record.parts.length > 1
                      ? `${record.author || '\u2014'} \u00b7 ${t('side')} ${snapshot.partIndex + 1}/${record.parts.length}`
                      : `${record.author || '\u2014'} \u00b7 ${snapshot.speed} rpm`,
                ),
              ),
              h(
                'div',
                { className: 'vr-transport' },
                // left: the seek bar, which is dragged to scrub the track
                h(
                  'div',
                  { className: 'vr-transport-seek' },
                  h(SeekBar, {
                    time: snapshot.time,
                    buffered: snapshot.buffered,
                    duration: snapshot.duration,
                    disabled: snapshot.duration === 0,
                    label: t('nowSpinning'),
                    onSeek: (seconds, commit) => store.seek(seconds, commit),
                  }),
                ),
                // right: secondary keys, with play/pause pinned at the far edge
                h(
                  'div',
                  { className: 'vr-keys' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'vr-key',
                      onClick: () => store.advance(-1),
                      disabled: !hasAny,
                      'aria-label': t('previous'),
                      title: t('previous'),
                    },
                    h(IconPrev, { size: 14 }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'vr-key',
                      onClick: () => store.stop(),
                      disabled: record === null,
                      'aria-label': t('stop'),
                      title: t('stop'),
                    },
                    h(IconStop, { size: 12 }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'vr-key',
                      onClick: () => store.replay(),
                      disabled: record === null,
                      'aria-label': t('replay'),
                      title: t('replay'),
                    },
                    h(IconReplay, { size: 14 }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'vr-key',
                      onClick: () => store.advance(1),
                      disabled: !hasAny,
                      'aria-label': t('next'),
                      title: t('next'),
                    },
                    h(IconNext, { size: 14 }),
                  ),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'vr-play',
                    onClick: () => store.toggle(),
                    disabled: !hasAny,
                    'aria-label': snapshot.playing ? t('pause') : t('play'),
                    title: snapshot.playing ? t('pause') : t('play'),
                  },
                  snapshot.loadingRecord
                    ? h(IconDisc, { size: 20, style: { animation: 'vr-spin 1.1s linear infinite' } })
                    : h(snapshot.playing ? IconPause : IconPlay, { size: 20 }),
                ),
              ),
              h(
                'div',
                { className: 'vr-hint' },
                h(IconDisc, { size: 12 }),
                h('span', null, t('dragHint')),
              ),
              record !== null && record.parts.length > 1
                ? h(
                    'div',
                    { className: 'vr-tracks' },
                    h(
                      'div',
                      { className: 'vr-tracks-head' },
                      h('span', null, t('trackList')),
                      h('span', { className: 'vr-rail-count' }, t('recordsCount', { count: record.parts.length })),
                    ),
                    h(
                      'div',
                      { className: 'vr-track-list' },
                      record.parts.map((item) =>
                        h(
                          'button',
                          {
                            key: item.cid,
                            type: 'button',
                            className: `vr-track${item.index === snapshot.partIndex ? ' vr-on' : ''}`,
                            onClick: () => store.playPart(item.index),
                          },
                          h('span', { className: 'vr-track-index' }, String(item.index + 1).padStart(2, '0')),
                          h('span', { className: 'vr-track-name' }, item.title),
                          h('span', { className: 'vr-track-time' }, clock(item.duration)),
                        ),
                      ),
                    ),
                  )
                : null,
            ),

            // both shelves sit underneath the deck, side by side
            h(
              'div',
              { className: 'vr-shelves' },
              h(Rail, {
                ...railProps,
                title: t('shelf'),
                count: t('recordsCount', { count: snapshot.shelf.length }),
                rows: snapshot.shelf,
                emptyTitle: snapshot.searching ? t('searching') : t('shelfEmpty'),
                emptyHint: snapshot.searched && !snapshot.searching ? t('noResults') : t('shelfEmptyHint'),
                action:
                  snapshot.shelf.length > 0
                    ? h(
                        'button',
                        { type: 'button', className: 'vr-btn vr-btn-ghost', onClick: () => store.clearShelf() },
                        t('clear'),
                      )
                    : null,
              }),
              h(Rail, {
                ...railProps,
                title: t('favorites'),
                count: t('recordsCount', { count: snapshot.favorites.length }),
                rows: snapshot.favorites,
                emptyTitle: t('favoritesEmpty'),
                emptyHint: t('favoritesEmptyHint'),
                action: null,
                // dragging a record from the crate onto this shelf collects it
                acceptsDrop: true,
                dropHint: t('favoriteDropHere'),
                onDropRecord: collectRecord,
              }),
            ),

            snapshot.shelf.length > 0
              ? h(
                  'div',
                  { style: { display: 'flex', justifyContent: 'center', paddingTop: 16 } },
                  h(
                    'button',
                    { type: 'button', className: 'vr-btn', onClick: () => void store.loadMore(), disabled: snapshot.loadingMore },
                    snapshot.loadingMore ? t('searching') : t('loadMore'),
                  ),
                )
              : null,
          ),
        ),
      );
    }

    /**
     * The root-scoped player. It owns the only `<audio>` element so playback
     * survives leaving the room panel — but it renders no floating UI, because
     * the transport lives in the sidebar entry instead.
     */
    function BackgroundAudio() {
      const audioRef = React.useRef(null);
      React.useEffect(() => {
        store.attach(audioRef.current);
        return () => store.detach();
      }, []);
      return h('audio', { ref: audioRef, preload: 'auto', className: 'vr-sr' });
    }

    return {
      inject: ['slots', 'locale'],
      // Exposed so the offline geometry tests can render the deck without a
      // browser. Not part of the plugin contract the Harness consumes.
      __test_Turntable: Turntable,
      __test_SeekBar: SeekBar,
      __test_BackgroundAudio: BackgroundAudio,
      __test_RoomPage: RoomPage,
      __test_store: store,
      __test_coverUrl: coverUrl,
      __test_ARM: { ARM_REST, ARM_PLAY, ARM_MIN, ARM_MAX, ARM_ENGAGED },
      apply(ctx) {
        const disposeLocale = ctx.locale.register(NS, DICTIONARIES);
        localeService = ctx.locale;
        translate = ctx.locale.bind(NS);

        /* A console handle for diagnosing playback on a live page:
           `__vinylDebug()` reports the element's state and `__vinylSeek(120)`
           performs a seek straight through the store. Both are inert unless
           called, and they make a transport problem visible without a rebuild. */
        if (typeof window !== 'undefined') {
          window.__vinylDebug = () => store.describeSeek();
          window.__vinylSeek = (seconds, commit = true) => {
            store.seek(Number(seconds), commit !== false);
            return store.describeSeek();
          };
        }

        const disposers = [
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => translate('panel') },
              PanelIcon,
            ),
          ),
          ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, RoomPage),
          ),
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              { name: 'shell.overlay', id: 'vinyl-room.player', order: 95, locale: NS },
              BackgroundAudio,
            ),
          ),
        ];

        ctx.effect(
          () => () => {
            for (const dispose of disposers.splice(0).reverse()) dispose();
            disposeLocale();
            if (localeService === ctx.locale) {
              localeService = null;
              translate = (key) => key;
            }
          },
          'vinyl-room: slot registrations',
        );
      },
    };
  },
});
