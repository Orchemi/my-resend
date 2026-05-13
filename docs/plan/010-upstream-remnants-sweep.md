# 010-upstream-remnants-sweep

## 개요

- **이슈**: [#24](https://github.com/Orchemi/my-resend/issues/24)
- **브랜치**: `feat/24`
- **상태**: 진행 중
- **생성일**: 2026-05-13
- **선행**: 없음 (독립 작업). 단 fork base = `3439985` (2026-04-26, eibrahim/freeresend) 가 본 plan 의 모든 stale 잔존의 출처이며, 본 sweep 은 그 base 시점에 imported as-is 였던 문서·설정 자산을 my-resend 스택 형상으로 재정렬한다.

## 배경

레포가 eibrahim/freeresend 에서 분기될 때 (2026-04-26) `src/` 코드와 `CLAUDE.md`, `README.md` / `README.ko.md`, `NOTICE`, `LICENSE` 는 이후 plan 001~009 를 거치며 my-resend 컨벤션 (SES v2 SDK, `mrs_` API key prefix, raw `pg` + `DATABASE_URL`, DNS provider 추상화, MyResend 브랜드) 으로 정렬됐다. 그러나 다음 자산은 fork 직후의 upstream shape 그대로 남아 있다.

- **`SETUP.md`** — 환경변수 예시에 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 가 등장 (실제 DB 는 raw `pg` + `DATABASE_URL`). IAM 정책은 SES v1 액션 (`ses:VerifyDomainIdentity`, `ses:GetIdentityVerificationAttributes`, `ses:DeleteIdentity`, `ses:VerifyDomainDkim`, `ses:GetIdentityDkimAttributes`) — 실제 코드는 sesv2 SDK 의 `SendEmailCommand` / `CreateEmailIdentityCommand` / `GetEmailIdentityCommand` / `PutEmailIdentityDkimAttributesCommand` / `DeleteEmailIdentityCommand` / `CreateConfigurationSetCommand` / `GetAccountCommand` 만 사용. API key 형식 `frs_[id]_[secret]` (실제 `mrs_`). 브랜드명 "FreeResend". 본문에서 `.env.local.example` 을 참조하지만 파일 자체가 부재.
- **`DEPLOYMENT.md`** — 제목과 본문 전반에 "FreeResend" 브랜드. 데이터베이스 권장 서비스에 Supabase / Railway / PlanetScale / Neon 나열 (Supabase 는 본 스택과 무관, PlanetScale 은 MySQL 계열로 부적합). Vercel-only 배포 가이드. One-Click Deploy 버튼이 `github.com/eibrahim/freeresend` 를 가리킴. 문제 해결 섹션이 부재한 `node test-email.js` 를 안내. GitHub Issues 링크가 `eibrahim/freeresend/issues`, 지원 채널은 EliteCoders.
- **`docker-compose.yml`** — 서비스명 `freeresend`. 주석 처리된 postgres 서비스의 `POSTGRES_DB` / `POSTGRES_USER` 도 `freeresend`. 주석에 "if not using Supabase" 가 등장.
- **`.env.local.example`** — **파일 자체 부재**. `SETUP.md` 와 `docker-compose.yml` (`env_file: .env.local`) 이 모두 이 파일을 참조하지만 레포 어디에도 존재하지 않아 신규 운영자가 어떤 키가 필수인지 한 자리에서 알 길이 없다. `CLAUDE.md § Environment Configuration` 만 ground truth 인 상태.

이 잔존들은 LLM 코딩 어시스턴트 (CLAUDE.md), publish 된 README, NOTICE 의 attribution 과 달리 **본 OSS 의 실제 스택과 직접 모순** 되므로, 신규 운영자가 가이드를 그대로 따라 하면 작동하지 않는 환경변수를 설정하거나 (`NEXT_PUBLIC_SUPABASE_*`), 권한이 부족한 IAM 정책 (SES v1 액션) 을 적용하게 된다.

본 plan 은 sweep 범위를 **인덱스 카탈로그 + tier 분할** 로 정리하고, 이슈 #24 의 작업 내용을 **Tier 1 (010-1) 단일 PR** 로 정의한다. Tier 2 이상은 후속 PR (010-2, 010-3) 로 분할하여 본 PR 의 diff 크기와 리뷰 부담을 통제한다.

## 목표

이슈 #24 의 작업 내용 (Tier 1, 본 PR 범위):

- [ ] plan 010 신설 — 본 문서 + stale 카탈로그 + tier 분류
- [ ] `SETUP.md` 재작성 — Postgres + `DATABASE_URL`, `mrs_` prefix, "MyResend" 브랜드, SES v2 IAM 정책, `.env.local.example` 실재 참조
- [ ] `DEPLOYMENT.md` 재작성 — Supabase / Railway / PlanetScale / Neon 권장 제거, eibrahim URL 제거, Vercel-only → Docker / Dokku / Coolify / Fly / Vercel / k8s 의 추상적 병렬 나열, attribution 1줄로 축약
- [ ] `docker-compose.yml` 서비스명 `freeresend` → `my-resend` 로 변경, 주석의 `POSTGRES_DB` / `POSTGRES_USER` 도 동기화, "Supabase" 표현 제거
- [ ] `.env.local.example` 신설 — `CLAUDE.md § Environment Configuration` 의 필수/옵션 키 전체를 placeholder/빈 값으로 미러링
- [ ] CI 4단 (lint / typecheck / test / build) 통과 + 검증 grep 0건

## 설계

### 접근 방식

1. **메타 plan 형태로 작성**. plan 010 은 단일 작업 추적이 아니라 *"upstream 잔존을 통째로 인덱싱하고 tier 로 잘라 후속 PR 들로 흘려보내는"* 색인 문서다. Tier 1 만 본 PR 의 변경 대상이고, Tier 2 / 3 / 4 는 별도 PR 로 분할되며 각자의 plan (010-2, 010-3, ...) 을 가진다. 한 PR 에 모든 sweep 을 몰아넣으면 diff 가 500+ 라인이 되어 리뷰가 비실용적이고, 의도된 attribution 라인을 stale 로 오분류할 위험이 커진다.
2. **stale vs 의도 attribution 분류를 카탈로그 단계에서 확정**. `NOTICE`, `LICENSE`, `README.md` / `README.ko.md` 의 fork 출처 한 줄, `CLAUDE.md` 의 fork 한 줄, `docs/plan/*` 의 역사 기록은 **보존 대상** 이다. 이걸 카탈로그에서 명시적으로 "의도 attribution" 으로 마킹해두지 않으면 검증 grep 이 0 건을 강제할 때 보존 대상까지 함께 지워질 위험이 있다.
3. **검증 grep 의 대상 파일 제한**. PR 머지 기준의 grep 은 **본 PR 이 건드린 파일 4개** (`SETUP.md` / `DEPLOYMENT.md` / `docker-compose.yml` / `.env.local.example`) 에 한정하여 실행한다. 레포 전체 grep 은 후속 PR 들이 끝날 때까지 자연스럽게 양수로 남는다 (예: `k8s/` 디렉토리, `CONTRIBUTING.md`).
4. **`.env.local.example` 의 ground truth 는 `CLAUDE.md § Environment Configuration` 1곳**. 코드 grep 으로 사용 중인 `process.env.*` 를 교차 검증하지만, *"무엇이 필수/옵션이며 어떤 의미인가"* 의 선언적 정의는 CLAUDE.md 가 가진다. 두 ground truth 의 동기화를 강제할 자동화는 본 PR 범위 밖.

### Stale 카탈로그 (전체 grep)

검색 명령:

```bash
git -C $REPO grep -nE \
  "freeresend|FreeResend|frs_|supabase|NEXT_PUBLIC_SUPABASE|eibrahim" \
  -- ':!package-lock.json' ':!node_modules' ':!.next'
```

총 hit (요약): 본 plan 작성 시점에 약 **190+ 라인** 이 매칭된다. 아래 표는 그 결과를 **파일별로 묶어** 분류·tier·처리 방향을 부여한다 (라인 단위 enum 은 PR 변경 diff 가 권위 있는 출처라 plan 에서는 묶음 단위로 다룬다).

| 파일 | hit 수 (대략) | 대표 발견 텍스트 | 분류 | Tier | 처리 방향 |
|------|----------|-------------------|------|------|----------|
| `SETUP.md` | 6 | `# FreeResend Setup Guide`, `createdb freeresend`, SES v1 액션 8종, `NEXT_PUBLIC_SUPABASE_URL`, `frs_[id]_[secret]`, `docker build -t freeresend` | **stale** | **1** | 010-1 에서 전면 재작성 |
| `DEPLOYMENT.md` | 5 | `# FreeResend Deployment Guide`, Supabase / Railway / PlanetScale / Neon 권장, `vercel/new/clone?...eibrahim/freeresend`, `eibrahim/freeresend/issues`, `EliteCoders` 지원 | **stale** | **1** | 010-1 에서 전면 재작성 |
| `docker-compose.yml` | 4 | 서비스명 `freeresend`, 주석 `POSTGRES_DB: freeresend`, `POSTGRES_USER: freeresend`, "if not using Supabase" | **stale** | **1** | 010-1 에서 rename + 주석 정리 |
| `(부재) .env.local.example` | — | SETUP.md L74 + docker-compose.yml L11 이 참조하지만 파일 부재 | **결손** | **1** | 010-1 에서 신설 |
| `CONTRIBUTING.md` | 7 | `# Contributing to FreeResend`, `git clone https://github.com/eibrahim/freeresend.git`, `cd freeresend`, `supabase.ts # Database operations`, `Supabase Documentation` 링크, `FreeResend version:`, "**FreeResend** is built and maintained by **Emad Ibrahim** ... EliteCoders" 푸터 | **stale** | **2** | 010-2 에서 my-resend 컨벤션으로 재작성 (`Orchemi/my-resend.git`, `supabase.ts` 줄 제거, EliteCoders 푸터 → NOTICE 1줄 attribution) |
| `PROJECT_SUMMARY.md` | 4 | `# FreeResend - Project Summary`, `supabase.ts  # Database client & types`, `FreeResend implements the same API contract as Resend`, `baseURL: "https://your-freeresend.com/api"` | **stale** | **2** | 010-2 에서 갱신 또는 폐지 검토 (CLAUDE.md / README.md 와 정보 중복) |
| `.kiro/specs/hosted-version-waitlist/design.md`, `requirements.md` | 4 | "FreeResend's upcoming hosted version", "FreeResend homepage", "consistent with the existing FreeResend design" | **stale (marketing)** | **4** | 별도 트랙 — hosted-version-waitlist (이슈 #20 WaitlistSignup) 의 운영 방향 결정에 종속. 본 plan 의 sweep 대상 아님 |
| `.kiro/steering/product.md`, `tech.md` | 2 | `FreeResend is a self-hosted, open-source alternative to Resend`, `Bearer token format: frs_keyId_secretPart` | **stale** | **2** | 010-2 에서 갱신 (또는 `.kiro/` 자체의 active 여부 재검토) |
| `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml` | 3 | `description: Report a bug to help us improve FreeResend`, `improving FreeResend!` | **stale** | **3** | 010-3 에서 "MyResend" 로 일괄 치환 |
| `.github/workflows/deploy.yml` | 9 | `IMAGE_NAME: freeresend`, `kubectl ... -n freeresend`, `deployment/freeresend`, `https://www.freeresend.com` | **stale (deploy infra)** | **3** | 010-3. 단 plan 008 에서 *"upstream 운영 워크플로우 — 본 fork 의 운영 결정과 별개라 그대로 보존"* 으로 결정된 바 있음. Tier 3 진입 시 (a) 폐지 / (b) 무명 IMAGE_NAME 으로 generic 화 / (c) 보존 중 택 1 |
| `k8s/*.yaml`, `k8s/postgres/*.yaml`, `k8s/*.md`, `k8s/*.sh` | 100+ | namespace / deployment / service / ingress / hpa / cronjob 전부 `freeresend`. host `www.freeresend.com`, image `registry.digitalocean.com/curatedletters/freeresend` 등 | **stale (deploy infra)** | **3** | 010-3 에서 일괄 rename 또는 폐지. 본 OSS 의 k8s 매니페스트는 example 용도라 generic 한 placeholder 도메인 (`example.com`) 권장 |
| `test-curl.sh`, `test-email.js`, `test-smtp.js` | (별도 확인 필요) | upstream artifacts — CLAUDE.md L44 가 *"those are upstream artifacts. The Jest suite ... is the source of truth"* 로 명시 | **stale (test artifacts)** | **3** | 010-3 에서 제거 또는 `examples/` 로 이동 |
| `database.sql` L1, L137 | 2 | `-- FreeResend Database Schema`, `'admin@freeresend.com'` 의 default seed | **stale** | **3** | 010-3 에서 코멘트 갱신 + seed 이메일을 `example.com` 으로 |
| `TODO.md` | (확인 필요) | upstream TODO 잔존 가능 | **stale 또는 폐지** | **2 or 4** | 010-2 에서 검토. my-resend 트랙은 GitHub Issues 로 운영되므로 폐지 우선 검토 |
| **`NOTICE`** L13, L14, L31, L46 | 4 | `eibrahim/freeresend`, `https://github.com/eibrahim/freeresend`, `git remote add upstream`, `frs_ -> mrs_` 변환 기록 | **의도 attribution** | **보존** | 변경 금지. fork 출처와 변환 기록의 권위 있는 문서 |
| **`LICENSE`** L3 | 1 | `Copyright (c) 2025 EliteCoders (original work, eibrahim/freeresend)` | **의도 attribution** | **보존** | 변경 금지 |
| **`README.md`** L7, **`README.ko.md`** L7 | 2 | "hard fork of [eibrahim/freeresend](https://github.com/eibrahim/freeresend) (MIT). See [NOTICE](./NOTICE) ..." | **의도 attribution** | **보존** | 본 한 줄만 유지. README 본문의 *다른* upstream 잔존이 발견되면 별도 PR (이슈 추가 검토) |
| **`CLAUDE.md`** L9 | 1 | "The project is a hard fork of [eibrahim/freeresend](https://github.com/eibrahim/freeresend) (MIT). Attribution and the divergence boundary are documented in `NOTICE`." | **의도 attribution** | **보존** | 변경 금지 |
| **`docs/plan/001-ses-v2-migration.md`** L14, L141, **`003-followups-doc-and-refactor.md`** 다수, **`009-admin-connections-health-check.md`** L17 | 다수 | "분기 base SHA `3439985`", "원본 upstream: https://github.com/eibrahim/freeresend", 003 plan 본문의 잔존 분석 기록, "upstream `freeresend` 에는 admin 헬스 체크 개념이 없었으므로" | **의도 attribution (history)** | **보존** | plan 문서는 작성 시점의 history. 사후 편집하지 않음 |

> Tier 2/3/4 의 정확한 라인 enum 과 변환 규칙은 각 후속 plan (010-2, 010-3) 에서 다시 카탈로그한다. 본 plan 의 표는 **"본 PR 머지 후에도 grep hit 이 남는 게 정상"** 임을 명문화하기 위한 인덱스다.

### Tier 분류

| Tier | plan | PR 범위 | 대상 파일 |
|------|------|---------|-----------|
| **1** | **010 (본 plan, 010-1 으로 머지)** | 운영 가이드·런타임 설정의 직접 모순 제거 | `SETUP.md`, `DEPLOYMENT.md`, `docker-compose.yml`, `.env.local.example` (신설) |
| **2** | 010-2 (후속, 별도 plan/이슈) | 영문 contributor 문서 + project summary + `.kiro/steering` | `CONTRIBUTING.md`, `PROJECT_SUMMARY.md`, `.kiro/steering/product.md`, `.kiro/steering/tech.md`, `TODO.md` (폐지 검토 포함) |
| **3** | 010-3 (후속, 별도 plan/이슈) | 배포 infra + test artifacts + 이슈 템플릿 | `.github/ISSUE_TEMPLATE/*.yml`, `.github/workflows/deploy.yml`, `k8s/**`, `test-curl.sh`, `test-email.js`, `test-smtp.js`, `database.sql` 코멘트/seed |
| **4** | 별도 이슈 (운영 방향 결정 선행) | marketing / waitlist 영역 | `.kiro/specs/hosted-version-waitlist/*` (이슈 #20 WaitlistSignup 트랙에 종속) |
| **보존** | — | 변경 금지 | `NOTICE`, `LICENSE`, `README.md` / `README.ko.md` / `CLAUDE.md` 의 fork 한 줄, `docs/plan/*` |

### 010-1 작업 절차 (5분할 커밋, 단일 PR)

본 PR 의 git history 는 다음 5개 커밋으로 분리한다 — 리뷰어가 한 번에 한 가지 변경만 검토하도록.

| # | 커밋 메시지 | 변경 파일 | 핵심 변경점 | 검증 방법 |
|---|--------------|-----------|--------------|-----------|
| 1 | `docs(plan): add 010 upstream remnants sweep plan` | `docs/plan/010-upstream-remnants-sweep.md` (신규) | 본 plan 파일. stale 카탈로그 + tier 분류 + 후속 PR 인덱스. 코드/설정 변경 없음 | 파일 존재 + plan 008/009 헤더 패턴 일치 |
| 2 | `docs(setup): rewrite SETUP.md for my-resend stack` | `SETUP.md` | (a) 제목 / 브랜드 "FreeResend" → "MyResend", (b) Prerequisites 의 `createdb freeresend` → `createdb my_resend` (또는 가이드를 일반화), (c) IAM 정책을 **SES v2 액션 7종** (`ses:SendEmail` / `ses:GetAccount` / `ses:CreateEmailIdentity` / `ses:GetEmailIdentity` / `ses:PutEmailIdentityDkimAttributes` / `ses:DeleteEmailIdentity` / `ses:CreateConfigurationSet`) + Route53 사용 시 추가 액션 (`route53:ListHostedZones`, `route53:ListHostedZonesByName`, `route53:GetHostedZone`, `route53:ChangeResourceRecordSets`, `route53:ListResourceRecordSets`) 으로 교체, (d) 환경 변수 예시의 `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` 3줄을 `DATABASE_URL`, `DNS_PROVIDER`, `AWS_HOSTED_ZONE_ID` 로 교체, (e) API key prefix `frs_` → `mrs_` (예시·troubleshooting 모두), (f) `<h1>Hello from FreeResend!</h1>` → `<h1>Hello from MyResend!</h1>`, (g) "Docker 빌드" 의 image 이름 `freeresend` → `my-resend`, (h) "Database connection fails / Check Supabase credentials" 트러블슈팅 항목을 `DATABASE_URL` 기반으로 재작성 | `git grep -nE "FreeResend\|freeresend\|frs_\|supabase\|NEXT_PUBLIC_SUPABASE" -- SETUP.md` 결과 0 |
| 3 | `docs(deployment): rewrite DEPLOYMENT.md for my-resend stack` | `DEPLOYMENT.md` | (a) 제목 / 브랜드 갱신, (b) "Database Setup" 의 권장 서비스 목록에서 Supabase / PlanetScale 제거 — Postgres 호환 일반 서비스로 추상화 (관리형 Postgres 옵션을 generic 하게 한 문단으로), (c) "Quick Deploy to Vercel" 섹션 구조를 **추상적 배포 옵션 병렬 나열** 로 재편 — Docker / Dokku / Coolify / Fly.io / Vercel / Kubernetes 를 동등하게 나열하고 각 옵션 1~2 문단, (d) "One-Click Deploy" 의 `vercel/new/clone?...eibrahim/freeresend` URL 제거 (해당 button 자체를 제거하거나 `Orchemi/my-resend` 로 교체 — 본 PR 에서는 제거 선택), (e) "Email Sending" 트러블슈팅의 `node test-email.js` 호출을 `npm test -- src/lib/__tests__/ses` 로 교체 (test-email.js 는 Tier 3 에서 제거 예정), (f) "Support" 의 `eibrahim/freeresend/issues` → `Orchemi/my-resend/issues`, EliteCoders 지원 라인 제거, (g) 비용 추정 섹션은 Vercel 기준이라 통째로 제거 또는 generic 화, (h) NOTICE 가 attribution 의 권위 있는 출처임을 1줄로 명시 | `git grep -nE "FreeResend\|freeresend\|eibrahim\|supabase\|EliteCoders" -- DEPLOYMENT.md` 결과 0 |
| 4 | `chore(compose): rename service freeresend -> my-resend` | `docker-compose.yml` | (a) `services.freeresend:` → `services.my-resend:`, (b) 주석 처리된 postgres 서비스의 `POSTGRES_DB: freeresend` / `POSTGRES_USER: freeresend` 를 `POSTGRES_DB: my_resend` / `POSTGRES_USER: my_resend` 로 변경 (Postgres identifier 컨벤션 — kebab-case 가 quoting 없이는 부적합하므로 snake_case), (c) `# Optional: PostgreSQL database if not using Supabase` 주석에서 "Supabase" 표현 제거 → `# Optional: PostgreSQL database (uncomment to run alongside)` | `git grep -nE "freeresend\|supabase" -- docker-compose.yml` 결과 0. `docker compose config` 로 lint (호스트에 docker 있을 때) |
| 5 | `chore(env): add .env.local.example template` | `.env.local.example` (신규) | `CLAUDE.md § Environment Configuration` 의 키 집합을 1:1 미러링 + 코드 grep 결과로 빠진 키 확인. 모든 값은 빈 또는 placeholder (`AKIA...`, `dop_v1_...`, `postgresql://user:pass@host:5432/dbname`, `us-east-1` 등). 각 키마다 1줄 한국어/영어 주석으로 의미 + 필수/옵션 표시. 실제 시크릿 값 일절 미포함 | (a) 파일 존재, (b) `git grep -nE "AKIA[A-Z0-9]{16}\|dop_v1_[a-f0-9]+\|postgresql://[^/]+:[^@]+@" -- .env.local.example` 결과 0 (placeholder 형식만), (c) `.env.local.example` 의 키 집합 = `CLAUDE.md § Environment Configuration` 의 키 집합 (수동 대조) |

### SES v2 IAM 정책 (SETUP.md 갱신용 ground truth)

`src/lib/ses.ts` 와 `src/app/api/health/ses/route.ts` 에서 실제 호출하는 SES v2 commands:

| Command (SDK) | 호출 위치 | 필요 IAM action |
|----------------|-----------|------------------|
| `SendEmailCommand` | `ses.ts:95`, `ses.ts:192` | `ses:SendEmail` |
| `CreateEmailIdentityCommand` | `ses.ts:218` | `ses:CreateEmailIdentity` |
| `GetEmailIdentityCommand` | `ses.ts:229`, `ses.ts:244`, `ses.ts:258`, `ses.ts:266` | `ses:GetEmailIdentity` |
| `PutEmailIdentityDkimAttributesCommand` | `ses.ts:251` | `ses:PutEmailIdentityDkimAttributes` |
| `DeleteEmailIdentityCommand` | `ses.ts:273` | `ses:DeleteEmailIdentity` |
| `CreateConfigurationSetCommand` | `ses.ts:281` | `ses:CreateConfigurationSet` |
| `GetAccountCommand` | `src/app/api/health/ses/route.ts:29` | `ses:GetAccount` |

> SES v2 SDK 가 호출하는 backend API 의 IAM action namespace 는 `ses:*` 이다 (v1 API 와 동일 prefix — v2 는 별도 prefix 가 아니라 동일 prefix 의 새 action 이름). SES v1 의 `ses:VerifyDomainIdentity` / `ses:GetIdentityVerificationAttributes` / `ses:DeleteIdentity` / `ses:VerifyDomainDkim` / `ses:GetIdentityDkimAttributes` 는 본 코드에서 호출되지 않으므로 정책에서 제거한다.

`SETUP.md` 에 첨부할 SES v2 IAM 정책 JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MyResendSesV2",
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:GetAccount",
        "ses:CreateEmailIdentity",
        "ses:GetEmailIdentity",
        "ses:PutEmailIdentityDkimAttributes",
        "ses:DeleteEmailIdentity",
        "ses:CreateConfigurationSet"
      ],
      "Resource": "*"
    }
  ]
}
```

`DNS_PROVIDER=route53` 사용 시 추가로 부여할 Route53 정책 (별도 statement 또는 별도 정책):

| Command (SDK) | 호출 위치 | 필요 IAM action |
|----------------|-----------|------------------|
| `ListHostedZonesByNameCommand` | `route53.ts:98` | `route53:ListHostedZonesByName` |
| `GetHostedZoneCommand` | `route53.ts:148`, `route53.ts:364` | `route53:GetHostedZone` |
| `ChangeResourceRecordSetsCommand` | `route53.ts:209` | `route53:ChangeResourceRecordSets` |
| `ListResourceRecordSetsCommand` | `route53.ts:237` | `route53:ListResourceRecordSets` |
| `ListHostedZonesCommand` | `route53.ts:374` | `route53:ListHostedZones` |

> `ChangeResourceRecordSets` 호출은 종종 `route53:GetChange` 도 함께 필요 (변경 propagation 상태 조회). 현재 코드는 `GetChangeCommand` 를 명시 호출하지 않지만, AWS 콘솔/CLI 패턴 호환을 위해 정책에는 포함을 권장한다 — 본 PR 의 SETUP.md 에 포함.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MyResendRoute53",
      "Effect": "Allow",
      "Action": [
        "route53:ListHostedZones",
        "route53:ListHostedZonesByName",
        "route53:GetHostedZone",
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets",
        "route53:GetChange"
      ],
      "Resource": "*"
    }
  ]
}
```

### `.env.local.example` 키 집합 (스펙)

ground truth: `CLAUDE.md § Environment Configuration` (CLAUDE.md L162~189).
교차 검증: `grep -rho "process.env.[A-Z_]*" src/` 의 결과와 대조.

| 키 | 필수/옵션 | 코드 사용처 (대표) | placeholder | 주석 |
|----|-----------|----------------------|--------------|------|
| `DATABASE_URL` | 필수 | `src/lib/database.ts` | `postgresql://user:password@host:5432/my_resend` | Postgres 연결 문자열. raw `pg` 가 직접 파싱 |
| `AWS_REGION` | 필수 | `src/lib/ses.ts`, `src/lib/route53.ts` | `us-east-1` | SES / Route53 클라이언트 region |
| `AWS_ACCESS_KEY_ID` | 필수 | AWS SDK 기본 credential chain | `AKIA...` | SES + (사용 시) Route53 + IAM 권한을 가진 키 |
| `AWS_SECRET_ACCESS_KEY` | 필수 | AWS SDK 기본 credential chain | `(redacted)` | 시크릿. 로컬에서만 채우고 절대 commit 금지 |
| `NEXTAUTH_SECRET` | 필수 | `src/lib/middleware.ts` (JWT sign/verify) | `(64+ chars random)` | JWT signing key. `openssl rand -base64 64` 권장 |
| `ADMIN_EMAIL` | 필수 | `src/app/api/setup/route.ts` | `admin@example.com` | 초기 관리자 시드용 |
| `ADMIN_PASSWORD` | 필수 | `src/app/api/setup/route.ts` | `(strong password)` | 초기 관리자 시드 비밀번호 — bcrypt 해시로 저장 |
| `DNS_PROVIDER` | 옵션 | `src/lib/dns-provider.ts` | `digitalocean` | `digitalocean` (기본) 또는 `route53` |
| `DO_API_TOKEN` | 조건부 필수 | `src/lib/digitalocean.ts` | `dop_v1_...` | `DNS_PROVIDER=digitalocean` 일 때 필수 |
| `AWS_HOSTED_ZONE_ID` | 옵션 | `src/lib/route53.ts` | `(zone id)` | 미설정 시 자동 발견 (`ListHostedZonesByName`) — 단일 zone 환경에서만 권장 |
| `NEXTAUTH_URL` | 옵션 (배포 환경) | next-auth 호환 — 일부 컨텍스트에서 사용 | `http://localhost:3000` | 배포 도메인. dev 에선 생략 가능 |
| `FROM_EMAIL` | 옵션 | `src/lib/ses.ts` 기본 발신지 fallback | `noreply@example.com` | 기본 발신 주소. API 호출에서 명시되면 override |
| `CRON_SECRET` | 옵션 | `src/app/api/cron/*` | `(random secret)` | cron 엔드포인트의 X-CRON-SECRET 헤더 검증 |
| `STATS_API_KEY`, `STATS_APP_SLUG`, `STATS_DASHBOARD_URL`, `STATS_PUSH_SECRET` | 옵션 | stats push integration | `(none)` | 외부 stats 대시보드 push 통합 — 미사용 시 빈 값 |
| `UMAMI_API_URL`, `UMAMI_USERNAME`, `UMAMI_PASSWORD`, `UMAMI_WEBSITE_ID` | 옵션 | Umami analytics integration | `(none)` | analytics 통합. 미사용 시 빈 값 |
| `STRIPE_SECRET_KEY` | 옵션 | (사용 위치 확인 필요) | `sk_test_...` | 결제 통합 — marketing 트랙 (Tier 4) 와 관계, MVP 에선 옵션 |
| `NODE_ENV` | (런타임 자동) | Next.js 표준 | `production` | `.env.local.example` 에 포함은 하되 운영자 설정 권장값만 주석 |

**총 키 수**: 필수 7 / 조건부 1 / 옵션 ~12 = 약 **20개** (실제 PR 에서 미세 조정 가능).

**ground truth 동기화 정책**: 본 PR 머지 후 `CLAUDE.md § Environment Configuration` 이 갱신되면 `.env.local.example` 도 같은 PR 에서 함께 갱신한다. 두 파일의 키 집합 일치는 PR 리뷰 체크리스트에 포함 (자동화는 후속 트랙 후보).

## 비스코프

- **k8s/\***, **Dockerfile**, **test-curl.sh**, **test-email.js**, **test-smtp.js** — Tier 3 (010-3 후속 PR). 본 PR 의 5 commit 에 포함하지 않는다.
- **영문 README.md**, **CONTRIBUTING.md**, **PROJECT_SUMMARY.md**, **TODO.md**, **`.kiro/steering/*`** — Tier 2 (010-2 후속 PR).
- **marketing 영역** (`.kiro/specs/hosted-version-waitlist/*`) 및 **이슈 #20 WaitlistSignup** — Tier 4. 운영 방향 결정이 선행되어야 함.
- **`.github/workflows/deploy.yml`** — Tier 3. plan 008 에서 *"upstream 운영 워크플로우 — 본 fork 의 운영 결정과 별개라 그대로 보존"* 으로 결정된 바 있어, Tier 3 진입 시 보존/폐지/generic 화 중 다시 의사결정.
- **검증 grep 의 레포 전체 적용** — Tier 1 머지 시점에는 본 PR 이 건드린 4 파일만 0 건을 강제하고, 레포 전체 0 건은 모든 후속 tier 가 끝난 시점에 별도로 검증.

## 머지 기준

본 PR (010-1) 기준:

- [ ] CI gate 4단 통과: `npm run lint` → `npm run typecheck` → `npm test -- --runInBand` → `npm run build`. 본 PR 은 코드 변경이 없으므로 lint / typecheck / test 는 noop pass, build 만 실질 영향 (Next.js 가 docker-compose / SETUP / DEPLOYMENT 를 빌드에 포함하지 않으므로 사실상 noop).
- [ ] 검증 grep 0 건 (대상 파일 한정):

```bash
git -C $REPO grep -nE \
  "freeresend|FreeResend|frs_|supabase|eibrahim|NEXT_PUBLIC_SUPABASE" \
  -- SETUP.md DEPLOYMENT.md docker-compose.yml .env.local.example
```

  의도된 attribution (NOTICE / LICENSE / README footer) 은 본 4 파일에 들어가지 않으므로 0 건이 자연스러움.
- [ ] `.env.local.example` 의 키 집합 = `CLAUDE.md § Environment Configuration` 의 키 집합 (수동 대조 — 누락 키 0).
- [ ] `.env.local.example` 에 실제 시크릿 미포함:

```bash
git -C $REPO grep -nE \
  "AKIA[A-Z0-9]{16}|dop_v1_[a-f0-9]{8,}|postgresql://[^/]+:[^@]+@[^/]+" \
  -- .env.local.example
```

  결과 0 건 (placeholder 형식 `AKIA...`, `dop_v1_...` 는 ellipsis 가 있어 정규식이 매치하지 않음).
- [ ] 의사결정 기록: PR 본문 또는 본 plan 의 진행 로그에 (a) Vercel-only → 추상 옵션 병렬 나열의 근거, (b) Supabase 권장 제거 근거, (c) IAM 정책 v1 → v2 매핑 근거, (d) `.env.local.example` 의 placeholder 정책 명시.

## 위험·롤백

| 위험 | 완화 |
|------|------|
| `.env.local.example` 에 실제 시크릿 누출 | 모든 값을 빈 또는 placeholder (`AKIA...`, `dop_v1_...`) 로 강제. PR 리뷰에서 grep 차단. 본 PR 의 머지 기준에 시크릿 정규식 grep 포함 |
| 카탈로그가 의도된 attribution 라인을 stale 로 오분류 | `NOTICE` / `LICENSE` / README footer / CLAUDE.md L9 / `docs/plan/*` 를 카탈로그 표에서 **별도 행** 으로 "의도 attribution (보존)" 마킹. 본 PR 의 변경 대상에서 제외 |
| SES v2 IAM 정책의 누락 액션 | `src/lib/ses.ts` 와 `src/app/api/health/ses/route.ts` 의 `new \w+Command` grep 결과를 정책에 1:1 반영 (본 plan § SES v2 IAM 정책 표). 향후 새 command 가 추가되면 plan 008 follow-up 또는 별도 plan 으로 정책 갱신 |
| Route53 IAM 의 `route53:GetChange` 추가가 실제 코드와 불일치 (코드는 GetChange 미호출) | "AWS 콘솔/CLI 패턴 호환" 으로 정책에 포함 — 권한 범위가 과대해지지 않으며 (`Resource: "*"` 의 read-only 액션), 누락 시 운영자가 콘솔에서 변경 propagation 조회를 못 하는 UX 손실이 크다 |
| `docker-compose.yml` 의 Postgres identifier 가 `my_resend` 인지 `myresend` 인지 혼선 | snake_case 채택 (`my_resend`) — Postgres identifier 가 hyphen 을 포함하면 매번 quoting 필요. `CLAUDE.md` 본문의 DB 이름 표기와 일치 여부는 PR 리뷰에서 확인 |
| 후속 트랙 (#20 WaitlistSignup, Tier 4 marketing) 이 본 PR 에 끌려 들어옴 | "비스코프" 섹션 명문화. PR 본문에 *"Tier 1 only"* 표기. 리뷰어가 diff 에서 `.kiro/specs/` 변경 시 즉시 차단 |
| **롤백** | 본 PR 의 모든 변경은 문서/설정. 코드 영향 0. `git revert <merge-commit>` 안전. revert 시에도 plan 010 자체는 다음 시도 때 참조 가능하도록 `docs/plan/` 에 남길지 함께 revert 할지 PR 본문에서 사전 합의 |

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-05-13 | 이슈 #24 생성, `feat/24` 브랜치 (develop 에서 분기), 본 plan 작성 | 010-1 단일 PR 범위 — Tier 2/3/4 는 후속 plan 으로 분리 |

## 참고

- 직전 plan 009: `docs/plan/009-admin-connections-health-check.md`
- 관련 분석 (CLAUDE.md / README 갱신): `docs/plan/003-followups-doc-and-refactor.md`
- fork base + SES v1→v2 전환 배경: `docs/plan/001-ses-v2-migration.md`
- ground truth (환경변수): `CLAUDE.md § Environment Configuration`
- ground truth (SES v2 commands 인벤토리): `src/lib/ses.ts`, `src/app/api/health/ses/route.ts`
- ground truth (Route53 commands 인벤토리): `src/lib/route53.ts`
- AWS SES v2 API reference: <https://docs.aws.amazon.com/sesv2/latest/APIReference/Welcome.html>
- AWS Route53 API reference: <https://docs.aws.amazon.com/Route53/latest/APIReference/Welcome.html>
