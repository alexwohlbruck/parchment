<script setup lang="ts">
/**
 * The style half of the editor: every catalogued property for the chosen
 * layer type, grouped into sections and written into the draft's `paint` /
 * `layout` bags.
 *
 * Setting a property writes it; resetting deletes the key rather than
 * writing the spec default, so the saved configuration only ever contains
 * what the user actually decided.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LayerDraft } from '@/lib/map-style/draft'
import {
  LAYER_SECTIONS,
  sectionProperties,
  type StyleProperty,
} from '@/lib/map-style/spec'
import EditorSection from './EditorSection.vue'
import PropertyField from './PropertyField.vue'
import JsonField from './JsonField.vue'
import ResponsiveDialog from '@/components/responsive/ResponsiveDialog.vue'

const draft = defineModel<LayerDraft>({ required: true })

const { t } = useI18n()

const sections = computed(() =>
  LAYER_SECTIONS[draft.value.kind].map(id => ({
    id,
    properties: sectionProperties(draft.value.kind, id),
  })),
)

function bagOf(property: StyleProperty) {
  return property.bag === 'paint' ? draft.value.paint : draft.value.layout
}

function valueOf(property: StyleProperty) {
  return bagOf(property)[property.key]
}

/** How many properties in a section carry a value — shown on the header. */
function setCount(properties: StyleProperty[]) {
  return properties.filter(p => valueOf(p) !== undefined).length || undefined
}

function write(property: StyleProperty, value: unknown) {
  const bag = { ...bagOf(property) }
  if (value === undefined || value === '') delete bag[property.key]
  else bag[property.key] = value
  draft.value = { ...draft.value, [property.bag]: bag }
}

// Expressions and stop functions get a JSON sheet rather than a control.
const editing = ref<StyleProperty | null>(null)
const editingOpen = computed({
  get: () => editing.value !== null,
  set: (open: boolean) => {
    if (!open) editing.value = null
  },
})
</script>

<template>
  <div class="space-y-2">
    <EditorSection
      v-for="(section, index) in sections"
      :key="section.id"
      :title="t(`layers.editor.sections.${section.id}`)"
      :badge="setCount(section.properties)"
      :open="index === 0"
    >
      <div class="divide-y divide-border/50">
        <PropertyField
          v-for="property in section.properties"
          :key="property.key"
          :property="property"
          :value="valueOf(property)"
          @update="value => write(property, value)"
          @clear="write(property, undefined)"
          @edit-json="editing = property"
        />
      </div>
    </EditorSection>

    <ResponsiveDialog
      v-model:open="editingOpen"
      :title="editing?.label ?? ''"
      :description="editing?.key"
    >
      <template #content>
        <JsonField
          v-if="editing"
          :model-value="valueOf(editing)"
          :rows="10"
          @update:model-value="value => write(editing!, value)"
        />
      </template>
    </ResponsiveDialog>
  </div>
</template>
