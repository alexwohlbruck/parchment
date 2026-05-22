<script setup lang="ts">
import { ref, computed } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { Role } from '@/types/auth.types'

import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
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
    firstName?: string
    lastName?: string
    email?: string
    roles?: string[]
  }
  roles: Role[]
}>()

const schema = toTypedSchema(
  z.object({
    firstName: z.string().min(1, 'Required'),
    lastName: z.string().min(1, 'Required'),
    email: z.string().email('Invalid email'),
  }),
)

const { validate } = useForm({
  validationSchema: schema,
  initialValues: {
    firstName: props.initialValues?.firstName ?? '',
    lastName: props.initialValues?.lastName ?? '',
    email: props.initialValues?.email ?? '',
  },
})

const selectedRoles = ref<string[]>(props.initialValues?.roles ?? [])
const searchTerm = ref('')
const open = ref(false)

const availableRoles = computed(() =>
  props.roles.filter(r =>
    !selectedRoles.value.includes(r.id) &&
    r.name.toLowerCase().includes(searchTerm.value.toLowerCase()),
  ),
)

function roleName(value: any) {
  return props.roles.find(r => r.id === String(value))?.name ?? String(value)
}

defineExpose({
  submit: async () => {
    const { valid, values } = await validate()
    if (!valid) return false
    return {
      ...values,
      roles: selectedRoles.value,
    }
  },
})
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent>
    <div class="grid grid-cols-2 gap-3">
      <FormField v-slot="{ componentField }" name="firstName">
        <FormItem>
          <FormLabel>First name</FormLabel>
          <FormControl>
            <Input v-bind="componentField" />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField }" name="lastName">
        <FormItem>
          <FormLabel>Last name</FormLabel>
          <FormControl>
            <Input v-bind="componentField" />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>
    </div>

    <FormField v-slot="{ componentField }" name="email">
      <FormItem>
        <FormLabel>Email</FormLabel>
        <FormControl>
          <Input type="email" v-bind="componentField" />
        </FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <div>
      <p class="text-sm font-medium mb-2">Roles</p>
      <Combobox v-model="selectedRoles" v-model:open="open" v-model:search-term="searchTerm" multiple open-on-focus>
        <ComboboxAnchor as-child>
          <TagsInput
            :model-value="selectedRoles"
            :display-value="roleName"
            class="min-h-9 px-2 gap-1"
            @update:model-value="selectedRoles = $event as string[]"
          >
            <TagsInputItem v-for="roleId in selectedRoles" :key="roleId" :value="roleId">
              <TagsInputItemText />
              <TagsInputItemDelete />
            </TagsInputItem>
            <ComboboxInput
              :display-value="() => ''"
              placeholder="Add role..."
              class="text-sm min-h-5 min-w-20 focus:outline-none flex-1 bg-transparent px-1"
              @keydown.enter.prevent
            />
          </TagsInput>
        </ComboboxAnchor>

        <ComboboxList class="p-1">
          <ComboboxEmpty class="py-2 px-3 text-sm text-muted-foreground">
            No roles found
          </ComboboxEmpty>
          <ComboboxItem
            v-for="role in availableRoles"
            :key="role.id"
            :value="role.id"
            class="cursor-pointer"
          >
            {{ role.name }}
          </ComboboxItem>
        </ComboboxList>
      </Combobox>
    </div>
  </form>
</template>
