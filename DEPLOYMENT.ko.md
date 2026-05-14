# MyResend 배포 가이드

> 🌐 **언어**: [English](./DEPLOYMENT.md) · **한국어**

MyResend 는 표준 Next.js 15 애플리케이션입니다. Node 20+ 를 실행할 수 있고 PostgreSQL 데이터베이스에 접근 가능한 호스트면 어디서든 동작합니다. 이 가이드는 지원되는 배포 옵션을 나란히 나열하고, 모든 옵션에 공통되는 단계도 함께 정리합니다.

로컬 첫 실행 셋업은 [SETUP.ko.md](./SETUP.ko.md) 를 참고하세요.

## 1. 사전 준비 (모든 옵션 공통)

- 배포 환경에서 접근 가능한 PostgreSQL 14+ 데이터베이스 (관리형 또는 self-hosted)
- AWS SES production access (검증된 수신자에게만 테스트한다면 sandbox 도 가능)
- [SETUP.ko.md](./SETUP.ko.md) 의 SES v2 정책을 가진 IAM 사용자 (`DNS_PROVIDER=route53` 이면 Route53 정책도 함께)
- `DNS_PROVIDER=digitalocean` 일 때는 DigitalOcean API 토큰
- 커스텀 도메인 (선택이나 일반적 — sandbox 가 아닌 주소로 발송하려면 필수)

## 2. 데이터베이스

MyResend 는 단일 SQL 파일에서 부트스트랩합니다 (마이그레이션 프레임워크 없음). PostgreSQL 호환 서비스면 어떤 것이든 동작합니다 — 데이터베이스를 프로비저닝하고 connection string 을 `DATABASE_URL` 에 넣은 뒤:

```bash
psql "$DATABASE_URL" -f database.sql
```

스크립트는 idempotent (`CREATE TABLE IF NOT EXISTS`) 라 기존 데이터베이스에서도 재실행 안전합니다.

## 3. 환경 변수

`CLAUDE.md § Environment Configuration` 에 정리된 키들을 설정합니다 (`.env.local.example` 에도 동일 집합). 배포 형태에 민감한 키는 다음과 같습니다:

```bash
# 필수
DATABASE_URL=postgresql://user:pass@host:5432/my_resend
NEXTAUTH_URL=https://your-domain.example.com    # public origin
NEXTAUTH_SECRET=                                # 64자 이상 랜덤
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=

# DNS provider (기본값: route53)
DNS_PROVIDER=route53
# DO_API_TOKEN=dop_v1_...   # DNS_PROVIDER=digitalocean 일 때만 필수

# 선택
# AWS_HOSTED_ZONE_ID=...                        # route53 모드, 선택
# CRON_SECRET=                                  # cron endpoint 헤더
```

`.env.local` 이나 실제 시크릿이 담긴 파일은 절대 commit 하지 않습니다. `.env.local.example` 만 git 추적 대상이며 placeholder 만 포함합니다.

## 4. 배포 옵션

MyResend 는 플랫폼 lock-in 이 없습니다. 아래 옵션은 우선순위 없이 나열되어 있으니 기존 인프라에 맞는 것을 고르세요.

### 옵션 A: Docker

```bash
# 빌드
docker build -t my-resend .

# 실행
docker run -d --name my-resend \
  -p 3000:3000 \
  --env-file .env.local \
  my-resend
```

번들된 `docker-compose.yml` 은 애플리케이션 서비스와 함께 첫 부팅 시 `database.sql` 로 초기화되는 선택적 (주석 처리된) Postgres 서비스도 제공합니다.

### 옵션 B: Dokku

```bash
# Dokku 호스트에서
dokku apps:create my-resend
dokku postgres:create my-resend-db
dokku postgres:link my-resend-db my-resend
dokku config:set my-resend \
  AWS_REGION=us-east-1 \
  AWS_ACCESS_KEY_ID=... \
  AWS_SECRET_ACCESS_KEY=... \
  NEXTAUTH_SECRET=... \
  ADMIN_EMAIL=admin@example.com \
  ADMIN_PASSWORD=... \
  DNS_PROVIDER=digitalocean \
  DO_API_TOKEN=...

# 워크스테이션에서
git remote add dokku dokku@your-dokku-host:my-resend
git push dokku develop:main
```

### 옵션 C: Coolify / CapRover / 기타 PaaS

Dockerfile 을 받는 container-aware PaaS 면 모두 호환됩니다. 본 저장소를 가리키고, PaaS 대시보드에서 환경 변수를 설정한 뒤, 포함된 `Dockerfile` 로 빌드하게 합니다.

### 옵션 D: Fly.io

```bash
fly launch --no-deploy        # fly.toml 생성
fly secrets set DATABASE_URL=... NEXTAUTH_SECRET=... \
                AWS_REGION=... AWS_ACCESS_KEY_ID=... \
                AWS_SECRET_ACCESS_KEY=... ADMIN_EMAIL=... \
                ADMIN_PASSWORD=... DNS_PROVIDER=... DO_API_TOKEN=...
fly deploy
```

데이터베이스는 Fly Postgres (`fly postgres create`) 를 프로비저닝하거나, 외부 관리형 Postgres 를 `DATABASE_URL` 로 가리키면 됩니다.

### 옵션 E: Vercel

```bash
vercel login
vercel link
vercel env add DATABASE_URL          # 각 변수마다 반복
vercel --prod
```

주의:
- Vercel 의 serverless function 은 수명이 짧아 장기 실행 작업에는 적합하지 않습니다 (MyResend 에는 그런 작업이 없습니다).
- Postgres 는 외부에서 프로비저닝하세요 (Neon, RDS 등) — Vercel 은 데이터베이스를 호스팅하지 않습니다.

### 옵션 F: Kubernetes

저장소의 `k8s/` 디렉터리에 샘플 매니페스트가 포함되어 있습니다 (turn-key 배포가 아니라 시작점 reference 로 사용하세요). 처음부터 배포하려면 `Dockerfile` 로 이미지를 빌드해 본인 레지스트리에 push 하고, `DATABASE_URL` 과 AWS credential 을 Secret 으로 연결한 Deployment + Service + Ingress 매니페스트를 작성합니다.

## 5. 커스텀 도메인과 TLS

위 플랫폼들 대부분은 TLS 를 자동 종료해줍니다 (Vercel, Fly.io, Let's Encrypt 가 붙은 Dokku, Coolify, cert-manager 가 붙은 Kubernetes). 도메인이 배포를 가리키게 된 다음:

1. `NEXTAUTH_URL` 을 public origin 으로 설정합니다.
2. 새 값이 반영되도록 재배포 또는 재시작합니다.

## 6. 배포 후 체크리스트

1. `https://your-domain.example.com` 에 접속해 랜딩 페이지가 표시되는지 확인합니다.
2. admin 사용자 시드: `curl -X POST https://your-domain.example.com/api/setup`. 재실행은 idempotent 하므로 안전합니다.
3. `ADMIN_EMAIL` / `ADMIN_PASSWORD` 로 로그인합니다.
4. **Connections** 탭을 열어 두 카드 모두 `ok: true` 인지 확인합니다. 실패 시 응답 body 가 누락된 IAM 액션 또는 무효 토큰을 알려줍니다.
5. **Domains** 탭에서 실제 도메인을 추가하고 SES verification + DKIM 활성화를 기다립니다.
6. 검증된 도메인에 대해 API key 를 발급하고 테스트 메일을 보냅니다.

## 7. 운영 노트

### CI Gate

`.github/workflows/ci.yml` 이 모든 PR 에서 `lint → typecheck → test → build` 를 실행합니다. 배포 artifact 는 동일한 `npm run build` 결과물이므로, 초록 CI 는 배포 빌드 성공을 보증합니다.

### 테스트의 외부 호출

Jest 슈트는 모든 외부 SDK 호출을 mock 합니다 (AWS 는 `aws-sdk-client-mock`, axios 는 `jest.mock`). 실제 AWS, DigitalOcean, SMTP 를 절대 hit 하지 않습니다. 동작 검증의 source of truth 로 Jest 를 신뢰하세요 — `npm test -- src/lib/__tests__/ses` 가 네트워크 없이 SES 경로를 end-to-end 로 실행합니다.

### 스케일링

- 웹 티어는 `users`, `domains`, `api_keys`, `email_logs` 테이블 뒤에서 stateless 입니다. Horizontal scaling 은 단순합니다 — 앞단에 load balancer 만 두면 됩니다.
- AWS SES 는 account-level 발송 quota 를 가집니다 (**Connections** 탭이 `GetAccount` 로 표시). 대량 발송 전 quota 증액을 요청하세요.
- Route53 은 rate-limit 이 있습니다 (hosted zone 당 5 changes/second). MyResend 는 도메인별로 레코드 변경을 직렬화하지만, 대량 import 는 페이스 조절이 필요합니다.

### 업데이트

Git 기반 배포 (Dokku, Fly.io, Vercel + GitHub 연동) 는 추적 브랜치에 push 하면 호스트가 재빌드합니다. Docker 기반 배포는 이미지를 재빌드하고 컨테이너를 재시작합니다. 스키마를 변경한 변경분을 pull 한 뒤에는 항상 `psql "$DATABASE_URL" -f database.sql` 을 실행하세요.

## 8. 보안 체크리스트

- [ ] `NEXTAUTH_SECRET` 이 64자 이상의 랜덤 데이터인지
- [ ] `AWS_*` credential 이 MyResend 가 사용하는 SES + Route53 액션으로만 한정되어 있는지 (정확한 정책은 [SETUP.ko.md](./SETUP.ko.md) 참조)
- [ ] 시크릿이 플랫폼의 secret manager (Vercel env, Dokku config, Fly secrets, Kubernetes Secrets) 에 있고 commit 파일에는 없는지
- [ ] TLS 가 end-to-end 로 강제되는지. 위 대부분의 플랫폼은 기본값으로 처리
- [ ] 데이터베이스 연결이 provider 가 제공하는 경우 TLS 를 사용하는지 (connection string 에 `sslmode=require`)
- [ ] `/api/cron/*` endpoint 를 노출한다면 `CRON_SECRET` 이 설정되었는지

## 9. 지원

- 버그 리포트: [Orchemi/my-resend issues](https://github.com/Orchemi/my-resend/issues)
- Attribution 과 upstream divergence boundary: [NOTICE](./NOTICE) 참조
