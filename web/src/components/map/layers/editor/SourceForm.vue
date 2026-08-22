<script setup lang="ts">
/**
 * Where the layer's data comes from.
 *
 * The source type is picked first because it decides everything downstream:
 * which layer types can draw it, whether a `source-layer` is needed, whether
 * the address is a TileJSON document or a tile template. Choosing it from
 * tiles — rather than a select buried in a form — makes that ordering obvious.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LayerDraft } from '@/lib/map-style/draft'
import { SOURCE_MODES } from '@/lib/map-style/draft'
import {
  LAYER_KINDS_BY_SOURCE,
  requiresSourceLayer,
  STYLE_SOURCE_KINDS,
  type StyleLayerKind,
  type StyleSourceKind,
} from '@/lib/map-style/spec'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ImageIcon,
  MountainSnowIcon,
  ShapesIcon,
  BracesIcon,
  FrameIcon,
  PlusIcon,
  XIcon,
} from 'lucide-vue-next'

const draft = defineModel<LayerDraft>({ required: true })

const { t } = useI18n()

const SOURCE_ICONS: Record<StyleSourceKind, typeof ImageIcon> = {
  raster: ImageIcon,
  'raster-dem': MountainSnowIcon,
  vector: ShapesIcon,
  geojson: BracesIcon,
  image: FrameIcon,
}

const source = computed(() => draft.value.source)

const layerKinds = computed<readonly StyleLayerKind[]>(
  () => LAYER_KINDS_BY_SOURCE[source.value.kind],
)

const modes = computed(() => SOURCE_MODES[source.value.kind])
const needsSourceLayer = computed(() => requiresSourceLayer(source.value.kind))

/**
 * Switching source type has to re-pick a compatible layer type, and the
 * addressing mode rarely carries over (a GeoJSON URL is not a tile template).
 */
function selectSourceKind(kind: StyleSourceKind) {
  if (kind === source.value.kind) return
  const [firstLayerKind] = LAYER_KINDS_BY_SOURCE[kind]
  draft.value = {
    ...draft.value,
    kind: firstLayerKind,
    // Paint and layout are keyed by layer type, so nothing survives the swap.
    paint: {},
    layout: {},
    source: {
      ...source.value,
      kind,
      mode: SOURCE_MODES[kind][0],
      tileSize: kind === 'raster' ? (source.value.tileSize ?? 256) : undefined,
      encoding: kind === 'raster-dem' ? (source.value.encoding ?? 'mapbox') : undefined,
    },
  }
}

function patchSource(patch: Partial<LayerDraft['source']>) {
  draft.value = { ...draft.value, source: { ...source.value, ...patch } }
}

function setTile(index: number, value: string) {
  const tiles = [...source.value.tiles]
  tiles[index] = value
  patchSource({ tiles })
}

function addTile() {
  patchSource({ tiles: [...source.value.tiles, ''] })
}

function removeTile(index: number) {
  const tiles = source.value.tiles.filter((_, i) => i !== index)
  patchSource({ tiles: tiles.length ? tiles : [''] })
}

function setZoom(field: 'minzoom' | 'maxzoom', value: string) {
  const parsed = value === '' ? undefined : Number(value)
  patchSource({ [field]: Number.isFinite(parsed) ? parsed : undefined })
}
</script>

<template>
  <div class="space-y-5">
    <!-- Source type -->
    <div class="space-y-2">
      <Label class="text-xs text-muted-foreground">
        {{ t('layers.editor.source.type') }}
      </Label>
      <div class="grid grid-cols-3 gap-1.5">
        <button
          v-for="kind in STYLE_SOURCE_KINDS"
          :key="kind"
          :class="[
            ITEM_ROW_SURFACES.tile,
            'flex flex-col items-center gap-1.5 px-2 py-2.5 transition-colors',
            kind === source.kind
              ? 'ring-2 ring-primary bg-secondary/50'
              : 'hover:bg-secondary/40',
          ]"
          @click="selectSourceKind(kind)"
        >
          <component :is="SOURCE_ICONS[kind]" class="size-4 text-muted-foreground" />
          <span class="text-[11px] leading-tight text-center">
            {{ t(`layers.editor.source.kinds.${kind}`) }}
          </span>
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        {{ t(`layers.editor.source.hints.${source.kind}`) }}
      </p>
    </div>

    <!-- How the source is addressed -->
    <div v-if="modes.length > 1" class="space-y-2">
      <Label class="text-xs text-muted-foreground">
        {{ t('layers.editor.source.address') }}
      </Label>
      <div class="inline-flex rounded-lg border p-0.5 gap-0.5">
        <button
          v-for="mode in modes"
          :key="mode"
          class="px-2.5 py-1 rounded-md text-xs transition-colors"
          :class="
            mode === source.mode
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="patchSource({ mode })"
        >
          {{ t(`layers.editor.source.modes.${mode}`) }}
        </button>
      </div>
    </div>

    <!-- Address -->
    <div class="space-y-3">
      <template v-if="source.mode === 'tiles'">
        <div class="space-y-1.5">
          <Label class="text-xs text-muted-foreground">
            {{ t('layers.editor.source.tiles') }}
          </Label>
          <div
            v-for="(tile, index) in source.tiles"
            :key="index"
            class="flex items-center gap-1"
          >
            <Input
              :model-value="tile"
              class="h-8 text-xs font-mono"
              placeholder="https://tiles.example.com/{z}/{x}/{y}.png"
              @update:model-value="v => setTile(index, String(v))"
            />
            <Button
              v-if="source.tiles.length > 1"
              variant="ghost"
              size="icon"
              class="size-8 shrink-0"
              :aria-label="t('general.remove')"
              @click="removeTile(index)"
            >
              <XIcon class="size-3.5" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs text-muted-foreground"
            @click="addTile"
          >
            <PlusIcon class="size-3" />
            {{ t('layers.editor.source.addTile') }}
          </Button>
        </div>
      </template>

      <div v-else-if="source.mode !== 'inline'" class="space-y-1.5">
        <Label class="text-xs text-muted-foreground">
          {{ t(`layers.editor.source.urlLabel.${source.kind}`) }}
        </Label>
        <Input
          :model-value="source.url"
          class="h-8 text-xs font-mono"
          :placeholder="t(`layers.editor.source.urlPlaceholder.${source.kind}`)"
          @update:model-value="v => patchSource({ url: String(v) })"
        />
      </div>

      <div v-else class="space-y-1.5">
        <Label class="text-xs text-muted-foreground">
          {{ t('layers.editor.source.geojsonData') }}
        </Label>
        <Textarea
          :model-value="source.data"
          :rows="8"
          spellcheck="false"
          class="font-mono text-xs leading-relaxed"
          placeholder='{ "type": "FeatureCollection", "features": [] }'
          @update:model-value="v => patchSource({ data: String(v) })"
        />
        <p class="text-xs text-muted-foreground">
          {{ t('layers.editor.source.geojsonHint') }}
        </p>
      </div>
    </div>

    <!-- Per-kind extras -->
    <div class="space-y-3">
      <div
        v-if="source.kind === 'raster'"
        class="flex items-center justify-between gap-2"
      >
        <Label class="text-xs">{{ t('layers.editor.source.tileSize') }}</Label>
        <Select
          :model-value="String(source.tileSize ?? 256)"
          @update:model-value="v => patchSource({ tileSize: Number(v) })"
        >
          <SelectTrigger class="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="256">256</SelectItem>
            <SelectItem value="512">512</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div
        v-if="source.kind === 'raster-dem'"
        class="flex items-center justify-between gap-2"
      >
        <Label class="text-xs">{{ t('layers.editor.source.encoding') }}</Label>
        <Select
          :model-value="source.encoding ?? 'mapbox'"
          @update:model-value="v => patchSource({ encoding: v as 'mapbox' | 'terrarium' })"
        >
          <SelectTrigger class="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mapbox">Mapbox</SelectItem>
            <SelectItem value="terrarium">Terrarium</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div
        v-if="source.kind === 'geojson'"
        class="flex items-center justify-between gap-2"
      >
        <div>
          <Label class="text-xs">{{ t('layers.editor.source.cluster') }}</Label>
          <p class="text-[11px] text-muted-foreground">
            {{ t('layers.editor.source.clusterHint') }}
          </p>
        </div>
        <Switch
          :model-value="source.cluster === true"
          @update:model-value="v => patchSource({ cluster: v || undefined })"
        />
      </div>

      <div v-if="needsSourceLayer" class="space-y-1.5">
        <Label class="text-xs text-muted-foreground">
          {{ t('layers.editor.source.sourceLayer') }}
        </Label>
        <Input
          :model-value="draft.sourceLayer"
          class="h-8 text-xs font-mono"
          :placeholder="t('layers.editor.source.sourceLayerPlaceholder')"
          @update:model-value="v => (draft = { ...draft, sourceLayer: String(v) })"
        />
      </div>

      <!-- Source zoom range. Distinct from the layer's own — this bounds
           which tiles are fetched, the layer's bounds where it draws. -->
      <div class="flex items-center justify-between gap-2">
        <Label class="text-xs">{{ t('layers.editor.source.zoomRange') }}</Label>
        <div class="flex items-center gap-1">
          <Input
            type="number"
            class="h-7 w-16 text-xs"
            :model-value="source.minzoom ?? ''"
            placeholder="0"
            @update:model-value="v => setZoom('minzoom', String(v))"
          />
          <span class="text-muted-foreground text-xs">–</span>
          <Input
            type="number"
            class="h-7 w-16 text-xs"
            :model-value="source.maxzoom ?? ''"
            placeholder="22"
            @update:model-value="v => setZoom('maxzoom', String(v))"
          />
        </div>
      </div>

      <div class="space-y-1.5">
        <Label class="text-xs text-muted-foreground">
          {{ t('layers.editor.source.attribution') }}
        </Label>
        <Input
          :model-value="source.attribution ?? ''"
          class="h-8 text-xs"
          :placeholder="t('layers.editor.source.attributionPlaceholder')"
          @update:model-value="v => patchSource({ attribution: String(v) || undefined })"
        />
      </div>
    </div>

    <!-- Layer type, once the source narrows the options -->
    <div v-if="layerKinds.length > 1" class="space-y-2">
      <Label class="text-xs text-muted-foreground">
        {{ t('layers.editor.layerType') }}
      </Label>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="kind in layerKinds"
          :key="kind"
          class="px-2.5 py-1 rounded-md border text-xs transition-colors"
          :class="
            kind === draft.kind
              ? 'bg-secondary border-primary/40'
              : 'text-muted-foreground hover:bg-secondary/40'
          "
          @click="draft = { ...draft, kind, paint: {}, layout: {} }"
        >
          {{ kind }}
        </button>
      </div>
    </div>
  </div>
</template>
