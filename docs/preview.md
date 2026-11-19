# Preview 검증 절차

1. 독립 테스트 Supabase 프로젝트의 마이그레이션을 적용하고 테스트 계정 A와 B를 준비한다. 공개 가입을 끈다. 테스트 프로젝트를 기존 서비스와 공유하지 않는다.
2. Vercel Services로 `apps/web`과 `apps/api`를 같은 Preview URL에 배포한다. 저장소 루트의 `vercel.json`이 `/api` 경로를 NestJS로 연결한다. Production 전환은 별도 승인 후 진행한다.
3. Preview 브랜치의 `NEXT_PUBLIC_API_URL`은 `/api`로 설정한다. 프론트엔드와 API에 테스트 Supabase의 URL과 공개 키를 설정한다.
4. 로그인 후 통합 검색에서 Greenhouse와 Lever 공고가 함께 나오는지 확인한다. 키워드·지역 필터, 원문 이동, 지원 메모 저장과 재로그인 후 유지를 점검한다. 별도로 URL 직접 등록과 중복 방지, 두 계정 간 데이터 격리, 모바일 화면을 확인한다.
5. 고용24는 심사 승인, 데이터 저장·표시 범위 및 보존 방침, 일일 한도, 직종 코드, 출처 이미지 확인 후에만 활성화한다. 승인된 테스트 키로 호출 1회와 결과를 검토한다. 공급처 보존 정책이 요구하는 정리 로직과 실행 승인은 실수집 전에 준비한다. Vercel의 Cron은 Production 기능이므로 승인 전 연결하지 않는다.
6. Preview 결과와 비용 조건을 기록하고 Production 배포 및 운영 변경 승인을 구한다.
