<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useIdentityStore } from '@/stores/identity.store'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Code } from '@/components/ui/code'
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

const { t } = useI18n()
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
    if (result.cancelled) return
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
  <div class="flex flex-col gap-6 w-full">
    <!-- Stale device banner. Another device rotated the account keys;
         this device is still on the old seed. Warning (not destructive)
         — nothing is broken, the user just needs to re-auth to sync. -->
    <Alert v-if="isStale" variant="warning">
      <AlertTriangle class="h-4 w-4" />
      <AlertTitle>{{ t('friends.identity.staleTitle') }}</AlertTitle>
      <AlertDescription>
        <p class="mb-3">{{ t('friends.identity.staleDescription') }}</p>
        <Button size="sm" :disabled="isSyncing" @click="syncWithPasskey">
          <Spinner v-if="isSyncing" class="h-4 w-4 mr-2" />
          <Fingerprint v-else class="h-4 w-4 mr-2" />
          {{ t('friends.identity.syncWithPasskey') }}
        </Button>
        <p v-if="syncError" class="text-xs mt-2">{{ syncError }}</p>
      </AlertDescription>
    </Alert>

    <!-- Loading State -->
    <SettingsSection
      v-if="isLoading"
      :title="t('friends.identity.title')"
      :description="t('friends.identity.description')"
    >
      <div class="flex justify-center py-4">
        <Spinner class="h-6 w-6" />
      </div>
    </SettingsSection>

    <!-- Needs Import (has server keys but no local) -->
    <SettingsSection
      v-else-if="needsImport"
      :title="t('friends.identity.title')"
      :description="t('friends.identity.description')"
    >
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-start gap-3 text-muted-foreground">
          <Download class="h-5 w-5 mt-0.5 shrink-0" />
          <p class="text-sm">
            {{ t('friends.identity.importDescription') }}
          </p>
        </div>
        <Button @click="openImportDialog" class="shrink-0">
          <Download class="h-4 w-4 mr-2" />
          {{ t('friends.identity.importButton') }}
        </Button>
      </div>
    </SettingsSection>

    <!-- Needs Setup -->
    <SettingsSection
      v-else-if="!isSetupComplete"
      :title="t('friends.identity.title')"
      :description="t('friends.identity.description')"
    >
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-3 text-muted-foreground">
          <Key class="h-5 w-5 mt-0.5 shrink-0" />
          <p class="text-sm">
            {{ t('friends.identity.setupDescription') }}
          </p>
        </div>
        <Button @click="openSetupDialog" class="shrink-0" variant="outline">
          <Key class="h-4 w-4 mr-2" />
          {{ t('friends.identity.setupButton') }}
        </Button>
      </div>
    </SettingsSection>

    <!-- Identity Configured — split into two sections so the safe
         identity attributes (what I am) don't share visual weight with
         the high-stakes security actions (things that nuke data). -->
    <template v-else>
      <SettingsSection
        :title="t('friends.identity.title')"
        :description="t('friends.identity.configuredDescription')"
      >
        <!-- Username editor. Full handle (alias@server) renders as a
             hint underneath — no separate row for "Handle" + "Not set". -->
        <SettingsItem
          :title="t('friends.identity.username')"
          :description="t('friends.identity.usernameDescription')"
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
                {{ t('friends.cancel') }}
              </Button>
            </div>
            <p v-if="aliasError" class="text-xs text-destructive">
              {{ aliasError }}
            </p>
            <p v-else-if="!isValidAlias" class="text-xs text-muted-foreground">
              3-30 characters, letters, numbers, underscores only
            </p>
          </div>
          <div v-else class="flex flex-col items-end gap-1">
            <div class="flex items-center gap-2">
              <Code v-if="handle">{{ handle }}</Code>
              <Button size="sm" variant="outline" @click="startEditAlias">
                {{ alias ? t('friends.identity.edit') : t('friends.identity.set') }}
              </Button>
            </div>
            <span
              v-if="handle"
              class="text-xs text-muted-foreground"
            >{{ t('friends.identity.shareHandleHint') }}</span>
          </div>
        </SettingsItem>

        <!-- Server — the domain part of the handle, shown plainly. -->
        <SettingsItem
          :title="t('friends.identity.server')"
          :description="t('friends.identity.serverDescription')"
          :icon="Globe"
        >
          <Code>{{ domain }}</Code>
        </SettingsItem>
      </SettingsSection>

      <SettingsSection
        :title="t('friends.security.title')"
        :description="t('friends.security.description')"
      >
        <!-- Recovery Key -->
        <SettingsItem
          :title="t('friends.security.recoveryKey')"
          :description="t('friends.security.recoveryKeyDescription')"
          :icon="Key"
        >
          <Button variant="outline" size="sm" @click="openViewDialog">
            {{ t('friends.security.viewKey') }}
          </Button>
        </SettingsItem>

        <!-- Rotate Keys -->
        <SettingsItem
          :title="t('friends.security.rotateKeys')"
          :description="t('friends.security.rotateKeysDescription')"
          :icon="RefreshCw"
        >
          <Button variant="outline" size="sm" @click="showRotateDialog = true">
            {{ t('friends.security.rotate') }}
          </Button>
        </SettingsItem>

        <!-- Add identity to another device. Note: despite the
             "Transfer" internal naming (kept to match the device-
             transfer protocol), the seed stays on THIS device too —
             both ends can use it after the handshake. The user-facing
             label reflects that. -->
        <SettingsItem
          :title="t('friends.security.setupAnotherDevice')"
          :description="t('friends.security.setupAnotherDeviceDescription')"
          :icon="Smartphone"
        >
          <Button
            variant="outline"
            size="sm"
            @click="showTransferDialog = true"
          >
            {{ t('friends.security.setupAction') }}
          </Button>
        </SettingsItem>
      </SettingsSection>
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
  </div>
</template>
