# 002-route53-dns-provider

## 개요

- **이슈**: [#4](https://github.com/Orchemi/my-resend/issues/4)
- **브랜치**: `feat/4`
- **상태**: 진행 중
- **생성일**: 2026-04-26
- **선행**: [#2](https://github.com/Orchemi/my-resend/pull/2) (SES SDK v1→v2 마이그레이션) 머지됨

이 문서는 my-resend 의 DNS 자동화 모듈을 **provider-pluggable** 구조로 전환하고, AWS Route53 provider 를 신설하는 작업의 단일 진실(single source of truth) 이다.

## 배경

현재 my-resend 의 DNS 자동 등록은 `src/lib/digitalocean.ts` 한 곳에 직결되어 있다 (`domains.ts`, `app/api/domains/[id]/retry-dns/route.ts` 가 `digitalocean` 모듈을 직접 import).

다음 단계로 자연스러운 확장은:

1. **AWS Route53 provider 추가** — AWS 인프라 (특히 SES + Route53 같은 계정에서 운영) 에 배치하려는 사용자가 DigitalOcean 계정 없이 도메인 인증을 자동화할 수 있어야 한다.
2. **provider 추상화 도입** — 위 두 provider 를 하나의 인터페이스 뒤로 숨겨 consumer (`domains.ts`, API 라우트) 가 provider 분기를 모르도록 한다. 향후 Cloudflare 등 다른 provider 도 같은 패턴으로 추가 가능.
3. **backward compat 보존** — 기존 사용자(상위 fork 포함) 가 `DNS_PROVIDER` 를 설정하지 않아도 DigitalOcean 동작이 그대로 유지되어야 한다.

## 목표

- [ ] 의존성 추가: `@aws-sdk/client-route-53`
- [ ] `src/lib/route53.ts` 신설 — `digitalocean.ts` 가 `domains.ts` 에 노출하는 surface (`setupDomainDNS`, `verifyDomainOwnership`) 를 동일 시그니처로 구현
- [ ] `src/lib/dns-provider.ts` 신설 — `DNS_PROVIDER` env 분기 (`digitalocean` | `route53`, default `digitalocean`)
- [ ] `src/lib/domains.ts` 와 `src/app/api/domains/[id]/retry-dns/route.ts` 가 `dns-provider` 를 import 하도록 갱신 (직접 `digitalocean` import 제거)
- [ ] 단위 테스트:
  - `route53.test.ts` (`aws-sdk-client-mock` 사용)
  - `dns-provider.test.ts` (env 분기)
- [ ] 통합 테스트: `domains.ts.addDomain` 흐름을 두 provider 모두에서 (각각 mock 으로) 검증 — 추상화가 실제로 동작함을 증명
- [ ] `npm run lint && npm test && npm run build` 모두 통과
- [ ] PR (1 커밋 rebase / 2+ 커밋 merge)

## 설계

### 접근 방식

1. **dns-provider 가 unified API**. consumer 는 `dns-provider.setupDomainDNS(domain, dnsRecords)` / `dns-provider.verifyDomainOwnership(domain)` 만 호출. 분기 로직은 provider 모듈 내부.
2. **route53.ts 는 native 로 unified shape 반환**. 즉 `DnsProviderRecord { type, name, value, ttl }` 로 정규화된 배열 반환.
3. **digitalocean.ts 는 무수정**. 외부 호환성 보존 — 이미 `DODomainRecord` 를 반환하는 모듈이고, 공개 surface 다. `dns-provider.ts` 가 wrapping 시 변환만 추가.
4. **`DomainSetupResult.digitalOceanRecords` 필드명 → `dnsProviderRecords`** — 내부 타입 리네임. JSON API 응답 필드는 `createdRecords`(retry-dns) / `digitalOceanRecords`(addDomain 미사용 외부) 등으로 별개. 외부 노출 파급 grep 후 결정 — 0건이면 그대로 리네임, 있으면 deprecated 필드 보존.
5. **TDD**. 각 함수에 대해 mock 으로 입력·반환 매핑을 단위 테스트로 먼저 정의 → 구현. 라이브 AWS 호출 없음.
6. **env 검증**: `DNS_PROVIDER=route53` 인데 `AWS_HOSTED_ZONE_ID` 미설정 → `verifyDomainOwnership` false, `setupDomainDNS` throw — `DO_API_TOKEN` 부재 시 `digitalocean.ts` 가 하는 것과 같은 패턴.

### 변경 범위

```
my-resend/
├── package.json                              # @aws-sdk/client-route-53 추가
├── package-lock.json                         # 자동 갱신
├── src/lib/
│   ├── dns-provider.ts                       # 신규 — 추상화 + env 분기
│   ├── route53.ts                            # 신규 — Route53 SDK wrapper
│   ├── domains.ts                            # import 변경 (digitalocean → dns-provider) + 필드명 정리
│   └── __tests__/
│       ├── route53.test.ts                   # 신규
│       ├── dns-provider.test.ts              # 신규
│       └── domains-dns-integration.test.ts   # 신규 (통합)
├── src/app/api/domains/[id]/retry-dns/
│   └── route.ts                              # import 변경
└── docs/plan/
    └── 002-route53-dns-provider.md           # 본 문서
```

**무변경**:
- `src/lib/digitalocean.ts` (모듈 자체는 유지 — `dns-provider` 가 wrap)
- `src/lib/ses.ts` (Route53 와 직교)
- 기타 라우트·컴포넌트

### Route53 매핑

| Operation | Route53 SDK call | 비고 |
|-----------|------------------|------|
| Create / upsert DNS records | `ChangeResourceRecordSetsCommand` (`Action: UPSERT`) | 한 번의 setup 호출당 ChangeBatch 1건. 각 `DNSRecord` 가 `ResourceRecordSet` 1개로 매핑. MX 값 (`"10 mail.example.com."`) 은 priority/host 분리 — Route53 는 단일 `Value` 문자열에 그대로 둔다. CNAME 값의 trailing dot 보존 |
| List existing records | `ListResourceRecordSetsCommand` (paginated) | 멱등성 검사용 — 동일 type+name+value 조합이 이미 있으면 skip |
| Verify domain ownership | `ListHostedZonesByNameCommand` 또는 `GetHostedZoneCommand` | "owned" = 매칭되는 hosted zone 이 내 계정에 존재. `AWS_HOSTED_ZONE_ID` env 가 있으면 그것을 신뢰하고 `GetHostedZone` 으로 존재만 확인 |

### env 모델

| env | 적용 시점 | 기본값 | 비고 |
|-----|----------|--------|------|
| `DNS_PROVIDER` | dns-provider.ts | `digitalocean` | `digitalocean` \| `route53`. 그 외 값은 throw |
| `DO_API_TOKEN` | digitalocean.ts | — | provider=digitalocean 시 필수 |
| `AWS_HOSTED_ZONE_ID` | route53.ts | — | provider=route53 시 필수 |
| `AWS_REGION` | route53.ts (route53 는 글로벌이라 region 무관하지만 SDK 가 요구) | `us-east-1` | SES 와 동일 fallback |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | route53.ts | — | provider=route53 시 필수. SES 와 공유 |

### 의사결정 기록

| 결정 사항 | 선택지 | 결정 | 이유 |
|-----------|--------|------|------|
| 추상화 위치 | A) `dns-provider.ts` 단일 모듈 / B) `dns/{digitalocean,route53,index}.ts` 디렉토리 | **A** | provider 2개에 각 ~150 LOC 정도. 파일 분리는 over-engineering. 후속에 3개 이상 늘면 디렉토리화 |
| `digitalocean.ts` 수정 여부 | A) 그대로 + dns-provider 가 wrap / B) 함수 시그니처 통일하도록 수정 | **A** | upstream 와 충돌 최소화. wrap 의 변환 로직은 dns-provider 안 한 곳 |
| Route53 ChangeBatch 크기 | A) 레코드별 1 batch / B) 전체 묶어 1 batch | **B** | Route53 가 atomic batch 지원. SES verify TXT + DKIM CNAME 3개 + SPF + DMARC = 보통 6개 — 한 번에 보내는 것이 자연스럽고 빠름 |
| 멱등성 처리 | A) 항상 UPSERT (무조건 덮어씀) / B) List 먼저 → 차이만 적용 | **B** | DigitalOcean 모듈이 List 기반 멱등성을 갖고 있어 동작 일관성 유지. UPSERT 만 쓰면 사용자가 수동 편집한 레코드를 덮어쓸 위험 |
| 필드명 `digitalOceanRecords` | A) 유지 / B) `dnsProviderRecords` 로 rename | **B** | 추상화의 의미가 사라지지 않도록. 외부 JSON 노출 grep 결과 따라 호환 처리 |
| `DNS_PROVIDER` 미설정 동작 | A) throw / B) `digitalocean` 기본값 | **B** | upstream 에서 fork 한 사용자의 기존 환경변수가 그대로 동작해야 함 (backward compat) |
| `DNS_PROVIDER=unknown` 처리 | A) silent fallback / B) throw | **B** | 오타로 인한 silent 동작 변경 금지 — 명시적 에러로 fail-fast |
| 통합 테스트 수준 | A) unit 만 / B) `domains.ts.addDomain` 까지 / C) HTTP 레벨 | **B** | DB 의존이 있어 HTTP 레벨은 별도 인프라 필요 (Phase 7 e2e). `addDomain` 은 dns-provider 위에서 동작하므로 추상화 검증 1차 충분 |

## 작업 단계

### Phase 1: 의존성 + 추상화 골격

- [ ] `npm install @aws-sdk/client-route-53`
- [ ] `src/lib/dns-provider.ts` 골격 작성 — type, env 분기 (디스패처는 빈 함수로)
- [ ] `__tests__/dns-provider.test.ts` 작성 (env=digitalocean / env=route53 / env=unknown / env undefined → digitalocean)

### Phase 2: route53.ts TDD

- [ ] `__tests__/route53.test.ts` 셋업 (`aws-sdk-client-mock` + `Route53Client`)
- [ ] `verifyDomainOwnership` 테스트 + 구현 — `AWS_HOSTED_ZONE_ID` 있으면 `GetHostedZone` 으로 존재 확인. 없으면 false
- [ ] `setupDomainDNS` 테스트 + 구현 — `ListResourceRecordSets` → 차이 계산 → `ChangeResourceRecordSets` UPSERT
  - MX 값 분리·CNAME trailing dot 보존
  - 이미 동일 record 존재 → skip + 로그
  - 빈 ChangeBatch → no-op (SDK 호출 안 함)
- [ ] returns: `DnsProviderRecord[]` (생성·갱신된 항목만)

### Phase 3: dns-provider.ts 디스패처 완성

- [ ] `setupDomainDNS` / `verifyDomainOwnership` 가 env 에 따라 모듈 위임
- [ ] DigitalOcean 경로: `digitalocean.ts.setupDomainDNS` 호출 후 `DODomainRecord[]` → `DnsProviderRecord[]` 변환
- [ ] Route53 경로: `route53.ts` 결과 그대로 반환

### Phase 4: consumer 갱신

- [ ] `src/lib/domains.ts`: `from "./digitalocean"` → `from "./dns-provider"`. `digitalOceanRecords` 필드 → `dnsProviderRecords` (외부 JSON 노출 grep 후 결정)
- [ ] `src/app/api/domains/[id]/retry-dns/route.ts`: 동일 import 변경. 응답 메시지 "DigitalOcean" 하드코딩 제거 → 일반 표현 ("DNS provider")
- [ ] `convertDORecordToDNSRecord` 헬퍼 제거 (dns-provider 가 이미 변환된 shape 반환)

### Phase 5: 통합 테스트

- [ ] `__tests__/domains-dns-integration.test.ts`:
  - `DNS_PROVIDER=digitalocean` + axios mock — `addDomain` 흐름이 `digitalocean.ts` 만 호출하고 Route53 SDK 는 호출 안 함
  - `DNS_PROVIDER=route53` + Route53 mock — `addDomain` 흐름이 `Route53Client` 만 호출하고 axios 는 호출 안 함

### Phase 6: 검증

- [ ] `npm run lint` 통과
- [ ] `npm test` 전체 통과 (기존 ses + waitlist + notifications + pricing-calculator + 신규 3 suite)
- [ ] `npm run build` 통과

### Phase 7: 커밋 + PR

- [ ] 영어 conventional 커밋
- [ ] `gh pr create --base develop`
- [ ] PR 머지 후 본 문서 진행 로그 갱신

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-04-26 | 이슈 #4, `feat/4` 브랜치, 본 plan 작성 | PR #2 (SES v2) 직후 후속 트랙 |

## 참고

- AWS Route53 SDK v3 (JavaScript): <https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/route-53/>
- Route53 ResourceRecordSet 모델: <https://docs.aws.amazon.com/Route53/latest/APIReference/API_ResourceRecordSet.html>
- Route53 ChangeResourceRecordSets: <https://docs.aws.amazon.com/Route53/latest/APIReference/API_ChangeResourceRecordSets.html>
- aws-sdk-client-mock: <https://github.com/m-radzikowski/aws-sdk-client-mock>
- 선행 PR: <https://github.com/Orchemi/my-resend/pull/2>
- 직전 plan: `docs/plan/001-ses-v2-migration.md`
