import {
  BadRequestException, Body, Controller, Get, Headers,
  InternalServerErrorException, NotFoundException, Param, Post, Put, Query,
  UnauthorizedException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const career = z.enum(['entry', 'experienced', 'any', 'unknown']);
const short = z.string().trim().max(120);
const date = z.iso.date().refine(value => value >= '1900-01-01');
const label = z.string().trim().min(1).max(40).transform(value => value.toLowerCase());
const labels = z.array(label).max(20).transform(items => [...new Set(items)]);
export function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (['www.work24.go.kr', 'm.work24.go.kr'].includes(url.hostname)
      && url.pathname === '/wk/a/b/1500/empDetailAuthView.do') {
      const id = url.searchParams.get('wantedAuthNo');
      const provider = url.searchParams.get('infoTypeCd');
      if (id && /^[A-Za-z0-9_-]{1,64}$/.test(id) && (!provider || provider === 'VALIDATION')) {
        const official = new URL('https://www.work24.go.kr' + url.pathname);
        official.search = new URLSearchParams({
          wantedAuthNo: id, infoTypeCd: 'VALIDATION', infoTypeGroup: 'tb_workinfoworknet',
        }).toString();
        return official.href;
      }
    }
    url.hash = '';
    const tracking = /^(utm_.+|fbclid|gclid)$/i;
    for (const key of Array.from(url.searchParams.keys())) {
      if (tracking.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}
const listing = z.object({
  url: z.string().trim().max(2048).refine(value => canonicalUrl(value) !== null),
  title: short.refine(Boolean), company: short.refine(Boolean),
  role: short.default(''), region: short.default(''), career: career.default('unknown'),
  skills: labels.default([]), deadline: date.nullable().default(null),
});
const filters = z.object({
  q: short.default(''), role: short.default(''), region: short.default(''),
  career: career.optional(), skill: label.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  saved: z.enum(['true', 'false']).default('false'),
});
const tracking = z.object({
  favorite: z.boolean(),
  status: z.enum(['interested', 'applied', 'interview', 'result']).nullable(),
  notes: z.string().max(4000), tags: labels, deadline: date.nullable(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('입력값을 확인해 주세요.');
  return result.data;
}

async function session(header?: string) {
  const token = /^Bearer ([^\s]+)$/.exec(header ?? '')?.[1];
  if (!token) throw new UnauthorizedException();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new InternalServerErrorException('Supabase 설정이 필요합니다.');
  const db = createClient(url, key, {
    accessToken: async () => token,
  });
  const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) throw new UnauthorizedException();
  return { db, userId: data.user.id };
}

function check(error: { code: string } | null) {
  if (error?.code === '42501') throw new NotFoundException();
  if (error) throw new InternalServerErrorException('저장소 요청을 처리하지 못했습니다.');
}

@Controller()
export class CatalogController {
  @Get('health')
  health() { return { ok: true }; }

  @Get('jobs')
  async search(@Headers('authorization') header: string, @Query() query: unknown) {
    const { db } = await session(header);
    const input = parse(filters, query);
    const { data, error } = await db.rpc('search_jobs', {
      term: input.q, role_filter: input.role, region_filter: input.region,
      career_filter: input.career ?? null, skill_filter: input.skill ?? null,
      page_number: input.page, saved_only: input.saved === 'true',
    });
    check(error);
    return data;
  }

  @Post('jobs')
  async create(@Headers('authorization') header: string, @Body() body: unknown) {
    const { db, userId } = await session(header);
    const job = parse(listing, body);
    const url = canonicalUrl(job.url)!;
    const official = await db.from('jobs').select('id').eq('source', 'work24').eq('url', url).maybeSingle();
    check(official.error);
    if (official.data) return official.data;
    const saved = await db.from('jobs').upsert({
      ...job, url, owner_id: userId, source: 'manual',
    }, { onConflict: 'owner_id,url', ignoreDuplicates: true });
    check(saved.error);
    const row = await db.from('jobs').select('id').eq('owner_id', userId).eq('url', url).single();
    check(row.error);
    return row.data;
  }

  @Put('jobs/:id/tracking')
  async save(
    @Headers('authorization') header: string, @Param('id') id: string, @Body() body: unknown,
  ) {
    const { db, userId } = await session(header);
    const jobId = parse(z.uuid(), id);
    const payload = parse(tracking, body);
    const job = await db.from('jobs').select('id').eq('id', jobId).maybeSingle();
    check(job.error);
    if (!job.data) throw new NotFoundException();
    const { error } = await db.from('tracking').upsert({
      ...payload, user_id: userId, job_id: jobId,
    }, { onConflict: 'user_id,job_id' });
    check(error);
    return { ok: true };
  }
}
