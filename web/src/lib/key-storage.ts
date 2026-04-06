/**
 * Key Storage
 *
 * Secure storage for federation identity seed using localStorage via VueUse.
 * The seed is stored locally and never sent to the server.
 */

import { appStorage } from '@/stores/app.store'

/**
 * Store the identity seed
 * @param seed - 32-byte seed
 */
export async function storeSeed(seed: Uint8Array): Promise<void> {
  // Convert to base64 for storage
  let binaryString = ''
  for (let i = 0; i < seed.length; i++) {
    binaryString += String.fromCharCode(seed[i])
  }
  appStorage.value.identitySeed = btoa(binaryString)
}

/**
 * Retrieve the identity seed
 * @returns The seed if it exists, null otherwise
 */
export async function getSeed(): Promise<Uint8Array | null> {
  try {
    const stored = appStorage.value.identitySeed
    if (!stored) {
      return null
    }

    // Decode from base64
    const binaryString = atob(stored)
    if (binaryString.length !== 32) {
      return null
    }

    const seed = new Uint8Array(32)
    for (let i = 0; i < 32; i++) {
      seed[i] = binaryString.charCodeAt(i)
    }
    return seed
  } catch {
    return null
  }
}

/**
 * Check if an identity seed exists
 * @returns true if seed is stored
 */
export async function hasIdentity(): Promise<boolean> {
  const seed = await getSeed()
  return seed !== null
}

/**
 * Clear the stored identity (logout/reset)
 */
export async function clearIdentity(): Promise<void> {
  appStorage.value.identitySeed = null
}

/**
 * Check if the stored seed matches a given recovery key
 * Useful for verification flows
 */
export async function verifySeedMatchesRecoveryKey(
  recoveryKey: string,
): Promise<boolean> {
  try {
    const storedSeed = await getSeed()
    if (!storedSeed) return false

    // Import the recovery key and compare
    const binaryString = atob(recoveryKey.trim())
    const importedSeed = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      importedSeed[i] = binaryString.charCodeAt(i)
    }

    if (importedSeed.length !== 32) return false

    // Compare bytes
    for (let i = 0; i < 32; i++) {
      if (storedSeed[i] !== importedSeed[i]) return false
    }

    return true
  } catch {
    return false
  }
}
