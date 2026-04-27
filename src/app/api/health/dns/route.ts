/**
 * GET /api/health/dns — admin-only DNS provider health probe.
 *
 * Dispatches to the active DNS provider (`DNS_PROVIDER` env) via
 * `checkDnsProvider()` and returns its `DnsHealth` shape verbatim.
 *
 * Response policy (see plan 009):
 *   - HTTP 200 for both `ok: true` and `ok: false` so the UI handles a
 *     single fetch result path. The `ok` discriminator drives the
 *     dashboard's success/error rendering.
 *   - HTTP 401 when the JWT is missing or invalid (auth gate).
 *   - HTTP 500 only when `checkDnsProvider()` itself throws — which
 *     today happens only on an unknown `DNS_PROVIDER` value (fail-fast
 *     misconfiguration signal during operator setup). The body is the
 *     generic error shape.
 *   - The provider's `checkProvider()` already enforces the
 *     `{ name, message, httpStatusCode }` whitelist on errors, so no
 *     SDK / axios error transitively reaches the response payload.
 *
 * Auth: inline `verifyJWT` mirrors the pattern in
 * `src/app/api/{auth/me,domains}/route.ts`. See plan 009 "후속 트랙
 * 후보" for the `withAuth` wrapper refactor that would let this be
 * `export const GET = withAuth(...)`.
 */
import { NextRequest, NextResponse } from "next/server";

import { verifyJWT } from "@/lib/auth";
import { checkDnsProvider } from "@/lib/dns-provider";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid authorization header" },
      { status: 401 }
    );
  }
  const token = authHeader.substring(7);
  const user = verifyJWT(token);
  if (!user) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 }
    );
  }

  try {
    const result = await checkDnsProvider();
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("DNS health probe error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
