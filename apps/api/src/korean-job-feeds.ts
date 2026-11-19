import { z } from 'zod';
import { fetchJobFeedJson } from './job-feed-http';
import { classifyJobRole, inferJobSkills, type FeedJob } from './job-feeds';

const code = z.union([z.string(), z.number()]).transform(String);
const name = z.object({ name: z.string() });
const saraminRow = z.object({
  id: code, active: code, url: z.string(), company: z.object({ detail: name }),
  position: z.object({
    title: z.string(), location: name.optional(),
    'job-code': name.optional(), 'experience-level': z.object({ code }).optional(),
  }),
  'posting-timestamp': code.optional(), 'expiration-timestamp': code.optional(),
  'close-type': z.object({ code }).optional(),
});
const wantedRow = z.object({
  id: z.number().int().positive(), status: z.string(), url: z.string(),
  position: z.string().nullish(), name: z.string().nullish(),
  company: name, due_time: z.string().nullish(),
  address: z.object({ country: z.string().nullish(), location: z.string().nullish() }).nullish(),
});

const koreaClock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
export const koreaDate = (time = Date.now()) => koreaClock.format(time);

function sourceUrl(value: string, host: string) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (url.hostname !== host && url.hostname !== 'www.' + host && url.hostname !== 'm.' + host) return null;
    url.protocol = 'https:';
    return url.href.length <= 2048 ? url.href : null;
  } catch {
    return null;
  }
}

function unixTime(value: string | undefined) {
  const time = Number(value) * 1000;
  return Number.isFinite(time) && time > 0 && time < 8.64e15 ? time : 0;
}

export function parseSaramin(data: unknown, now = Date.now()): FeedJob[] {
  const { jobs } = z.object({ jobs: z.object({
    count: code,
    job: z.array(z.unknown()).optional(),
  }) }).parse(data);
  if (!jobs.job && jobs.count !== '0') throw new Error('Unexpected Saramin response');

  return (jobs.job ?? []).flatMap(value => {
    const parsed = saraminRow.safeParse(value);
    if (!parsed.success) return [];
    const row = parsed.data;
    const url = sourceUrl(row.url, 'saramin.co.kr');
    const title = row.position.title.trim();
    const company = row.company.detail.name.trim();
    const expiration = row['close-type']?.code === '1' ? unixTime(row['expiration-timestamp']) : 0;
    if (!row.id || !url || !title || !company || row.active !== '1' || (expiration && expiration <= now)) return [];
    const experience = row.position['experience-level']?.code;
    return [{
      id: 'saramin:' + row.id, source: 'saramin', url, company: company.slice(0, 120), title: title.slice(0, 120),
      role: (classifyJobRole(title) ?? row.position['job-code']?.name ?? '').slice(0, 120),
      region: (row.position.location?.name ?? '').slice(0, 120),
      career: experience === '1' ? 'entry' : experience === '2' ? 'experienced'
        : experience === '0' || experience === '3' ? 'any' : 'unknown',
      deadline: expiration ? koreaDate(expiration) : null, skills: inferJobSkills(title),
      sortTime: unixTime(row['posting-timestamp']),
    }];
  });
}

export function parseWanted(payload: unknown, today = koreaDate()): FeedJob[] {
  const { data } = z.object({ data: z.array(z.unknown()) }).parse(payload);
  return data.flatMap(value => {
    const parsed = wantedRow.safeParse(value);
    if (!parsed.success) return [];
    const row = parsed.data;
    const url = sourceUrl(row.url, 'wanted.co.kr');
    const title = (row.position ?? row.name ?? '').trim();
    const company = row.company.name.trim();
    const due = z.iso.date().safeParse(row.due_time);
    const region = row.address?.location?.trim() ?? '';
    const country = row.address?.country?.trim();
    if (!url || !title || !company || row.status !== 'active' || (due.success && due.data < today)) return [];
    if (country && !/^(?:kr|kor|korea|south korea|republic of korea|한국|대한민국|한국\s*\(kr\))$/i.test(country)) return [];
    return [{
      id: 'wanted:' + row.id, source: 'wanted', url, company: company.slice(0, 120), title: title.slice(0, 120),
      role: classifyJobRole(title) ?? 'IT 개발', region: region.slice(0, 120),
      career: /\b(?:intern(?:ship)?|new grad(?:uate)?)\b|인턴|신입/i.test(title) ? 'entry' : 'unknown',
      deadline: due.success ? due.data : null, skills: inferJobSkills(title), sortTime: 0,
    }];
  });
}

type Platform = 'saramin' | 'wanted';
export type PlatformFeed = { jobs: FeedJob[]; state: 'ready' | 'pending' | 'unavailable' };
type Memo = { expires: number; value?: PlatformFeed; pending?: Promise<PlatformFeed> };
const cache = new Map<Platform, Memo>();

async function load(platform: Platform, fetchJobs: (() => Promise<FeedJob[]>) | undefined): Promise<PlatformFeed> {
  if (!fetchJobs) return { jobs: [], state: 'pending' };
  const previous = cache.get(platform);
  if (previous?.pending) return previous.pending;
  if (previous?.value && previous.expires > Date.now()) return previous.value;
  const pending = fetchJobs().then(
    (jobs): PlatformFeed => ({ jobs, state: 'ready' }),
    (): PlatformFeed => ({ jobs: [], state: 'unavailable' }),
  ).then(value => {
    const minutes = value.state === 'ready' ? (platform === 'saramin' ? 240 : 30) : 10;
    cache.set(platform, { value, expires: Date.now() + minutes * 60_000 });
    return value;
  });
  cache.set(platform, { expires: 0, pending });
  return pending;
}

export async function loadKoreanFeeds(env = process.env) {
  const saramin = env.SARAMIN_ENABLED === 'true' && env.SARAMIN_ACCESS_KEY?.trim();
  const wanted = env.WANTED_ENABLED === 'true' && env.WANTED_CLIENT_ID?.trim() && env.WANTED_CLIENT_SECRET?.trim()
    && /^\d+$/.test(env.WANTED_CATEGORY_TAG ?? '')
    && ['https://stg-openapi.wanted.jobs', 'https://dev-openapi.wanted.jobs', 'https://openapi.wanted.jobs']
      .includes(env.WANTED_API_ORIGIN ?? '');

  const [saraminFeed, wantedFeed] = await Promise.all([
    load('saramin', saramin ? async () => {
      const url = new URL('https://oapi.saramin.co.kr/job-search');
      url.search = new URLSearchParams({ 'access-key': saramin, job_mid_cd: '2', count: '50', sort: 'pd' }).toString();
      return parseSaramin(await fetchJobFeedJson(url));
    } : undefined),
    load('wanted', wanted ? async () => {
      const url = new URL('/v2/jobs', env.WANTED_API_ORIGIN);
      url.search = new URLSearchParams({
        category_tag: env.WANTED_CATEGORY_TAG!, locations: 'kr', limit: '20', sort: 'job.latest_order',
      }).toString();
      return parseWanted(await fetchJobFeedJson(url, {
        'wanted-client-id': env.WANTED_CLIENT_ID!, 'wanted-client-secret': env.WANTED_CLIENT_SECRET!,
      }));
    } : undefined),
  ]);
  return { saramin: saraminFeed, wanted: wantedFeed };
}
