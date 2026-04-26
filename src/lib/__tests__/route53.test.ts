/**
 * Unit tests for src/lib/route53.ts (Route53 SDK wrapper).
 *
 * Strategy: aws-sdk-client-mock intercepts Route53Client.send() calls so
 * no live AWS request is ever made. Tests verify command input mapping
 * and response unwrapping into the unified DnsProviderRecord shape.
 */
import { mockClient } from "aws-sdk-client-mock";
import {
  Route53Client,
  GetHostedZoneCommand,
  ListResourceRecordSetsCommand,
  ChangeResourceRecordSetsCommand,
} from "@aws-sdk/client-route-53";

import { setupDomainDNS, verifyDomainOwnership } from "../route53";
import type { DnsProviderRecord } from "../dns-provider";

const route53Mock = mockClient(Route53Client);

const ORIGINAL_HOSTED_ZONE_ID = process.env.AWS_HOSTED_ZONE_ID;

beforeEach(() => {
  route53Mock.reset();
});

afterEach(() => {
  if (ORIGINAL_HOSTED_ZONE_ID === undefined) {
    delete process.env.AWS_HOSTED_ZONE_ID;
  } else {
    process.env.AWS_HOSTED_ZONE_ID = ORIGINAL_HOSTED_ZONE_ID;
  }
});

describe("verifyDomainOwnership", () => {
  it("returns false (and never calls SDK) when AWS_HOSTED_ZONE_ID is unset", async () => {
    delete process.env.AWS_HOSTED_ZONE_ID;

    const result = await verifyDomainOwnership("example.com");

    expect(result).toBe(false);
    expect(route53Mock.commandCalls(GetHostedZoneCommand)).toHaveLength(0);
  });

  it("returns true when GetHostedZone resolves with a HostedZone", async () => {
    process.env.AWS_HOSTED_ZONE_ID = "Z123EXAMPLE";
    route53Mock.on(GetHostedZoneCommand).resolves({
      HostedZone: {
        Id: "/hostedzone/Z123EXAMPLE",
        Name: "example.com.",
        CallerReference: "ref",
      },
    });

    const result = await verifyDomainOwnership("example.com");

    expect(result).toBe(true);
    const calls = route53Mock.commandCalls(GetHostedZoneCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({ Id: "Z123EXAMPLE" });
  });

  it("returns false when Route53 throws NoSuchHostedZone", async () => {
    process.env.AWS_HOSTED_ZONE_ID = "Z123EXAMPLE";
    const err = Object.assign(new Error("not found"), {
      name: "NoSuchHostedZone",
    });
    route53Mock.on(GetHostedZoneCommand).rejects(err);

    const result = await verifyDomainOwnership("example.com");

    expect(result).toBe(false);
  });

  it("rethrows unexpected errors (not NoSuchHostedZone)", async () => {
    process.env.AWS_HOSTED_ZONE_ID = "Z123EXAMPLE";
    route53Mock
      .on(GetHostedZoneCommand)
      .rejects(new Error("permission denied"));

    await expect(verifyDomainOwnership("example.com")).rejects.toThrow(
      "permission denied"
    );
  });
});

describe("setupDomainDNS", () => {
  beforeEach(() => {
    process.env.AWS_HOSTED_ZONE_ID = "Z123EXAMPLE";
  });

  it("returns [] and issues no SDK calls for an empty record list", async () => {
    const result = await setupDomainDNS("example.com", []);

    expect(result).toEqual([]);
    expect(route53Mock.commandCalls(ListResourceRecordSetsCommand)).toHaveLength(
      0
    );
    expect(
      route53Mock.commandCalls(ChangeResourceRecordSetsCommand)
    ).toHaveLength(0);
  });

  it("throws when AWS_HOSTED_ZONE_ID is unset", async () => {
    delete process.env.AWS_HOSTED_ZONE_ID;

    await expect(
      setupDomainDNS("example.com", [
        { type: "TXT", name: "example.com", value: "v=spf1 ~all", ttl: 300 },
      ])
    ).rejects.toThrow(/AWS_HOSTED_ZONE_ID/);
  });

  it("issues a single UPSERT ChangeBatch with all new records", async () => {
    route53Mock.on(ListResourceRecordSetsCommand).resolves({
      ResourceRecordSets: [],
    });
    route53Mock.on(ChangeResourceRecordSetsCommand).resolves({
      ChangeInfo: {
        Id: "/change/C123",
        Status: "PENDING",
        SubmittedAt: new Date(),
      },
    });

    const records: DnsProviderRecord[] = [
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
        type: "CNAME",
        name: "tok1._domainkey.example.com",
        value: "tok1.dkim.amazonses.com.",
        ttl: 300,
      },
    ];

    const result = await setupDomainDNS("example.com", records);

    expect(result).toEqual(records);

    const listCalls = route53Mock.commandCalls(ListResourceRecordSetsCommand);
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0].args[0].input).toMatchObject({
      HostedZoneId: "Z123EXAMPLE",
    });

    const changeCalls = route53Mock.commandCalls(
      ChangeResourceRecordSetsCommand
    );
    expect(changeCalls).toHaveLength(1);
    const changeInput = changeCalls[0].args[0].input;
    expect(changeInput.HostedZoneId).toBe("Z123EXAMPLE");
    expect(changeInput.ChangeBatch?.Changes).toHaveLength(3);

    // All actions are UPSERT
    for (const change of changeInput.ChangeBatch!.Changes!) {
      expect(change.Action).toBe("UPSERT");
    }

    // TXT record: name preserved as-is, single ResourceRecord with raw value
    const txtChange = changeInput.ChangeBatch!.Changes!.find(
      (c) => c.ResourceRecordSet?.Type === "TXT"
    );
    expect(txtChange?.ResourceRecordSet).toMatchObject({
      Name: "_amazonses.example.com",
      Type: "TXT",
      TTL: 300,
    });
    // Route53 requires TXT values to be quoted
    expect(txtChange?.ResourceRecordSet?.ResourceRecords).toEqual([
      { Value: '"verification-token"' },
    ]);

    // MX record: priority+host kept as a single Value string (Route53 spec)
    const mxChange = changeInput.ChangeBatch!.Changes!.find(
      (c) => c.ResourceRecordSet?.Type === "MX"
    );
    expect(mxChange?.ResourceRecordSet?.ResourceRecords).toEqual([
      { Value: "10 inbound-smtp.us-east-1.amazonaws.com." },
    ]);

    // CNAME record: trailing dot preserved
    const cnameChange = changeInput.ChangeBatch!.Changes!.find(
      (c) => c.ResourceRecordSet?.Type === "CNAME"
    );
    expect(cnameChange?.ResourceRecordSet?.ResourceRecords).toEqual([
      { Value: "tok1.dkim.amazonses.com." },
    ]);
  });

  it("skips records that already exist with identical type+name+value", async () => {
    // Existing record matches input exactly -> no Change emitted -> no
    // ChangeResourceRecordSetsCommand call (empty ChangeBatch is invalid).
    route53Mock.on(ListResourceRecordSetsCommand).resolves({
      ResourceRecordSets: [
        {
          Name: "_amazonses.example.com.",
          Type: "TXT",
          TTL: 300,
          ResourceRecords: [{ Value: '"verification-token"' }],
        },
      ],
    });

    const records: DnsProviderRecord[] = [
      {
        type: "TXT",
        name: "_amazonses.example.com",
        value: "verification-token",
        ttl: 300,
      },
    ];

    const result = await setupDomainDNS("example.com", records);

    expect(result).toEqual([]);
    expect(
      route53Mock.commandCalls(ChangeResourceRecordSetsCommand)
    ).toHaveLength(0);
  });

  it("emits UPSERT only for the records that differ from existing state", async () => {
    route53Mock.on(ListResourceRecordSetsCommand).resolves({
      ResourceRecordSets: [
        // Identical to one of the inputs (will be skipped).
        {
          Name: "_amazonses.example.com.",
          Type: "TXT",
          TTL: 300,
          ResourceRecords: [{ Value: '"verification-token"' }],
        },
        // Same name+type as an input but DIFFERENT value (will be UPSERTed).
        {
          Name: "example.com.",
          Type: "TXT",
          TTL: 300,
          ResourceRecords: [{ Value: '"v=spf1 -all"' }],
        },
      ],
    });
    route53Mock.on(ChangeResourceRecordSetsCommand).resolves({
      ChangeInfo: {
        Id: "/change/C123",
        Status: "PENDING",
        SubmittedAt: new Date(),
      },
    });

    const records: DnsProviderRecord[] = [
      {
        type: "TXT",
        name: "_amazonses.example.com",
        value: "verification-token",
        ttl: 300,
      },
      {
        type: "TXT",
        name: "example.com",
        value: "v=spf1 include:amazonses.com ~all",
        ttl: 300,
      },
    ];

    const result = await setupDomainDNS("example.com", records);

    // Only the differing SPF record is changed.
    expect(result).toEqual([
      {
        type: "TXT",
        name: "example.com",
        value: "v=spf1 include:amazonses.com ~all",
        ttl: 300,
      },
    ]);

    const changeCalls = route53Mock.commandCalls(
      ChangeResourceRecordSetsCommand
    );
    expect(changeCalls).toHaveLength(1);
    expect(changeCalls[0].args[0].input.ChangeBatch?.Changes).toHaveLength(1);
  });

  it("propagates errors from ChangeResourceRecordSets", async () => {
    route53Mock.on(ListResourceRecordSetsCommand).resolves({
      ResourceRecordSets: [],
    });
    route53Mock
      .on(ChangeResourceRecordSetsCommand)
      .rejects(new Error("InvalidChangeBatch"));

    const records: DnsProviderRecord[] = [
      {
        type: "TXT",
        name: "_amazonses.example.com",
        value: "verification-token",
        ttl: 300,
      },
    ];

    await expect(setupDomainDNS("example.com", records)).rejects.toThrow(
      "InvalidChangeBatch"
    );
  });
});
