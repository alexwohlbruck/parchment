import { cva } from 'class-variance-authority'

export { default as Button } from './Button.vue'

export const buttonVariants = cva(
  'cursor-pointer inline-flex items-center justify-center rounded-md whitespace-nowrap text-sm font-medium ring-offset-background transition-colors transition-shadow focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border border-primary-400 dark:border-primary-600 bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95',
        destructive:
          'border border-white/30 bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/95',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground active:bg-accent/90',
        secondary:
          'border border-input bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/90',
        ghost:
          'hover:bg-accent hover:text-accent-foreground active:bg-accent/90',
        link: 'text-primary underline-offset-4 hover:underline active:text-primary/90',
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
