<script setup lang="ts">
import { type Layer } from '@/types/map.types'
import { ref } from 'vue'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'

const props = defineProps<{
  layer: Layer
}>()

const metaField = ref(JSON.stringify(props.layer.meta, null, 2))
const nameField = ref(props.layer.name)
const enabledField = ref(props.layer.enabled)
const sourceIdField = ref(props.layer.source.id)
const sourceTypeField = ref(props.layer.source.type)
const sourceTilesField = ref(props.layer.source.tiles.join(','))
const sourceTileSizeField = ref(props.layer.source.tileSize)
const sourceAttributionField = ref(props.layer.source.attribution)

const updateMeta = () => {
  try {
    props.layer.meta = JSON.parse(metaField.value)
  } catch (error) {
    console.error('Invalid JSON format', error)
  }
}

const updateLayer = () => {
  props.layer.name = nameField.value
  props.layer.enabled = enabledField.value
  props.layer.source.id = sourceIdField.value
  props.layer.source.type = sourceTypeField.value
  props.layer.source.tiles = sourceTilesField.value.split(',')
  props.layer.source.tileSize = sourceTileSizeField.value
  props.layer.source.attribution = sourceAttributionField.value
}
</script>

<template>
  <div>
    <h2>{{ layer.name }}</h2>
    <Input v-model="nameField" @blur="updateLayer" placeholder="Layer Name" />
    <Checkbox v-model="enabledField" @change="updateLayer">Enabled</Checkbox>

    <h3>Source Configuration</h3>
    <Input
      v-model="sourceIdField"
      @blur="updateLayer"
      placeholder="Source ID"
    />
    <Input
      v-model="sourceTypeField"
      @blur="updateLayer"
      placeholder="Source Type"
    />
    <Textarea
      v-model="sourceTilesField"
      @blur="updateLayer"
      rows="3"
      placeholder="Tiles (comma-separated URLs)"
    />
    <Input
      type="number"
      v-model="sourceTileSizeField"
      @blur="updateLayer"
      placeholder="Tile Size"
    />
    <Textarea
      v-model="sourceAttributionField"
      @blur="updateLayer"
      rows="3"
      placeholder="Attribution"
    />

    <h3>Meta Configuration</h3>
    <Textarea
      v-model="metaField"
      @blur="updateMeta"
      rows="10"
      placeholder="Enter JSON for meta field"
    ></Textarea>
  </div>
</template>
