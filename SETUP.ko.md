# MyResend 셋업 가이드

> 🌐 **언어**: [English](./SETUP.md) · **한국어**

이 가이드는 로컬에서 MyResend 를 처음부터 띄우는 절차를 안내합니다. 운영 배포는 [DEPLOYMENT.ko.md](./DEPLOYMENT.ko.md) 를 참고하세요.

## 1. 사전 준비

### PostgreSQL 데이터베이스

MyResend 는 raw `pg` 쿼리를 사용하며 (ORM 없음) 단일 SQL 파일에서 부트스트랩합니다. PostgreSQL 14+ 면 어떤 인스턴스도 호환됩니다.

1. **옵션 A: 로컬 PostgreSQL**

   ```bash
   # PostgreSQL 설치 (macOS)
   brew install postgresql
   brew services start postgresql

   # 데이터베이스 생성 (snake_case — Postgres identifier 는 quoting 없이 쓰려면 snake_case 권장)
   createdb my_resend
   ```

2. **옵션 B: Docker Compose (첫 부팅에 권장)**

   리포지토리에 포함된 `docker-compose.yml` 이 스키마까지 미리 적용된 Postgres 15 를 띄웁니다:

   ```bash
   docker compose up -d postgres
   ```

   `localhost:5432` 에 바인딩되고, `database.sql` 이 entrypoint init 스크립트로 마운트되어 첫 볼륨 생성 시 스키마가 자동 적용됩니다. 호스트에서 앱이 바로 접속할 수 있습니다. 기본 자격증명은 § 2 의 예시 connection string 과 일치 (`my_resend` / `my_resend_dev`).

   이 경로를 쓰면 `psql ... -f database.sql` 수동 적용은 건너뛰어도 됩니다 — Docker Compose 가 첫 부팅 때 처리합니다.

3. **옵션 C: 관리형 Postgres**

   PostgreSQL 호환 서비스 (AWS RDS, Google Cloud SQL, DigitalOcean Managed Databases, Neon, Render 등) 면 어떤 것이든 가능합니다. 데이터베이스를 프로비저닝 한 뒤 connection string 을 `DATABASE_URL` 에 넣으세요.

4. **스키마 초기화 (옵션 A · C 만 해당):**

   ```bash
   # database.sql 이 다음 테이블을 만듭니다:
   # users, domains, api_keys, email_logs, webhook_events, waitlist_signups
   psql "$DATABASE_URL" -f database.sql
   ```

### AWS SES 셋업

1. [AWS SES Console](https://console.aws.amazon.com/ses/) 로 이동합니다.
2. 임의의 수신자에게 메일을 보낼 준비가 되면 production access (sandbox 해제) 를 요청합니다. Sandbox 모드에서도 도메인 verify 와 admin UI 둘러보기는 가능합니다.
3. 다음 IAM 정책을 가진 IAM 사용자를 생성합니다. 액션은 MyResend 가 실제로 호출하는 SES v2 명령과 1:1 대응합니다 (참조: `src/lib/ses.ts`, `src/app/api/health/ses/route.ts`):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "MyResendSesV2",
         "Effect": "Allow",
         "Action": [
           "ses:SendEmail",
           "ses:GetAccount",
           "ses:CreateEmailIdentity",
           "ses:GetEmailIdentity",
           "ses:PutEmailIdentityDkimAttributes",
           "ses:DeleteEmailIdentity",
           "ses:CreateConfigurationSet"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

### DNS Provider (둘 중 하나 선택)

MyResend 는 `DNS_PROVIDER` 환경변수로 선택된 provider 에 도메인 DNS 셋업을 위임합니다. 둘 중 하나를 고르세요:

1. **Route53** (기본값, `DNS_PROVIDER=route53`)

   AWS 계정이 이미 SES 를 운영하고 있다면 권장합니다 — 동일 IAM principal 로 Route53 도 관리할 수 있어 별도 credential 이 필요 없고, 발송 + DNS 전체 흐름이 하나의 audit trail 에 남습니다.

   **a. 발송 도메인용 Route53 hosted zone 생성**

   - AWS Console → Route53 → Hosted zones → **Create hosted zone** 으로 이동합니다.
   - Domain name: 발송에 사용할 apex 도메인 (예: `example.com`). `mail.example.com` 같은 서브도메인은 별도 subzone 으로 운영해도 되고, apex zone 으로 함께 다뤄도 됩니다 — MyResend 의 `AWS_HOSTED_ZONE_ID` 자동 탐지가 parent zone 까지 walk-up 하기 때문에 보통 apex 만 두면 충분합니다.
   - Type: **Public hosted zone**.
   - AWS 가 새 zone 에 할당한 4 개의 NS 레코드를 기록해두세요 — 다음 (b) 단계에서 사용합니다.

   **b. 도메인 등록기관에서 NS 위임**

   도메인 등록기관 (Namecheap, GoDaddy, Cloudflare-as-registrar, Gandi 등) 에서 기존 NS 레코드를 (a) 단계의 4 개 NS 값으로 교체합니다. DNS propagation 은 이전 TTL 에 따라 수 분에서 48 시간까지 걸릴 수 있습니다. 위임이 완료되기 전까지는 MyResend 가 Route53 에 기록한 SES verification TXT 레코드가 public DNS 에 보이지 않아 도메인 verification 이 "pending" 상태로 머무릅니다.

   도메인이 이미 Route53 에 등록되어 있다면 (예: Route53 Domains 로 등록했거나 이전 프로젝트에서 사용 중), (a) 와 (b) 는 건너뜁니다.

   **c. Route53 IAM 정책 첨부**

   위 SES 단계의 IAM 사용자에 다음 statement 를 추가합니다. 액션은 MyResend 가 `src/lib/route53.ts` 에서 호출하는 Route53 명령과 1:1 대응합니다:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "MyResendRoute53",
         "Effect": "Allow",
         "Action": [
           "route53:ListHostedZones",
           "route53:ListHostedZonesByName",
           "route53:GetHostedZone",
           "route53:ChangeResourceRecordSets",
           "route53:ListResourceRecordSets",
           "route53:GetChange"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

   `route53:GetChange` 는 MyResend 자체에서 호출되지 않지만, AWS Console 이나 CLI 로 변경 propagation 상태를 직접 확인하고 싶을 때 정책 재편집 없이 쓸 수 있도록 포함되어 있습니다.

   **d. (선택) `AWS_HOSTED_ZONE_ID` 로 특정 hosted zone 핀**

   - **미설정 (권장)** — single-zone 또는 apex + subdomain 셋업에 적합합니다. MyResend 가 발송 도메인에 대해 `ListHostedZonesByName` 을 호출하고 필요시 parent zone 까지 walk-up 합니다 — 예: `mail.example.com` 을 추가하면 자동으로 `example.com` hosted zone 으로 해석됩니다. 자동 탐지 결과는 프로세스 단위로 메모이즈됩니다.
   - **명시 설정** (`AWS_HOSTED_ZONE_ID=Z0123456789ABCDEFGHIJ`) — Route53 hosted zone 을 여러 개 운영 중이고 MyResend 를 특정 zone 에만 묶고 싶을 때 사용합니다. 예를 들어 여러 팀이 AWS 계정을 공유하고 그 중 한 팀만 MyResend 가 손댈 zone 을 소유한 경우.

   **e. 검증**

   배포 후 admin **Connections** 탭의 DNS 카드가 `/api/health/dns` → `route53:ListHostedZones` 를 호출합니다. 카드가 초록색이면 IAM 정책 / region / credential 이 모두 정상 연결된 것입니다. 빨간색이면 응답 body 가 실패한 액션을 알려줍니다.

2. **DigitalOcean** (`DNS_PROVIDER=digitalocean`)

   DNS 가 이미 DigitalOcean 에 있고 Route53 으로 마이그레이션 하고 싶지 않을 때 사용합니다. [DigitalOcean → API → Tokens](https://cloud.digitalocean.com/account/api/tokens) 에서 read+write scope 의 API 토큰을 생성하고, 대상 도메인을 DO 의 DNS 관리에 추가한 뒤 `DO_API_TOKEN` 을 설정합니다.

## 2. 환경 변수 설정

1. example 환경 파일을 복사합니다:

   ```bash
   cp .env.local.example .env.local
   ```

2. `.env.local` 에 실제 값을 채웁니다. 전체 키 집합과 각 키의 의미는 `CLAUDE.md § Environment Configuration` 에 정리되어 있습니다. 로컬 부팅에 필요한 최소 집합은 다음과 같습니다:

   ```env
   # 데이터베이스 — 필수. 값이 비어 있으면 첫 DB 사용 시점에 명시적으로
   # throw 합니다 (더 이상 libpq 기본값으로 silent fallback 하지 않음).
   # 아래 예시는 § 1 옵션 B 의 docker-compose Postgres 와 일치합니다.
   DATABASE_URL=postgresql://my_resend:my_resend_dev@localhost:5432/my_resend

   # AWS SES (필수)
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=AKIA...
   AWS_SECRET_ACCESS_KEY=...

   # DNS provider (기본값: route53)
   DNS_PROVIDER=route53
   # AWS_HOSTED_ZONE_ID=...       # 선택, 미설정 시 route53 가 자동 탐지
   # DO_API_TOKEN=dop_v1_...      # DNS_PROVIDER=digitalocean 일 때만 필수

   # 보안
   NEXTAUTH_SECRET=               # 64자 이상 랜덤 — `openssl rand -base64 64`

   # Admin 사용자 (첫 POST /api/setup 으로 시드됨)
   ADMIN_EMAIL=admin@example.com
   ADMIN_PASSWORD=                # 강한 비밀번호
   ```

## 3. 설치

```bash
# 의존성 설치 (지원되는 패키지 매니저는 npm 뿐 — package-lock.json 이 커밋됨)
npm install

# 개발 서버 시작 (Next.js 15, Turbopack)
npm run dev

# 별도 터미널에서 ADMIN_EMAIL / ADMIN_PASSWORD 로 기본 admin 사용자를 시드합니다.
# `-f` 플래그로 HTTP 4xx/5xx 시 curl 이 non-zero 로 종료하여 시드 실패가 스크립트에서 보입니다.
curl -fsSL -X POST http://localhost:3000/api/setup
```

응답 body 는 다음과 같이 구조화된 `status` 필드를 가집니다:

- `{"success":true,"status":"created"}` — 첫 실행: admin 사용자 생성됨.
- `{"success":true,"status":"exists"}` — admin 사용자가 이미 있음 (setup 재호출은 no-op).
- `{"success":true,"status":"skipped"}` — `ADMIN_EMAIL` 또는 `ADMIN_PASSWORD` 가 비어 있음. setup 은 **DB 를 건드리지 않음**. 누락된 환경변수를 채우고 dev 서버 재기동 후 다시 호출하세요.
- `{"success":false,"error":"..."}` (HTTP 500) — DB 연결 실패, 스키마 누락, 해시 실패 등 실제 에러가 그대로 전달됩니다. 메시지와 서버 로그를 확인하세요 — 이전에 200 으로 떨어졌던 응답을 신호로 삼지 마세요.

## 4. 첫 단계

1. `http://localhost:3000` 에 접속하고 admin credential 로 로그인합니다.
2. **Connections** 탭을 엽니다 — SES 카드와 DNS provider 카드 모두 `ok: true` 를 표시해야 합니다. 둘 중 하나라도 실패하면 응답 payload 에 비-시크릿 힌트 (region, IAM 진단 등) 가 포함됩니다.
3. **Domains** 탭에서 첫 도메인을 추가합니다 — MyResend 가 필요한 SES verification TXT, DKIM CNAME, SPF, DMARC, MX 레코드를 생성하고 활성 DNS provider 에 자동으로 적용합니다.
4. 도메인 verification 을 기다립니다 (탭 안에서 polling).
5. **API Keys** 탭에서 API key 를 생성합니다 (key 는 검증된 도메인에 대해서만 발급 가능).
6. Resend 호환 API 로 메일 발송을 시작합니다.

## 5. API 테스트

`src/lib/__tests__` 와 route 옆 `__tests__` 디렉터리의 Jest 슈트가 동작 검증의 source of truth 입니다 — AWS SDK 와 axios 를 mock 하므로 실제 endpoint 를 호출하지 않습니다.

실행 중인 인스턴스에 대한 ad-hoc end-to-end probing 은 다음과 같이 합니다:

```bash
# Health check
curl http://localhost:3000/api/health/ses

# 메일 발송 (API key 로 교체 — 형식 mrs_<id>_<secret>)
curl -X POST http://localhost:3000/api/emails \
  -H "Authorization: Bearer mrs_..." \
  -H "Content-Type: application/json" \
  -d '{
    "from": "noreply@example.com",
    "to": ["recipient@example.com"],
    "subject": "Test Email",
    "html": "<h1>Hello from MyResend!</h1>"
  }'
```

## 6. 운영 배포

MyResend 는 플랫폼 lock-in 없는 표준 Next.js 15 앱입니다. 컨테이너 친화적 옵션 (Docker, Dokku, Coolify, Fly.io, Vercel, Kubernetes, 일반 VPS) 모두 호환됩니다. 옵션별 가이드는 [DEPLOYMENT.ko.md](./DEPLOYMENT.ko.md) 를 참고하세요.

## 7. 도메인 DNS 레코드

admin UI 로 도메인을 추가하면 MyResend 가 아래 레코드들을 자동으로 생성·적용합니다. 수동 검증이나 지원되지 않는 DNS 환경에서 사용할 수 있도록 여기 나열합니다.

### SES 도메인 검증

```
Type: TXT
Name: _amazonses.example.com
Value: [CreateEmailIdentity 가 반환하는 verification 토큰]
```

### DKIM (CNAME 3 개)

```
Type: CNAME
Name: <token>._domainkey.example.com
Value: <token>.dkim.amazonses.com
```

### SPF

```
Type: TXT
Name: example.com
Value: v=spf1 include:amazonses.com ~all
```

### DMARC

```
Type: TXT
Name: _dmarc.example.com
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com
```

### MX (SES 로 메일 수신도 하고 싶을 때만)

```
Type: MX
Name: example.com
Value: 10 inbound-smtp.us-east-1.amazonaws.com
```

## 8. 트러블슈팅

1. **데이터베이스 연결 실패**

   - `DATABASE_URL` 이 정상 파싱되는지 확인 (`psql "$DATABASE_URL" -c '\dt'`) 하고 스키마가 적용됐는지 점검합니다.
   - `psql "$DATABASE_URL" -f database.sql` 을 재실행 — 스크립트는 idempotent (`CREATE TABLE IF NOT EXISTS`) 이라 안전합니다.

2. **`/api/health/ses` 가 `ok: false` 반환**

   - `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` 를 다시 확인합니다.
   - 위 IAM 정책이 첨부됐는지 확인합니다. 가장 흔한 원인은 `ses:GetAccount` 누락입니다.
   - Sandbox 에서는 발송이 제한되지만 `GetAccount` 는 여전히 `ok: true` 를 반환합니다.

3. **`/api/health/dns` 가 `ok: false` 반환**

   - **Route53** (기본값):
     - § 1 의 IAM 정책이 SES credential 과 동일한 사용자에 첨부되어 있는지 확인합니다. 가장 흔한 원인은 `route53:ListHostedZones` 누락 — health probe 가 처음 호출하는 액션입니다.
     - hosted zone 을 여러 개 운영 중이고 probe 가 `GetHostedZone` 에서 실패하면 `AWS_HOSTED_ZONE_ID` 를 명시해 zone 을 핀하세요. 그렇지 않으면 미설정으로 두어 자동 탐지가 parent zone 까지 walk-up 하게 합니다.
     - Region 은 무관합니다 — Route53 은 글로벌입니다. `AWS_REGION` 은 SES 에만 영향을 줍니다.
     - Cross-account 시나리오 (A 계정에서 발송, B 계정에서 DNS) 는 단일 IAM 사용자로 지원되지 않습니다 — DNS 를 SES 계정으로 옮기거나 두 개의 MyResend 인스턴스를 따로 운영하세요.
   - **DigitalOcean**: read+write scope 의 `DO_API_TOKEN` 을 재생성합니다. write scope 가 빠진 토큰은 connection check 는 통과해도 `setupDomainDNS` 에서 실패합니다.

4. **도메인 verification 이 "pending" 상태에 머무름**

   - DNS propagation 은 수 분에서 수 시간이 걸릴 수 있습니다. DNS provider 에서 보이는 레코드가 Domains 탭이 생성한 값과 일치하는지 확인합니다.
   - DKIM 토큰은 재시도 시점에 DNS 레코드로 흘러들어옵니다 — 첫 적용 시점에 SES 가 토큰을 아직 반환하지 않아 빠질 수 있습니다.
   - **Route53 한정**: AWS Console 에는 레코드가 보이는데 public 인터넷에서 `dig` 결과가 비어있다면 등록기관이 여전히 이전 nameserver 를 가리키는 것입니다. § 1 (b) 단계의 NS 위임을 다시 확인합니다.

5. **API key 인증 실패**

   - key 를 발급하기 전에 도메인이 검증됐는지 확인합니다.
   - 키 형식: `mrs_<id>_<secret>`.

## 9. 참고

- API 문서: [README.ko.md](./README.ko.md)
- 데이터베이스 스키마: [database.sql](./database.sql)
- 환경 변수 reference: `CLAUDE.md § Environment Configuration`
- 구현 진입점: `src/lib/ses.ts`, `src/lib/dns-provider.ts`, `src/lib/route53.ts`, `src/lib/digitalocean.ts`
