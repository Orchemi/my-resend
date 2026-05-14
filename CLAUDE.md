# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MyResend is a self-hosted, open-source mail gateway with a Resend-compatible API. It uses Amazon SES as the delivery backend and supports automatic DNS record management through either DigitalOcean DNS or AWS Route53 (selectable at runtime via `DNS_PROVIDER`).

The project is a hard fork of [eibrahim/freeresend](https://github.com/eibrahim/freeresend) (MIT). Attribution and the divergence boundary are documented in `NOTICE`.

**Key Technologies:**
- Next.js 15 (App Router, Turbopack dev)
- React 19 + TypeScript 5
- PostgreSQL (direct connection via `pg`, no ORM)
- AWS SES v2 SDK (`@aws-sdk/client-sesv2`)
- AWS Route53 SDK (`@aws-sdk/client-route-53`) — optional DNS provider
- DigitalOcean API (axios) — optional DNS provider
- Tailwind CSS v4
- JWT authentication, bcryptjs for password hashing
- Jest + ts-jest + `aws-sdk-client-mock` for unit tests

## Development Commands

```bash
# Development
npm run dev         # Start development server with Turbopack

# Production
npm run build       # Build for production
npm start           # Start production server

# Code Quality
npm run lint        # Run ESLint (next/core-web-vitals)
npm run typecheck   # Run tsc --noEmit (strict typecheck, used as a CI gate)

# Testing (Jest)
npm test            # Run all unit + integration tests
npm run test:watch  # Re-run on change
npm run test:coverage
```

CI runs `lint`, `typecheck`, `test`, and `build` on every pull request and on pushes to `develop` / `production` (`.github/workflows/ci.yml`). The `tsc --noEmit` baseline must stay at zero errors.

The Jest suite under `src/lib/__tests__/` and `src/components/__tests__/` is the source of truth for verification. External SDK calls (AWS, axios) are mocked — the suite never hits real endpoints.

## Architecture Overview

### Core Structure
- **API Layer**: Next.js App Router API routes (`src/app/api/`)
- **Business Logic**: Modular libraries in `src/lib/`
- **DNS Provider Abstraction**: `src/lib/dns-provider.ts` (dispatched by `DNS_PROVIDER`)
- **Database**: Direct PostgreSQL via `pg` connection pool
- **Frontend**: React dashboard components in `src/components/`

### Database Architecture
The project uses **direct PostgreSQL** (no ORM, no Supabase) with:
- Connection pooling via the `pg` package
- Transaction support
- Auto-updating timestamps via triggers
- UUID primary keys
- JSONB fields for flexible data (DNS records, email arrays)

**Key Tables:**
- `users` — admin user accounts
- `domains` — email sending domains with SES integration
- `api_keys` — API authentication keys (bcrypt-hashed)
- `email_logs` — all sent email records with delivery status
- `webhook_events` — SES delivery event processing

The schema lives in `database.sql`; there is no migration framework — apply once on first deploy.

### Integration Architecture

**Amazon SES** (`src/lib/ses.ts`):
- v2 SDK (`@aws-sdk/client-sesv2`) — `SendEmailCommand`, `CreateEmailIdentityCommand`, `GetEmailIdentityCommand`, `PutEmailIdentityDkimAttributesCommand`, `DeleteEmailIdentityCommand`, `CreateConfigurationSetCommand`
- External function signatures preserve the v1-era return shapes so consumers (`domains.ts`, API routes) stay provider-detail-free
- `verifyDomain` swallows `AlreadyExistsException` and falls through to `GetEmailIdentity` to keep idempotency

**DNS Provider Abstraction** (`src/lib/dns-provider.ts`):
- Selected at runtime by `DNS_PROVIDER` (`digitalocean` | `route53`, default `digitalocean`)
- Exposes `setupDomainDNS(domain, dnsRecords)` and `verifyDomainOwnership(domain)`
- Normalises every provider's native record shape to `DnsProviderRecord { type, name, value, ttl }` so consumers stay provider-agnostic
- Unknown `DNS_PROVIDER` values throw (fail-fast) — silent fallback would mask typos

**DigitalOcean DNS** (`src/lib/digitalocean.ts`):
- axios-based client targeting the DO v2 API
- Domain validation, record creation/update/delete, MX priority handling, exponential backoff for 429s

**AWS Route53** (`src/lib/route53.ts`):
- v3 SDK (`@aws-sdk/client-route-53`)
- Idempotent UPSERT via a single `ChangeResourceRecordSetsCommand` batch — lists existing records first and skips no-op rows
- Preserves CNAME trailing dots and quotes TXT values per RFC 1035
- `AWS_HOSTED_ZONE_ID` is optional — if unset, `resolveHostedZoneId(domain)` auto-discovers the hosted zone via `ListHostedZonesByName`, walking up to parent zones for subdomains (e.g. `mail.example.com` resolves to the `example.com` zone). Resolved zone IDs are memoized per-process. Returns `undefined` when no zone matches; `verifyDomainOwnership` then returns `false` and `setupDomainDNS` throws

**API Key System** (`src/lib/api-keys.ts`):
- Format: `mrs_{keyId}_{secretPart}`
- bcrypt hashing with the `mrs_` prefix preserved for identification
- Domain-scoped permissions

**Admin Connections Health** (`src/app/api/health/{ses,dns}/route.ts` + `src/components/ConnectionsTab.tsx`):
- Two read-only admin endpoints (`GET /api/health/ses`, `GET /api/health/dns`) protected by inline JWT verification (matching the `auth/me` and `domains` routes)
- SES probe: single `GetAccountCommand`, returns `{ ok, region, sandbox, sendingEnabled, enforcementStatus, sendQuota }`. `ok: true|false` both serialize as HTTP 200 so the dashboard handles a single result path
- DNS probe: dispatches via `checkDnsProvider()` to the active provider's `checkProvider()` — DigitalOcean lists `/v2/domains`, Route53 either reads the pinned zone (`AWS_HOSTED_ZONE_ID`) via `GetHostedZoneCommand` or lists account zones via `ListHostedZonesCommand`
- Secret policy: errors are reduced to a `{ name, message, httpStatusCode }` whitelist before serialization; AWS access keys, DO API tokens, JWTs are never reflected. Tested via regex-based sanity assertions in every route + component test
- Dashboard surface: a Connections tab fires both fetches in parallel on mount and re-runs them on Refresh (no automatic polling — operator-initiated only)

## API Design Patterns

### Resend Compatibility
The project maintains 100% compatibility with the Resend Node.js SDK by:
- Matching the exact API endpoint structure (`/api/emails`)
- Supporting the same request/response formats
- Honouring `RESEND_BASE_URL` so existing Resend users can swap without code changes

### Authentication Flow
1. **Admin login** — JWT tokens via `POST /api/auth/login`
2. **API keys** — Bearer token authentication for email operations
3. **Middleware** — `withAuth()` and `withApiKeyAuth()` helpers in `src/lib/middleware.ts`

### Error Handling Pattern
Consistent error responses with:
```typescript
{ error: "Error message", details?: "Additional info" }
```

## Key Development Patterns

### Database Operations
Always use the connection pool and transaction helpers:
```typescript
import { query, transaction } from "@/lib/database";

// Simple query
const result = await query("SELECT * FROM users WHERE id = $1", [userId]);

// Transaction
const result = await transaction(async (client) => {
  // Multiple operations
  return result;
});
```

### API Route Structure
Follow the established pattern in `src/app/api/`:
- Use proper HTTP methods (GET, POST, DELETE)
- Apply authentication middleware
- Return consistent JSON responses
- Handle errors gracefully

### Component Organization
- `Dashboard.tsx` — main container with tab switching
- `[Feature]Tab.tsx` — individual feature components
- `LoginForm.tsx` — authentication handling
- React hooks + context for state management

### Testing
- Unit tests live next to the code under `__tests__/` directories
- AWS SDK calls are mocked with [`aws-sdk-client-mock`](https://github.com/m-radzikowski/aws-sdk-client-mock); axios is mocked via `jest.mock("axios", ...)`
- Tests must never hit real AWS / DigitalOcean / SMTP endpoints
- DNS provider abstraction is verified by an integration suite that asserts provider isolation: with `DNS_PROVIDER=digitalocean` only axios is exercised, with `DNS_PROVIDER=route53` only the Route53 client

## Environment Configuration

Required environment variables:
```bash
# Database (PostgreSQL)
DATABASE_URL=postgresql://...

# AWS SES
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# DNS provider selection
DNS_PROVIDER=digitalocean        # or "route53"; defaults to "digitalocean"

# DigitalOcean (required when DNS_PROVIDER=digitalocean)
DO_API_TOKEN=...

# Route53 (DNS_PROVIDER=route53)
AWS_HOSTED_ZONE_ID=...           # optional — if unset, auto-discovered from the sending domain via ListHostedZonesByName (walks up to parent zones)

# Security
NEXTAUTH_SECRET=...

# Admin Setup
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
```

## Domain Setup Workflow

1. **Add domain** — `POST /api/domains` with the domain name
2. **DNS records generated** — `generateDNSRecords()` in `src/lib/ses.ts` produces TXT (SES verification), MX, SPF, DMARC, and DKIM CNAMEs
3. **DNS provider applies records** — `dns-provider.setupDomainDNS()` dispatches to DigitalOcean or Route53 based on `DNS_PROVIDER`
4. **SES verification** — `verifyDomain()` (`CreateEmailIdentity` + `GetEmailIdentity`) registers the domain with SES; `getDomainVerificationStatus()` is polled until success
5. **DKIM tokens** — `enableDomainDkim()` activates DKIM signing; tokens flow back into the DNS records on a retry
6. **API key creation** — generate keys for verified domains only
7. **Email sending** — use API keys with the Resend-compatible endpoints (`POST /api/emails`)

## Common Development Tasks

### Adding New API Endpoints
1. Create the route file under `src/app/api/[path]/route.ts`
2. Add business logic to the appropriate `src/lib/` module
3. Apply authentication middleware
4. Update types in `src/lib/database.ts` if a schema change is required

### Database Schema Changes
1. Update `database.sql` with the new schema
2. Update TypeScript interfaces in `src/lib/database.ts`
3. Apply via `psql ... -f database.sql` (no migration framework)

### Adding a New DNS Provider
1. Implement `setupDomainDNS(domain, dnsRecords)` and `verifyDomainOwnership(domain)` in a new module under `src/lib/`
2. Extend the `DnsProviderName` union and the dispatch switch in `src/lib/dns-provider.ts`
3. Add unit tests using whatever client mock is appropriate (`aws-sdk-client-mock` for AWS, `jest.mock` for axios-based providers)
4. Add the new provider to the integration suite to keep the isolation guarantee

## Security Considerations

- All passwords are bcrypt-hashed (rounds: 12)
- API keys are hashed with identifiable `mrs_` prefixes
- JWT tokens for dashboard authentication
- Database queries use parameterised statements
- Environment variables for all sensitive data
- CORS handling for cross-origin requests

## Production Deployment

The application is container-friendly via the included `Dockerfile` and runs on any platform that supports a long-lived Node.js process:
- Container PaaS (Docker, Dokku, Coolify, Fly.io, Railway, ...)
- Kubernetes (sample manifests live under `k8s/`)
- Managed Node.js hosting (Vercel, Render, etc. — webhook endpoints may need extra configuration on serverless platforms)

Key production requirements:
- A managed or self-hosted PostgreSQL instance
- AWS SES out of sandbox mode for the sending region
- SSL certificates for HTTPS
- Environment variables configured (see above)
- Database schema initialised via `database.sql`
