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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  PlusIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  EyeIcon,
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

const canUpdate = computed(() =>
  authService.hasPermission(PermissionId.USERS_UPDATE),
)
const canDelete = computed(() =>
  authService.hasPermission(PermissionId.USERS_DELETE),
)
const isDev = import.meta.env.DEV

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

  if (canUpdate.value || canDelete.value) {
    baseColumns.push({
      id: 'actions',
      meta: {
        headerClass: 'w-10',
        cellClass: 'text-center',
      },
      cell: ({ row }) => {
        const isMe = row.original.id === authStore.me?.id
        const items: any[] = []

        if (canUpdate.value) {
          items.push(
            h(
              DropdownMenuItem,
              { onClick: () => router.push({ name: AppRoute.USER_DETAIL, params: { id: row.original.id } }) },
              () => [h(PencilIcon, { class: 'size-4 mr-2' }), 'Edit'],
            ),
          )
        }

        if (isDev && !isMe) {
          items.push(
            h(
              DropdownMenuItem,
              { onClick: () => impersonateUser(row.original) },
              () => [h(EyeIcon, { class: 'size-4 mr-2' }), 'Impersonate'],
            ),
          )
        }

        if (canDelete.value && !isMe) {
          if (items.length > 0) items.push(h(DropdownMenuSeparator))
          items.push(
            h(
              DropdownMenuItem,
              {
                class: 'text-destructive',
                onClick: () => deleteUser(row.original),
              },
              () => [h(Trash2Icon, { class: 'size-4 mr-2' }), 'Delete'],
            ),
          )
        }

        if (items.length === 0) return null

        return h(
          DropdownMenu,
          {},
          {
            default: () => [
              h(
                DropdownMenuTrigger,
                { asChild: true },
                () =>
                  h(Button, {
                    variant: 'ghost',
                    size: 'icon-sm',
                    icon: EllipsisVerticalIcon,
                    onClick: (e: MouseEvent) => e.stopPropagation(),
                  }),
              ),
              h(DropdownMenuContent, { align: 'end' }, () => items),
            ],
          },
        )
      },
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
      warning: 'This action cannot be undone.',
    },
    title: `Delete ${user.firstName} ${user.lastName}?`,
    description:
      'This will permanently remove the user and invalidate all their sessions.',
    destructive: true,
    contentClass: 'md:max-w-md lg:max-w-md',
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

  await userService.inviteUser(result as { email: string; roles: string[] })
  await getUsers(currentPage.value)
  appService.toast.success(t('messages.invitationSent', { email: result.email }))
}

async function impersonateUser(user: User) {
  const confirmed = await appService.confirm({
    title: `Impersonate ${user.firstName} ${user.lastName}?`,
    description:
      'You will be logged in as this user. A banner will appear at the bottom of the screen to return to your admin session.',
  })
  if (!confirmed) return

  try {
    await authService.impersonateUser(user.id)
    router.push({ name: AppRoute.MAP })
  } catch (err: any) {
    appService.toast.error(err?.response?.data?.message ?? 'Failed to impersonate user')
  }
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
