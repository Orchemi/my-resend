import { TextEncoder } from "node:util";
import {
  SESv2Client,
  SendEmailCommand,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  CreateConfigurationSetCommand,
  PutEmailIdentityDkimAttributesCommand,
} from "@aws-sdk/client-sesv2";
import type { DnsProviderRecord } from "./dns-provider";

/**
 * Build a fresh SESv2 client per call. Mirrors the lazy pattern used in
 * `digitalocean.ts` (PR #8): credentials and region are read from
 * `process.env` at call time so credential rotation is safe and tests
 * can mutate AWS env between cases without re-importing the module.
 *
 * `SESv2Client` construction is config + middleware wiring only — no
 * network work — so per-call instantiation is negligible compared to
 * the actual `.send()` call that follows.
 */
function getSesClient(): SESv2Client {
  return new SESv2Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface SendEmailOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
  replyTo?: string[];
  tags?: Record<string, string>;
}

export type SESVerificationStatus =
  | "Pending"
  | "Success"
  | "Failed"
  | "TemporaryFailure"
  | "NotStarted";

export interface SESVerificationResult {
  verificationToken: string;
  status: SESVerificationStatus;
}

/**
 * Map v2 enum (`PENDING|SUCCESS|FAILED|TEMPORARY_FAILURE|NOT_STARTED`) to
 * v1-compatible PascalCase string preserved in the public API.
 */
function mapVerificationStatus(
  v2Status: string | undefined
): SESVerificationStatus {
  switch (v2Status) {
    case "PENDING":
      return "Pending";
    case "SUCCESS":
      return "Success";
    case "FAILED":
      return "Failed";
    case "TEMPORARY_FAILURE":
      return "TemporaryFailure";
    case "NOT_STARTED":
    case undefined:
    default:
      return "NotStarted";
  }
}

export async function sendEmail(options: SendEmailOptions): Promise<string> {
  const { from, to, cc, bcc, subject, html, text, replyTo, tags } = options;

  if (options.attachments && options.attachments.length > 0) {
    // Use raw email for attachments
    return sendRawEmail(options);
  }

  const command = new SendEmailCommand({
    FromEmailAddress: from,
    Destination: {
      ToAddresses: to,
      CcAddresses: cc,
      BccAddresses: bcc,
    },
    Content: {
      Simple: {
        Subject: {
          Data: subject,
          Charset: "UTF-8",
        },
        Body: {
          Html: html
            ? {
                Data: html,
                Charset: "UTF-8",
              }
            : undefined,
          Text: text
            ? {
                Data: text,
                Charset: "UTF-8",
              }
            : undefined,
        },
      },
    },
    ReplyToAddresses: replyTo,
    EmailTags: tags
      ? Object.entries(tags).map(([Name, Value]) => ({ Name, Value }))
      : undefined,
  });

  const response = await getSesClient().send(command);
  return response.MessageId!;
}

export async function sendRawEmail(options: SendEmailOptions): Promise<string> {
  const {
    from,
    to,
    cc,
    bcc,
    subject,
    html,
    text,
    attachments = [],
    replyTo,
  } = options;

  // Build raw email
  const boundary = `----=_NextPart_${Date.now()}_${Math.random().toString(36)}`;
  const recipients = [...to, ...(cc || []), ...(bcc || [])];

  let rawMessage = "";

  // Headers
  rawMessage += `From: ${from}\r\n`;
  rawMessage += `To: ${to.join(", ")}\r\n`;
  if (cc && cc.length > 0) rawMessage += `Cc: ${cc.join(", ")}\r\n`;
  if (replyTo && replyTo.length > 0)
    rawMessage += `Reply-To: ${replyTo.join(", ")}\r\n`;
  rawMessage += `Subject: ${subject}\r\n`;
  rawMessage += `MIME-Version: 1.0\r\n`;
  rawMessage += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;

  // Body parts
  rawMessage += `--${boundary}\r\n`;
  rawMessage += `Content-Type: multipart/alternative; boundary="${boundary}-alt"\r\n\r\n`;

  if (text) {
    rawMessage += `--${boundary}-alt\r\n`;
    rawMessage += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
    rawMessage += `${text}\r\n\r\n`;
  }

  if (html) {
    rawMessage += `--${boundary}-alt\r\n`;
    rawMessage += `Content-Type: text/html; charset=UTF-8\r\n\r\n`;
    rawMessage += `${html}\r\n\r\n`;
  }

  rawMessage += `--${boundary}-alt--\r\n`;

  // Attachments
  for (const attachment of attachments) {
    rawMessage += `--${boundary}\r\n`;
    rawMessage += `Content-Type: ${attachment.contentType}\r\n`;
    rawMessage += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
    rawMessage += `Content-Transfer-Encoding: base64\r\n\r\n`;
    rawMessage += `${attachment.content}\r\n`;
  }

  rawMessage += `--${boundary}--\r\n`;

  const command = new SendEmailCommand({
    FromEmailAddress: from,
    Destination: {
      ToAddresses: recipients,
    },
    ReplyToAddresses: replyTo,
    Content: {
      Raw: {
        Data: new TextEncoder().encode(rawMessage),
      },
    },
  });

  const response = await getSesClient().send(command);
  return response.MessageId!;
}

export async function verifyDomain(
  domain: string
): Promise<SESVerificationResult> {
  // v2 splits identity creation from verification-token retrieval. Create
  // the identity (idempotent — swallow AlreadyExistsException) then read
  // back DkimAttributes.Tokens[0] which doubles as the SES verification
  // token used in the `_amazonses.<domain>` TXT record.
  try {
    await getSesClient().send(
      new CreateEmailIdentityCommand({ EmailIdentity: domain })
    );
  } catch (error: unknown) {
    const awsError = error as { name?: string };
    if (awsError.name !== "AlreadyExistsException") {
      throw error;
    }
    // identity already present — fall through to GetEmailIdentity
  }

  const get = await getSesClient().send(
    new GetEmailIdentityCommand({ EmailIdentity: domain })
  );

  const verificationToken = get.DkimAttributes?.Tokens?.[0] ?? "";

  return {
    verificationToken,
    status: "Pending",
  };
}

export async function getDomainVerificationStatus(
  domain: string
): Promise<string> {
  const response = await getSesClient().send(
    new GetEmailIdentityCommand({ EmailIdentity: domain })
  );
  return mapVerificationStatus(response.VerificationStatus);
}

export async function enableDomainDkim(domain: string): Promise<string[]> {
  await getSesClient().send(
    new PutEmailIdentityDkimAttributesCommand({
      EmailIdentity: domain,
      SigningEnabled: true,
    })
  );

  const get = await getSesClient().send(
    new GetEmailIdentityCommand({ EmailIdentity: domain })
  );

  return get.DkimAttributes?.Tokens || [];
}

export async function getDomainDkimTokens(domain: string): Promise<string[]> {
  const response = await getSesClient().send(
    new GetEmailIdentityCommand({ EmailIdentity: domain })
  );
  return response.DkimAttributes?.Tokens || [];
}

export async function deleteDomainIdentity(domain: string): Promise<void> {
  await getSesClient().send(
    new DeleteEmailIdentityCommand({ EmailIdentity: domain })
  );
}

export async function createConfigurationSet(domain: string): Promise<string> {
  const configSetName = `my-resend-${domain.replace(/\./g, "-")}`;

  try {
    const command = new CreateConfigurationSetCommand({
      ConfigurationSetName: configSetName,
    });

    await getSesClient().send(command);

    return configSetName;
  } catch (error: unknown) {
    const awsError = error as {
      name?: string;
      message?: string;
      $metadata?: { httpStatusCode?: number };
    };
    // Handle various ways AWS might indicate the configuration set already exists
    if (
      awsError.name === "AlreadyExistsException" ||
      awsError.name === "ConfigurationSetAlreadyExistsException" ||
      awsError.message?.includes("already exists") ||
      awsError.message?.includes("Configuration set") ||
      awsError.$metadata?.httpStatusCode === 409
    ) {
      console.log(
        `Configuration set ${configSetName} already exists, continuing...`
      );
      return configSetName;
    }
    console.error("SES Configuration Set Error:", error);
    throw error;
  }
}

export function generateDNSRecords(
  domain: string,
  verificationToken: string,
  dkimTokens: string[] = []
): DnsProviderRecord[] {
  const records = [
    {
      type: "TXT",
      name: `_amazonses.${domain}`,
      value: verificationToken,
      ttl: 300,
      description: "SES Domain Verification",
    },
    {
      type: "MX",
      name: domain,
      value: "10 inbound-smtp.us-east-1.amazonaws.com.", // Trailing dot required by Digital Ocean
      ttl: 300,
      description: "SES Inbound Email",
    },
    {
      type: "TXT",
      name: domain,
      value: "v=spf1 include:amazonses.com ~all",
      ttl: 300,
      description: "SPF Record for SES",
    },
    {
      type: "TXT",
      name: `_dmarc.${domain}`,
      value: "v=DMARC1; p=quarantine; rua=mailto:dmarc@" + domain,
      ttl: 300,
      description: "DMARC Policy",
    },
  ];

  // Add DKIM CNAME records
  dkimTokens.forEach((token) => {
    records.push({
      type: "CNAME",
      name: `${token}._domainkey.${domain}`,
      value: `${token}.dkim.amazonses.com.`, // Trailing dot required
      ttl: 300,
      description: `DKIM Record (${token.substring(0, 8)}...)`,
    });
  });

  return records;
}
