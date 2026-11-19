import { timingSafeEqual } from 'node:crypto';
import {
  Controller, Get, Headers, InternalServerErrorException, NotFoundException,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { SaxesParser } from 'saxes';
import { z } from 'zod';

const listUrl = 'https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do';
const detailUrl = 'https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do';
const maxBytes = 2_000_000;
const technologies = new Map([
  ['typescript', /\btypescript\b/i], ['javascript', /\bjavascript\b/i],
  ['nest.js', /\bnest\.?js\b/i], ['next.js', /\bnext\.?js\b/i],
  ['node.js', /\bnode\.?js\b/i], ['react', /\breact\b/i],
  ['java', /\bjava\b/i], ['spring', /\bspring\b/i], ['python', /\bpython\b/i],
  ['postgresql', /\bpostgres(?:ql)?\b/i],
]);

function normalizeDate(value = '') {
  const string = value.replace(/\./g, '-');
  return z.iso.date().safeParse(string).success ? string : null;
}

function normalizeCareer(value = '') {
  if (value.includes('무관') || (value.includes('신입') && value.includes('경력'))) return 'any';
  if (value.includes('경력')) return 'experienced';
  return value.includes('신입') ? 'entry' : 'unknown';
}

function toJob(row: Record<string, string>) {
  const id = row.wantedAuthNo;
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || !row.company || !row.title) return null;
  const url = new URL(detailUrl);
  url.search = new URLSearchParams({
    wantedAuthNo: id, infoTypeCd: 'VALIDATION', infoTypeGroup: 'tb_workinfoworknet',
  }).toString();
  return {
    source: 'work24', external_id: id, url: url.href, title: row.title.slice(0, 120),
    company: row.company.slice(0, 120), region: row.region?.slice(0, 120) ?? '',
    role: row.title.slice(0, 120), career: normalizeCareer(row.career),
    skills: Array.from(technologies).filter(([, pattern]) => pattern.test(row.title)).map(([name]) => name),
    deadline: normalizeDate(row.closeDt), posted_on: normalizeDate(row.regDt),
  };
}

export function parseWork24(xml: string) {
  const parser = new SaxesParser();
  const tags: string[] = [];
  const jobs = new Map<string, NonNullable<ReturnType<typeof toJob>>>();
  let row: Record<string, string> = Object.create(null);
  let field = '';
  let value = '';
  let total: number | undefined;
  parser.on('doctype', () => { throw new Error('Unexpected document type'); });
  parser.on('opentag', tag => {
    tags.push(tag.name);
    if (tags.length === 1 && tag.name !== 'wantedRoot') throw new Error('Unexpected XML root');
    if (tags.length === 2 && tag.name === 'wanted') row = Object.create(null);
    if ((tags.length === 2 && tag.name === 'total') || (tags.length === 3 && tags[1] === 'wanted')) {
      field = tag.name;
      value = '';
    }
  });
  const append = (chunk: string) => { if (field) value += chunk; };
  parser.on('text', append);
  parser.on('cdata', append);
  parser.on('closetag', tag => {
    if (tags.length === 2 && tag.name === 'total' && /^\d+$/.test(value.trim())) total = Number(value.trim());
    if (tags.length === 3 && tags[1] === 'wanted' && tag.name === field) row[field] = value.trim();
    if (tag.name === field) field = '';
    if (tags.length === 2 && tag.name === 'wanted') {
      const job = toJob(row);
      if (job) jobs.set(job.external_id, job);
    }
    tags.pop();
  });
  parser.write(xml).close();
  if (total === undefined || !Number.isSafeInteger(total) || (total > 0 && jobs.size === 0)) {
    throw new Error('Invalid Work24 listing');
  }
  return { total, jobs: [...jobs.values()] };
}

async function fetchPage(key: string, page: number, occupation: string) {
  const url = new URL(listUrl);
  url.search = new URLSearchParams({
    authKey: key, callTp: 'L', returnType: 'XML', startPage: String(page), display: '50', occupation,
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('Work24 request failed');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const reader = response.body.getReader();
  let size = 0;
  let xml = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Work24 response exceeded the size limit');
      xml += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return parseWork24(xml + decoder.decode());
}

const providerConfig = z.object({
  WORK24_API_KEY: z.string().min(1),
  WORK24_OCCUPATION: z.string().regex(/^\d+(\|\d+){0,5}$/),
  WORK24_DAILY_CAP: z.coerce.number().int().min(1).max(2),
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
});

@Controller('internal')
export class Work24Controller {
  @Get('work24')
  async sync(@Headers('authorization') authorization = '') {
    if (process.env.WORK24_ENABLED !== 'true') throw new NotFoundException();
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 32) throw new ServiceUnavailableException();
    const expected = Buffer.from('Bearer ' + secret);
    const received = Buffer.from(authorization);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException();
    }
    const config = providerConfig.safeParse(process.env);
    if (!config.success) throw new ServiceUnavailableException('고용24 설정을 확인해 주세요.');
    const env = config.data;
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    const claim = await db.from('ingest_days').insert({ day });
    if (claim.error?.code === '23505') return { skipped: true };
    if (claim.error) throw new InternalServerErrorException('수집 실행을 기록하지 못했습니다.');

    let written = 0;
    try {
      for (let page = 1; page <= env.WORK24_DAILY_CAP; page += 1) {
        const result = await fetchPage(env.WORK24_API_KEY, page, env.WORK24_OCCUPATION);
        if (result.jobs.length === 0) break;
        const { error } = await db.from('jobs').upsert(result.jobs, { onConflict: 'source,external_id' });
        if (error) throw new Error('Database write failed');
        written += result.jobs.length;
        if (result.total <= 50 * page) break;
      }
      const outcome = await db.from('ingest_days').update({ status: 'complete', written }).eq('day', day);
      if (outcome.error) throw new Error('Database write failed');
      return { written };
    } catch {
      await db.from('ingest_days').update({ status: 'failed', written }).eq('day', day);
      throw new ServiceUnavailableException('고용24 동기화에 실패했습니다.');
    }
  }
}
