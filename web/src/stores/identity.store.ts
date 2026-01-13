import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import {
  checkHasLocalIdentity,
  fetchIdentityFromServer,
  generateNewIdentity,
  completeIdentitySetup,
  importIdentityFromRecoveryKey,
  getLocalIdentity,
  getRecoveryKey,
  updateAlias as updateAliasService,
  clearLocalIdentity,
  needsIdentitySetup,
  needsIdentityImport,
  verifyAndSyncKeys,
  type Identity,
} from '@/services/identity.service'
import type { DerivedKeys } from '@/lib/federation-crypto'

export const useIdentityStore = defineStore('identity', () => {
  // State
  const identity = ref<Identity | null>(null)
  const localKeys = ref<DerivedKeys | null>(null)
  const isLoading = ref(false)
  const hasLocalIdentity = ref(false)
  const pendingRecoveryKey = ref<string | null>(null)
  const pendingSeed = ref<Uint8Array | null>(null)
  const pendingKeys = ref<DerivedKeys | null>(null)

  // Computed
  const handle = computed(() => identity.value?.handle || null)
  const alias = computed(() => {
    if (!identity.value?.handle) return null
    return identity.value.handle.split('@')[0]
  })
  const domain = computed(() => identity.value?.domain || null)
  const isSetupComplete = computed(() => 
    hasLocalIdentity.value && !!identity.value?.signingKey
  )
  const needsSetup = computed(() => 
    !hasLocalIdentity.value || !identity.value?.signingKey
  )
  const needsImport = computed(() => 
    !hasLocalIdentity.value && !!identity.value?.signingKey
  )
  
  // Key accessors for encryption
  const signingPrivateKey = computed(() => localKeys.value?.signing.privateKey || null)
  const signingPublicKey = computed(() => localKeys.value?.signing.publicKey || null)
  const encryptionPrivateKey = computed(() => localKeys.value?.encryption.privateKey || null)
  const encryptionPublicKey = computed(() => localKeys.value?.encryption.publicKey || null)

  /**
   * Initialize identity state
   * Should be called after user authentication
   */
  async function initialize() {
    isLoading.value = true
    try {
      const [hasLocal, serverIdentity] = await Promise.all([
        checkHasLocalIdentity(),
        fetchIdentityFromServer(),
      ])

      hasLocalIdentity.value = hasLocal
      identity.value = serverIdentity

      if (hasLocal) {
        localKeys.value = await getLocalIdentity()
        
        // Verify local keys match server, re-register if not
        // This fixes key drift issues silently
        const keysUpdated = await verifyAndSyncKeys()
        if (keysUpdated) {
          // Refresh server identity after re-registration
          identity.value = await fetchIdentityFromServer()
        }
      }
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Start the identity setup flow
   * Generates new seed and keys, returns recovery key for user to save
   */
  async function startSetup(): Promise<string> {
    const { seed, keys, recoveryKey } = await generateNewIdentity()
    
    pendingSeed.value = seed
    pendingKeys.value = keys
    pendingRecoveryKey.value = recoveryKey
    
    return recoveryKey
  }

  /**
   * Complete setup after user confirms they've saved recovery key
   */
  async function completeSetup(): Promise<{ success: boolean; error?: string }> {
    if (!pendingSeed.value || !pendingKeys.value) {
      return { success: false, error: 'No pending setup' }
    }

    try {
      await completeIdentitySetup(pendingSeed.value, pendingKeys.value)
      
      hasLocalIdentity.value = true
      localKeys.value = pendingKeys.value
      
      // Refresh server identity
      identity.value = await fetchIdentityFromServer()
      
      // Clear pending state
      pendingSeed.value = null
      pendingKeys.value = null
      pendingRecoveryKey.value = null
      
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Setup failed',
      }
    }
  }

  /**
   * Cancel pending setup
   */
  function cancelSetup() {
    pendingSeed.value = null
    pendingKeys.value = null
    pendingRecoveryKey.value = null
  }

  /**
   * Import identity from recovery key
   */
  async function importFromRecoveryKey(
    recoveryKey: string,
  ): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true
    try {
      const result = await importIdentityFromRecoveryKey(recoveryKey)
      
      if (result.success) {
        hasLocalIdentity.value = true
        localKeys.value = await getLocalIdentity()
        identity.value = await fetchIdentityFromServer()
      }
      
      return result
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Get the recovery key for display
   */
  async function fetchRecoveryKey(): Promise<string | null> {
    return getRecoveryKey()
  }

  /**
   * Update alias
   */
  async function updateAlias(
    newAlias: string,
  ): Promise<{ success: boolean; error?: string }> {
    const result = await updateAliasService(newAlias)
    
    if (result.success && result.handle) {
      identity.value = {
        ...identity.value!,
        handle: result.handle,
      }
    }
    
    return result
  }

  /**
   * Clear identity on logout
   */
  async function clear() {
    await clearLocalIdentity()
    identity.value = null
    localKeys.value = null
    hasLocalIdentity.value = false
    pendingSeed.value = null
    pendingKeys.value = null
    pendingRecoveryKey.value = null
  }

  return {
    // State
    identity,
    localKeys,
    isLoading,
    hasLocalIdentity,
    pendingRecoveryKey,
    
    // Computed
    handle,
    alias,
    domain,
    isSetupComplete,
    needsSetup,
    needsImport,
    signingPrivateKey,
    signingPublicKey,
    encryptionPrivateKey,
    encryptionPublicKey,
    
    // Actions
    initialize,
    startSetup,
    completeSetup,
    cancelSetup,
    importFromRecoveryKey,
    fetchRecoveryKey,
    updateAlias,
    clear,
  }
})

