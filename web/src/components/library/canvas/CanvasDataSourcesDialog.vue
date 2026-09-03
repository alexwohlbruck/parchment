<script setup lang="ts">
/**
 * The data sources browser.
 *
 * A source is where data lives; a layer is one rendering of it. Browsing them
 * separately is what makes the global library useful — you pick "Time zones"
 * without also having to decide, in the same breath, what colour it is.
 *
 * Three ways in, matching the shape of the thing: a curated library, your own
 * files and URLs, and live database connections. The last of those is
 * declared but not built, and says so.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ItemIcon } from '@/components/ui/item-icon'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import { useAppService } from '@/services/app.service'
import {
  DATABASE_CONNECTORS,
  searchLibrary,
  type DataSourceDefinition,
} from '@/lib/data-sources/catalogue'
import {
  ACCEPTED_EXTENSIONS,
  GeoImportError,
  importGeoFile,
  parseGeoData,
} from '@/lib/geo-import'
import { LinkIcon, LockIcon, SearchIcon, UploadIcon } from 'lucide-vue-next'

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{
  /** A library source the canvas should add a layer from. */
  addLibrary: [source: DataSourceDefinition]
  /** A file or URL the user supplied, already parsed. */
  addFile: [
    result: { name: string; collection: unknown; format: string },
  ]
}>()

const { t } = useI18n()
const appService = useAppService()

type Section = 'library' | 'new'
const section = ref<Section>('library')
const query = ref('')
const url = ref('')
const busy = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

watch(open, isOpen => {
  if (isOpen) return
  section.value = 'library'
  query.value = ''
  url.value = ''
})

const results = computed(() => searchLibrary(query.value))

function choose(source: DataSourceDefinition) {
  emit('addLibrary', source)
  open.value = false
}

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  busy.value = true
  try {
    const result = await importGeoFile(file)
    emit('addFile', {
      name: file.name.replace(/\.[^.]+$/, ''),
      collection: result.collection,
      format: result.format,
    })
    open.value = false
  } catch (error) {
    appService.toast.error(
      error instanceof GeoImportError
        ? t(`canvases.import.errors.${error.key}`)
        : t('canvases.import.errors.failed'),
    )
  } finally {
    busy.value = false
  }
}

/**
 * Fetch and parse a URL the user pasted. The format comes from the URL's own
 * extension, which is all we have to go on before it arrives.
 */
async function addFromUrl() {
  const target = url.value.trim()
  if (!target || busy.value) return
  busy.value = true
  try {
    const response = await fetch(target)
    if (!response.ok) throw new GeoImportError('failed')
    const text = await response.text()
    const filename = target.split('/').pop()?.split('?')[0] || 'data.geojson'
    const result = parseGeoData(text, filename)
    emit('addFile', {
      name: filename.replace(/\.[^.]+$/, ''),
      collection: result.collection,
      format: result.format,
    })
    open.value = false
  } catch (error) {
    appService.toast.error(
      error instanceof GeoImportError
        ? t(`canvases.import.errors.${error.key}`)
        : t('canvases.import.errors.fetchFailed'),
    )
  } finally {
    busy.value = false
  }
}

function connectorUnavailable() {
  appService.toast.info(t('canvases.sources.connectorSoon'))
}
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    :title="t('canvases.sources.title')"
    :description="t('canvases.sources.description')"
    content-class="sm:max-w-2xl"
  >
    <template #content>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        :accept="ACCEPTED_EXTENSIONS"
        @change="onFilePicked"
      />

      <div class="space-y-3">
        <div class="inline-flex rounded-lg border p-0.5 gap-0.5">
          <button
            v-for="id in (['library', 'new'] as Section[])"
            :key="id"
            class="px-2.5 py-1 rounded-md text-xs transition-colors"
            :class="
              section === id
                ? 'bg-secondary text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            "
            @click="section = id"
          >
            {{ t(`canvases.sources.sections.${id}`) }}
          </button>
        </div>

        <!-- Curated library -->
        <template v-if="section === 'library'">
          <div class="relative">
            <SearchIcon
              class="absolute left-2.5 top-2.5 size-4 text-muted-foreground"
            />
            <Input
              v-model="query"
              class="h-9 pl-8"
              :placeholder="t('canvases.sources.search')"
            />
          </div>

          <div
            class="max-h-[50vh] overflow-y-auto -mx-1 px-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5"
          >
            <button
              v-for="source in results"
              :key="source.id"
              :class="[
                ITEM_ROW_SURFACES.tile,
                'flex items-start gap-2.5 p-3 text-left transition-colors hover:bg-secondary/40',
              ]"
              @click="choose(source)"
            >
              <ItemIcon :icon="source.icon" size="sm" variant="ghost" />
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium truncate">
                  {{ source.name }}
                </span>
                <span
                  class="block text-xs text-muted-foreground leading-snug line-clamp-2"
                >
                  {{ source.description }}
                </span>
                <span class="mt-1 block text-[11px] text-muted-foreground/80">
                  {{ source.provider }}
                </span>
              </span>
            </button>

            <p
              v-if="!results.length"
              class="col-span-full py-8 text-center text-sm text-muted-foreground"
            >
              {{ t('canvases.sources.noResults') }}
            </p>
          </div>
        </template>

        <!-- Your own data -->
        <template v-else>
          <p class="text-xs text-muted-foreground">
            {{ t('canvases.sources.uploadDirectly') }}
          </p>

          <Button
            variant="outline"
            class="w-full justify-start"
            :disabled="busy"
            @click="fileInput?.click()"
          >
            <Spinner v-if="busy" class="size-4" />
            <UploadIcon v-else class="size-4" />
            {{ t('canvases.add.options.import.title') }}
          </Button>

          <div class="flex items-center gap-1.5">
            <div class="relative flex-1">
              <LinkIcon
                class="absolute left-2.5 top-2.5 size-4 text-muted-foreground"
              />
              <Input
                v-model="url"
                class="h-9 pl-8 text-xs font-mono"
                :placeholder="t('canvases.sources.urlPlaceholder')"
                @keydown.enter="addFromUrl"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              class="h-9 shrink-0"
              :disabled="!url.trim() || busy"
              @click="addFromUrl"
            >
              {{ t('general.add') }}
            </Button>
          </div>

          <p class="text-[11px] text-muted-foreground">
            {{ t('canvases.sources.formats') }}
          </p>

          <div class="pt-2 space-y-1.5">
            <p class="text-xs text-muted-foreground">
              {{ t('canvases.sources.connectToSource') }}
            </p>
            <!-- Declared, not built: each says so rather than failing on click. -->
            <button
              v-for="connector in DATABASE_CONNECTORS"
              :key="connector.id"
              :class="[
                ITEM_ROW_SURFACES.tile,
                'w-full flex items-center gap-2.5 px-3 py-2 text-left opacity-70 transition-colors hover:bg-secondary/30',
              ]"
              @click="connectorUnavailable"
            >
              <ItemIcon :icon="connector.icon" size="xs" variant="ghost" />
              <span class="min-w-0 flex-1">
                <span class="block text-sm">{{ connector.name }}</span>
                <span class="block text-[11px] text-muted-foreground truncate">
                  {{ connector.description }}
                </span>
              </span>
              <LockIcon class="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </div>
        </template>
      </div>
    </template>
  </ResponsiveDialog>
</template>
