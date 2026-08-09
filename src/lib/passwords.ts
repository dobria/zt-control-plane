import {
  randomBytes,
  scrypt as nodeScrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { ValidationError } from "@/lib/validation";

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;
const DUMMY_PASSWORD = "invalid-login-password";
const DUMMY_SALT = Buffer.from("ztcp-dummy-salt!", "utf8");
const DUMMY_PASSWORD_HASH = `scrypt$${DUMMY_SALT.toString("base64url")}$${scryptSync(
  DUMMY_PASSWORD,
  DUMMY_SALT,
  KEY_LENGTH,
).toString("base64url")}`;

export function dummyPasswordHash() {
  return DUMMY_PASSWORD_HASH;
}

export async function hashPassword(password: string) {
  if (password.length < 12)
    throw new ValidationError("Password must contain at least 12 characters.");
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [scheme, saltValue, keyValue] = encoded.split("$");
  if (scheme !== "scrypt" || !saltValue || !keyValue) return false;
  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(keyValue, "base64url");
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
