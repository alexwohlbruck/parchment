<script setup lang="ts">
import { computed, ref } from 'vue'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from 'vue-i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { MoreVerticalIcon, Pencil, Trash } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { AppRoute } from '@/router'
import type { Collection } from '@/types/library.types'
import { getThemeColorClasses, type ThemeColor } from '@/lib/utils'
import CollectionDialog from '@/components/library/CollectionDialog.vue'
import { useCollectionsService } from '@/services/library/collections.service'
import { ItemIcon } from '@/components/ui/item-icon'

const props = defineProps<{
  collection: Collection
}>()

const router = useRouter()
const { t } = useI18n()
const collectionsService = useCollectionsService()

const showEditDialog = ref(false)

const colorClasses = computed(() => {
  return getThemeColorClasses(props.collection.iconColor as ThemeColor)
})

function goToCollection() {
  router.push({
    name: AppRoute.COLLECTION,
    params: { id: props.collection.id },
  })
}

function editCollection() {
  showEditDialog.value = true
}

function deleteCollection() {
  if (confirm(t('library.confirmDelete', { name: props.collection.name }))) {
    collectionsService.deleteCollection(props.collection.id)
  }
}
</script>

<template>
  <Card
    class="overflow-hidden hover:bg-secondary/40 transition-colors cursor-pointer"
    @click="goToCollection"
  >
    <CardContent class="p-2 flex items-center gap-3">
      <!-- Icon -->
      <ItemIcon
        :icon="collection.icon"
        :color="collection.iconColor"
        size="md"
      />

      <!-- Content -->
      <div class="flex-grow min-w-0">
        <div class="flex items-center justify-between">
          <div class="flex flex-col justify-center">
            <h3 class="font-semibold text-sm">{{ collection.name }}</h3>

            <!-- Display collection description if available -->
            <div
              v-if="collection.description"
              class="text-xs text-muted-foreground line-clamp-2"
            >
              {{ collection.description }}
            </div>
          </div>

          <!-- Actions dropdown -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child @click.stop>
              <Button variant="ghost" size="icon" class="size-8">
                <MoreVerticalIcon class="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click.stop="editCollection">
                <Pencil class="size-4 mr-2" />
                {{ t('general.edit') }}
              </DropdownMenuItem>
              <DropdownMenuItem
                @click.stop="deleteCollection"
                class="text-destructive"
              >
                <Trash class="size-4 mr-2" />
                {{ t('general.delete') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </CardContent>
  </Card>

  <!-- Edit Collection Dialog -->
  <CollectionDialog
    v-if="showEditDialog"
    :collection="collection"
    @update:open="showEditDialog = $event"
  />
</template>
