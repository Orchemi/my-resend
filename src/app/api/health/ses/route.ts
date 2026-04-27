/**
 * GET /api/health/ses — admin-only SES health probe.
 *
 * Issues a single SESv2 `GetAccountCommand` and normalizes the response
 * into a fixed schema that the dashboard's Connections tab consumes.
 *
 * Response policy (see plan 009):
 *   - HTTP 200 for both `ok: true` and `ok: false` so the UI handles a
 *     single fetch result path. A non-200 status means auth failed
 *     (401) or the route handler itself blew up (500, defensive
 *     try/catch around the normalizer).
 *   - Errors are reduced to a `{ name, message, httpStatusCode }`
 *     whitelist — the raw error object is never serialized because AWS
 *     SDK errors can transitively reference request headers (including
 *     the `Authorization` header bearing the AWS SigV4 signature).
 *   - No AWS access key id / secret key / DO API token / JWT is ever
 *     part of the response payload. Only `region` and account-shape
 *     diagnostics (`sandbox`, `sendingEnabled`, `enforcementStatus`,
 *     `sendQuota`) are returned.
 *
 * Auth: inline `verifyJWT` mirrors the pattern in
 * `src/app/api/{auth/me,domains}/route.ts`. The reusable `withAuth`
 * wrapper in `src/lib/middleware.ts` is incompatible with Next.js 15's
 * route export validator (its generic second argument is rejected as
 * `RouteContext<...> | undefined`); refactoring it is captured as a
 * follow-up in plan 009 "후속 트랙 후보".
 */
import { NextRequest, NextResponse } from "next/server";
import { GetAccountCommand, SESv2Client } from "@aws-sdk/client-sesv2";

import { verifyJWT } from "@/lib/auth";

interface SesSendQuota {
  max24HourSend: number;
  maxSendRate: number;
  sentLast24Hours: number;
}

type SesHealthResponse =
  | {
      ok: true;
      region: string;
      sandbox: boolean;
      sendingEnabled: boolean;
      enforcementStatus: string | null;
      sendQuota: SesSendQuota | null;
    }
  | {
      ok: false;
      region: string;
      error: { name: string; message: string; httpStatusCode: number | null };
    };

/**
 * Build a fresh SESv2 client per call. Mirrors the lazy pattern in
 * `src/lib/ses.ts` so credential rotation is safe and the test runtime
 * can mutate AWS env between cases without re-importing the module.
 */
function getSesClient(): SESv2Client {
  return new SESv2Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

/**
 * Whitelist-only error normalization — never reflect arbitrary error
 * fields back to the client. The AWS SDK puts the request context (with
 * its SigV4 `Authorization` header) on `error.$metadata` siblings on
 * some failure modes; spreading the raw error would leak it.
 */
function normalizeError(error: unknown): {
  name: string;
  message: string;
  httpStatusCode: number | null;
} {
  const errObj = error as {
    name?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return {
    name: errObj.name || "Error",
    message: errObj.message || "Unknown error",
    httpStatusCode: errObj.$metadata?.httpStatusCode ?? null,
  };
}

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

  const region = process.env.AWS_REGION || "us-east-1";

  let body: SesHealthResponse;
  try {
    const response = await getSesClient().send(new GetAccountCommand({}));

    const sendQuota: SesSendQuota | null = response.SendQuota
      ? {
          max24HourSend: response.SendQuota.Max24HourSend ?? 0,
          maxSendRate: response.SendQuota.MaxSendRate ?? 0,
          sentLast24Hours: response.SendQuota.SentLast24Hours ?? 0,
        }
      : null;

    body = {
      ok: true,
      region,
      // ProductionAccessEnabled === true means the account has been
      // promoted out of sandbox; falsey (false / undefined) means
      // sandbox.
      sandbox: !response.ProductionAccessEnabled,
      sendingEnabled: response.SendingEnabled ?? false,
      enforcementStatus: response.EnforcementStatus ?? null,
      sendQuota,
    };
  } catch (error: unknown) {
    body = {
      ok: false,
      region,
      error: normalizeError(error),
    };
  }

  return NextResponse.json(body);
}
