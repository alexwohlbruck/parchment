<script setup lang="ts">
import { ref, computed } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { Permission } from '@/types/auth.types'

import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { TagsInput, TagsInputItem, TagsInputItemDelete, TagsInputItemText } from '@/components/ui/tags-input'
import {
  Combobox,
  ComboboxAnchor,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox'
import { ComboboxInput } from 'reka-ui'

const props = defineProps<{
  initialValues?: {
    name?: string
    description?: string
    permissions?: string[]
  }
  permissions: Permission[]
}>()

const schema = toTypedSchema(
  z.object({
    name: z.string().min(1, 'Required'),
    description: z.string().optional(),
  }),
)

const { validate } = useForm({
  validationSchema: schema,
  initialValues: {
    name: props.initialValues?.name ?? '',
    description: props.initialValues?.description ?? '',
  },
})

const selectedPermissions = ref<string[]>(props.initialValues?.permissions ?? [])
const searchTerm = ref('')
const open = ref(false)

const availablePermissions = computed(() =>
  props.permissions.filter(p =>
    !selectedPermissions.value.includes(p.id) &&
    (p.name.toLowerCase().includes(searchTerm.value.toLowerCase()) ||
     p.id.toLowerCase().includes(searchTerm.value.toLowerCase())),
  ),
)

function permissionName(value: any) {
  return props.permissions.find(p => p.id === String(value))?.name ?? String(value)
}

defineExpose({
  submit: async () => {
    const { valid, values } = await validate()
    if (!valid) return false
    return {
      ...values,
      permissions: selectedPermissions.value,
    }
  },
})
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent>
    <FormField v-slot="{ componentField }" name="name">
      <FormItem>
        <FormLabel>Name</FormLabel>
        <FormControl>
          <Input v-bind="componentField" />
        </FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <FormField v-slot="{ componentField }" name="description">
      <FormItem>
        <FormLabel>Description</FormLabel>
        <FormControl>
          <Textarea v-bind="componentField" rows="2" />
        </FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <div>
      <p class="text-sm font-medium mb-2">Permissions</p>
      <Combobox v-model="selectedPermissions" v-model:open="open" v-model:search-term="searchTerm" multiple open-on-focus>
        <ComboboxAnchor as-child>
          <TagsInput
            :model-value="selectedPermissions"
            :display-value="permissionName"
            class="min-h-9 px-2 gap-1"
            @update:model-value="selectedPermissions = $event as string[]"
          >
            <TagsInputItem v-for="permId in selectedPermissions" :key="permId" :value="permId">
              <TagsInputItemText />
              <TagsInputItemDelete />
            </TagsInputItem>
            <ComboboxInput
              :display-value="() => ''"
              placeholder="Add permission..."
              class="text-sm min-h-5 min-w-20 focus:outline-none flex-1 bg-transparent px-1"
              @keydown.enter.prevent
            />
          </TagsInput>
        </ComboboxAnchor>

        <ComboboxList class="p-1 max-h-48">
          <ComboboxEmpty class="py-2 px-3 text-sm text-muted-foreground">
            No permissions found
          </ComboboxEmpty>
          <ComboboxItem
            v-for="perm in availablePermissions"
            :key="perm.id"
            :value="perm.id"
            class="cursor-pointer"
          >
            <span class="font-medium">{{ perm.name }}</span>
            <span class="text-muted-foreground ml-2 text-xs">{{ perm.id }}</span>
          </ComboboxItem>
        </ComboboxList>
      </Combobox>
    </div>
  </form>
</template>
