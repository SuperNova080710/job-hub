import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { test } from 'node:test';
import catalog from '../apps/api/dist/catalog.js';
import work24 from '../apps/api/dist/work24.js';

test('manual URLs retain meaningful query parameters', () => {
  assert.equal(catalog.canonicalUrl('HTTPS://EXAMPLE.ORG/jobs?id=42&utm_medium=email#about'),
    'https://example.org/jobs?id=42');
  for (const value of ['file:///tmp/job', 'javascript:alert(1)', 'https://person@host.example/path', 'bad']) {
    assert.equal(catalog.canonicalUrl(value), null);
  }
});

test('Work24 XML normalizes and deduplicates documented listing fields', () => {
  const row = `<wanted><wantedAuthNo>W2026</wantedAuthNo><company>A &amp; B</company>
    <title><![CDATA[React, TypeScript 백엔드]]></title><region>서울 마포구</region>
    <regDt>2026.11.19</regDt><closeDt>2026-13-01</closeDt><career>관계없음</career></wanted>`;
  const { total, jobs } = work24.parseWork24('<wantedRoot><total>2</total>' + row + row + '</wantedRoot>');
  assert.equal(total, 2);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, 'A & B');
  assert.deepEqual(jobs[0].skills, ['typescript', 'react']);
  assert.equal(jobs[0].posted_on, '2026-11-19');
  assert.equal(jobs[0].deadline, null);
  assert.equal(jobs[0].career, 'any');
  assert.equal(new URL(jobs[0].url).searchParams.get('wantedAuthNo'), 'W2026');
  assert.equal(catalog.canonicalUrl(
    'https://m.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?infoTypeCd=VALIDATION&wantedAuthNo=W2026'),
  jobs[0].url);
  assert.deepEqual(work24.parseWork24('<wantedRoot><total>0</total></wantedRoot>').jobs, []);
  for (const xml of ['<error>denied</error>', '<wantedRoot>', '<!DOCTYPE wantedRoot><wantedRoot/>']) {
    assert.throws(() => work24.parseWork24(xml));
  }
});

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('Nest health is reachable and rejects unauthorized calls and disabled sync', { timeout: 10000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...process.env, PORT: String(port), WORK24_ENABLED: 'false' },
    stdio: 'ignore',
  });
  try {
    const base = 'http://127.0.0.1:' + port;
    let health;
    for (let attempt = 0; attempt < 40 && !health; attempt += 1) {
      health = await fetch(base + '/health').catch(() => null);
      if (!health) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(health?.status, 200);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await health.json(), { ok: true });
    assert.equal((await fetch(base + '/jobs')).status, 401);
    assert.equal((await fetch(base + '/internal/work24')).status, 404);
  } finally {
    child.kill();
  }
});
