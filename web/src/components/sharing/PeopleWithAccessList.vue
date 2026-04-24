<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { XIcon } from 'lucide-vue-next'
import type { ShareRole } from '@/types/library.types'
import type { OutgoingShare } from '@/services/sharing.service'

/**
 * One-row representation used by the dialog. Keeps the list component
 * decoupled from the raw share + owner entity shapes — the parent flattens
 * everything into this interface.
 */
export interface AccessRow {
  /** Unique per-row key; share.id for shares, 'owner' for the owner row. */
  key: string
  handle: string
  /** Owner rows render with no role dropdown and no remove button. */
  isOwner: boolean
  role: ShareRole | 'owner'
  /** Original share id, only present for non-owner rows. */
  shareId?: string
}

const props = defineProps<{
  rows: AccessRow[]
  /** Disable role edits + remove actions (used while mutations are in flight). */
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:role', row: AccessRow, newRole: ShareRole): void
  (e: 'remove', row: AccessRow): void
}>()

const { t } = useI18n()

function initials(handle: string): string {
  return handle.split('@')[0]?.slice(0, 2).toUpperCase() ?? '?'
}

function displayName(handle: string): string {
  return handle.split('@')[0] ?? handle
}

const roleOptions = computed(() => [
  { value: 'viewer' as const, label: t('sharing.role.viewer') },
  { value: 'editor' as const, label: t('sharing.role.editor') },
])
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="row in rows"
      :key="row.key"
      class="flex items-center gap-3 py-2"
    >
      <Avatar class="size-9">
        <AvatarFallback>{{ initials(row.handle) }}</AvatarFallback>
      </Avatar>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">{{ displayName(row.handle) }}</p>
        <p class="text-xs text-muted-foreground truncate">{{ row.handle }}</p>
      </div>
      <span
        v-if="row.isOwner"
        class="text-sm text-muted-foreground px-2"
      >
        {{ t('sharing.role.owner') }}
      </span>
      <template v-else>
        <Select
          :model-value="row.role"
          :disabled="disabled"
          @update:model-value="
            (v: unknown) => {
              if (v === 'viewer' || v === 'editor') {
                emit('update:role', row, v)
              }
            }
          "
        >
          <SelectTrigger class="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="opt in roleOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          class="size-8"
          :disabled="disabled"
          @click="emit('remove', row)"
        >
          <XIcon class="size-4" />
        </Button>
      </template>
    </div>
  </div>
</template>
