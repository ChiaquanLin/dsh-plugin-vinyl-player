import http from 'node:http';
import { Bilibili, MediaTokens, handleRoute } from '../index.js';

const source = new Bilibili();
const tokens = new MediaTokens();
const cache = new Map();
const server = http.createServer(async (req, res) => {
  const request = new Request(`http://127.0.0.1:8799${req.url}`, { method: req.method });
  const response = await handleRoute(request, source, tokens, cache);
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(response.status, headers);
  if (response.body === null) return res.end();
  const reader = response.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); }
  res.end();
});
await server.listen(8799, '127.0.0.1');

const checks = [];
const check = (label, ok, detail) => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); };

// a genuine cover
const up = 'https://i0.hdslb.com/bfs/archive/25c409c43790cc13bf9ebc473b36c4f650527653.jpg';
const first = await fetch(`http://127.0.0.1:8799/vinyl-room/api/cover?u=${encodeURIComponent(up)}&v=2`);
const b1 = new Uint8Array(await first.arrayBuffer());
check('cover returns 200', first.status === 200, String(first.status));
check('cover is an image type', /^image\//.test(first.headers.get('content-type') ?? ''), first.headers.get('content-type'));
check('cover has real JPEG bytes', b1[0] === 0xFF && b1[1] === 0xD8, `${b1.byteLength} bytes`);
check('first read is a cache miss', first.headers.get('x-vinyl-cover') === 'miss', first.headers.get('x-vinyl-cover'));
check('cache-control is immutable', /immutable/.test(first.headers.get('cache-control') ?? ''), first.headers.get('cache-control'));

const second = await fetch(`http://127.0.0.1:8799/vinyl-room/api/cover?u=${encodeURIComponent(up)}`);
const b2 = new Uint8Array(await second.arrayBuffer());
check('second read is a cache hit', second.headers.get('x-vinyl-cover') === 'hit', second.headers.get('x-vinyl-cover'));
check('cached bytes are identical', b2.byteLength === b1.byteLength);

// a non-image upstream must be rejected, never cached as an image
const bad = await fetch(`http://127.0.0.1:8799/vinyl-room/api/cover?u=${encodeURIComponent('https://i0.hdslb.com/robots.txt')}`);
const badBody = await bad.text();
check('a non-image is refused', bad.status === 502, `${bad.status} ${badBody.slice(0, 60)}`);
check('the refusal is JSON, not image bytes', badBody.startsWith('{'));

server.close();
const failed = checks.filter((x) => !x).length;
console.log(`\n${checks.length - failed}/${checks.length} cover endpoint checks passed`);
process.exit(failed === 0 ? 0 : 1);
