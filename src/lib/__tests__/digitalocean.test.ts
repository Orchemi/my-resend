/**
 * Unit tests for src/lib/digitalocean.ts (DigitalOcean DNS API wrapper).
 *
 * Strategy: jest.mock("axios", ...) intercepts the http calls so no
 * live DigitalOcean request is ever made. The wider DigitalOcean
 * surface (setup / records CRUD) is exercised indirectly by
 * `domains-dns-integration.test.ts`; this file focuses on `checkProvider`
 * as a standalone health probe.
 *
 * Env isolation: `DO_API_TOKEN` is set/torn down per case so the lazy
 * `getApiToken()` capture in digitalocean.ts sees the right value, and
 * no leak occurs across the suite.
 */
jest.mock("axios", () => ({
  __esModule: true,
  default: { create: jest.fn() },
}));

import axios from "axios";
import { checkProvider } from "../digitalocean";

const axiosCreateMock = (axios as unknown as { create: jest.Mock }).create;

const ORIGINAL_DO_API_TOKEN = process.env.DO_API_TOKEN;

function mockDoClient(impl: { get: jest.Mock }): void {
  axiosCreateMock.mockReturnValue(impl);
}

beforeEach(() => {
  axiosCreateMock.mockReset();
});

afterEach(() => {
  if (ORIGINAL_DO_API_TOKEN === undefined) {
    delete process.env.DO_API_TOKEN;
  } else {
    process.env.DO_API_TOKEN = ORIGINAL_DO_API_TOKEN;
  }
});

describe("checkProvider (DigitalOcean)", () => {
  it("returns ok=false with name='MissingToken' when DO_API_TOKEN is unset (no axios call)", async () => {
    delete process.env.DO_API_TOKEN;

    const result = await checkProvider();

    expect(result).toEqual({
      ok: false,
      provider: "digitalocean",
      error: {
        name: "MissingToken",
        message: "DO_API_TOKEN is not set",
        httpStatusCode: null,
      },
    });
    // No axios.create / no http call expected.
    expect(axiosCreateMock).not.toHaveBeenCalled();
  });

  it("returns ok=true with detail.domainCount when the token is valid and the API responds 200", async () => {
    process.env.DO_API_TOKEN = "do-test-token-XXXXXXXXXXXXXXXX";
    const get = jest.fn().mockResolvedValue({
      data: {
        domains: [
          { name: "example.com", zone_file: "" },
          { name: "example.org", zone_file: "" },
          { name: "example.net", zone_file: "" },
        ],
      },
    });
    mockDoClient({ get });

    const result = await checkProvider();

    expect(result).toEqual({
      ok: true,
      provider: "digitalocean",
      detail: { domainCount: 3 },
    });
    expect(get).toHaveBeenCalledWith("/domains");
  });

  it("returns ok=false with httpStatusCode=401 when the API rejects the token", async () => {
    process.env.DO_API_TOKEN = "do-test-token-XXXXXXXXXXXXXXXX";
    const axiosErr = Object.assign(new Error("Request failed with status code 401"), {
      name: "AxiosError",
      response: { status: 401 },
    });
    const get = jest.fn().mockRejectedValue(axiosErr);
    mockDoClient({ get });

    const result = await checkProvider();

    expect(result).toEqual({
      ok: false,
      provider: "digitalocean",
      error: {
        name: "AxiosError",
        message: "Request failed with status code 401",
        httpStatusCode: 401,
      },
    });

    // Sanity: serialized form must NOT contain the literal token (no
    // header/body echo).
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("do-test-token-XXXXXXXXXXXXXXXX");
    expect(serialized).not.toMatch(/Bearer\s+/);
  });
});
