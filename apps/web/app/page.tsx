'use client';

import { createClient } from '@supabase/supabase-js';
import { useEffect, useRef, useState, type FormEvent } from 'react';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const auth = url && key ? createClient(url, key, {
  auth: { persistSession: false, detectSessionInUrl: false },
}).auth : null;
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const attribution = process.env.NEXT_PUBLIC_WORK24_ATTRIBUTION_IMAGE;
const careers = { entry: '신입', experienced: '경력', any: '경력무관', unknown: '미확인' };
const statuses = { interested: '관심', applied: '지원', interview: '면접', result: '결과' };
type Tracking = {
  favorite: boolean; status: keyof typeof statuses | null; notes: string;
  tags: string[]; deadline: string | null;
};
type Job = {
  id: string; url: string; source: 'manual' | 'work24'; title: string; company: string;
  role: string; region: string; career: keyof typeof careers; skills: string[];
  deadline: string | null; tracking: Tracking | null;
};
type Results = { items: Job[]; hasMore: boolean };
const blank: Tracking = { favorite: false, status: null, notes: '', tags: [], deadline: null };
const empty: Results = { items: [], hasMore: false };
const split = (value: FormDataEntryValue | null) => String(value ?? '').split(',').map(s => s.trim()).filter(Boolean);

function Career({ filter = false }: { filter?: boolean }) {
  return <label>경력<select name="career" defaultValue={filter ? '' : 'unknown'}>
    {filter && <option value="">전체</option>}
    {Object.entries(careers).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
  </select></label>;
}

function JobCard({ job, save }: { job: Job; save: (id: string, values: Tracking) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const current = job.tracking ?? blank;
  const work24 = job.source === 'work24';
  const deadline = current.deadline ?? job.deadline;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setFeedback('');
    try {
      await save(job.id, {
        favorite: fields.has('favorite'), status: (fields.get('status') || null) as Tracking['status'],
        notes: String(fields.get('notes') ?? ''), tags: split(fields.get('tags')),
        deadline: String(fields.get('deadline') ?? '') || null,
      });
      setFeedback('저장했습니다.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : '저장에 실패했습니다.');
    } finally {
      setPending(false);
    }
  }
  return <article className="card">
    <div className="meta"><span>{work24 ? '고용24' : '직접 등록'}</span>
      <span>{deadline ? (current.deadline ? '개인 마감 ' : '공고 마감 ') + deadline : '마감일 미정'}</span></div>
    <h2>{job.title}</h2>
    <p>{[job.company, job.role, careers[job.career], job.region].filter(Boolean).join(' · ')}</p>
    {job.skills.length > 0 && <div className="chips">{job.skills.map(skill => <span key={skill}>{skill}</span>)}</div>}
    <a href={job.url} target="_blank" rel="noopener noreferrer">{work24 ? '채용정보 제공사이트로 이동' : '원문 공고 열기'} ↗</a>
    {work24 && <footer>{attribution && <img src={attribution} alt="고용24" width={100} />}
      <small>본 자료는 고용노동부 고용24(www.work24.go.kr)에서 제공된 정보이며, 무단복제 및 배포를 금지합니다.</small>
    </footer>}
    <details><summary>{current.favorite ? '★ ' : ''}{current.status ? statuses[current.status] + ' · ' : ''}지원 관리</summary>
      <form className="form" onSubmit={submit}>
        <label className="check"><input type="checkbox" name="favorite" defaultChecked={current.favorite} /> 즐겨찾기</label>
        <label>지원 상태<select name="status" defaultValue={current.status ?? ''}>
          <option value="">미설정</option>
          {Object.entries(statuses).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
        </select></label>
        <label>개인 마감일<input type="date" name="deadline" defaultValue={current.deadline ?? ''} /></label>
        <label>태그<input name="tags" defaultValue={current.tags.join(', ')} placeholder="쉼표로 구분" /></label>
        <label>메모<textarea name="notes" maxLength={4000} defaultValue={current.notes} /></label>
        <button disabled={pending}>저장</button>
        {feedback && <p role="status">{feedback}</p>}
      </form>
    </details>
  </article>;
}

export default function Home() {
  const [token, setToken] = useState('');
  const [results, setResults] = useState<Results>(empty);
  const [mode, setMode] = useState<'all' | 'saved'>('all');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [registerPending, setRegisterPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);
  const [filters, setFilters] = useState('');
  const seenUser = useRef<string | undefined>(undefined);

  useEffect(() => {
    const subscription = auth?.onAuthStateChange((_event, session) => {
      const user = session?.user.id;
      if (seenUser.current !== user) {
        setResults(empty);
        setError('');
        setNotice('');
        seenUser.current = user;
      }
      setToken(session?.access_token ?? '');
    }).data.subscription;
    return () => subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const params = new URLSearchParams(filters);
    params.set('saved', String(mode === 'saved'));
    params.set('page', String(page));
    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(api + '/jobs?' + params, {
          headers: { Authorization: 'Bearer ' + token }, signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 401 ? '다시 로그인해 주세요.' : '공고를 불러오지 못했습니다.');
        const data: Results = await response.json();
        if (controller.signal.aborted) return;
        if (data.items.length === 0 && page > 1) setPage(page - 1);
        else setResults(data);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '검색에 실패했습니다.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [token, filters, mode, page, version]);

  async function request(path: string, method: string, body: unknown) {
    const response = await fetch(api + path, {
      method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data.message === 'string' && response.status === 400
        ? data.message : '요청을 저장하지 못했습니다.');
    }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;
    setError('');
    setLoginPending(true);
    const values = new FormData(event.currentTarget);
    try {
      const result = await auth.signInWithPassword({
        email: String(values.get('email')), password: String(values.get('password')),
      });
      if (result.error) setError('로그인 정보를 확인해 주세요.');
    } catch {
      setError('인증 서비스에 연결하지 못했습니다.');
    } finally {
      setLoginPending(false);
    }
  }
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRegisterPending(true);
    setError('');
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      await request('/jobs', 'POST', {
        ...Object.fromEntries(fields), skills: split(fields.get('skills')),
        deadline: String(fields.get('deadline') ?? '') || null,
      });
      form.reset();
      setAdding(false);
      setMode('all');
      setPage(1);
      setFilters('');
      setVersion(value => value + 1);
      setNotice('공고 링크를 저장했습니다.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '공고 등록에 실패했습니다.');
    } finally {
      setRegisterPending(false);
    }
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(event.currentTarget)) {
      if (String(value).trim()) params.set(name, String(value).trim());
    }
    setPage(1);
    setFilters(params.toString());
  }

  const activeFilters = new URLSearchParams(filters);
  return <>
    <header><div className="bar"><strong>Job Hub</strong>
      {token && <button className="quiet" onClick={() => void auth?.signOut().then(result => {
        if (result.error) setError('로그아웃에 실패했습니다.');
      })}>로그아웃</button>}</div></header>
    {!token ? <main className="login"><section className="card"><h1>로그인</h1>
      {auth ? <form className="form" onSubmit={login}>
        <label>이메일<input name="email" type="email" autoComplete="email" required /></label>
        <label>비밀번호<input name="password" type="password" autoComplete="current-password" required /></label>
        <button disabled={loginPending}>로그인</button>
      </form> : <p>Supabase 연결 설정이 필요합니다.</p>}
      {error && <p role="alert">{error}</p>}
    </section></main> : <main>
      <div className="heading"><div><h1>{mode === 'all' ? '채용공고' : '내 지원 현황'}</h1></div>
        <button aria-expanded={adding} onClick={() => { setAdding(!adding); setNotice(''); }}>공고 링크 등록</button></div>
      <nav aria-label="공고 메뉴">
        <button aria-pressed={mode === 'all'} onClick={() => { setMode('all'); setPage(1); }}>통합 검색</button>
        <button aria-pressed={mode === 'saved'} onClick={() => { setMode('saved'); setPage(1); }}>내 공고</button>
      </nav>
      {adding && <section className="card"><h2>공고 링크 등록</h2>
        <form className="form grid" onSubmit={add}>
          <label className="wide">공고 URL<input type="url" name="url" maxLength={2048} required /></label>
          <label>공고 제목<input name="title" maxLength={120} required /></label>
          <label>회사<input name="company" maxLength={120} required /></label>
          <label>직무<input name="role" maxLength={120} /></label><Career />
          <label>지역<input name="region" maxLength={120} /></label>
          <label>기술 스택<input name="skills" placeholder="쉼표로 구분" /></label>
          <label>공고 마감일<input type="date" name="deadline" /></label>
          <button disabled={registerPending}>등록</button>
        </form>
      </section>}
      <form key={filters} className="card form grid" onSubmit={search}>
        <label className="wide">검색어<input name="q" maxLength={120} defaultValue={activeFilters.get('q') ?? ''} placeholder="직무, 회사, 지역" /></label>
        <label>직무<input name="role" maxLength={120} defaultValue={activeFilters.get('role') ?? ''} /></label>
        <label>경력<select name="career" defaultValue={activeFilters.get('career') ?? ''}>
          <option value="">전체</option>{Object.entries(careers).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
        </select></label>
        <label>지역<input name="region" maxLength={120} defaultValue={activeFilters.get('region') ?? ''} /></label>
        <label>기술 스택<input name="skill" maxLength={40} defaultValue={activeFilters.get('skill') ?? ''} placeholder="예. TypeScript" /></label>
        <div className="actions wide"><button>검색</button><button type="button" className="quiet" onClick={() => {
          setPage(1); setFilters(''); setVersion(value => value + 1);
        }}>초기화</button></div>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">불러오는 중…</p>}
      {!loading && !error && results.items.length === 0 && <p className="empty">표시할 공고가 없습니다.</p>}
      <div className="results">{results.items.map(job => <JobCard key={job.id} job={job} save={async (id, values) => {
        await request('/jobs/' + id + '/tracking', 'PUT', values);
        setResults(previous => ({
          ...previous, items: previous.items.map(item => item.id === id ? { ...item, tracking: values } : item),
        }));
        setVersion(value => value + 1);
      }} />)}</div>
      {(page > 1 || results.hasMore) && <div className="pagination">
        <button disabled={loading || page === 1} onClick={() => setPage(page - 1)}>이전</button>
        <span>{page} 페이지</span>
        <button disabled={loading || !results.hasMore || page >= 1000} onClick={() => setPage(page + 1)}>다음</button>
      </div>}
    </main>}
  </>;
}
