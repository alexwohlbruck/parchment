<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import { z } from 'zod'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ColumnDef } from '@tanstack/vue-table'
import { User } from '@/types/auth.types'

import { useUserService } from '@/services/user.service'
import { useAppService } from '@/services/app.service'
import { useAuthService } from '@/services/auth.service'

import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { PlusIcon, Trash2Icon } from 'lucide-vue-next'
import Avatar from '@/components/ui/avatar/Avatar.vue'
import AvatarImage from '@/components/ui/avatar/AvatarImage.vue'
import Badge from '@/components/ui/badge/Badge.vue'

dayjs.extend(localizedFormat)

const appService = useAppService()
const authService = useAuthService()
const userService = useUserService()
const users = ref<User[]>([])

const columns: ColumnDef<User>[] = [
  {
    id: 'delete',
    cell: ({ row }) =>
      h(Avatar, {}, [
        h(AvatarImage, {
          src: row.original.picture || '',
        }),
      ]),
  },
  {
    header: 'Name',
    accessorFn: data => `${data.firstName} ${data.lastName}`,
  },
  {
    header: 'Email',
    accessorKey: 'email',
  },
  {
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
  },
  {
    id: 'sessions',
    header: 'Sessions',
    accessorKey: 'sessionCount',
  },
  {
    id: 'delete',
    cell: ({ row }) =>
      h(Button, {
        disabled: true, // TODO: User delete
        variant: 'outline',
        size: 'icon',
        icon: Trash2Icon,
        class: 'text-destructive',
        description: 'Delete user',
      }),
  },
]

async function getUsers() {
  users.value = await userService.getUsers()
}

async function inviteUser() {
  const schema = z.object({
    firstName: z.string().describe('First name'), // TODO: i18n
    lastName: z.string(),
    email: z.string().email(),
    role: z.enum(['user', 'alpha', 'admin']).default('user'),
    picture: z.string().url(),
  })

  const user = (await appService.promptForm({
    title: 'Invite user',
    schema,
  })) as z.infer<typeof schema>

  const newUser = await userService.inviteUser(user)

  users.value = [...users.value, newUser]

  appService.toast.success(`Invitation sent to ${user.email}`) // TODO: i18n
}

onMounted(getUsers)
</script>

<template>
  <div class="flex w-full align-center justify-between">
    <H4 class="leading-loose">Users</H4>

    <Button
      v-if="authService.hasPermission('users:create')"
      @click="inviteUser()"
      variant="outline"
      :icon="PlusIcon"
    >
      Invite user
    </Button>
  </div>

  <DataTable class="w-full" :columns="columns" :data="users"></DataTable>
</template>
