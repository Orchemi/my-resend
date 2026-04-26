// Seed env vars that some src/lib/*.ts modules read at module-load time
// (before any test code can run). Test cases may still override these
// via process.env mutations + module re-import patterns where needed.
process.env.DO_API_TOKEN = process.env.DO_API_TOKEN || "test-do-token";
process.env.AWS_REGION = process.env.AWS_REGION || "us-east-1";
