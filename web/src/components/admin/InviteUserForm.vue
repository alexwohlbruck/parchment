<script setup lang="ts">
import { ref, computed } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { type Role, PermissionId } from '@/types/auth.types'
import { useAuthService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'

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
  roles: Role[]
}>()

const schema = toTypedSchema(
  z.object({
    email: z.string().email('Invalid email'),
  }),
)

const { validate } = useForm({
  validationSchema: schema,
  initialValues: {
    email: '',
  },
})

const authService = useAuthService()
const authStore = useAuthStore()

// Role assignment on invite is gated server-side: callers with USERS_UPDATE
// (admins) may grant any role; everyone else may grant only the default 'user'
// role plus roles they themselves hold. Mirror that here so the picker offers
// exactly the assignable roles — letting an alpha tester invite other alphas.
const canAssignAnyRole = computed(() =>
  authService.hasPermission(PermissionId.USERS_UPDATE),
)
const grantableRoleIds = computed(() =>
  canAssignAnyRole.value ? null : new Set(['user', ...authStore.roles]),
)
// Only worth showing the picker when there's a non-default role to choose.
const showRolePicker = computed(
  () => canAssignAnyRole.value || authStore.roles.some(r => r !== 'user'),
)

const selectedRoles = ref<string[]>(['user'])
const searchTerm = ref('')
const open = ref(false)

const availableRoles = computed(() =>
  props.roles.filter(r =>
    !selectedRoles.value.includes(r.id) &&
    r.name.toLowerCase().includes(searchTerm.value.toLowerCase()) &&
    (!grantableRoleIds.value || grantableRoleIds.value.has(r.id)),
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
      // Picker only offers grantable roles; empty falls back to 'user' server-side.
      roles: selectedRoles.value,
    }
  },
})
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent>
    <FormField v-slot="{ componentField }" name="email">
      <FormItem>
        <FormLabel>Email</FormLabel>
        <FormControl>
          <Input type="email" v-bind="componentField" />
        </FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <div v-if="showRolePicker">
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
