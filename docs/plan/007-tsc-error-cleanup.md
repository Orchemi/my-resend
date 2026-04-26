# 007-tsc-error-cleanup

## 개요

- **이슈**: [#15](https://github.com/Orchemi/my-resend/issues/15)
- **브랜치**: `feat/15`
- **상태**: 진행 중
- **생성일**: 2026-04-26
- **선행**: PR #8 / PR #14 — 두 PR 의 follow-up 노트에서 "사전 존재 tsc 에러 — typing 정리 트랙" 으로 기록됐던 잔여물

## 배경

`npm test` (Jest + ts-jest, transpile-only) 와 `npm run build` (Next.js, 자체 typecheck) 모두 통과하지만, `tsc --noEmit` 으로 strict typecheck 를 돌리면 5 개 테스트 파일에서 **23 개 에러** 가 발생한다.

원인은 다양하다:
- TypeScript 5+ 의 더 엄격한 타입 정의 (`process.env.NODE_ENV` readonly)
- jest 의 `MockedFunction` / `MockInstance` 타입 시그니처 변경
- 함수 시그니처가 단순화 되었지만 테스트 호출이 갱신 안 됨 (`getBestHostedTier()`)
- ses.ts `generateDNSRecords` 가 explicit return type 없이 inference 에 의존 → DnsProviderRecord 와 미묘한 차이
- v2 SDK input 타입을 `Record<string, unknown>` 으로 단순 cast 하는 것을 TS5 가 거부 ("convert via unknown first")
- 테스트 fixture 의 literal 타입이 실제 type 과 미스매치 (`count: '30'` vs `count: number`)

전부 mechanical fix 라 한 PR 안에서 정리.

## 목표

- [ ] 23 개 에러 모두 0 으로
- [ ] 테스트 suite 무회귀 (128 → 128 pass)
- [ ] lint clean, build OK
- [ ] 기존 동작 변경 없음 (순수 타입·테스트 cleanup)

## 설계

### 에러 분류 + 수정 전략

| 파일 | 에러 수 | 원인 | 수정 |
|------|---------|------|------|
| `domains-dns-integration.test.ts` | 5 | `generateDNSRecords` inferred return type 가 description 을 required 로 추론 | `ses.ts` 의 `generateDNSRecords` 에 `: DnsProviderRecord[]` annotation 추가 |
| `ses.test.ts` | 3 | TS5 가 v2 SDK Input → `Record<string, unknown>` 직접 cast 거부 | `as unknown as Record<string, unknown>` 으로 두-단계 변환 |
| `pricing-calculator.test.ts` | 8 | `getBestHostedTier()` 가 parameterless 인데 테스트가 1 인자 전달 | 8 개 호출에서 인자 제거 |
| `WaitlistSignup.test.tsx` | 1 | TS5 가 `process.env.NODE_ENV` 를 readonly 로 정의 | `Object.defineProperty` 로 mutable 할당, 또는 mutable cast |
| `database-waitlist.test.ts` | 6 | jest `MockedFunction` 타입 시그니처 변경 + fixture literal 타입 미스매치 | mock typing 재작성 + `count: '30'` → `count: 30` |

### 변경 범위

```
my-resend/
├── src/lib/
│   └── ses.ts                                          # generateDNSRecords return type annotation
├── src/lib/__tests__/
│   ├── ses.test.ts                                     # 3 cast 갱신 (unknown 경유)
│   ├── pricing-calculator.test.ts                      # 8 호출에서 인자 제거
│   └── database-waitlist.test.ts                       # mock typing + fixture literal
├── src/components/__tests__/
│   └── WaitlistSignup.test.tsx                         # NODE_ENV 할당 방식 변경
└── docs/plan/
    └── 007-tsc-error-cleanup.md                        # 본 문서
```

**무수정**:
- 본격 src 모듈 (digitalocean, route53, dns-provider, domains, database 본체) — 단 ses.ts 의 1 줄 annotation 추가만
- 테스트 행동 (assert 결과)
- 라이브러리 의존성

### 의사결정 기록

| 결정 사항 | 선택지 | 결정 | 이유 |
|-----------|--------|------|------|
| `generateDNSRecords` return | A) inference 유지 + 테스트 mock 에 description 채우기 / B) explicit `DnsProviderRecord[]` annotation | **B** | 단일 source 변경으로 5 개 mock site 동시 수정. annotation 은 의도 명시 효과도 있음 |
| `getBestHostedTier` 인자 처리 | A) 함수에 optional `_volume?: number` 추가 / B) 테스트에서 인자 제거 | **B** | 함수가 정말 parameterless 이고 분기 없음. unused param 추가는 dead 코드 |
| `NODE_ENV` 할당 | A) `Object.defineProperty` / B) mutable cast / C) `delete env then assign` | **A** | property descriptor 가 가장 명시적. `configurable: true` 로 다음 테스트가 다시 set 가능 |
| jest mock typing 재작성 깊이 | A) 최소 변경 (타입 cast) / B) 전체 패턴 재작성 | **A** | 본 PR 은 tsc 정리 트랙. 큰 패턴 재작성은 별도 후속 |
| `tsc --noEmit` CI 통합 | A) 본 PR 에서 / B) 별도 작은 후속 | **B** | 본 PR 의 단위 명확화. CI 통합은 통과 baseline 확보 후 별도 |

## 작업 단계

### Phase 1: ses.ts 1 줄 추가 (5 에러 동시 해결)

- [ ] `import type { DnsProviderRecord } from "./dns-provider";` (이미 없으면)
- [ ] `generateDNSRecords` 에 `: DnsProviderRecord[]` 명시
- [ ] tsc 재실행 → 5 에러 사라짐 확인

### Phase 2: ses.test.ts 3 cast (3 에러)

- [ ] 라인 72, 363, 495 의 `as Record<string, unknown>` → `as unknown as Record<string, unknown>`

### Phase 3: pricing-calculator.test.ts 8 호출 (8 에러)

- [ ] 라인 138-148 의 `getBestHostedTier(N)` → `getBestHostedTier()` (8 곳)

### Phase 4: WaitlistSignup.test.tsx (1 에러)

- [ ] `process.env.NODE_ENV = "development"` → `Object.defineProperty(process.env, "NODE_ENV", { value: "development", configurable: true, writable: true })`

### Phase 5: database-waitlist.test.ts (6 에러)

- [ ] mock 타입 정의 재작성 (mockPool / mockClient): jest 5+ 의 `MockedFunction` 시그니처 맞추기
- [ ] 라인 307, 308, 311, 312 의 `count: '30'` 등 → `count: 30` (number)

### Phase 6: 검증

- [ ] `npx tsc --noEmit` → **0 errors**
- [ ] `npm run lint` → 0 warnings
- [ ] `npm test` → 128 pass (회귀 없음)
- [ ] `npm run build` → success

### Phase 7: 커밋 + PR

- [ ] 2 commits 또는 5 commits (관심사별)
- [ ] `/pr auto`

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-04-26 | 이슈 #15, `feat/15` 브랜치, 본 plan 작성 | PR #14 직후 후속 |

## 참고

- 직전 plan 006: `docs/plan/006-consolidate-dns-record-type.md`
- TypeScript 5 NODE_ENV readonly: <https://github.com/microsoft/TypeScript/issues/53083>
