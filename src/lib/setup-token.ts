import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

let cachedToken: string | null = null;

function setupTokenPath() {
  const directory =
    process.env.APP_DATA_DIR || path.join(process.cwd(), ".data");
  return (
    process.env.APP_SETUP_TOKEN_FILE || path.join(directory, "setup.token")
  );
}

export function getSetupToken() {
  const configured = process.env.APP_SETUP_TOKEN?.trim();
  if (configured) {
    if (configured.length < 24)
      throw new Error("APP_SETUP_TOKEN must contain at least 24 characters.");
    return configured;
  }
  if (cachedToken) return cachedToken;

  const filename = setupTokenPath();
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  let created: string | null = randomBytes(24).toString("base64url");
  try {
    writeFileSync(filename, `${created}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    created = null;
  }
  if (process.platform !== "win32") chmodSync(filename, 0o600);
  cachedToken = readFileSync(
    /* turbopackIgnore: true */ filename,
    "utf8",
  ).trim();
  if (cachedToken.length < 24)
    throw new Error("The persistent setup token is invalid.");
  if (created)
    console.warn(
      `[security] First-run setup token: ${created}\n` +
        "[security] Store it securely; it is required to create the first administrator.",
    );
  return cachedToken;
}

export function verifySetupToken(candidate: unknown) {
  const supplied = typeof candidate === "string" ? candidate.trim() : "";
  const expectedHash = createHash("sha256").update(getSetupToken()).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

export function resetSetupTokenCacheForTests() {
  cachedToken = null;
}
