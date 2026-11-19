import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { test } from 'node:test';
import catalog from '../apps/api/dist/catalog.js';
import work24 from '../apps/api/dist/work24.js';
import feeds from '../apps/api/dist/job-feeds.js';
import korean from '../apps/api/dist/korean-job-feeds.js';

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

test('public job feeds combine Korean listings, remove duplicates and apply filters', () => {
  const greenhouse = { source: 'greenhouse', token: 'sample', company: '회사 A' };
  const lever = { source: 'lever', token: 'sample', company: '회사 B' };
  const a = { id: 29, title: 'Backend Engineer Intern (Java)', location: { name: 'Seoul, South Korea' },
    absolute_url: 'https://job-boards.greenhouse.io/sample/jobs/29', updated_at: '2026-11-01T00:00:00Z' };
  const b = { id: 'example', text: 'Backend Developer, Kotlin', categories: { location: 'Seoul' },
    hostedUrl: 'https://jobs.lever.co/sample/example', createdAt: Date.parse('2026-11-02T00:00:00Z') };
  const jobs = [...feeds.parseBoard(greenhouse, { jobs: [a, a,
    { ...a, id: 30, title: 'Software Engineer 인재풀' },
    { ...a, id: 31, location: { name: 'Toronto, Canada' } },
    { ...a, id: 32, absolute_url: 'javascript:alert(1)' }] }), ...feeds.parseBoard(lever, [b])];
  const filters = { q: '백엔드 개발자', region: '서울', role: '', page: 1 };
  assert.deepEqual(feeds.searchJobFeeds(jobs, filters).items.map(job => job.source), ['lever', 'greenhouse']);
  assert.deepEqual(feeds.searchJobFeeds(jobs, { ...filters, career: 'entry', skill: 'java' }).items.map(job => job.title), [a.title]);
  assert.deepEqual(feeds.searchJobFeeds(jobs, { ...filters, region: '대전' }).items, []);
  assert.throws(() => feeds.parseBoard(lever, { error: 'Unavailable' }));
});

test('documented Korean providers map active jobs into one search', () => {
  const now = Date.parse('2026-11-19T02:00:00Z');
  const saramin = {
    id: '123', active: 1, url: 'http://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=123&utm_source=job-search-api',
    company: { detail: { name: '테스트 기업' } },
    position: { title: 'Java 백엔드 엔지니어', location: { name: '서울 > 마포구' },
      'experience-level': { code: '3' } },
    'posting-timestamp': String(Date.parse('2026-11-18T08:00:00Z') / 1000),
    'expiration-timestamp': String(Date.parse('2026-11-19T16:30:00Z') / 1000),
    'close-type': { code: '1' },
  };
  const wanted = { id: 12, status: 'active', name: '신입 백엔드 개발자',
    company: { name: '다른 기업' }, address: { country: '한국', location: '서울' },
    url: 'https://www.wanted.co.kr/wd/12', due_time: '2026-11-25' };
  const a = korean.parseSaramin({ jobs: { count: 2, job: [saramin, { ...saramin, active: 0 }] } }, now);
  const b = korean.parseWanted({ data: [wanted, { ...wanted, id: 13, status: 'close' },
    { ...wanted, id: 14, url: 'https://another.example/job' },
    { ...wanted, id: 15, address: { country: 'Japan' } },
    { ...wanted, id: 16, due_time: '2026-11-18' }] }, '2026-11-19');
  assert.equal(a[0].deadline, '2026-11-20');
  assert.equal(a[0].career, 'any');
  assert.equal(new URL(a[0].url).searchParams.get('utm_source'), 'job-search-api');
  assert.deepEqual(a[0].skills, ['java']);
  assert.equal(b[0].career, 'entry');
  const query = { q: '백엔드 개발자', region: '서울', role: '', page: 1 };
  const combined = feeds.searchJobFeeds([...a, ...b], query);
  assert.deepEqual(combined.items.map(job => job.source), ['saramin', 'wanted']);
  assert.deepEqual(feeds.searchJobFeeds([...a, ...b], { ...query, source: 'wanted' }).items.map(job => job.id), ['wanted:12']);
  assert.throws(() => korean.parseSaramin({ code: 4 }));
  assert.deepEqual(korean.parseSaramin({ jobs: { count: 0 } }, now), []);
});

test('Korean providers only request official endpoints after explicit configuration', async () => {
  const nativeFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), headers: init.headers });
    return Response.json(new URL(url).hostname === 'oapi.saramin.co.kr'
      ? { jobs: { count: 0 } }
      : { data: [] });
  };
  try {
    const waiting = await korean.loadKoreanFeeds({ SARAMIN_ACCESS_KEY: 'test', WANTED_ENABLED: 'true',
      WANTED_CLIENT_ID: 'test', WANTED_CLIENT_SECRET: 'test', WANTED_CATEGORY_TAG: '518',
      WANTED_API_ORIGIN: 'https://example.com' });
    assert.equal(waiting.saramin.state, 'pending');
    assert.equal(waiting.wanted.state, 'pending');
    assert.equal(calls.length, 0);
    const env = { SARAMIN_ENABLED: 'true', SARAMIN_ACCESS_KEY: 'test', WANTED_ENABLED: 'true',
      WANTED_CLIENT_ID: 'client', WANTED_CLIENT_SECRET: 'secret', WANTED_CATEGORY_TAG: '518',
      WANTED_API_ORIGIN: 'https://stg-openapi.wanted.jobs' };
    const [result] = await Promise.all([korean.loadKoreanFeeds(env), korean.loadKoreanFeeds(env)]);
    assert.equal(result.saramin.state, 'ready');
    assert.equal(result.wanted.state, 'ready');
    assert.equal(calls.length, 2);
    const saramin = calls.find(call => call.url.hostname === 'oapi.saramin.co.kr');
    const wanted = calls.find(call => call.url.hostname === 'stg-openapi.wanted.jobs');
    assert.equal(saramin.url.pathname, '/job-search');
    assert.equal(saramin.url.searchParams.get('job_mid_cd'), '2');
    assert.equal(wanted.url.pathname, '/v2/jobs');
    assert.equal(wanted.headers['wanted-client-id'], 'client');
    assert.equal(wanted.headers['wanted-client-secret'], 'secret');
    assert.ok(!wanted.url.href.includes('secret'));
  } finally {
    globalThis.fetch = nativeFetch;
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
    assert.equal((await fetch(base + '/discover')).status, 401);
    assert.equal((await fetch(base + '/internal/work24')).status, 404);
  } finally {
    child.kill();
  }
});
