# Contributing to MyResend

Thank you for your interest in contributing to MyResend! This document provides guidelines and instructions for contributing.

## 🚀 Quick Start

1. **Fork the repository** on GitHub
2. **Clone your fork**:
   ```bash
   git clone https://github.com/Orchemi/my-resend.git
   cd my-resend
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Set up your environment** following the [SETUP.md](./SETUP.md) guide
5. **Verify your setup**:
   ```bash
   npm test
   ```
6. **Start development**:
   ```bash
   npm run dev
   ```

## 🐛 Reporting Issues

When reporting bugs, please include:

- **Environment details**: Node.js version, OS, browser (if applicable)
- **Steps to reproduce**: Clear, numbered steps
- **Expected behavior**: What you expected to happen
- **Actual behavior**: What actually happened
- **Error messages**: Full error logs (sanitize sensitive info)
- **Configuration**: Relevant environment variables (mask secrets)

### Bug Report Template

```markdown
**Environment:**

- Node.js version:
- OS:
- MyResend version:

**Steps to Reproduce:**

1.
2.
3.

**Expected Behavior:**

**Actual Behavior:**

**Error Messages:**
```

## ✨ Feature Requests

Before submitting a feature request:

1. **Check existing issues** to avoid duplicates
2. **Describe the problem** you're trying to solve
3. **Explain your proposed solution**
4. **Consider alternatives** you've evaluated
5. **Estimate complexity** if possible

## 🔧 Development Guidelines

### Code Style

- **TypeScript**: Use strict types, avoid `any`. The repo holds a `tsc --noEmit` 0-error baseline — do not introduce type drift.
- **React**: Use functional components with hooks (React 19 + Next.js 15 App Router).
- **Linting**: Run `npm run lint` (ESLint with `next/core-web-vitals`).
- **Naming**: Use descriptive variable/function names.
- **Comments**: Explain complex logic, not obvious code.

### Architecture Principles

- **API Compatibility**: Maintain Resend SDK compatibility.
- **Security First**: Validate all inputs, sanitize outputs.
- **Database**: Raw `pg` queries with the schema in `database.sql`. No ORM or migration framework — schema changes go directly into `database.sql` and the TypeScript interfaces in `src/lib/database.ts`.
- **Error Handling**: Graceful degradation with informative messages.
- **Testing**: Cover new behavior with Jest unit/integration tests. External SDK calls must be mocked (`aws-sdk-client-mock` for AWS, `jest.mock` for axios) — the suite must never hit real endpoints.

### File Organization

```
src/
├── app/api/           # Next.js API routes
├── components/        # Reusable UI components
├── contexts/          # React context providers
├── lib/               # Core business logic
│   ├── database.ts    # Database operations (raw pg)
│   ├── ses.ts         # Email sending logic (AWS SDK v3 SESv2)
│   ├── dns-provider.ts # DNS dispatch (DigitalOcean / Route53)
│   ├── digitalocean.ts # DigitalOcean DNS implementation
│   ├── route53.ts     # Route53 DNS implementation
│   ├── domains.ts     # Domain management
│   └── middleware.ts  # API middleware
```

## 🧪 Testing

### Running Tests

```bash
# Run the full Jest suite
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Lint
npm run lint

# Type checking
npm run typecheck
```

The CI gate (`.github/workflows/ci.yml`) runs `lint → typecheck → test → build` on every PR. Run all four locally before submitting.

### Writing Tests

- **API endpoints**: Test success and error cases.
- **Email sending**: Verify SES integration via `aws-sdk-client-mock`.
- **Domain setup**: Test DNS record generation for both DigitalOcean and Route53 paths.
- **Authentication**: Test JWT and API key validation.

## 🚀 Pull Request Process

### Before Submitting

1. **Create a feature branch**: branch from `develop` using `<type>/<issue>` naming (e.g. `feat/42`, `fix/55`).
2. **Test thoroughly**: Run the CI 4-stage gate locally.
3. **Update documentation**: Add/update relevant docs.
4. **Follow code style**: Run linting and type checking.
5. **Write clear commits**: Conventional Commits with scope (e.g. `feat(route53): ...`, `refactor(types): ...`). Issue suffix is not used.

### PR Description Template

```markdown
## Changes Made

-
-
-

## Testing

- [ ] CI gate passed locally (`npm run lint && npm run typecheck && npm test && npm run build`)
- [ ] Updated documentation
- [ ] No breaking changes (or documented)

## Screenshots

(If applicable)

## Notes

(Any additional context)
```

### Review Process

1. **Automated checks**: Must pass the CI 4-stage gate.
2. **Code review**: Maintainer will review code quality.
3. **Testing**: Verify functionality works as expected.
4. **Documentation**: Ensure docs are updated.
5. **Merge**: Once approved, the PR will be merged into `develop`.

## 🎯 Good First Issues

Looking for ways to contribute? Check for issues labeled:

- `good first issue`: Perfect for newcomers
- `help wanted`: Community help appreciated
- `documentation`: Improve docs
- `bug`: Fix existing issues

## 🛠️ Development Setup Tips

### Environment Variables

Create `.env.local` from `.env.local.example`:

```bash
cp .env.local.example .env.local
```

**Required for development:**

- PostgreSQL `DATABASE_URL`
- AWS SES credentials (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
- `NEXTAUTH_SECRET` (64+ char random)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` (seeded by `POST /api/setup`)

**Conditional:**

- Route53 IAM policy when `DNS_PROVIDER=route53` (default — see [SETUP.md](./SETUP.md))
- `DO_API_TOKEN` when `DNS_PROVIDER=digitalocean`

See `CLAUDE.md § Environment Configuration` for the full key reference.

### Common Development Tasks

```bash
# Apply schema changes (idempotent — CREATE TABLE IF NOT EXISTS)
psql "$DATABASE_URL" -f database.sql

# View dev logs filtered for errors and warnings
npm run dev | grep -E "(error|warn)"

# Build for production
npm run build
```

### Debugging Tips

1. **Check logs**: Browser console + terminal output.
2. **Verify environment**: All required env vars set? Compare against `.env.local.example`.
3. **Test connectivity**: Open the admin **Connections** tab — both SES and DNS cards should report `ok: true`.
4. **Email delivery**: Check the AWS SES console for failures.
5. **DNS issues**: Use `dig` to verify the records that the Domains tab generated.

## 📚 Learning Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [AWS SES v2 API Reference](https://docs.aws.amazon.com/sesv2/latest/APIReference/Welcome.html)
- [Resend API Documentation](https://resend.com/docs)

## ❓ Getting Help

- **Documentation**: Check [README.md](./README.md) and [SETUP.md](./SETUP.md) first.
- **Issues**: Search existing GitHub issues.
- **Discussions**: Use GitHub Discussions for questions.
- **Code Review**: Ask for feedback on draft PRs.

## 🙏 Recognition

Contributors will be:

- Listed in [README.md](./README.md)
- Credited in release notes
- Recognized in the community

Thank you for helping make MyResend better! 🚀

---

Attribution and the divergence boundary from the upstream project are documented in [NOTICE](./NOTICE).
