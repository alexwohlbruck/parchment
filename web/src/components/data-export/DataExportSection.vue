<script setup lang="ts">
import { computed, ref } from 'vue'
import { DownloadIcon } from 'lucide-vue-next'
import { SettingsSection } from '@/components/settings'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { H6 } from '@/components/ui/typography'
import Caption from '@/components/ui/typography/Caption.vue'
import { EXPORT_MODULES, type ExportModuleId } from '@/lib/data-export/export-format'
import { useDataExport } from '@/composables/data-export/useDataExport'

const { exporting, exportData } = useDataExport()

const selected = ref<ExportModuleId[]>([...EXPORT_MODULES])
const allSelected = computed(() => selected.value.length === EXPORT_MODULES.length)

function toggle(module: ExportModuleId, checked: boolean) {
  selected.value = EXPORT_MODULES.filter(m => (m === module ? checked : selected.value.includes(m)))
}

function toggleAll() {
  selected.value = allSelected.value ? [] : [...EXPORT_MODULES]
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
        </div>
      </label>
    </div>

    <Button
      class="self-start"
      :icon="DownloadIcon"
      :loading="exporting"
      :disabled="!selected.length"
      @click="exportData(selected)"
    >
      {{ $t('dataExport.download') }}
    </Button>
  </SettingsSection>
</template>
