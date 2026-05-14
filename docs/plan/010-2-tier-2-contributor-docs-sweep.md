# 010-2-tier-2-contributor-docs-sweep

## 개요

- **이슈**: [#25](https://github.com/Orchemi/my-resend/issues/25)
- **브랜치**: `feat/25` (stacked on `feat/24` — Tier 1 sweep)
- **상태**: 진행 중
- **생성일**: 2026-05-14
- **선행**: plan 010 § Tier 2 분류 (PR #24, feat/24, 머지 대기). 본 plan 은 010 의 후속 마일스톤이며 010 의 카탈로그 행을 라인 단위 enum 으로 확장한다.

## 배경

plan 010 의 카탈로그는 Tier 2 후보 파일 묶음을 "010-2 후속 PR" 로 분류했다. 본 plan 은 그 묶음을 라인 단위로 인덱싱하고 6 분할 커밋 명세를 정한다.

추가로 PR #24 의 project-qa 가 발견한 README RFC 2606 fixture 위반 (`yourdomain.com` 약 20 곳) 도 컨벤션 정합 차원에서 동일 sweep 에 묶는다 — plan 010 의 의도된 분류 ("RFC 2606 reserved domain 만 fixture 로 사용") 와 동일 카테고리이며, README sweep 을 별도 PR 로 가져가면 두 PR 의 사후 리뷰 부담이 분산되어 비효율.

## 목표

- [ ] plan 010-2 본 문서 신설 — Tier 2 카탈로그 + 커밋 분할
- [ ] `CONTRIBUTING.md` 재작성 — fork 후 정렬되지 않은 contributor 가이드
- [ ] `PROJECT_SUMMARY.md` 갱신 — CLAUDE.md / README.md 와의 정보 중복 해결
- [ ] `.kiro/steering/product.md` 갱신 — IDE steering rule 의 self-hosted 표기
- [ ] `.kiro/steering/tech.md` 갱신 — API key prefix 표기
- [ ] `TODO.md` 폐지 — my-resend 트랙은 GitHub Issues 운영
- [ ] `README.md` / `README.ko.md` 의 `yourdomain.com` → `example.com` (RFC 2606 fixture 정합, L7 attribution 보존)
- [ ] CI 4단 통과 + 머지 기준 grep 통과

## 설계

### 접근 방식

1. **plan 010-1 (PR #24) 위에 stacked branch**. Tier 2 의 변경 대상 파일들 (`CONTRIBUTING.md`, `PROJECT_SUMMARY.md`, `.kiro/steering/*`, `TODO.md`, `README.md`, `README.ko.md`) 은 Tier 1 의 변경 대상 (`SETUP.md`, `DEPLOYMENT.md`, `docker-compose.yml`, `.env.local.example`, `.gitignore`) 과 disjoint 이므로 stacked 가 자연. 머지 시점도 stacked 그대로 순차 머지 가능.
2. **README sweep 을 동일 PR 에 포함**. project-qa 가 발견한 RFC 2606 위반은 plan 010 § Tier 2 카탈로그 표에 명시적으로 들어있지 않았다 (plan 010 카탈로그가 stale word 기준으로 작성된 반면 RFC 2606 는 domain fixture convention 기준). 본 plan 에서 명시적으로 흡수.
3. **TODO.md 는 폐지 우선**. 단 1 줄 (`- [ ] `) 만 잔존, 트래커는 GitHub Issues. 향후 needed 시 다시 추가하면 됨.
4. **PROJECT_SUMMARY.md 는 갱신 선택**. CLAUDE.md (LLM 용) + README.md (사용자 용) 가 같은 내용을 다른 audience 로 다루는 반면 PROJECT_SUMMARY.md 는 OSS audience 용 한 페이지 요약 — 폐지하면 외부 contributor 의 entry point 가 줄어들어 갱신이 안전.

### Stale 카탈로그 (라인 단위)

| 파일 | 라인 | 발견 텍스트 | 분류 | 처리 |
|------|------|--------------|------|------|
| `CONTRIBUTING.md` | L1 | `# Contributing to FreeResend` | stale | "MyResend" |
| `CONTRIBUTING.md` | L3 | `contributing to FreeResend!` | stale | "MyResend" |
| `CONTRIBUTING.md` | L10 | `git clone https://github.com/eibrahim/freeresend.git` | stale | `Orchemi/my-resend.git` |
| `CONTRIBUTING.md` | L11 | `cd freeresend` | stale | `cd my-resend` |
| `CONTRIBUTING.md` | L45 | `- FreeResend version:` | stale | "MyResend" |
| `CONTRIBUTING.md` | L96 | `│   ├── supabase.ts    # Database operations` | stale | `database.ts` (실제 파일명) |
| `CONTRIBUTING.md` | L224 | `[Supabase Documentation](https://supabase.com/docs)` | stale | 라인 제거 또는 [PostgreSQL Documentation] 으로 교체 |
| `CONTRIBUTING.md` | L234 | `Professional Support ... EliteCoders` | stale | 라인 제거 (NOTICE 가 attribution 의 권위 있는 출처) |
| `CONTRIBUTING.md` | L244 | `Thank you for helping make FreeResend better!` | stale | "MyResend" |
| `CONTRIBUTING.md` | L248 | footer attribution: `FreeResend ... Emad Ibrahim ... EliteCoders` | stale | NOTICE 1 줄로 축약 |
| `PROJECT_SUMMARY.md` | L1 | `# FreeResend - Project Summary` | stale | "MyResend" |
| `PROJECT_SUMMARY.md` | L5 | `FreeResend is a complete, self-hosted email service ...` | stale | "MyResend" + my-resend 스택 표기 (SES v2, raw pg) |
| `PROJECT_SUMMARY.md` | L53 | `├── supabase.ts         # Database client & types` | stale | `database.ts` |
| `PROJECT_SUMMARY.md` | L170 | `FreeResend implements the same API contract as Resend:` | stale | "MyResend" |
| `PROJECT_SUMMARY.md` | L175 | `baseURL: "https://your-freeresend.com/api"` | stale | `https://your-my-resend.example.com/api` 또는 generic placeholder |
| `.kiro/steering/product.md` | L3 | `FreeResend is a self-hosted, open-source alternative to Resend ...` | stale | "MyResend", my-resend 컨벤션 표기 |
| `.kiro/steering/tech.md` | L24 | `Bearer token format: frs_keyId_secretPart` | stale | `mrs_keyId_secretPart` |
| `TODO.md` | L2 | `- [ ] ` (빈 체크박스) | 폐지 | 파일 자체 `git rm` |
| `README.md` | L7 | `[eibrahim/freeresend](https://github.com/eibrahim/freeresend) ... See [NOTICE]` | **의도 attribution** | **보존** — 변경 금지 |
| `README.ko.md` | L7 | (한국어 버전 동일) | **의도 attribution** | **보존** — 변경 금지 |
| `README.md`, `README.ko.md` | 각 10 라인 | `yourdomain.com` (DNS 예시, ADMIN_EMAIL placeholder 등) | RFC 2606 위반 | `example.com` 일괄 치환 |

### 010-2 작업 절차 (6 분할 커밋, 단일 PR — push 보류 중)

| # | 커밋 메시지 | 변경 파일 | 핵심 변경점 | 검증 |
|---|--------------|-----------|--------------|------|
| 1 | `docs(plan): add 010-2 tier 2 contributor docs sweep plan` | `docs/plan/010-2-tier-2-contributor-docs-sweep.md` (신규) | 본 plan 파일 | 파일 존재, plan 010 헤더 패턴 일치 |
| 2 | `docs(contributing): rewrite CONTRIBUTING.md for my-resend stack` | `CONTRIBUTING.md` | 10 hits 전부 제거. `supabase.ts` → `database.ts`. EliteCoders/Emad Ibrahim 푸터 → NOTICE 가리킴 1 줄. Supabase Documentation 외부 링크 제거 (PostgreSQL Docs 로 교체). | `git grep -nE "FreeResend\|freeresend\|frs_\|supabase\|eibrahim\|EliteCoders\|Emad Ibrahim" -- CONTRIBUTING.md` = 0 |
| 3 | `docs(project-summary): align with my-resend stack` | `PROJECT_SUMMARY.md` | 5 hits 전부 제거. SES v1 → SES v2 SDK, supabase.ts → database.ts, your-freeresend.com → generic example. | 동일 grep = 0 |
| 4 | `docs(steering): update kiro steering rules for my-resend` | `.kiro/steering/product.md`, `.kiro/steering/tech.md` | `product.md` L3 self-hosted 표기 갱신, `tech.md` L24 `frs_` → `mrs_`. 양 파일 fork 후 stale 가 더 있는지 동시 점검. | 동일 grep = 0 |
| 5 | `chore(repo): remove empty TODO.md` | `TODO.md` (삭제) | `git rm TODO.md` | 파일 부재 확인 |
| 6 | `docs(readme): use RFC 2606 fixture domain in DNS examples` | `README.md`, `README.ko.md` | `yourdomain.com` → `example.com` 일괄. L7 attribution 보존. | `git grep -nF "yourdomain.com" -- README.md README.ko.md` = 0. `git grep -nE "eibrahim/freeresend" -- README.md README.ko.md` = 2 (의도된 L7 fork attribution × 2 파일) |

### 보존 attribution 명시

본 PR 의 변경 후에도 다음은 **변경되지 않는다**:

- `README.md` L7 + `README.ko.md` L7 — fork 한 줄 attribution
- `NOTICE` 전체 — fork 출처, 분기 시점, 변환 기록의 권위 있는 출처
- `LICENSE` L3 — `Copyright (c) 2025 EliteCoders (original work, eibrahim/freeresend)`
- `CLAUDE.md` L9 — LLM 어시스턴트 컨텍스트의 fork 한 줄
- `docs/plan/*` 의 역사 기록 (plan 001, 003, 009 등)

머지 기준 grep 이 EliteCoders 매치를 봐서 LICENSE 가 hit 되더라도, 머지 기준의 grep 대상은 Tier 2 파일 한정이므로 LICENSE 는 대상 외.

## 비스코프

- **Tier 3** (plan 010-3 별도 PR): `k8s/**`, `.github/workflows/deploy.yml`, `.github/ISSUE_TEMPLATE/*.yml`, `test-curl.sh`, `test-email.js`, `test-smtp.js`, `database.sql` 코멘트/seed
- **Tier 4** (별도 이슈, 운영방향 결정 선행): `.kiro/specs/hosted-version-waitlist/*`
- **WaitlistSignup pending leak 영구 fix** (#20): 본 PR 범위 아님
- **CLAUDE.md § Environment Configuration ↔ .env.local.example 자동 drift 검출**: 후속 트랙 후보

## 머지 기준

- [ ] CI gate 4단 통과 (lint / typecheck / test / build) — 본 PR 도 코드 변경 없음, lint/typecheck/test 는 noop pass, build 만 실질
- [ ] Tier 2 정렬 대상 파일의 stale grep 0:

  ```bash
  git -C $REPO grep -nE \
    "FreeResend|freeresend|frs_|supabase|eibrahim|EliteCoders|Emad Ibrahim" \
    -- CONTRIBUTING.md PROJECT_SUMMARY.md '.kiro/steering/*'
  ```
- [ ] README 의 stale grep 은 의도된 L7 attribution 만 잔존:

  ```bash
  git -C $REPO grep -nE \
    "FreeResend|freeresend|frs_|supabase|EliteCoders" \
    -- README.md README.ko.md
  ```

  기대: 정확히 2 hit (`README.md:7`, `README.ko.md:7`), 그 외 0.
- [ ] README 의 RFC 2606 위반 0:

  ```bash
  git -C $REPO grep -nF "yourdomain.com" -- README.md README.ko.md
  ```

  기대: 0.
- [ ] `TODO.md` 부재 확인.

## 위험·롤백

| 위험 | 완화 |
|------|------|
| README L7 의 attribution 한 줄을 stale 로 잘못 분류 → 의도된 NOTICE 가리킴이 깨짐 | 보존 attribution 라인 enum 을 본 plan 의 § 보존 attribution 명시 단락에 명문화. 커밋 6 (README) 의 검증 grep 은 `eibrahim/freeresend` 정확히 2 hit (L7 × 2 파일) 만 잔존을 강제 |
| `TODO.md` 폐지 후 나중에 발견하지 못한 의존 (외부 도큐먼트가 TODO.md 를 참조) | 본 PR 머지 전 grep 으로 `TODO.md` 참조 확인. 발견 시 그 참조도 같이 갱신 |
| `.kiro/steering/*.md` 가 IDE-specific 메타라 fork 후 동작 검증 어려움 | 내용은 사람 가독 문서 (LLM steering rule). 의미 변경 없이 단어만 갱신하므로 IDE 동작에 영향 없음 |
| `PROJECT_SUMMARY.md` 의 `your-freeresend.com` → fixture 도메인 | `https://your-domain.example.com/api` 또는 `https://my-resend.example.com/api` 등 RFC 2606 친화 placeholder 채택 |
| stacked branch (`feat/25` on `feat/24`) — `feat/24` 가 develop 으로 머지되기 전엔 feat/25 의 base 가 develop 이 아님 | 본 PR 은 미푸시 상태. push/merge 순서는 (1) feat/24 → develop 머지 → (2) feat/25 rebase 또는 feat/25 → feat/24 머지 후 develop. 추후 사용자가 선택 |
| **롤백** | 모든 변경은 문서. `git revert` 안전. 미푸시 중에는 `git tag backup/feat-25-pre-amend HEAD` 같은 백업 후 진행 |

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-05-14 | 이슈 #25 생성, `feat/25` 브랜치 (feat/24 HEAD 에서 stacked), 본 plan 작성 | 010-1 (PR #24) 미머지 상태에서 stacked 진행, 머지 순서는 사용자 결정 |

## 참고

- 선행 plan: `docs/plan/010-upstream-remnants-sweep.md`
- ground truth (Tier 1 변경 후 운영 가이드): `SETUP.md`, `DEPLOYMENT.md`, `.env.local.example`
- 의도 attribution 의 권위 있는 출처: `NOTICE`
