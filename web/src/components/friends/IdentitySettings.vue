<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import RecoveryKeyDialog from './RecoveryKeyDialog.vue'
import RotateKeysDialog from './RotateKeysDialog.vue'
import TransferIdentityDialog from './TransferIdentityDialog.vue'
import {
  Key,
  User,
  Globe,
  Check,
  AlertCircle,
  Download,
  RefreshCw,
  Smartphone,
  Fingerprint,
  AlertTriangle,
} from 'lucide-vue-next'

const identityStore = useIdentityStore()
const {
  identity,
  handle,
  alias,
  domain,
  isSetupComplete,
  needsImport,
  isLoading,
  isStale,
  rotateKeysRequestCounter,
} = storeToRefs(identityStore)

const aliasInput = ref('')
const isEditingAlias = ref(false)
const isSavingAlias = ref(false)
const aliasError = ref<string | null>(null)

const showRecoveryDialog = ref(false)
const recoveryDialogMode = ref<'setup' | 'import' | 'view'>('setup')
const showRotateDialog = ref(false)
const showTransferDialog = ref(false)

const isSyncing = ref(false)
const syncError = ref<string | null>(null)

async function syncWithPasskey() {
  isSyncing.value = true
  syncError.value = null
  try {
    const result = await identityStore.unlockWithPasskey()
    if (!result.success) {
      syncError.value = result.error ?? "Couldn't sync. Try again."
    }
  } finally {
    isSyncing.value = false
  }
}

onMounted(async () => {
  await identityStore.initialize()
  aliasInput.value = alias.value || ''
})

// Any component calling `identityStore.requestRotateKeys()` bumps this
// counter; open the rotate dialog in response.
watch(rotateKeysRequestCounter, () => {
  showRotateDialog.value = true
})

const isValidAlias = computed(() => {
  return /^[a-zA-Z0-9_]{3,30}$/.test(aliasInput.value)
})

const aliasChanged = computed(() => {
  return aliasInput.value !== (alias.value || '')
})

function startEditAlias() {
  aliasInput.value = alias.value || ''
  isEditingAlias.value = true
  aliasError.value = null
}

function cancelEditAlias() {
  aliasInput.value = alias.value || ''
  isEditingAlias.value = false
  aliasError.value = null
}

async function saveAlias() {
  if (!isValidAlias.value || !aliasChanged.value) return

  isSavingAlias.value = true
  aliasError.value = null

  const result = await identityStore.updateAlias(aliasInput.value)

  if (result.success) {
    isEditingAlias.value = false
  } else {
    aliasError.value = result.error || 'Failed to update alias'
  }

  isSavingAlias.value = false
}

function openSetupDialog() {
  recoveryDialogMode.value = 'setup'
  showRecoveryDialog.value = true
}

function openImportDialog() {
  recoveryDialogMode.value = 'import'
  showRecoveryDialog.value = true
}

function openViewDialog() {
  recoveryDialogMode.value = 'view'
  showRecoveryDialog.value = true
}

function handleSetupComplete() {
  aliasInput.value = alias.value || ''
}
</script>

<template>
  <SettingsSection
    title="Federation Identity"
    description="Your identity for connecting with friends across servers"
  >
    <!-- Stale device banner. Another device rotated the account keys;
         this device is still on the old seed. Tap a passkey to sync. -->
    <Alert v-if="isStale" variant="destructive" class="mb-4">
      <AlertTriangle class="h-4 w-4" />
      <AlertTitle>This device is out of sync</AlertTitle>
      <AlertDescription>
        <p class="mb-3">
          Your keys were rotated on another device. Tap a passkey to sync
          this device — until you do, your saved data here won't match what's
          on your other devices.
        </p>
        <Button
          size="sm"
          :disabled="isSyncing"
          @click="syncWithPasskey"
        >
          <Spinner v-if="isSyncing" class="h-4 w-4 mr-2" />
          <Fingerprint v-else class="h-4 w-4 mr-2" />
          Sync with passkey
        </Button>
        <p v-if="syncError" class="text-xs mt-2">{{ syncError }}</p>
      </AlertDescription>
    </Alert>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex justify-center py-4">
      <Spinner class="h-6 w-6" />
    </div>

    <!-- Needs Import (has server keys but no local) -->
    <div
      v-else-if="needsImport"
      class="flex items-center justify-between gap-4"
    >
      <div class="flex items-start gap-3 text-muted-foreground">
        <Download class="h-5 w-5 mt-0.5 shrink-0" />
        <p class="text-sm">
          Your identity exists on this server, but you need to import your
          recovery key to use it on this device.
        </p>
      </div>
      <Button @click="openImportDialog" class="shrink-0">
        <Download class="h-4 w-4 mr-2" />
        Import Recovery Key
      </Button>
    </div>

    <!-- Needs Setup -->
    <!-- TODO: Use standard settings item component -->
    <div
      v-else-if="!isSetupComplete"
      class="flex items-center justify-between gap-4"
    >
      <div class="flex items-center gap-3 text-muted-foreground">
        <Key class="h-5 w-5 mt-0.5 shrink-0" />
        <p class="text-sm">
          Set up your federation identity to connect with friends and share data
          securely across Parchment servers.
        </p>
      </div>
      <Button @click="openSetupDialog" class="shrink-0" variant="outline">
        <Key class="h-4 w-4 mr-2" />
        Set Up Identity
      </Button>
    </div>

    <!-- Identity Configured -->
    <template v-else>
      <!-- Handle Display -->
      <SettingsItem
        title="Handle"
        description="Your unique identifier for federation"
        :icon="User"
      >
        <Badge v-if="handle" variant="secondary" class="font-mono">
          {{ handle }}
        </Badge>
        <span v-else class="text-muted-foreground">Not set</span>
      </SettingsItem>

      <!-- Alias Editor -->
      <SettingsItem
        title="Username"
        description="Your username (alias) on this server"
        :icon="User"
        :block="isEditingAlias"
      >
        <div v-if="isEditingAlias" class="flex flex-col gap-2">
          <div class="flex gap-2">
            <Input
              v-model="aliasInput"
              placeholder="username"
              class="w-40"
              @keyup.enter="saveAlias"
              @keyup.escape="cancelEditAlias"
            />
            <Button
              size="sm"
              :disabled="!isValidAlias || !aliasChanged || isSavingAlias"
              @click="saveAlias"
            >
              <Spinner v-if="isSavingAlias" class="h-4 w-4" />
              <Check v-else class="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" @click="cancelEditAlias">
              Cancel
            </Button>
          </div>
          <p v-if="aliasError" class="text-xs text-destructive">
            {{ aliasError }}
          </p>
          <p v-else-if="!isValidAlias" class="text-xs text-muted-foreground">
            3-30 characters, letters, numbers, underscores only
          </p>
        </div>
        <div v-else class="flex items-center gap-2">
          <span class="font-mono">{{ alias || 'Not set' }}</span>
          <Button size="sm" variant="outline" @click="startEditAlias">
            {{ alias ? 'Edit' : 'Set' }}
          </Button>
        </div>
      </SettingsItem>

      <!-- Domain -->
      <SettingsItem
        title="Server"
        description="The server hosting your identity"
        :icon="Globe"
      >
        <span class="font-mono text-muted-foreground">{{ domain }}</span>
      </SettingsItem>

      <!-- Recovery Key -->
      <SettingsItem
        title="Recovery Key"
        description="View your recovery key for backup"
        :icon="Key"
      >
        <Button variant="outline" size="sm" @click="openViewDialog">
          View Key
        </Button>
      </SettingsItem>

      <!-- Rotate Keys -->
      <SettingsItem
        title="Rotate all keys"
        description="Generate a new master key and re-encrypt everything. Use after removing a passkey or responding to a suspected compromise."
        :icon="RefreshCw"
      >
        <Button
          variant="outline"
          size="sm"
          @click="showRotateDialog = true"
        >
          Rotate keys
        </Button>
      </SettingsItem>

      <!-- Transfer identity -->
      <SettingsItem
        title="Transfer to another device"
        description="Move your identity to a new phone or browser by scanning a QR code. Both devices must be signed in to this account."
        :icon="Smartphone"
      >
        <Button
          variant="outline"
          size="sm"
          @click="showTransferDialog = true"
        >
          Transfer
        </Button>
      </SettingsItem>
    </template>

    <!-- Recovery Key Dialog -->
    <RecoveryKeyDialog
      v-model:open="showRecoveryDialog"
      :mode="recoveryDialogMode"
      @complete="handleSetupComplete"
    />

    <!-- Rotate Keys Dialog -->
    <RotateKeysDialog v-model:open="showRotateDialog" />

    <!-- Transfer Identity Dialog -->
    <TransferIdentityDialog v-model:open="showTransferDialog" />
  </SettingsSection>
</template>
