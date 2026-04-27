/**
 * Component tests for ConnectionsTab — admin Connections health view.
 *
 * Strategy:
 *   - `global.fetch` is mocked per case so we drive the component into
 *     each render branch (loading -> ok / error / one-side error /
 *     refresh) without coupling to the real /api/health/* routes.
 *   - localStorage is mocked to provide an auth_token so the component's
 *     Authorization header is consistent across cases.
 *   - Every assertion includes a secret-pattern sanity check on the
 *     full rendered HTML to enforce the project secret policy
 *     (no AKIA*, no Bearer values, no secretAccessKey labels).
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import ConnectionsTab from "../ConnectionsTab";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const localStorageMock = {
  getItem: jest.fn((key: string) =>
    key === "auth_token" ? "test-jwt-token" : null
  ),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
// @ts-expect-error - mock localStorage
global.localStorage = localStorageMock;

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /AKIA[0-9A-Z]{16}/,
  /Bearer\s+[A-Za-z0-9._-]+/,
  /secretAccessKey/i,
];

function assertNoSecretsInDom(container: HTMLElement): void {
  const html = container.innerHTML;
  for (const pattern of SECRET_PATTERNS) {
    expect(html).not.toMatch(pattern);
  }
}

function buildJsonResponse(body: unknown, init: { status?: number } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  localStorageMock.getItem.mockClear();
});

describe("ConnectionsTab", () => {
  it("calls both /api/health/ses and /api/health/dns on mount", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/health/ses")) {
        return buildJsonResponse({
          ok: true,
          region: "us-east-1",
          sandbox: false,
          sendingEnabled: true,
          enforcementStatus: "HEALTHY",
          sendQuota: {
            max24HourSend: 50000,
            maxSendRate: 14,
            sentLast24Hours: 200,
          },
        });
      }
      return buildJsonResponse({
        ok: true,
        provider: "digitalocean",
        detail: { domainCount: 3 },
      });
    });

    render(<ConnectionsTab />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    const calledUrls = mockFetch.mock.calls.map((args) => args[0] as string);
    expect(calledUrls.some((u) => u.includes("/api/health/ses"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/api/health/dns"))).toBe(true);
  });

  it("renders loading state initially, then ok cards with provider data", async () => {
    let resolveSes: (value: Response) => void = () => {};
    let resolveDns: (value: Response) => void = () => {};
    const sesPromise = new Promise<Response>((r) => {
      resolveSes = r;
    });
    const dnsPromise = new Promise<Response>((r) => {
      resolveDns = r;
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/health/ses")) {
        return sesPromise;
      }
      return dnsPromise;
    });

    const { container } = render(<ConnectionsTab />);

    // Loading badges are visible before the fetches resolve.
    const loadingBadges = await screen.findAllByText(/loading/i);
    expect(loadingBadges.length).toBeGreaterThanOrEqual(2);

    resolveSes(
      buildJsonResponse({
        ok: true,
        region: "us-east-1",
        sandbox: false,
        sendingEnabled: true,
        enforcementStatus: "HEALTHY",
        sendQuota: {
          max24HourSend: 50000,
          maxSendRate: 14,
          sentLast24Hours: 200,
        },
      })
    );
    resolveDns(
      buildJsonResponse({
        ok: true,
        provider: "route53",
        detail: { hostedZoneCount: 2, pinnedZoneId: "Z123EXAMPLE" },
      })
    );

    await waitFor(() => {
      expect(screen.queryAllByText(/loading/i).length).toBe(0);
    });

    // SES card surfaces region + sendQuota / sandbox flags.
    expect(screen.getByText("us-east-1")).toBeInTheDocument();
    expect(screen.getByText("50000")).toBeInTheDocument();
    expect(screen.getByText("HEALTHY")).toBeInTheDocument();

    // DNS card surfaces provider + hostedZoneCount + pinnedZoneId.
    expect(screen.getByText("route53")).toBeInTheDocument();
    expect(screen.getByText("Z123EXAMPLE")).toBeInTheDocument();

    assertNoSecretsInDom(container);
  });

  it("renders an error badge on one card while the other reports ok (independent failure isolation)", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/health/ses")) {
        // SES network error path.
        throw new Error("network unreachable");
      }
      return buildJsonResponse({
        ok: true,
        provider: "digitalocean",
        detail: { domainCount: 4 },
      });
    });

    const { container } = render(<ConnectionsTab />);

    await waitFor(() => {
      // SES card -> error badge, DNS card -> ok badge.
      const sesCard = screen.getByTestId("connections-card-ses");
      const dnsCard = screen.getByTestId("connections-card-dns");
      expect(within(sesCard).getByText(/error/i)).toBeInTheDocument();
      expect(within(dnsCard).getByText(/ok/i)).toBeInTheDocument();
    });

    // DNS card should still show its provider data.
    expect(screen.getByText("digitalocean")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();

    assertNoSecretsInDom(container);
  });

  it("re-issues both fetches when the Refresh button is clicked", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/health/ses")) {
        return buildJsonResponse({
          ok: true,
          region: "us-east-1",
          sandbox: true,
          sendingEnabled: true,
          enforcementStatus: "HEALTHY",
          sendQuota: null,
        });
      }
      return buildJsonResponse({
        ok: true,
        provider: "digitalocean",
        detail: { domainCount: 1 },
      });
    });

    render(<ConnectionsTab />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    const refreshButton = screen.getByRole("button", { name: /refresh/i });
    const user = userEvent.setup();
    await user.click(refreshButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  it("never renders secret patterns even when the response carries an error message", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/health/ses")) {
        return buildJsonResponse({
          ok: false,
          region: "us-east-1",
          error: {
            name: "AccessDeniedException",
            message: "not authorized to perform ses:GetAccount",
            httpStatusCode: 403,
          },
        });
      }
      return buildJsonResponse({
        ok: false,
        provider: "route53",
        error: {
          name: "AccessDeniedException",
          message: "access denied for route53:ListHostedZones",
          httpStatusCode: 403,
        },
      });
    });

    const { container } = render(<ConnectionsTab />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // Error names + messages should be surfaced — they're operator
    // diagnostics, not secrets. The fetch resolves async, so wait for
    // the rendered DOM to flush past the loading state.
    await waitFor(() => {
      expect(
        screen.getAllByText(/AccessDeniedException/).length
      ).toBeGreaterThan(0);
    });
    assertNoSecretsInDom(container);
  });
});
