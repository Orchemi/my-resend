/**
 * @jest-environment node
 *
 * Unit tests for src/app/api/health/dns/route.ts (admin DNS provider
 * health probe).
 *
 * Strategy:
 *   - The DNS provider abstraction is mocked so each case can drive the
 *     route into a specific provider + health-state branch without
 *     coupling to the underlying axios / aws-sdk transports.
 *   - The auth middleware is mocked the same way as the SES route test
 *     to avoid pulling the api-keys -> nanoid ESM chain into the
 *     `node` test environment.
 *   - Env isolation: DNS_PROVIDER and AWS_HOSTED_ZONE_ID are
 *     setup/teardown per case (route53.test.ts pattern).
 *   - Every assertion runs the response body through a secret-pattern
 *     sanity check.
 */
import { NextRequest } from "next/server";

jest.mock("../../../../../lib/auth", () => ({
  __esModule: true,
  verifyJWT: jest.fn(() => ({ id: "user-1", email: "admin@example.com" })),
}));

jest.mock("../../../../../lib/dns-provider", () => ({
  __esModule: true,
  checkDnsProvider: jest.fn(),
}));

import { verifyJWT } from "../../../../../lib/auth";
import { checkDnsProvider } from "../../../../../lib/dns-provider";
import { GET } from "../route";

const verifyJWTMock = verifyJWT as jest.MockedFunction<typeof verifyJWT>;
const checkDnsProviderMock = checkDnsProvider as jest.MockedFunction<
  typeof checkDnsProvider
>;

const ORIGINAL_DNS_PROVIDER = process.env.DNS_PROVIDER;
const ORIGINAL_HOSTED_ZONE_ID = process.env.AWS_HOSTED_ZONE_ID;
const ORIGINAL_DO_API_TOKEN = process.env.DO_API_TOKEN;

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /AKIA[0-9A-Z]{16}/,
  /Bearer\s+[A-Za-z0-9._-]+/,
  /"secretAccessKey"/,
  /"accessKeyId"/,
];

function buildAuthedRequest(): NextRequest {
  return new NextRequest("http://localhost/api/health/dns", {
    headers: { authorization: "Bearer test-token" },
  });
}

function buildUnauthedRequest(): NextRequest {
  return new NextRequest("http://localhost/api/health/dns");
}

function assertNoSecretsInBody(serialized: string): void {
  for (const pattern of SECRET_PATTERNS) {
    expect(serialized).not.toMatch(pattern);
  }
  expect(serialized).not.toContain("do-test-token-XXXXXXXXXXXXXXXX");
  expect(serialized).not.toContain("AKIATESTKEY1234567890");
}

beforeEach(() => {
  checkDnsProviderMock.mockReset();
  verifyJWTMock.mockReset();
  verifyJWTMock.mockReturnValue({ id: "user-1", email: "admin@example.com" });
});

afterEach(() => {
  if (ORIGINAL_DNS_PROVIDER === undefined) delete process.env.DNS_PROVIDER;
  else process.env.DNS_PROVIDER = ORIGINAL_DNS_PROVIDER;

  if (ORIGINAL_HOSTED_ZONE_ID === undefined) delete process.env.AWS_HOSTED_ZONE_ID;
  else process.env.AWS_HOSTED_ZONE_ID = ORIGINAL_HOSTED_ZONE_ID;

  if (ORIGINAL_DO_API_TOKEN === undefined) delete process.env.DO_API_TOKEN;
  else process.env.DO_API_TOKEN = ORIGINAL_DO_API_TOKEN;
});

describe("GET /api/health/dns — DigitalOcean active", () => {
  beforeEach(() => {
    process.env.DNS_PROVIDER = "digitalocean";
  });

  it("returns ok=true with detail.domainCount when token + listing succeed", async () => {
    process.env.DO_API_TOKEN = "do-test-token-XXXXXXXXXXXXXXXX";
    checkDnsProviderMock.mockResolvedValue({
      ok: true,
      provider: "digitalocean",
      detail: { domainCount: 3 },
    });

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      provider: "digitalocean",
      detail: { domainCount: 3 },
    });
    assertNoSecretsInBody(JSON.stringify(body));
  });

  it("returns ok=false with name='MissingToken' when DO_API_TOKEN is unset", async () => {
    delete process.env.DO_API_TOKEN;
    checkDnsProviderMock.mockResolvedValue({
      ok: false,
      provider: "digitalocean",
      error: {
        name: "MissingToken",
        message: "DO_API_TOKEN is not set",
        httpStatusCode: null,
      },
    });

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: false,
      provider: "digitalocean",
      error: {
        name: "MissingToken",
        message: "DO_API_TOKEN is not set",
        httpStatusCode: null,
      },
    });
    assertNoSecretsInBody(JSON.stringify(body));
  });

  it("returns ok=false with httpStatusCode=401 when DO API rejects the token", async () => {
    process.env.DO_API_TOKEN = "do-test-token-XXXXXXXXXXXXXXXX";
    checkDnsProviderMock.mockResolvedValue({
      ok: false,
      provider: "digitalocean",
      error: {
        name: "AxiosError",
        message: "Request failed with status code 401",
        httpStatusCode: 401,
      },
    });

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.error.httpStatusCode).toBe(401);
    assertNoSecretsInBody(JSON.stringify(body));
  });
});

describe("GET /api/health/dns — Route53 active", () => {
  beforeEach(() => {
    process.env.DNS_PROVIDER = "route53";
  });

  it("returns ok=true with hostedZoneCount=1 + pinnedZoneId when AWS_HOSTED_ZONE_ID is set + GetHostedZone succeeds", async () => {
    process.env.AWS_HOSTED_ZONE_ID = "Z123EXAMPLE";
    checkDnsProviderMock.mockResolvedValue({
      ok: true,
      provider: "route53",
      detail: { hostedZoneCount: 1, pinnedZoneId: "Z123EXAMPLE" },
    });

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      provider: "route53",
      detail: { hostedZoneCount: 1, pinnedZoneId: "Z123EXAMPLE" },
    });
    assertNoSecretsInBody(JSON.stringify(body));
  });

  it("returns ok=true with hostedZoneCount=N + pinnedZoneId=null when zone id is unset (lists account zones)", async () => {
    delete process.env.AWS_HOSTED_ZONE_ID;
    checkDnsProviderMock.mockResolvedValue({
      ok: true,
      provider: "route53",
      detail: { hostedZoneCount: 3, pinnedZoneId: null },
    });

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.detail).toEqual({ hostedZoneCount: 3, pinnedZoneId: null });
    assertNoSecretsInBody(JSON.stringify(body));
  });

  it("returns ok=false with httpStatusCode=403 on AccessDenied", async () => {
    process.env.AWS_HOSTED_ZONE_ID = "Z123EXAMPLE";
    checkDnsProviderMock.mockResolvedValue({
      ok: false,
      provider: "route53",
      error: {
        name: "AccessDeniedException",
        message: "access denied for route53:GetHostedZone",
        httpStatusCode: 403,
      },
    });

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.error.httpStatusCode).toBe(403);
    expect(body.error.name).toBe("AccessDeniedException");
    assertNoSecretsInBody(JSON.stringify(body));
  });
});

describe("GET /api/health/dns — misconfiguration / auth", () => {
  it("returns 500 when checkDnsProvider throws (e.g. unknown DNS_PROVIDER)", async () => {
    process.env.DNS_PROVIDER = "cloudflare";
    checkDnsProviderMock.mockRejectedValue(
      new Error("Unsupported DNS_PROVIDER='cloudflare'.")
    );

    const response = await GET(buildAuthedRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    // Generic 500 — provider value is fine to surface (it's an env name,
    // not a secret), but no SDK error fields leak.
    assertNoSecretsInBody(JSON.stringify(body));
  });

  it("returns 401 when no Authorization header is present (withAuth gate)", async () => {
    process.env.DNS_PROVIDER = "digitalocean";

    const response = await GET(buildUnauthedRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toMatch(/authorization/i);
    expect(checkDnsProviderMock).not.toHaveBeenCalled();
    assertNoSecretsInBody(JSON.stringify(body));
  });
});
