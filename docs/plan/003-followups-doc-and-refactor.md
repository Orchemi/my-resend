# 003-followups-doc-and-refactor

## 개요

- **이슈**: [#6](https://github.com/Orchemi/my-resend/issues/6)
- **브랜치**: `feat/6`
- **상태**: 진행 중
- **생성일**: 2026-04-26
- **선행**: PR [#2](https://github.com/Orchemi/my-resend/pull/2) (SES v2), [#3](https://github.com/Orchemi/my-resend/pull/3) (KO README 1차), [#5](https://github.com/Orchemi/my-resend/pull/5) (Route53 + 추상화)

이 문서는 SES v2 + Route53 트랙 이후 남아있던 6건의 follow-up 을 한 번에 처리하는 작업의 단일 진실(single source of truth) 이다.

## 배경

PR #2/#5 로 코드 측 마이그레이션은 마무리됐지만, 다음 흔적이 남아있다:

1. **`NOTICE`** 가 *Planned Divergence* 끝줄에 "home-server (Dokku) with horbis infra conventions" 를 적어둔 상태 — 공개 OSS 의 NOTICE 에 특정 운영자의 인프라 의도를 새기는 것은 부적절.
2. **`CLAUDE.md`** 가 여전히 upstream 인 FreeResend 를 기준으로 기술돼 있음. 스택 (SES SDK 버전, API key prefix, DB driver) 도 옛 정보. 이 파일은 LLM 코딩 어시스턴트가 본 레포에서 동작할 때의 1차 컨텍스트라 정확성이 중요.
3. **`README.md`** (영문, ~450줄) 가 현재 my-resend 라는 자체 OSS 로 publish 됐음에도 불구하고 (a) FreeResend 브랜드, (b) freeresend 도메인, (c) frs_ API key prefix, (d) eibrahim/freeresend 기여 절차 URL, (e) "About the Author" 의 원작자 bio + Frontend Weekly newsletter 홍보, (f) EliteCoders 의 사내 컨설팅 영업 섹션을 그대로 두고 있음. fork attribution 은 NOTICE + 상단 한 줄로 충분하고, 위 항목들은 본 OSS 의 readme 에 들어갈 자리가 아님.
4. **`README.ko.md`** 는 PR #3 직후에도 여전히 영문 README 의 1/9 분량의 한국어 요약. 다국어를 표방하는 이상 영문과 1:1 parity 가 일관성에 부합.
5. **`DNSRecord` / `DnsProviderRecord`** 두 인터페이스가 `domains.ts` 와 `dns-provider.ts` 에 평행 정의되어 있음 (`ttl` optional vs required). 같은 데이터를 두 모양으로 쓰는 것은 후속에 혼선을 만든다.
6. **`digitalocean.ts`** 가 모듈 로드 시점에 `process.env.DO_API_TOKEN` 을 capture 하고 axios client 도 즉시 생성. PR #5 작업 중 이 패턴이 테스트 setup (`jest.setup.env.js`) 을 강제로 도입하게 만들었음. 호출 시점 lazy 로 바꾸면 setup 파일이 사라질 수 있음.

## 목표

- [ ] `NOTICE` *Planned Divergence* 의 deployment-target 행 일반화 (또는 제거)
- [ ] `CLAUDE.md` 전면 갱신 — FreeResend → MyResend, frs_ → mrs_, SES v1 → v2, Supabase 잔여 표현 제거, DNS provider 추상화 반영, Jest 테스트 워크플로우 명시
- [ ] `README.md` 영문 전면 재작성 — 위 a)–f) 모두 제거, 현재 스택 (SES v2, Route53/DigitalOcean DNS_PROVIDER 추상화, Jest) 반영, 새 env (`DNS_PROVIDER`, `AWS_HOSTED_ZONE_ID`) 문서화, IAM policy 를 v2 액션으로 갱신
- [ ] `README.ko.md` 영문 README 와 1:1 한국어 번역
- [ ] 타입 통합: `domains.ts` 의 로컬 `DNSRecord` 제거, `dns-provider.ts` 의 `DnsProviderRecord` 단일 사용. `ttl` 은 required 로 정착 (모든 생산자가 이미 ttl 설정)
- [ ] `digitalocean.ts` lazy env capture: `getApiToken()` / `getDoClient()` getter 도입. `jest.setup.env.js` 와 `jest.config.js` setupFiles 항목 제거 (가능하면)
- [ ] `npm run lint && npm test && npm run build` 모두 통과
- [ ] 6개 관심사로 분리 커밋 → `/pr auto` 가 그룹 분리 PR 생성

## 설계

### 접근 방식

1. **OSS 가시성 0 누출**. 모든 산출물에서 `horbis`, `huns.site`, `home server`, `Dokku` 의 "내 환경" 컨텍스트, 특정 PaaS 편애 표현 금지. 테스트 fixture 도메인은 `example.com` 계열만.
2. **fork attribution 은 NOTICE 가 단일 진실**. README 상단 1줄 + NOTICE 링크면 충분. 본문에서 원작자·원작자 회사·원작자 newsletter 등 별도 홍보 섹션은 모두 제거.
3. **README EN 먼저 → KO 는 EN 의 정확한 1:1 번역**. EN 이 진실. 후속 EN 갱신마다 KO 동기화가 필요해지지만, 그것이 다국어 README 의 정상 운영 비용.
4. **타입 통합 시 외부 시그니처 보존**. `DomainSetupResult.dnsRecords: DNSRecord[]` → `DnsProviderRecord[]`. `ttl?: number` → `ttl: number` 강화 — 모든 생산자가 이미 ttl 을 항상 set 하므로 안전.
5. **lazy env capture 후 jest.setup.env.js 제거 가능 여부 평가**. 제거 시도 후 ses.ts (별도 module-load capture) 가 영향받는지 확인. ses.ts 의 SDK client 는 빈 credentials 도 throw 하지 않으므로 (실제 send() 호출에서만 fail) 문제 없을 것으로 예상.

### 변경 범위

```
my-resend/
├── NOTICE                                              # deployment-target 행 일반화
├── CLAUDE.md                                           # 전면 갱신
├── README.md                                           # 전면 재작성
├── README.ko.md                                        # 영문과 1:1 번역
├── jest.config.js                                      # setupFiles 제거 (가능하면)
├── jest.setup.env.js                                   # 제거 (가능하면)
├── src/lib/
│   ├── digitalocean.ts                                 # getApiToken / getDoClient lazy 도입
│   ├── dns-provider.ts                                 # DnsProviderRecord 단일 export 유지
│   └── domains.ts                                      # 로컬 DNSRecord 제거 → DnsProviderRecord
├── src/app/api/domains/[id]/retry-dns/route.ts         # DNSRecord 사용 시 import 변경
└── docs/plan/
    └── 003-followups-doc-and-refactor.md               # 본 문서
```

**무수정**:
- `src/lib/ses.ts` (lazy 패턴 동일하게 적용 가능하지만 본 PR 범위 밖 — 별도 follow-up)
- `src/lib/route53.ts`
- 테스트 파일들 (lazy 변경이 외부 인터페이스를 깨지 않으므로 회귀만 확인)
- 라이선스 (`LICENSE`) — 원작자 보존

### 의사결정 기록

| 결정 사항 | 선택지 | 결정 | 이유 |
|-----------|--------|------|------|
| `NOTICE` deployment-target 행 처리 | A) 행 자체 삭제 / B) 일반 표현으로 변경 | **A** | NOTICE 는 fork 의 attribution 과 divergence 항목만 담는 게 자연스러움. 배포 권장은 README 영역 |
| README 의 fork attribution 위치 | A) 상단 1줄 + NOTICE 링크 / B) 본문에 expanded 섹션 | **A** | 사용자 (잠재적 contributor) 가 처음 보는 정보는 "이게 뭐고 / 어떻게 시작하는가". fork 의 expanded 컨텍스트는 NOTICE 에서 제공 |
| 원작자 personal bio 보존 여부 | A) 보존 / B) 제거 (NOTICE 의 attribution 만 유지) | **B** | OSS fork 의 readme 에 원작자 personal contact / newsletter / 사내 컨설팅 홍보를 두는 것은 부적절. attribution 은 별개 |
| EN/KO README parity 유지 비용 | A) KO 는 짧은 요약만 / B) 영문과 1:1 번역 | **B** | "다국어 README 가 있다" 는 문서 약속. 1:1 이 아니면 한국어 reader 가 영문 README 를 또 봐야 함 — 다국어의 의미 약화 |
| `DNSRecord` vs `DnsProviderRecord` 통합 방향 | A) `DNSRecord` 유지 / B) `DnsProviderRecord` 단일 / C) 새 이름 | **B** | `dns-provider.ts` 가 unified API 출입구. 그 모듈이 export 하는 타입을 정식 이름으로 굳히는 것이 일관 |
| `ttl` optional vs required | A) optional 유지 / B) required 강화 | **B** | 모든 생산자 (`generateDNSRecords`, provider 들) 가 이미 ttl 을 항상 set. optional 로 두면 unused tolerance 만 남음 |
| `digitalocean.ts` lazy 적용 범위 | A) `DO_API_TOKEN` 만 / B) axios client 까지 / C) ses.ts 도 함께 | **B** | client 도 module-load 에 token 을 capture 하고 있어 token 만 lazy 로 바꿔도 client 헤더가 stale. 둘 다 lazy 가 정합. ses.ts 는 별도 PR |
| `jest.setup.env.js` 제거 시점 | A) 본 PR 에서 제거 / B) 이후 PR 으로 이연 | **A** | lazy 변경의 직접적인 효과 검증 — 제거 후 모든 테스트가 통과하면 패턴이 옳다는 증거. 만약 회귀가 발생하면 본 PR 안에서 재도입하고 보고 |

## 작업 단계

### Phase 1: 작은 산문 정리 (NOTICE + CLAUDE.md)

- [ ] `NOTICE` 의 *Planned Divergence* 마지막 행 제거
- [ ] `CLAUDE.md` 전면 갱신
  - 프로젝트 소개: FreeResend → MyResend
  - Key Technologies: SES SDK v3 → SES v2 (`@aws-sdk/client-sesv2`), Digital Ocean API → DNS provider (DigitalOcean / Route53 via `DNS_PROVIDER`)
  - DB: "migrated from Supabase" 잔여 표현 정리 (현재는 Supabase 트랙 자체가 본 fork 와 무관)
  - API key prefix: `frs_` → `mrs_`
  - env vars: `DNS_PROVIDER`, `AWS_HOSTED_ZONE_ID` 추가
  - Testing Strategy: `node test-email.js`/`./test-curl.sh` (upstream 잔여) → `npm test` (Jest, 105 unit + integration)
  - Domain Setup Workflow: DigitalOcean 단정 → DNS provider 추상화 반영
- [ ] grep 으로 `FreeResend|frs_|freeresend` 0 건 확인 (의도된 attribution 컨텍스트 외)

### Phase 2: README EN 전면 재작성

- [ ] 상단: 한 줄 attribution + NOTICE 링크 (현재 줄 7 그대로 유지) + Status 배너 갱신 (SES v2 done, Route53 done)
- [ ] "Original author's content" 줄 (Frontend Weekly 홍보) 제거
- [ ] Features: DNS 자동화 표현을 "DigitalOcean / Route53 (configurable via `DNS_PROVIDER`)" 로
- [ ] Quick Start: `cd freeresend` → `cd my-resend`. env 예시에 `DNS_PROVIDER`, `AWS_HOSTED_ZONE_ID` 추가. `In your Supabase SQL editor` → `Run database.sql against your PostgreSQL`
- [ ] AWS SES IAM policy: SES v1 액션 → v2 액션 (`ses:CreateEmailIdentity`, `ses:GetEmailIdentity`, `ses:PutEmailIdentityDkimAttributes`, `ses:DeleteEmailIdentity`, `ses:SendEmail`, `ses:CreateConfigurationSet`)
- [ ] DNS Provider Setup: 단일 DigitalOcean 섹션 → "Choose a DNS provider" 섹션 (DigitalOcean / Route53 양쪽 안내, IAM policy snippet 포함)
- [ ] "Using FreeResend with Resend SDK" → "Using MyResend with the Resend SDK". 모든 예시의 `frs_` → `mrs_`, `your-freeresend-domain.com` → `your-my-resend-domain.com`
- [ ] Domain Setup Process: "FreeResend dashboard" → "MyResend dashboard"
- [ ] Testing Your Setup: `node test-email.js`/`./test-curl.sh` (upstream 스크립트 잔재) → `npm test`. 105 테스트 / aws-sdk-client-mock 언급
- [ ] Troubleshooting: "FreeResend" → "MyResend", `frs_` → `mrs_`. 새 troubleshooting 항목: `DNS_PROVIDER` 잘못 지정 시 throw / `AWS_HOSTED_ZONE_ID` 미설정 시 verify false
- [ ] Production Deployment: "Vercel" 단정 표현 완화 — "Docker (recommended for self-hosting)" + "Vercel/Netlify/Fly.io etc. for managed hosting" 같은 일반 나열
- [ ] Repository Structure: `freeresend/` → `my-resend/`. `supabase.ts` 잔여 라인 제거 (실제 파일은 `database.ts`). `dns-provider.ts` / `route53.ts` 추가
- [ ] Contributing: `git clone https://github.com/eibrahim/freeresend.git` → `git clone https://github.com/Orchemi/my-resend.git`
- [ ] Reporting Issues: `eibrahim/freeresend/issues` → `Orchemi/my-resend/issues`
- [ ] Roadmap: 현재 implemented 된 항목 (SES v2, Route53) 제거 또는 done 표시. 남은 backlog 만 유지
- [ ] "About the Author" 섹션 전체 제거
- [ ] "Need Custom Development?" / EliteCoders 영업 섹션 전체 제거
- [ ] License: 그대로 유지 (단, "see LICENSE file" 만 — 별도 author 줄 추가 안 함)
- [ ] grep 으로 `FreeResend|EliteCoders|eibrahim|Frontend Weekly|frs_|freeresend\.com|freeresend-domain` 0 건 확인

### Phase 3: README KO 전체 번역

- [ ] EN README 의 모든 섹션을 한국어로 번역
- [ ] 코드 블록·env 변수명·URL 은 그대로 (영문 코드 위에 한글 주석/설명만 추가)
- [ ] 마지막 검증: EN/KO 의 H2 섹션 개수·순서 동일

### Phase 4: 타입 통합

- [ ] `src/lib/domains.ts`:
  - 로컬 `DNSRecord` interface 제거
  - `import { DnsProviderRecord } from "./dns-provider"` 추가
  - `DomainSetupResult.dnsRecords: DNSRecord[]` → `DnsProviderRecord[]`
  - `DomainSetupResult.dnsProviderRecords?: DNSRecord[]` → `DnsProviderRecord[]`
  - `safeParseDNSRecords` 시그니처 갱신
- [ ] `src/app/api/domains/[id]/retry-dns/route.ts`:
  - `DNSRecord` import 가 있으면 `DnsProviderRecord` 로
- [ ] 다른 사용처 grep — 있으면 갱신
- [ ] tsc 컴파일 검증 (build 단계에서 자동 확인)

### Phase 5: lazy env capture

- [ ] `src/lib/digitalocean.ts`:
  - `const DO_API_TOKEN = process.env.DO_API_TOKEN` 제거 → `function getApiToken(): string | undefined { return process.env.DO_API_TOKEN; }`
  - `const doClient = axios.create({...})` 제거 → `function getDoClient(): AxiosInstance { return axios.create({...}); }`
  - 모든 `DO_API_TOKEN` 참조를 `getApiToken()` 으로
  - 모든 `doClient` 참조를 `getDoClient()` 로
  - 모듈 로드 시 console.warn 제거 (or 첫 사용 시점으로 이동)
- [ ] `jest.setup.env.js` 제거
- [ ] `jest.config.js` 의 `setupFiles: ["<rootDir>/jest.setup.env.js"]` 항목 제거
- [ ] 전체 테스트 재실행 → 통과 확인. 회귀 발견 시 setupFiles 일부 보존 후 보고

### Phase 6: 검증 + 커밋

- [ ] `npm run lint` 통과
- [ ] `npm test` 통과 (105 → ?)
- [ ] `npm run build` 통과
- [ ] 6 commits (관심사별):
  1. `docs(notice): drop deployment-target opinion from Planned Divergence`
  2. `docs(claude): align CLAUDE.md with current my-resend stack`
  3. `refactor(types): unify DNSRecord and DnsProviderRecord`
  4. `refactor(digitalocean): defer env capture to call sites`
  5. `docs(readme): rewrite English README to drop upstream-specific branding`
  6. `docs(readme): translate Korean README to full parity with English`
- [ ] `/pr auto` — 자동 그룹핑 (예상: docs 4 commits 1 그룹 + refactor 2 commits 분리 또는 묶음)

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-04-26 | 이슈 #6, `feat/6` 브랜치, 본 plan 작성 | PR #5 직후 6건 follow-up 묶음 |

## 참고

- 직전 plan 002: `docs/plan/002-route53-dns-provider.md`
- AWS SESv2 IAM 액션 매핑: <https://docs.aws.amazon.com/sesv2/latest/APIReference/Welcome.html>
- AWS Route53 IAM 액션: <https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/r53-api-permissions-ref.html>
- 원본 upstream README (참고용): <https://github.com/eibrahim/freeresend/blob/main/README.md>
