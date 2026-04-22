import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Alert } from './Alert.vue'
export { default as AlertDescription } from './AlertDescription.vue'
export { default as AlertTitle } from './AlertTitle.vue'

export const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        // Tinted-bg pattern: light-50 background + dark-800 foreground.
        // Feels softer than the old card-bg + saturated-text combo while
        // still reading as the status color at a glance. Shades come
        // from the color-mix ladder in style.css.
        destructive:
          'text-destructive-800 bg-destructive-50 border-destructive/20 dark:border-destructive/30 [&>svg]:text-current *:data-[slot=alert-description]:text-destructive-800/90',
        success:
          'text-success-800 bg-success-50 border-success/20 dark:border-success/30 [&>svg]:text-current *:data-[slot=alert-description]:text-success-800/90',
        warning:
          'text-warning-800 bg-warning-50 border-warning/20 dark:border-warning/30 [&>svg]:text-current *:data-[slot=alert-description]:text-warning-800/90',
        info: 'text-info-800 bg-info-50 border-info/20 dark:border-info/30 [&>svg]:text-current *:data-[slot=alert-description]:text-info-800/90',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type AlertVariants = VariantProps<typeof alertVariants>
