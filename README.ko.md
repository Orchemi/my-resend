# my-resend

> 🌐 **언어**: [English](./README.md) · **한국어**

**Resend 호환 API 를 제공하는 self-hosted 오픈소스 메일 게이트웨이.**

my-resend 는 [eibrahim/freeresend](https://github.com/eibrahim/freeresend) (MIT) 의 hard fork 입니다. 출처와 분기 시점은 [NOTICE](./NOTICE) 를 참조하세요. 메일 발송은 Amazon SES (v2 SDK) 를 사용하며, DNS 레코드는 DigitalOcean DNS 또는 AWS Route53 으로 자동 등록할 수 있습니다 — 활성 provider 는 `DNS_PROVIDER` 환경변수로 선택합니다. HTTP API 는 Resend Node.js SDK 와 호환되므로 기존 Resend 사용자는 `RESEND_BASE_URL` 환경변수만 변경하여 이관할 수 있습니다.

## 주요 기능

- 🚀 **Resend SDK 100% 호환** — `RESEND_BASE_URL` 환경변수만 변경하면 애플리케이션 코드 변경 없이 drop-in 교체
- 🏠 **Self-hosted** — 메일 인프라를 직접 통제
- 📧 **Amazon SES 연동 (v2 SDK)** — `SendEmailCommand`, verify 상태와 DKIM 속성을 한 번에 조회하는 통합 identity API
- 🌐 **Pluggable DNS 자동화** — DigitalOcean 또는 AWS Route53, `DNS_PROVIDER` 로 선택. 새 provider 추가는 새 모듈 1개 + switch case 1개로 가능
- 🔐 **DKIM 인증** — DKIM 키 자동 생성과 DNS 레코드 자동 등록
- 🔑 **API key 관리** — 도메인별 다중 `mrs_` prefix API key 발급, bcrypt 해싱 저장
- 📊 **발송 로그** — 모든 발송 건의 전달 상태와 webhook 이벤트 추적
- 🎯 **도메인 verify** — SES 도메인 인증 자동화 + 멱등 재시도
- 🔒 **보안** — JWT 기반 대시보드 인증, bcrypt 비밀번호 해싱, 매개변수화 SQL
- 🩺 **연결 헬스 체크** — 어드민 전용 `Connections` 탭으로 Amazon SES (sandbox 여부, 송신 quota) 와 활성 DNS provider 를 한 번에 진단; read-only, 시크릿 미노출
- 🐳 **컨테이너 친화적** — Dockerfile 포함; Docker / Dokku / Coolify / Fly.io / Kubernetes 등 Node.js 장기 실행 프로세스를 지원하는 모든 호스트에서 동작
- 🧪 **테스트** — Jest 단위 + 통합 테스트로 SES, DNS provider, Route53 surface 검증 (`aws-sdk-client-mock` 사용, CI 에서 라이브 AWS 호출 없음)

## 빠른 시작

### 사전 요구사항

- Node.js 20 이상
- PostgreSQL 데이터베이스 (로컬 또는 호스팅)
- 발송 region 에서 SES 사용이 가능한 AWS 계정
- DNS 자동화용 **DigitalOcean** 또는 **AWS Route53** 계정 (선택사항 — 수동 DNS 레코드 생성도 가능)

### 설치

1. **클론 및 의존성 설치:**

```bash
git clone https://github.com/Orchemi/my-resend.git
cd my-resend
npm install
```

2. **환경변수 설정:**

```bash
cp .env.local.example .env.local
```

`.env.local` 편집:

```env
# Next.js
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-super-secret-jwt-key-here

# 데이터베이스 (PostgreSQL)
DATABASE_URL=postgresql://username:password@hostname:port/database

# AWS SES
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key

# DNS provider 선택 (기본값: digitalocean)
DNS_PROVIDER=digitalocean

# DigitalOcean DNS (DNS_PROVIDER=digitalocean 일 때 필수)
DO_API_TOKEN=your-digitalocean-api-token

# AWS Route53 (DNS_PROVIDER=route53). AWS_HOSTED_ZONE_ID 는 선택입니다 —
# 미설정 시 발송 도메인으로부터 ListHostedZonesByName 을 통해 hosted zone 을
# 자동 탐지하며, 서브도메인은 parent zone 까지 walk-up 합니다.
# AWS_HOSTED_ZONE_ID=Z0123456789ABCDEFGHIJ

# 관리자
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=your-secure-admin-password
```

3. **데이터베이스 초기화:**

PostgreSQL 인스턴스에 `database.sql` 스키마를 적용합니다:

```bash
psql "$DATABASE_URL" -f database.sql
```

4. **개발 서버 시작:**

```bash
npm run dev
```

`http://localhost:3000` 에 접속하여 관리자 계정으로 로그인합니다.

## AWS SES 셋업

1. **AWS SES 계정 verify:**
   - 발송 region 의 AWS SES 콘솔을 엽니다
   - verify 되지 않은 수신자에게도 발송하려면 production access 를 신청합니다

2. **SES v2 권한이 부여된 IAM user 생성:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:CreateEmailIdentity",
        "ses:GetEmailIdentity",
        "ses:DeleteEmailIdentity",
        "ses:PutEmailIdentityDkimAttributes",
        "ses:CreateConfigurationSet"
      ],
      "Resource": "*"
    }
  ]
}
```

> **참고**: my-resend 는 SES v2 API (`@aws-sdk/client-sesv2`) 를 사용합니다. 위 액션은 레거시 v1 액션 (`ses:VerifyDomainIdentity` / `ses:GetIdentityVerificationAttributes` / `ses:VerifyDomainDkim` / `ses:GetIdentityDkimAttributes`) 의 v2 대응입니다.

## DNS Provider 셋업

발송 도메인을 호스팅하는 provider 를 선택합니다. 활성 provider 는 `DNS_PROVIDER` 로 결정되며, 기본값은 upstream fork 와의 backward compatibility 를 위해 `digitalocean` 입니다. `DNS_PROVIDER` 가 알 수 없는 값이면 startup 시 throw — 오타가 silent 로 default 에 폴백되는 것을 방지합니다.

### 옵션 A — DigitalOcean DNS

1. **Domains** 와 **Domain Records** 에 대한 **Read & Write** 권한이 있는 DigitalOcean API 토큰을 생성합니다
2. 발송 도메인이 DigitalOcean DNS 관리에 등록되어 있는지 확인합니다
3. 환경변수 설정:
   ```env
   DNS_PROVIDER=digitalocean
   DO_API_TOKEN=your-digitalocean-api-token
   ```

### 옵션 B — AWS Route53

1. 발송 도메인의 hosted zone 을 생성하거나 기존 zone 을 선택합니다
2. 동일 IAM user (또는 별도 user) 에 Route53 statement 를 추가합니다.
   `route53:ListHostedZonesByName` 을 포함하면 발송 도메인으로부터
   hosted zone 을 자동 탐지할 수 있습니다 (다중 zone 을 자동 탐지하려면
   `Resource` 를 `*` 로 넓힐 수 있음):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "route53:GetHostedZone",
           "route53:ListHostedZonesByName",
           "route53:ListResourceRecordSets",
           "route53:ChangeResourceRecordSets"
         ],
         "Resource": "arn:aws:route53:::hostedzone/Z0123456789ABCDEFGHIJ"
       }
     ]
   }
   ```
3. 환경변수 설정:
   ```env
   DNS_PROVIDER=route53
   # AWS_HOSTED_ZONE_ID 는 선택입니다 — 미설정 시 발송 도메인으로부터
   # ListHostedZonesByName 을 통해 hosted zone 을 자동 탐지합니다
   # (서브도메인은 parent zone 까지 walk-up — 예: mail.example.com 은
   # example.com zone 으로 매칭).
   AWS_HOSTED_ZONE_ID=Z0123456789ABCDEFGHIJ
   # AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY 는 SES 와 공유
   ```

어느 provider 도 설정되지 않은 경우, my-resend 는 DNS 레코드를 생성하여 대시보드에 표시하므로 수동으로 등록할 수 있습니다.

## Resend SDK 와 함께 사용하기

my-resend 는 [Resend Node.js SDK](https://github.com/resend/resend-node) 와 **100% 호환**됩니다.

### 방법 1: 환경변수 (권장)

`RESEND_BASE_URL` 환경변수를 설정합니다:

```bash
export RESEND_BASE_URL="https://your-my-resend-domain.com/api"
```

이후 Resend SDK 를 평소처럼 사용하면 됩니다:

```javascript
import { Resend } from "resend";

// 코드 변경 없음 — my-resend API key 가 Resend SDK 에서 동작합니다
const resend = new Resend("your-my-resend-api-key");

const { data, error } = await resend.emails.send({
  from: "onboarding@yourdomain.com",
  to: ["user@example.com"],
  subject: "Hello World",
  html: "<strong>it works!</strong>",
});
```

### 방법 2: 직접 API 호출

```javascript
const response = await fetch("https://your-my-resend-domain.com/api/emails", {
  method: "POST",
  headers: {
    Authorization: "Bearer your-my-resend-api-key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: "onboarding@yourdomain.com",
    to: ["user@example.com"],
    subject: "Hello World",
    html: "<strong>it works!</strong>",
  }),
});
```

## API 엔드포인트

### 인증

- `POST /api/auth/login` — 이메일/비밀번호 로그인
- `GET /api/auth/me` — 현재 사용자 정보 조회

### 도메인

- `GET /api/domains` — 모든 도메인 목록
- `POST /api/domains` — 새 도메인 추가 (활성 provider 로 SES verify + DNS 레코드 생성을 시작)
- `DELETE /api/domains/{id}` — 도메인 삭제
- `POST /api/domains/{id}/verify` — SES verify 상태 재확인
- `POST /api/domains/{id}/retry-dns` — 활성 provider 로 DNS 레코드 재적용

### API key

- `GET /api/api-keys` — API key 목록
- `POST /api/api-keys` — 새 API key 생성
- `DELETE /api/api-keys/{id}` — API key 삭제

### 메일 (Resend 호환)

- `POST /api/emails` — 메일 발송
- `GET /api/emails/logs` — 발송 로그 조회
- `GET /api/emails/{id}` — 특정 메일 조회

### Webhook

- `POST /api/webhooks/ses` — SES webhook 엔드포인트 (delivery / bounce / complaint 이벤트)

## 도메인 셋업 절차

1. my-resend 대시보드에서 **도메인을 추가**합니다
2. **DNS 레코드** 가 생성되며, DNS provider 가 설정되어 있으면 자동 적용되고 그렇지 않으면 수동 등록용으로 표시됩니다:
   - **TXT 레코드** — `_amazonses.yourdomain.com` (SES 도메인 verify)
   - **MX 레코드** — `yourdomain.com` (SES 통한 메일 수신)
   - **SPF 레코드** — `yourdomain.com` (sender policy framework)
   - **DMARC 레코드** — `_dmarc.yourdomain.com` (이메일 인증 정책)
   - **DKIM 레코드** — `*._domainkey.yourdomain.com` 의 CNAME 3개 (이메일 서명)
3. **도메인 verify** — DNS 레코드가 propagate 되면 "Check Verification" 버튼을 클릭합니다 (백그라운드 polling 도 동시 진행)
4. **API key 생성** — verify 된 도메인에 대해 API key 를 발급합니다
5. **발송 시작** — my-resend 또는 Resend SDK 로 API key 를 사용해 메일을 발송합니다

## 셋업 테스트

본 프로젝트는 Jest 테스트 스위트를 포함합니다. 단위 + 통합 수준의 테스트만 있으며, 라이브 AWS / DigitalOcean 엔드포인트를 호출하지 않습니다 (`aws-sdk-client-mock` 과 `jest.mock("axios", ...)` 으로 클라이언트를 mock 처리).

```bash
npm test                    # 전체 테스트 실행
npm run test:watch          # 변경 시 재실행
npm run test:coverage       # 커버리지 리포트
```

`src/lib/__tests__/domains-dns-integration.test.ts` 의 통합 테스트는 provider 격리를 검증합니다: `DNS_PROVIDER=digitalocean` 일 때 axios 클라이언트만 호출되고, `DNS_PROVIDER=route53` 일 때 Route53 클라이언트만 호출되며, 다른 provider 의 SDK 는 호출 0회임을 단언합니다.

실제 AWS 에 대한 end-to-end 검증은 도메인 verify 완료 후 대시보드에서 테스트 메일을 발송하여 수행합니다.

## 트러블슈팅

**Q: "Invalid API key" 에러가 발생합니다**

- ✅ 녹색 success 메시지에 표시된 **전체 API key** 를 복사했는지 확인하세요 (테이블의 마스킹된 버전 X)
- ✅ API key 형식: `mrs_keyId_secretPart` (밑줄로 구분된 3 부분)

**Q: `DNS_PROVIDER` 가 startup 시 throw 합니다**

- ✅ 허용 값은 `digitalocean` 과 `route53` 입니다. 알 수 없는 값은 의도적으로 거부되어 오타가 silent 로 default 에 폴백되는 것을 방지합니다
- ✅ 변수를 설정하지 않으면 `digitalocean` (default) 으로 동작합니다

**Q: DigitalOcean DNS 자동화가 동작하지 않습니다**

- ✅ DO API 토큰이 **Domains** 와 **Domain Records** 에 대해 **Read & Write** 권한을 가졌는지 확인하세요
- ✅ 도메인이 DigitalOcean DNS 관리에 등록되어 있는지 확인하세요
- ✅ 토큰 테스트: `curl -H "Authorization: Bearer YOUR_TOKEN" https://api.digitalocean.com/v2/domains`

**Q: Route53 DNS 자동화가 동작하지 않습니다**

- ✅ `AWS_HOSTED_ZONE_ID` 는 선택입니다 — 미설정 시 발송 도메인으로부터 `ListHostedZonesByName` 을 통해 hosted zone 을 자동 탐지합니다 (서브도메인은 parent zone 까지 walk-up). `verifyDomainOwnership` 는 `false` 를 반환하고 `setupDomainDNS` 는 계정에 매칭되는 hosted zone 이 전혀 없을 때만 throw 합니다
- ✅ IAM user 가 `route53:GetHostedZone`, `route53:ListHostedZonesByName`, `route53:ListResourceRecordSets`, `route53:ChangeResourceRecordSets` 권한을 가져야 합니다
- ✅ 자동 탐지 테스트: `aws route53 list-hosted-zones-by-name --dns-name yourdomain.com.`
- ✅ zone 테스트: `aws route53 get-hosted-zone --id YOUR_HOSTED_ZONE_ID`

**Q: 도메인 verify 가 "pending" 에서 멈춰있습니다**

- ✅ DNS propagation 은 보통 5-30분이 소요됩니다
- ✅ 레코드 확인: `dig TXT _amazonses.yourdomain.com` / `dig CNAME tok1._domainkey.yourdomain.com`
- ✅ 모든 DKIM CNAME (3개) 와 SES verify TXT 가 가시 상태인지 확인하세요

**Q: AWS SES 권한 에러가 발생합니다**

- ✅ IAM 정책에 위 SES 셋업 섹션의 SES **v2** 액션이 포함되어 있어야 합니다
- ✅ 발송 region 에서 AWS 계정이 SES sandbox 모드를 벗어났는지 확인하세요

**Q: Resend SDK 가 my-resend 와 동작하지 않습니다**

- ✅ 호출 앱의 환경에서 `RESEND_BASE_URL="https://your-my-resend-domain.com/api"` 를 설정하세요
- ✅ Resend API key 가 아닌 my-resend API key (`mrs_` 로 시작) 를 사용하세요

## 프로덕션 배포

본 프로젝트는 포함된 `Dockerfile` 로 컨테이너 친화적입니다. Node.js 장기 실행 프로세스를 지원하는 모든 플랫폼에서 동작합니다:

- **컨테이너 PaaS**: Docker, Dokku, Coolify, Fly.io, Railway
- **Kubernetes**: 샘플 매니페스트는 `k8s/` 하위에 있습니다 (stats 리포팅 cron job, deployment, ingress, HPA, namespace, services)
- **관리형 Node.js 호스팅**: Vercel, Render, Netlify (서버리스 플랫폼에서는 webhook 엔드포인트가 추가 설정을 필요로 할 수 있음)

핵심 프로덕션 요구사항:

- 관리형 또는 self-hosted PostgreSQL 인스턴스
- 발송 region 에서 SES sandbox 모드를 벗어난 AWS 계정
- HTTPS 용 SSL 인증서
- 환경변수 설정 (빠른 시작 섹션 참조)
- `database.sql` 로 데이터베이스 스키마 초기화

## 개발

```bash
# 의존성 설치
npm install

# 개발 서버 시작 (Turbopack)
npm run dev

# 프로덕션 빌드
npm run build

# 프로덕션 서버 시작
npm start

# Lint
npm run lint

# 테스트 (단위 + 통합)
npm test
```

## 저장소 구조

```
my-resend/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/                      # API 라우트
│   │   │   ├── auth/                 # 인증 엔드포인트
│   │   │   ├── domains/              # 도메인 관리
│   │   │   ├── api-keys/             # API key 관리
│   │   │   ├── emails/               # 메일 발송 + 로그
│   │   │   └── webhooks/             # SES webhook 핸들러
│   │   ├── globals.css               # 전역 스타일
│   │   ├── layout.tsx                # 루트 layout
│   │   └── page.tsx                  # 메인 대시보드 페이지
│   ├── components/                   # React 컴포넌트
│   │   ├── Dashboard.tsx             # 메인 대시보드
│   │   ├── LoginForm.tsx             # 인증
│   │   └── *Tab.tsx                  # 탭 컴포넌트
│   ├── contexts/                     # React 컨텍스트
│   └── lib/                          # 핵심 비즈니스 로직
│       ├── database.ts               # PostgreSQL 연결 풀 + 헬퍼
│       ├── auth.ts                   # JWT 인증
│       ├── ses.ts                    # AWS SES v2 wrapper
│       ├── dns-provider.ts           # DNS provider 추상화 (DNS_PROVIDER 디스패치)
│       ├── digitalocean.ts           # DigitalOcean DNS provider
│       ├── route53.ts                # AWS Route53 DNS provider
│       ├── domains.ts                # 도메인 관리 비즈니스 로직
│       ├── api-keys.ts               # API key 로직
│       ├── middleware.ts             # API 미들웨어 (auth helper)
│       └── __tests__/                # Jest 단위 + 통합 테스트
├── docs/
│   └── plan/                         # 설계 / 변경 추적 문서
├── k8s/                              # Kubernetes 매니페스트
├── database.sql                      # PostgreSQL 스키마 (최초 배포 시 1회 적용)
├── docker-compose.yml                # 로컬 개발 스택
├── Dockerfile                        # 프로덕션 이미지
├── jest.config.js                    # Jest 설정
├── NOTICE                            # fork attribution + divergence 요약
└── README.md                         # 영문 README
```

## 기여

기여를 환영합니다.

### 개발 셋업

1. GitHub 에서 저장소를 fork 합니다
2. fork 를 클론합니다: `git clone https://github.com/<your-username>/my-resend.git`
3. 의존성을 설치합니다: `npm install`
4. 빠른 시작 섹션을 따라 환경을 셋업합니다
5. 테스트 스위트를 실행합니다: `npm test`
6. 개발 서버를 시작합니다: `npm run dev`

### 기여 가이드라인

- 🐛 **버그 수정** — 회귀 테스트와 함께 항상 환영
- ✨ **새 기능** — 먼저 issue 를 열어 논의하세요
- 📝 **문서** — 개선은 항상 환영. 영문 README 가 source of truth 이며, 영문 변경 시 `README.ko.md` 를 동기화하여 parity 를 유지해주세요
- 🧪 **테스트** — 새 기능에는 필수. 외부 SDK 는 mock 처리하고, CI 에서 라이브 AWS / DO 호출 금지
- 💻 **코드 스타일** — 기존 패턴을 따르세요. ESLint 와 TypeScript strict mode 통과 필수

### Pull Request 절차

1. feature 브랜치 생성: `git checkout -b feat/short-description`
2. 명확하고 서술적인 커밋으로 변경합니다
3. 테스트를 추가하거나 갱신합니다
4. 사용자 노출 동작이 변경됐다면 문서를 갱신합니다
5. 변경 내용과 근거를 명확히 설명한 PR 을 제출합니다

### 이슈 보고

버그 보고 시 다음 정보를 포함해주세요:

- 환경 (Node.js 버전, OS, 호스팅 플랫폼)
- 재현 절차
- 기대 동작 vs 실제 동작
- 관련 에러 메시지 또는 로그

## 라이선스

MIT — 전문은 [LICENSE](./LICENSE) 를 참조하세요. 원작자의 copyright 는 그대로 보존되며, my-resend 의 추가 기여분은 별도로 표시되어 있습니다.

## 지원

- 📖 **문서**: `docs/` 디렉토리 + 본 README
- 🐛 **이슈**: [GitHub Issues](https://github.com/Orchemi/my-resend/issues) 로 버그 보고
- 💡 **기능 제안**: 사용 사례를 포함하여 GitHub Issue 를 열어주세요

## 로드맵

- [ ] 메일 템플릿 지원
- [ ] Webhook retry 메커니즘
- [ ] 메일 분석 대시보드
- [ ] 다중 사용자 지원
- [ ] 메일 스케줄링
- [ ] SMTP 서버 지원
- [ ] 메일 캠페인 관리
- [ ] Cloudflare DNS provider (`DNS_PROVIDER` 의 세 번째 옵션)
- [x] Route53 hosted-zone 자동 탐지 (`AWS_HOSTED_ZONE_ID` 환경변수 생략)
