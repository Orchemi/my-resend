import { NextRequest, NextResponse } from "next/server";
import { verifyJWT } from "@/lib/auth";
import { getDomainById } from "@/lib/domains";
import { setupDomainDNS, verifyDomainOwnership } from "@/lib/dns-provider";
import { generateDNSRecords, getDomainDkimTokens } from "@/lib/ses";

function cors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  return response;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return cors(new NextResponse(null, { status: 200 }));
  }

  try {
    // Check authorization
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return cors(
        NextResponse.json(
          { error: "Missing or invalid authorization header" },
          { status: 401 }
        )
      );
    }

    const token = authHeader.substring(7);
    const user = verifyJWT(token);
    if (!user) {
      return cors(
        NextResponse.json(
          { error: "Invalid or expired token" },
          { status: 401 }
        )
      );
    }

    const { id } = await params;
    const domain = await getDomainById(id);

    if (!domain || domain.user_id !== user.id) {
      return cors(
        NextResponse.json({ error: "Domain not found" }, { status: 404 })
      );
    }

    const domainName = domain.domain;

    try {
      // Get DKIM tokens
      let dkimTokens: string[] = [];
      try {
        dkimTokens = await getDomainDkimTokens(domainName);
        console.log(`Found ${dkimTokens.length} DKIM tokens for ${domainName}`);
      } catch (error) {
        console.log(`No DKIM tokens found for ${domainName}:`, error);
      }

      // Generate DNS records
      const dnsRecords = generateDNSRecords(
        domainName,
        domain.verification_token || "",
        dkimTokens
      );

      // Check if domain is managed by the configured DNS provider
      console.log(
        `Checking if ${domainName} is managed by configured DNS provider...`
      );
      const isDomainOwned = await verifyDomainOwnership(domainName);
      if (!isDomainOwned) {
        return cors(
          NextResponse.json(
            {
              success: false,
              error: `Domain ${domainName} is not managed by the configured DNS provider. Please add it first.`,
            },
            { status: 400 }
          )
        );
      }

      // Setup DNS via the configured DNS provider
      console.log(
        `Setting up DNS via configured DNS provider for ${domainName}...`
      );
      const createdRecords = await setupDomainDNS(domainName, dnsRecords);

      console.log(
        `Successfully created ${createdRecords.length} DNS records for ${domainName}`
      );

      return cors(
        NextResponse.json({
          success: true,
          data: {
            domain: domainName,
            createdRecords,
            setupInstructions:
              "DNS records have been successfully created/updated via the configured DNS provider.",
          },
          message: `DNS setup completed successfully for ${domainName}. Created ${createdRecords.length} records.`,
        })
      );
    } catch (error: unknown) {
      console.error(`DNS retry failed for ${domainName}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return cors(
        NextResponse.json(
          {
            success: false,
            error: `Failed to setup DNS via configured DNS provider: ${errorMessage}`,
            suggestion:
              "Please check your DNS provider credentials and permissions, then try again.",
          },
          { status: 500 }
        )
      );
    }
  } catch (error) {
    console.error("API Error:", error);
    return cors(
      NextResponse.json({ error: "Internal server error" }, { status: 500 })
    );
  }
}
