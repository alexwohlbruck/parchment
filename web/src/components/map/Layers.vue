<script setup lang="ts">
import { useMapStore } from '@/stores/map.store'
import { useAppService } from '@/services/app.service'
import { storeToRefs } from 'pinia'
import { type Layer } from '@/types/map.types'
import { useI18n } from 'vue-i18n'
import { computed, h } from 'vue'
import { ColumnDef } from '@tanstack/vue-table'
import LayerConfiguration from './layers/LayerConfiguration.vue'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PencilIcon } from 'lucide-vue-next'

const mapStore = useMapStore()
const { layers } = storeToRefs(mapStore)

const appService = useAppService()
const { t } = useI18n()

function openLayerConfigDialog(layerId?: Layer['id']) {
  appService.componentDialog({
    component: LayerConfiguration,
    continueText: t('general.save'),
    props: {
      layerId,
    },
  })
}

const columns: ColumnDef<Layer>[] = [
  {
    id: 'name',
    header: t('layers.info.fields.name'),
    cell: ({ row }) => {
      return h('div', { class: 'flex items-center gap-2' }, [
        h(row.original.icon, { class: 'size-4' }),
        row.original.name,
      ])
    },
  },
  {
    id: 'type',
    header: t('layers.info.fields.type.title'),
    cell: ({ row }) => t(`layers.info.fields.type.values.${row.original.type}`),
  },
  {
    id: 'enabled',
    header: t('layers.info.fields.enabled'),
    cell: ({ row }) =>
      h(Switch, {
        disabled: true, // TODO: Toggleable layers
        checked: row.original.enabled,
        onCheckedChange: (checked: boolean) => {
          const mapStore = useMapStore()
          // TODO:
          // mapStore.toggleLayer(row.original.id, checked)
        },
      }),
  },
  {
    id: 'actions',
    cell: ({ row }) =>
      h(Button, {
        variant: 'ghost',
        size: 'icon',
        onClick: () => openLayerConfigDialog(row.original.id),
        icon: PencilIcon,
      }),
  },
]

const layerNames = computed(() => {
  return layers.value.map(layer => layer.name)
})
</script>

<template>
  <pre>{{ layerNames }}</pre>

  <DataTable :columns="columns" :data="layers" />
</template>
