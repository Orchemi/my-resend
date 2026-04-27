# 009-admin-connections-health-check

## 개요

- **이슈**: [#22](https://github.com/Orchemi/my-resend/issues/22)
- **브랜치**: `feat/22`
- **상태**: 진행 중
- **생성일**: 2026-04-27
- **선행**: [PR #18](https://github.com/Orchemi/my-resend/pull/18) — CI gate (plan 008). 본 PR 도 동일한 4 단계 (lint → typecheck → test → build) 를 머지 기준으로 그대로 사용한다.

## 배경

운영자가 SES / DNS provider 환경변수 (`AWS_*`, `DO_API_TOKEN`, `AWS_HOSTED_ZONE_ID`, `DNS_PROVIDER`) 를 설정한 뒤 "정말 정상 동작 가능한 상태인가?" 를 확인할 비파괴 경로가 없다. 현재 검증 방법은 "도메인 추가 → DNS 레코드 생성 → 검증 메일 발송" 까지 끝까지 가야 하는데, 그 전에 단순 credential / IAM 권한 누락이면 한참 후에야 실패가 드러난다.

Admin Dashboard 에 **Connections** 탭을 추가해 SES 와 활성 DNS provider 의 헬스를 한 번의 fetch 로 확인할 수 있게 한다. 호출은 모두 read-only — 도메인을 만들거나 메시지를 보내지 않는다. 응답에는 region 같은 비시크릿 진단 정보만 포함하고, AWS access key / DO token 같은 시크릿은 어떤 경로로도 노출되지 않는다.

upstream `freeresend` 에는 admin 헬스 체크 개념이 없었으므로 본 작업은 fork 의 추가 기능이다.

## 목표

- [x] `GET /api/health/ses` — SESv2 GetAccount 기반 헬스 + 송신 quota 응답 (admin only)
- [x] `GET /api/health/dns` — 활성 DNS provider 의 헬스 응답 (admin only, provider dispatch)
- [x] `src/lib/dns-provider.ts` 에 `checkDnsProvider()` 디스패처 + 각 provider 모듈에 `checkProvider()` 추가
- [x] `src/components/ConnectionsTab.tsx` — 카드 2 개 (SES, DNS) + refresh 버튼
- [x] `src/components/Dashboard.tsx` 에 `connections` 탭 등록 (Tab union, tabs 배열, 렌더 분기)
- [x] 양 route + DNS provider check 함수 + ConnectionsTab 컴포넌트 단위 테스트 추가
- [x] CLAUDE.md / README 에 Connections 탭 한 단락 추가
- [x] 로컬 4 단계 (`npm run lint` → `npm run typecheck` → `npm test -- --runInBand` → `npm run build`) 모두 통과 확인

## 설계

### 접근 방식

1. **read-only 헬스**. 모든 호출은 list / get 계열만 사용한다 — `SESv2.GetAccount`, DO `GET /v2/domains`, Route53 `ListHostedZones` 또는 `GetHostedZone`. 도메인 생성 / 레코드 변경 / 메시지 발송은 절대 일어나지 않는다.
2. **active provider 만 확인**. `getDnsProviderName()` 의 결과로 현재 활성인 한쪽만 체크한다. 두 provider 동시 probing 은 불필요하고, 비활성 provider 의 토큰 부재를 false-negative 로 보고하게 된다. 이슈 본문의 "isolation" 은 **단위 테스트 단위에서 두 provider 가 서로 영향을 주지 않게 격리** 한다는 뜻으로 해석한다 (각각의 mock 셋업이 분리됨).
3. **어드민 전용**. 두 route 모두 기존 `withAuth` middleware 로 감싼다. JWT 미보유 / 만료 시 401 — middleware 가 일관 처리. role 기반 추가 분기는 본 PR 의 단위 밖.
4. **비시크릿만 응답**. 응답에 region 등 운영 진단에 쓸 수 있는 비밀이 아닌 정보만 포함한다. `accessKeyId`, `secretAccessKey`, DO token, JWT, 또는 raw `error.stack` 은 어떤 분기에서도 직렬화하지 않는다. AWS / axios 에러는 `{ name, message, httpStatusCode }` 의 좁은 정규화 객체로 바뀌어 `error` 필드에 들어간다.
5. **마운트 1 회 + 수동 refresh**. ConnectionsTab 은 mount 시 두 fetch 를 동시 실행하고, refresh 버튼으로 재실행한다. 자동 polling 은 본 PR 의 단위 밖 — "후속 트랙 후보" 로 기록.

### API 응답 스키마

`GET /api/health/ses` (SESv2.GetAccount 1 콜):

```ts
type SesHealthResponse =
  | {
      ok: true;
      region: string;                  // process.env.AWS_REGION || "us-east-1"
      sandbox: boolean;                // !response.ProductionAccessEnabled
      sendingEnabled: boolean;         // response.SendingEnabled
      enforcementStatus: string | null; // response.EnforcementStatus (e.g. "HEALTHY")
      sendQuota: {
        max24HourSend: number;         // response.SendQuota.Max24HourSend
        maxSendRate: number;           // response.SendQuota.MaxSendRate
        sentLast24Hours: number;       // response.SendQuota.SentLast24Hours
      } | null;                        // null if SendQuota absent (e.g. some sandbox accounts)
    }
  | {
      ok: false;
      region: string;
      error: { name: string; message: string; httpStatusCode: number | null };
    };
```

`GET /api/health/dns`:

```ts
type DnsHealthResponse =
  | {
      ok: true;
      provider: "digitalocean";
      detail: { domainCount: number };
    }
  | {
      ok: true;
      provider: "route53";
      detail: { hostedZoneCount: number; pinnedZoneId: string | null };
    }
  | {
      ok: false;
      provider: "digitalocean" | "route53";
      error: { name: string; message: string; httpStatusCode: number | null };
    };
```

### SES 헬스 — `GetAccountCommand` 단일 호출

`@aws-sdk/client-sesv2` 의 `GetAccountCommand` 응답에 다음 필드가 모두 들어 있다 (AWS SDK v3 sesv2 공식 API):

- `SendQuota`: `{ Max24HourSend, MaxSendRate, SentLast24Hours }`
- `ProductionAccessEnabled`: boolean — `false` ↔ sandbox
- `SendingEnabled`: boolean — 계정 송신 가능 여부
- `EnforcementStatus`: `"HEALTHY" | "PROBATION" | "SHUTDOWN"` 등

따라서 quota 와 sandbox 판정 모두 sesv2 SDK 한 콜로 충족 — `@aws-sdk/client-ses` v1 SDK 추가 불필요. `sandbox = !ProductionAccessEnabled` 로 판단한다. `SendingEnabled` 와 `EnforcementStatus` 는 별개 질문에 대한 답이라 (각각 "지금 보낼 수 있나?" / "어카운트가 sandbox 인가?") 분리해서 응답에 노출한다.

> 구현 시점에 SDK 응답 shape 가 위와 다르면 (`SendQuota` 누락 등) `@aws-sdk/client-ses` v1 의 `GetSendQuotaCommand` 추가를 fallback 으로 검토. 그 경우 `package.json` 에 의존성 1 개 추가, 같은 region / credential 로 두 client 모두 빌드.

### DNS 헬스 — provider 디스패처

`src/lib/dns-provider.ts` 에 검사 함수 추가:

```ts
export type DnsHealth =
  | { ok: true; provider: "digitalocean"; detail: { domainCount: number } }
  | { ok: true; provider: "route53"; detail: { hostedZoneCount: number; pinnedZoneId: string | null } }
  | { ok: false; provider: DnsProviderName; error: { name: string; message: string; httpStatusCode: number | null } };

export async function checkDnsProvider(): Promise<DnsHealth> {
  const provider = getDnsProviderName();
  switch (provider) {
    case "digitalocean": return digitalocean.checkProvider();
    case "route53":      return route53.checkProvider();
  }
}
```

각 provider 의 `checkProvider()`:

- **`digitalocean.checkProvider()`**: `getApiToken()` 부재 → `{ ok: false, error: { name: "MissingToken", message: "DO_API_TOKEN is not set", httpStatusCode: null } }`. 토큰 있으면 기존 `getDomains()` 호출 → `{ ok: true, detail: { domainCount: domains.length } }`. axios 에러는 `{ name: error.name ?? "AxiosError", message: error.message, httpStatusCode: error.response?.status ?? null }` 로 정규화.
- **`route53.checkProvider()`**: `AWS_HOSTED_ZONE_ID` 가 설정돼 있으면 `GetHostedZoneCommand({ Id })` 호출 → 성공 시 `{ ok: true, detail: { hostedZoneCount: 1, pinnedZoneId } }`. 미설정이면 `ListHostedZonesCommand({})` 로 계정 단위 zone 목록 조회 → `{ ok: true, detail: { hostedZoneCount: response.HostedZones?.length ?? 0, pinnedZoneId: null } }`. AWS 에러는 `{ name, message, httpStatusCode: error.$metadata?.httpStatusCode ?? null }`.

> 부분 성공 (예: list 는 되는데 일부 zone 만 권한 없음) 케이스는 본 헬스의 단위 밖이다 — list 가 200 으로 돌아오면 `ok: true`, 권한 부족이면 list 자체가 401/403 으로 떨어져 `ok: false` 가 된다.

### Route 파일 패턴 (Next.js 15 App Router)

기존 `src/app/api/auth/me/route.ts` 등의 컨벤션:

```ts
export const GET = withAuth(async (_req) => {
  try {
    const result = await ...;
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(normalize(error), { status: 200 });
    // 또는 5xx 가 의미 있으면 status 분기. 본 헬스는 "체크 자체가 실패해도
    // 진단 정보를 200 으로 돌려준다" 정책: ok=false 가 정상 응답이며,
    // 라우트 자체가 throw 한 경우만 500.
  }
});
```

응답 status 정책:

- `ok: true` / `ok: false` 둘 다 **HTTP 200** — UI 가 한 fetch 로 result 를 처리할 수 있게.
- 라우트 핸들러 내부에서 예기치 못한 throw (정규화 실패 등) → 500, body 는 `handleError()` 의 표준 포맷.

### UI — `ConnectionsTab.tsx`

- 기존 `[Feature]Tab.tsx` 패턴 + Tailwind v4. `'use client'`.
- 카드 2 개 (SES, DNS), 각 카드 우상단에 상태 뱃지: `loading` (gray) / `ok` (green) / `error` (red).
- mount 시 `useEffect` 로 두 endpoint 를 `Promise.all` 로 동시 fetch.
- "Refresh" 버튼: 로딩 중 disabled, 클릭 시 동일 fetch 재실행.
- SES 카드: region, sandbox 여부, sendingEnabled, enforcementStatus, sendQuota 3 필드를 표 형태로. 에러면 `error.name` + `error.message` 만 표시.
- DNS 카드: provider 이름, provider 별 detail (DO=domainCount, Route53=hostedZoneCount + pinnedZoneId 있으면 표시). 에러면 동일.
- 시크릿 일체 미표시. region / provider 이름 / count 만.

### Dashboard 통합

```ts
type Tab = "domains" | "apikeys" | "logs" | "connections";

const tabs = [
  ...,
  { id: "connections" as Tab, name: "Connections", description: "SES & DNS provider health" },
];

{activeTab === "connections" && <ConnectionsTab />}
```

탭 순서는 도메인 / API Keys / Logs / Connections — 일상 사용도가 낮으므로 끝에 배치.

### 변경 범위

```
my-resend/
├── src/lib/
│   ├── dns-provider.ts                           # checkDnsProvider() + DnsHealth 타입 추가
│   ├── digitalocean.ts                           # checkProvider() 추가
│   └── route53.ts                                # checkProvider() 추가
├── src/app/api/health/
│   ├── ses/
│   │   ├── route.ts                              # 신규 — withAuth(GET)
│   │   └── __tests__/route.test.ts               # 신규
│   └── dns/
│       ├── route.ts                              # 신규 — withAuth(GET)
│       └── __tests__/route.test.ts               # 신규
├── src/components/
│   ├── ConnectionsTab.tsx                        # 신규
│   ├── Dashboard.tsx                             # Tab union + tabs[] + 렌더 분기
│   └── __tests__/ConnectionsTab.test.tsx         # 신규
├── src/lib/__tests__/
│   ├── digitalocean.test.ts                      # checkProvider 케이스 (없으면 신규 파일)
│   ├── route53.test.ts                           # checkProvider 케이스 추가
│   └── dns-provider.test.ts                      # checkDnsProvider 디스패치 케이스 추가
├── CLAUDE.md                                     # Connections 탭 한 단락 (Architecture 또는 Features 섹션)
├── README.md / README.ko.md                      # Connections 탭 한 줄 (선택, 필요 시)
└── docs/plan/
    └── 009-admin-connections-health-check.md     # 본 문서
```

**무수정**:

- `src/app/api/health/route.ts` — 기존 정적 health (uptime / version) 는 unauthenticated 라 그대로 둠. SES / DNS 헬스는 별도 path 로 분리.
- `database.sql` (스키마 변경 없음)
- 기존 `domains.ts`, `ses.ts` 본체

### 의사결정 기록

| 결정 사항 | 선택지 | 결정 | 이유 |
|-----------|--------|------|------|
| SES quota / sandbox 정보원 | A) sesv2 `GetAccountCommand` / B) v1 `GetSendQuotaCommand` 추가 / C) sandbox 판정만 + quota 생략 | **A** | sesv2 GetAccount 응답에 SendQuota / ProductionAccessEnabled / SendingEnabled / EnforcementStatus 모두 포함 — 1 콜로 충분. 의존성 미증가. SDK shape 가 다르면 impl 시점에 B 로 전환 |
| Sandbox 판정 필드 | A) `!ProductionAccessEnabled` / B) `EnforcementStatus` 파싱 | **A** | ProductionAccessEnabled 가 sandbox 의 정의. EnforcementStatus 는 별개 (probation / shutdown 등) — 둘 다 분리 노출 |
| DNS health 디스패치 | A) active provider 만 / B) 두 provider 모두 동시 probe | **A** | 비활성 provider 의 토큰 부재가 false-negative 로 보고됨. 이슈 본문 "isolation" 은 단위 테스트 격리 의미로 해석 |
| Route53 zone 조회 방법 | A) pinnedZoneId 있으면 GetHostedZone, 없으면 ListHostedZones / B) 항상 ListHostedZones | **A** | pinned zone 이 명시돼 있으면 그 zone 의 실제 가시성을 검증하는 게 더 정확. unpinned 면 list 로 전체 가시성 확인 |
| Auth | A) `withAuth` (JWT) / B) admin role 별도 / C) unauth | **A** | 현 코드베이스에 role 분기 없음 — 향후 role 도입 시 별도 PR. unauth 는 시크릿 에러 메시지 누설 위험 |
| Auth wiring 형태 | A) `export const GET = withAuth(...)` / B) `export async function GET(req) { ... verifyJWT inline ... }` | **B** | 빌드 시 Next.js 15 의 route export validator 가 `withAuth` 의 generic 두번째 인자를 invalid 로 거부 (`RouteContext<...> \| undefined` ≠ `RouteContext`). 기존 모든 route (`auth/me`, `domains`, `emails/logs` 등) 도 inline 패턴이라 일관성도 보존. middleware 시그니처 수정은 본 PR 단위 밖 — 별도 리팩토링 후속 트랙 후보로 기록 |
| 응답 status code | A) 항상 200 (ok 필드로 분기) / B) ok=false 시 503 | **A** | UI 가 단일 success path 로 result 처리. 503 은 fetch 가 throw 로 분기돼 UX 가 두 갈래 |
| Polling | A) mount 1 회 + 수동 refresh / B) 자동 polling | **A** | "후속 트랙 후보" 로 기록. MVP 는 진단 도구 — 운영자가 명시적으로 누를 때만 호출 |
| 시크릿 노출 정책 | A) region / count 만 / B) AWS account ID 같은 식별자도 포함 | **A** | 본 PR 의 단일 커밋가능 정책. account ID 같은 메타는 가치보다 위험이 큼 |

### 테스트 계획

**`/api/health/ses` route**:

- happy: `aws-sdk-client-mock` 으로 GetAccount 가 `ProductionAccessEnabled: true, SendingEnabled: true, SendQuota: { Max24HourSend: 50000, MaxSendRate: 14, SentLast24Hours: 200 }, EnforcementStatus: "HEALTHY"` 반환 → 응답 `ok: true, sandbox: false, sendQuota: {...}` 검증.
- sandbox: `ProductionAccessEnabled: false` → `sandbox: true`.
- IAM 거부: `Object.assign(new Error("not authorized"), { name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } })` reject → `ok: false, error.httpStatusCode: 403`. 시크릿 미포함 검증 (응답 직렬화 결과에 access key / token 패턴 absent).
- network 에러: `Error("ECONNREFUSED")` reject → `ok: false`.
- SendQuota 누락: `ProductionAccessEnabled: true, SendQuota: undefined` → `sendQuota: null` (sandbox 계정 일부에서 발생 가능).
- auth 미통과: `withAuth` 가 401 — middleware 단위라 별도 케이스 1 개로만 검증.

**`/api/health/dns` route** (양 provider 격리):

- DigitalOcean active + 토큰 있음 + `getDomains()` happy → `provider: "digitalocean", detail.domainCount`.
- DigitalOcean active + 토큰 없음 → `ok: false, error.name: "MissingToken"`.
- DigitalOcean active + axios 401 → `ok: false, error.httpStatusCode: 401`.
- Route53 active + `AWS_HOSTED_ZONE_ID` 설정 + GetHostedZone 성공 → `ok: true, detail.hostedZoneCount: 1, detail.pinnedZoneId`.
- Route53 active + zone id 미설정 + ListHostedZones 응답 (3 zones) → `hostedZoneCount: 3, pinnedZoneId: null`.
- Route53 active + AWS 403 → `ok: false`.
- 알 수 없는 `DNS_PROVIDER` → `getDnsProviderName()` 이 throw → 라우트가 500 (`handleError`).
- 양 케이스에서 `DNS_PROVIDER` 환경변수는 케이스 셋업에서 set, afterEach 에서 원복 (route53.test.ts 의 `ORIGINAL_HOSTED_ZONE_ID` 패턴 따라 격리).

**`ConnectionsTab` 컴포넌트**:

- 마운트 시 두 endpoint fetch 호출 검증 (`global.fetch` mock).
- 로딩 상태 → ok 전환 → 카드별 데이터 렌더 (region, sandbox, sendQuota, provider, count).
- 한쪽 fetch reject → 해당 카드만 error 뱃지, 다른 카드는 ok.
- refresh 버튼 click → fetch 재호출 (call count +2).
- 응답 텍스트에 시크릿 키 패턴 (e.g. `AKIA`, `Bearer`) 미포함 — sanity assertion.

### 리스크 / 대안

- **SDK shape drift**: sesv2 `GetAccountCommand` 응답이 SDK 마이너 버전에서 필드명 변경 가능성. impl 시점에 실제 응답 타입을 확인하고 (`GetAccountCommandOutput` 타입 import), 차이가 있으면 의사결정 기록을 갱신.
- **시크릿 누설**: AWS / axios 에러 객체에 `request.headers.Authorization` 가 포함된 경우가 있다. 정규화 단계에서 **whitelist** (`name`, `message`, `httpStatusCode` 만) 로 빌드 — `JSON.stringify(error)` 같은 광범위 직렬화 금지.
- **Route53 권한 부분 성공**: List 는 200 인데 GetHostedZone 이 일부만 통과하는 경우는 본 헬스의 단위 밖 — list 결과만 신뢰. 향후 도메인별 verification status 통합 시 처리.
- **DigitalOcean rate limit**: `getDomains()` 가 `retryRequest` 로 감싸져 429 에 백오프. 헬스 체크가 retry 로 길어질 수 있으나 운영자가 누르는 호출이라 허용.
- **OSS 가시성 (project profile)**: 응답 / 에러 메시지 / 테스트 fixture 에서 horbis, .claude.local, claude code, 개인 도메인 (huns.site 등) 언급 금지. 테스트 fixture 도메인은 RFC 2606 의 `example.com`.

### 머지 기준

- CI gate 4 단계 (lint / typecheck / test / build) 모두 통과 (PR #18 기준).
- 모든 외부 SDK / HTTP 호출 mock — 실제 AWS / DO 엔드포인트 hit 0.
- 양 DNS provider 의 check 단위 테스트가 서로의 mock 셋업에 영향받지 않음 (isolation).
- 응답 직렬화 결과에 시크릿 패턴 (`AKIA*`, `Bearer *`, `secretAccessKey`, `DO_API_TOKEN`) 미포함 — assertion 으로 강제.

### 후속 트랙 후보

- 주기적 polling (e.g. 30s) + 상태 변화 알림.
- 다른 의존성 헬스: Postgres connection, JWT secret presence.
- 도메인별 SES verification status 통합 (현 `getDomainVerificationStatus` 활용).
- Admin role 도입 후 `withAuth` → `withAdminAuth` 로 좁히기.
- `src/lib/middleware.ts` 의 `withAuth` 시그니처를 Next.js 15 route handler 타입과 호환되도록 리팩토링 (`export const GET = withAuth(...)` 형태가 가능하게). 본 PR 은 빌드 통과를 위해 inline `verifyJWT` 패턴으로 진행 (기존 라우트와 일관 유지).

## 작업 단계

### Phase 1: SES 헬스 route + 테스트

- [x] `src/app/api/health/ses/route.ts` 작성 — `withAuth(async (_req) => ...)`, sesv2 client 빌드, `GetAccountCommand` send, 응답 정규화
- [x] `src/app/api/health/ses/__tests__/route.test.ts` 작성 — happy / sandbox / IAM 거부 / network 에러 / SendQuota 누락 / auth 누락 케이스 (failing first)
- [x] 로컬 `npm test -- --runInBand src/app/api/health/ses` 통과

### Phase 2: DNS provider check 함수 + 테스트

- [x] `src/lib/digitalocean.ts` 에 `checkProvider()` 추가
- [x] `src/lib/route53.ts` 에 `checkProvider()` 추가 (pinned vs list 분기)
- [x] `src/lib/dns-provider.ts` 에 `DnsHealth` 타입 + `checkDnsProvider()` 디스패처 추가
- [x] `src/lib/__tests__/digitalocean.test.ts` (없으면 신규) — 토큰 없음 / happy / 401 케이스
- [x] `src/lib/__tests__/route53.test.ts` 에 checkProvider 케이스 추가 (pinned + GetHostedZone, unpinned + ListHostedZones, 403)
- [x] `src/lib/__tests__/dns-provider.test.ts` 에 디스패처 케이스 추가
- [x] 로컬 lib 테스트 통과

### Phase 3: DNS 헬스 route + 테스트

- [x] `src/app/api/health/dns/route.ts` 작성 — `withAuth` + `checkDnsProvider()` 호출 + try/catch (500 분기)
- [x] `src/app/api/health/dns/__tests__/route.test.ts` 작성 — DO active 3 케이스 / Route53 active 3 케이스 / 알 수 없는 provider 케이스
- [x] 로컬 통과

### Phase 4: ConnectionsTab + Dashboard 통합

- [x] `src/components/ConnectionsTab.tsx` 작성 — 카드 2 개, mount fetch, refresh 버튼, 상태 뱃지
- [x] `src/components/__tests__/ConnectionsTab.test.tsx` 작성 — 로딩 / ok / 에러 / refresh / 시크릿 부재 sanity
- [x] `src/components/Dashboard.tsx` 수정 — Tab union 확장, tabs 배열에 항목 추가, 렌더 분기 추가
- [x] 로컬 컴포넌트 테스트 통과

### Phase 5: 문서 갱신

- [x] CLAUDE.md 의 Architecture 또는 Features 섹션에 Connections 탭 한 단락 추가 (응답 schema, secret policy, route path)
- [x] README.md / README.ko.md 의 Features 섹션에 한 줄 추가 (선택)

### Phase 6: CI gate 4 단 로컬 검증

- [x] `npm run lint` → 0 warning
- [x] `npm run typecheck` → 0 error (PR #16 baseline 유지)
- [x] `npm test -- --runInBand` → 회귀 없음, 신규 케이스 모두 pass (CI 와 동일하게 `--testPathIgnorePatterns='WaitlistSignup'` 적용 — 이슈 #19 leak 해결 전까지 CI 도 같은 ignore 사용)
- [x] `npm run build` → success

### Phase 7: 커밋 + PR

- [ ] 관심사별 commit 분리 (feat(health-ses) / feat(dns-provider) / feat(health-dns) / feat(connections-tab) / docs)
- [ ] `/pr` 으로 PR 생성, base = develop
- [ ] PR 본문에 응답 schema 예시 + secret policy 명시 + 후속 트랙 후보 follow-up 노트

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-04-27 | 이슈 #22, `feat/22` 브랜치, 본 plan 작성 | PR #18 (CI gate) 직후 |
| 2026-04-27 | SDK shape 검증: `GetAccountCommandOutput` 의 `SendQuota.Max24HourSend / MaxSendRate / SentLast24Hours`, `ProductionAccessEnabled`, `SendingEnabled`, `EnforcementStatus` 모두 plan 가정과 일치 | `@aws-sdk/client-sesv2@3.1037.0` `dist-types/commands/GetAccountCommand.d.ts` 직접 확인. v1 fallback 불필요 |
| 2026-04-27 | Phase 1~6 구현 완료, 4단 로컬 통과 (lint 0 warning, tsc 0 error, 14 suites/162 tests, build success) | 신규 28 케이스: SES route 6 + DNS route 8 + Route53 checkProvider 3 + DigitalOcean checkProvider 3 + dns-provider 디스패처 3 + ConnectionsTab 5. Phase 7 (커밋/PR) 은 사용자 명령 대기 |
| 2026-04-27 | 의사결정 변경: Auth wiring 을 `withAuth(GET)` 에서 inline `verifyJWT` 로 전환 — Next.js 15 의 route export validator 가 `withAuth` generic 시그니처를 invalid 로 거부 (build 단계). 기존 모든 route 가 inline 패턴이라 일관성도 회복. middleware 리팩토링은 후속 트랙 후보로 기록 | "의사결정 기록" 표 + "후속 트랙 후보" 섹션 갱신 |

## 참고

- 직전 plan 008: `docs/plan/008-ci-gate.md`
- AWS SDK v3 sesv2 GetAccount: <https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sesv2/command/GetAccountCommand/>
- AWS SDK v3 Route53 ListHostedZones: <https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/route-53/command/ListHostedZonesCommand/>
- aws-sdk-client-mock: <https://github.com/m-radzikowski/aws-sdk-client-mock>
- 기존 헬스 패턴: `src/app/api/health/route.ts` (정적 unauthenticated)
- 기존 라우트 + 인증 패턴: `src/app/api/auth/me/route.ts`, `src/app/api/domains/route.ts`
