import type { InjectionKey, Ref } from 'vue'

export type StepValidateFn = () => Promise<boolean> | boolean

export const validateKey: InjectionKey<{
  register: (fn: StepValidateFn) => void
  setCanContinue: (value: boolean) => void
}> = Symbol('onboarding-validate')

export const stepIndexKey: InjectionKey<Ref<number>> = Symbol('onboarding-step-index')
