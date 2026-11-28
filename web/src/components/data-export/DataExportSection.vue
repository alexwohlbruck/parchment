<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { DownloadIcon, LockIcon } from 'lucide-vue-next'
import { SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { H6 } from '@/components/ui/typography'
import Caption from '@/components/ui/typography/Caption.vue'
import RecoveryWordsDialog from '@/components/identity/RecoveryWordsDialog.vue'
import { EXPORT_MODULES, type ExportModuleId } from '@/lib/data-export/export-format'
import { useDataExport } from '@/composables/data-export/useDataExport'
import { useIdentityStore } from '@/stores/identity.store'

const { exporting, exportData, privateCounts, loadPrivateCounts } = useDataExport()
const identityStore = useIdentityStore()
const { needsImport } = storeToRefs(identityStore)

const selected = ref<ExportModuleId[]>([...EXPORT_MODULES])
const allSelected = computed(() => selected.value.length === EXPORT_MODULES.length)
const askingForKey = ref(false)

const selectedPrivate = computed(() =>
  selected.value.reduce((sum, module) => sum + (privateCounts.value[module] ?? 0), 0),
)

onMounted(async () => {
  await identityStore.initialize()
  await loadPrivateCounts()
})

function toggle(module: ExportModuleId, checked: boolean) {
  selected.value = EXPORT_MODULES.filter(m => (m === module ? checked : selected.value.includes(m)))
}

function toggleAll() {
  selected.value = allSelected.value ? [] : [...EXPORT_MODULES]
}

function download() {
  if (needsImport.value && selectedPrivate.value) askingForKey.value = true
  else exportData(selected.value)
}

function onKeyDialog(open: boolean) {
  askingForKey.value = open
  if (!open) exportData(selected.value)
}
</script>

<template>
  <SettingsSection
    id="export"
    :title="$t('dataExport.title')"
    :description="$t('dataExport.description')"
  >
    <template #actions>
      <Button variant="ghost" size="sm" @click="toggleAll">
        {{ $t(allSelected ? 'dataExport.selectNone' : 'dataExport.selectAll') }}
      </Button>
    </template>

    <div class="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <label
        v-for="module in EXPORT_MODULES"
        :key="module"
        class="flex items-start gap-3 cursor-pointer"
      >
        <Checkbox
          class="mt-0.5"
          :model-value="selected.includes(module)"
          :disabled="exporting"
          @update:model-value="toggle(module, $event === true)"
        />
        <div class="flex flex-col">
          <div class="flex items-center gap-2">
            <H6>{{ $t(`dataExport.modules.${module}.title`) }}</H6>
            <span
              v-if="privateCounts[module]"
              class="inline-flex items-center gap-1 text-xs text-muted-foreground"
            >
              <LockIcon class="size-3" />
              {{ $t('dataExport.private', { count: privateCounts[module] }) }}
            </span>
          </div>
          <Caption>{{ $t(`dataExport.modules.${module}.description`) }}</Caption>
        </div>
      </label>
    </div>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button
        :icon="DownloadIcon"
        :loading="exporting"
        :disabled="!selected.length"
        @click="download"
      >
        {{ $t('dataExport.download') }}
      </Button>
      <Caption v-if="needsImport && selectedPrivate">
        {{ $t('dataExport.privateLocked') }}
      </Caption>
    </div>

    <RecoveryWordsDialog
      :open="askingForKey"
      mode="import"
      @update:open="onKeyDialog"
    />
  </SettingsSection>
</template>
