# MyResend - Project Summary

## Overview

MyResend is a self-hosted, Resend-compatible mail gateway. It is built on Next.js 15, delivers email through Amazon SES via the AWS SDK v3 (`@aws-sdk/client-sesv2`), and manages domain DNS records through either DigitalOcean DNS or AWS Route53 — selectable at runtime via the `DNS_PROVIDER` environment variable.

## Architecture

### Backend Services

- **Next.js 15 API Routes** — RESTful endpoints under `src/app/api/`
- **PostgreSQL** — raw `pg` queries against the schema in `database.sql` (no ORM, no migration framework)
- **AWS SDK v3** — SES v2 (`@aws-sdk/client-sesv2`) for sending, Route53 (`@aws-sdk/client-route-53`) for DNS, IAM (`@aws-sdk/client-iam`) where required
- **DNS provider dispatch** — `src/lib/dns-provider.ts` dispatches to DigitalOcean (`src/lib/digitalocean.ts`) or Route53 (`src/lib/route53.ts`)
- **JWT authentication** — admin sessions signed with `NEXTAUTH_SECRET`, plus `mrs_<id>_<secret>` API keys for outbound clients

### Frontend

- **Next.js 15 + React 19** — App Router dashboard (Turbopack in dev)
- **Tailwind CSS v4** — styling
- **TypeScript 5** — strict mode, `tsc --noEmit` 0-error baseline enforced by CI

## File Structure

```
src/
├── app/
│   ├── api/
│   │   ├── auth/           # Authentication endpoints
│   │   ├── domains/        # Domain management
│   │   ├── api-keys/       # API key management
│   │   ├── emails/         # Email sending & logs
│   │   ├── webhooks/       # SES webhook handler
│   │   ├── health/
│   │   │   ├── ses/        # SES health probe (GetAccount)
│   │   │   └── dns/        # DNS provider health probe
│   │   ├── waitlist/       # Waitlist signup endpoints
│   │   ├── stats/          # Stats API
│   │   ├── cron/           # Periodic stats push
│   │   └── setup/          # Initial admin seed
│   ├── login/
│   ├── pricing/
│   ├── layout.tsx          # Root layout with AuthProvider
│   └── page.tsx            # Main app entry
├── components/
│   ├── Dashboard.tsx        # Tab container
│   ├── LandingPage.tsx      # Unauthenticated landing
│   ├── DomainsTab.tsx       # Domain management UI
│   ├── ApiKeysTab.tsx       # API key management UI
│   ├── EmailLogsTab.tsx     # Email logs
│   └── ConnectionsTab.tsx   # SES + DNS health cards
├── contexts/
│   └── AuthContext.tsx
└── lib/
    ├── api.ts               # Frontend API client
    ├── auth.ts              # JWT + bcrypt user auth
    ├── api-keys.ts          # API key issuance / verification
    ├── domains.ts           # Domain operations
    ├── ses.ts               # AWS SES v2 integration
    ├── dns-provider.ts      # DNS provider dispatcher
    ├── digitalocean.ts      # DigitalOcean DNS implementation
    ├── route53.ts           # Route53 DNS implementation
    ├── database.ts          # PostgreSQL client + interfaces
    ├── middleware.ts        # API middleware (JWT verify, etc.)
    └── notifications.ts     # Waitlist / admin notifications
```

## Database Schema

### Tables

- **users** — admin user accounts
- **domains** — email sending domains
- **api_keys** — `mrs_<id>_<secret>` issued per verified domain
- **email_logs** — all sent email records
- **webhook_events** — SES delivery events
- **waitlist_signups** — hosted-version waitlist captures (off by default)

### Key Properties

- UUID primary keys
- Indexed by foreign keys and frequent query paths
- JSON columns for SES response detail
- Schema bootstrap is idempotent — `CREATE TABLE IF NOT EXISTS` throughout. Apply with `psql "$DATABASE_URL" -f database.sql`.

## API Endpoints

### Authentication

- `POST /api/auth/login` — admin login
- `GET /api/auth/me` — current user

### Domain Management

- `GET /api/domains` — list domains
- `POST /api/domains` — add new domain (generates DNS records, dispatches to active DNS provider, registers with SES)
- `DELETE /api/domains/{id}` — remove domain
- `POST /api/domains/{id}/verify` — re-check SES verification status

### API Keys

- `GET /api/api-keys` — list API keys
- `POST /api/api-keys` — create new key (verified domain only)
- `DELETE /api/api-keys/{id}` — delete key

### Email Operations (Resend Compatible)

- `POST /api/emails` — send email
- `GET /api/emails/logs` — email history
- `GET /api/emails/{id}` — email details

### System

- `GET /api/health/ses` — SES health (admin JWT, calls `GetAccount`)
- `GET /api/health/dns` — DNS provider health (admin JWT, calls provider-specific probe)
- `POST /api/setup` — seed admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- `POST /api/webhooks/ses` — SES event ingest

## Key Integrations

### AWS SES (v2)

- Domain identity creation and verification
- DKIM attribute management
- Email sending (`SendEmail` / configuration sets)
- Account health probe (`GetAccount`)
- Webhook event ingestion

### DNS Provider Abstraction

- `DNS_PROVIDER=digitalocean` (default) routes to DigitalOcean's DNS API via axios
- `DNS_PROVIDER=route53` routes to AWS Route53 via the AWS SDK v3
- Each provider implements the same shape (`setupDomainDNS`, `verifyDomainOwnership`, `checkProvider`); the dispatcher is in `src/lib/dns-provider.ts`
- Provider isolation is verified by an integration suite (only one provider's client is exercised per `DNS_PROVIDER` mode)

### PostgreSQL

- Raw `pg` client, no ORM
- Schema changes are made directly in `database.sql` plus the TypeScript interfaces in `src/lib/database.ts`
- Connection string in `DATABASE_URL`

## Security Features

- JWT-based admin authentication (`NEXTAUTH_SECRET`)
- API key hashing (`bcryptjs`)
- Input validation (`zod`)
- Secrets read from environment variables only — `.env.local` and equivalents are git-ignored; `.env.local.example` carries placeholders only

## Deployment Options

MyResend ships with no platform lock-in. Supported deployment options listed in `DEPLOYMENT.md`:

1. **Docker** (Dockerfile included)
2. **Dokku** (git-push deploy)
3. **Coolify / CapRover / other PaaS** (container-aware)
4. **Fly.io**
5. **Vercel**
6. **Kubernetes** (sample manifests in `k8s/` — note: those are scheduled for a follow-up sweep)

## Environment Variables

Essential configuration (see `CLAUDE.md § Environment Configuration` for the full key reference and `.env.local.example` for the template):

- Database: `DATABASE_URL`
- AWS: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- DNS provider: `DNS_PROVIDER`, `DO_API_TOKEN` (DigitalOcean) or `AWS_HOSTED_ZONE_ID` (Route53, optional)
- Security: `NEXTAUTH_SECRET`
- Admin seed: `ADMIN_EMAIL`, `ADMIN_PASSWORD`

## Getting Started

1. **Provision services**: PostgreSQL + AWS SES + (DigitalOcean DNS or Route53)
2. **Configure environment**: `cp .env.local.example .env.local` and fill in the values
3. **Initialize database**: `psql "$DATABASE_URL" -f database.sql`
4. **Install & run**: `npm install && npm run dev`
5. **Seed admin**: `curl -X POST http://localhost:3000/api/setup`
6. **Verify connections**: log in, open the Connections tab — both SES and DNS cards should report `ok: true`
7. **Add domain**: use the Domains tab to add and verify the first domain
8. **Create API key**: generate a `mrs_<id>_<secret>` key for the verified domain
9. **Send email**: use the Resend SDK pointed at your MyResend base URL

## Resend Compatibility

MyResend implements the same API contract as Resend:

```javascript
// Just change the baseURL — everything else works the same
const resend = new Resend("mrs_your-api-key", {
  baseURL: "https://your-my-resend.example.com/api",
});
```

## Future Enhancements

- Email templates
- Campaign management
- Advanced analytics
- Multi-user support
- SMTP relay
- Email scheduling
- Enhanced webhook routing

---

Attribution and the divergence boundary from the upstream project are documented in [NOTICE](./NOTICE).
