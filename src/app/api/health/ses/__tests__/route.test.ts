/**
 * @jest-environment node
 *
 * Unit tests for src/app/api/health/ses/route.ts (admin SES health probe).
 *
 * Strategy:
 *   - aws-sdk-client-mock intercepts SESv2Client.send() so no live AWS call
 *     is ever made.
 *   - JWT verification is mocked at the module boundary so the route's
 *     `withAuth` wrapping can be exercised without a live secret + token.
 *   - Every assertion includes a secret-pattern sanity check on the
 *     serialized response body to enforce the project secret policy
 *     (no AKIA*, Bearer, accessKeyId, secretAccessKey, DO_API_TOKEN).
 *
 * Environment is `node` (not jsdom) because NextRequest depends on the
 * fetch / Request globals provided by Node 18+ but absent from jsdom.
 */
import { mockClient } from "aws-sdk-client-mock";
import { NextRequest } from "next/server";
import { GetAccountCommand, SESv2Client } from "@aws-sdk/client-sesv2";

// Mock just the auth helper so the real route's inline `verifyJWT`
// gate can be exercised end-to-end without depending on a live JWT
// secret. The auth module is small (no transitive ESM chain) so a
// shallow mock is enough.
jest.mock("../../../../../lib/auth", () => ({
  __esModule: true,
  verifyJWT: jest.fn(() => ({ id: "user-1", email: "admin@example.com" })),
}));

import { verifyJWT } from "../../../../../lib/auth";
import { GET } from "../route";

const verifyJWTMock = verifyJWT as jest.MockedFunction<typeof verifyJWT>;
const sesMock = mockClient(SESv2Client);

const ORIGINAL_REGION = process.env.AWS_REGION;
const ORIGINAL_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID;
const ORIGINAL_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY;

// Forbidden patterns in the serialized response body (secret policy).
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /AKIA[0-9A-Z]{16}/,
  /Bearer\s+[A-Za-z0-9._-]+/,
  /"secretAccessKey"/,
  /"accessKeyId"/,
];

function buildAuthedRequest(): NextRequest {
  return new NextRequest("http://localhost/api/health/ses", {
    headers: { authorization: "Bearer test-token" },
  });
}

function buildUnauthedRequest(): NextRequest {
  return new NextRequest("http://localhost/api/health/ses");
}

function assertNoSecretsInBody(serialized: string): void {
  for (const pattern of SECRET_PATTERNS) {
    expect(serialized).not.toMatch(pattern);
  }
  // Also sanity-check that the literal env values used in test setup do
  // not leak into the response.
  expect(serialized).not.toContain("AKIATESTKEY1234567890");
  expect(serialized).not.toContain("super-secret-aws-secret");
}

beforeEach(() => {
  sesMock.reset();
  verifyJWTMock.mockReset();
  verifyJWTMock.mockReturnValue({ id: "user-1", email: "admin@example.com" });

  process.env.AWS_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "AKIATESTKEY1234567890";
  process.env.AWS_SECRET_ACCESS_KEY = "super-secret-aws-secret";
});

afterEach(() => {
  if (ORIGINAL_REGION === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = ORIGINAL_REGION;

  if (ORIGINAL_ACCESS_KEY === undefined) delete process.env.AWS_ACCESS_KEY_ID;
  else process.env.AWS_ACCESS_KEY_ID = ORIGINAL_ACCESS_KEY;

  if (ORIGINAL_SECRET_KEY === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
  else process.env.AWS_SECRET_ACCESS_KEY = ORIGINAL_SECRET_KEY;
});

describe("GET /api/health/ses", () => {
  it("returns ok=true with full quota + non-sandbox flags on a healthy production account", async () => {
    sesMock.on(GetAccountCommand).resolves({
      ProductionAccessEnabled: true,
      SendingEnabled: true,
      EnforcementStatus: "HEALTHY",
      SendQuota: {
        Max24HourSend: 50000,
        MaxSendRate: 14,
        SentLast24Hours: 200,
      },
    });

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      region: "us-east-1",
      sandbox: false,
      sendingEnabled: true,
      enforcementStatus: "HEALTHY",
      sendQuota: {
        max24HourSend: 50000,
        maxSendRate: 14,
        sentLast24Hours: 200,
      },
    });

    assertNoSecretsInBody(JSON.stringify(body));
    expect(sesMock.commandCalls(GetAccountCommand)).toHaveLength(1);
  });

  it("reports sandbox=true when ProductionAccessEnabled is false", async () => {
    sesMock.on(GetAccountCommand).resolves({
      ProductionAccessEnabled: false,
      SendingEnabled: true,
      EnforcementStatus: "HEALTHY",
      SendQuota: {
        Max24HourSend: 200,
        MaxSendRate: 1,
        SentLast24Hours: 0,
      },
    });

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sandbox).toBe(true);
    assertNoSecretsInBody(JSON.stringify(body));
  });

  it("reports ok=false with httpStatusCode=403 on IAM access denied (whitelist serializes only name/message/httpStatusCode)", async () => {
    const err = Object.assign(new Error("not authorized to perform ses:GetAccount"), {
      name: "AccessDeniedException",
      $metadata: { httpStatusCode: 403 },
    });
    sesMock.on(GetAccountCommand).rejects(err);

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: false,
      region: "us-east-1",
      error: {
        name: "AccessDeniedException",
        message: "not authorized to perform ses:GetAccount",
        httpStatusCode: 403,
      },
    });
    assertNoSecretsInBody(JSON.stringify(body));
  });

  it("reports ok=false with httpStatusCode=null on a network error (no $metadata)", async () => {
    const err = Object.assign(new Error("ECONNREFUSED"), { name: "Error" });
    sesMock.on(GetAccountCommand).rejects(err);

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.region).toBe("us-east-1");
    expect(body.error).toEqual({
      name: "Error",
      message: "ECONNREFUSED",
      httpStatusCode: null,
    });
    assertNoSecretsInBody(JSON.stringify(body));
  });

  it("returns ok=true with sendQuota=null when SendQuota is absent in the response", async () => {
    sesMock.on(GetAccountCommand).resolves({
      ProductionAccessEnabled: false,
      SendingEnabled: true,
      EnforcementStatus: "HEALTHY",
      // SendQuota intentionally omitted (some sandbox accounts).
    });

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sendQuota).toBeNull();
    expect(body.sandbox).toBe(true);
    assertNoSecretsInBody(JSON.stringify(body));
  });

  it("returns 401 when no Authorization header is present (withAuth gate)", async () => {
    const response = await GET(buildUnauthedRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toMatch(/authorization/i);
    // No SES call should have been issued.
    expect(sesMock.commandCalls(GetAccountCommand)).toHaveLength(0);
    assertNoSecretsInBody(JSON.stringify(body));
  });
});
