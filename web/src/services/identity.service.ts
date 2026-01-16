/**
 * Identity Service
 * 
 * Manages the federation identity lifecycle:
 * - First-time setup (generate seed, derive keys, register with server)
 * - Recovery key display and copy
 * - Import recovery key on new device
 * - Get current identity for signing requests
 */

import { api } from '@/lib/api'
import {
  generateSeed,
  deriveAllKeys,
  exportRecoveryKey,
  importRecoveryKey,
  exportPublicKey,
  sign,
  buildSignableMessage,
  type DerivedKeys,
} from '@/lib/federation-crypto'
import {
  storeSeed,
  getSeed,
  hasIdentity,
  clearIdentity,
} from '@/lib/key-storage'

export interface Identity {
  handle: string | null
  signingKey: string | null
  encryptionKey: string | null
  domain: string
}

export interface IdentityWithKeys extends Identity {
  keys: DerivedKeys
  recoveryKey: string
}

/**
 * Check if the user has a local identity (seed stored)
 */
export async function checkHasLocalIdentity(): Promise<boolean> {
  return hasIdentity()
}

/**
 * Get the current identity from the server
 */
export async function fetchIdentityFromServer(): Promise<Identity | null> {
  try {
    const response = await api.get<Identity>('/users/me/identity')
    return response.data
  } catch {
    return null
  }
}

/**
 * Generate a new identity (seed and derived keys)
 * Does NOT register with server yet - user must confirm recovery key first
 */
export async function generateNewIdentity(): Promise<{
  seed: Uint8Array
  keys: DerivedKeys
  recoveryKey: string
}> {
  const seed = generateSeed()
  const keys = deriveAllKeys(seed)
  const recoveryKey = exportRecoveryKey(seed)
  
  return { seed, keys, recoveryKey }
}

/**
 * Complete identity setup after user confirms recovery key
 * Stores seed locally and registers public keys with server
 */
export async function completeIdentitySetup(
  seed: Uint8Array,
  keys: DerivedKeys,
): Promise<void> {
  // Store seed in IndexedDB
  await storeSeed(seed)
  
  // Register public keys with server
  await api.put('/users/me/keys', {
    signingKey: exportPublicKey(keys.signing.publicKey),
    encryptionKey: exportPublicKey(keys.encryption.publicKey),
  })
}

/**
 * Import identity from recovery key
 * Used when logging in on a new device
 */
export async function importIdentityFromRecoveryKey(
  recoveryKey: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const seed = importRecoveryKey(recoveryKey)
    const keys = deriveAllKeys(seed)
    
    // Get server identity to verify
    const serverIdentity = await fetchIdentityFromServer()
    
    if (serverIdentity?.signingKey) {
      // Verify the imported key matches server
      const derivedSigningKey = exportPublicKey(keys.signing.publicKey)
      if (derivedSigningKey !== serverIdentity.signingKey) {
        return {
          success: false,
          error: 'Recovery key does not match your account',
        }
      }
    }
    
    // Store the seed
    await storeSeed(seed)
    
    // If server doesn't have keys yet, register them
    if (!serverIdentity?.signingKey) {
      await api.put('/users/me/keys', {
        signingKey: exportPublicKey(keys.signing.publicKey),
        encryptionKey: exportPublicKey(keys.encryption.publicKey),
      })
    }
    
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Invalid recovery key',
    }
  }
}

/**
 * Get the current local identity with keys
 * Returns null if no identity is stored locally
 */
export async function getLocalIdentity(): Promise<DerivedKeys | null> {
  const seed = await getSeed()
  if (!seed) return null
  
  return deriveAllKeys(seed)
}

/**
 * Get the recovery key for the current identity
 * Used to display in settings
 */
export async function getRecoveryKey(): Promise<string | null> {
  const seed = await getSeed()
  if (!seed) return null
  
  return exportRecoveryKey(seed)
}

/**
 * Sign a federation message
 */
export async function signFederationMessage(
  type: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const keys = await getLocalIdentity()
  if (!keys) {
    throw new Error('No identity found. Please set up your federation identity.')
  }
  
  const message = buildSignableMessage(type, payload)
  return sign(message, keys.signing.privateKey)
}

/**
 * Update the user's alias
 */
export async function updateAlias(alias: string): Promise<{
  success: boolean
  handle?: string
  error?: string
}> {
  try {
    const response = await api.patch<{ alias: string; handle: string }>(
      '/users/me/alias',
      { alias },
    )
    return {
      success: true,
      handle: response.data.handle,
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || 'Failed to update alias',
    }
  }
}

/**
 * Clear local identity (for logout or reset)
 */
export async function clearLocalIdentity(): Promise<void> {
  await clearIdentity()
}

/**
 * Check if identity setup is needed
 * Returns true if user has no local identity or server has no keys
 */
export async function needsIdentitySetup(): Promise<boolean> {
  const [hasLocal, serverIdentity] = await Promise.all([
    hasIdentity(),
    fetchIdentityFromServer(),
  ])
  
  // Needs setup if:
  // - No local identity, OR
  // - Server has no signing key
  return !hasLocal || !serverIdentity?.signingKey
}

/**
 * Check if user needs to import their identity on this device
 * (Server has keys but local doesn't)
 */
export async function needsIdentityImport(): Promise<boolean> {
  const [hasLocal, serverIdentity] = await Promise.all([
    hasIdentity(),
    fetchIdentityFromServer(),
  ])
  
  return !hasLocal && !!serverIdentity?.signingKey
}

/**
 * Verify local keys match server keys, and re-register if they don't.
 * This fixes key drift issues silently without user intervention.
 * 
 * Returns true if keys were re-registered (updated), false if they matched.
 */
export async function verifyAndSyncKeys(): Promise<boolean> {
  const localKeys = await getLocalIdentity()
  if (!localKeys) {
    return false // No local identity, nothing to sync
  }

  const serverIdentity = await fetchIdentityFromServer()
  if (!serverIdentity) {
    return false // Can't fetch server identity
  }

  const localSigningKey = exportPublicKey(localKeys.signing.publicKey)
  const localEncryptionKey = exportPublicKey(localKeys.encryption.publicKey)

  // Check if local keys match server keys
  const signingMatch = localSigningKey === serverIdentity.signingKey
  const encryptionMatch = localEncryptionKey === serverIdentity.encryptionKey

  if (signingMatch && encryptionMatch) {
    return false // Keys match, no sync needed
  }

  // Keys don't match - re-register local keys with server
  try {
    await api.put('/users/me/keys', {
      signingKey: localSigningKey,
      encryptionKey: localEncryptionKey,
    })
    return true
  } catch (error) {
    console.error('Failed to re-register keys:', error)
    return false
  }
}
