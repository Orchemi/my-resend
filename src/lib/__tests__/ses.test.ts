/**
 * Unit tests for src/lib/ses.ts (SES SDK v2 wrapper).
 *
 * Strategy: aws-sdk-client-mock intercepts SESv2Client.send() calls so no
 * live AWS request is ever made. Tests verify command input mapping (v1
 * shape -> v2 shape) and response unwrapping (v2 shape -> v1-compatible
 * external return shape preserved by ses.ts).
 */
import { TextDecoder } from "node:util";
import { mockClient } from "aws-sdk-client-mock";
import {
  SESv2Client,
  CreateConfigurationSetCommand,
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityDkimAttributesCommand,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";

import {
  createConfigurationSet,
  deleteDomainIdentity,
  enableDomainDkim,
  getDomainDkimTokens,
  getDomainVerificationStatus,
  sendEmail,
  sendRawEmail,
  verifyDomain,
} from "../ses";

const sesMock = mockClient(SESv2Client);

beforeEach(() => {
  sesMock.reset();
});

describe("deleteDomainIdentity", () => {
  it("issues DeleteEmailIdentityCommand with EmailIdentity = domain", async () => {
    sesMock.on(DeleteEmailIdentityCommand).resolves({});

    await deleteDomainIdentity("example.com");

    const calls = sesMock.commandCalls(DeleteEmailIdentityCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({ EmailIdentity: "example.com" });
  });

  it("propagates AWS errors", async () => {
    const err = new Error("not found");
    sesMock.on(DeleteEmailIdentityCommand).rejects(err);

    await expect(deleteDomainIdentity("nope.com")).rejects.toThrow("not found");
  });
});

describe("createConfigurationSet", () => {
  it("issues CreateConfigurationSetCommand with top-level ConfigurationSetName", async () => {
    sesMock.on(CreateConfigurationSetCommand).resolves({});

    const name = await createConfigurationSet("example.com");

    expect(name).toBe("my-resend-example-com");
    const calls = sesMock.commandCalls(CreateConfigurationSetCommand);
    expect(calls).toHaveLength(1);
    // v2 input: ConfigurationSetName at top level (not v1 ConfigurationSet:{Name})
    expect(calls[0].args[0].input).toMatchObject({
      ConfigurationSetName: "my-resend-example-com",
    });
    // Negative assertion: v1-style nested key must NOT be present
    expect(
      (calls[0].args[0].input as Record<string, unknown>).ConfigurationSet
    ).toBeUndefined();
  });

  it("converts dots to dashes in config set name", async () => {
    sesMock.on(CreateConfigurationSetCommand).resolves({});

    const name = await createConfigurationSet("mail.example.com");

    expect(name).toBe("my-resend-mail-example-com");
  });

  it("swallows AlreadyExistsException and still returns the name", async () => {
    const err = Object.assign(new Error("exists"), {
      name: "AlreadyExistsException",
    });
    sesMock.on(CreateConfigurationSetCommand).rejects(err);

    const name = await createConfigurationSet("example.com");

    expect(name).toBe("my-resend-example-com");
  });

  it("swallows ConfigurationSetAlreadyExistsException", async () => {
    const err = Object.assign(new Error("exists"), {
      name: "ConfigurationSetAlreadyExistsException",
    });
    sesMock.on(CreateConfigurationSetCommand).rejects(err);

    await expect(createConfigurationSet("example.com")).resolves.toBe(
      "my-resend-example-com"
    );
  });

  it("swallows 409 http status code", async () => {
    const err = Object.assign(new Error("conflict"), {
      $metadata: { httpStatusCode: 409 },
    });
    sesMock.on(CreateConfigurationSetCommand).rejects(err);

    await expect(createConfigurationSet("example.com")).resolves.toBe(
      "my-resend-example-com"
    );
  });

  it("rethrows unrelated errors", async () => {
    const err = Object.assign(new Error("network down"), {
      name: "NetworkingError",
    });
    sesMock.on(CreateConfigurationSetCommand).rejects(err);

    await expect(createConfigurationSet("example.com")).rejects.toThrow(
      "network down"
    );
  });
});

describe("getDomainDkimTokens", () => {
  it("issues GetEmailIdentityCommand and extracts DkimAttributes.Tokens", async () => {
    sesMock.on(GetEmailIdentityCommand).resolves({
      DkimAttributes: {
        Tokens: ["tokenA", "tokenB", "tokenC"],
      },
    });

    const tokens = await getDomainDkimTokens("example.com");

    expect(tokens).toEqual(["tokenA", "tokenB", "tokenC"]);
    const calls = sesMock.commandCalls(GetEmailIdentityCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({ EmailIdentity: "example.com" });
  });

  it("returns [] when DkimAttributes is undefined", async () => {
    sesMock.on(GetEmailIdentityCommand).resolves({});

    const tokens = await getDomainDkimTokens("example.com");

    expect(tokens).toEqual([]);
  });

  it("returns [] when Tokens is undefined", async () => {
    sesMock.on(GetEmailIdentityCommand).resolves({
      DkimAttributes: { SigningEnabled: false },
    });

    const tokens = await getDomainDkimTokens("example.com");

    expect(tokens).toEqual([]);
  });
});

describe("getDomainVerificationStatus", () => {
  // Map v2 enum (UPPER_SNAKE) -> v1 PascalCase preserved by the wrapper.
  const cases: Array<[string | undefined, string]> = [
    ["PENDING", "Pending"],
    ["SUCCESS", "Success"],
    ["FAILED", "Failed"],
    ["TEMPORARY_FAILURE", "TemporaryFailure"],
    ["NOT_STARTED", "NotStarted"],
    [undefined, "NotStarted"],
  ];

  it.each(cases)(
    "maps v2 status %s to v1 status %s",
    async (v2Status, expected) => {
      sesMock.on(GetEmailIdentityCommand).resolves({
        VerificationStatus: v2Status as
          | "PENDING"
          | "SUCCESS"
          | "FAILED"
          | "TEMPORARY_FAILURE"
          | "NOT_STARTED"
          | undefined,
      });

      const status = await getDomainVerificationStatus("example.com");

      expect(status).toBe(expected);
    }
  );

  it("issues GetEmailIdentityCommand with EmailIdentity (v2 key)", async () => {
    sesMock.on(GetEmailIdentityCommand).resolves({
      VerificationStatus: "SUCCESS",
    });

    await getDomainVerificationStatus("example.com");

    const calls = sesMock.commandCalls(GetEmailIdentityCommand);
    expect(calls[0].args[0].input).toEqual({ EmailIdentity: "example.com" });
  });
});

describe("verifyDomain", () => {
  it("creates identity then reads back tokens, preserving v1 return shape", async () => {
    sesMock.on(CreateEmailIdentityCommand).resolves({});
    sesMock.on(GetEmailIdentityCommand).resolves({
      DkimAttributes: {
        Tokens: ["tok1", "tok2", "tok3"],
      },
      VerificationStatus: "PENDING",
    });

    const result = await verifyDomain("example.com");

    // External shape preserved: { verificationToken, status: "Pending" }
    expect(result).toEqual({
      verificationToken: "tok1",
      status: "Pending",
    });

    const createCalls = sesMock.commandCalls(CreateEmailIdentityCommand);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].args[0].input).toEqual({
      EmailIdentity: "example.com",
    });

    const getCalls = sesMock.commandCalls(GetEmailIdentityCommand);
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0].args[0].input).toEqual({ EmailIdentity: "example.com" });
  });

  it("falls through to GetEmailIdentity when AlreadyExistsException is thrown", async () => {
    const exists = Object.assign(new Error("identity exists"), {
      name: "AlreadyExistsException",
    });
    sesMock.on(CreateEmailIdentityCommand).rejects(exists);
    sesMock.on(GetEmailIdentityCommand).resolves({
      DkimAttributes: { Tokens: ["existing-token"] },
    });

    const result = await verifyDomain("example.com");

    expect(result.verificationToken).toBe("existing-token");
    expect(result.status).toBe("Pending");
  });

  it("rethrows non-AlreadyExists errors from CreateEmailIdentity", async () => {
    const err = Object.assign(new Error("limit exceeded"), {
      name: "LimitExceededException",
    });
    sesMock.on(CreateEmailIdentityCommand).rejects(err);

    await expect(verifyDomain("example.com")).rejects.toThrow("limit exceeded");
    // Get must not be called when create rejects with unrelated error
    expect(sesMock.commandCalls(GetEmailIdentityCommand)).toHaveLength(0);
  });

  it("returns empty verificationToken when no DKIM tokens are present", async () => {
    sesMock.on(CreateEmailIdentityCommand).resolves({});
    sesMock.on(GetEmailIdentityCommand).resolves({});

    const result = await verifyDomain("example.com");

    expect(result.verificationToken).toBe("");
    expect(result.status).toBe("Pending");
  });
});

describe("enableDomainDkim", () => {
  it("calls Put then Get and returns DKIM tokens array", async () => {
    sesMock.on(PutEmailIdentityDkimAttributesCommand).resolves({});
    sesMock.on(GetEmailIdentityCommand).resolves({
      DkimAttributes: { Tokens: ["k1", "k2", "k3"] },
    });

    const tokens = await enableDomainDkim("example.com");

    expect(tokens).toEqual(["k1", "k2", "k3"]);

    const putCalls = sesMock.commandCalls(PutEmailIdentityDkimAttributesCommand);
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].args[0].input).toEqual({
      EmailIdentity: "example.com",
      SigningEnabled: true,
    });

    const getCalls = sesMock.commandCalls(GetEmailIdentityCommand);
    expect(getCalls).toHaveLength(1);
    expect(getCalls[0].args[0].input).toEqual({ EmailIdentity: "example.com" });
  });

  it("returns [] when Get response has no Tokens", async () => {
    sesMock.on(PutEmailIdentityDkimAttributesCommand).resolves({});
    sesMock.on(GetEmailIdentityCommand).resolves({});

    const tokens = await enableDomainDkim("example.com");

    expect(tokens).toEqual([]);
  });

  it("propagates errors from PutEmailIdentityDkimAttributes", async () => {
    sesMock
      .on(PutEmailIdentityDkimAttributesCommand)
      .rejects(new Error("not authorized"));

    await expect(enableDomainDkim("example.com")).rejects.toThrow(
      "not authorized"
    );
    // Get must not be called when Put rejects
    expect(sesMock.commandCalls(GetEmailIdentityCommand)).toHaveLength(0);
  });
});

describe("sendEmail (Simple content)", () => {
  it("maps options to v2 SendEmailCommand input (FromEmailAddress / Content.Simple / EmailTags)", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-abc" });

    const id = await sendEmail({
      from: "no-reply@example.com",
      to: ["alice@x.com", "bob@y.com"],
      cc: ["cc1@z.com"],
      bcc: ["bcc1@z.com"],
      subject: "Hello",
      html: "<p>hi</p>",
      text: "hi",
      replyTo: ["reply@example.com"],
      tags: { type: "test", env: "ci" },
    });

    expect(id).toBe("msg-abc");

    const calls = sesMock.commandCalls(SendEmailCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;

    expect(input).toMatchObject({
      FromEmailAddress: "no-reply@example.com",
      Destination: {
        ToAddresses: ["alice@x.com", "bob@y.com"],
        CcAddresses: ["cc1@z.com"],
        BccAddresses: ["bcc1@z.com"],
      },
      ReplyToAddresses: ["reply@example.com"],
      Content: {
        Simple: {
          Subject: { Data: "Hello", Charset: "UTF-8" },
          Body: {
            Html: { Data: "<p>hi</p>", Charset: "UTF-8" },
            Text: { Data: "hi", Charset: "UTF-8" },
          },
        },
      },
      EmailTags: [
        { Name: "type", Value: "test" },
        { Name: "env", Value: "ci" },
      ],
    });

    // v1 keys must NOT leak through
    const inputAsRecord = input as Record<string, unknown>;
    expect(inputAsRecord.Source).toBeUndefined();
    expect(inputAsRecord.Message).toBeUndefined();
    expect(inputAsRecord.Tags).toBeUndefined();
  });

  it("omits Html when only text is provided", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-1" });

    await sendEmail({
      from: "from@x.com",
      to: ["to@x.com"],
      subject: "S",
      text: "T",
    });

    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.Content?.Simple?.Body?.Html).toBeUndefined();
    expect(input.Content?.Simple?.Body?.Text).toEqual({
      Data: "T",
      Charset: "UTF-8",
    });
  });

  it("omits Text when only html is provided", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-1" });

    await sendEmail({
      from: "from@x.com",
      to: ["to@x.com"],
      subject: "S",
      html: "<b>H</b>",
    });

    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.Content?.Simple?.Body?.Text).toBeUndefined();
    expect(input.Content?.Simple?.Body?.Html).toEqual({
      Data: "<b>H</b>",
      Charset: "UTF-8",
    });
  });

  it("omits EmailTags when no tags supplied", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-1" });

    await sendEmail({
      from: "from@x.com",
      to: ["to@x.com"],
      subject: "S",
      text: "T",
    });

    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    expect(input.EmailTags).toBeUndefined();
  });

  it("delegates to sendRawEmail when attachments are present", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "raw-msg" });

    const id = await sendEmail({
      from: "from@x.com",
      to: ["to@x.com"],
      subject: "S",
      text: "T",
      attachments: [
        {
          filename: "a.txt",
          content: Buffer.from("hello").toString("base64"),
          contentType: "text/plain",
        },
      ],
    });

    expect(id).toBe("raw-msg");
    // Single SendEmailCommand call, but with Raw content (delegated branch)
    const calls = sesMock.commandCalls(SendEmailCommand);
    expect(calls).toHaveLength(1);
    const data = calls[0].args[0].input.Content?.Raw?.Data;
    // node:util's TextEncoder returns a Uint8Array, but cross-realm checks
    // (jsdom vs node) can break instanceof. Duck-type instead.
    expect(data).toBeDefined();
    expect(typeof (data as Uint8Array).byteLength).toBe("number");
    expect((data as Uint8Array).byteLength).toBeGreaterThan(0);
    expect(calls[0].args[0].input.Content?.Simple).toBeUndefined();
  });
});

describe("sendRawEmail (Raw content)", () => {
  it("issues v2 SendEmailCommand with FromEmailAddress + Destination.ToAddresses + Content.Raw", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "raw-1" });

    const id = await sendRawEmail({
      from: "from@x.com",
      to: ["to1@x.com", "to2@x.com"],
      cc: ["cc1@x.com"],
      bcc: ["bcc1@x.com"],
      subject: "Subj",
      html: "<p>html</p>",
      text: "text",
      replyTo: ["reply@x.com"],
      attachments: [
        {
          filename: "a.txt",
          content: Buffer.from("hi").toString("base64"),
          contentType: "text/plain",
        },
      ],
    });

    expect(id).toBe("raw-1");

    const calls = sesMock.commandCalls(SendEmailCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;

    expect(input.FromEmailAddress).toBe("from@x.com");
    // v2 puts all recipients (to+cc+bcc) into Destination.ToAddresses for raw
    // because the actual envelope is in the MIME headers; we mirror v1
    // behavior of flattening recipients.
    expect(input.Destination?.ToAddresses).toEqual([
      "to1@x.com",
      "to2@x.com",
      "cc1@x.com",
      "bcc1@x.com",
    ]);
    expect(input.ReplyToAddresses).toEqual(["reply@x.com"]);

    // Raw content present, Simple absent
    expect(input.Content?.Raw?.Data).toBeDefined();
    expect(input.Content?.Simple).toBeUndefined();

    // v1-style top-level keys must not leak
    const inputAsRecord = input as Record<string, unknown>;
    expect(inputAsRecord.Source).toBeUndefined();
    expect(inputAsRecord.Destinations).toBeUndefined();
    expect(inputAsRecord.RawMessage).toBeUndefined();

    // Sanity-check the MIME body still contains expected headers
    const decoded = new TextDecoder().decode(
      input.Content?.Raw?.Data as Uint8Array
    );
    expect(decoded).toContain("From: from@x.com");
    expect(decoded).toContain("To: to1@x.com, to2@x.com");
    expect(decoded).toContain("Cc: cc1@x.com");
    expect(decoded).toContain("Reply-To: reply@x.com");
    expect(decoded).toContain("Subject: Subj");
    expect(decoded).toContain("filename=\"a.txt\"");
  });

  it("omits Cc and Reply-To headers when not supplied", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "raw-2" });

    await sendRawEmail({
      from: "from@x.com",
      to: ["to@x.com"],
      subject: "S",
      text: "T",
    });

    const input = sesMock.commandCalls(SendEmailCommand)[0].args[0].input;
    const decoded = new TextDecoder().decode(
      input.Content?.Raw?.Data as Uint8Array
    );
    expect(decoded).not.toContain("Cc:");
    expect(decoded).not.toContain("Reply-To:");
  });
});
