import { NextResponse } from "next/server";
import { initializeDefaultUser } from "@/lib/auth";

export async function POST() {
  try {
    const result = await initializeDefaultUser();

    return NextResponse.json({
      success: true,
      status: result.status,
      message:
        result.status === "skipped"
          ? "ADMIN_EMAIL and ADMIN_PASSWORD not set; default user not created."
          : result.status === "exists"
            ? "Default admin user already exists."
            : "Default admin user created.",
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown setup failure";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
