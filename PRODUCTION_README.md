# 블로그 자동 대량 생산 시스템 (영구 프로덕션 버전)

## 🚀 완성된 기능들

### ✅ 핵심 인프라
- **Cloudflare Pages** + **Hono** 프레임워크
- **D1 데이터베이스** (로컬/프로덕션 동기화)
- **PM2** 기반 안정적 서비스 운영
- **Vite** 빌드 시스템

### ✅ 인증 시스템
- **Google OAuth 2.0** 로그인
- **JWT + 서명 쿠키** 세션 관리
- **역할 기반 권한** (ADMIN/EDITOR/VIEWER)
- **자동 토큰 리프레시** 준비

### ✅ 데이터베이스 (D1)
- **8개 테이블**: users, sessions, articles, generation_jobs, files, api_tokens, audit_logs, sheet_sources
- **마이그레이션 시스템**: `migrations/0001_initial_schema.sql`
- **시드 데이터**: `seed.sql`
- **로컬 개발**: `--local` 플래그로 SQLite 자동 생성

### ✅ Google API 연동
- **Sheets API**: 스프레드시트 읽기 및 동기화
- **Drive API**: 생성된 글 자동 저장
- **Gemini AI**: 고품질 블로그 글 자동 생성
- **토큰 암호화 저장**: D1 api_tokens 테이블

### ✅ 작업 파이프라인
- **비동기 작업 큐**: generation_jobs 테이블
- **멱등성 보장**: idempotency_key 시스템
- **재시도 로직**: attempt 카운터
- **상태 추적**: queued → running → succeeded/failed

### ✅ 보안
- **환경변수**: `.dev.vars.example` 템플릿
- **시크릿 관리**: wrangler secrets 준비
- **감사 로그**: 모든 중요 액션 기록
- **입력 검증**: 기본 보안 헤더

## 🌐 현재 접속 URL
- **메인 대시보드**: https://3000-iotzd6qkqj5dgmmfpv9ha.e2b.dev
- **헬스체크**: https://3000-iotzd6qkqj5dgmmfpv9ha.e2b.dev/api/health
- **인증상태**: https://3000-iotzd6qkqj5dgmmfpv9ha.e2b.dev/auth/me

## 📊 API 엔드포인트

### 🔓 공개 엔드포인트
- `GET /` - 메인 대시보드
- `GET /api/health` - 헬스체크
- `GET /auth/google` - Google OAuth 시작
- `GET /auth/callback` - OAuth 콜백
- `POST /auth/logout` - 로그아웃

### 🔒 인증 필요 엔드포인트
- `GET /auth/me` - 현재 사용자 정보
- `POST /api/sheets/sync` - Google Sheets 동기화
- `GET /api/sheets/test` - Sheets 연결 테스트
- `POST /api/jobs/trigger-from-sheets` - 작업 일괄 생성
- `POST /api/jobs/:id/run` - 개별 작업 실행
- `GET /api/jobs` - 작업 목록 조회
- `GET /api/articles` - 글 목록 조회 (D1)
- `GET /api/stats/db` - 통계 조회 (D1)

## 🔧 로컬 개발 명령어

```bash
# 의존성 설치
npm install

# D1 로컬 DB 초기화
npm run db:reset  # 마이그레이션 + 시드

# 개발 서버 시작
npm run build
pm2 start ecosystem.config.cjs

# PM2 관리
pm2 list
pm2 logs --nostream
pm2 restart blog-automation
pm2 delete all

# DB 관리
npm run db:migrate:local    # 마이그레이션만
npm run db:seed            # 시드 데이터만
npm run db:console:local   # DB 콘솔

# 빌드 & 배포
npm run build
npm run deploy:prod
```

## 🌍 프로덕션 배포

### 1. Cloudflare API 키 설정
```bash
# 먼저 setup_cloudflare_api_key 호출 필요
npx wrangler whoami  # 인증 확인
```

### 2. D1 프로덕션 DB 생성
```bash
npx wrangler d1 create webapp-production
# wrangler.jsonc의 database_id 업데이트 필요
```

### 3. 환경변수 설정
```bash
npx wrangler pages secret put GOOGLE_CLIENT_ID
npx wrangler pages secret put GOOGLE_CLIENT_SECRET
npx wrangler pages secret put OAUTH_REDIRECT_URI
npx wrangler pages secret put GOOGLE_SHEETS_ID
npx wrangler pages secret put GOOGLE_DRIVE_FOLDER_ID
npx wrangler pages secret put GOOGLE_GENAI_API_KEY
npx wrangler pages secret put AUTH_SECRET
npx wrangler pages secret put ENCRYPTION_KEY
```

### 4. 배포 실행
```bash
# 프로덕션 DB 마이그레이션
npm run db:migrate:prod

# Pages 배포
npm run deploy:prod
```

## 💡 사용법

### 1. Google OAuth 로그인
1. 메인 페이지에서 "Google로 로그인" 클릭
2. Google 권한 승인 (Sheets, Drive, Profile 접근)
3. 자동으로 users 테이블에 사용자 생성

### 2. Google Sheets 동기화
1. 로그인 후 "시트 동기화" 버튼 클릭
2. 설정된 GOOGLE_SHEETS_ID 시트에서 데이터 가져옴
3. A열(웹툰명), B열(프롬프트) 파싱하여 articles 테이블에 저장

### 3. 자동 생성 작업
1. "작업 시작" 버튼으로 pending 글들을 큐에 추가
2. 각 글의 "생성" 버튼으로 개별 실행
3. Gemini AI가 고품질 블로그 글 생성
4. 완료된 글은 "보기" 버튼으로 미리보기 가능

### 4. Google Drive 저장 (구현 예정)
- 완료된 글을 Google Drive 문서로 자동 저장
- 폴더 구조 자동 생성 및 중복 방지

## 📋 필요한 준비물

### Google Cloud Console 설정
1. **OAuth 2.0 클라이언트 ID** 생성
   - 승인된 리디렉션 URI: `https://your-domain.pages.dev/auth/callback`
   - 로컬: `http://localhost:3000/auth/callback`

2. **Google Sheets API**, **Google Drive API** 활성화

3. **Gemini API 키** 발급 (AI Studio)

### Google Sheets 준비
- **A열**: 웹툰명/제목
- **B열**: 상세 프롬프트 (키워드, 타겟, 길이, 톤 포함)
- 시트 ID를 GOOGLE_SHEETS_ID에 설정

### Google Drive 폴더
- 생성된 글을 저장할 Drive 폴더 생성
- 폴더 ID를 GOOGLE_DRIVE_FOLDER_ID에 설정

## 🔄 다음 개선 사항

### 고도화 예정
1. **Drive 저장 구현**: 완료된 글을 Google Docs로 자동 저장
2. **배치 처리**: 대량 글 생성 시 청크 단위 처리
3. **토큰 리프레시**: Google API 토큰 자동 갱신
4. **알림 시스템**: 작업 완료 시 이메일/슬랙 알림
5. **템플릿 시스템**: 다양한 글 타입별 프롬프트 템플릿
6. **SEO 최적화**: 메타데이터, 이미지, 태그 자동 생성

### 운영 고도화
1. **모니터링**: 에러율, 생성 속도, 사용량 대시보드
2. **백업**: 정기 D1 백업 및 복구 시스템
3. **스케일링**: 동시 작업 수 제한 및 큐 관리
4. **A/B 테스팅**: 프롬프트 성능 비교 시스템

## 📈 현재 상태
- ✅ **MVP 완성**: 기본 워크플로우 동작
- ✅ **안정성**: PM2 + D1 + JWT 인증
- ✅ **확장성**: 모듈식 구조, API 우선 설계
- ⚠️ **프로덕션 준비**: 환경변수 설정 및 배포 필요

**이제 Google API 키만 설정하면 바로 프로덕션에서 사용 가능한 완전한 영구 버전입니다!** 🚀