# 004-ses-lazy-env-capture

## 개요

- **이슈**: [#9](https://github.com/Orchemi/my-resend/issues/9)
- **브랜치**: `feat/9`
- **상태**: 진행 중
- **생성일**: 2026-04-26
- **선행**: [PR #8](https://github.com/Orchemi/my-resend/pull/8) — `digitalocean.ts` 에 동일 패턴 적용 완료

본 작업은 직전 PR #8 의 `digitalocean.ts` lazy env capture 와 정확히 동일한 패턴을 `src/lib/ses.ts` 에 적용한다.

## 배경

`src/lib/ses.ts` 가 module-load 시점에 `SESv2Client` 인스턴스를 만들면서 `process.env.AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 를 캡처한다:

```typescript
const sesClient = new SESv2Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});
```

PR #8 이후 `digitalocean.ts` 는 `getApiToken()` / `getDoClient()` 호출-시점 패턴이고, ses.ts 만 module-load 캡처가 남아있다. 두 모듈의 동작 비대칭은 향후 새 모듈을 추가할 때 어느 쪽 패턴을 따라야 하는지 모호하게 만든다.

## 목표

- [ ] `src/lib/ses.ts` 의 module-level `sesClient` 제거 → `getSesClient()` 함수 도입
- [ ] 11 개 call site (`sesClient.send(...)` → `getSesClient().send(...)`) 갱신
- [ ] 기존 32 ses 단위 테스트 + 통합 테스트 무회귀 확인 (`mockClient(SESv2Client)` 가 prototype 레벨 패치라 매 호출마다 새 instance 도 mock 처리됨)
- [ ] `npm run lint && npm test && npm run build` 모두 통과

## 설계

### 접근 방식

`digitalocean.ts` 와 정확히 동일한 패턴:

```typescript
function getSesClient(): SESv2Client {
  return new SESv2Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}
```

매 호출마다 새 `SESv2Client` 인스턴스를 만든다. SDK client 생성 비용은 config wrapper + middleware stack 구성뿐이라 무시 가능 — 실제 SDK 호출 (HTTP request) 비용에 비하면 사실상 0.

### 변경 범위

```
my-resend/
└── src/lib/
    └── ses.ts                    # module-level sesClient → getSesClient() 함수
```

**무수정**:
- `src/lib/__tests__/ses.test.ts` — `mockClient(SESv2Client)` 패턴이 prototype 패치라 인스턴스 변경에 robust
- 다른 lib 모듈, API 라우트 — `ses.ts` 의 export 시그니처 무변경

### 의사결정 기록

| 결정 사항 | 선택지 | 결정 | 이유 |
|-----------|--------|------|------|
| Memoization 여부 | A) 매 호출 새 instance / B) module-let 변수에 첫 호출 시점 cache | **A** | digitalocean.ts 와 동일 패턴 유지. credential rotation 안전성 + 성능 차이 무시 가능 |
| getter 이름 | A) `getSesClient()` / B) `createSesClient()` | **A** | digitalocean 의 `getDoClient()` 와 명명 일관 (`get` 접두사) |
| 적용 범위 | A) ses.ts 만 / B) ses.ts + dns-provider.ts 도 함께 | **A** | dns-provider.ts 는 import 만 할 뿐 SDK client 를 직접 만들지 않음. 본 PR scope 명확화 |

## 작업 단계

### Phase 1: refactor

- [ ] `src/lib/ses.ts` 상단 `const sesClient = new SESv2Client(...)` 제거
- [ ] `function getSesClient(): SESv2Client { ... }` 추가
- [ ] 11 개 `sesClient.send(...)` → `getSesClient().send(...)`

### Phase 2: 검증

- [ ] `npm run lint` 통과
- [ ] `npm test --testPathPatterns='src/lib'` 통과 (105 → 105)
- [ ] `npm run build` 통과

### Phase 3: 커밋 + PR

- [ ] 영어 conventional 커밋 (1 commit, 단일 concern)
- [ ] `gh pr create` → develop 머지

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-04-26 | 이슈 #9, `feat/9` 브랜치, 본 plan 작성 | PR #8 직후 대칭 정합 작업 |

## 참고

- 직전 plan 003: `docs/plan/003-followups-doc-and-refactor.md` (의사결정 §"ses.ts 는 별도 PR" 정합)
- 동일 패턴 적용 PR: <https://github.com/Orchemi/my-resend/pull/8>
- AWS SES v2 SDK: <https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sesv2/>
