import { toast as sonner, type ExternalToast } from 'vue-sonner'
import { isOffline } from '@/lib/connectivity'
import { getNetworkErrorKind, isQuietNetworkError } from '@/lib/network-errors'

type Message = Parameters<typeof sonner>[0]
type ToastId = string | number
type ShowToast = (message: Message, options?: ExternalToast) => ToastId
export interface ErrorToastOptions extends ExternalToast {
  force?: boolean
  cause?: unknown
}

interface ErrorToast {
  id: ToastId
  description: ExternalToast['description']
}

// An API failure toasts once from the interceptor and again from the service
// that made the request; keying on the error makes the second replace the first.
const errorToasts = new WeakMap<object, ErrorToast>()
let errorSequence = 0

function suppressed(options?: ErrorToastOptions): boolean {
  if (options?.force) return false
  if (
    options?.cause !== undefined &&
    isQuietNetworkError(getNetworkErrorKind(options.cause))
  ) return true
  return isOffline.value
}

function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

function repeatFeedback(className: string) {
  if (typeof document === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const element = document.getElementsByClassName(className)[0] as HTMLElement | undefined
  if (!element || element.dataset.removed === 'true' || !element.animate) return
  element.getAnimations?.().filter(animation => animation.id === 'toast-repeat').forEach(animation => animation.cancel())
  // Individual scale leaves Sonner's positioning and swipe transforms intact.
  element.animate([{ scale: 1 }, { scale: 0.97 }, { scale: 1.01 }, { scale: 1 }], {
    duration: 240,
    easing: 'ease-out',
    id: 'toast-repeat',
  })
}

function show(
  method: ShowToast,
  type: string,
  message: Message,
  options: ExternalToast = {},
) {
  const canGroup = type !== 'loading' && typeof message === 'string' &&
    !options.action && !options.cancel &&
    (options.description === undefined || typeof options.description === 'string')
  const id = options.id ?? (canGroup
    ? `notification:${JSON.stringify([type, message, options.description])}`
    : undefined)
  if (id === undefined) return method(message, options)

  const className = `toast-repeat-${hash(String(id))}`
  repeatFeedback(className)
  return method(message, {
    action: undefined,
    cancel: undefined,
    description: undefined,
    onDismiss: undefined,
    onAutoClose: undefined,
    ...options,
    id,
    class: [options.class, className].filter(Boolean).join(' '),
  })
}

type AppToast = Omit<typeof sonner, 'error'> & typeof sonner & {
  error(message: Message, options?: ErrorToastOptions): ToastId | undefined
}

const wrapped = Object.assign(
  (message: Message, options?: ExternalToast) => show(sonner, 'message', message, options),
  sonner,
) as unknown as Record<string, unknown>

for (const type of ['success', 'info', 'warning', 'message', 'loading'] as const) {
  wrapped[type] = (message: Message, options?: ExternalToast) =>
    show(sonner[type], type, message, options)
}

wrapped.error = (message: Message, options?: ErrorToastOptions) => {
  if (suppressed(options)) return undefined
  const { force: _force, cause, ...rest } = options ?? {}
  if (cause !== null && typeof cause === 'object') {
    const previous = errorToasts.get(cause)
    rest.id = previous?.id ?? rest.id ?? `request-error:${++errorSequence}`
    rest.description ??= previous?.description
    errorToasts.set(cause, { id: rest.id, description: rest.description })
  }
  return show(sonner.error, 'error', message, rest)
}

export const toast = wrapped as unknown as AppToast
