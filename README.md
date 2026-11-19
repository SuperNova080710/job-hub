# Job Hub

신입 백엔드·풀스택 구직자를 위한 개인 채용공고 검색 및 지원 관리 도구입니다. [MVP 명세](docs/mvp.md), [작업 및 PR 목록](docs/backlog.md), [Preview 검증 절차](docs/preview.md)를 참고하세요.

## 로컬 실행

1. Node.js 22와 npm을 준비하고 `npm ci`를 실행합니다.
2. 독립 테스트용 Supabase 또는 로컬 Supabase에 `supabase/migrations`를 순서대로 적용합니다. Auth에서 테스트 계정을 만들고 공개 회원가입 및 익명 로그인을 끕니다.
3. `apps/api/.env.example`과 `apps/web/.env.example`을 각각 `.env`, `.env.local`로 복사하고 테스트 환경의 값을 입력합니다.
4. 두 터미널에서 `npm run dev -w @job-hub/api`와 `npm run dev -w @job-hub/web`을 실행합니다. 브라우저에서 http://localhost:3000 을 열고 로그인합니다.
5. `npm test`와 `npm run build`로 검증합니다.

고용24 실호출은 기본 비활성입니다. 공식 승인 범위와 일일 한도, 저장·보존 조건 및 출처 이미지 사용 조건을 확인한 뒤 환경 변수를 설정합니다. Production 전환 및 운영 DB의 파괴적 작업은 사용자 승인 후 진행합니다.
