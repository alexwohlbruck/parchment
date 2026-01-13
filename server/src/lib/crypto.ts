import * as ed from '@noble/ed25519'

// Use the synchronous sha512 from @noble/hashes
// For Bun/Node.js environments, we need to set up the sha512 function
import { sha512 } from '@noble/hashes/sha2.js'
ed.hashes.sha512 = (...m) => sha512(ed.etc.concatBytes(...m))

/**
 * Verify an Ed25519 signature
 * @param message - The original message that was signed
 * @param signature - Base64-encoded signature
 * @param publicKey - Base64-encoded Ed25519 public key
 * @returns true if signature is valid
 */
export function verifySignature(
  message: string,
  signature: string,
  publicKey: string,
): boolean {
  try {
    const messageBytes = new TextEncoder().encode(message)
    const signatureBytes = base64ToBytes(signature)
    const publicKeyBytes = base64ToBytes(publicKey)

    return ed.verify(signatureBytes, messageBytes, publicKeyBytes)
  } catch (error) {
    console.error('Signature verification failed:', error)
    return false
  }
}

/**
 * Sign a message with an Ed25519 private key (for testing/internal use)
 * In production, signing should happen client-side
 * @param message - The message to sign
 * @param privateKey - Base64-encoded Ed25519 private key (seed)
 * @returns Base64-encoded signature
 */
export async function signMessage(
  message: string,
  privateKey: string,
): Promise<string> {
  const messageBytes = new TextEncoder().encode(message)
  const privateKeyBytes = base64ToBytes(privateKey)
  const signature = await ed.signAsync(messageBytes, privateKeyBytes)
  return bytesToBase64(signature)
}

/**
 * Build a canonical message string for signing federation messages
 * This ensures consistent message format across servers
 * @param type - Message type (e.g., 'FRIEND_INVITE', 'FRIEND_ACCEPT')
 * @param payload - Message payload object
 * @returns Canonical string representation for signing
 */
export function buildSignableMessage(type: string, payload: object): string {
  // Sort keys and stringify for consistent ordering
  const sortedPayload = sortObjectKeys(payload)
  return JSON.stringify({
    type,
    ...sortedPayload,
  })
}

/**
 * Parse and validate a federation handle (alias@domain)
 * @param handle - Full handle string
 * @returns Parsed handle parts or null if invalid
 */
export function parseHandle(handle: string): { alias: string; domain: string } | null {
  const parts = handle.split('@')
  if (parts.length !== 2) return null
  
  const [alias, domain] = parts
  
  // Validate alias: alphanumeric, underscores, 3-30 chars
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(alias)) return null
  
  // Validate domain: basic domain format check (allows optional port number)
  // Matches: localhost, example.com, localhost:5000, 192.168.1.1:3000
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9](:\d+)?$/.test(domain)) return null
  
  return { alias, domain }
}

/**
 * Validate a handle alias format
 * @param alias - Alias to validate
 * @returns true if valid
 */
export function isValidAlias(alias: string): boolean {
  return /^[a-zA-Z0-9_]{3,30}$/.test(alias)
}

/**
 * Get the public key from a private key (seed)
 * @param privateKey - Base64-encoded Ed25519 private key (32-byte seed)
 * @returns Base64-encoded public key
 */
export async function getPublicKeyFromPrivate(privateKey: string): Promise<string> {
  const privateKeyBytes = base64ToBytes(privateKey)
  const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes)
  return bytesToBase64(publicKeyBytes)
}

// Utility functions for base64 conversion
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binaryString = ''
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i])
  }
  return btoa(binaryString)
}

function sortObjectKeys(obj: object): object {
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map(sortObjectKeys)
  
  return Object.keys(obj)
    .sort()
    .reduce((sorted: Record<string, unknown>, key) => {
      sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key] as object)
      return sorted
    }, {})
}

