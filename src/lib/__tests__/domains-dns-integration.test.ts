/**
 * Integration tests for the DNS provider abstraction.
 *
 * These verify that `addDomain` (`src/lib/domains.ts`) — the highest
 * caller of the abstraction — actually exercises the correct underlying
 * provider SDK based on the `DNS_PROVIDER` env var, and never touches
 * the other one. This is the proof that the abstraction is wired up
 * end-to-end through dns-provider.ts.
 *
 * Mocking strategy:
 *   - `database` (Postgres) and `ses` (AWS SES SDK calls) are stubbed at
 *     the module level so we don't need a live DB or AWS credentials.
 *   - For the digitalocean case, `axios` is mocked at the module level
 *     (digitalocean.ts uses `axios.create()`) — we then assert that
 *     axios was used and the Route53 SDK was NOT.
 *   - For the route53 case, `aws-sdk-client-mock` intercepts
 *     `Route53Client.send()` — we then assert that Route53 was used and
 *     axios was NOT.
 */

// IMPORTANT: jest.mock calls must be declared before any import that
// transitively pulls in the mocked modules.
jest.mock("../database", () => ({
  __esModule: true,
  query: jest.fn(),
}));
jest.mock("../ses", () => ({
  __esModule: true,
  verifyDomain: jest.fn(),
  getDomainVerificationStatus: jest.fn(),
  createConfigurationSet: jest.fn(),
  generateDNSRecords: jest.fn(),
  enableDomainDkim: jest.fn(),
  getDomainDkimTokens: jest.fn(),
}));
jest.mock("axios", () => {
  const mockInstance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  };
  // Stash the instance on globalThis so the test body can grab the
  // exact object that digitalocean.ts received from `axios.create()`.
  (globalThis as unknown as { __axiosMockInstance: typeof mockInstance }).__axiosMockInstance =
    mockInstance;
  const create = jest.fn(() => mockInstance);
  return {
    __esModule: true,
    default: { create },
    create,
  };
});

import { mockClient } from "aws-sdk-client-mock";
import {
  Route53Client,
  GetHostedZoneCommand,
  ListResourceRecordSetsCommand,
  ChangeResourceRecordSetsCommand,
} from "@aws-sdk/client-route-53";

import { addDomain } from "../domains";
import * as database from "../database";
import * as ses from "../ses";

const route53Mock = mockClient(Route53Client);

const queryMock = database.query as jest.MockedFunction<typeof database.query>;
const verifyDomainMock = ses.verifyDomain as jest.MockedFunction<
  typeof ses.verifyDomain
>;
const enableDkimMock = ses.enableDomainDkim as jest.MockedFunction<
  typeof ses.enableDomainDkim
>;
const createConfigSetMock = ses.createConfigurationSet as jest.MockedFunction<
  typeof ses.createConfigurationSet
>;
const generateDnsRecordsMock = ses.generateDNSRecords as jest.MockedFunction<
  typeof ses.generateDNSRecords
>;

// The same axios instance digitalocean.ts received at module-load
// time, stashed on globalThis by the jest.mock factory above.
const axiosMockInstance = (
  globalThis as unknown as {
    __axiosMockInstance: { get: jest.Mock; post: jest.Mock };
  }
).__axiosMockInstance;
const axiosGetMock = axiosMockInstance.get;
const axiosPostMock = axiosMockInstance.post;

const ORIGINAL_DNS_PROVIDER = process.env.DNS_PROVIDER;
const ORIGINAL_AWS_HOSTED_ZONE_ID = process.env.AWS_HOSTED_ZONE_ID;

beforeEach(() => {
  jest.clearAllMocks();
  route53Mock.reset();

  // Default SES mocks: produce a verification token + 1 DKIM token + a
  // configuration set + the canonical 4 base DNS records.
  verifyDomainMock.mockResolvedValue({
    verificationToken: "verification-token",
    status: "Pending",
  });
  enableDkimMock.mockResolvedValue(["tok1"]);
  createConfigSetMock.mockResolvedValue("my-resend-example-com");
  generateDnsRecordsMock.mockReturnValue([
    {
      type: "TXT",
      name: "_amazonses.example.com",
      value: "verification-token",
      ttl: 300,
    },
    {
      type: "MX",
      name: "example.com",
      value: "10 inbound-smtp.us-east-1.amazonaws.com.",
      ttl: 300,
    },
    {
      type: "TXT",
      name: "example.com",
      value: "v=spf1 include:amazonses.com ~all",
      ttl: 300,
    },
    {
      type: "TXT",
      name: "_dmarc.example.com",
      value: "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com",
      ttl: 300,
    },
    {
      type: "CNAME",
      name: "tok1._domainkey.example.com",
      value: "tok1.dkim.amazonses.com.",
      ttl: 300,
    },
  ]);

  // Default DB mocks: domain does NOT exist yet (so addDomain takes the
  // create path), and INSERT returns one row.
  queryMock.mockImplementation(async (text: string) => {
    if (text.startsWith("SELECT * FROM domains WHERE domain")) {
      return {
        rows: [],
        rowCount: 0,
        command: "SELECT",
        oid: 0,
        fields: [],
      } as unknown as Awaited<ReturnType<typeof database.query>>;
    }
    if (text.startsWith("INSERT INTO domains")) {
      return {
        rows: [
          {
            id: "domain-uuid-1",
            user_id: "user-1",
            domain: "example.com",
            status: "pending",
            ses_configuration_set: "my-resend-example-com",
            dns_records: "[]",
            verification_token: "verification-token",
          },
        ],
        rowCount: 1,
        command: "INSERT",
        oid: 0,
        fields: [],
      } as unknown as Awaited<ReturnType<typeof database.query>>;
    }
    return {
      rows: [],
      rowCount: 0,
      command: "",
      oid: 0,
      fields: [],
    } as unknown as Awaited<ReturnType<typeof database.query>>;
  });
});

afterEach(() => {
  if (ORIGINAL_DNS_PROVIDER === undefined) {
    delete process.env.DNS_PROVIDER;
  } else {
    process.env.DNS_PROVIDER = ORIGINAL_DNS_PROVIDER;
  }
  if (ORIGINAL_AWS_HOSTED_ZONE_ID === undefined) {
    delete process.env.AWS_HOSTED_ZONE_ID;
  } else {
    process.env.AWS_HOSTED_ZONE_ID = ORIGINAL_AWS_HOSTED_ZONE_ID;
  }
});

describe("addDomain with DNS_PROVIDER=digitalocean", () => {
  beforeEach(() => {
    process.env.DNS_PROVIDER = "digitalocean";
    // Provide a token so digitalocean.ts skips the "not configured"
    // early returns. The actual axios calls are mocked below.
    process.env.DO_API_TOKEN = "test-do-token";

    // verifyDomainOwnership -> getDomains -> GET /domains
    // setupDomainDNS -> getDomains + getDomainRecords + createDNSRecord(s)
    axiosGetMock.mockImplementation(async (url: string) => {
      if (url === "/domains") {
        return { data: { domains: [{ name: "example.com", zone_file: "" }] } };
      }
      if (url.startsWith("/domains/example.com/records")) {
        return { data: { domain_records: [] } };
      }
      return { data: {} };
    });
    axiosPostMock.mockImplementation(async () => {
      // Returns a fake DODomainRecord shape; the dns-provider conversion
      // accepts any consistent shape with type/name/data/ttl.
      return {
        data: {
          domain_record: {
            id: 1,
            type: "TXT",
            name: "@",
            data: "verification-token",
            ttl: 300,
          },
        },
      };
    });
  });

  it("calls axios (digitalocean) and never touches the Route53 SDK", async () => {
    const result = await addDomain("user-1", "example.com");

    // DigitalOcean side: axios was used.
    expect(axiosGetMock).toHaveBeenCalled();
    // Route53 side: nothing was sent.
    expect(route53Mock.commandCalls(GetHostedZoneCommand)).toHaveLength(0);
    expect(route53Mock.commandCalls(ListResourceRecordSetsCommand)).toHaveLength(
      0
    );
    expect(
      route53Mock.commandCalls(ChangeResourceRecordSetsCommand)
    ).toHaveLength(0);

    // The result still carries the unified-shape records under the
    // renamed field.
    expect(result.dnsProviderRecords).toBeDefined();
    expect(Array.isArray(result.dnsProviderRecords)).toBe(true);
  });
});

describe("addDomain with DNS_PROVIDER=route53", () => {
  beforeEach(() => {
    process.env.DNS_PROVIDER = "route53";
    process.env.AWS_HOSTED_ZONE_ID = "Z123EXAMPLE";

    route53Mock.on(GetHostedZoneCommand).resolves({
      HostedZone: {
        Id: "/hostedzone/Z123EXAMPLE",
        Name: "example.com.",
        CallerReference: "ref",
      },
    });
    route53Mock.on(ListResourceRecordSetsCommand).resolves({
      ResourceRecordSets: [],
    });
    route53Mock.on(ChangeResourceRecordSetsCommand).resolves({
      ChangeInfo: {
        Id: "/change/C1",
        Status: "PENDING",
        SubmittedAt: new Date(),
      },
    });
  });

  it("calls Route53Client and never touches axios (digitalocean)", async () => {
    const result = await addDomain("user-1", "example.com");

    // Route53 side: at least one Get + one Change must have happened.
    expect(
      route53Mock.commandCalls(GetHostedZoneCommand).length
    ).toBeGreaterThanOrEqual(1);
    expect(
      route53Mock.commandCalls(ChangeResourceRecordSetsCommand).length
    ).toBeGreaterThanOrEqual(1);

    // DigitalOcean side: no axios calls at all.
    expect(axiosGetMock).not.toHaveBeenCalled();
    expect(axiosPostMock).not.toHaveBeenCalled();

    // Records returned in the unified shape under the renamed field.
    expect(result.dnsProviderRecords).toBeDefined();
    expect(Array.isArray(result.dnsProviderRecords)).toBe(true);
  });
});
