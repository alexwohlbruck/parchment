<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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

/**
 * One-row representation used by the dialog. Keeps the list component
 * decoupled from the raw share + owner entity shapes — the parent flattens
 * everything into this interface.
 */
export interface AccessRow {
  /** Unique per-row key; share.id for shares, 'owner' for the owner row. */
  key: string
  /** Primary display name — "Alex Wohlbruck" when we have it, otherwise
   *  the local-part of the handle, otherwise the raw id as a last resort. */
  name: string
  /** Secondary line — the email for the owner, federation handle for
   *  friends, or the raw id if we have nothing better. */
  subtitle: string
  /** Optional avatar image URL. Falls back to initials when absent. */
  picture?: string | null
  /** Owner rows render with no role dropdown and no remove button. */
  isOwner: boolean
  role: ShareRole | 'owner'
  /** Original share id, only present for non-owner rows. */
  shareId?: string
  /** Federation handle (alias@server). Only set on non-owner rows; used
   *  by the parent to reissue the share when the role changes. */
  handle?: string
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

function initials(name: string): string {
  // Pull up to two initials from whatever we were given — the caller
  // already picked the best display name, so "Alex Wohlbruck" yields AW
  // and "alice@server" yields AL. Falls back to "?" for empty input.
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return trimmed.slice(0, 2).toUpperCase()
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
        <AvatarImage v-if="row.picture" :src="row.picture" />
        <AvatarFallback>{{ initials(row.name) }}</AvatarFallback>
      </Avatar>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">{{ row.name }}</p>
        <p class="text-xs text-muted-foreground truncate">{{ row.subtitle }}</p>
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
