# MyResend Deployment Guide

MyResend is a standard Next.js 15 application. Any host that can run Node 20+ and reach a PostgreSQL database works. This guide lists the supported deployment options side by side, plus the steps that are common to all of them.

For local first-run setup, see [SETUP.md](./SETUP.md).

## 1. Prerequisites (all options)

- A PostgreSQL 14+ database reachable by the deployment (managed Postgres or self-hosted).
- AWS SES production access (or sandbox if you only test with verified recipients).
- An IAM user with the SES v2 policy (and Route53 policy if `DNS_PROVIDER=route53`) from [SETUP.md](./SETUP.md).
- A DigitalOcean API token if `DNS_PROVIDER=digitalocean`.
- A custom domain (optional but typical — required to send from a non-sandbox address).

## 2. Database

MyResend bootstraps from a single SQL file (no migration framework). Any PostgreSQL-compatible service works — provision a database, capture the connection string for `DATABASE_URL`, then:

```bash
psql "$DATABASE_URL" -f database.sql
```

The script is idempotent (`CREATE TABLE IF NOT EXISTS`) so it is safe to re-run on existing databases.

## 3. Environment Variables

Set the keys documented in `CLAUDE.md § Environment Configuration` (the same set lives in `.env.local.example`). The deployment-shape-sensitive ones are:

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/my_resend
NEXTAUTH_URL=https://your-domain.example.com    # public origin
NEXTAUTH_SECRET=                                # 64+ char random
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=

# DNS provider (default: digitalocean)
DNS_PROVIDER=digitalocean
DO_API_TOKEN=dop_v1_...

# Optional
# AWS_HOSTED_ZONE_ID=...                        # route53 mode, optional
# CRON_SECRET=                                  # cron endpoint header
```

Never commit `.env.local` or any file with real secrets. `.env.local.example` is the only env file tracked by git and contains placeholders only.

## 4. Deployment Options

MyResend has no platform lock-in. The options below are listed in no particular order — pick the one that matches your existing infrastructure.

### Option A: Docker

```bash
# Build
docker build -t my-resend .

# Run
docker run -d --name my-resend \
  -p 3000:3000 \
  --env-file .env.local \
  my-resend
```

The bundled `docker-compose.yml` runs the application service alongside an optional commented-out Postgres service that initializes from `database.sql` on first boot.

### Option B: Dokku

```bash
# On the Dokku host
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

# From the workstation
git remote add dokku dokku@your-dokku-host:my-resend
git push dokku develop:main
```

### Option C: Coolify / CapRover / Other PaaS

Any container-aware PaaS that accepts a Dockerfile works. Point it at this repository, set the environment variables in the PaaS dashboard, and let it build from the included `Dockerfile`.

### Option D: Fly.io

```bash
fly launch --no-deploy        # generates fly.toml
fly secrets set DATABASE_URL=... NEXTAUTH_SECRET=... \
                AWS_REGION=... AWS_ACCESS_KEY_ID=... \
                AWS_SECRET_ACCESS_KEY=... ADMIN_EMAIL=... \
                ADMIN_PASSWORD=... DNS_PROVIDER=... DO_API_TOKEN=...
fly deploy
```

For the database, either provision Fly Postgres (`fly postgres create`) or point `DATABASE_URL` at an external managed Postgres.

### Option E: Vercel

```bash
vercel login
vercel link
vercel env add DATABASE_URL          # repeat for each variable
vercel --prod
```

Notes:
- Vercel's serverless functions are short-lived, so long-running operations are not expected (MyResend has none).
- Provision Postgres externally (Neon, RDS, etc.) — Vercel does not host the database.

### Option F: Kubernetes

The repository ships sample manifests under `k8s/` (note: those manifests still carry upstream conventions and are scheduled for sweep in a follow-up plan; treat them as a starting reference, not a turn-key deploy). For a from-scratch deploy, build the image from `Dockerfile`, push it to your registry, and write Deployment + Service + Ingress manifests with `DATABASE_URL` and the AWS credentials wired in as secrets.

## 5. Custom Domain and TLS

Most of the platforms above terminate TLS for you (Vercel, Fly.io, Dokku with Let's Encrypt, Coolify, Kubernetes via cert-manager). After the domain points at the deployment:

1. Set `NEXTAUTH_URL` to the public origin.
2. Redeploy or restart so the new value is picked up.

## 6. Post-Deployment Checklist

1. Visit `https://your-domain.example.com` — the landing page should render.
2. Seed the admin user: `curl -X POST https://your-domain.example.com/api/setup`. Re-running is safe (idempotent).
3. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
4. Open the **Connections** tab and confirm both cards show `ok: true`. If either fails, the response body identifies the missing IAM action or invalid token.
5. Add a real domain in the **Domains** tab and wait for SES verification + DKIM activation.
6. Issue an API key for the verified domain and send a test email.

## 7. Operational Notes

### CI Gate

`.github/workflows/ci.yml` runs `lint → typecheck → test → build` on every PR. The deployment artifact is the same `npm run build` output, so a green CI implies the deployment will build.

### External Calls in Tests

The Jest suite mocks every external SDK call (`aws-sdk-client-mock` for AWS, `jest.mock` for axios). It will never hit AWS, DigitalOcean, or SMTP. Trust the suite as the source of truth for behavioral testing — `npm test -- src/lib/__tests__/ses` exercises the SES path end-to-end without network.

### Scaling

- The web tier is stateless behind the `users`, `domains`, `api_keys`, and `email_logs` tables. Horizontal scaling is straightforward — front it with a load balancer.
- AWS SES has account-level sending quotas (visible in the **Connections** tab via `GetAccount`). Request a quota increase before high-volume sends.
- Route53 is rate-limited (5 changes/second per hosted zone). MyResend serializes record changes per domain, but large bulk imports should be paced.

### Updating

For Git-based deploys (Dokku, Fly.io, Vercel with GitHub integration), push to the tracking branch and the host rebuilds. For Docker-based deploys, rebuild the image and restart the container. Always run `psql "$DATABASE_URL" -f database.sql` after pulling a change that modifies the schema.

## 8. Security Checklist

- [ ] `NEXTAUTH_SECRET` is at least 64 characters of random data.
- [ ] `AWS_*` credentials are scoped to only the SES + Route53 actions used by MyResend (see [SETUP.md](./SETUP.md) for the exact policies).
- [ ] Secrets live in the platform's secret manager (Vercel env, Dokku config, Fly secrets, Kubernetes Secrets), never in committed files.
- [ ] TLS is enforced end-to-end. Most platforms above do this by default.
- [ ] Database connection uses TLS where the provider offers it (`sslmode=require` on the connection string).
- [ ] `CRON_SECRET` is set if you expose the `/api/cron/*` endpoints.

## 9. Support

- Bug reports: [Orchemi/my-resend issues](https://github.com/Orchemi/my-resend/issues)
- Attribution and upstream divergence boundary: see [NOTICE](./NOTICE).
