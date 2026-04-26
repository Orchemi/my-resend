/**
 * DNS provider abstraction.
 *
 * Consumers (`src/lib/domains.ts`, retry-dns route) call into this module
 * instead of importing a specific provider (`digitalocean.ts`, `route53.ts`)
 * directly. The active provider is selected by the `DNS_PROVIDER` env var.
 *
 * Supported providers:
 *   - `digitalocean` (default — backward compatible with upstream fork)
 *   - `route53`
 *
 * Adding a new provider: implement `setupDomainDNS` and
 * `verifyDomainOwnership` in a new module, then extend the union type and
 * the dispatch switch below.
 */

import * as digitalocean from "./digitalocean";
import * as route53 from "./route53";

export type DnsProviderName = "digitalocean" | "route53";

/**
 * Unified DNS record shape used across providers. Each provider's
 * native record type (e.g. `DODomainRecord`) is normalized to this shape
 * inside the dispatcher so consumers stay provider-agnostic.
 *
 * `description` is an optional human-readable label produced by
 * `generateDNSRecords()` (e.g. "SES Domain Verification") and consumed
 * by `formatDNSInstructions()` for the manual-setup output. Providers
 * that don't surface a description (Route53's UPSERT path) simply
 * leave it undefined.
 */
export interface DnsProviderRecord {
  type: string;
  name: string;
  value: string;
  ttl: number;
  description?: string;
}

const DEFAULT_PROVIDER: DnsProviderName = "digitalocean";
const SUPPORTED_PROVIDERS: readonly DnsProviderName[] = [
  "digitalocean",
  "route53",
];

/**
 * Resolve the active DNS provider from `DNS_PROVIDER`.
 *
 * - Unset / empty -> `digitalocean` (backward compat).
 * - Case-insensitive match against the supported set.
 * - Unknown value -> throw (fail-fast: catches typos rather than silently
 *   falling back to the default and surprising the operator).
 */
export function getDnsProviderName(): DnsProviderName {
  const raw = process.env.DNS_PROVIDER;
  if (!raw || raw.trim() === "") {
    return DEFAULT_PROVIDER;
  }

  const normalized = raw.trim().toLowerCase();
  if ((SUPPORTED_PROVIDERS as readonly string[]).includes(normalized)) {
    return normalized as DnsProviderName;
  }

  throw new Error(
    `Unsupported DNS_PROVIDER='${raw}'. Supported values: ${SUPPORTED_PROVIDERS.join(
      ", "
    )}.`
  );
}

/**
 * Create or update DNS records via the active provider. Returns the
 * subset of records that were actually applied (created or updated).
 *
 * Provider-specific record shapes are normalized to `DnsProviderRecord`
 * before returning so consumers stay provider-agnostic.
 */
export async function setupDomainDNS(
  domain: string,
  dnsRecords: DnsProviderRecord[]
): Promise<DnsProviderRecord[]> {
  const provider = getDnsProviderName();
  switch (provider) {
    case "digitalocean": {
      const doRecords = await digitalocean.setupDomainDNS(domain, dnsRecords);
      return doRecords.map(doRecordToDnsProviderRecord);
    }
    case "route53": {
      return route53.setupDomainDNS(domain, dnsRecords);
    }
  }
}

/**
 * Verify that the active provider considers the domain "owned" (i.e. the
 * provider can manage DNS records for it). Used as a precondition before
 * attempting `setupDomainDNS`.
 */
export async function verifyDomainOwnership(domain: string): Promise<boolean> {
  const provider = getDnsProviderName();
  switch (provider) {
    case "digitalocean":
      return digitalocean.verifyDomainOwnership(domain);
    case "route53":
      return route53.verifyDomainOwnership(domain);
  }
}

/**
 * DigitalOcean returns native `DODomainRecord` objects (with `data` for
 * the value). Convert to the unified `DnsProviderRecord` shape.
 *
 * Note: DigitalOcean splits MX records into `priority` + host fields.
 * The host alone is not a complete DNS value, so we re-emit
 * "PRIORITY HOST" to keep parity with the upstream record shape.
 */
function doRecordToDnsProviderRecord(
  doRecord: digitalocean.DODomainRecord
): DnsProviderRecord {
  let value = doRecord.data;
  if (doRecord.type === "MX" && typeof doRecord.priority === "number") {
    value = `${doRecord.priority} ${doRecord.data}`;
  }
  return {
    type: doRecord.type,
    name: doRecord.name,
    value,
    ttl: doRecord.ttl,
  };
}
