/**
 * AWS Route53 DNS provider.
 *
 * Implements the same `setupDomainDNS` / `verifyDomainOwnership` surface
 * that `digitalocean.ts` exposes, normalized to the unified
 * `DnsProviderRecord` shape consumed by `dns-provider.ts`.
 *
 * Required env:
 *   - `AWS_HOSTED_ZONE_ID` — the hosted zone in which records are managed.
 *   - `AWS_REGION` (optional, defaults to `us-east-1`; Route53 is global
 *     but the SDK still wants a region).
 *   - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or any other AWS
 *     credential resolver supported by the SDK).
 *
 * Idempotency: existing records are listed first; only changes that
 * differ from current state are sent in a single UPSERT ChangeBatch.
 */
import {
  Route53Client,
  GetHostedZoneCommand,
  ListResourceRecordSetsCommand,
  ChangeResourceRecordSetsCommand,
  type Change,
  type ResourceRecordSet,
  type RRType,
} from "@aws-sdk/client-route-53";

import type { DnsProviderRecord } from "./dns-provider";

const route53Client = new Route53Client({
  region: process.env.AWS_REGION || "us-east-1",
});

function getHostedZoneId(): string | undefined {
  return process.env.AWS_HOSTED_ZONE_ID;
}

/**
 * Verify that the configured hosted zone exists and is accessible. The
 * hosted zone is treated as the source of truth for "which domains do
 * we own" — operators map subdomains under one or more zones at the
 * AWS account level.
 */
export async function verifyDomainOwnership(
  domain: string
): Promise<boolean> {
  // The hosted zone is the source of truth; the domain argument exists
  // for parity with other providers (digitalocean.ts uses it directly).
  // Logged at debug level so it's discoverable but not noisy.
  void domain;
  const hostedZoneId = getHostedZoneId();
  if (!hostedZoneId) {
    return false;
  }

  try {
    const response = await route53Client.send(
      new GetHostedZoneCommand({ Id: hostedZoneId })
    );
    return Boolean(response.HostedZone);
  } catch (error: unknown) {
    const errName = (error as { name?: string }).name;
    if (errName === "NoSuchHostedZone") {
      return false;
    }
    throw error;
  }
}

/**
 * Create or update DNS records in the configured hosted zone.
 *
 * - Empty input -> no-op (no SDK calls); returns `[]`.
 * - Lists existing records first; skips inputs that already match
 *   exactly (same type+name+value+ttl) so the operation is idempotent
 *   and avoids unnecessary churn.
 * - All differing records are batched into a single UPSERT
 *   `ChangeResourceRecordSetsCommand`.
 *
 * Returns the unified-shape records that were actually created/updated.
 */
export async function setupDomainDNS(
  domain: string,
  dnsRecords: DnsProviderRecord[]
): Promise<DnsProviderRecord[]> {
  if (dnsRecords.length === 0) {
    return [];
  }

  const hostedZoneId = getHostedZoneId();
  if (!hostedZoneId) {
    throw new Error(
      "AWS_HOSTED_ZONE_ID is not set; cannot manage Route53 DNS records."
    );
  }

  const existing = await listAllResourceRecordSets(hostedZoneId);

  const changes: Change[] = [];
  const applied: DnsProviderRecord[] = [];

  for (const record of dnsRecords) {
    const recordSet = toResourceRecordSet(record);
    if (recordSetMatches(recordSet, existing)) {
      console.log(
        `Route53: ${record.type} ${record.name} already up-to-date, skipping`
      );
      continue;
    }
    changes.push({ Action: "UPSERT", ResourceRecordSet: recordSet });
    applied.push(record);
  }

  if (changes.length === 0) {
    return [];
  }

  await route53Client.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Comment: `my-resend setup for ${domain}`,
        Changes: changes,
      },
    })
  );

  return applied;
}

/**
 * Page through ListResourceRecordSets to materialize the full record set
 * for the hosted zone. Hosted zones are typically small for our use
 * case, but pagination is still required by the API.
 */
async function listAllResourceRecordSets(
  hostedZoneId: string
): Promise<ResourceRecordSet[]> {
  const all: ResourceRecordSet[] = [];
  let startRecordName: string | undefined;
  let startRecordType: RRType | undefined;
  let startRecordIdentifier: string | undefined;

  // Cap to avoid runaway loops in pathological cases.
  for (let i = 0; i < 50; i++) {
    const response = await route53Client.send(
      new ListResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        StartRecordName: startRecordName,
        StartRecordType: startRecordType,
        StartRecordIdentifier: startRecordIdentifier,
      })
    );
    if (response.ResourceRecordSets) {
      all.push(...response.ResourceRecordSets);
    }
    if (!response.IsTruncated) {
      break;
    }
    startRecordName = response.NextRecordName;
    startRecordType = response.NextRecordType;
    startRecordIdentifier = response.NextRecordIdentifier;
  }

  return all;
}

/**
 * Map a unified DnsProviderRecord to the Route53 ResourceRecordSet shape.
 *
 * - Names: Route53 normalizes to the trailing-dot FQDN form internally.
 *   We send without the trailing dot; the comparison helper normalizes
 *   both sides for matching.
 * - TXT values must be wrapped in double quotes per RFC 1035 / Route53.
 * - MX values are kept as a single "PRIORITY HOST" string; Route53 also
 *   accepts that as the ResourceRecord Value verbatim.
 * - CNAME values keep their trailing dot exactly as supplied.
 */
function toResourceRecordSet(record: DnsProviderRecord): ResourceRecordSet {
  const value =
    record.type.toUpperCase() === "TXT"
      ? quoteTxtValue(record.value)
      : record.value;

  return {
    Name: record.name,
    Type: record.type as RRType,
    TTL: record.ttl,
    ResourceRecords: [{ Value: value }],
  };
}

function quoteTxtValue(value: string): string {
  // If already quoted, pass through.
  if (value.startsWith('"') && value.endsWith('"')) {
    return value;
  }
  // Escape any embedded double quotes per Route53 TXT semantics.
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Returns true if the hosted zone already contains a record set matching
 * the input on type, name, and at least one ResourceRecord value.
 *
 * Names are compared with trailing dots stripped (Route53's canonical
 * form vs our input form). For CNAME/MX values that may include trailing
 * dots, we strip them on both sides to avoid spurious diffs.
 */
function recordSetMatches(
  candidate: ResourceRecordSet,
  existing: ResourceRecordSet[]
): boolean {
  const candName = stripTrailingDot(candidate.Name ?? "");
  const candType = candidate.Type;
  const candValues = (candidate.ResourceRecords ?? []).map((r) =>
    normalizeValue(r.Value ?? "", candType)
  );

  return existing.some((existingSet) => {
    if (existingSet.Type !== candType) return false;
    if (stripTrailingDot(existingSet.Name ?? "") !== candName) return false;
    const existingValues = (existingSet.ResourceRecords ?? []).map((r) =>
      normalizeValue(r.Value ?? "", existingSet.Type)
    );
    // Match if every candidate value is present in the existing set.
    return candValues.every((v) => existingValues.includes(v));
  });
}

function stripTrailingDot(value: string): string {
  return value.endsWith(".") ? value.slice(0, -1) : value;
}

function normalizeValue(value: string, type: RRType | undefined): string {
  // For CNAME and MX, the trailing dot is semantically a no-op when
  // compared as DNS data; strip it to make idempotency robust against
  // mixed-form inputs.
  if (type === "CNAME" || type === "MX") {
    return stripTrailingDot(value);
  }
  return value;
}
