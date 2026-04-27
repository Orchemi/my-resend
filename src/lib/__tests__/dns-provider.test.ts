/**
 * Unit tests for src/lib/dns-provider.ts (DNS provider env dispatcher).
 *
 * Strategy:
 *   - getDnsProviderName: pure env-branching helper, tested in isolation.
 *   - setupDomainDNS / verifyDomainOwnership: the dispatcher delegates to
 *     either digitalocean.ts or route53.ts; both modules are jest.mock'd
 *     here so we assert delegation behavior + shape conversion without
 *     touching axios/AWS SDK.
 */
jest.mock("../digitalocean", () => ({
  __esModule: true,
  setupDomainDNS: jest.fn(),
  verifyDomainOwnership: jest.fn(),
  checkProvider: jest.fn(),
}));
jest.mock("../route53", () => ({
  __esModule: true,
  setupDomainDNS: jest.fn(),
  verifyDomainOwnership: jest.fn(),
  checkProvider: jest.fn(),
}));

import {
  checkDnsProvider,
  getDnsProviderName,
  setupDomainDNS,
  verifyDomainOwnership,
} from "../dns-provider";
import * as digitalocean from "../digitalocean";
import * as route53 from "../route53";

const doSetupMock = digitalocean.setupDomainDNS as jest.MockedFunction<
  typeof digitalocean.setupDomainDNS
>;
const doVerifyMock = digitalocean.verifyDomainOwnership as jest.MockedFunction<
  typeof digitalocean.verifyDomainOwnership
>;
const doCheckMock = digitalocean.checkProvider as jest.MockedFunction<
  typeof digitalocean.checkProvider
>;
const r53SetupMock = route53.setupDomainDNS as jest.MockedFunction<
  typeof route53.setupDomainDNS
>;
const r53VerifyMock = route53.verifyDomainOwnership as jest.MockedFunction<
  typeof route53.verifyDomainOwnership
>;
const r53CheckMock = route53.checkProvider as jest.MockedFunction<
  typeof route53.checkProvider
>;

describe("getDnsProviderName", () => {
  const ORIGINAL_ENV = process.env.DNS_PROVIDER;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.DNS_PROVIDER;
    } else {
      process.env.DNS_PROVIDER = ORIGINAL_ENV;
    }
  });

  it("returns 'digitalocean' when DNS_PROVIDER is unset (backward compat)", () => {
    delete process.env.DNS_PROVIDER;
    expect(getDnsProviderName()).toBe("digitalocean");
  });

  it("returns 'digitalocean' when DNS_PROVIDER='digitalocean'", () => {
    process.env.DNS_PROVIDER = "digitalocean";
    expect(getDnsProviderName()).toBe("digitalocean");
  });

  it("returns 'route53' when DNS_PROVIDER='route53'", () => {
    process.env.DNS_PROVIDER = "route53";
    expect(getDnsProviderName()).toBe("route53");
  });

  it("throws fail-fast on an unknown DNS_PROVIDER value", () => {
    process.env.DNS_PROVIDER = "cloudflare";
    expect(() => getDnsProviderName()).toThrow(/DNS_PROVIDER/);
  });

  it("is case-insensitive (accepts 'ROUTE53')", () => {
    process.env.DNS_PROVIDER = "ROUTE53";
    expect(getDnsProviderName()).toBe("route53");
  });

  it("treats empty string as unset and falls back to default", () => {
    process.env.DNS_PROVIDER = "";
    expect(getDnsProviderName()).toBe("digitalocean");
  });
});

describe("setupDomainDNS dispatch", () => {
  const ORIGINAL_ENV = process.env.DNS_PROVIDER;

  beforeEach(() => {
    doSetupMock.mockReset();
    r53SetupMock.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.DNS_PROVIDER;
    } else {
      process.env.DNS_PROVIDER = ORIGINAL_ENV;
    }
  });

  it("delegates to digitalocean and converts DODomainRecord[] to DnsProviderRecord[]", async () => {
    process.env.DNS_PROVIDER = "digitalocean";
    doSetupMock.mockResolvedValue([
      {
        id: 1,
        type: "TXT",
        name: "_amazonses",
        data: "verification-token",
        ttl: 300,
      },
      {
        id: 2,
        type: "MX",
        name: "@",
        data: "inbound-smtp.us-east-1.amazonaws.com.",
        priority: 10,
        ttl: 300,
      },
    ]);

    const records = [
      {
        type: "TXT",
        name: "_amazonses.example.com",
        value: "verification-token",
        ttl: 300,
      },
    ];
    const result = await setupDomainDNS("example.com", records);

    expect(doSetupMock).toHaveBeenCalledTimes(1);
    expect(doSetupMock).toHaveBeenCalledWith("example.com", records);
    expect(r53SetupMock).not.toHaveBeenCalled();

    expect(result).toEqual([
      { type: "TXT", name: "_amazonses", value: "verification-token", ttl: 300 },
      {
        type: "MX",
        name: "@",
        // DigitalOcean splits MX into priority + host fields; the
        // unified shape recombines them into the standard "PRIO HOST"
        // form that other providers (and operators) expect.
        value: "10 inbound-smtp.us-east-1.amazonaws.com.",
        ttl: 300,
      },
    ]);
  });

  it("delegates to route53 and returns its result unchanged (already unified shape)", async () => {
    process.env.DNS_PROVIDER = "route53";
    const route53Result = [
      {
        type: "TXT",
        name: "_amazonses.example.com",
        value: "verification-token",
        ttl: 300,
      },
    ];
    r53SetupMock.mockResolvedValue(route53Result);

    const records = [
      {
        type: "TXT",
        name: "_amazonses.example.com",
        value: "verification-token",
        ttl: 300,
      },
    ];
    const result = await setupDomainDNS("example.com", records);

    expect(r53SetupMock).toHaveBeenCalledTimes(1);
    expect(r53SetupMock).toHaveBeenCalledWith("example.com", records);
    expect(doSetupMock).not.toHaveBeenCalled();
    expect(result).toBe(route53Result);
  });
});

describe("verifyDomainOwnership dispatch", () => {
  const ORIGINAL_ENV = process.env.DNS_PROVIDER;

  beforeEach(() => {
    doVerifyMock.mockReset();
    r53VerifyMock.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.DNS_PROVIDER;
    } else {
      process.env.DNS_PROVIDER = ORIGINAL_ENV;
    }
  });

  it("delegates to digitalocean when DNS_PROVIDER='digitalocean'", async () => {
    process.env.DNS_PROVIDER = "digitalocean";
    doVerifyMock.mockResolvedValue(true);

    const result = await verifyDomainOwnership("example.com");

    expect(result).toBe(true);
    expect(doVerifyMock).toHaveBeenCalledWith("example.com");
    expect(r53VerifyMock).not.toHaveBeenCalled();
  });

  it("delegates to route53 when DNS_PROVIDER='route53'", async () => {
    process.env.DNS_PROVIDER = "route53";
    r53VerifyMock.mockResolvedValue(true);

    const result = await verifyDomainOwnership("example.com");

    expect(result).toBe(true);
    expect(r53VerifyMock).toHaveBeenCalledWith("example.com");
    expect(doVerifyMock).not.toHaveBeenCalled();
  });
});

describe("checkDnsProvider dispatch", () => {
  const ORIGINAL_ENV = process.env.DNS_PROVIDER;

  beforeEach(() => {
    doCheckMock.mockReset();
    r53CheckMock.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.DNS_PROVIDER;
    } else {
      process.env.DNS_PROVIDER = ORIGINAL_ENV;
    }
  });

  it("delegates to digitalocean and returns its DnsHealth result unchanged", async () => {
    process.env.DNS_PROVIDER = "digitalocean";
    const doResult = {
      ok: true as const,
      provider: "digitalocean" as const,
      detail: { domainCount: 3 },
    };
    doCheckMock.mockResolvedValue(doResult);

    const result = await checkDnsProvider();

    expect(result).toBe(doResult);
    expect(doCheckMock).toHaveBeenCalledTimes(1);
    expect(r53CheckMock).not.toHaveBeenCalled();
  });

  it("delegates to route53 and returns its DnsHealth result unchanged", async () => {
    process.env.DNS_PROVIDER = "route53";
    const r53Result = {
      ok: true as const,
      provider: "route53" as const,
      detail: { hostedZoneCount: 2, pinnedZoneId: "Z123EXAMPLE" },
    };
    r53CheckMock.mockResolvedValue(r53Result);

    const result = await checkDnsProvider();

    expect(result).toBe(r53Result);
    expect(r53CheckMock).toHaveBeenCalledTimes(1);
    expect(doCheckMock).not.toHaveBeenCalled();
  });

  it("propagates throw from getDnsProviderName on unknown DNS_PROVIDER", async () => {
    process.env.DNS_PROVIDER = "cloudflare";
    await expect(checkDnsProvider()).rejects.toThrow(/DNS_PROVIDER/);
    expect(doCheckMock).not.toHaveBeenCalled();
    expect(r53CheckMock).not.toHaveBeenCalled();
  });
});
