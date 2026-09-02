/**
 * The settings the tool options bar shows, one set per tool.
 *
 * Kept apart from the marks themselves: this is what the *next* mark will
 * look like, so changing it never reaches back and restyles something you
 * already drew. The traffic runs the other way — selecting a mark puts its
 * style on the bar, which is how "another one like that" is a click.
 *
 * Session state, not part of the canvas: it describes how you are working
 * right now, and a canvas opened on another device shouldn't inherit it.
 */

import { ref } from 'vue'
import type { AnnotationTool, CanvasAnnotation } from '@/types/canvas.types'
import {
  adoptStyle,
  type DrawStyle,
  type DrawStyles,
} from '@/lib/canvas-draw-style'

export function useCanvasDrawStyle() {
  const styles = ref<DrawStyles>({})

  /** What this tool is currently set to. Empty means every default. */
  function forTool(tool: AnnotationTool | null): DrawStyle {
    return (tool && styles.value[tool]) || {}
  }

  /** One setting changed on the bar. */
  function set(tool: AnnotationTool, patch: DrawStyle) {
    styles.value = {
      ...styles.value,
      [tool]: { ...forTool(tool), ...patch },
    }
  }

  /** Take a mark's own style onto the bar, for the tool that drew it. */
  function adopt(annotation: CanvasAnnotation) {
    styles.value = adoptStyle(styles.value, annotation)
  }

  return { styles, forTool, set, adopt }
}
