import { cva } from 'class-variance-authority'

export { default as Toggle } from './Toggle.vue'

export const toggleVariants = cva(
  'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-all duration-150 hover:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground',
  {
    variants: {
      variant: {
        default:
          'border border-white/15 bg-primary text-primary-foreground depth-raised hover:bg-primary/90 hover:shadow-[0_2px_6px_rgba(0,0,0,0.15)] hover:inset-shadow-[0_1px_0_rgba(255,255,255,0.2)] active:bg-primary/80 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.2)] active:translate-y-px',
        destructive:
          'border border-white/15 bg-coral-600 text-white depth-raised hover:bg-coral-700 hover:shadow-[0_2px_6px_rgba(0,0,0,0.15)] hover:inset-shadow-[0_1px_0_rgba(255,255,255,0.2)] active:bg-coral-800 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.2)] active:translate-y-px',
        outline:
          'border border-input bg-background depth hover:bg-muted hover:text-accent-foreground hover:shadow-[0_2px_6px_rgba(0,0,0,0.1)] active:bg-muted/90 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.06)] active:translate-y-px',
        secondary:
          'border border-input bg-secondary text-secondary-foreground depth hover:bg-secondary/80 hover:shadow-[0_2px_6px_rgba(0,0,0,0.1)] active:bg-secondary/90 active:shadow-none active:inset-shadow-[0_2px_4px_rgba(0,0,0,0.06)] active:translate-y-px',
        ghost:
          'hover:bg-accent hover:text-accent-foreground active:bg-accent/90 active:translate-y-px',
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
