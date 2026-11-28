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

    <div class="flex flex-col gap-3">
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
          <H6>{{ $t(`dataExport.modules.${module}.title`) }}</H6>
          <Caption>{{ $t(`dataExport.modules.${module}.description`) }}</Caption>
          <Caption
            v-if="privateCounts[module]"
            class="flex items-center gap-1"
          >
            <LockIcon class="size-3 shrink-0" />
            {{
              $t(
                needsImport ? 'dataExport.privateLocked' : 'dataExport.private',
                { count: privateCounts[module] },
                privateCounts[module]!,
              )
            }}
          </Caption>
        </div>
      </label>
    </div>

    <Button
      class="self-start"
      :icon="DownloadIcon"
      :loading="exporting"
      :disabled="!selected.length"
      @click="download"
    >
      {{ $t('dataExport.download') }}
    </Button>

    <RecoveryWordsDialog
      :open="askingForKey"
      mode="import"
      @update:open="onKeyDialog"
    />
  </SettingsSection>
</template>
