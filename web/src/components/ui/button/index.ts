import { cva } from 'class-variance-authority'

export { default as Button } from './Button.vue'

export const buttonVariants = cva(
  'cursor-pointer inline-flex items-center justify-center rounded-md whitespace-nowrap text-sm font-medium ring-offset-background transition-all duration-150 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border border-white/15 bg-primary text-primary-foreground depth-raised hover:bg-primary/90 hover:shadow-[0_2px_6px_rgba(0,0,0,0.15)] hover:inset-shadow-[0_1px_0_rgba(255,255,255,0.2)] active:bg-primary/80 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.2)] active:translate-y-px',
        destructive:
          'border border-white/15 bg-coral-600 text-white depth-raised hover:bg-coral-700 hover:shadow-[0_2px_6px_rgba(0,0,0,0.15)] hover:inset-shadow-[0_1px_0_rgba(255,255,255,0.2)] active:bg-coral-800 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.2)] active:translate-y-px',
        'destructive-outline':
          'border border-input bg-background text-coral-600 dark:text-coral-500 depth hover:bg-coral-50/50 dark:hover:bg-coral-950 hover:text-coral-700 dark:hover:text-coral-400 hover:shadow-[0_2px_6px_rgba(0,0,0,0.1)] active:bg-coral-100/50 dark:active:bg-coral-900 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.06)] active:translate-y-px',
        'destructive-ghost':
          'text-coral-600 dark:text-coral-500 hover:bg-coral-50/50 dark:hover:bg-coral-950 hover:text-coral-700 dark:hover:text-coral-400 active:bg-coral-100/50 dark:active:bg-coral-900 active:translate-y-px',
        info: 'border border-white/15 bg-cobalt-600 text-white depth-raised hover:bg-cobalt-700 hover:shadow-[0_2px_6px_rgba(0,0,0,0.15)] hover:inset-shadow-[0_1px_0_rgba(255,255,255,0.2)] active:bg-cobalt-800 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.2)] active:translate-y-px',
        success:
          'border border-white/15 bg-forest-600 text-white depth-raised hover:bg-forest-700 hover:shadow-[0_2px_6px_rgba(0,0,0,0.15)] hover:inset-shadow-[0_1px_0_rgba(255,255,255,0.2)] active:bg-forest-800 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.2)] active:translate-y-px',
        warning:
          'border border-white/15 bg-amber-600 text-white depth-raised hover:bg-amber-700 hover:shadow-[0_2px_6px_rgba(0,0,0,0.15)] hover:inset-shadow-[0_1px_0_rgba(255,255,255,0.2)] active:bg-amber-800 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.2)] active:translate-y-px',
        outline:
          'border border-input bg-background depth hover:bg-muted hover:text-accent-foreground hover:shadow-[0_2px_6px_rgba(0,0,0,0.1)] active:bg-muted/90 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.06)] active:translate-y-px',
        secondary:
          'border border-input bg-secondary text-secondary-foreground depth hover:bg-secondary/80 hover:shadow-[0_2px_6px_rgba(0,0,0,0.1)] active:bg-secondary/90 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.06)] active:translate-y-px',
        ghost:
          'hover:bg-accent hover:text-accent-foreground active:bg-accent/90 active:translate-y-px',
        link: 'text-primary underline-offset-4 hover:underline active:text-primary/90 active:translate-y-px',
      },
      size: {
        default: 'h-10 px-4 py-2',
        xs: 'h-8 px-2 py-1',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        xl: 'h-20 rounded-md px-10',
        icon: 'size-10',
        'icon-xs': 'size-6',
        'icon-sm': 'size-8',
        'icon-md': 'size-9',
        'icon-lg': 'size-12',
        'icon-xl': 'size-16',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)
