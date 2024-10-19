import { cva } from 'class-variance-authority'

export { default as Spinner } from './Spinner.vue'

export const spinnerVariants = cva('w-${size} h-${size} animate-spin', {
  variants: {
    size: {
      default: 'size-8',
      sm: 'size-6',
      lg: 'size-10',
      icon: 'size-4',
    },
  },
  defaultVariants: {
    size: 'default',
  },
})
