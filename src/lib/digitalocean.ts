import axios, { type AxiosInstance } from "axios";

const DO_API_BASE = "https://api.digitalocean.com/v2";

/**
 * Read the DigitalOcean API token at call time rather than module-load
 * time. Module-load capture made tests fragile (env had to be seeded
 * before any import that transitively pulled this module) and prevented
 * the token from being rotated in long-running processes.
 */
function getApiToken(): string | undefined {
  return process.env.DO_API_TOKEN;
}

/**
 * Build a fresh axios client per call so the `Authorization` header
 * always reflects the current `DO_API_TOKEN`. `axios.create` is cheap
 * (a config + interceptor wrapper, no network), so the per-call cost
 * is negligible relative to the HTTP request itself.
 */
function getDoClient(): AxiosInstance {
  return axios.create({
    baseURL: DO_API_BASE,
    headers: {
      Authorization: `Bearer ${getApiToken()}`,
      "Content-Type": "application/json",
    },
    timeout: 10000, // 10 second timeout
  });
}

// Helper function to add retry logic with exponential backoff
async function retryRequest<T>(
  requestFn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error: unknown) {
      lastError = error;
      const axiosError = error as { response?: { status?: number } };

      // Don't retry on non-rate-limiting errors
      if (axiosError.response?.status !== 429 && attempt === 0) {
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }

      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.log(
        `DO API rate limited, retrying in ${Math.round(delay)}ms (attempt ${
          attempt + 1
        }/${maxRetries + 1})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export interface DNSRecord {
  type: string;
  name: string;
  value: string;
  ttl: number;
  description?: string;
}

export interface DODomainRecord {
  id: number;
  type: string;
  name: string;
  data: string;
  priority?: number;
  port?: number;
  ttl: number;
  weight?: number;
  flags?: number;
  tag?: string;
}

export interface DODomain {
  name: string;
  ttl?: number;
  zone_file: string;
}

export async function getDomains(): Promise<DODomain[]> {
  if (!getApiToken()) {
    throw new Error("Digital Ocean API token not configured");
  }

  try {
    const response = await retryRequest(async () => {
      return await getDoClient().get("/domains");
    });
    return response.data.domains;
  } catch (error: unknown) {
    const axiosError = error as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    throw new Error(
      `Failed to fetch domains: ${
        axiosError.response?.data?.message || axiosError.message
      }`
    );
  }
}

export async function getDomainRecords(
  domain: string
): Promise<DODomainRecord[]> {
  if (!getApiToken()) {
    throw new Error("Digital Ocean API token not configured");
  }

  try {
    const response = await retryRequest(async () => {
      return await getDoClient().get(`/domains/${domain}/records`);
    });
    return response.data.domain_records;
  } catch (error: unknown) {
    const axiosError = error as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    throw new Error(
      `Failed to fetch domain records: ${
        axiosError.response?.data?.message || axiosError.message
      }`
    );
  }
}

export async function createDNSRecord(
  domain: string,
  record: DNSRecord
): Promise<DODomainRecord> {
  if (!getApiToken()) {
    throw new Error("Digital Ocean API token not configured");
  }

  try {
    const payload = {
      type: record.type,
      name:
        record.name === domain ? "@" : record.name.replace(`.${domain}`, ""),
      data: record.value,
      ttl: record.ttl,
    };

    // Handle MX records priority
    if (record.type === "MX") {
      const parts = record.value.split(" ");
      if (parts.length >= 2) {
        let hostname = parts.slice(1).join(" ");
        // Ensure MX record hostname ends with a dot (required by Digital Ocean)
        if (!hostname.endsWith(".")) {
          hostname += ".";
        }
        payload.data = hostname;
        (
          payload as {
            data: string;
            priority: number;
            type: string;
            name: string;
            ttl: number;
          }
        ).priority = parseInt(parts[0]);
      }
    }

    const response = await retryRequest(async () => {
      return await getDoClient().post(`/domains/${domain}/records`, payload);
    });
    return response.data.domain_record;
  } catch (error: unknown) {
    const axiosError = error as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    throw new Error(
      `Failed to create DNS record: ${
        axiosError.response?.data?.message || axiosError.message
      }`
    );
  }
}

export async function updateDNSRecord(
  domain: string,
  recordId: number,
  record: Partial<DNSRecord>
): Promise<DODomainRecord> {
  if (!getApiToken()) {
    throw new Error("Digital Ocean API token not configured");
  }

  try {
    const payload: Record<string, unknown> = {};

    if (record.name) {
      payload.name =
        record.name === domain ? "@" : record.name.replace(`.${domain}`, "");
    }
    if (record.value) payload.data = record.value;
    if (record.ttl) payload.ttl = record.ttl;
    if (record.type) payload.type = record.type;

    const response = await getDoClient().put(
      `/domains/${domain}/records/${recordId}`,
      payload
    );
    return response.data.domain_record;
  } catch (error: unknown) {
    const axiosError = error as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    throw new Error(
      `Failed to update DNS record: ${
        axiosError.response?.data?.message || axiosError.message
      }`
    );
  }
}

export async function deleteDNSRecord(
  domain: string,
  recordId: number
): Promise<void> {
  if (!getApiToken()) {
    throw new Error("Digital Ocean API token not configured");
  }

  try {
    await getDoClient().delete(`/domains/${domain}/records/${recordId}`);
  } catch (error: unknown) {
    const axiosError = error as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    throw new Error(
      `Failed to delete DNS record: ${
        axiosError.response?.data?.message || axiosError.message
      }`
    );
  }
}

export async function setupDomainDNS(
  domain: string,
  dnsRecords: DNSRecord[]
): Promise<DODomainRecord[]> {
  if (!getApiToken()) {
    console.warn(
      "Digital Ocean API not configured. DNS records need to be created manually."
    );
    return [];
  }

  // Add random delay to avoid concurrent calls from multiple replicas
  const replicaDelay = Math.random() * 2000; // 0-2 seconds
  console.log(
    `Waiting ${Math.round(replicaDelay)}ms to coordinate between replicas...`
  );
  await new Promise((resolve) => setTimeout(resolve, replicaDelay));

  try {
    // First, check if the domain exists in Digital Ocean
    const domains = await getDomains();
    const domainExists = domains.some((d) => d.name === domain);

    if (!domainExists) {
      throw new Error(
        `Domain ${domain} not found in Digital Ocean. Please add it first.`
      );
    }

    // Get existing records to avoid duplicates
    const existingRecords = await getDomainRecords(domain);

    const createdRecords: DODomainRecord[] = [];

    for (const record of dnsRecords) {
      try {
        // Check if record already exists
        const recordName =
          record.name === domain ? "@" : record.name.replace(`.${domain}`, "");

        // For CNAME records, check if ANY record exists with that name (CNAME conflict)
        // For other records, check for exact match
        const recordExists =
          record.type === "CNAME"
            ? existingRecords.some((existing) => existing.name === recordName)
            : existingRecords.some(
                (existing) =>
                  existing.type === record.type &&
                  existing.name === recordName &&
                  existing.data === record.value
              );

        if (!recordExists) {
          const createdRecord = await createDNSRecord(domain, record);
          createdRecords.push(createdRecord);
          console.log(`Created ${record.type} record for ${record.name}`);
        } else {
          if (record.type === "CNAME") {
            const existingRecord = existingRecords.find(
              (existing) => existing.name === recordName
            );

            // Normalize values for comparison (handle trailing dots)
            const normalizeValue = (value: string) =>
              value.endsWith(".") ? value.slice(0, -1) : value;
            const existingValue = existingRecord
              ? normalizeValue(existingRecord.data)
              : "";
            const expectedValue = normalizeValue(record.value);

            if (existingRecord && existingValue !== expectedValue) {
              console.log(
                `CNAME record for ${record.name} exists but points to different value. Existing: ${existingRecord.data}, Expected: ${record.value}`
              );
              // Optionally update the record here if needed
            } else {
              console.log(
                `CNAME record for ${record.name} already exists with correct value`
              );
            }
          } else {
            console.log(
              `${record.type} record for ${record.name} already exists`
            );
          }
        }

        // Longer delay to avoid rate limiting (especially with multiple replicas)
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Failed to create DNS record for ${record.name}:`, error);
        // Continue with other records even if one fails
      }
    }

    return createdRecords;
  } catch (error: unknown) {
    const errorObj = error as { message?: string };
    throw new Error(`Failed to setup domain DNS: ${errorObj.message}`);
  }
}

export async function verifyDomainOwnership(domain: string): Promise<boolean> {
  if (!getApiToken()) {
    return false;
  }

  try {
    const domains = await getDomains();
    return domains.some((d) => d.name === domain);
  } catch (error: unknown) {
    console.error("Failed to verify domain ownership:", error);
    return false;
  }
}

export function formatDNSInstructions(dnsRecords: DNSRecord[]): string {
  let instructions =
    "Please create the following DNS records in your domain provider:\n\n";

  dnsRecords.forEach((record, index) => {
    instructions += `${index + 1}. ${record.type} Record:\n`;
    instructions += `   Name: ${record.name}\n`;
    instructions += `   Value: ${record.value}\n`;
    instructions += `   TTL: ${record.ttl}\n`;
    if (record.description) {
      instructions += `   Purpose: ${record.description}\n`;
    }
    instructions += "\n";
  });

  return instructions;
}
