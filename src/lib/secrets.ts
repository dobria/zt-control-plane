import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

let cachedKey: Buffer | null = null;

export function getSecretKey() {
  if (cachedKey) return cachedKey;
  const fromEnvironment = process.env.APP_SECRET?.trim();
  if (fromEnvironment) {
    if (fromEnvironment.length < 32)
      throw new Error("APP_SECRET must contain at least 32 characters.");
    cachedKey = createHash("sha256").update(fromEnvironment, "utf8").digest();
    return cachedKey;
  }

  const dataDirectory =
    process.env.APP_DATA_DIR || path.join(process.cwd(), ".data");
  const keyPath =
    process.env.APP_SECRET_FILE || path.join(dataDirectory, "app.secret");
  mkdirSync(path.dirname(keyPath), { recursive: true });
  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  let descriptor: number | null = null;
  try {
    try {
      descriptor = openSync(
        /* turbopackIgnore: true */ keyPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | noFollow,
        0o600,
      );
      writeFileSync(descriptor, randomBytes(32).toString("hex"), "utf8");
    } catch (error) {
      if (descriptor !== null) {
        closeSync(descriptor);
        descriptor = null;
      }
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      descriptor = openSync(
        /* turbopackIgnore: true */ keyPath,
        constants.O_RDWR | noFollow,
      );
    }

    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (process.platform !== "win32" && metadata.nlink !== 1))
      throw new Error("The persistent application secret must be a regular file.");
    fchmodSync(descriptor, 0o600);
    if (metadata.size > 1024)
      throw new Error("The persistent application secret is invalid.");
    const contents = Buffer.alloc(metadata.size);
    let bytesRead = 0;
    while (bytesRead < contents.length) {
      const chunkSize = readSync(
        descriptor,
        contents,
        bytesRead,
        contents.length - bytesRead,
        bytesRead,
      );
      if (chunkSize === 0) break;
      bytesRead += chunkSize;
    }
    const stored = contents.subarray(0, bytesRead).toString("utf8").trim();
    if (!/^[0-9a-f]{64}$/i.test(stored))
      throw new Error("The persistent application secret is invalid.");
    cachedKey = Buffer.from(stored, "hex");
    return cachedKey;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

export function encryptJson(value: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptJson<T extends Record<string, unknown>>(
  payload: string,
): T {
  const [version, ivValue, tagValue, encryptedValue] = payload.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue)
    throw new Error("Encrypted credential payload is invalid.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getSecretKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export function resetSecretCacheForTests() {
  cachedKey = null;
}
