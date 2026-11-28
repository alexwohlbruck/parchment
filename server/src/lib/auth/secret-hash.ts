import { createHash } from 'node:crypto'
import { alphabet, generateRandomString } from 'oslo/crypto'

/** How a server-issued secret is stored: hex SHA-256, never the secret itself. */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** A bearer secret with a readable kind prefix and ~238 bits of entropy. */
export function generateSecret(prefix: string): string {
  return `${prefix}${generateRandomString(40, alphabet('A-Z', 'a-z', '0-9'))}`
}
