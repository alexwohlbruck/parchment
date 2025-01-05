<script setup lang="ts">
import { type Layer } from '@/types/map.types'
import { ref } from 'vue'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'

const props = defineProps<{
  layer: Layer
}>()

// Consolidate all fields into a single ref for the layer object
const layerData = ref({
  meta: JSON.stringify(props.layer.meta, null, 2),
  name: props.layer.name,
  enabled: props.layer.enabled,
  source: {
    id: props.layer.source.id,
    type: props.layer.source.type,
    tiles: props.layer.source.tiles?.join(',') || '',
    tileSize: props.layer.source.tileSize,
    attribution: props.layer.source.attribution,
  },
})

// Unified update function
const updateLayer = () => {
  try {
    props.layer.meta = JSON.parse(layerData.value.meta)
  } catch (error) {
    console.error('Invalid JSON format', error)
  }
  props.layer.name = layerData.value.name
  props.layer.enabled = layerData.value.enabled
  props.layer.source.id = layerData.value.source.id
  props.layer.source.type = layerData.value.source.type
  props.layer.source.tiles = layerData.value.source.tiles.split(',')
  props.layer.source.tileSize = layerData.value.source.tileSize
  props.layer.source.attribution = layerData.value.source.attribution
}
</script>

<template>
  <div>
    <h2>{{ layerData.name }}</h2>
    <Input
      v-model="layerData.name"
      @blur="updateLayer"
      placeholder="Layer Name"
    />
    <Checkbox v-model="layerData.enabled" @change="updateLayer"
      >Enabled</Checkbox
    >

    <h3>Source Configuration</h3>
    <Input
      v-model="layerData.source.id"
      @blur="updateLayer"
      placeholder="Source ID"
    />
    <Input
      v-model="layerData.source.type"
      @blur="updateLayer"
      placeholder="Source Type"
    />
    <Textarea
      v-model="layerData.source.tiles"
      @blur="updateLayer"
      rows="3"
      placeholder="Tiles (comma-separated URLs)"
    />
    <Input
      type="number"
      v-model="layerData.source.tileSize"
      @blur="updateLayer"
      placeholder="Tile Size"
    />
    <Textarea
      v-model="layerData.source.attribution"
      @blur="updateLayer"
      rows="3"
      placeholder="Attribution"
    />

    <h3>Meta Configuration</h3>
    <Textarea
      v-model="layerData.meta"
      @blur="updateLayer"
      rows="10"
      placeholder="Enter JSON for meta field"
    ></Textarea>
  </div>
</template>
