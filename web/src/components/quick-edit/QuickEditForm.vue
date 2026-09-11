<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SendIcon, FlaskConicalIcon } from 'lucide-vue-next'
import TagFieldRow from './TagFieldRow.vue'
import RawTagEditor from './RawTagEditor.vue'
import BrandSuggestions from './BrandSuggestions.vue'
import FeatureChips from './FeatureChips.vue'
import AddressField from './AddressField.vue'
import FormSection from './FormSection.vue'
import { groupFields, type SectionId } from '@/lib/quick-edit/field-groups'
import type { EditablePreset, NsiBrand } from '@/types/quick-edit.types'

const props = defineProps<{
  preset: EditablePreset | null
  tags: Record<string, string>
  submitting: boolean
  submitLabel: string
  lat: number
  lng: number
  /** Set when edits go to a non-production OSM server. */
  sandboxServer?: string | null
  /** Set when a brand match is already offered above the form. */
  brandsOffered?: boolean
}>()

const emit = defineEmits<{
  set: [key: string, value: string | null]
  brand: [brand: NsiBrand]
  submit: [comment: string]
}>()

const { t } = useI18n()

const comment = ref('')

const sections = computed(() => groupFields(props.preset?.fields ?? [], props.tags))

const SECTION_TITLES: Record<SectionId, string> = {
  basics: 'quickEdit.section.basics',
  features: 'quickEdit.section.features',
  hours: 'quickEdit.section.hours',
  address: 'quickEdit.section.address',
  contact: 'quickEdit.section.contact',
  more: 'quickEdit.section.more',
}

const basics = computed(() => sections.value.find((s) => s.id === 'basics'))
const collapsible = computed(() => sections.value.filter((s) => s.id !== 'basics'))

const rawTagCount = computed(() => Object.keys(props.tags).length)

const canSubmit = computed(() => rawTagCount.value > 0 && !props.submitting)

// Offer chains only while the feature isn't already identified as one, and
// never alongside a brand match card offering the same thing.
const showBrands = computed(
  () =>
    Boolean(props.preset && props.tags.name) &&
    !props.tags['brand:wikidata'] &&
    !props.brandsOffered,
)

function set(key: string, value: string | null) {
  emit('set', key, value)
}

function renameTag(oldKey: string, newKey: string) {
  if (!newKey || newKey === oldKey) return
  const value = props.tags[oldKey]
  emit('set', oldKey, null)
  emit('set', newKey, value)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-if="basics" class="space-y-3">
      <template v-for="field in basics.fields" :key="field.id">
        <TagFieldRow :field="field" :tags="tags" @set="set" />
        <BrandSuggestions
          v-if="field.key === 'name' && showBrands"
          :name="tags.name"
          :preset-id="preset!.id"
          @select="emit('brand', $event)"
        />
      </template>
    </div>

    <FormSection
      v-for="section in collapsible"
      :key="section.id"
      :title="t(SECTION_TITLES[section.id])"
      :filled="section.filled"
      :default-open="section.filled > 0"
    >
      <FeatureChips
        v-if="section.id === 'features'"
        :fields="section.fields"
        :tags="tags"
        @set="set"
      />
      <template v-else>
        <template v-for="field in section.fields" :key="field.id">
          <AddressField
            v-if="field.type === 'address'"
            :tags="tags"
            :lat="lat"
            :lng="lng"
            @set="set"
          />
          <TagFieldRow v-else :field="field" :tags="tags" @set="set" />
        </template>
      </template>
    </FormSection>

    <FormSection :title="t('quickEdit.allTags')" :filled="rawTagCount">
      <RawTagEditor :tags="tags" @set="set" @rename="renameTag" />
    </FormSection>

    <div class="space-y-1 border-t border-border pt-3">
      <Label class="text-xs text-muted-foreground">
        {{ t('quickEdit.changesetComment') }}
      </Label>
      <Input v-model="comment" :placeholder="t('quickEdit.commentPlaceholder')" />
    </div>

    <div
      v-if="sandboxServer"
      class="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
    >
      <FlaskConicalIcon class="size-3.5 shrink-0" />
      {{ t('quickEdit.sandboxNotice', { server: sandboxServer }) }}
    </div>

    <Button
      :icon="SendIcon"
      :loading="submitting"
      :disabled="!canSubmit"
      class="w-full"
      @click="emit('submit', comment.trim())"
    >
      {{ submitLabel }}
    </Button>
  </div>
</template>
