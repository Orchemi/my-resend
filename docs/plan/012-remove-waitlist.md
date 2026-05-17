# 012-remove-waitlist

## 개요

- **이슈**: [#38](https://github.com/Orchemi/my-resend/issues/38)
- **브랜치**: `refactor/38`
- **상태**: 진행 중
- **생성일**: 2026-05-17

upstream `eibrahim/freeresend` 의 hosted-SaaS waitlist 기능을 통째로 들어낸다. 본 fork 는 OSS 자가-호스팅만 운영할 계획이라 hosted 서비스 마케팅 깔때기가 무의미하고, 랜딩 페이지 톤이 self-hoster 가이드와 맞지 않는다.

추후 hosted 운영이 결정되면 본 문서가 *그때까지 무엇이 있었는지* 의 단일 진실 (single source of truth) 역할을 한다. 복원은 § 4 절차 참조.

## 배경

### 출처

- 도입: upstream commit [`f5a0378` Waitlist (#1)](https://github.com/Orchemi/my-resend/commit/f5a0378), Emad Ibrahim, 2025-08-24 — 본 fork 의 fork-base SHA `3439985` (2026-04-26) 보다 한참 전 시점이라 fork 직후부터 inherited as-is.
- 이후 후속: `c8323df fixed build and linting issues` (upstream-era, 본 fork 의 분기 후 post-fork 커밋 아님).
- 본 fork 의 `010-3` Tier 3 sweep 에서 한 차례 검토했으나 *제거 vs 보존* 결정이 미정으로 남아 있었다 (profile.notes 참조).

### 무엇이었나

upstream 은 *self-hosted 코드* 와 *hosted 서비스 사전 신청 깔때기* 를 한 레포에 같이 둔 구조였다. waitlist 의 목적:

- 랜딩 페이지에서 잠재 hosted 고객 이메일 + UTM 수집
- 관리자에게 알림 메일 발송
- 가입 사용자에게 welcome 메일 발송
- 어드민 dashboard 에서 가입 통계 / 전체 export 제공

본 fork 는 OSS 만 publish 하므로 이 깔때기를 운영할 인프라(SES production 발신 + hosted 도메인 + admin 어드민 페이지)도 없고 운영 의지도 없다.

## 영향 인벤토리 (제거 직전 상태)

복원이 필요할 때 *어떤 자산이 어디에 있었는지* 의 정확한 기록.

### 컴포넌트

| 파일 | 라인 | 역할 |
|------|------|------|
| `src/components/WaitlistSignup.tsx` | 478 | 이메일 + estimated volume + provider + UTM 폼. POST `/api/waitlist`. |
| `src/components/__tests__/WaitlistSignup.test.tsx` | (CI ignore) | 폼 검증 + 제출 흐름. PR #21 의 pending-leak 회피로 CI 에서 제외 중. |

### API 라우트

| 파일 | 메서드 | 역할 |
|------|--------|------|
| `src/app/api/waitlist/route.ts` | POST | 새 가입 등록. zod 검증 + `createWaitlistSignup` + `sendWaitlistNotification` (admin) + `sendWelcomeEmail` (가입자). |
| `src/app/api/waitlist/route.ts` | GET | admin: 페이지네이션 + 분석 + 전체 목록. JWT 가드. |
| `src/app/api/waitlist/export/route.ts` | GET | admin: CSV/JSON export. JWT 가드. |
| `src/app/api/waitlist/__tests__/route.test.ts` | — | 검증 스키마 + 라우트 로직 테스트. |

### DB

| 위치 | 항목 |
|------|------|
| `database.sql` L77-130 | `waitlist_signups` CREATE TABLE (12 columns) + 3 indexes (`email`, `created_at`, `utm_source`) + 1 trigger (`update_waitlist_signups_updated_at`) |
| `src/lib/database.ts` | `WaitlistSignup` interface, `CreateWaitlistSignupData` interface, `WaitlistAnalytics` interface, 7 helpers: `createWaitlistSignup`, `getWaitlistSignupByEmail`, `getAllWaitlistSignups`, `getWaitlistAnalytics`, `getWaitlistSignupsCount`, `exportWaitlistSignups`, (+ `parseCountRows` inline) |
| `src/lib/__tests__/database-waitlist.test.ts` | 7 helpers 전부에 대한 unit 테스트 |

### Notifications / 알림

| 파일 | 라인 | 역할 |
|------|------|------|
| `src/lib/notifications.ts` | ~270 | **100% waitlist 전용**. 2개 export: `sendWaitlistNotification` (admin 알림), `sendWelcomeEmail` (가입자 환영). HTML + plain 템플릿. SES `sendEmail` 호출. |
| `src/lib/__tests__/notifications.test.ts` | — | mock SES 로 두 메일 흐름 검증. |

(유일 consumer 는 `/api/waitlist/route.ts` — 파일이 같이 삭제됨)

### Stats / Metrics

| 위치 | 항목 |
|------|------|
| `src/config/stats.ts` | `waitlist_total` 메트릭 정의 + 정의 row 1줄 + `SELECT COUNT(*) FROM waitlist_signups` query 1줄 |
| `src/lib/stats-reporter.ts` | (waitlist 전용 로직 없음 — config.ts 의 metric 목록을 일반 처리) |

### 랜딩 페이지 카피

| 파일 | 라인 | 영역 |
|------|------|------|
| `src/components/LandingPage.tsx` | L64, L100 | 히어로 영역 "Join Waitlist" CTA × 2 |
| `src/components/LandingPage.tsx` | L132-294 | "Hosted Version Coming Soon" 박스 (50-85% Savings / Fully Managed / API Compatible 카드 3개 + "Calculate your savings" 링크) — 본 sweep 에서 박스 단위 제거 후 "Get Started" CTA 로 교체 |
| `src/components/LandingPage.tsx` | L240-294 | feature 카드의 "Hosted Version:" 부가 설명 (3 카드 모두에 산재) |
| `src/components/LandingPage.tsx` | L452 | "Ready to Take Control..." CTA 의 "Join Waitlist Today" → "Get Started" |
| `src/components/__tests__/LandingPage.test.tsx` | — | waitlist CTA 검증 assertions 다수 |

### PricingCalculator coupling

| 파일 | 라인 | 항목 |
|------|------|------|
| `src/components/PricingCalculator.tsx` | L19 | `import WaitlistSignup from './WaitlistSignup'` |
| `src/components/PricingCalculator.tsx` | L25, L54 | `showWaitlist` prop (default true) |
| `src/components/PricingCalculator.tsx` | L64 | `const [waitlistSuccess, setWaitlistSuccess] = useState(false)` |
| `src/components/PricingCalculator.tsx` | L482-525 | "On Waitlist ✓" 카드 + WaitlistSignup 렌더 (가격 카드 사이의 호스팅 옵션 영역 전체) |
| `src/components/__tests__/PricingCalculator.test.tsx` | — | showWaitlist assertions |

### CI

| 파일 | 라인 | 항목 |
|------|------|------|
| `.github/workflows/ci.yml` | L36-43 | Test step 의 `--testPathIgnorePatterns='WaitlistSignup'` (PR #21 임시 회피) — WaitlistSignup 테스트가 사라지면 자연스럽게 제거 |

## 보존

다음은 *변경하지 않는다* — fork attribution 또는 OSS 사용자에게 여전히 유효한 자산:

- `NOTICE`, `LICENSE` L3, `README.md` / `README.ko.md` L7, `CLAUDE.md` L9 — 의도된 hard-fork attribution
- `docs/plan/001-009` — 시점 기록, 사후 편집 안 함
- `docs/plan/010-*` 시리즈 — 시점 기록
- `/pricing` 라우트 + `PricingCalculator` (waitlist 결합만 제거, 비교 계산기 자체는 OSS 사용자에게 "Resend 대비 Amazon SES 절감액" 추정 도구로 여전히 유효)
- 랜딩 페이지의 hero / feature / 비교표 / FAQ — waitlist 가 아닌 self-hosted 메시지

## 작업 단계

### Phase 1 — 파일 통째 삭제

- [ ] `git rm src/components/WaitlistSignup.tsx`
- [ ] `git rm src/components/__tests__/WaitlistSignup.test.tsx`
- [ ] `git rm -r src/app/api/waitlist`
- [ ] `git rm src/lib/__tests__/database-waitlist.test.ts`
- [ ] `git rm src/lib/notifications.ts`
- [ ] `git rm src/lib/__tests__/notifications.test.ts`

### Phase 2 — decouple 편집

- [ ] `src/components/PricingCalculator.tsx`: WaitlistSignup import / `showWaitlist` prop / `waitlistSuccess` state / "On Waitlist ✓" 카드 영역 제거
- [ ] `src/components/LandingPage.tsx`: "Join Waitlist" CTA → "Get Started" (SETUP.md 또는 GitHub), "Hosted Version Coming Soon" 박스 통째 제거, feature 카드의 "Hosted Version:" 부가 영역 제거
- [ ] `src/components/__tests__/LandingPage.test.tsx`: waitlist assertions 제거
- [ ] `src/components/__tests__/PricingCalculator.test.tsx`: showWaitlist assertions 제거
- [ ] `src/lib/database.ts`: `WaitlistSignup` interface + 7 helpers + 2 보조 interface 제거
- [ ] `src/config/stats.ts`: `waitlist_total` 정의 + COUNT query 제거
- [ ] `database.sql`: `waitlist_signups` 테이블/인덱스/트리거 제거 (`-- migration: drop waitlist_signups` 주석 코멘트로 기존 DB 운영자 안내)
- [ ] `.github/workflows/ci.yml`: `--testPathIgnorePatterns='WaitlistSignup'` 제거

### Phase 3 — 검증

- [ ] `git grep -nE "Waitlist\|waitlist"` = 0 hits (단, 본 plan 문서 자체 제외)
- [ ] `npm run lint && npm run typecheck && npm test && npm run build` 4단 통과
- [ ] dev 서버 띄워서 `/` 랜딩 페이지 시각 확인 (waitlist 박스 없는지)

### Phase 4 — Merge

- [ ] commit 분할: plan → 파일 삭제 → decouple 편집 → CI ignore 제거 (4 commits 내외)
- [ ] PR → develop, merge commit

## 복원 절차 (미래에 hosted 운영 결정 시)

세 가지 선택지. 상황에 따라 골라 쓴다.

### Option A — 이 PR 의 merge 를 revert

가장 단순. 본 sweep PR 이 merge 된 직후라면 한 줄로 모두 되돌릴 수 있다.

```bash
gh pr merge --repo Orchemi/my-resend <REVERT_PR>  # 또는
git revert -m 1 <merge-commit-sha>
```

장점: 완전 동일한 형태로 복원. 단점: 본 PR 머지 후 시간이 지나 다른 코드 변경이 누적되면 conflict.

### Option B — 파일 단위로 git history 에서 복원

원본 위치에서 특정 파일만 살린다. 다른 작업과 conflict 적음.

```bash
# 본 sweep PR 의 merge SHA 의 parent 가 마지막 "waitlist 가 있던 상태"
git checkout <merge-commit>^1 -- \
  src/components/WaitlistSignup.tsx \
  src/components/__tests__/WaitlistSignup.test.tsx \
  src/app/api/waitlist/ \
  src/lib/__tests__/database-waitlist.test.ts \
  src/lib/notifications.ts \
  src/lib/__tests__/notifications.test.ts
```

이후 § 영향 인벤토리 의 "decouple 편집" 항목들을 수동으로 재결합 (database.ts / stats.ts / database.sql / LandingPage / PricingCalculator).

### Option C — upstream `f5a0378` cherry-pick

원본 commit 그대로 가져온다. 가장 정통.

```bash
git remote add upstream https://github.com/eibrahim/freeresend.git  # 이미 등록돼 있으면 생략
git fetch upstream
git cherry-pick f5a0378
```

장점: upstream 의도 그대로. 단점: 이후 본 fork 가 SES v2 / DNS provider / brand / `mrs_` prefix 등으로 분기했으므로 cherry-pick 후 다수 conflict 예상. 수동 정합화 필요.

### 어느 옵션이든 추가로 해야 할 것

- DB 마이그레이션: 운영 DB 에 `waitlist_signups` 테이블 재생성. 본 sweep 의 database.sql 변경이 backward-compatible 했다면 (CREATE TABLE IF NOT EXISTS) 단순 재실행으로 가능.
- 어드민 페이지 (`/admin/waitlist`): notifications.ts 의 본문이 이 경로를 가리키지만 본 fork 에 아직 어드민 UI 가 없다 (관찰: `src/app/admin/` 디렉토리 부재). hosted 운영하려면 admin UI 도 새로 만들어야 함.
- SES production access: hosted waitlist 가입자에게 welcome 메일을 발송하려면 SES sandbox 해제 필요.

## 의사결정 기록

| 결정 | 선택지 | 결정 | 이유 |
|------|--------|------|------|
| 제거 범위 | waitlist UI 만 / waitlist + pricing / waitlist + pricing + 비교표 전체 | **waitlist 만** | 사용자 지시 *waiting 관련 코드 모두 제거*. pricing/비교표는 self-hosted 비용 추정에 여전히 유효 |
| LandingPage CTA 교체 | "Get Started" / "View on GitHub" / 통째 제거 | **"Get Started" + `/login`** | 신규 사용자가 SETUP.md 를 거쳐 도달한 뒤 첫 클릭은 로그인. CTA 자리를 비워 두면 시각적 결함 |
| "Hosted Version Coming Soon" 박스 | 박스 안 내용만 정리 / 박스 통째 제거 | **박스 통째 제거** | 박스 전체가 hosted 마케팅 깔때기. 일부만 남기면 의도가 모호해짐 |
| `database.sql` 의 waitlist 테이블 | 그대로 둠 (legacy) / DROP 마이그레이션 추가 / `-- removed` 주석만 | **CREATE 구문 제거 + 주석 1줄** | 신규 설치는 더 이상 테이블이 생기지 않음. 기존 운영자(없을 가능성 높음) 는 수동 `DROP TABLE` 또는 그대로 둬도 무해 |
| 복원 옵션의 정답 | A revert / B file-level checkout / C upstream cherry-pick | **세 가지 모두 문서화** | 미래 시점의 상황에 따라 다름. 본 plan 이 의사결정 도구가 됨 |
| 커밋 분할 | 단일 거대 커밋 / plan + delete + decouple 3 분할 / 4+ 분할 | **plan + delete + decouple + ci 4 commit** | 리뷰 가능성. 각 단위가 독립적인 논리 단위 |

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-05-17 | 이슈 #38 + refactor/38 생성, plan 작성 | |

## 참고

- 도입 출처: upstream [`f5a0378`](https://github.com/Orchemi/my-resend/commit/f5a0378) `Waitlist (#1)` (Emad Ibrahim, 2025-08-24)
- profile.notes "Marketing 영역 (pricing/landing/waitlist) 운영 미정" 항목의 미결 결정을 본 plan 이 종결
- PR #21 `fix(ci): exclude WaitlistSignup from test step pending leak fix` — 본 sweep 으로 임시 회피가 영구 해소됨
