# Preview 검증 절차

1. 독립 테스트 Supabase 프로젝트의 마이그레이션을 적용하고 테스트 계정 A와 B를 준비한다. 공개 가입을 끈다. 테스트 프로젝트를 기존 서비스와 공유하지 않는다.
2. Vercel에서 Node.js 22로 두 프로젝트를 준비한다. 백엔드 Root Directory는 apps/api(NestJS), 프론트엔드는 apps/web(Next.js)로 설정한다. 두 프로젝트에 같은 독립 저장소와 Preview 브랜치를 사용한다. Production 자동 연결은 승인 전에 적용하지 않는다.
3. API의 WEB_ORIGIN은 정확한 프론트엔드 Preview origin에 맞추고 NEXT_PUBLIC_API_URL은 API Preview URL에 맞춘다. .env.example에 있는 Supabase 공개 연결 값을 두 프로젝트에 넣는다. 브라우저가 API를 호출할 수 있도록 Preview 접근 정책도 확인한다.
4. 로그인 → URL 등록 → 중복 등록 → 검색·필터 → 저장 → 다시 로그인 → 동일 값 확인을 진행한다. 두 계정과 모바일 너비에서도 확인한다.
5. 고용24는 심사 승인, 데이터 저장·표시 범위 및 보존 방침, 일일 한도, 직종 코드, 출처 이미지 확인 후에만 활성화한다. 승인된 테스트 키로 호출 1회와 결과를 검토한다. 공급처 보존 정책이 요구하는 정리 로직과 실행 승인은 실수집 전에 준비한다. Vercel의 Cron은 Production 기능이므로 승인 전 연결하지 않는다.
6. Preview 결과와 비용 조건을 기록하고 Production 배포 및 운영 변경 승인을 구한다.
