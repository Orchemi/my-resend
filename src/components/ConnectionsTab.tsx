"use client";

/**
 * Admin Connections tab — surfaces the read-only health of SES + the
 * active DNS provider in two side-by-side cards.
 *
 * Render policy (see plan 009):
 *   - Mount once: both `/api/health/ses` and `/api/health/dns` are
 *     fetched in parallel via `Promise.all`. The button issues the same
 *     pair of fetches on demand. No automatic polling — operator
 *     intent only (auto-polling is in the "후속 트랙 후보" follow-up).
 *   - Each card runs through three independent badges: `loading`
 *     (gray) -> `ok` (green) / `error` (red). One side's failure never
 *     hides the other side's data.
 *   - Only operator diagnostics are rendered: region, sandbox flag,
 *     send quota numbers, provider name, hosted-zone counts, error
 *     `name` + `message`. Never AWS access keys, DO tokens, JWTs.
 */

import React, { useCallback, useEffect, useState } from "react";

interface SesSendQuota {
  max24HourSend: number;
  maxSendRate: number;
  sentLast24Hours: number;
}

type SesHealth =
  | {
      ok: true;
      region: string;
      sandbox: boolean;
      sendingEnabled: boolean;
      enforcementStatus: string | null;
      sendQuota: SesSendQuota | null;
    }
  | {
      ok: false;
      region: string;
      error: { name: string; message: string; httpStatusCode: number | null };
    };

type DnsHealth =
  | {
      ok: true;
      provider: "digitalocean";
      detail: { domainCount: number };
    }
  | {
      ok: true;
      provider: "route53";
      detail: { hostedZoneCount: number; pinnedZoneId: string | null };
    }
  | {
      ok: false;
      provider: "digitalocean" | "route53";
      error: { name: string; message: string; httpStatusCode: number | null };
    };

type CardState<T> =
  | { state: "loading" }
  | { state: "ok"; data: T }
  | { state: "error"; message: string };

function StatusBadge({ state }: { state: CardState<unknown>["state"] }) {
  const styles: Record<CardState<unknown>["state"], string> = {
    loading: "bg-gray-100 text-gray-700",
    ok: "bg-green-100 text-green-800",
    error: "bg-red-100 text-red-800",
  };
  const labels: Record<CardState<unknown>["state"], string> = {
    loading: "loading",
    ok: "ok",
    error: "error",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[state]}`}
    >
      {labels[state]}
    </span>
  );
}

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = window.localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchHealth<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: authHeaders() });
  // The /api/health/* routes return HTTP 200 even for `ok: false`
  // (single result path policy). Non-200 means the route handler
  // itself failed — surface as a thrown error so the card flips to
  // the `error` state with a generic message.
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export default function ConnectionsTab() {
  const [ses, setSes] = useState<CardState<SesHealth>>({ state: "loading" });
  const [dns, setDns] = useState<CardState<DnsHealth>>({ state: "loading" });
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadHealth = useCallback(async () => {
    setSes({ state: "loading" });
    setDns({ state: "loading" });
    setIsRefreshing(true);

    const sesPromise = fetchHealth<SesHealth>("/api/health/ses").then(
      (data): CardState<SesHealth> => ({ state: "ok", data }),
      (err: Error): CardState<SesHealth> => ({
        state: "error",
        message: err.message || "fetch failed",
      })
    );
    const dnsPromise = fetchHealth<DnsHealth>("/api/health/dns").then(
      (data): CardState<DnsHealth> => ({ state: "ok", data }),
      (err: Error): CardState<DnsHealth> => ({
        state: "error",
        message: err.message || "fetch failed",
      })
    );

    const [sesResult, dnsResult] = await Promise.all([sesPromise, dnsPromise]);
    setSes(sesResult);
    setDns(dnsResult);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Connections</h1>
          <p className="mt-2 text-sm text-gray-700">
            Read-only health of Amazon SES and the active DNS provider. No
            domains are created and no messages are sent.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadHealth()}
          disabled={isRefreshing}
          className="mt-3 sm:mt-0 inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SesCard state={ses} />
        <DnsCard state={dns} />
      </div>
    </div>
  );
}

function SesCard({ state }: { state: CardState<SesHealth> }) {
  const badge =
    state.state === "loading"
      ? "loading"
      : state.state === "error" || (state.state === "ok" && !state.data.ok)
        ? "error"
        : "ok";

  return (
    <section
      data-testid="connections-card-ses"
      className="bg-white shadow rounded-lg p-6"
    >
      <header className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-gray-900">Amazon SES</h2>
        <StatusBadge state={badge} />
      </header>

      {state.state === "loading" && (
        <p className="text-sm text-gray-500">Probing SES account…</p>
      )}

      {state.state === "error" && (
        <ErrorBlock title="Health check failed" message={state.message} />
      )}

      {state.state === "ok" && !state.data.ok && (
        <ErrorBlock
          title={state.data.error.name}
          message={state.data.error.message}
          httpStatusCode={state.data.error.httpStatusCode}
          region={state.data.region}
        />
      )}

      {state.state === "ok" && state.data.ok && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Row label="Region" value={state.data.region} />
          <Row label="Sandbox" value={state.data.sandbox ? "yes" : "no"} />
          <Row
            label="Sending enabled"
            value={state.data.sendingEnabled ? "yes" : "no"}
          />
          <Row
            label="Enforcement"
            value={state.data.enforcementStatus ?? "—"}
          />
          {state.data.sendQuota ? (
            <>
              <Row
                label="Max 24h send"
                value={String(state.data.sendQuota.max24HourSend)}
              />
              <Row
                label="Max send rate"
                value={String(state.data.sendQuota.maxSendRate)}
              />
              <Row
                label="Sent last 24h"
                value={String(state.data.sendQuota.sentLast24Hours)}
              />
            </>
          ) : (
            <Row label="Send quota" value="not reported" />
          )}
        </dl>
      )}
    </section>
  );
}

function DnsCard({ state }: { state: CardState<DnsHealth> }) {
  const badge =
    state.state === "loading"
      ? "loading"
      : state.state === "error" || (state.state === "ok" && !state.data.ok)
        ? "error"
        : "ok";

  return (
    <section
      data-testid="connections-card-dns"
      className="bg-white shadow rounded-lg p-6"
    >
      <header className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-gray-900">DNS Provider</h2>
        <StatusBadge state={badge} />
      </header>

      {state.state === "loading" && (
        <p className="text-sm text-gray-500">Probing DNS provider…</p>
      )}

      {state.state === "error" && (
        <ErrorBlock title="Health check failed" message={state.message} />
      )}

      {state.state === "ok" && !state.data.ok && (
        <ErrorBlock
          title={state.data.error.name}
          message={state.data.error.message}
          httpStatusCode={state.data.error.httpStatusCode}
          provider={state.data.provider}
        />
      )}

      {state.state === "ok" && state.data.ok && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Row label="Provider" value={state.data.provider} />
          {state.data.provider === "digitalocean" ? (
            <Row
              label="Domains"
              value={String(state.data.detail.domainCount)}
            />
          ) : (
            <>
              <Row
                label="Hosted zones"
                value={String(state.data.detail.hostedZoneCount)}
              />
              <Row
                label="Pinned zone"
                value={state.data.detail.pinnedZoneId ?? "auto-discover"}
              />
            </>
          )}
        </dl>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900">{value}</dd>
    </>
  );
}

function ErrorBlock(props: {
  title: string;
  message: string;
  httpStatusCode?: number | null;
  region?: string;
  provider?: string;
}) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-900">
      <div className="font-medium">{props.title}</div>
      <div className="mt-1 break-words">{props.message}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 text-xs text-red-800">
        {props.region !== undefined && (
          <>
            <div className="text-red-600">Region</div>
            <div>{props.region}</div>
          </>
        )}
        {props.provider !== undefined && (
          <>
            <div className="text-red-600">Provider</div>
            <div>{props.provider}</div>
          </>
        )}
        {props.httpStatusCode !== undefined && (
          <>
            <div className="text-red-600">HTTP status</div>
            <div>{props.httpStatusCode ?? "—"}</div>
          </>
        )}
      </div>
    </div>
  );
}
