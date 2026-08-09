import {
  randomBytes,
  scrypt as nodeScrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { ValidationError } from "@/lib/validation";

const KEY_LENGTH = 64;
const CURRENT_VERSION = "v2";
const CURRENT_SCRYPT = {
  N: 2 ** 15,
  r: 8,
  p: 3,
  maxmem: 128 * 1024 * 1024,
} as const;
const LEGACY_SCRYPT = {
  N: 2 ** 14,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
} as const;
const DUMMY_PASSWORD = "invalid-login-password";
const DUMMY_SALT = Buffer.from("ztcp-dummy-salt!", "utf8");

function currentPrefix() {
  return `scrypt$${CURRENT_VERSION}$${CURRENT_SCRYPT.N}$${CURRENT_SCRYPT.r}$${CURRENT_SCRYPT.p}`;
}

function encodeCurrent(salt: Buffer, key: Buffer) {
  return `${currentPrefix()}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

function derive(
  password: string,
  salt: Buffer,
  options: typeof CURRENT_SCRYPT | typeof LEGACY_SCRYPT,
) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(password, salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

const DUMMY_PASSWORD_HASH = encodeCurrent(
  DUMMY_SALT,
  scryptSync(DUMMY_PASSWORD, DUMMY_SALT, KEY_LENGTH, CURRENT_SCRYPT),
);

export function dummyPasswordHash() {
  return DUMMY_PASSWORD_HASH;
}

export async function hashPassword(password: string) {
  if (password.length < 12)
    throw new ValidationError("Password must contain at least 12 characters.");
  const salt = randomBytes(16);
  const key = await derive(password, salt, CURRENT_SCRYPT);
  return encodeCurrent(salt, key);
}

export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  let saltValue: string;
  let keyValue: string;
  let options: typeof CURRENT_SCRYPT | typeof LEGACY_SCRYPT;
  if (parts.length === 3 && parts[0] === "scrypt") {
    [, saltValue, keyValue] = parts;
    options = LEGACY_SCRYPT;
  } else if (
    parts.length === 7 &&
    parts.slice(0, 5).join("$") === currentPrefix()
  ) {
    saltValue = parts[5];
    keyValue = parts[6];
    options = CURRENT_SCRYPT;
  } else return false;
  if (!saltValue || !keyValue) return false;
  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(keyValue, "base64url");
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, salt, options);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordHashNeedsUpgrade(encoded: string) {
  return !encoded.startsWith(`${currentPrefix()}$`);
}
