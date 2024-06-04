<script setup lang="ts">
import { h, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ColumnDef } from '@tanstack/vue-table'
import { User } from '@/types/auth.types'

import { useUserService } from '@/services/user.service'

import { H4 } from '@/components/ui/typography'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import { PlusIcon, Trash2Icon } from 'lucide-vue-next'
import Avatar from '@/components/ui/avatar/Avatar.vue'
import AvatarImage from '@/components/ui/avatar/AvatarImage.vue'
import Badge from '@/components/ui/badge/Badge.vue'

dayjs.extend(localizedFormat)

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
    header: 'ID',
    accessorKey: 'id',
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

async function getPasskeys() {
  users.value = await userService.getUsers()
}

onMounted(getPasskeys)
</script>

<template>
  <div class="flex w-full align-center justify-between">
    <H4 class="leading-loose">Users</H4>

    <!-- <Button @click="addPasskey()" variant="outline" :icon="PlusIcon">
      Add user
    </Button> -->
  </div>

  <DataTable class="w-full" :columns="columns" :data="users"></DataTable>
</template>
