import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const SECRET_PART_COUNT = 3;
const ENCRYPTED_PREFIX = "enc:";
const PLAINTEXT_PREFIX = "plain:";

const deriveKey = (secret: string) =>
  createHash("sha256").update(`linear-token:${secret}`).digest();

const encode = (value: Buffer) => value.toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url");

export const encryptLinearSecret = (value: string, secret: string) => {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, encrypted].map(encode).join(".");
};

export const decryptLinearSecret = (value: string, secret: string) => {
  const parts = value.split(".");
  if (parts.length !== SECRET_PART_COUNT) {
    throw new Error("Stored Linear secret is malformed");
  }

  const [ivPart, authTagPart, encryptedPart] = parts as [
    string,
    string,
    string,
  ];
  const decipher = createDecipheriv(
    ALGORITHM,
    deriveKey(secret),
    decode(ivPart)
  );
  decipher.setAuthTag(decode(authTagPart));

  return Buffer.concat([
    decipher.update(decode(encryptedPart)),
    decipher.final(),
  ]).toString("utf8");
};

export const storeLinearSecret = (value: string, secret: string | null) => {
  if (!secret) {
    return `${PLAINTEXT_PREFIX}${value}`;
  }

  return `${ENCRYPTED_PREFIX}${encryptLinearSecret(value, secret)}`;
};

export const readStoredLinearSecret = (
  value: string,
  secret: string | null
) => {
  if (value.startsWith(PLAINTEXT_PREFIX)) {
    return value.slice(PLAINTEXT_PREFIX.length);
  }

  if (value.startsWith(ENCRYPTED_PREFIX)) {
    if (!secret) {
      throw new Error(
        "LINEAR_TOKEN_ENCRYPTION_SECRET is required to read the stored Linear token"
      );
    }
    return decryptLinearSecret(value.slice(ENCRYPTED_PREFIX.length), secret);
  }

  if (!secret) {
    return value;
  }

  try {
    return decryptLinearSecret(value, secret);
  } catch {
    return value;
  }
};
