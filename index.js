/**
 * Host half of the Vinyl Room plugin: a Bilibili audio source and the HTTP
 * endpoints the browser panel calls.
 *
 * The browser never talks to Bilibili directly: the upstream APIs require a
 * site cookie, a matching Referer and WBI-signed query strings, and the CDN
 * refuses hot-linked media. This half keeps one warm site session, signs the
 * playurl request, hands the browser an opaque media token, and proxies the
 * range requests so `<audio>` can seek.
 *
 * Routes (all under ROUTE_PREFIX, served without the SPA fallback):
 *   GET /api/search?q=&page=   keyword search, video results
 *   GET /api/resolve?bvid=     title, owner, cover and the part list
 *   GET /api/play?bvid=&cid=   the best audio track as a media token
 *   GET /api/cover?u=          cached cover bytes
 *   GET /media?t=              range-aware audio proxy behind a token
 */

/** Prefix owning every route this plugin serves. */
export const ROUTE_PREFIX = '/vinyl-room';

const SITE = 'https://www.bilibili.com';
const API = 'https://api.bilibili.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** WBI mixin table: a fixed permutation applied to `imgKey + subKey`. */
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52,
];

/** Hosts the cover proxy may read, so the endpoint cannot be used as an open proxy. */
const COVER_HOSTS = [/(^|\.)hdslb\.com$/i, /(^|\.)biliimg\.com$/i];

/** Media tokens live this long; Bilibili playurl links expire after a couple of hours. */
const TOKEN_TTL_MS = 50 * 60 * 1000;
const TOKEN_LIMIT = 240;
/** The site session is refreshed this often so `buvid3` never goes stale. */
const SESSION_TTL_MS = 30 * 60 * 1000;

const MIXIN_KEY = (raw) => MIXIN_TAB.map((at) => raw[at]).join('').slice(0, 32);

const md5 = async (text) => {
  const { createHash } = await import('node:crypto');
  return createHash('md5').update(text).digest('hex');
};

/** Strip the highlight markup the search API embeds in titles. */
export function plainText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (whole, name) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' })[name] ?? whole,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read a search result duration, which arrives either as seconds or as `MM:SS`. */
export function secondsOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const text = String(value ?? '').trim();
  if (text === '') return 0;
  const parts = text.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** Upstream call result: either the parsed payload or a user-facing failure. */
async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`bilibili returned ${response.status} with an unreadable body`);
  }
}

/**
 * One warm Bilibili session: cookie bootstrap, WBI keys, and the three calls
 * the panel needs. Every fetch carries the same impersonated browser identity.
 */
export class Bilibili {
  constructor({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
    this.fetch = fetchImpl;
    this.now = now;
    this.cookie = '';
    this.sessionAt = 0;
    this.imgKey = '';
    this.subKey = '';
    this.wbiAt = 0;
    this.session = undefined;
  }

  /** Headers impersonating the site itself; `extra` may add Range or a URL-specific Referer. */
  headers(extra = {}) {
    return {
      'User-Agent': UA,
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      Referer: `${SITE}/`,
      ...(this.cookie === '' ? {} : { Cookie: this.cookie }),
      ...extra,
    };
  }

  /** Establish the anonymous site session and the WBI keys behind one shared promise. */
  sessionReady(force = false) {
    if (!force && this.session !== undefined && this.now() - this.sessionAt < SESSION_TTL_MS) return this.session;
    this.session = this.openSession().catch((error) => {
      this.session = undefined;
      throw error;
    });
    return this.session;
  }

  async openSession() {
    const home = await this.fetch(SITE, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    await home.arrayBuffer().catch(() => undefined);
    const jar = typeof home.headers.getSetCookie === 'function' ? home.headers.getSetCookie() : [];
    const cookie = jar.map((line) => line.split(';')[0]).join('; ');
    if (cookie !== '') this.cookie = cookie;
    this.sessionAt = this.now();
    await this.refreshWbi();
    return cookie;
  }

  /** Re-read the WBI keys from the nav endpoint. */
  async refreshWbi() {
    const response = await this.fetch(`${API}/x/web-interface/nav`, { headers: this.headers() });
    const body = await readJson(response);
    const image = body?.data?.wbi_img?.img_url;
    const sub = body?.data?.wbi_img?.sub_url;
    if (typeof image !== 'string' || typeof sub !== 'string') throw new Error('bilibili did not expose WBI keys');
    const keyOf = (url) => url.split('/').pop().split('.')[0];
    this.imgKey = keyOf(image);
    this.subKey = keyOf(sub);
    this.wbiAt = this.now();
  }

  /** Append `w_rid`/`wts` to parameters, as the site's own player does. */
  async sign(params) {
    if (this.imgKey === '' || this.now() - this.wbiAt > SESSION_TTL_MS) await this.refreshWbi();
    const mixed = MIXIN_KEY(this.imgKey + this.subKey);
    const complete = { ...params, wts: Math.round(this.now() / 1000) };
    const query = Object.keys(complete)
      .sort()
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(complete[key]).replace(/[!'()*]/g, ''))}`)
      .join('&');
    return `${query}&w_rid=${await md5(query + mixed)}`;
  }

  /** One site call that retries once against a fresh session when the cookie went stale. */
  async call(path, params, extraHeaders = {}) {
    await this.sessionReady();
    const send = async () => {
      const response = await this.fetch(`${API}${path}`, { headers: this.headers(extraHeaders) });
      return readJson(response);
    };
    let body = await send();
    if (body?.code === -352 || body?.code === -412 || body?.code === -403) {
      await this.sessionReady(true);
      body = await send();
    }
    if (body?.code !== 0) throw new Error(body?.message || `bilibili refused ${path}`);
    return body.data;
  }

  /** Keyword video search, newest-first pages starting at 1. */
  async search(keyword, page = 1) {
    const query = new URLSearchParams({
      search_type: 'video',
      keyword,
      page: String(Math.max(1, Math.min(50, Number(page) || 1))),
    });
    const data = await this.call(`/x/web-interface/search/type?${query}`, null, {
      Referer: `${SITE}/search?keyword=${encodeURIComponent(keyword)}`,
    });
    const rows = Array.isArray(data?.result) ? data.result : [];
    return rows
      .filter((row) => typeof row?.bvid === 'string' && row.bvid !== '')
      .map((row) => ({
        bvid: row.bvid,
        title: plainText(row.title),
        author: plainText(row.author),
        cover: normalizeCover(row.pic),
        duration: secondsOf(row.duration),
        play: Number(row.play) || 0,
        publishedAt: Number(row.pubdate) || 0,
      }));
  }

  /** Video metadata plus the part list a record's track list is built from. */
  async resolve(bvid) {
    const data = await this.call(`/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
    const pages = Array.isArray(data?.pages) && data.pages.length > 0 ? data.pages : [{ cid: data?.cid, part: '', duration: data?.duration }];
    const parts = pages
      .filter((page) => Number.isFinite(Number(page?.cid)))
      .map((page, index) => ({
        cid: Number(page.cid),
        index,
        title: plainText(page.part) || `P${index + 1}`,
        duration: secondsOf(page.duration),
      }));
    if (parts.length === 0) throw new Error('this video exposes no playable part');
    return {
      bvid,
      title: plainText(data?.title),
      author: plainText(data?.owner?.name),
      cover: normalizeCover(data?.pic),
      duration: secondsOf(data?.duration),
      parts,
    };
  }

  /** Best available DASH audio track (or the progressive fallback) for one part. */
  async audio(bvid, cid) {
    const query = await this.sign({ bvid, cid, fnval: 16, fnver: 0, fourk: 1 });
    const data = await this.call(`/x/player/wbi/playurl?${query}`, null, {
      Referer: `${SITE}/video/${bvid}/`,
    });
    const tracks = Array.isArray(data?.dash?.audio) ? data.dash.audio : [];
    const pick = tracks
      .filter((track) => typeof track?.baseUrl === 'string')
      .sort((left, right) => (Number(right.bandwidth) || 0) - (Number(left.bandwidth) || 0))[0];
    if (pick !== undefined) {
      const urls = [pick.baseUrl, ...(Array.isArray(pick.backupUrl) ? pick.backupUrl : [])].filter(
        (url) => typeof url === 'string' && url !== '',
      );
      return { urls, mime: 'audio/mp4' };
    }
    const direct = Array.isArray(data?.durl) ? data.durl[0] : undefined;
    if (typeof direct?.url === 'string') {
      const urls = [direct.url, ...(Array.isArray(direct.backup_url) ? direct.backup_url : [])];
      return { urls, mime: 'video/mp4' };
    }
    throw new Error('no audio stream is available for this video');
  }
}

/** Protocol-relative covers become absolute; anything else passes through. */
export function normalizeCover(value) {
  if (typeof value !== 'string' || value === '') return '';
  if (value.startsWith('//')) return `https:${value}`;
  return value;
}

/** Short-lived opaque handles for upstream media URLs, so no CDN link reaches the page. */
export class MediaTokens {
  constructor({ ttl = TOKEN_TTL_MS, limit = TOKEN_LIMIT, now = () => Date.now() } = {}) {
    this.ttl = ttl;
    this.limit = limit;
    this.now = now;
    this.entries = new Map();
    this.counter = 0;
  }

  issue(entry) {
    const token = `${(this.counter += 1).toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    this.entries.set(token, { ...entry, at: this.now() });
    this.prune();
    return token;
  }

  read(token) {
    const entry = this.entries.get(token);
    if (entry === undefined) return undefined;
    if (this.now() - entry.at > this.ttl) {
      this.entries.delete(token);
      return undefined;
    }
    return entry;
  }

  prune() {
    const now = this.now();
    for (const [token, entry] of this.entries) {
      if (now - entry.at > this.ttl) this.entries.delete(token);
    }
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

const jsonResponse = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const failure = (code, message, status = 502) => jsonResponse({ ok: false, code, error: message }, status);

/** Classify an upstream failure into a code the panel can localize. */
function failureCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|socket|aborted/i.test(message)) return 'network';
  if (/no audio stream/i.test(message)) return 'no-audio';
  return 'upstream';
}

/** Only absolute https URLs on the allowed artwork hosts may be fetched. */
export function coverAllowed(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return COVER_HOSTS.some((pattern) => pattern.test(parsed.hostname));
}

/**
 * Serve one request under ROUTE_PREFIX.
 * @param request - the Fetch request the web carrier handed over.
 * @param source - warm Bilibili session used for every upstream call.
 * @param tokens - media-token registry.
 * @param cache - cover response cache, keyed by upstream URL.
 * @returns the Fetch response.
 */
export async function handleRoute(request, source, tokens, cache = new Map()) {
  const url = new URL(request.url);
  const path = url.pathname.slice(ROUTE_PREFIX.length) || '/';
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const head = request.method === 'HEAD';

  if (path === '/api/search') {
    const keyword = (url.searchParams.get('q') ?? '').trim();
    if (keyword === '') return failure('bad-query', 'missing keyword', 400);
    if (keyword.length > 80) return failure('bad-query', 'keyword too long', 400);
    try {
      const items = await source.search(keyword, Number(url.searchParams.get('page') ?? 1));
      return jsonResponse({ ok: true, items, keyword });
    } catch (error) {
      return failure(failureCode(error), describe(error));
    }
  }

  if (path === '/api/resolve') {
    const bvid = (url.searchParams.get('bvid') ?? '').trim();
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return failure('bad-bvid', 'invalid video id', 400);
    try {
      return jsonResponse({ ok: true, record: await source.resolve(bvid) });
    } catch (error) {
      return failure(failureCode(error), describe(error));
    }
  }

  if (path === '/api/play') {
    const bvid = (url.searchParams.get('bvid') ?? '').trim();
    const cid = Number(url.searchParams.get('cid'));
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid) || !Number.isFinite(cid) || cid <= 0) {
      return failure('bad-media', 'invalid media parameters', 400);
    }
    try {
      const stream = await source.audio(bvid, cid);
      const token = tokens.issue({ urls: stream.urls, referer: `${SITE}/video/${bvid}/`, mime: stream.mime });
      return jsonResponse({ ok: true, src: `${ROUTE_PREFIX}/media?t=${token}`, mime: stream.mime });
    } catch (error) {
      return failure(failureCode(error), describe(error));
    }
  }

  if (path === '/api/cover') {
    const target = url.searchParams.get('u') ?? '';
    if (!coverAllowed(target)) return failure('bad-media', 'cover host not allowed', 400);
    const cached = cache.get(target);
    if (cached !== undefined && Date.now() - cached.at < 12 * 60 * 60 * 1000) {
      return new Response(head ? null : cached.body, {
        status: 200,
        headers: {
          'content-type': cached.type,
          'content-length': String(cached.body.byteLength),
          // A successful cover is immutable for its URL, so it is safe to reuse.
          'cache-control': 'private, max-age=43200, immutable',
          // Marked so a stale entry from an older build is never mistaken for it.
          'x-vinyl-cover': 'hit',
        },
      });
    }
    try {
      const upstream = await fetch(target, {
        headers: { 'User-Agent': UA, Referer: `${SITE}/`, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      });
      if (!upstream.ok) return failure('upstream', `cover read failed (${upstream.status})`, 502);
      const body = new Uint8Array(await upstream.arrayBuffer());
      const type = upstream.headers.get('content-type') ?? 'image/jpeg';
      // Only store something the browser can actually decode. An HTML error page
      // served with a 200 would otherwise be cached as an image, and the client
      // would render its broken-image placeholder for the lifetime of the entry.
      const looksLikeImage = /^image\//i.test(type) && body.byteLength > 128;
      if (!looksLikeImage) {
        return failure('bad-media', `cover is not an image (${type})`, 502);
      }
      cache.set(target, { body, type, at: Date.now() });
      while (cache.size > 160) {
        const oldest = cache.keys().next();
        if (oldest.done) break;
        cache.delete(oldest.value);
      }
      return new Response(head ? null : body, {
        status: 200,
        headers: {
          'content-type': type,
          'content-length': String(body.byteLength),
          'cache-control': 'private, max-age=43200, immutable',
          'x-vinyl-cover': 'miss',
        },
      });
    } catch (error) {
      return failure(failureCode(error), describe(error));
    }
  }

  if (path === '/media') {
    const entry = tokens.read(url.searchParams.get('t') ?? '');
    if (entry === undefined) return failure('expired', 'media token expired', 410);
    return proxyMedia(request, entry, head);
  }

  return failure('upstream', 'unknown endpoint', 404);
}

/** Forward one range request to the upstream CDN, trying its backups in turn. */
async function proxyMedia(request, entry, head) {
  const range = request.headers.get('range') ?? undefined;
  let lastStatus = 0;
  for (const candidate of entry.urls) {
    let upstream;
    try {
      upstream = await fetch(candidate, {
        headers: {
          'User-Agent': UA,
          Referer: entry.referer,
          'Accept-Language': 'zh-CN,zh;q=0.9',
          ...(range === undefined ? {} : { Range: range }),
        },
      });
    } catch {
      continue;
    }
    if (upstream.status !== 200 && upstream.status !== 206) {
      lastStatus = upstream.status;
      await upstream.body?.cancel().catch(() => undefined);
      continue;
    }
    const headers = new Headers({
      'content-type': entry.mime ?? upstream.headers.get('content-type') ?? 'audio/mp4',
      'accept-ranges': 'bytes',
      // Streaming only: nothing about the audio may be persisted by the browser
      // or by an intermediary, so the track is never retained beyond the live
      // request. Range requests still work, which is what lets `<audio>` seek.
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      pragma: 'no-cache',
      expires: '0',
    });
    for (const name of ['content-length', 'content-range']) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return new Response(head || upstream.body === null ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  }
  return failure(lastStatus === 0 ? 'no-audio' : 'upstream', lastStatus === 0 ? 'audio source unavailable' : `audio source refused (${lastStatus})`, 502);
}

/** User-facing text for an upstream or transport failure. */
function describe(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|socket|aborted/i.test(message)) return 'cannot reach Bilibili, check the network connection';
  return message === '' ? 'Bilibili request failed' : message;
}

/** Host half entry point: wire the routes onto the optional web carrier. */
export function apply(ctx) {
  const source = new Bilibili();
  const tokens = new MediaTokens();
  const cache = new Map();
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          resource: (request) => handleRoute(request, source, tokens, cache),
        }),
      'vinyl-room: bilibili source routes',
    );
  });
}
