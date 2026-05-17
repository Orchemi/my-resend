# 011-onboarding-hardening

## 개요

- **이슈**: [#34](https://github.com/Orchemi/my-resend/issues/34)
- **브랜치**: `feat/34`
- **상태**: 진행 중
- **생성일**: 2026-05-17

신규 사용자가 fresh-clone 에서 `SETUP.md` 만 따라가도 무리 없이 동작하도록 첫 부팅 경로를 단단히 한다. 절차를 따라했는데도 *겉으로는 성공* 인 채로 실제 DB 가 안 켜진 상태로 흘러가는 두 가지 버그를 잡고, Docker Postgres 경로를 정식 안내로 끌어올린다.

## 배경

`.env.local` 없이 `npm run dev` 를 띄우고 `SETUP.md` § 3 의 절차를 시뮬레이션하다가 다음을 관찰했다.

### Bug 1 — `/api/setup` 가 DB 실패를 success 로 응답

`src/lib/auth.ts:135-152` 의 `initializeDefaultUser` 가 내부에서 throw 하지 않고 `console.error` 로만 처리한다. 호출자 `src/app/api/setup/route.ts:5-21` 의 try/catch 는 throw 되는 게 없어 항상 200 success 로 응답한다. 운영자에게 "기본 admin 생성 완료" 라고 거짓 신호를 보낸다.

### Bug 2 — `DATABASE_URL` 미설정 시 libpq 기본값으로 silent fallback

`src/lib/database.ts:4-13` 의 Pool 생성자가 `connectionString: process.env.DATABASE_URL` 를 그대로 받는다. 값이 `undefined` 면 `pg` 가 libpq 기본값(`PGHOST=localhost`, `PGPORT=5432`, `PGUSER=$USER`)으로 폴백한다. 개발자 머신에 무관한 Postgres 가 5432 를 점유 중이면 그 인스턴스로 흘러간다.

### UX 결함 — `SETUP.md` § 3 가 false-positive curl 을 신호로 안내

현 `SETUP.md` 는 `curl -X POST /api/setup` 의 success 응답을 "시드 완료" 로 해석하라고 안내한다. Bug 1 때문에 무의미하다. Postgres 경로도 `docker-compose.yml` 주석으로만 존재하고 안내가 없다.

## 목표

- [ ] Bug 1 수정: `initializeDefaultUser` 에러 전파, setup route 에서 500 응답
- [ ] Bug 2 수정: `database.ts` module load 시 `DATABASE_URL` 검증, 누락 시 명시적 throw
- [ ] `docker-compose.yml` Postgres 서비스 활성화 (또는 `docker-compose.dev.yml` 신설) — `docker compose up -d postgres` 한 줄로 로컬 DB 확보
- [ ] `.env.local.example` 의 `DATABASE_URL` 에 docker compose 와 정합하는 예시 주석 추가
- [ ] `SETUP.md` / `SETUP.ko.md` § 3 갱신: docker compose 경로, fail-fast 동작, setup HTTP status 가 신뢰 가능해진 사실 명시
- [ ] CI 4단(lint+typecheck+test+build) 모두 통과
- [ ] E2E 검증: fresh clone 가정으로 부팅 → 로그인 → 대시보드 도달까지

## 설계

### 접근

**최소 침습 + fail-loud** 원칙. UX 메시지를 다듬기보다 *오류가 분명히 보이게* 만드는 쪽을 우선한다.

#### `database.ts` fail-fast

```ts
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. See SETUP.md § 3 (copy .env.local.example to .env.local and set DATABASE_URL).",
  );
}
const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } /* ... */ });
```

테스트는 `jest.isolateModules` 로 격리해서 module top-level throw 를 검증한다.

#### `initializeDefaultUser` 에러 전파

`catch (error) { console.error(...); }` 패턴을 제거하고 caller 가 알 수 있게 rethrow. setup route 는 기존 try/catch 가 그대로 작동하여 500 으로 응답한다. 단, `ADMIN_EMAIL/ADMIN_PASSWORD` 미설정 시의 skip 경로는 정상 흐름이므로 throw 하지 않고 그대로 둔다 — 응답은 200 + `skipped: true` 정도로 신호.

```ts
// auth.ts
export async function initializeDefaultUser(): Promise<{ status: "created" | "exists" | "skipped" }> {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.warn("ADMIN_EMAIL and ADMIN_PASSWORD not set. Skipping default user creation.");
    return { status: "skipped" };
  }
  const result = await query("SELECT id FROM users WHERE email = $1 LIMIT 1", [adminEmail]);
  if (result.rows.length > 0) {
    return { status: "exists" };
  }
  await createUser(adminEmail, adminPassword, "Admin");
  return { status: "created" };
}
```

```ts
// setup/route.ts
const result = await initializeDefaultUser();
return NextResponse.json({ success: true, status: result.status });
```

#### docker-compose 활성

기존 yml 주석 그대로 풀면 비밀번호가 placeholder 라 깨진다. 다음으로 정비:

```yaml
postgres:
  image: postgres:15-alpine
  environment:
    POSTGRES_DB: my_resend
    POSTGRES_USER: my_resend
    POSTGRES_PASSWORD: my_resend_dev   # local-only default — override in .env or production
  volumes:
    - postgres_data:/var/lib/postgresql/data
    - ./database.sql:/docker-entrypoint-initdb.d/init.sql:ro
  ports:
    - "5432:5432"
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U my_resend -d my_resend"]
    interval: 5s
    timeout: 3s
    retries: 5
volumes:
  postgres_data:
```

`.env.local.example` 의 `DATABASE_URL` 주석에 `postgresql://my_resend:my_resend_dev@localhost:5432/my_resend` 매칭 예시 추가.

`my-resend` 앱 서비스(production-target)는 그대로 두되, docker compose 가 *옵션* 임을 README 에 명시.

#### SETUP 문서 § 3 재구성

기존 절차가 길어서 신규 사용자가 길을 잃는다. 다음 흐름으로 압축:

1. `cp .env.local.example .env.local`
2. (선택) `docker compose up -d postgres` — 또는 보유 중인 Postgres 의 URL 을 `.env.local` 에 적는다
3. `DATABASE_URL` 등 필수 키 채우기 (참조 표)
4. `npm install`
5. `npm run dev`
6. `curl -fsSL -X POST http://localhost:3000/api/setup` — HTTP 200 + `status: "created"` 인지 확인. 400/500 이면 응답 body 의 에러 메시지를 따라간다.
7. 브라우저 로그인

핵심 변화: curl 에 `-f` (fail-on-error) + status 필드 명시.

### 변경 범위

```
src/
├── lib/
│   ├── database.ts                  # DATABASE_URL 검증 + Pool lazy init
│   ├── auth.ts                      # initializeDefaultUser throw + structured return
│   └── __tests__/
│       └── database.test.ts         # 신규 — env 누락 시 throw 검증
└── app/api/setup/
    ├── route.ts                     # status 전파 + 실패 시 500
    └── __tests__/
        └── route.test.ts            # 신규 — success / skip / failure 3 케이스

docker-compose.yml                   # postgres 서비스 활성 + healthcheck
.env.local.example                   # DATABASE_URL 예시 주석 보강
SETUP.md                             # § 3 재작성
SETUP.ko.md                          # § 3 재작성
docs/plan/011-onboarding-hardening.md # 본 문서 (신규)
```

### 의사결정 기록

| 결정 | 선택지 | 결정 | 이유 |
|------|--------|------|------|
| `database.ts` 검증 위치 | module top-level vs 첫 query | top-level | fail-fast. 서버 부팅 시점에 즉시 알 수 있게 |
| `initializeDefaultUser` skip 시 응답 | 200 generic vs 200 + status | 200 + status | 신규 사용자가 "왜 로그인 실패하지?" 추적할 단서 제공 |
| docker compose 분리 | 단일 yml vs `docker-compose.dev.yml` | 단일 yml | 신규 사용자가 파일을 더 안 찾도록. profile/grouping 미사용 |
| `/api/auth/login` 메시지 | 일반화 유지 vs DB-down 분리 | 일반화 유지 | 보안상 합리적. 서버 로그가 분리되므로 디버깅 가능 |
| Postgres 비밀번호 | random vs `my_resend_dev` | `my_resend_dev` | 로컬 전용. 신규 사용자가 처음 보는 값이 placeholder 가 아니어야 |

## 작업 단계

### Phase 1 — Bug fix (TDD)

- [ ] `src/lib/__tests__/database.test.ts` 작성 — DATABASE_URL 미설정 throw 검증
- [ ] `src/lib/database.ts` 수정 — env 검증 추가
- [ ] `src/app/api/setup/__tests__/route.test.ts` 작성 — success / skip / failure 3 케이스
- [ ] `src/lib/auth.ts` `initializeDefaultUser` 시그니처 변경 + throw
- [ ] `src/app/api/setup/route.ts` status 전파

### Phase 2 — Onboarding ergonomics

- [ ] `docker-compose.yml` postgres 활성 + healthcheck + volume mount
- [ ] `.env.local.example` DATABASE_URL 주석 보강

### Phase 3 — 문서

- [ ] `SETUP.md` § 3 재작성
- [ ] `SETUP.ko.md` § 3 재작성

### Phase 4 — CI + E2E

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` 4단 통과
- [ ] docker compose 로 postgres 띄우고 fresh `.env.local` 로 dev server → `/api/setup` 200 → 브라우저 로그인 → dashboard 까지 playwright 캡처

### Phase 5 — Merge

- [ ] commit 분할 (영어 conventional + scope, plan 우선 → fix → docs → chore 순)
- [ ] PR → develop, merge commit

## 진행 로그

| 날짜 | 내용 | 비고 |
|------|------|------|
| 2026-05-17 | 이슈 #34 + 브랜치 feat/34 생성, plan 작성 | |

## 참고

- 선행 plan: 008-ci-gate (CI 4단 baseline), 010 시리즈 (upstream 잔존 표기 정리)
- 관련 코드:
  - `src/lib/database.ts:4-13` — Pool 생성자
  - `src/lib/auth.ts:124-152` — `initializeDefaultUser`
  - `src/app/api/setup/route.ts` — 전체
