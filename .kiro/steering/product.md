# Product Overview

MyResend is a self-hosted, open-source mail gateway with a Resend-compatible HTTP API — a drop-in replacement that existing Resend SDK clients can switch to by changing only the base URL.

## Core Features

- **Resend-compatible API** - drop-in replacement using environment variables
- **Self-hosted** - full control over email infrastructure
- **Amazon SES integration (v2 SDK)** - reliable email delivery with DKIM support
- **DNS provider abstraction** - automatic DNS record setup via DigitalOcean or AWS Route53 (selectable via `DNS_PROVIDER`)
- **Domain verification** - automated SES domain verification with retry on DKIM token availability
- **API key management** - generate and manage `mrs_<id>_<secret>` keys per verified domain
- **Email logging** - track sent emails with delivery status
- **Webhook support** - SES webhook integration for delivery events
- **Admin connections health** - non-destructive `GET /api/health/{ses,dns}` probes surfaced in a Connections tab

## Target Users

- Developers seeking cost-effective email solutions
- Teams wanting self-hosted email infrastructure
- Organizations requiring full control over email data and routing

## Key Value Propositions

1. **Cost Savings** - significant savings over hosted Resend
2. **Drop-in Compatibility** - no application code changes when migrating from Resend
3. **Self-hosted Control** - ownership of email infrastructure, logs, and data
4. **Production Ready** - Docker / Dokku / Coolify / Fly / Vercel / Kubernetes deployment options, PostgreSQL backend, CI gate (lint + typecheck + test + build)
