import { Pool, PoolClient } from "pg";

// Pool is constructed lazily so importing this module does not require
// DATABASE_URL — but the first real use throws with a clear, actionable
// message. Without this guard, `pg` silently falls back to libpq defaults
// (PGHOST/PGPORT/PGUSER) and can connect to an unrelated local Postgres.
let _pool: Pool | undefined;

export function getPool(): Pool {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.local.example to .env.local and set DATABASE_URL — see SETUP.md § 3."
    );
  }
  _pool = new Pool({
    connectionString,
    ssl: resolveSsl(connectionString),
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
  return _pool;
}

/**
 * Decide the pg `ssl` option from libpq conventions instead of forcing it on.
 *
 * Precedence: PGSSLMODE env → `sslmode` query param in DATABASE_URL → disabled.
 *
 * - `disable` / `allow` (or unset) → `false` (plain TCP). Required for local
 *   Docker Postgres and any instance that does not terminate TLS.
 * - `require` / `prefer` → `{ rejectUnauthorized: false }`. The TLS layer is
 *   used but server-cert verification is skipped — sufficient for managed
 *   Postgres (RDS, Neon, Render) that ship public certs without bundling a CA.
 * - `verify-ca` / `verify-full` → `{ rejectUnauthorized: true }`. Caller is
 *   responsible for providing CA via `PGSSLROOTCERT` if a custom chain is in
 *   play; we leave that to libpq's own resolution path.
 */
function resolveSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
  const mode = (process.env.PGSSLMODE ?? extractSslMode(connectionString) ?? "").toLowerCase();
  if (!mode || mode === "disable" || mode === "allow") return false;
  if (mode === "verify-ca" || mode === "verify-full") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

function extractSslMode(connectionString: string): string | null {
  try {
    return new URL(connectionString).searchParams.get("sslmode");
  } catch {
    return null;
  }
}

// Helper function for single queries
export async function query(text: string, params?: unknown[]) {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

// Helper function for transactions
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Database types (kept from Supabase version)
export interface User {
  id: string;
  email: string;
  password_hash: string;
  name?: string;
  created_at: string;
  updated_at: string;
}

export interface Domain {
  id: string;
  user_id: string;
  domain: string;
  status: "pending" | "verified" | "failed";
  ses_identity_arn?: string;
  verification_token?: string;
  ses_configuration_set?: string;
  do_domain_id?: string;
  dns_records: unknown[];
  smtp_credentials?: {
    username: string;
    password: string;
    server: string;
    port: number;
  };
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  user_id: string;
  domain_id: string;
  key_name: string;
  key_hash: string;
  key_prefix: string;
  permissions: string[];
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

export interface EmailLog {
  id: string;
  api_key_id?: string;
  domain_id: string;
  message_id?: string;
  from_email: string;
  to_emails: string[];
  cc_emails: string[];
  bcc_emails: string[];
  subject?: string;
  html_content?: string;
  text_content?: string;
  attachments: unknown[];
  status:
    | "pending"
    | "sent"
    | "failed"
    | "delivered"
    | "bounced"
    | "complained";
  ses_message_id?: string;
  error_message?: string;
  webhook_data?: unknown;
  created_at: string;
  updated_at: string;
}

export interface WebhookEvent {
  id: string;
  email_log_id: string;
  event_type: string;
  event_data: unknown;
  processed: boolean;
  created_at: string;
}

// Test database connection
export async function testConnection(): Promise<boolean> {
  try {
    const result = await query("SELECT NOW() as current_time");
    console.log("Database connected successfully:", result.rows[0]);
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
}

// Graceful shutdown
export async function closeDatabase(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
}

