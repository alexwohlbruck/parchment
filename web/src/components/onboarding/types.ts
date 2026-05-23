import type { InjectionKey } from 'vue'

export type StepValidateFn = () => Promise<boolean> | boolean

export const validateKey: InjectionKey<{
  register: (fn: StepValidateFn) => void
  setCanContinue: (value: boolean) => void
}> = Symbol('onboarding-validate')
