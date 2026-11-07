import http from 'node:http';
import { Bilibili, MediaTokens, handleRoute, plainText, secondsOf, coverAllowed, normalizeCover } from '../index.js';

const source = new Bilibili();
const tokens = new MediaTokens();
const cache = new Map();

const server = http.createServer(async (req, res) => {
  const request = new Request(`http://127.0.0.1:8792${req.url}`, {
    method: req.method,
    headers: req.headers.range === undefined ? {} : { range: req.headers.range },
  });
  const response = await handleRoute(request, source, tokens, cache);
  const headers = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  res.writeHead(response.status, headers);
  if (response.body === null) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
});

await server.listen(8792, '127.0.0.1');
const base = 'http://127.0.0.1:8792/vinyl-room';
const get = async (path, headers = {}) => {
  const response = await fetch(base + path, { headers });
  const type = response.headers.get('content-type') ?? '';
  const body = type.startsWith('application/json') ? await response.json() : `<${(await response.arrayBuffer()).byteLength} bytes ${type}>`;
  return { status: response.status, headers: response.headers, body };
};

const checks = [];
const expect = (label, condition, detail) => {
  checks.push({ label, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
};

// --- pure helpers -----------------------------------------------------------
expect('plainText strips highlight markup', plainText('【4K】<em class="keyword">周杰伦</em> 晴天 &amp; more') === '【4K】周杰伦 晴天 & more', plainText('x<em>y</em>'));
expect('secondsOf reads MM:SS', secondsOf('4:19') === 259, String(secondsOf('4:19')));
expect('secondsOf reads H:MM:SS', secondsOf('1:00:05') === 3605, String(secondsOf('1:00:05')));
expect('secondsOf passes numbers', secondsOf(213) === 213);
expect('normalizeCover absolutizes protocol-relative', normalizeCover('//i0.hdslb.com/a.jpg') === 'https://i0.hdslb.com/a.jpg');
expect('coverAllowed accepts hdslb', coverAllowed('https://i0.hdslb.com/bfs/archive/x.jpg') === true);
expect('coverAllowed rejects foreign host', coverAllowed('https://evil.example.com/x.jpg') === false);
expect('coverAllowed rejects http', coverAllowed('http://i0.hdslb.com/x.jpg') === false);

// --- routing guards ---------------------------------------------------------
expect('bad method is 405', (await get('/api/search?q=x', {})).status === 200);
{
  const response = await fetch(base + '/api/search?q=x', { method: 'POST' });
  expect('POST rejected 405', response.status === 405, String(response.status));
  await response.arrayBuffer();
}
expect('empty query is 400', (await get('/api/search?q=')).status === 400);
expect('bad bvid is 400', (await get('/api/resolve?bvid=nope')).status === 400);
expect('bad play params are 400', (await get('/api/play?bvid=BV1GJ411x7h7&cid=0')).status === 400);
expect('unknown route is 404', (await get('/api/nope')).status === 404);
expect('cover open proxy blocked', (await get('/api/cover?u=https%3A%2F%2Fevil.example.com%2Fa.jpg')).status === 400);
expect('unknown media token is 410', (await get('/media?t=deadbeef')).status === 410);

// --- live upstream ----------------------------------------------------------
const search = await get('/api/search?q=' + encodeURIComponent('周杰伦'));
expect('search 200', search.status === 200, String(search.status));
expect('search ok=true', search.body.ok === true, JSON.stringify(search.body).slice(0, 120));
const items = search.body.items ?? [];
expect('search returns items', items.length > 0, `${items.length} items`);
const first = items[0];
expect('item shape', typeof first?.bvid === 'string' && typeof first.title === 'string' && first.title.length > 0, JSON.stringify(first).slice(0, 160));
expect('item has cover', typeof first?.cover === 'string' && first.cover.startsWith('https://'), first?.cover?.slice(0, 60));

const resolved = await get('/api/resolve?bvid=' + encodeURIComponent(first.bvid));
expect('resolve 200', resolved.status === 200, String(resolved.status));
const record = resolved.body.record;
expect('resolve parts', Array.isArray(record?.parts) && record.parts.length > 0, `${record?.parts?.length} parts`);
expect('resolve author', typeof record?.author === 'string' && record.author.length > 0, record?.author);

const play = await get(`/api/play?bvid=${encodeURIComponent(first.bvid)}&cid=${record.parts[0].cid}`);
expect('play 200', play.status === 200, String(play.status));
expect('play returns token src', typeof play.body.src === 'string' && play.body.src.startsWith('/vinyl-room/media?t='), play.body.src);

const head = await fetch(`${base}/media?t=${play.body.src.split('t=')[1]}`, { headers: { range: 'bytes=0-2047' } });
const bytes = new Uint8Array(await head.arrayBuffer());
expect('media range 206', head.status === 206, String(head.status));
expect('media content-type audio', /audio\/mp4|video\/mp4/.test(head.headers.get('content-type') ?? ''), head.headers.get('content-type'));
expect('media accept-ranges', head.headers.get('accept-ranges') === 'bytes');
expect('media body has ftyp atom', bytes.length > 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp', String.fromCharCode(...bytes.slice(4, 8)));

const cover = await fetch(`${base}/api/cover?u=${encodeURIComponent(first.cover)}`);
const coverBytes = new Uint8Array(await cover.arrayBuffer());
expect('cover 200', cover.status === 200, String(cover.status));
expect('cover is an image', (cover.headers.get('content-type') ?? '').startsWith('image/'), cover.headers.get('content-type'));
expect('cover has bytes', coverBytes.length > 1000, `${coverBytes.byteLength} bytes`);

// Cached second read must not hit upstream again.
const cachedCover = await fetch(`${base}/api/cover?u=${encodeURIComponent(first.cover)}`);
const cachedBytes = new Uint8Array(await cachedCover.arrayBuffer());
expect('cover cached identically', cachedBytes.byteLength === coverBytes.byteLength && cachedCover.status === 200);

console.log('');
const failed = checks.filter((check) => !check.ok);
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) {
  for (const check of failed) console.log('  FAILED:', check.label, check.detail ?? '');
}
server.close();
process.exit(failed.length === 0 ? 0 : 1);
