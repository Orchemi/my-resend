/**
 * AWS Route53 DNS provider.
 *
 * Implements the same `setupDomainDNS` / `verifyDomainOwnership` surface
 * that `digitalocean.ts` exposes, normalized to the unified
 * `DnsProviderRecord` shape consumed by `dns-provider.ts`.
 *
 * Env:
 *   - `AWS_HOSTED_ZONE_ID` (optional) — the hosted zone in which records
 *     are managed. If unset, the matching hosted zone is auto-discovered
 *     from the sending domain via `ListHostedZonesByName`, walking up to
 *     parent zones for subdomains (e.g. `mail.example.com` resolves to
 *     the `example.com` zone).
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
  ListHostedZonesByNameCommand,
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  ChangeResourceRecordSetsCommand,
  type Change,
  type ResourceRecordSet,
  type RRType,
} from "@aws-sdk/client-route-53";

import type { DnsHealth, DnsProviderRecord } from "./dns-provider";

/**
 * Build a fresh Route53 client per call. Mirrors the lazy pattern used in
 * `digitalocean.ts` (PR #8) and `ses.ts` (PR #10): credentials and region
 * are read from `process.env` at call time so credential rotation is safe
 * and tests can mutate AWS env between cases without re-importing the
 * module. Client construction is config + middleware wiring only — no
 * network work — so per-call instantiation is negligible compared to
 * the actual `.send()` call that follows.
 */
function getRoute53Client(): Route53Client {
  return new Route53Client({
    region: process.env.AWS_REGION || "us-east-1",
  });
}

/**
 * Per-process memoization of `domain -> hosted zone ID` lookups. Hosted
 * zones rarely move between accounts, so a process-lifetime cache is
 * acceptable — restart to invalidate. The cache is keyed on the input
 * domain (not the matched zone name) so callers can pass any form they
 * like and still hit the cache cheaply.
 */
const zoneIdCache = new Map<string, string>();

/**
 * Resolve the Route53 hosted zone ID that owns `domain`.
 *
 * Resolution order:
 *   1. If `AWS_HOSTED_ZONE_ID` is set, return it verbatim (no SDK call).
 *      Explicit configuration always wins so operators can pin a
 *      specific zone in multi-zone accounts.
 *   2. If we previously resolved this exact domain, return the cached
 *      zone ID (no SDK call).
 *   3. Walk up the domain labels — `mail.example.com` -> `example.com`
 *      -> stop — calling `ListHostedZonesByName` for each candidate.
 *      The first candidate whose zone Name (with trailing dot) matches
 *      a hosted zone in the account wins. The matched zone ID is
 *      cached and returned without the `/hostedzone/` SDK prefix.
 *   4. If no candidate matches any hosted zone, returns `undefined`
 *      so callers can fall back to their existing "no zone" branches
 *      (verify -> false, setup -> throw).
 */
export async function resolveHostedZoneId(
  domain: string
): Promise<string | undefined> {
  const envValue = process.env.AWS_HOSTED_ZONE_ID;
  if (envValue) {
    return envValue;
  }

  const cached = zoneIdCache.get(domain);
  if (cached) {
    return cached;
  }

  let candidate = domain;
  // Walk up while the candidate has at least one dot — i.e. has a
  // parent. A bare TLD like `com` is never a sensible hosted zone for
  // sending, so we stop there.
  while (candidate.includes(".")) {
    const dnsName = `${candidate}.`;
    const response = await getRoute53Client().send(
      new ListHostedZonesByNameCommand({
        DNSName: dnsName,
        MaxItems: 1,
      })
    );

    const firstZone = response.HostedZones?.[0];
    if (firstZone?.Name === dnsName && firstZone.Id) {
      const stripped = firstZone.Id.replace(/^\/hostedzone\//, "");
      zoneIdCache.set(domain, stripped);
      return stripped;
    }

    // Strip the leftmost label and try the parent.
    const nextDot = candidate.indexOf(".");
    candidate = candidate.slice(nextDot + 1);
  }

  return undefined;
}

/**
 * Test-only: clear the in-process hosted-zone cache so each test case
 * starts cold. Underscored to signal "internal" — not part of the
 * public API. Production code should never call this.
 */
export function __resetZoneIdCacheForTests(): void {
  zoneIdCache.clear();
}

/**
 * Verify that the hosted zone owning `domain` exists and is accessible.
 *
 * The hosted zone is resolved via `resolveHostedZoneId(domain)`, which
 * either returns the explicit `AWS_HOSTED_ZONE_ID` env value or
 * auto-discovers a zone via `ListHostedZonesByName` (walking up to
 * parent zones for subdomains). When no zone can be resolved we return
 * `false` — the same answer the original env-only implementation gave
 * when `AWS_HOSTED_ZONE_ID` was unset.
 */
export async function verifyDomainOwnership(
  domain: string
): Promise<boolean> {
  const hostedZoneId = await resolveHostedZoneId(domain);
  if (!hostedZoneId) {
    return false;
  }

  try {
    const response = await getRoute53Client().send(
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

  const hostedZoneId = await resolveHostedZoneId(domain);
  if (!hostedZoneId) {
    throw new Error(
      `AWS_HOSTED_ZONE_ID is not set and no matching hosted zone found for domain '${domain}'.`
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

  await getRoute53Client().send(
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
    const response = await getRoute53Client().send(
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

/**
 * Read-only health probe used by `/api/health/dns` (admin Connections tab).
 *
 * Two paths depending on whether a hosted zone is pinned via env:
 *   - `AWS_HOSTED_ZONE_ID` set -> issue a single `GetHostedZoneCommand`
 *     for that exact zone. Verifies both that the zone exists and that
 *     the configured AWS credentials have permission to read it.
 *     Reported `hostedZoneCount` is `1` (the pinned zone) and
 *     `pinnedZoneId` echoes the env value back so the dashboard can
 *     render the operator's pin choice.
 *   - `AWS_HOSTED_ZONE_ID` unset -> issue `ListHostedZonesCommand({})`
 *     for an account-level visibility check. Reported `hostedZoneCount`
 *     is the total returned in the first page (sufficient as a "can I
 *     see anything?" probe; pagination is not exhausted because the
 *     point is provider liveness, not exhaustive enumeration).
 *     `pinnedZoneId` is `null` so the UI can show "auto-discover" mode.
 *
 * Errors are reduced to a `{ name, message, httpStatusCode }` whitelist
 * — the raw AWS SDK error is never serialized because it transitively
 * carries SigV4-signed request headers (the `Authorization` header
 * includes `Credential=AKIA…/…`), which would leak the access key id
 * to the response payload.
 */
export async function checkProvider(): Promise<DnsHealth> {
  const pinnedZoneId = process.env.AWS_HOSTED_ZONE_ID;

  try {
    if (pinnedZoneId) {
      await getRoute53Client().send(
        new GetHostedZoneCommand({ Id: pinnedZoneId })
      );
      return {
        ok: true,
        provider: "route53",
        detail: { hostedZoneCount: 1, pinnedZoneId },
      };
    }

    const response = await getRoute53Client().send(
      new ListHostedZonesCommand({})
    );
    return {
      ok: true,
      provider: "route53",
      detail: {
        hostedZoneCount: response.HostedZones?.length ?? 0,
        pinnedZoneId: null,
      },
    };
  } catch (error: unknown) {
    const errObj = error as {
      name?: string;
      message?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return {
      ok: false,
      provider: "route53",
      error: {
        name: errObj.name ?? "Error",
        message: errObj.message ?? "Unknown error",
        httpStatusCode: errObj.$metadata?.httpStatusCode ?? null,
      },
    };
  }
}
