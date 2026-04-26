# 008-ci-gate

## 개요

- **이슈**: [#17](https://github.com/Orchemi/my-resend/issues/17)
- **브랜치**: `feat/17`
- **상태**: 진행 중
- **생성일**: 2026-04-26
- **선행**: [PR #16](https://github.com/Orchemi/my-resend/pull/16) — `tsc --noEmit` 베이스라인 0 확보. 이 PR 의 follow-up 노트에서 "CI gate 추가" 가 명시됨

## 배경

PR #16 이 `tsc --noEmit` 을 23 → 0 으로 만들었지만, 자동 검증이 없으면 다음 PR 이 type drift 를 다시 도입해도 머지될 수 있다. 같은 논리로 lint, test, build 도 모두 PR 단위로 검증되어야 한다. 하나의 workflow 로 묶어서 PR 시 단일 통과/실패 status 를 노출.

기존 `.github/workflows/deploy.yml` 은 upstream 의 DigitalOcean Kubernetes 배포 워크플로우 — 본 fork 의 운영 결정과 별개라 그대로 보존.

## 목표

- [ ] `package.json` 에 `"typecheck": "tsc --noEmit"` 스크립트 추가
- [ ] `.github/workflows/ci.yml` 신설 — 단일 job 에서 lint → typecheck → test → build 순차 실행
- [ ] Trigger: 모든 `pull_request` + `develop` / `production` 으로의 `push`
- [ ] CLAUDE.md 의 Development Commands 섹션에 `npm run typecheck` 추가
- [ ] 로컬에서 4 단계 모두 통과 확인 후 커밋

## 설계

### 접근 방식

1. **단일 job 순차 실행**. lint / typecheck / test / build 를 별도 job 으로 병렬화하면 setup 시간 (npm ci ~30s × N) 이 누적된다. 본 프로젝트 규모에서는 단일 job 이 더 빠르고 보기에도 깔끔. 추후 build 시간이 1분 이상 늘면 분리 검토.
2. **`--runInBand` 강제**. PR #16 follow-up 의 WaitlistSignup jest-worker SIGABRT 가 parallel 실행에서 발생. CI runner 의 제한된 메모리 (ubuntu-latest 7GB) 에서는 더 위험. in-band 가 안전.
3. **Node 20 LTS 고정**. `package.json` 의 next.js 15 + react 19 가 Node 20+ 요구. CI 가 운영 환경과 동일 메이저 버전.
4. **`actions/setup-node@v4` 의 `cache: 'npm'`** 활용. 별도 caching 액션 없이 `package-lock.json` 기반 자동 캐시.

### 변경 범위

```
my-resend/
├── package.json                    # "typecheck": "tsc --noEmit" 추가
├── .github/workflows/
│   └── ci.yml                      # 신규 — lint/typecheck/test/build gate
├── CLAUDE.md                       # Development Commands 에 typecheck 추가
└── docs/plan/
    └── 008-ci-gate.md              # 본 문서
```

**무수정**:
- `.github/workflows/deploy.yml` (upstream 운영 워크플로우 — 별도 결정)
- 코드 모듈
- 테스트 파일

### 의사결정 기록

| 결정 사항 | 선택지 | 결정 | 이유 |
|-----------|--------|------|------|
| Job 분리 vs 단일 | A) 단일 / B) 병렬 4 job | **A** | 프로젝트 규모. setup 시간 누적 회피. 빌드 시간 늘면 재검토 |
| Test 병렬도 | A) `--runInBand` / B) 기본 (numCpus-1) | **A** | PR #16 의 SIGABRT 패턴 회피. CI runner 메모리 제약 |
| Trigger | A) PR + push develop/production / B) PR 만 / C) 전체 push | **A** | base branch 머지 후에도 검증 (gh actions UI status) |
| Node 버전 | A) 20 / B) 18 / C) 22 | **A** | next.js 15 + react 19 의 권장. README 의 prerequisite 도 20+ |
| Cache 전략 | A) setup-node 내장 npm cache / B) 별도 actions/cache | **A** | 자동 + 단순. 별도 액션은 불필요한 복잡성 |
| Branch protection 설정 | A) workflow 만 추가 / B) 코드로 protection 정의 | **A** | branch protection 은 GitHub repo 설정 — 본 PR 의 책임 밖. workflow 가 추가되면 maintainer 가 settings 에서 required check 으로 등록 |

## 작업 단계

### Phase 1: package.json typecheck 스크립트

- [ ] `"typecheck": "tsc --noEmit"` 추가
- [ ] 로컬 `npm run typecheck` 실행 → 0 에러 확인 (PR #16 baseline)

### Phase 2: ci.yml 작성

- [ ] `.github/workflows/ci.yml` 작성
- [ ] checkout v4 + setup-node@v4 (node 20, npm cache)
- [ ] `npm ci` → `npm run lint` → `npm run typecheck` → `npm test -- --runInBand` → `npm run build`

### Phase 3: 문서 갱신

- [ ] `CLAUDE.md` Development Commands 섹션에 `npm run typecheck` 추가

### Phase 4: 로컬 검증

- [ ] 4 단계 모두 로컬에서 순차 실행 → 모두 통과
- [ ] 일부 단계는 이미 수시 검증되지만 여기서 한 번 더 (CI 와 동일 순서로)

### Phase 5: 커밋 + PR

- [ ] 2 commits: docs(plan) + ci 작업 (script + workflow + CLAUDE.md)
- [ ] `/pr auto`

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-04-26 | 이슈 #17, `feat/17` 브랜치, 본 plan 작성 | PR #16 직후 follow-up |

## 참고

- 직전 plan 007: `docs/plan/007-tsc-error-cleanup.md`
- GitHub Actions setup-node v4: <https://github.com/actions/setup-node>
- Jest --runInBand: <https://jestjs.io/docs/cli#--runinband>
