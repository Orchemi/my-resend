# 005-route53-zone-auto-discovery

## 개요

- **이슈**: [#11](https://github.com/Orchemi/my-resend/issues/11)
- **브랜치**: `feat/11`
- **상태**: 진행 중
- **생성일**: 2026-04-26
- **선행**: PR [#5](https://github.com/Orchemi/my-resend/pull/5) (Route53 + DNS_PROVIDER 추상화), [#8](https://github.com/Orchemi/my-resend/pull/8) / [#10](https://github.com/Orchemi/my-resend/pull/10) (digitalocean/ses lazy env capture)

본 작업은 두 개의 작은 변경을 묶는다 — 둘 다 `route53.ts` 한 파일 안에서 끝나고 같은 책임 영역 (Route53 provider 의 env 처리) 이라 한 PR.

1. **Hosted zone auto-discovery** — `AWS_HOSTED_ZONE_ID` 미설정 시 도메인으로부터 자동 탐지 (UX 개선, README roadmap 등재)
2. **`Route53Client` lazy 화** — sister 모듈 (`digitalocean.ts`, `ses.ts`) 와 동일한 lazy env capture 패턴으로 정합

## 배경

### 1. Auto-discovery

현재 `route53.ts.verifyDomainOwnership(domain)` 은 `domain` 인자를 무시하고 `AWS_HOSTED_ZONE_ID` env 만 본다. 이 설계는 단순하지만, operator 가 zone ID 를 손으로 복사해서 env 에 넣어야 하는 boilerplate 가 남는다. AWS 관행상 한 root 도메인당 hosted zone 1개가 일반적이라, SDK 가 자동 탐지할 수 있는 정보다.

또한 sending domain 이 subdomain 인 경우 (예: `mail.example.com`) 보통은 `example.com.` zone 안에 위치한다. parent zone 매칭으로 이 케이스를 자동 처리.

### 2. Lazy env capture

PR #8 (digitalocean), PR #10 (ses) 가 module-load 캡처를 lazy getter 로 바꿨지만 `route53.ts` 는 여전히 module-load 에 `Route53Client` 를 생성한다 (line 30). 같은 패턴 비대칭. 본 작업에서 `getRoute53Client()` 도입.

## 목표

- [ ] `resolveHostedZoneId(domain): Promise<string | undefined>` 신설:
  - `AWS_HOSTED_ZONE_ID` 설정 → 그대로 반환 (SDK 호출 0)
  - 미설정 → `ListHostedZonesByNameCommand` 로 도메인 매칭. exact match 없으면 parent 도메인으로 재시도 (root 까지 cap)
  - 결과를 in-process Map 으로 memoize (도메인별)
- [ ] `verifyDomainOwnership` 가 `resolveHostedZoneId(domain)` 사용
- [ ] `setupDomainDNS` 가 `resolveHostedZoneId(domain)` 사용
- [ ] `Route53Client` lazy 화 — `getRoute53Client()` 도입, 모든 호출처 갱신
- [ ] 단위 테스트:
  - 신규: resolveHostedZoneId 의 4 케이스 (env 사용, exact match, parent match, no match)
  - 신규: memoize 동작 (같은 도메인 재호출 시 SDK 호출 0)
  - 기존 10 케이스 무회귀
- [ ] README + CLAUDE.md 갱신: `AWS_HOSTED_ZONE_ID` 를 optional 로, discovery 규칙 1줄 설명
- [ ] `npm run lint && npm test && npm run build` 모두 통과

## 설계

### 접근 방식

#### resolveHostedZoneId 알고리즘

```
function resolveHostedZoneId(domain):
  1. env AWS_HOSTED_ZONE_ID 있으면 → 반환 (SDK X)
  2. cache hit (domain → id) 있으면 → 반환
  3. SDK 호출:
     - candidate = domain
     - while candidate has at least one dot:
         response = ListHostedZonesByName({DNSName: candidate + ".", MaxItems: 1})
         if response.HostedZones[0].Name == candidate + ".":
             cache[domain] = response.HostedZones[0].Id (zone ID, sans /hostedzone/ prefix)
             return cached
         candidate = strip first label (mail.example.com → example.com)
     return undefined
```

- `ListHostedZonesByName` 는 lexicographic 순서로 반환하므로, `DNSName=example.com.` 으로 호출하면 `example.com.` 또는 그 다음 zone 이 첫 결과로 옴. 첫 결과의 Name 이 정확히 `<candidate>.` 인지 비교해야 안전.
- Zone ID 형식: SDK 응답은 `/hostedzone/Z0123...` 형태. 이후 `GetHostedZone` / `ChangeResourceRecordSets` 호출 시 `Z0123...` 만 필요하므로 prefix 제거.

#### 캐싱

- module-level `Map<string, string>` (도메인 → zone ID).
- env 설정된 경우 cache 미사용 (env 가 single source of truth).
- cache 무효화 mechanism 없음 — process lifetime 동안 유지. 도메인이 zone 이동되는 경우는 매우 드물고, 발생 시 재시작으로 해결.

#### Lazy Route53Client

`getRoute53Client(): Route53Client` 함수로 wrap. 매 호출마다 `new Route53Client({...})`. `digitalocean.ts.getDoClient()` 와 동일 패턴.

### 변경 범위

```
my-resend/
├── src/lib/
│   ├── route53.ts                              # resolveHostedZoneId + lazy client + 호출처 갱신
│   └── __tests__/
│       └── route53.test.ts                     # 신규 케이스 추가 (~5)
├── README.md                                   # AWS_HOSTED_ZONE_ID optional 표시 + 1줄 설명
├── README.ko.md                                # 동일 (parity)
├── CLAUDE.md                                   # env 섹션 갱신
└── docs/plan/
    └── 005-route53-zone-auto-discovery.md      # 본 문서
```

**무수정**:
- `dns-provider.ts`, `digitalocean.ts`, `ses.ts`, `domains.ts` — Route53 의 외부 시그니처 (`verifyDomainOwnership`, `setupDomainDNS`) 무변경

### 의사결정 기록

| 결정 사항 | 선택지 | 결정 | 이유 |
|-----------|--------|------|------|
| env vs auto-discovery 우선순위 | A) env 우선 / B) auto 우선 / C) auto 만 | **A** | 명시적 설정이 항상 implicit 추론보다 우선. 또한 다중 zone 환경에서 operator 가 의도한 zone 을 콕 집을 수 있어야 함 |
| Parent 매칭 | A) 정확히 한 단계만 / B) root 까지 walk-up / C) 매칭 안 함 | **B** | `mail.staging.example.com` 같은 다단 subdomain 도 단일 step 으로 부족. root 까지 시도가 자연스러움 |
| 매칭 실패 처리 | A) throw / B) undefined 반환 → 기존 분기 (verify=false, setup=throw) 가 처리 | **B** | 기존 분기 로직 (env 미설정 시) 과 일관 |
| Cache 정책 | A) 영구 (process 수명) / B) TTL 있음 / C) cache 없음 | **A** | zone 이동은 매우 드물고, 발생 시 재시작 cost 가 낮음. 복잡한 TTL 도입은 over-engineering |
| Cache 키 | A) domain 원형 / B) zone Name 정규화 (trailing dot) | **A** | 입력 그대로가 단순. 호출자 입력의 다양성을 흡수 |
| Lazy Route53Client 묶음 여부 | A) 본 PR 에서 같이 / B) 별도 PR | **A** | 같은 파일 한 줄 변경. 별도 PR 비용이 작업보다 큼. sister 모듈 패턴 통일 효과 |

## 작업 단계

### Phase 1: lazy Route53Client (작은 변경, 회귀 baseline 확보)

- [ ] 상단 `const route53Client = new Route53Client({...})` 제거
- [ ] `function getRoute53Client(): Route53Client` 도입
- [ ] 4건 `route53Client.send(...)` → `getRoute53Client().send(...)`
- [ ] 기존 10 테스트 통과 확인 (`mockClient(Route53Client)` 가 prototype 패치라 안전)

### Phase 2: resolveHostedZoneId TDD

- [ ] `__tests__/route53.test.ts` 에 신규 describe 추가 — `resolveHostedZoneId`
- [ ] 케이스:
  1. `AWS_HOSTED_ZONE_ID` 설정 → 그대로 반환, `ListHostedZonesByName` 호출 0
  2. env 미설정 + exact match → 정상 zone ID 반환 (`/hostedzone/` prefix 제거 확인)
  3. env 미설정 + parent match (`mail.example.com` → `example.com.`) → parent zone ID 반환
  4. env 미설정 + 다단 subdomain parent match (`a.b.example.com` → `example.com.`)
  5. env 미설정 + match 없음 → undefined
  6. memoize: 같은 도메인 두 번 호출 → SDK 호출 1회만
- [ ] 모든 케이스 RED → GREEN

### Phase 3: 통합

- [ ] `verifyDomainOwnership(domain)` 가 `resolveHostedZoneId(domain)` 사용
  - 결과 undefined → false
  - 결과 zone ID → 기존 `GetHostedZone` 흐름 (NoSuchHostedZone 처리 보존)
- [ ] `setupDomainDNS(domain, dnsRecords)` 가 `resolveHostedZoneId(domain)` 사용
  - 결과 undefined → throw (메시지: `AWS_HOSTED_ZONE_ID is not set and no matching hosted zone found for domain '<domain>'`)
- [ ] 기존 통합 테스트 (`domains-dns-integration.test.ts`) 회귀 없음 확인

### Phase 4: 문서 갱신

- [ ] README.md 의 env table:
  - `AWS_HOSTED_ZONE_ID` 행을 optional 로 표기 + "if unset, the zone is auto-discovered from the domain"
  - DNS Provider Setup → 옵션 B (Route53) 섹션에 1줄 추가
- [ ] README.ko.md 동일 (한국어 parity)
- [ ] CLAUDE.md 의 env 섹션 + Route53 integration 섹션 1-2줄 갱신

### Phase 5: 검증

- [ ] `npm run lint`
- [ ] `npm test --testPathPatterns='src/lib'` (105 + 신규 5-6 = ~110)
- [ ] `npm run build`

### Phase 6: 커밋 + PR

- [ ] 관심사별 분리 가능하면 분리, 아니면 단일 commit
- [ ] `/pr auto`

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-04-26 | 이슈 #11, `feat/11` 브랜치, 본 plan 작성 | PR #10 직후 후속 |

## 참고

- AWS `ListHostedZonesByName`: <https://docs.aws.amazon.com/Route53/latest/APIReference/API_ListHostedZonesByName.html>
- 직전 plan 004 (ses lazy): `docs/plan/004-ses-lazy-env-capture.md`
- README roadmap 의 등재: "Hosted-zone auto-discovery for Route53"
