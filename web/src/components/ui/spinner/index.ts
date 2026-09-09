import { cva } from 'class-variance-authority'

export { default as Spinner } from './Spinner.vue'

// The size classes come from the variants below. An earlier base string here
// was `'w-${size} h-${size} …'` in single quotes, so it emitted those two
// tokens literally and they matched nothing.
export const spinnerVariants = cva('animate-spin', {
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
