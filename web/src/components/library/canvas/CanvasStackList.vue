<script setup lang="ts">
/**
 * The canvas stack at one level, and inside every group, itself.
 *
 * One component for the top level and for a group's contents, so a row is
 * the same row wherever it sits and a drag can cross between them — every
 * list shares the `canvas-stack` sortable group, which is what lets
 * something be dragged out of a folder and into another one.
 */
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import draggable from 'vuedraggable'
import CanvasGroupRow from './CanvasGroupRow.vue'
import CanvasLayerRow from './CanvasLayerRow.vue'
import CanvasAnnotationRow from './CanvasAnnotationRow.vue'
import { CANVAS_STACK } from './canvas-stack-context'
import type { StackEntry } from '@/lib/canvas-stack'

defineProps<{
  entries: StackEntry[]
  /** The group whose contents these are; null at the top level. */
  groupId?: string | null
}>()

const { t } = useI18n()

const stack = inject(CANVAS_STACK)
if (!stack) throw new Error('CanvasStackList needs a canvas stack context')
</script>

<template>
  <!-- An empty group has to be a target you can actually hit, so the list
       itself holds the height and the invitation sits behind it rather than
       below it — the whole panel takes a drop, not a 24px strip of it. -->
  <div class="relative">
    <p
      v-if="groupId && !entries.length"
      class="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none"
    >
      {{ t('canvases.groups.empty') }}
    </p>

    <draggable
      :model-value="entries"
      item-key="id"
      handle=".canvas-stack-handle"
      :group="{ name: 'canvas-stack' }"
      :animation="150"
      class="space-y-1.5"
      :class="groupId && !entries.length && 'min-h-12'"
      @change="change => stack!.onChange(change, groupId ?? null)"
    >
      <template #item="{ element }">
        <div>
          <CanvasGroupRow
            v-if="element.kind === 'group'"
            :group="element.group"
            :active="stack!.isActiveGroup(element.id)"
            @toggle="visible => stack!.patchGroup(element.id, { visible })"
            @collapse="collapsed => stack!.patchGroup(element.id, { collapsed })"
            @rename="name => stack!.patchGroup(element.id, { name })"
            @activate="
              active => stack!.setActiveGroup(active ? element.id : null)
            "
            @remove="stack!.removeGroup(element.id)"
          >
            <!-- Here is the recursion: a group's contents are a stack too. -->
            <CanvasStackList :entries="element.children" :group-id="element.id" />
          </CanvasGroupRow>

          <CanvasLayerRow
            v-else-if="element.kind === 'layer'"
            v-bind="stack!.layerProps(element)"
          />

          <CanvasAnnotationRow v-else v-bind="stack!.annotationProps(element)" />
        </div>
      </template>
    </draggable>
  </div>
</template>
