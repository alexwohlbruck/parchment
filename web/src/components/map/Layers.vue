<script setup lang="ts">
import { computed, h } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { PencilIcon } from 'lucide-vue-next'
import { useMapStore } from '@/stores/map.store'
import { useMapService } from '@/services/map.service'
import { useAppService } from '@/services/app.service'
import { type Layer } from '@/types/map.types'
import { ColumnDef } from '@tanstack/vue-table'
import LayerConfiguration from './layers/LayerConfiguration.vue'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

const appService = useAppService()
const mapService = useMapService()
const mapStore = useMapStore()
const { layers } = storeToRefs(mapStore)
const { t } = useI18n()

function openLayerConfigDialog(layerId?: Layer['configuration']['id']) {
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
    header: t('layers.meta.fields.name'),
    cell: ({ row }) => {
      return h('div', { class: 'flex items-center gap-2' }, [
        h(row.original.icon, { class: 'size-4' }),
        row.original.name,
      ])
    },
  },
  {
    id: 'type',
    header: t('layers.meta.fields.type.title'),
    cell: ({ row }) =>
      t(`layers.meta.fields.type.values.${row.original.configuration.type}`),
  },
  {
    id: 'enabled',
    header: t('layers.meta.fields.enabled'),
    cell: ({ row }) =>
      h(Switch, {
        checked: row.original.enabled,
        onClick: () => mapService.toggleLayer(row.original.configuration.id),
      }),
  },
  {
    id: 'actions',
    cell: ({ row }) =>
      h(Button, {
        variant: 'ghost',
        size: 'icon',
        onClick: () => openLayerConfigDialog(row.original.configuration.id),
        icon: PencilIcon,
      }),
  },
]
</script>

<template>
  <DataTable :columns="columns" :data="layers" />
</template>
