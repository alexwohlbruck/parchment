<script setup lang="ts">
import { h, onMounted, ref, computed } from 'vue'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { ColumnDef } from '@tanstack/vue-table'
import { PermissionId, User, Role } from '@/types/auth.types'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import { useUserService } from '@/services/user.service'
import { useAppService } from '@/services/app.service'
import { useAuthService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'
import { useResponsive } from '@/lib/utils'

import InviteUserForm from './InviteUserForm.vue'
import DeleteConfirmForm from './DeleteConfirmForm.vue'
import DataTable from '@/components/table/DataTable.vue'
import { Button } from '@/components/ui/button'
import {
  PlusIcon,
  Trash2Icon,
} from 'lucide-vue-next'
import Avatar from '@/components/ui/avatar/Avatar.vue'
import AvatarImage from '@/components/ui/avatar/AvatarImage.vue'
import Badge from '@/components/ui/badge/Badge.vue'
import { SettingsSection } from '@/components/settings'

dayjs.extend(localizedFormat)

const { t } = useI18n()
const router = useRouter()
const appService = useAppService()
const authService = useAuthService()
const authStore = useAuthStore()
const userService = useUserService()
const { isTabletScreen } = useResponsive()
const PAGE_SIZE = 25
const users = ref<User[]>([])
const allRoles = ref<Role[]>([])
const totalUsers = ref(0)
const currentPage = ref(1)

const canDelete = computed(() =>
  authService.hasPermission(PermissionId.USERS_DELETE),
)

const columns = computed<ColumnDef<User>[]>(() => {
  const baseColumns: ColumnDef<User>[] = []

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

  baseColumns.push({
    header: 'Name',
    accessorFn: data => `${data.firstName} ${data.lastName}`,
  })

  if (!isTabletScreen.value) {
    baseColumns.push({
      header: 'Email',
      accessorKey: 'email',
    })
  }

  baseColumns.push({
    id: 'roles',
    header: 'Roles',
    cell: ({ row }) =>
      h(
        'div',
        { class: 'flex gap-2' },
        [
          row.original.roles?.map(role =>
            h(Badge, { variant: 'outline' }, [role.name]),
          ),
        ],
      ),
  })

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

  if (canDelete.value) {
    baseColumns.push({
      id: 'actions',
      meta: {
        headerClass: 'w-12',
        cellClass: 'text-right',
      },
      cell: ({ row }) =>
        row.original.id !== authStore.me?.id
          ? h(Button, {
              variant: 'ghost',
              size: 'icon-sm',
              icon: Trash2Icon,
              class: 'text-muted-foreground hover:text-destructive',
              onClick: (e: MouseEvent) => {
                e.stopPropagation()
                deleteUser(row.original)
              },
            })
          : null,
    })
  }

  return baseColumns
})

async function getUsers(page = 1) {
  const result = await userService.getUsers(page, PAGE_SIZE)
  users.value = result.data
  totalUsers.value = result.total
  currentPage.value = result.page
}

async function deleteUser(user: User) {
  const confirmed = await appService.componentDialog({
    component: DeleteConfirmForm,
    props: {
      confirmValue: 'delete-user',
      label: 'Type "delete-user" to confirm.',
    },
    title: `Delete ${user.firstName} ${user.lastName}?`,
    description:
      'This will permanently remove the user and invalidate all their sessions. This cannot be undone.',
    destructive: true,
    contentClass: 'md:max-w-sm lg:max-w-sm',
    continueText: 'Delete',
  })
  if (!confirmed) return

  await userService.deleteUser(user.id)
  await getUsers(currentPage.value)
  appService.toast.success('User deleted')
}

async function inviteUser() {
  const result = await appService.componentDialog({
    component: InviteUserForm,
    props: {
      roles: allRoles.value,
    },
    title: 'Invite user',
    continueText: 'Send invite',
  })

  if (!result) return

  const newUser = await userService.inviteUser(result)
  users.value = [...users.value, newUser]
  appService.toast.success(t('messages.invitationSent', { email: result.email }))
}

function onRowClick(user: User) {
  router.push({ name: AppRoute.USER_DETAIL, params: { id: user.id } })
}

onMounted(async () => {
  await Promise.all([getUsers(), loadRoles()])
})

async function loadRoles() {
  allRoles.value = await userService.getRoles()
}
</script>

<template>
  <SettingsSection
    id="users"
    :title="$t('settings.users.users.title')"
    :frame="false"
  >
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

    <DataTable
      class="w-full"
      :columns="columns"
      :data="users"
      :page-size="PAGE_SIZE"
      :total-items="totalUsers"
      :current-page="currentPage"
      :on-row-click="onRowClick"
      @update:page="getUsers"
    />
  </SettingsSection>
</template>
