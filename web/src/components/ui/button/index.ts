import { cva } from 'class-variance-authority'

export { default as Button } from './Button.vue'

export const buttonVariants = cva(
  'cursor-pointer inline-flex items-center justify-center rounded-md whitespace-nowrap text-sm font-medium ring-offset-background transition-colors transition-shadow focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
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
