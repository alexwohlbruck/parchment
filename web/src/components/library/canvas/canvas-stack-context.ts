/**
 * What a row in the canvas stack needs from the editor that owns it.
 *
 * The stack is a tree now — a group can hold a group — so the list component
 * renders itself at every depth. Passing the editor's handlers down as props
 * would mean every level redeclaring and forwarding all of them, so they are
 * provided once at the top and injected wherever a row happens to sit.
 */

import type { InjectionKey } from 'vue'
import type {
  CanvasAnnotation,
  CanvasGroup,
  CanvasLayer,
} from '@/types/canvas.types'
import type { StackAnnotation, StackChange, StackLayer } from '@/lib/canvas-stack'

/** Everything `CanvasLayerRow` binds to, as the editor hands it over. */
export interface LayerRowProps {
  layer: CanvasLayer
  selected: boolean
  onSelect: () => void
  onToggle: (visible: boolean) => void
  onEdit: () => void
  onRename: (name: string) => void
  onRemove: () => void
}

/** The same for `CanvasAnnotationRow`. */
export interface AnnotationRowProps {
  annotation: CanvasAnnotation
  expanded: boolean
  onToggleExpanded: () => void
  onUpdate: (patch: Partial<CanvasAnnotation>) => void
  onRemove: () => void
  onZoomTo: () => void
}

export interface CanvasStackContext {
  layerProps(item: StackLayer): LayerRowProps
  annotationProps(item: StackAnnotation): AnnotationRowProps
  /** The row the panel is pointed at, group rows included. */
  isSelected(id: string): boolean
  /** Clicking the selected group again hands new work back to the canvas. */
  toggleSelected(id: string): void
  /**
   * Whether new marks are filed in this group — true for the selected group
   * and for the group holding whatever else is selected.
   */
  isDestination(id: string): boolean
  patchGroup(id: string, patch: Partial<CanvasGroup>): void
  removeGroup(id: string): void
  /** Sortable's report of a drop, with the list it landed in. */
  onChange(change: StackChange, groupId: string | null): void
}

export const CANVAS_STACK: InjectionKey<CanvasStackContext> =
  Symbol('canvas-stack')
