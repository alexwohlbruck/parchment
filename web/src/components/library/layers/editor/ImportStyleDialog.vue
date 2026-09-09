<script setup lang="ts">
/**
 * Bring a layer in from a Mapbox Studio / Maputnik style.
 *
 * Paste the style JSON, pick a layer, and the editor opens on it. Layers whose
 * source is missing from the document can't be imported at all; layers that
 * lean on the origin style's sprite or fonts can, with a warning, because they
 * are still a useful starting point once the image names are swapped.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ITEM_ROW_SURFACES } from '@/components/ui/item-row'
import {
  parseStyleDocument,
  StyleParseError,
  type ImportCandidate,
} from '@/lib/map-style/import'
import { AlertTriangleIcon } from 'lucide-vue-next'

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{ select: [candidate: ImportCandidate] }>()

const { t } = useI18n()

const text = ref('')
const error = ref<string | null>(null)
const candidates = ref<ImportCandidate[]>([])
const styleName = ref<string | undefined>()

watch(open, isOpen => {
  if (isOpen) return
  text.value = ''
  error.value = null
  candidates.value = []
  styleName.value = undefined
})

function parse() {
  try {
    const parsed = parseStyleDocument(text.value)
    candidates.value = parsed.candidates
    styleName.value = parsed.name
    error.value = null
  } catch (e) {
    candidates.value = []
    error.value =
      e instanceof StyleParseError
        ? t(`layers.editor.import.errors.${e.message}`)
        : t('layers.editor.import.errors.invalidJson')
  }
}

const importable = computed(() => candidates.value.filter(c => c.importable).length)

function choose(candidate: ImportCandidate) {
  if (!candidate.importable) return
  emit('select', candidate)
  open.value = false
}
</script>

<template>
  <ResponsiveDialog
    v-model:open="open"
    :title="t('layers.editor.import.title')"
    :description="t('layers.editor.import.description')"
    content-class="sm:max-w-xl"
  >
    <template #content>
      <div v-if="!candidates.length" class="space-y-3">
        <Textarea
          v-model="text"
          :rows="10"
          spellcheck="false"
          class="font-mono text-xs leading-relaxed"
          :placeholder="t('layers.editor.import.placeholder')"
        />
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
        <Button class="w-full" :disabled="!text.trim()" @click="parse">
          {{ t('layers.editor.import.parse') }}
        </Button>
      </div>

      <div v-else class="space-y-3">
        <div class="flex items-baseline justify-between gap-2">
          <p class="text-sm font-medium truncate">
            {{ styleName ?? t('layers.editor.import.untitledStyle') }}
          </p>
          <span class="text-xs text-muted-foreground shrink-0">
            {{ t('layers.editor.import.count', { n: importable, total: candidates.length }) }}
          </span>
        </div>

        <div class="max-h-[50vh] overflow-y-auto -mx-1 px-1 space-y-1">
          <button
            v-for="candidate in candidates"
            :key="candidate.id"
            :class="[
              ITEM_ROW_SURFACES.tile,
              'w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors',
              candidate.importable
                ? 'hover:bg-secondary/40'
                : 'opacity-50 cursor-not-allowed',
            ]"
            :disabled="!candidate.importable"
            @click="choose(candidate)"
          >
            <span
              class="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-secondary text-muted-foreground font-mono"
            >
              {{ candidate.kind }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm truncate">{{ candidate.name }}</span>
              <span
                v-if="candidate.warnings.length"
                class="mt-0.5 flex items-start gap-1 text-[11px] text-muted-foreground"
              >
                <AlertTriangleIcon class="size-3 mt-px shrink-0" />
                <span>
                  {{
                    candidate.warnings
                      .map(w => t(`layers.editor.import.warnings.${w}`))
                      .join(' · ')
                  }}
                </span>
              </span>
            </span>
          </button>
        </div>

        <Button variant="ghost" class="w-full" @click="candidates = []">
          {{ t('layers.editor.import.back') }}
        </Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
