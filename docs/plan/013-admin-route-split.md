# 013-admin-route-split

## 개요

- **이슈**: [#50](https://github.com/Orchemi/my-resend/issues/50)
- **브랜치**: `feat/50`
- **상태**: 진행 중
- **생성일**: 2026-05-17

마케팅 surface 와 admin UI 가 `/` 라우트 한 곳에서 인증 상태로 분기되던 구조를 분리한다. `/` 는 항상 public landing, admin 은 `/admin` (+ `/admin/login`) 별도 라우트.

## 배경

`src/app/page.tsx` 가 다음 패턴이었다:

```tsx
if (user)   return <Dashboard />;
            return <LandingPage />;
```

upstream `freeresend` 가 "한 앱이 둘 다" — 호스팅 SaaS 마케팅 깔때기 + 어드민 — 을 의도한 설계. 본 fork 는 waitlist / Hosted tier 제거 후 SaaS 가 아니지만 구조적 결합이 남아 있었다. self-host OSS 운영자 입장에서 *자기 인프라가 자기 자신에게 영업하는* 어색한 동선이 된다.

사용자 결정 (옵션 B): 마케팅 surface 는 보존, admin 만 분리.

## 목표

- [ ] plan 문서 작성
- [ ] `/admin` 라우트 신설 — auth-gate + Dashboard 렌더
- [ ] `/admin/login` 라우트 신설 — 현재 `/login` 의 LoginForm 재사용
- [ ] `/` 단순화 — auth 분기 제거, 항상 LandingPage
- [ ] LandingPage CTAs `/login` → `/admin` 3 hit 갱신
- [ ] 기존 `/login` 라우트 → `/admin/login` permanent redirect (compat)
- [ ] LoginPageClient `router.push("/")` → `router.push("/admin")`
- [ ] 테스트 갱신 — LandingPage CTAs 단언
- [ ] CI 4단 통과
- [ ] SETUP.md / SETUP.ko.md 의 `/login` 언급 점검

## 설계

### 라우트 표 (전/후)

| 경로 | 전 | 후 |
|------|----|----|
| `/` | 미인증 → LandingPage / 인증 → Dashboard | 항상 LandingPage (공개) |
| `/login` | LoginForm | `/admin/login` 으로 308 permanent redirect (compat) |
| `/pricing` | PricingCalculator (공개) | 변경 없음 |
| `/admin` | (없음, 404) | auth-gate. 미인증 → `/admin/login` redirect. 인증 → Dashboard |
| `/admin/login` | (없음) | LoginForm. 인증 상태로 진입 시 `/admin` redirect |

### 인증 흐름

- 인증되지 않은 사용자가 `/admin` 진입 → 클라이언트에서 `router.push('/admin/login')`
- `/admin/login` 진입 후 로그인 성공 → `LoginPageClient` 의 useEffect 가 `user` 갱신 감지 → `router.push('/admin')`
- 로그아웃 → `useAuth().logout()` 호출 → 컨텍스트 user=null → `/admin` 에서 자동으로 `/admin/login` 으로 이동. (별도 redirect 코드 불필요)

### 컴포넌트 재사용

- `Dashboard.tsx`, `LandingPage.tsx`, `LoginForm.tsx`, `LoginPageClient.tsx` 본체는 변경 없음.
- `LoginPageClient` 의 redirect target 만 `/` → `/admin` 으로 1줄 수정.

### 변경 범위

```
src/app/
├── page.tsx                              # 단순화: 항상 <LandingPage />
├── login/
│   └── page.tsx                          # /admin/login 으로 redirect 만 남김
└── admin/                                # NEW
    ├── page.tsx                          # NEW — auth gate + <Dashboard />
    └── login/
        └── page.tsx                      # NEW — <LoginPageClient />

src/components/
└── LoginPageClient.tsx                   # router.push("/") → "/admin"

src/components/
└── LandingPage.tsx                       # /login → /admin (3 hit)

src/components/__tests__/
└── LandingPage.test.tsx                  # CTAs 단언 갱신
```

### 의사결정 기록

| 결정 | 선택지 | 결정 | 이유 |
|------|--------|------|------|
| 라우트 구조 | (A) `/` admin-only, landing 제거 / (B) `/admin` 분리 / (C) env 플래그 | **B** | 사용자 결정. calculator + 마케팅 surface 보존 가치 인정, admin 만 분리 |
| 로그인 후 destination | `/` / `/admin` | `/admin` | admin 작업하러 들어왔으니 admin 으로 |
| 로그아웃 후 destination | `/` / `/admin/login` | 자동 — `/admin` 에서 컨텍스트 변화 감지로 `/admin/login` 이동 | 별도 redirect 코드 없이도 동작. 단순 |
| CTAs 타겟 | `/admin/login` / `/admin` | **`/admin`** | semantically "go to admin" — 이미 로그인됐으면 바로 dashboard, 아니면 login 으로 우회 |
| `/login` 처리 | 삭제 / redirect | redirect | 기존 북마크 보존, 비용 거의 없음 (`redirect()` 한 줄) |
| middleware 추가 | server-side guard / client-only | client-only | single-admin OSS 에서 server middleware 는 over-engineering. 기존 useAuth 패턴 유지 |

## 작업 단계

### Phase 1 — 신규 라우트 추가

- [ ] `src/app/admin/page.tsx` 신설 — 기존 `/` 의 auth 분기 로직을 그대로 가져옴 (loading / unauthenticated redirect / authenticated → Dashboard)
- [ ] `src/app/admin/login/page.tsx` 신설 — `<LoginPageClient />` 호출
- [ ] `LoginPageClient` 의 `router.push("/")` → `"/admin"`

### Phase 2 — `/` 단순화 + CTAs

- [ ] `src/app/page.tsx` 단순화 — `<LandingPage />` 단독 렌더
- [ ] `LandingPage.tsx` 3 hit (`href="/login"`) → `"/admin"`

### Phase 3 — 호환 redirect

- [ ] `src/app/login/page.tsx` 본문 → `redirect("/admin/login")` (Next.js 의 `next/navigation` redirect)

### Phase 4 — 테스트 + 문서

- [ ] `LandingPage.test.tsx` — Get Started CTAs href 단언 `/login` → `/admin`
- [ ] `SETUP.md` / `SETUP.ko.md` 의 로그인 언급 점검 (있으면 `/admin` 으로 안내)
- [ ] CI 4단 통과 확인

### Phase 5 — Merge

- [ ] commit 분할 (plan / 신규 라우트+admin gate / `/` 단순화+CTAs / `/login` redirect+docs)
- [ ] PR → develop, merge commit

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-05-17 | 이슈 #50 + feat/50 + plan 작성 | |

## 참고

- 선행: 011 (onboarding-hardening), 012 (waitlist 제거)
- 후속 후보: 서버 측 admin 라우트 middleware 보강 (별도 트랙)
