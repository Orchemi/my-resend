/**
 * Unit tests for POST /api/setup — onboarding admin seed endpoint.
 *
 * The previous version swallowed `initializeDefaultUser` failures and always
 * responded 200, which gave new operators a false-positive signal even when
 * the database was unreachable. These tests pin the contract: 200 success
 * carries a structured `status`, and downstream errors yield a 500.
 *
 * @jest-environment node
 */

jest.mock("../../../../lib/auth", () => ({
  initializeDefaultUser: jest.fn(),
}));

import { POST } from "../route";
import { initializeDefaultUser } from "../../../../lib/auth";

const mockInitializeDefaultUser =
  initializeDefaultUser as jest.MockedFunction<typeof initializeDefaultUser>;

describe("POST /api/setup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 200 with status=created when a new admin user is seeded", async () => {
    mockInitializeDefaultUser.mockResolvedValueOnce({ status: "created" });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, status: "created" });
  });

  it("returns 200 with status=exists when the admin user is already present", async () => {
    mockInitializeDefaultUser.mockResolvedValueOnce({ status: "exists" });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, status: "exists" });
  });

  it("returns 200 with status=skipped when ADMIN_EMAIL/PASSWORD are unset", async () => {
    mockInitializeDefaultUser.mockResolvedValueOnce({ status: "skipped" });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, status: "skipped" });
    expect(body.message).toMatch(/ADMIN_EMAIL and ADMIN_PASSWORD/);
  });

  it("returns 500 with the underlying error message when the seed throws", async () => {
    mockInitializeDefaultUser.mockRejectedValueOnce(
      new Error("DATABASE_URL is not set. Copy .env.local.example...")
    );

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ success: false });
    expect(body.error).toMatch(/DATABASE_URL is not set/);
  });

  it("returns 500 for non-Error rejections without crashing", async () => {
    mockInitializeDefaultUser.mockRejectedValueOnce("string thrown");

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ success: false, error: "Unknown setup failure" });
  });
});
