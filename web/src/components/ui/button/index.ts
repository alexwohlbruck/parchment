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
          'border border-coral-600 dark:border-coral-500 bg-coral-600 text-white hover:bg-coral-700 dark:hover:bg-coral-700 active:bg-coral-800 dark:active:bg-coral-800',
        'destructive-outline':
          'border border-input bg-background text-coral-600 dark:text-coral-500 hover:bg-coral-100 dark:hover:bg-coral-950 hover:text-coral-700 dark:hover:text-coral-400 active:bg-coral-200 dark:active:bg-coral-900',
        'destructive-ghost':
          'text-coral-600 dark:text-coral-500 hover:bg-coral-100 dark:hover:bg-coral-950 hover:text-coral-700 dark:hover:text-coral-400 active:bg-coral-200 dark:active:bg-coral-900',
        info:
          'border border-cobalt-600 dark:border-cobalt-500 bg-cobalt-600 text-white hover:bg-cobalt-700 dark:hover:bg-cobalt-700 active:bg-cobalt-800 dark:active:bg-cobalt-800',
        success:
          'border border-forest-600 dark:border-forest-500 bg-forest-600 text-white hover:bg-forest-700 dark:hover:bg-forest-700 active:bg-forest-800 dark:active:bg-forest-800',
        warning:
          'border border-amber-600 dark:border-amber-500 bg-amber-600 text-white hover:bg-amber-700 dark:hover:bg-amber-700 active:bg-amber-800 dark:active:bg-amber-800',
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
