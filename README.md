# my-resend

> 🌐 **Languages**: **English** · [한국어](./README.ko.md)

**A self-hosted, open-source mail gateway with a Resend-compatible API.**

my-resend is a hard fork of [eibrahim/freeresend](https://github.com/eibrahim/freeresend) (MIT). See [NOTICE](./NOTICE) for full attribution and the divergence point. Emails are delivered through Amazon SES (via the v2 SDK), and DNS records can be managed automatically through DigitalOcean DNS or AWS Route53 — selectable at runtime via the `DNS_PROVIDER` environment variable. The HTTP API is compatible with the Resend Node.js SDK, so existing Resend users can migrate by setting `RESEND_BASE_URL` only.

## Features

- 🚀 **100% Resend-compatible** — drop-in replacement using the `RESEND_BASE_URL` environment variable; no application code change
- 🏠 **Self-hosted** — full control over your email infrastructure
- 📧 **Amazon SES integration (v2 SDK)** — `SendEmailCommand`, identity management with combined verification + DKIM status
- 🌐 **Pluggable DNS automation** — DigitalOcean or AWS Route53, selected by the `DNS_PROVIDER` env var. Adding a new provider takes one new module + one switch case
- 🔐 **DKIM authentication** — automatic DKIM key generation and DNS record creation
- 🔑 **API key management** — multiple `mrs_`-prefixed API keys per domain, bcrypt-hashed at rest
- 📊 **Email logging** — every send tracked with delivery status and webhook events
- 🎯 **Domain verification** — automated SES domain verification with idempotent retries
- 🔒 **Secure** — JWT-based dashboard auth, bcrypt password hashing, parameterised SQL
- 🐳 **Container-friendly** — Dockerfile included; runs on Docker, Dokku, Coolify, Fly.io, Kubernetes, or any host that runs a long-lived Node.js process
- 🧪 **Tested** — Jest unit + integration suite covering the SES, DNS provider, and Route53 surfaces using `aws-sdk-client-mock` (no live AWS calls in CI)

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL database (local or hosted)
- An AWS account with SES access in your sending region
- A DNS automation account on **either** DigitalOcean **or** AWS Route53 (optional — you can also create DNS records manually)

### Installation

1. **Clone and install dependencies:**

```bash
git clone https://github.com/Orchemi/my-resend.git
cd my-resend
npm install
```

2. **Set up environment variables:**

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
# Next.js
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-super-secret-jwt-key-here

# Database (PostgreSQL)
DATABASE_URL=postgresql://username:password@hostname:port/database

# AWS SES
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key

# DNS provider selection (default: digitalocean)
DNS_PROVIDER=digitalocean

# DigitalOcean DNS (required when DNS_PROVIDER=digitalocean)
DO_API_TOKEN=your-digitalocean-api-token

# AWS Route53 (required when DNS_PROVIDER=route53)
# AWS_HOSTED_ZONE_ID=Z0123456789ABCDEFGHIJ

# Admin
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=your-secure-admin-password
```

3. **Initialise the database:**

Apply the schema in `database.sql` against your PostgreSQL instance:

```bash
psql "$DATABASE_URL" -f database.sql
```

4. **Start the development server:**

```bash
npm run dev
```

Visit `http://localhost:3000` and log in with your admin credentials.

## AWS SES Setup

1. **Verify your AWS account for SES:**
   - Open the AWS SES console for your sending region
   - Request production access if you need to send to unverified recipients

2. **Create an IAM user with SES v2 permissions:**

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

> **Note**: my-resend uses the SES v2 API (`@aws-sdk/client-sesv2`). The actions above are the v2 equivalents of the legacy `ses:VerifyDomainIdentity` / `ses:GetIdentityVerificationAttributes` / `ses:VerifyDomainDkim` / `ses:GetIdentityDkimAttributes` set.

## DNS Provider Setup

Pick whichever provider hosts your sending domain. The active provider is chosen by `DNS_PROVIDER`; default is `digitalocean` for backward compatibility with the upstream fork. Setting `DNS_PROVIDER` to an unknown value throws on startup so a typo can't silently fall back to the wrong provider.

### Option A — DigitalOcean DNS

1. Create a DigitalOcean API token with **Read & Write** access to **Domains** and **Domain Records**
2. Make sure each sending domain is listed under DigitalOcean DNS management
3. Set environment variables:
   ```env
   DNS_PROVIDER=digitalocean
   DO_API_TOKEN=your-digitalocean-api-token
   ```

### Option B — AWS Route53

1. Create or pick an existing hosted zone for your sending domain
2. Attach a Route53 statement to the same IAM user (or a separate one):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "route53:GetHostedZone",
           "route53:ListResourceRecordSets",
           "route53:ChangeResourceRecordSets"
         ],
         "Resource": "arn:aws:route53:::hostedzone/Z0123456789ABCDEFGHIJ"
       }
     ]
   }
   ```
3. Set environment variables:
   ```env
   DNS_PROVIDER=route53
   AWS_HOSTED_ZONE_ID=Z0123456789ABCDEFGHIJ
   # AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are shared with SES
   ```

If neither provider is configured, my-resend will still generate the DNS records and display them in the dashboard for manual setup.

## Using MyResend with the Resend SDK

my-resend is **100% compatible** with the [Resend Node.js SDK](https://github.com/resend/resend-node).

### Method 1: Environment Variable (recommended)

Set the `RESEND_BASE_URL` environment variable:

```bash
export RESEND_BASE_URL="https://your-my-resend-domain.com/api"
```

Then use the Resend SDK exactly as before:

```javascript
import { Resend } from "resend";

// No code changes — your my-resend API key works with the Resend SDK
const resend = new Resend("your-my-resend-api-key");

const { data, error } = await resend.emails.send({
  from: "onboarding@yourdomain.com",
  to: ["user@example.com"],
  subject: "Hello World",
  html: "<strong>it works!</strong>",
});
```

### Method 2: Direct API

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

## API Endpoints

### Authentication

- `POST /api/auth/login` — login with email/password
- `GET /api/auth/me` — get current user info

### Domains

- `GET /api/domains` — list all domains
- `POST /api/domains` — add a new domain (kicks off SES verify + DNS record creation via the active provider)
- `DELETE /api/domains/{id}` — delete a domain
- `POST /api/domains/{id}/verify` — re-check SES verification status
- `POST /api/domains/{id}/retry-dns` — re-apply DNS records via the active provider

### API Keys

- `GET /api/api-keys` — list API keys
- `POST /api/api-keys` — create a new API key
- `DELETE /api/api-keys/{id}` — delete an API key

### Emails (Resend-compatible)

- `POST /api/emails` — send email
- `GET /api/emails/logs` — list email logs
- `GET /api/emails/{id}` — get a specific email

### Webhooks

- `POST /api/webhooks/ses` — SES webhook endpoint (delivery, bounce, complaint events)

## Domain Setup Process

1. **Add a domain** in the my-resend dashboard
2. **DNS records** are generated and either applied automatically (if a DNS provider is configured) or displayed for manual setup:
   - **TXT record** — `_amazonses.yourdomain.com` for SES domain verification
   - **MX record** — `yourdomain.com` for receiving emails via SES
   - **SPF record** — `yourdomain.com` for sender policy framework
   - **DMARC record** — `_dmarc.yourdomain.com` for email authentication policy
   - **DKIM records** — three CNAME records under `*._domainkey.yourdomain.com` for email signing
3. **Verify the domain** — click "Check Verification" once DNS records are live; SES verification is polled in the background as well
4. **Create an API key** — generate keys for verified domains
5. **Start sending** — use the API key with my-resend or the Resend SDK

## Testing Your Setup

The project ships with a Jest suite. Tests are unit + integration level only — they do not hit live AWS / DigitalOcean endpoints (clients are mocked via `aws-sdk-client-mock` and `jest.mock("axios", ...)`).

```bash
npm test                    # run all tests
npm run test:watch          # re-run on change
npm run test:coverage       # coverage report
```

The integration suite under `src/lib/__tests__/domains-dns-integration.test.ts` verifies provider isolation: with `DNS_PROVIDER=digitalocean` only the axios client is exercised, with `DNS_PROVIDER=route53` only the Route53 client is. The other provider's SDK is asserted to receive zero calls.

For end-to-end verification against real AWS, send a test email from the dashboard once the domain is verified.

## Troubleshooting

**Q: Getting "Invalid API key" errors**

- ✅ Make sure you copied the **complete API key** from the green success message (not the masked version from the table)
- ✅ API keys have format `mrs_keyId_secretPart` (three parts separated by underscores)

**Q: `DNS_PROVIDER` throws at startup**

- ✅ Allowed values are `digitalocean` and `route53`. Unknown values are rejected on purpose so a typo can't silently fall back to the default
- ✅ Leave the variable unset to use `digitalocean` (default)

**Q: DigitalOcean DNS automation not working**

- ✅ Verify your DO API token has **Read & Write** access to **Domains** and **Domain Records**
- ✅ Ensure your domain is added to DigitalOcean's DNS management
- ✅ Test the token: `curl -H "Authorization: Bearer YOUR_TOKEN" https://api.digitalocean.com/v2/domains`

**Q: Route53 DNS automation not working**

- ✅ Make sure `AWS_HOSTED_ZONE_ID` is set; `verifyDomainOwnership` returns `false` and `setupDomainDNS` throws when it is missing
- ✅ The IAM user needs `route53:GetHostedZone`, `route53:ListResourceRecordSets`, and `route53:ChangeResourceRecordSets`
- ✅ Test the zone: `aws route53 get-hosted-zone --id YOUR_HOSTED_ZONE_ID`

**Q: Domain verification stuck at "pending"**

- ✅ DNS propagation typically takes 5–30 minutes
- ✅ Check the records: `dig TXT _amazonses.yourdomain.com` / `dig CNAME tok1._domainkey.yourdomain.com`
- ✅ Make sure all DNKIM CNAMEs (3) plus the SES verification TXT are visible

**Q: AWS SES permissions error**

- ✅ The IAM policy must include the SES **v2** actions listed in the SES setup section above
- ✅ Verify your AWS account is out of SES sandbox mode for the sending region

**Q: Resend SDK not working with my-resend**

- ✅ Set `RESEND_BASE_URL="https://your-my-resend-domain.com/api"` in the calling app's environment
- ✅ Use a my-resend API key (starts with `mrs_`), not a Resend API key

## Production Deployment

The project is container-friendly via the included `Dockerfile`. It runs on any platform that supports a long-lived Node.js process:

- **Container PaaS**: Docker, Dokku, Coolify, Fly.io, Railway
- **Kubernetes**: sample manifests live under `k8s/` (cron job for stats reporting, deployment, ingress, HPA, namespace, services)
- **Managed Node.js hosting**: Vercel, Render, Netlify (note that webhook endpoints may need extra configuration on serverless platforms)

Key production requirements:

- A managed or self-hosted PostgreSQL instance
- AWS SES out of sandbox mode for the sending region
- SSL certificates for HTTPS
- Environment variables configured (see Quick Start)
- Database schema initialised via `database.sql`

## Development

```bash
# Install dependencies
npm install

# Start development server (Turbopack)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint
npm run lint

# Test (unit + integration)
npm test
```

## Repository Structure

```
my-resend/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── api/                      # API routes
│   │   │   ├── auth/                 # authentication endpoints
│   │   │   ├── domains/              # domain management
│   │   │   ├── api-keys/             # API key management
│   │   │   ├── emails/               # email send + logs
│   │   │   └── webhooks/             # SES webhook handlers
│   │   ├── globals.css               # global styles
│   │   ├── layout.tsx                # root layout
│   │   └── page.tsx                  # main dashboard page
│   ├── components/                   # React components
│   │   ├── Dashboard.tsx             # main dashboard
│   │   ├── LoginForm.tsx             # authentication
│   │   └── *Tab.tsx                  # tab components
│   ├── contexts/                     # React contexts
│   └── lib/                          # core business logic
│       ├── database.ts               # PostgreSQL connection pool + helpers
│       ├── auth.ts                   # JWT authentication
│       ├── ses.ts                    # AWS SES v2 wrapper
│       ├── dns-provider.ts           # DNS provider abstraction (DNS_PROVIDER dispatch)
│       ├── digitalocean.ts           # DigitalOcean DNS provider
│       ├── route53.ts                # AWS Route53 DNS provider
│       ├── domains.ts                # domain management business logic
│       ├── api-keys.ts               # API key logic
│       ├── middleware.ts             # API middleware (auth helpers)
│       └── __tests__/                # Jest unit + integration tests
├── docs/
│   └── plan/                         # design / change-tracking documents
├── k8s/                              # Kubernetes manifests
├── database.sql                      # PostgreSQL schema (apply once on first deploy)
├── docker-compose.yml                # local dev stack
├── Dockerfile                        # production image
├── jest.config.js                    # Jest configuration
├── NOTICE                            # fork attribution + divergence summary
└── README.md                         # this file
```

## Contributing

Contributions are welcome.

### Development Setup

1. Fork the repository on GitHub
2. Clone your fork: `git clone https://github.com/<your-username>/my-resend.git`
3. Install dependencies: `npm install`
4. Set up environment following the Quick Start
5. Run the test suite: `npm test`
6. Start the dev server: `npm run dev`

### Contributing Guidelines

- 🐛 **Bug fixes** — always welcome with regression tests
- ✨ **New features** — open an issue first to discuss
- 📝 **Documentation** — improvements always appreciated; English README is the source of truth, please update `README.ko.md` to keep parity if you change English
- 🧪 **Tests** — required for new features; mock external SDKs, never hit live AWS / DO from CI
- 💻 **Code style** — follow existing patterns; ESLint and TypeScript strict mode must pass

### Pull Request Process

1. Create a feature branch: `git checkout -b feat/short-description`
2. Make your changes with clear, descriptive commits
3. Add or update tests
4. Update documentation if user-facing behaviour changed
5. Submit a pull request with a clear description of the change and the rationale

### Reporting Issues

When reporting bugs, please include:

- Your environment (Node.js version, OS, hosting platform)
- Steps to reproduce
- Expected vs actual behaviour
- Relevant error messages or logs

## License

MIT — see [LICENSE](./LICENSE) for the full text. The original author's copyright is preserved; my-resend's additions are listed alongside.

## Support

- 📖 **Documentation**: `docs/` directory + this README
- 🐛 **Issues**: report bugs via [GitHub Issues](https://github.com/Orchemi/my-resend/issues)
- 💡 **Feature requests**: open a GitHub Issue with the use case

## Roadmap

- [ ] Email templates support
- [ ] Webhook retry mechanism
- [ ] Email analytics dashboard
- [ ] Multi-user support
- [ ] Email scheduling
- [ ] SMTP server support
- [ ] Email campaign management
- [ ] Cloudflare DNS provider (third option behind `DNS_PROVIDER`)
- [ ] Hosted-zone auto-discovery for Route53 (skip the explicit `AWS_HOSTED_ZONE_ID` env)
