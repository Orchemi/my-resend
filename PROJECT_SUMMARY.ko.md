# MyResend - 프로젝트 요약

> 🌐 **언어**: [English](./PROJECT_SUMMARY.md) · **한국어**

## 개요

MyResend 는 self-hosted, Resend 호환 메일 게이트웨이입니다. Next.js 15 위에 구축되었으며, AWS SDK v3 (`@aws-sdk/client-sesv2`) 를 통해 Amazon SES 로 메일을 발송하고, 도메인 DNS 레코드는 DigitalOcean DNS 또는 AWS Route53 으로 관리합니다 — 활성 provider 는 런타임에 `DNS_PROVIDER` 환경 변수로 선택합니다.

## 아키텍처

### 백엔드 서비스

- **Next.js 15 API Routes** — `src/app/api/` 아래 RESTful endpoint
- **PostgreSQL** — `database.sql` 의 스키마에 대해 raw `pg` 쿼리 사용 (ORM 없음, 마이그레이션 프레임워크 없음)
- **AWS SDK v3** — 발송용 SES v2 (`@aws-sdk/client-sesv2`), DNS 용 Route53 (`@aws-sdk/client-route-53`), 필요한 경우 IAM (`@aws-sdk/client-iam`)
- **DNS provider dispatch** — `src/lib/dns-provider.ts` 가 DigitalOcean (`src/lib/digitalocean.ts`) 또는 Route53 (`src/lib/route53.ts`) 로 디스패치
- **JWT 인증** — admin 세션은 `NEXTAUTH_SECRET` 으로 서명, 외부 클라이언트는 `mrs_<id>_<secret>` API key

### 프론트엔드

- **Next.js 15 + React 19** — App Router 대시보드 (dev 에서 Turbopack)
- **Tailwind CSS v4** — 스타일링
- **TypeScript 5** — strict mode, CI 가 `tsc --noEmit` 0-error baseline 을 강제

## 파일 구조

```
src/
├── app/
│   ├── api/
│   │   ├── auth/           # 인증 endpoint
│   │   ├── domains/        # 도메인 관리
│   │   ├── api-keys/       # API key 관리
│   │   ├── emails/         # 메일 발송 & 로그
│   │   ├── webhooks/       # SES webhook 핸들러
│   │   ├── health/
│   │   │   ├── ses/        # SES 헬스 프로브 (GetAccount)
│   │   │   └── dns/        # DNS provider 헬스 프로브
│   │   ├── waitlist/       # 대기자 명단 등록 endpoint
│   │   ├── stats/          # Stats API
│   │   ├── cron/           # 주기적 stats push
│   │   └── setup/          # 초기 admin 시드
│   ├── login/
│   ├── pricing/
│   ├── layout.tsx          # AuthProvider 가 붙은 root layout
│   └── page.tsx            # 메인 앱 entry
├── components/
│   ├── Dashboard.tsx        # 탭 컨테이너
│   ├── LandingPage.tsx      # 미인증 랜딩
│   ├── DomainsTab.tsx       # 도메인 관리 UI
│   ├── ApiKeysTab.tsx       # API key 관리 UI
│   ├── EmailLogsTab.tsx     # 메일 로그
│   └── ConnectionsTab.tsx   # SES + DNS 헬스 카드
├── contexts/
│   └── AuthContext.tsx
└── lib/
    ├── api.ts               # 프론트엔드 API 클라이언트
    ├── auth.ts              # JWT + bcrypt 사용자 인증
    ├── api-keys.ts          # API key 발급 / 검증
    ├── domains.ts           # 도메인 operations
    ├── ses.ts               # AWS SES v2 연동
    ├── dns-provider.ts      # DNS provider 디스패처
    ├── digitalocean.ts      # DigitalOcean DNS 구현
    ├── route53.ts           # Route53 DNS 구현
    ├── database.ts          # PostgreSQL 클라이언트 + interfaces
    ├── middleware.ts        # API 미들웨어 (JWT verify 등)
    └── notifications.ts     # 대기자 명단 / admin 알림
```

## 데이터베이스 스키마

### 테이블

- **users** — admin 사용자 계정
- **domains** — 발송 도메인
- **api_keys** — 검증된 도메인마다 발급되는 `mrs_<id>_<secret>`
- **email_logs** — 모든 발송 기록
- **webhook_events** — SES 전송 이벤트
- **waitlist_signups** — hosted-version 대기자 명단 (기본 비활성)

### 핵심 속성

- UUID primary key
- 외래 키와 자주 사용되는 query path 에 인덱스
- SES 응답 detail 용 JSON 컬럼
- 스키마 부트스트랩은 idempotent — `CREATE TABLE IF NOT EXISTS` 일관 사용. `psql "$DATABASE_URL" -f database.sql` 로 적용.

## API Endpoint

### 인증

- `POST /api/auth/login` — admin 로그인
- `GET /api/auth/me` — 현재 사용자

### 도메인 관리

- `GET /api/domains` — 도메인 목록
- `POST /api/domains` — 도메인 추가 (DNS 레코드 생성, 활성 DNS provider 에 디스패치, SES 에 등록)
- `DELETE /api/domains/{id}` — 도메인 제거
- `POST /api/domains/{id}/verify` — SES verification 상태 재확인

### API Key

- `GET /api/api-keys` — API key 목록
- `POST /api/api-keys` — 새 key 생성 (검증된 도메인에 대해서만)
- `DELETE /api/api-keys/{id}` — key 삭제

### 메일 operations (Resend 호환)

- `POST /api/emails` — 메일 발송
- `GET /api/emails/logs` — 메일 이력
- `GET /api/emails/{id}` — 메일 상세

### 시스템

- `GET /api/health/ses` — SES 헬스 (admin JWT, `GetAccount` 호출)
- `GET /api/health/dns` — DNS provider 헬스 (admin JWT, provider 별 프로브 호출)
- `POST /api/setup` — `ADMIN_EMAIL` / `ADMIN_PASSWORD` 로 admin 사용자 시드
- `POST /api/webhooks/ses` — SES 이벤트 ingest

## 핵심 연동

### AWS SES (v2)

- 도메인 identity 생성과 verification
- DKIM 속성 관리
- 메일 발송 (`SendEmail` / configuration set)
- 계정 헬스 프로브 (`GetAccount`)
- Webhook 이벤트 ingestion

### DNS Provider 추상화

- `DNS_PROVIDER=route53` (기본값) — AWS SDK v3 를 통해 AWS Route53 로 라우팅
- `DNS_PROVIDER=digitalocean` — axios 를 통해 DigitalOcean DNS API 로 라우팅
- 각 provider 는 동일한 shape 을 구현합니다 (`setupDomainDNS`, `verifyDomainOwnership`, `checkProvider`). 디스패처는 `src/lib/dns-provider.ts` 에 있습니다.
- Provider 격리는 integration suite 가 검증합니다 (`DNS_PROVIDER` 모드에 따라 한 provider 의 클라이언트만 호출됨을 보증)

### PostgreSQL

- Raw `pg` 클라이언트, ORM 없음
- 스키마 변경은 `database.sql` 과 `src/lib/database.ts` 의 TypeScript interface 를 함께 직접 수정
- Connection string 은 `DATABASE_URL`

## 보안 기능

- JWT 기반 admin 인증 (`NEXTAUTH_SECRET`)
- API key 해싱 (`bcryptjs`)
- 입력 검증 (`zod`)
- 시크릿은 환경 변수에서만 읽음 — `.env.local` 및 동등 파일은 git-ignore 됨, `.env.local.example` 은 placeholder 만 포함

## 배포 옵션

MyResend 는 플랫폼 lock-in 이 없습니다. 지원되는 배포 옵션은 [DEPLOYMENT.ko.md](./DEPLOYMENT.ko.md) 에 정리되어 있습니다:

1. **Docker** (Dockerfile 포함)
2. **Dokku** (git-push 배포)
3. **Coolify / CapRover / 기타 PaaS** (container-aware)
4. **Fly.io**
5. **Vercel**
6. **Kubernetes** (`k8s/` 에 샘플 매니페스트 — 후속 sweep 예정 항목)

## 환경 변수

핵심 설정 (전체 키 reference 는 `CLAUDE.md § Environment Configuration`, 템플릿은 `.env.local.example` 참조):

- 데이터베이스: `DATABASE_URL`
- AWS: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- DNS provider: `DNS_PROVIDER`, `DO_API_TOKEN` (DigitalOcean) 또는 `AWS_HOSTED_ZONE_ID` (Route53, 선택)
- 보안: `NEXTAUTH_SECRET`
- Admin 시드: `ADMIN_EMAIL`, `ADMIN_PASSWORD`

## 시작하기

1. **서비스 프로비저닝**: PostgreSQL + AWS SES + (DigitalOcean DNS 또는 Route53)
2. **환경 설정**: `cp .env.local.example .env.local` 후 값 입력
3. **데이터베이스 초기화**: `psql "$DATABASE_URL" -f database.sql`
4. **설치 & 실행**: `npm install && npm run dev`
5. **Admin 시드**: `curl -X POST http://localhost:3000/api/setup`
6. **연결 확인**: 로그인 후 Connections 탭 — SES 와 DNS 카드 모두 `ok: true` 여야 합니다
7. **도메인 추가**: Domains 탭에서 첫 도메인을 추가하고 검증
8. **API key 생성**: 검증된 도메인에 대해 `mrs_<id>_<secret>` key 발급
9. **메일 발송**: MyResend base URL 을 가리킨 Resend SDK 로 발송

## Resend 호환성

MyResend 는 Resend 와 동일한 API contract 를 구현합니다:

```javascript
// baseURL 만 바꾸면 나머지는 그대로 동작합니다
const resend = new Resend("mrs_your-api-key", {
  baseURL: "https://your-my-resend.example.com/api",
});
```

## 향후 개선

- 이메일 템플릿
- 캠페인 관리
- 고급 분석
- 다중 사용자 지원
- SMTP relay
- 메일 발송 스케줄링
- 향상된 webhook 라우팅

---

upstream 프로젝트로부터의 attribution 과 divergence boundary 는 [NOTICE](./NOTICE) 에 기록되어 있습니다.
