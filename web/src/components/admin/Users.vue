<script setup lang="ts">
import { h, onMounted, ref, computed } from 'vue'
import dayjs from 'dayjs'
import { z } from 'zod'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ColumnDef } from '@tanstack/vue-table'
import { PermissionId, User } from '@/types/auth.types'
import { useI18n } from 'vue-i18n'
import { useUserService } from '@/services/user.service'
import { useAppService } from '@/services/app.service'
import { useAuthService } from '@/services/auth.service'
import { useResponsive } from '@/lib/utils'

import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { PlusIcon, Trash2Icon } from 'lucide-vue-next'
import Avatar from '@/components/ui/avatar/Avatar.vue'
import AvatarImage from '@/components/ui/avatar/AvatarImage.vue'
import Badge from '@/components/ui/badge/Badge.vue'
import { SettingsSection } from '@/components/settings'

dayjs.extend(localizedFormat)

const { t } = useI18n()
const appService = useAppService()
const authService = useAuthService()
const userService = useUserService()
const { isTabletScreen } = useResponsive()
const users = ref<User[]>([])

const columns = computed<ColumnDef<User>[]>(() => {
  const baseColumns: ColumnDef<User>[] = []

  // Avatar column (desktop only)
  if (!isTabletScreen.value) {
    baseColumns.push({
      id: 'avatar',
      cell: ({ row }) =>
        h(Avatar, {}, [
          h(AvatarImage, {
            src: row.original.picture || '',
          }),
        ]),
    })
  }

  // Alias column (display names are metadata-encrypted; admins see the
  // alias + email only, since they don't hold the user's seed).
  baseColumns.push({
    header: 'Alias',
    accessorFn: data => data.alias ?? '—',
  })

  // Email column (desktop only)
  if (!isTabletScreen.value) {
    baseColumns.push({
      header: 'Email',
      accessorKey: 'email',
    })
  }

  // Roles column (always visible)
  baseColumns.push({
    id: 'roles',
    header: 'Roles',
    cell: ({ row }) =>
      h(
        'div',
        {
          class: 'flex gap-2',
        },
        [
          row.original.roles?.map(role =>
            h(Badge, { variant: 'outline' }, [role.name]),
          ),
        ],
      ),
  })

  // Sessions column (desktop only)
  if (!isTabletScreen.value) {
    baseColumns.push({
      id: 'sessions',
      header: 'Sessions',
      accessorKey: 'sessionCount',
      meta: {
        headerClass: 'text-right',
        cellClass: 'text-right',
      },
    })
  }

  // Delete column (always visible)
  baseColumns.push({
    id: 'delete',
    cell: ({ row }) =>
      h(Button, {
        disabled: true, // TODO: User delete
        variant: 'destructive-outline',
        size: 'icon',
        icon: Trash2Icon,
        description: 'Delete user', // TODO: i18n
      }),
  })

  return baseColumns
})

async function getUsers() {
  users.value = await userService.getUsers()
}

async function inviteUser() {
  // Names are metadata-encrypted at rest and can only be set by the invitee
  // post-login (the admin doesn't hold the user's seed). Admin provides
  // email + role + optional picture only.
  const schema = z.object({
    email: z.string().email(),
    role: z.enum(['user', 'alpha', 'admin']).default('user'),
    picture: z.string().url().optional(),
  })

  const user = (await appService.promptForm({
    title: 'Invite user',
    schema,
  })) as z.infer<typeof schema>

  const newUser = await userService.inviteUser(user)

  users.value = [...users.value, newUser]

  appService.toast.success(t('messages.invitationSent', { email: user.email }))
}

onMounted(getUsers)
</script>

<template>
  <SettingsSection :title="$t('settings.users.users.title')" :frame="false">
    <template v-slot:actions>
      <Button
        v-if="authService.hasPermission(PermissionId.USERS_CREATE)"
        @click="inviteUser()"
        variant="outline"
        :icon="PlusIcon"
      >
        Invite user
      </Button>
    </template>

    <DataTable class="w-full" :columns="columns" :data="users"></DataTable>
  </SettingsSection>
</template>
