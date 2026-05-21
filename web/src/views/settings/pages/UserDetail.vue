<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import { AppRoute } from '@/router'
import { useUserService } from '@/services/user.service'
import { useAppService } from '@/services/app.service'
import { useAuthService } from '@/services/auth.service'
import { useAuthStore } from '@/stores/auth.store'
import { useSubscriptionService } from '@/services/subscription.service'
import { PermissionId } from '@/types/auth.types'

import { H3, H5, Caption } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import Badge from '@/components/ui/badge/Badge.vue'
import { Card } from '@/components/ui/card'
import Avatar from '@/components/ui/avatar/Avatar.vue'
import AvatarImage from '@/components/ui/avatar/AvatarImage.vue'
import { Code } from '@/components/ui/code'
import { Separator } from '@/components/ui/separator'
import {
  ChevronLeftIcon,
  ExternalLinkIcon,
  Trash2Icon,
  PencilIcon,
  EyeIcon,
} from 'lucide-vue-next'

dayjs.extend(localizedFormat)

const route = useRoute()
const router = useRouter()
const appService = useAppService()
const authService = useAuthService()
const authStore = useAuthStore()
const userService = useUserService()
const subscriptionService = useSubscriptionService()
const userId = route.params.id as string

const user = ref<any>(null)
const loading = ref(true)

const isCurrentUser = computed(() => authStore.me?.id === userId)
const isDev = import.meta.env.DEV

async function loadUser() {
  loading.value = true
  try {
    user.value = await userService.getUser(userId)
  } finally {
    loading.value = false
  }
}

async function deleteUser() {
  if (!user.value) return
  const confirmed = await appService.confirm({
    title: `Delete ${user.value.firstName} ${user.value.lastName}?`,
    description:
      'This will permanently remove the user and invalidate all their sessions. This cannot be undone.',
    destructive: true,
    continueText: 'Delete',
  })
  if (!confirmed) return

  await userService.deleteUser(userId)
  appService.toast.success('User deleted')
  router.push({ name: AppRoute.USERS })
}

async function impersonate() {
  if (!user.value) return
  const confirmed = await appService.confirm({
    title: `Impersonate ${user.value.firstName} ${user.value.lastName}?`,
    description:
      'You will be logged in as this user. A banner will appear at the bottom of the screen to return to your admin session.',
  })
  if (!confirmed) return

  await authService.impersonateUser(userId)
  router.push({ name: AppRoute.MAP })
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(amount / 100)
}

onMounted(loadUser)
</script>

<template>
  <div v-if="loading" class="flex items-center justify-center py-12">
    <Caption class="text-muted-foreground">Loading...</Caption>
  </div>

  <div v-else-if="!user" class="flex items-center justify-center py-12">
    <Caption class="text-muted-foreground">User not found</Caption>
  </div>

  <div v-else class="flex flex-col gap-6">
    <!-- Header -->
    <div class="flex items-start gap-4">
      <Button
        variant="ghost"
        size="icon"
        class="mt-1 shrink-0"
        @click="router.push({ name: AppRoute.USERS })"
      >
        <ChevronLeftIcon class="size-5" />
      </Button>
      <div class="flex items-center gap-4 flex-1 min-w-0">
        <Avatar class="size-14 shrink-0">
          <AvatarImage :src="user.picture || ''" />
        </Avatar>
        <div class="flex-1 min-w-0">
          <H3 class="truncate">
            {{ user.firstName }} {{ user.lastName }}
          </H3>
          <Caption class="text-muted-foreground">{{ user.email }}</Caption>
          <Caption v-if="user.alias" class="text-muted-foreground">
            @{{ user.alias }}
          </Caption>
        </div>
        <div class="flex gap-2 shrink-0">
          <Button
            v-if="authService.hasPermission(PermissionId.USERS_UPDATE)"
            variant="outline"
            size="sm"
            :icon="PencilIcon"
            @click="router.push({ name: AppRoute.USER_DETAIL, params: { id: userId } })"
          >
            Edit
          </Button>
          <Button
            v-if="isDev && !isCurrentUser"
            variant="outline"
            size="sm"
            :icon="EyeIcon"
            @click="impersonate"
          >
            Impersonate
          </Button>
          <Button
            v-if="
              authService.hasPermission(PermissionId.USERS_DELETE) &&
              !isCurrentUser
            "
            variant="destructive-outline"
            size="sm"
            :icon="Trash2Icon"
            @click="deleteUser"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-4 ml-12">
      <!-- Info -->
      <Card class="p-4">
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <Caption class="text-muted-foreground">ID</Caption>
            <Code>{{ user.id }}</Code>
          </div>
          <div>
            <Caption class="text-muted-foreground">Created</Caption>
            <p>{{ user.createdAt ? dayjs(user.createdAt).format('LL') : '—' }}</p>
          </div>
          <div>
            <Caption class="text-muted-foreground">Sessions</Caption>
            <p>{{ user.sessionCount }}</p>
          </div>
        </div>
      </Card>

      <!-- Roles -->
      <div>
        <H5 class="mb-2">Roles</H5>
        <div class="flex flex-wrap gap-2">
          <Badge
            v-for="role in user.roles"
            :key="role.id"
            variant="outline"
          >
            {{ role.name }}
          </Badge>
          <Badge v-if="user.roles?.length === 0" variant="secondary">
            No roles
          </Badge>
        </div>
      </div>

      <!-- Permissions -->
      <div>
        <H5 class="mb-2">Effective permissions</H5>
        <div class="flex flex-wrap gap-1.5">
          <Code
            v-for="perm in user.permissions"
            :key="perm.id"
            class="text-xs"
          >
            {{ perm.id }}
          </Code>
          <Caption
            v-if="user.permissions?.length === 0"
            class="text-muted-foreground"
          >
            No permissions
          </Caption>
        </div>
      </div>

      <!-- Subscription (billing enabled only) -->
      <template v-if="subscriptionService.billingEnabled.value && user.billing">
        <Separator />
        <div>
          <H5 class="mb-3">Subscription</H5>
          <Card
            v-if="user.billing.subscription"
            class="p-4"
          >
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <Badge>{{ user.billing.subscription.productName }}</Badge>
                <Badge
                  :variant="
                    user.billing.subscription.status === 'active'
                      ? 'default'
                      : 'secondary'
                  "
                >
                  {{ user.billing.subscription.status }}
                </Badge>
              </div>
              <span class="text-sm font-medium">
                {{
                  formatCurrency(
                    user.billing.subscription.amount,
                    user.billing.subscription.currency,
                  )
                }}/{{ user.billing.subscription.interval }}
              </span>
            </div>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div v-if="user.billing.subscription.startedAt">
                <Caption class="text-muted-foreground">Started</Caption>
                <p>
                  {{
                    dayjs(user.billing.subscription.startedAt).format('LL')
                  }}
                </p>
              </div>
              <div v-if="user.billing.subscription.currentPeriodEnd">
                <Caption class="text-muted-foreground">Current period ends</Caption>
                <p>
                  {{
                    dayjs(
                      user.billing.subscription.currentPeriodEnd,
                    ).format('LL')
                  }}
                </p>
              </div>
            </div>
            <div
              v-if="user.billing.subscription.cancelAtPeriodEnd"
              class="mt-3 text-sm text-amber-600 dark:text-amber-400"
            >
              Cancels at end of current period
            </div>
          </Card>
          <Caption v-else class="text-muted-foreground">
            No active subscription
          </Caption>
        </div>

        <!-- Order history -->
        <div v-if="user.billing.orders?.length > 0">
          <H5 class="mb-3">Order history</H5>
          <Card class="p-0 overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b text-left text-muted-foreground">
                  <th class="px-4 py-2 font-medium">Date</th>
                  <th class="px-4 py-2 font-medium">Reason</th>
                  <th class="px-4 py-2 font-medium text-right">Amount</th>
                  <th class="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="order in user.billing.orders"
                  :key="order.id"
                  class="border-b last:border-0"
                >
                  <td class="px-4 py-2">
                    {{ order.createdAt ? dayjs(order.createdAt).format('ll') : '—' }}
                  </td>
                  <td class="px-4 py-2">
                    {{ order.billingReason ?? '—' }}
                  </td>
                  <td class="px-4 py-2 text-right">
                    {{ formatCurrency(order.amount, order.currency) }}
                  </td>
                  <td class="px-4 py-2">
                    <Badge variant="outline" class="text-xs">
                      {{ order.status }}
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>

        <!-- Portal link -->
        <div v-if="user.billing.portalUrl">
          <Button
            variant="outline"
            size="sm"
            as="a"
            :href="user.billing.portalUrl"
            target="_blank"
          >
            <ExternalLinkIcon class="size-4 mr-2" />
            Open customer portal
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>
