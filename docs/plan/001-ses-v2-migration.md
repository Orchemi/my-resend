# 001-ses-v2-migration

## 개요

- **이슈**: [#1](https://github.com/Orchemi/my-resend/issues/1)
- **브랜치**: `feat/1`
- **상태**: 진행 중
- **생성일**: 2026-04-26

이 문서는 my-resend 가 사용하는 AWS SES SDK 를 v1 (`@aws-sdk/client-ses`) 에서 v2 (`@aws-sdk/client-sesv2`) 로 전환하는 작업의 단일 진실(single source of truth) 이다. DNS provider 추상화 (DigitalOcean / Route53) 는 본 트랙 범위 밖이며, SES SDK 전환이 끝난 뒤 별도 plan 으로 다룬다.

## 배경

my-resend 는 [eibrahim/freeresend](https://github.com/eibrahim/freeresend) 의 hard fork 이다 (분기 시점: 2026-04-26, 분기 base SHA `3439985`). 부모는 SES SDK **v1** 을 사용한다. SDK v2 로 전환하는 동기는 다음과 같다.

- v2 의 `GetEmailIdentity` 는 verify 상태와 DKIM 속성을 한 번의 호출로 반환한다 — v1 에서 `GetIdentityVerificationAttributes` + `GetIdentityDkimAttributes` 두 호출로 나뉘었던 것이 통합된다.
- v2 의 `CreateEmailIdentity` 는 identity 생성과 DKIM 활성화를 한 번에 처리할 수 있다.
- v2 가 현재 AWS 권장 SDK 다. 신규 IAM policy 도 v2 액션 기준으로 작성하는 것이 자연스럽다.
- my-resend 는 이미 upstream 에서 분기된 자체 OSS 이므로 SDK 마이그레이션 비용을 흡수할 수 있다.

## 목표

- [ ] 의존성 교체: `@aws-sdk/client-ses@^3.682` 제거 → `@aws-sdk/client-sesv2` 추가
- [ ] `src/lib/ses.ts` 8개 함수를 v2 SDK 로 전면 리팩토링
- [ ] `src/lib/__tests__/ses.test.ts` 신규 작성 (`aws-sdk-client-mock` 사용, 라이브 AWS 호출 없음)
- [ ] consumer 회귀 검증: `src/lib/domains.ts`, `src/app/api/emails/route.ts`, `src/app/api/domains/[id]/retry-dns/route.ts`
- [ ] `npm run lint && npm test && npm run build` 모두 통과
- [ ] develop 으로 PR (1 커밋 rebase / 2+ 커밋 merge)

## 설계

### 접근 방식

1. **외부 인터페이스 보존이 우선**. `sendEmail`, `verifyDomain`, `getDomainVerificationStatus`, `enableDomainDkim`, `getDomainDkimTokens`, `deleteDomainIdentity`, `createConfigurationSet`, `generateDNSRecords` 의 시그니처와 반환 형태(특히 `verifyDomain` 의 `{ verificationToken, status: "Pending" }`)는 **변경하지 않는다**. v2 SDK 호출은 함수 내부에 캡슐화한다 — consumer (`domains.ts` 등) 변경 0건 이 목표.
2. **TDD**. 각 함수에 대해 `aws-sdk-client-mock` 으로 SESv2Client 의 send 를 가로채 입력·반환 매핑을 단위 테스트로 먼저 정의 → 함수 구현. 라이브 AWS 호출 없음.
3. **`verifyDomain` 시맨틱 조정**. v1 `VerifyDomainIdentity` 는 verificationToken 을 반환했지만, v2 `CreateEmailIdentity` 는 반환하지 않는다. 후속으로 `GetEmailIdentity` 를 호출해 token 을 추출해야 한다 → 함수 내부에서 두 호출을 묶어 동일한 외부 반환 형태를 유지한다.
4. **DKIM 활성화 단순화**. v1 은 `VerifyDomainDkimCommand` 로 별도 호출했지만, v2 의 `CreateEmailIdentityCommand` 는 `DkimSigningAttributes` 옵션으로 동시 활성화 가능. 다만 외부 인터페이스(`enableDomainDkim`) 는 유지하므로 함수는 `PutEmailIdentityDkimAttributesCommand` 로 매핑한다 (이미 존재하는 identity 가정).
5. **`sendEmail` / `sendRawEmail` 통합 가능성 평가는 본 PR 범위 밖**. v2 의 `SendEmailCommand` 는 `Content.Simple | Content.Raw | Content.Template` 으로 통합되었지만, 본 PR 은 1:1 매핑만 수행한다. 통합 리팩토링은 후속.

### 변경 범위

```
my-resend/
├── package.json                              # @aws-sdk/client-ses 제거 + @aws-sdk/client-sesv2 추가
├── package-lock.json                         # 자동 갱신
├── src/lib/
│   ├── ses.ts                                # 전면 리팩토링 (외부 시그니처 보존)
│   └── __tests__/
│       └── ses.test.ts                       # 신규 (aws-sdk-client-mock)
└── docs/plan/
    └── 001-ses-v2-migration.md               # 본 문서
```

**무변경**:
- `src/lib/domains.ts` (소비자 — 인터페이스 보존 검증)
- `src/app/api/emails/route.ts`
- `src/app/api/domains/[id]/retry-dns/route.ts`
- `src/lib/digitalocean.ts` (DNS 분리 작업과 직교)

### v1 → v2 매핑

| ses.ts 함수 | v1 command | v2 command | 키 변경 |
|-------------|-----------|-----------|---------|
| `sendEmail` | `SendEmailCommand` (`@aws-sdk/client-ses`) | `SendEmailCommand` (`@aws-sdk/client-sesv2`) | `Source` → `FromEmailAddress` · `Destination` 동일 · `Message.Subject/Body` → `Content.Simple.Subject/Body` · `Tags` → `EmailTags` · `ReplyToAddresses` 동일 |
| `sendRawEmail` | `SendRawEmailCommand` | `SendEmailCommand` with `Content.Raw` | `Source`+`Destinations` → `FromEmailAddress`+`Destination.ToAddresses` · `RawMessage.Data` → `Content.Raw.Data` (Uint8Array 동일) |
| `verifyDomain` | `VerifyDomainIdentityCommand` (returns token) | `CreateEmailIdentityCommand` + `GetEmailIdentityCommand` | identity 생성 후 별도 호출로 `VerificationStatus`/`DkimAttributes.Tokens` 조회. 외부 반환 `{ verificationToken, status: "Pending" }` 유지 |
| `getDomainVerificationStatus` | `GetIdentityVerificationAttributesCommand` | `GetEmailIdentityCommand` | 응답 `VerificationStatus` (v2: `VerifiedForSendingStatus` boolean + `VerificationStatus` enum) → `"Pending"\|"Success"\|...` 문자열로 매핑 |
| `enableDomainDkim` | `VerifyDomainDkimCommand` (returns tokens) | `PutEmailIdentityDkimAttributesCommand` + `GetEmailIdentityCommand` | DKIM signing 활성화 후 identity 조회로 토큰 추출 |
| `getDomainDkimTokens` | `GetIdentityDkimAttributesCommand` | `GetEmailIdentityCommand` | `DkimAttributes.Tokens` 추출 |
| `deleteDomainIdentity` | `DeleteIdentityCommand` | `DeleteEmailIdentityCommand` | 파라미터 `Identity` → `EmailIdentity` |
| `createConfigurationSet` | `CreateConfigurationSetCommand` (input `ConfigurationSet: {Name}`) | `CreateConfigurationSetCommand` (input `ConfigurationSetName` top level) | 에러 처리(이미 존재) 분기 동일 — `AlreadyExistsException` 등 매칭 유지 |
| `generateDNSRecords` | (SDK 무관, 순수 함수) | (변경 없음) | — |

### 의사결정 기록

| 결정 사항 | 선택지 | 결정 | 이유 |
|-----------|--------|------|------|
| 마이그레이션 단위 | A) 함수별 점진 / B) ses.ts 전체 한 번에 | **B** | 297라인 단일 모듈, 의존성도 단일 패키지 — 한 번에 swap 이 의미 단위. v1·v2 동시 의존은 안티패턴 |
| Route53 + dns-provider 추상화 포함 여부 | A) 본 PR 통합 / B) 분리 | **B** | PR 크기·리뷰 단위 분리. SES v2 는 자체 검증 가능, Route53 은 IAM/Hosted Zone 등 추가 컨텍스트 필요 |
| 외부 시그니처 변경 | A) 보존 / B) v2 신 API 노출 | **A** | consumer 변경 0건 목표. v2 의 통합 응답을 활용한 API 단순화는 후속 리팩토링 |
| Mocking 라이브러리 | A) `aws-sdk-client-mock` / B) jest manual mock / C) 통합 테스트 | **A** | AWS v3 SDK 표준 mocking 라이브러리. 통합 테스트는 별도 단계 |
| DKIM 활성화 시점 | A) `verifyDomain` 안에서 자동 활성화 / B) 별도 호출 유지 | **B** | upstream 설계 보존 — `enableDomainDkim` 가 별도 노출되어 있고 consumer 가 분기 호출 |
| `sendEmail`/`sendRawEmail` 통합 | A) 본 PR 에서 통합 / B) 분리 유지 | **B** | v2 가 통합 가능하지만 본 PR 은 1:1 매핑만. 통합은 후속 리팩토링 (테스트 안전망 확보 후) |

## 작업 단계

### Phase 1: 의존성 교체 + 테스트 인프라

- [ ] `npm uninstall @aws-sdk/client-ses && npm install @aws-sdk/client-sesv2` (peer/transitive 충돌 확인)
- [ ] `npm install --save-dev aws-sdk-client-mock` (필요 시 `aws-sdk-client-mock-jest` 도)
- [ ] `__tests__/ses.test.ts` 스텁 작성 (mock 셋업 + describe 골격)

### Phase 2: TDD — 단순 매핑 함수부터

- [ ] `deleteDomainIdentity`: 가장 단순 (1:1 매핑) — 테스트 + 구현
- [ ] `createConfigurationSet`: 입력 키만 변경 + 기존 에러 분기 보존 검증 — 테스트 + 구현
- [ ] `getDomainDkimTokens`: `GetEmailIdentity` 응답 매핑 — 테스트 + 구현
- [ ] `getDomainVerificationStatus`: `GetEmailIdentity` 응답의 verification status enum 매핑 — 테스트 + 구현

### Phase 3: TDD — 복합 매핑 함수

- [ ] `verifyDomain`: `CreateEmailIdentity` + `GetEmailIdentity` 두 호출, 외부 반환 보존 — 테스트 + 구현
- [ ] `enableDomainDkim`: `PutEmailIdentityDkimAttributes` + `GetEmailIdentity`, 토큰 배열 반환 — 테스트 + 구현

### Phase 4: TDD — 메일 발송

- [ ] `sendEmail`: simple content 매핑 + tags 매핑 + replyTo 보존 — 테스트 + 구현
- [ ] `sendRawEmail`: raw content 매핑 + Uint8Array 보존 — 테스트 + 구현 (raw 빌더 자체는 무변경)

### Phase 5: 회귀 검증

- [ ] `domains.ts` 가 ses.ts import 한 함수들 호출하는 모든 위치 grep + TypeScript 컴파일 통과 확인
- [ ] `src/app/api/emails/route.ts` 컴파일 + 응답 shape 변경 없음 확인
- [ ] `src/app/api/domains/[id]/retry-dns/route.ts` 컴파일 확인
- [ ] `npm run lint` 통과
- [ ] `npm test` 전체 통과 (기존 waitlist/notifications/pricing-calculator 테스트 영향 없음)
- [ ] `npm run build` (Next.js 빌드) 통과

### Phase 6: 커밋 + PR

- [ ] 영어 conventional 커밋 (이슈 번호 suffix 없음)
  - 예시 분할:
    - `feat(ses): migrate SES SDK from v1 to v2`
    - `test(ses): add unit tests for v2 client commands`
  - 또는 단일 커밋 `feat(ses): migrate SDK to v2 with unit tests` (1커밋 → rebase)
- [ ] `gh pr create --base develop` (PR 본문에 본 plan + 이슈 #1 링크)
- [ ] PR 머지 후 본 문서 상태 → "완료", 진행 로그에 PR 번호 기록

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-04-26 | 이슈 #1 생성, `feat/1` 브랜치 생성, 본 plan 문서 작성 | |

## 참고

- AWS SESv2 API: <https://docs.aws.amazon.com/sesv2/latest/APIReference/Welcome.html>
- AWS SESv2 SDK (JavaScript): <https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sesv2/>
- aws-sdk-client-mock: <https://github.com/m-radzikowski/aws-sdk-client-mock>
- 분기 base 커밋: `3439985c3d9f5dc187acc75d8a063d31c3d5fe9f` (tag `v0.1.0-my-resend`)
- 원본 upstream: <https://github.com/eibrahim/freeresend>
