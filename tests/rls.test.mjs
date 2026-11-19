import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const manual = '10000000-0000-4000-8000-000000000001';
const official = '10000000-0000-4000-8000-000000000002';

test('migrations enforce ownership and search deduplicates visible links', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to authenticated;
      insert into auth.users values ('${a}'), ('${b}');
    `);
    for (const file of ['202611190001_catalog.sql', '202611190002_work24.sql']) {
      await db.exec(await readFile(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
    }
    await db.exec(`
      set role anon;
    `);
    await assert.rejects(db.query('select * from public.jobs'), { code: '42501' });
    await db.exec(`
      reset role;
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${a}', false);
      insert into jobs (id, owner_id, source, url, title, company, role, career, region, skills, deadline)
      values ('${manual}', '${a}', 'manual', 'https://example.org/one', '백엔드 개발', '테스트 회사',
        '백엔드', 'entry', '서울', array['typescript'], '2027-01-01');
      insert into tracking (user_id, job_id, favorite, status, notes, tags, deadline) values
        ('${a}', '${manual}', true, 'interview', '면접 준비', array['우선'], '2026-12-31');
    `);
    const insertManual = `insert into jobs (owner_id, source, url, title, company)
      values ('${a}', 'manual', 'https://example.org/one', '중복', '테스트')
      on conflict (owner_id, url) do nothing returning id`;
    assert.equal((await db.query(insertManual)).rows.length, 0);
    await assert.rejects(db.query(`insert into jobs (source, external_id, url, title, company)
      values ('work24', 'FAKE', 'https://example.org/fake', '가짜', '테스트')`), { code: '42501' });
    await assert.rejects(db.query('insert into ingest_days(day) values (current_date)'), { code: '42501' });

    await db.exec(`select set_config('request.jwt.claim.sub', '${b}', false)`);
    assert.equal((await db.query('select * from jobs')).rows.length, 0);
    assert.equal((await db.query('select * from tracking')).rows.length, 0);
    assert.equal((await db.query("update tracking set notes = '변경' returning *")).rows.length, 0);
    await assert.rejects(db.query(`insert into tracking(user_id, job_id) values ('${b}','${manual}')`),
      { code: '42501' });

    await db.exec(`
      reset role;
      set role service_role;
      insert into jobs (id, source, external_id, url, title, company, career)
        values ('${official}','work24','EXAMPLE','https://example.org/one','백엔드 공고','테스트 회사','entry');
      insert into ingest_days(day) values (current_date);
    `);
    await assert.rejects(db.query('insert into ingest_days(day) values (current_date)'), { code: '23505' });

    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${a}', false)`);
    const search = async (input = ['', '', '', null, null, 1, false]) =>
      (await db.query('select public.search_jobs($1,$2,$3,$4,$5,$6,$7) as result', input)).rows[0].result;
    assert.deepEqual((await search()).items.map(job => job.id), [manual]);
    const result = await search(['테스트', '백엔드', '서울', 'entry', 'typescript', 1, true]);
    assert.equal(result.items[0].tracking.notes, '면접 준비');
    assert.equal(result.items[0].tracking.deadline, '2026-12-31');
    assert.equal(result.hasMore, false);
    assert.equal((await search(['', '', '', null, 'python', 1, false])).items.length, 0);
    await db.exec(`select set_config('request.jwt.claim.sub', '${b}', false)`);
    assert.deepEqual((await search()).items.map(job => job.id), [official]);
    assert.equal((await search()).items[0].tracking, null);
  } finally {
    await db.close();
  }
});
