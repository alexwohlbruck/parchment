<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCollectionGroupsStore } from '@/stores/library/collection-groups.store'
import { canParentGroup, groupPath } from '@/lib/library/collection-groups'

const props = withDefaults(
  defineProps<{
    groupId?: string
    name?: string
    parentId?: string | null
    destinationOnly?: boolean
  }>(),
  { name: '', parentId: null },
)
const emit = defineEmits<{ 'update:valid': [valid: boolean] }>()
const { t } = useI18n()
const store = useCollectionGroupsStore()
const name = ref(props.name)
const parentId = ref(props.parentId ?? '')
const destinations = computed(() =>
  store.organization.groups
    .filter(
      group =>
        !props.groupId ||
        canParentGroup(store.organization.groups, props.groupId, group.id),
    )
    .map(group => ({
      id: group.id,
      path: groupPath(store.organization.groups, group.id),
    }))
    .sort((a, b) => a.path.localeCompare(b.path)),
)
const valid = computed(
  () =>
    (props.destinationOnly ||
      (name.value.trim().length > 0 && name.value.trim().length <= 100)) &&
    (!parentId.value ||
      destinations.value.some(group => group.id === parentId.value)),
)
watch(valid, value => emit('update:valid', value), { immediate: true })
defineExpose({
  submit: () =>
    valid.value
      ? { name: name.value.trim(), parentId: parentId.value || null }
      : undefined,
})
</script>

<template>
  <div class="space-y-4">
    <div v-if="!destinationOnly" class="space-y-2">
      <Label for="collection-group-name">{{ t('general.name') }}</Label>
      <Input
        id="collection-group-name"
        v-model="name"
        maxlength="100"
        autofocus
      />
    </div>
    <div class="space-y-2">
      <Label for="collection-group-parent">{{
        t('library.collections.groups.location')
      }}</Label>
      <select
        id="collection-group-parent"
        v-model="parentId"
        class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="">{{ t('library.collections.groups.root') }}</option>
        <option v-for="group in destinations" :key="group.id" :value="group.id">
          {{ group.path }}
        </option>
      </select>
    </div>
  </div>
</template>
