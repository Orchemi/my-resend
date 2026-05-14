# 010-3-tier-3-infra-artifacts-sweep

## 개요

- **이슈**: [#26](https://github.com/Orchemi/my-resend/issues/26)
- **브랜치**: `feat/26` (stacked on `feat/25` → `feat/24`)
- **상태**: 진행 중
- **생성일**: 2026-05-14
- **선행**: plan 010 § Tier 3 분류, plan 010-2 (PR #25, feat/25, 머지 대기). 본 plan 은 010 의 마지막 sweep 마일스톤이며 Tier 4 (`.kiro/specs/hosted-version-waitlist/*`) 는 #20 운영방향 결정에 종속되어 본 plan 의 비스코프

## 배경

plan 010 의 카탈로그가 Tier 3 후보 묶음 — 배포 infra 매니페스트 / 이슈 템플릿 / upstream test artifacts / DB seed 코멘트 — 을 "010-3 후속 PR" 로 분류했다. 본 plan 은 그 묶음을 라인 단위로 인덱싱하고 폐지/갱신 의사결정을 명문화한다.

Tier 1 (PR #24) 과 Tier 2 (PR #25) 가 운영 가이드와 contributor 문서를 정렬한 뒤이므로 본 PR 머지 후 레포 전체의 의도하지 않은 upstream 단어 잔존은 0 (의도된 attribution — `NOTICE`, `LICENSE`, `README.md` / `README.ko.md` / `CLAUDE.md` L7~L9 의 fork 한 줄, `docs/plan/*` 의 역사 기록 — 만 남는다).

## 목표

- [ ] plan 010-3 본 문서 신설
- [ ] `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml` 갱신
- [ ] `database.sql` L1 코멘트 + L137 default seed 갱신
- [ ] `test-curl.sh`, `test-email.js`, `test-smtp.js` 폐지 (`git rm` × 3)
- [ ] `.github/workflows/deploy.yml` 폐지 (`git rm`)
- [ ] `k8s/**` 18 파일 placeholder 갱신
- [ ] CI 4단 통과 + 전 레포 stale grep 0 (의도 attribution 제외)

## 의사결정

### 폐지 (rm)

1. **`.github/workflows/deploy.yml`** (87 줄, 12 hits) — upstream `eibrahim/freeresend` 의 DigitalOcean Kubernetes 자동배포 워크플로우. DigitalOcean API 토큰, DO container registry path (`registry.digitalocean.com/curatedletters/freeresend`), 작업자 specific kubectl context 등 모든 값이 upstream 의 작업자 환경에 종속이라 placeholder 화 후에도 실 동작 보장 불가. OSS audience 에게 "그대로 사용 가능한 워크플로우" 라는 잘못된 인상을 준다.
   - plan 008 (`docs/plan/008-ci-gate.md`) 에서 "upstream 운영 워크플로우 — 본 fork 의 운영 결정과 별개라 그대로 보존" 으로 결정했으나, plan 010 § Tier 3 가 진입 시 "(a) 폐지 / (b) generic 화 / (c) 보존 중 택 1" 로 재의사결정을 명문화. 본 plan 의 결정 = **폐지**.
   - PR 검증용 CI (`.github/workflows/ci.yml`, plan 008 신설) 는 별개 워크플로우 — 본 폐지 영향 없음.
   - 운영자는 본인 환경 (Docker / Dokku / Coolify / Fly / Vercel / Kubernetes 등 — DEPLOYMENT.md 의 6 옵션 참조) 에 맞춰 자체 deploy workflow 를 작성한다.

2. **`test-curl.sh`** (9 hits), **`test-email.js`** (17 hits), **`test-smtp.js`** (4 hits) — 외부 SES / SMTP 엔드포인트를 실제로 hit 하는 upstream artifact. `CLAUDE.md` (L42~44) 와 `SETUP.md` (재작성된 § 5) 가 *"those are upstream artifacts. The Jest suite ... is the source of truth"* 로 이미 명시. 본 프로젝트 프로필의 "외부 SDK 호출 mock 강제" 정책과 정면 모순이라 placeholder 화 무의미.

### 갱신

3. **`.github/ISSUE_TEMPLATE/bug_report.yml`** L2, **`feature_request.yml`** L2 + L9 — 단순 "FreeResend" → "MyResend" 텍스트 치환 3 hits.

4. **`database.sql`** L1 (`-- FreeResend Database Schema`) → `-- MyResend Database Schema`. L137 default seed `admin@freeresend.com` → `admin@example.com` (RFC 2606 placeholder — 운영자가 `.env.local` 의 `ADMIN_EMAIL` 로 override).

5. **`k8s/**`** 18 파일 (143 hits) — OSS reference 가치 유지하되 작업자 색채 제거. 적용 치환 규칙 (순서대로 — 앞 단계가 뒤 단계의 match 를 깨뜨리지 않도록):
   1. `registry.digitalocean.com/curatedletters/freeresend` → `your-registry.example.com/my-resend` (image path 구체적 작업자 registry → generic placeholder)
   2. `www.freeresend.com` → `www.example.com`, `freeresend.com` → `example.com` (ingress host)
   3. `curatedletters` → `registry-pull` (imagePullSecrets name + DO registry repo name)
   4. `FreeResend` → `MyResend` (대문자 코멘트)
   5. `freeresend` → `my-resend` (모든 잔여: namespace, deployment/service/cronjob name, secret name, label `app:`)

## Stale 카탈로그 (파일 묶음 단위)

| 파일 / 묶음 | hit 수 | 처리 | 비고 |
|------------|--------|------|------|
| `.github/ISSUE_TEMPLATE/bug_report.yml` | 1 | 갱신 | L2 |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | 2 | 갱신 | L2, L9 |
| `.github/workflows/deploy.yml` | 12 | **폐지** | 87 줄, upstream DO k8s 자동배포 |
| `test-curl.sh` | 9 | **폐지** | upstream artifact, mock 정책 위반 |
| `test-email.js` | 17 | **폐지** | 동일 |
| `test-smtp.js` | 4 | **폐지** | 동일 |
| `database.sql` | 2 | 갱신 | L1 코멘트 + L137 seed |
| `k8s/namespace.yaml` | 2 | 갱신 | namespace name + label |
| `k8s/deployment.yaml` | ~11 | 갱신 | name/namespace/label + image path + imagePullSecrets + secretRef |
| `k8s/service.yaml` | ~4 | 갱신 | name/namespace/label + selector |
| `k8s/ingress.yaml` | ~10 | 갱신 | name/namespace + host × 2 + tls secret |
| `k8s/hpa.yaml` | ~3 | 갱신 | name/namespace + scaleTargetRef |
| `k8s/cronjob-report-stats.yaml` | ~5 | 갱신 | name/namespace/label + image path |
| `k8s/secret.template.yaml` | ~2 | 갱신 | name/namespace |
| `k8s/deploy.sh` | ~수 | 갱신 | kubectl context, namespace 인자 |
| `k8s/update.sh` | ~수 | 갱신 | 동일 |
| `k8s/README.md` | ~수 | 갱신 | 텍스트 |
| `k8s/postgres/{01,02,03,04,05,06}*.yaml` | 다수 | 갱신 | StatefulSet / Service / PVC / ConfigMap / Secret / Namespace |
| `k8s/postgres/README.md` | ~수 | 갱신 | 텍스트 |
| `k8s/postgres/deploy.sh` | ~수 | 갱신 | 스크립트 |

각 파일의 정확한 라인 enum 은 PR diff 에서 권위 있게 확인 가능 (mass sed 적용 후).

## 010-3 작업 절차 (6 분할 커밋, 단일 PR — push 보류 중)

| # | 커밋 메시지 | 변경 파일 | 검증 |
|---|--------------|-----------|------|
| 1 | `docs(plan): add 010-3 tier 3 infra artifacts sweep plan` | `docs/plan/010-3-tier-3-infra-artifacts-sweep.md` (신규) | 파일 존재 |
| 2 | `docs(issue-templates): align bug and feature templates with my-resend` | `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml` | `git grep -nE "FreeResend\|freeresend" -- .github/ISSUE_TEMPLATE/` = 0 |
| 3 | `chore(db): align database.sql header and default seed` | `database.sql` | L1, L137 변경 / `git grep -nE "freeresend" -- database.sql` = 0 |
| 4 | `chore(test): remove upstream test artifacts (jest is source of truth)` | `test-curl.sh`, `test-email.js`, `test-smtp.js` 삭제 | 3 파일 부재 / `git status` clean |
| 5 | `chore(ci): remove upstream digitalocean k8s deploy workflow` | `.github/workflows/deploy.yml` 삭제 | 파일 부재 / CI workflow (`ci.yml`) 영향 없음 |
| 6 | `chore(k8s): rename manifests to my-resend with placeholder registry and host` | `k8s/**` 18 파일 | `git grep -nE "freeresend\|FreeResend\|curatedletters" -- 'k8s/'` = 0 |

## 머지 기준

- [ ] CI 4단 통과
- [ ] 전 레포 stale grep 0 (의도 attribution 보존 5 파일 + plan history 제외):

  ```bash
  git -C $REPO grep -nE \
    "FreeResend|freeresend|frs_|supabase|eibrahim|EliteCoders|curatedletters" \
    -- ':!NOTICE' ':!LICENSE' ':!README.md' ':!README.ko.md' ':!CLAUDE.md' ':!docs/plan/'
  ```

  기대: 0 hits.
- [ ] 폐지 파일 4개 부재 확인 (`test-curl.sh`, `test-email.js`, `test-smtp.js`, `.github/workflows/deploy.yml`)
- [ ] k8s 매니페스트 syntax 정합 (선택적: `kubectl --dry-run=client -f k8s/` 또는 yaml lint)
- [ ] RFC 2606 정합 — `git grep -nF "freeresend.com" -- 'k8s/'` = 0, `git grep -nF "yourdomain.com" -- 'k8s/'` = 0

## 비스코프

- **Tier 4** (`.kiro/specs/hosted-version-waitlist/*`): #20 WaitlistSignup 운영방향 결정에 종속. 본 plan 의 sweep 대상 아님
- **#20 WaitlistSignup pending leak 영구 fix**: 별도 트랙
- **k8s 매니페스트의 의미적 검토** (replica 수, resource limits, probe 설정 등): 본 PR 은 단어 치환에 한정. 운영자 환경에 맞춘 튜닝은 fork 후 운영자 책임
- **CLAUDE.md § Environment Configuration ↔ .env.local.example 자동 drift 검출**: plan 010 § 비스코프 와 동일하게 유지

## 위험·롤백

| 위험 | 완화 |
|------|------|
| mass sed 가 의도 외 매치 (e.g. `freeresend` 가 단어 경계 없이 다른 단어의 일부로 등장) | sed 적용 순서를 plan § 의사결정 5 의 5 단계로 고정 (longest-first). 적용 후 `git diff` 로 변경 확인 + `git grep -nE "(my-resend){2,}\|(MyResend){2,}"` 같은 double-rename 검출 정규식 으로 점검 |
| k8s manifest 폐기 vs 보존 의사결정에 대한 후속 운영자 혼선 | DEPLOYMENT.md 의 "Option F: Kubernetes" 단락에 본 manifest 의 위치와 의도 (reference / starting point) 를 명시 — 이미 PR #24 에서 반영됨 |
| `.github/workflows/deploy.yml` 폐지가 fork 운영자의 자동배포 환경을 깨뜨림 | 본 fork 가 develop / production 로의 자동배포를 사용 중인 운영자가 없다는 가정 (NOTICE / docs/plan/* 에 운영 환경 명시 없음, plan 008 § L15 가 deploy.yml 을 "upstream 운영" 으로 분류). 만일 누군가 의존했다면 자체 deploy workflow 를 작성하면 됨 — 본 결정의 OSS audience 안내는 본 plan + PR 본문 |
| `database.sql` L137 seed `admin@freeresend.com` 가 운영중인 DB 의 admin row 와 일치 | seed 는 idempotent 한 `INSERT ... ON CONFLICT DO NOTHING` 패턴이라 기존 row 가 있으면 변경 없음. 새 fork 설치 시에만 placeholder 가 시드되고, 운영자가 `.env.local` 의 `ADMIN_EMAIL` 을 통해 `POST /api/setup` 으로 실 admin 을 별도로 생성 |
| **롤백** | 모든 변경은 문서 / 설정 / 폐지. 코드 영향 0. `git revert` 안전. 폐지된 파일은 git 히스토리에 남아 있어 필요 시 복구 가능 |

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-05-14 | 이슈 #26 생성, `feat/26` 브랜치 (feat/25 HEAD 에서 stacked), 본 plan 작성 | 010-1 (PR #24), 010-2 (PR #25) 미머지 상태에서 stacked 진행, 머지 순서는 사용자 결정 |

## 참고

- 선행 plan: `docs/plan/010-upstream-remnants-sweep.md`, `docs/plan/010-2-tier-2-contributor-docs-sweep.md`
- plan 008 (deploy.yml 첫 의사결정): `docs/plan/008-ci-gate.md` L15
- ground truth (test artifact 폐지 결정): `CLAUDE.md` L42~L44, `SETUP.md` 재작성된 § 5
