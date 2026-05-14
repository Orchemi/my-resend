# MyResend Setup Guide

This guide walks you through running MyResend from scratch on a local machine. For production deployment, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## 1. Prerequisites Setup

### PostgreSQL Database

MyResend uses raw `pg` queries (no ORM) and bootstraps from a single SQL file. Any PostgreSQL 14+ instance works.

1. **Option A: Local PostgreSQL**

   ```bash
   # Install PostgreSQL (macOS)
   brew install postgresql
   brew services start postgresql

   # Create database (snake_case — Postgres identifiers without quoting)
   createdb my_resend
   ```

2. **Option B: Docker**

   ```bash
   docker run -d --name my-resend-pg \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=my_resend \
     -p 5432:5432 postgres:15-alpine
   ```

3. **Option C: Managed Postgres**

   Any PostgreSQL-compatible service (e.g. AWS RDS, Google Cloud SQL, DigitalOcean Managed Databases, Neon, Render) works. Provision a database and capture the connection string for `DATABASE_URL`.

4. **Initialize the schema:**

   ```bash
   # database.sql creates: users, domains, api_keys, email_logs,
   # webhook_events, waitlist_signups
   psql "$DATABASE_URL" -f database.sql
   ```

### AWS SES Setup

1. Go to the [AWS SES Console](https://console.aws.amazon.com/ses/).
2. Request production access (move out of sandbox) once you are ready to send to arbitrary recipients. Sandbox mode still lets you verify domains and exercise the admin UI.
3. Create an IAM user with the following policy. The actions correspond 1:1 to the SES v2 commands MyResend actually issues (see `src/lib/ses.ts` and `src/app/api/health/ses/route.ts`):

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

### DNS Provider (one of)

MyResend dispatches domain DNS setup to the provider chosen by `DNS_PROVIDER`. Pick one:

1. **Route53** (default, `DNS_PROVIDER=route53`)

   Reuse the AWS credentials from the SES step. Attach the following policy to the same IAM user — most SES operators already hold a Route53 scope under the same account. Actions correspond to the Route53 commands in `src/lib/route53.ts`:

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

   `AWS_HOSTED_ZONE_ID` is optional — if unset, MyResend auto-discovers the hosted zone for the sending domain via `ListHostedZonesByName`, walking up to parent zones.

2. **DigitalOcean** (`DNS_PROVIDER=digitalocean`)

   Create an API token at [DigitalOcean → API → Tokens](https://cloud.digitalocean.com/account/api/tokens) with read+write scope and add the target domains to DO's DNS management. Set `DO_API_TOKEN`.

## 2. Environment Configuration

1. Copy the example environment file:

   ```bash
   cp .env.local.example .env.local
   ```

2. Edit `.env.local` with your actual values. The full key set and per-key meaning is documented in `CLAUDE.md § Environment Configuration`. The minimum set for a local boot is:

   ```env
   # Database
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/my_resend

   # AWS SES (required)
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=AKIA...
   AWS_SECRET_ACCESS_KEY=...

   # DNS provider (default: route53)
   DNS_PROVIDER=route53
   # AWS_HOSTED_ZONE_ID=...       # optional, route53 auto-discovers when unset
   # DO_API_TOKEN=dop_v1_...      # required only when DNS_PROVIDER=digitalocean

   # Security
   NEXTAUTH_SECRET=               # 64+ char random — `openssl rand -base64 64`

   # Admin user (seeded on first POST /api/setup)
   ADMIN_EMAIL=admin@example.com
   ADMIN_PASSWORD=                # strong password
   ```

## 3. Installation

```bash
# Install dependencies (npm is the only supported package manager — package-lock.json is committed)
npm install

# Start the development server (Next.js 15, Turbopack)
npm run dev

# In a separate terminal, seed the default admin user from ADMIN_EMAIL / ADMIN_PASSWORD
curl -X POST http://localhost:3000/api/setup
```

## 4. First Steps

1. Visit `http://localhost:3000` and log in with your admin credentials.
2. Open the **Connections** tab — both the SES card and the DNS provider card should report `ok: true`. If either fails, the response payload includes a non-secret hint (e.g. region, IAM diagnostic).
3. Add your first domain in the **Domains** tab — MyResend generates the required SES verification TXT, DKIM CNAMEs, SPF, DMARC, and MX records and applies them to the active DNS provider automatically.
4. Wait for domain verification (polled in-tab).
5. Create an API key in the **API Keys** tab (keys are only issuable for verified domains).
6. Start sending emails through the Resend-compatible API.

## 5. Testing the API

The Jest suite under `src/lib/__tests__` and route-adjacent `__tests__` directories is the source of truth for behavioral testing — it mocks AWS SDK and axios so it never touches real endpoints.

For ad-hoc end-to-end probing against a running instance:

```bash
# Health check
curl http://localhost:3000/api/health/ses

# Send an email (replace with your API key — format mrs_<id>_<secret>)
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

## 6. Production Deployment

MyResend ships as a standard Next.js 15 app with no platform-specific lock-in. Container-friendly options (Docker, Dokku, Coolify, Fly.io, Vercel, Kubernetes, plain VPS) all work. See [DEPLOYMENT.md](./DEPLOYMENT.md) for option-by-option guidance.

## 7. Domain DNS Records

When you add a domain through the admin UI, MyResend generates and applies the records below automatically. They are listed here for manual verification or for environments where DNS is managed outside the supported providers.

### SES Domain Verification

```
Type: TXT
Name: _amazonses.example.com
Value: [verification token returned by CreateEmailIdentity]
```

### DKIM (3 CNAMEs)

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

### MX (only if you also want to receive via SES)

```
Type: MX
Name: example.com
Value: 10 inbound-smtp.us-east-1.amazonaws.com
```

## 8. Troubleshooting

1. **Database connection fails**

   - Verify `DATABASE_URL` parses (`psql "$DATABASE_URL" -c '\dt'`) and the schema was applied.
   - Re-run `psql "$DATABASE_URL" -f database.sql` — the script is idempotent (`CREATE TABLE IF NOT EXISTS`).

2. **`/api/health/ses` returns `ok: false`**

   - Re-check `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
   - Confirm the IAM policy above is attached. The single most common cause is missing `ses:GetAccount`.
   - In sandbox, sending is restricted but `GetAccount` still returns `ok: true`.

3. **`/api/health/dns` returns `ok: false`**

   - DigitalOcean: regenerate `DO_API_TOKEN` with read+write scope.
   - Route53: confirm the Route53 policy is attached. If using a parent-zone-only setup, leave `AWS_HOSTED_ZONE_ID` unset so auto-discovery runs.

4. **Domain verification stays "pending"**

   - DNS propagation can take minutes to hours. Confirm the records visible in your DNS provider match what the Domains tab generated.
   - DKIM tokens flow back into the DNS records on a retry — the first apply might omit them until SES returns the tokens.

5. **API key authentication fails**

   - Ensure the domain is verified before issuing keys.
   - Expected key format: `mrs_<id>_<secret>`.

## 9. References

- API documentation: [README.md](./README.md) (English) or [README.ko.md](./README.ko.md) (Korean)
- Database schema: [database.sql](./database.sql)
- Environment variable reference: `CLAUDE.md § Environment Configuration`
- Implementation entry points: `src/lib/ses.ts`, `src/lib/dns-provider.ts`, `src/lib/route53.ts`, `src/lib/digitalocean.ts`
