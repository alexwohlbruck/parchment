<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useIdentityStore } from '@/stores/identity.store'
import { SettingsSection, SettingsItem } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import RecoveryKeyDialog from './RecoveryKeyDialog.vue'
import { Key, User, Globe, Check, AlertCircle, Download } from 'lucide-vue-next'

const identityStore = useIdentityStore()
const { identity, handle, alias, domain, isSetupComplete, needsImport, isLoading } = storeToRefs(identityStore)

const aliasInput = ref('')
const isEditingAlias = ref(false)
const isSavingAlias = ref(false)
const aliasError = ref<string | null>(null)

const showRecoveryDialog = ref(false)
const recoveryDialogMode = ref<'setup' | 'import' | 'view'>('setup')

onMounted(async () => {
  await identityStore.initialize()
  aliasInput.value = alias.value || ''
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
    <!-- Loading State -->
    <div v-if="isLoading" class="flex justify-center py-4">
      <Spinner class="h-6 w-6" />
    </div>

    <!-- Needs Import (has server keys but no local) -->
    <template v-else-if="needsImport">
      <Alert class="mb-4">
        <Download class="h-4 w-4" />
        <AlertDescription>
          Your identity exists on this server, but you need to import your
          recovery key to use it on this device.
        </AlertDescription>
      </Alert>
      <Button @click="openImportDialog">
        <Download class="h-4 w-4 mr-2" />
        Import Recovery Key
      </Button>
    </template>

    <!-- Needs Setup -->
    <template v-else-if="!isSetupComplete">
      <Alert class="mb-4">
        <Key class="h-4 w-4" />
        <AlertDescription>
          Set up your federation identity to connect with friends and share
          data securely across Parchment servers.
        </AlertDescription>
      </Alert>
      <Button @click="openSetupDialog">
        <Key class="h-4 w-4 mr-2" />
        Set Up Identity
      </Button>
    </template>

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
            <Button
              size="sm"
              variant="outline"
              @click="cancelEditAlias"
            >
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
    </template>

    <!-- Recovery Key Dialog -->
    <RecoveryKeyDialog
      v-model:open="showRecoveryDialog"
      :mode="recoveryDialogMode"
      @complete="handleSetupComplete"
    />
  </SettingsSection>
</template>

