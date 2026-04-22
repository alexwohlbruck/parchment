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
        // Tinted-bg pattern:
        //   light mode → -50 background + -800 foreground
        //   dark mode  → -950/50 background + -200 foreground
        // Inverting the shade ladder plus dropping bg opacity to 50%
        // keeps the alert readable on a dark canvas without the
        // foreground text punching through too loud. Border opacity
        // bumps from 20 → 40 in dark for the same reason.
        destructive:
          'text-destructive-800 bg-destructive-50 border-destructive/20 [&>svg]:text-current *:data-[slot=alert-description]:text-destructive-800/90 dark:text-destructive-200 dark:bg-destructive-950/50 dark:border-destructive/40 dark:*:data-[slot=alert-description]:text-destructive-200/90',
        success:
          'text-success-800 bg-success-50 border-success/20 [&>svg]:text-current *:data-[slot=alert-description]:text-success-800/90 dark:text-success-200 dark:bg-success-950/50 dark:border-success/40 dark:*:data-[slot=alert-description]:text-success-200/90',
        warning:
          'text-warning-800 bg-warning-50 border-warning/20 [&>svg]:text-current *:data-[slot=alert-description]:text-warning-800/90 dark:text-warning-200 dark:bg-warning-950/50 dark:border-warning/40 dark:*:data-[slot=alert-description]:text-warning-200/90',
        info: 'text-info-800 bg-info-50 border-info/20 [&>svg]:text-current *:data-[slot=alert-description]:text-info-800/90 dark:text-info-200 dark:bg-info-950/50 dark:border-info/40 dark:*:data-[slot=alert-description]:text-info-200/90',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type AlertVariants = VariantProps<typeof alertVariants>
