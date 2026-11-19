import { z } from 'zod';
import { fetchJobFeedJson } from './job-feed-http';

type Source = 'greenhouse' | 'lever';
type Board = { source: Source; token: string; company: string; locations?: string[] };

const boards: Board[] = [
  { source: 'greenhouse', token: 'moloco', company: '몰로코 (Moloco)' },
  { source: 'greenhouse', token: 'commvault', company: '컴볼트 (Commvault)' },
  { source: 'greenhouse', token: 'seoulrobotics', company: '서울로보틱스 (Seoul Robotics)' },
  { source: 'greenhouse', token: 'get-delight', company: '센드버드 (Sendbird)' },
  { source: 'lever', token: 'clovirtualfashion', company: '클로버추얼패션 (CLO Virtual Fashion)', locations: ['Seoul'] },
  { source: 'lever', token: 'palantir', company: '팔란티어 (Palantir)', locations: ['Seoul, South Korea'] },
];

const greenhouseRow = z.object({
  id: z.number().int().positive(), title: z.string(), absolute_url: z.string(),
  location: z.object({ name: z.string() }), updated_at: z.string().optional(),
});
const leverRow = z.object({
  id: z.string().min(1), text: z.string(), hostedUrl: z.string(),
  categories: z.object({ location: z.string().optional(), allLocations: z.array(z.string()).optional() }),
  createdAt: z.number().optional(),
});

type SearchInput = {
  q: string; role: string; region: string; career?: string; skill?: string; page: number;
  source?: FeedJob['source'];
};
export type FeedJob = {
  id: string; source: Source | 'work24' | 'saramin' | 'wanted'; url: string; title: string; company: string; role: string; region: string;
  career: 'entry' | 'experienced' | 'any' | 'unknown'; skills: string[]; deadline: string | null; sortTime: number; originalUrl?: string;
};

const koreanLocation = /\b(?:korea|seoul|pangyo|seongnam|gyeonggi(?:do)?|daejeon|busan|incheon)\b|한국|서울|판교|성남|경기|대전|부산|인천/i;
const rolePatterns: [string, RegExp][] = [
  ['백엔드 개발자 Backend', /back[\s-]?end|백엔드|백앤드|서버 개발/i],
  ['풀스택 개발자 Full Stack', /full[\s-]?stack|풀스택/i],
  ['프론트엔드 개발자 Frontend', /front[\s-]?end|프론트엔드|프런트엔드/i],
  ['인프라 DevOps', /devops|site reliability|\bsre\b|인프라/i],
  ['소프트웨어 개발자 Software Engineering', /software|developer|machine learning engineer|data engineer|개발자|소프트웨어|프로그래머|전문연구요원/i],
];
const titleSkills: [string, RegExp][] = [
  ['node.js', /\bnode(?:\.?js)\b/i], ['nestjs', /\bnest(?:\.?js)\b/i],
  ['typescript', /\btypescript\b/i], ['javascript', /\bjavascript\b/i],
  ['java', /\bjava\b/i], ['kotlin', /\bkotlin\b/i], ['python', /\bpython\b/i],
  ['react', /\breact\b/i], ['go', /\b(?:go|golang)\b/i], ['spring boot', /\bspring boot\b/i],
  ['c#', /\bc#/i], ['c++', /\bc\+\+/i], ['next.js', /\bnext\.?js\b/i],
];

export const classifyJobRole = (title: string) => rolePatterns.find(([, pattern]) => pattern.test(title))?.[0];

export const inferJobSkills = (title: string) =>
  titleSkills.filter(([, pattern]) => pattern.test(title)).map(([skill]) => skill);

function classifyLocation(region: string) {
  const aliases = [
    [/\bseoul\b/i, '서울'], [/\b(?:pangyo|seongnam|gyeonggi(?:do)?)\b/i, '경기'],
    [/\bdaejeon\b/i, '대전'], [/\bbusan\b/i, '부산'], [/\bincheon\b/i, '인천'],
  ] as const;
  const local = aliases.find(([pattern]) => pattern.test(region))?.[1];
  return (local && !region.includes(local) ? local + ' · ' + region : region).slice(0, 120);
}

function toJob(board: Board, entry: {
  id: string | number; title: string; url: string; locations: string[]; time?: number;
}): FeedJob | null {
  const title = entry.title.trim();
  const location = entry.locations.find(value => koreanLocation.test(value));
  const role = classifyJobRole(title);
  if (!title || !location || !role || /expression of interest|talent (pool|community)|인재풀|채용\s*관심\s*등록/i.test(title)) return null;

  try {
    const url = new URL(entry.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048) return null;
    return {
      id: [board.source, board.token, entry.id].join(':'), source: board.source,
      url: url.href, title: title.slice(0, 120), company: board.company, role,
      region: classifyLocation(location),
      career: /\b(?:intern(?:ship)?|new grad(?:uate)?|entry[- ]level)\b|인턴|신입/i.test(title) ? 'entry'
        : /\b(?:senior|principal|staff|lead|manager)\b|경력/i.test(title) ? 'experienced' : 'unknown',
      skills: inferJobSkills(title),
      deadline: null, sortTime: Number.isFinite(entry.time) ? entry.time! : 0,
    };
  } catch {
    return null;
  }
}

export function parseBoard(board: Board, data: unknown): FeedJob[] {
  if (board.source === 'greenhouse') {
    const { jobs } = z.object({ jobs: z.array(z.unknown()) }).parse(data);
    return jobs.flatMap(value => {
      const row = greenhouseRow.safeParse(value);
      if (!row.success) return [];
      const { id, title, absolute_url, location, updated_at } = row.data;
      const job = toJob(board, { id, title, url: absolute_url, locations: [location.name], time: Date.parse(updated_at ?? '') });
      return job ? [job] : [];
    });
  }

  return z.array(z.unknown()).parse(data).flatMap(value => {
    const row = leverRow.safeParse(value);
    if (!row.success) return [];
    const { id, text, hostedUrl, categories, createdAt } = row.data;
    const job = toJob(board, {
      id, title: text, url: hostedUrl,
      locations: [categories.location ?? '', ...(categories.allLocations ?? [])], time: createdAt,
    });
    return job ? [job] : [];
  });
}

async function fetchBoard(board: Board) {
  const path = board.source === 'greenhouse'
    ? 'https://boards-api.greenhouse.io/v1/boards/' + board.token + '/jobs'
    : 'https://api.lever.co/v0/postings/' + board.token + '?mode=json';
  const url = new URL(path);
  for (const location of board.locations ?? []) url.searchParams.append('location', location);
  return parseBoard(board, await fetchJobFeedJson(url));
}

async function loadBoards() {
  const results = await Promise.allSettled(boards.map(fetchBoard));
  return {
    jobs: results.flatMap(result => result.status === 'fulfilled' ? result.value : []),
    failedAll: results.every(result => result.status === 'rejected'),
    unavailable: results.flatMap((result, index) => result.status === 'rejected' ? [boards[index].company] : []),
  };
}

let cache: { until: number; data: Awaited<ReturnType<typeof loadBoards>> } | undefined;
let pending: ReturnType<typeof loadBoards> | undefined;

export async function loadJobFeeds() {
  if (cache && Date.now() < cache.until) return cache.data;
  pending ??= loadBoards().then(data => {
    cache = { until: Date.now() + (data.unavailable.length ? 60_000 : 300_000), data };
    return data;
  }).finally(() => { pending = undefined; });
  return pending;
}

export function searchJobFeeds(jobs: FeedJob[], filters: SearchInput) {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s-]+/g, '');
  const contains = (value: string, term: string) => normalize(value).includes(normalize(term));
  const tokens = filters.q.trim().split(/\s+/);
  const matching = jobs.filter(job => tokens.every(term => contains([job.title, job.company, job.role, job.region].join(' '), term))
    && (!filters.source || job.source === filters.source)
    && contains(job.role, filters.role)
    && contains(job.region, filters.region)
    && (!filters.career || job.career === filters.career)
    && (!filters.skill || job.skills.includes(filters.skill)));
  matching.sort((a, b) => b.sortTime - a.sortTime || a.id.localeCompare(b.id));
  const byUrl = new Map<string, FeedJob>();
  for (const job of matching) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
  const distinct = [...byUrl.values()];
  const offset = (filters.page - 1) * 25;
  return {
    items: distinct.slice(offset, offset + 25).map(({ sortTime, ...job }) => job),
    hasMore: distinct.length > offset + 25,
  };
}
