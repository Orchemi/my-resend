# 006-consolidate-dns-record-type

## 개요

- **이슈**: [#13](https://github.com/Orchemi/my-resend/issues/13)
- **브랜치**: `feat/13`
- **상태**: 진행 중
- **생성일**: 2026-04-26
- **선행**: [PR #8](https://github.com/Orchemi/my-resend/pull/8) — 타입 통합 1차 (domains.ts 의 `DNSRecord` 제거). 본 작업은 그 때 보류했던 `digitalocean.ts` 내부 `DNSRecord` 까지 정리.

## 배경

PR #8 에서 `domains.ts` 의 로컬 `DNSRecord` 를 제거하고 `DnsProviderRecord` 로 단일화했지만, `digitalocean.ts` 의 로컬 `DNSRecord` 는 의도적으로 보존했었다. 이유 (당시 메모):

> "digitalocean.ts 의 `DNSRecord` 는 외부 type-import 가 0건이라 (네임스페이스 import 만), 모듈 internal alias 로 해석 가능하고, `description?: string` optional 필드를 가지고 있어 `DnsProviderRecord` 와 정확히 동일하지 않음 (description 보존 의도)."

이제 그 잔여를 정리한다. `description?` 을 `DnsProviderRecord` 의 선택 필드로 promote 하면 두 모듈의 타입이 정확히 일치하여 정합화 가능.

## 목표

- [ ] `dns-provider.ts` 의 `DnsProviderRecord` 에 `description?: string` 추가
- [ ] `digitalocean.ts` 의 로컬 `DNSRecord` interface 제거 → `import type { DnsProviderRecord } from "./dns-provider"`
- [ ] 함수 시그니처 4건 갱신: `createDNSRecord`, `updateDNSRecord`, `setupDomainDNS`, `formatDNSInstructions` (+ `Partial<DNSRecord>` 1건)
- [ ] 기존 111 lib 테스트 무회귀 (신규 테스트 없음 — 순수 타입 cleanup)
- [ ] `npm run lint && npm test && npm run build` 통과

## 설계

### 접근 방식

`DnsProviderRecord` 에 `description` 을 선택 필드로 추가하는 것이 가장 자연스럽다:

- ses.ts 의 `generateDNSRecords()` 가 이미 모든 record 에 description 을 set (e.g., "SES Domain Verification", "DKIM Record (...)")
- digitalocean.ts 의 `formatDNSInstructions()` 가 description 을 읽어 사용자용 instructions 출력
- Route53 path 는 description 을 사용하지 않지만, optional 필드라 무관

### 변경 범위

```
my-resend/
├── src/lib/
│   ├── dns-provider.ts                      # DnsProviderRecord 에 description?: string 추가
│   └── digitalocean.ts                      # 로컬 DNSRecord 제거, DnsProviderRecord import
└── docs/plan/
    └── 006-consolidate-dns-record-type.md   # 본 문서
```

**무수정**:
- ses.ts (generateDNSRecords 의 return 형태가 이미 호환)
- domains.ts (이미 PR #8 에서 정리됨)
- route53.ts (DnsProviderRecord 사용 중, description 무시)
- 테스트 파일 (타입 변경만이므로 행동 무변화 → 회귀 테스트로 검증)

### 의사결정 기록

| 결정 사항 | 선택지 | 결정 | 이유 |
|-----------|--------|------|------|
| description 위치 | A) DnsProviderRecord 의 optional 필드 / B) 별도 ExtendedDnsProviderRecord 타입 / C) 함수-local interface | **A** | 동일 데이터 모양에 두 이름 두는 것이 PR #8 이전 상태로 회귀. optional 필드는 cost 없음 |
| ses.ts 의 generateDNSRecords return 타입 | A) DnsProviderRecord[] 명시 / B) 추론 (현재 상태 — 익명 객체 array) | **B** | return 명시 안 하는 것이 현재 working 상태. 명시는 별도 cleanup PR 후보 |

## 작업 단계

### Phase 1: 타입 변경

- [ ] `src/lib/dns-provider.ts` 의 `DnsProviderRecord` interface 에 `description?: string` 추가 (JSDoc 1줄로 의미 설명)
- [ ] `src/lib/digitalocean.ts`:
  - 로컬 `DNSRecord` interface 제거
  - 상단에 `import type { DnsProviderRecord } from "./dns-provider"` 추가
  - 함수 시그니처 4건의 `DNSRecord` → `DnsProviderRecord` (Partial 사이트 포함)

### Phase 2: 검증

- [ ] `npm run lint`
- [ ] `npm test --testPathPatterns='src/lib'` (111 → 111)
- [ ] `npm run build`

### Phase 3: 커밋 + PR

- [ ] 2 commits: docs(plan) + refactor(types)
- [ ] `/pr auto`

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-04-26 | 이슈 #13, `feat/13` 브랜치, 본 plan 작성 | PR #12 직후 후속 |

## 참고

- 직전 plan 005: `docs/plan/005-route53-zone-auto-discovery.md`
- 1차 타입 통합 PR: <https://github.com/Orchemi/my-resend/pull/8>
