import crypto from "crypto";
import fs from "fs/promises";

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

function deriveKey(password: string, salt: Buffer) {
  return crypto.scryptSync(password, salt, 32);
}

export function encrypt(text: string, password: string) {
  if (!password) return text;
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

export function decrypt(data: string, password: string) {
  if (!password) return data;
  try {
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
      return data; // Likely plaintext
    }
    const salt = buffer.subarray(0, SALT_LENGTH);
    const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const key = deriveKey(password, salt);
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch (e) {
    return data; // Fallback to plaintext if decryption fails
  }
}

// Used only for JSON file migration — reads encrypted JSON files from the old storage format
export async function readEncryptedJson(filePath: string, key: string) {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    throw e;
  }

  if (!content.trim()) return null;

  const decrypted = decrypt(content, key);
  try {
    return JSON.parse(decrypted);
  } catch {
    try {
      return JSON.parse(content);
    } catch {
      throw new Error(`Corrupt or unreadable data in ${filePath}`);
    }
  }
}
