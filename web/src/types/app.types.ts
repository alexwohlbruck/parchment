import { Globe2Icon } from 'lucide-vue-next'
import type { Component, VNode } from 'vue'
import { ZodObject } from 'zod'

export type Icon = typeof Globe2Icon

export enum DialogType {
  Component,
  Confirm,
  Prompt,
  AutoForm,
  Template,
  Drawer,
}

export type AppEvents = {
  'palette:open': void
  'hotkeys:open': void
  'location-config:changed': { friendHandle: string; enabled: boolean }
}

export interface BaseDialogOptions {
  title?: string
  description?: string
  continueText?: string
  cancelText?: string
}

export interface ComponentDialogOptions extends BaseDialogOptions {
  component: Component
  props?: Record<string, any>
  destructive?: boolean
  onContinue?: (payload?: any) => Promise<any>
  footerPrepend?: () => VNode | VNode[]
}

export interface ConfirmDialogOptions extends BaseDialogOptions {
  destructive?: boolean
  onContinue?: (payload?: any) => Promise<any>
}

export interface PromptDialogOptions extends BaseDialogOptions {
  label?: string
  inputProps?: object
  continueText?: string
  cancelText?: string
  defaultValue?: string
  onContinue?: (payload?: any) => Promise<any>
}

export interface AutoFormDialogOptions extends BaseDialogOptions {
  schema: ZodObject<any>
  initialValues?: Record<string, any>
  fieldConfig?: Record<string, any>
  continueText?: string
  cancelText?: string
  defaultValue?: string
  onContinue?: (payload?: any) => Promise<any>
}

export interface TemplateDialogOptions extends BaseDialogOptions {
  template: string
  onContinue?: (payload?: any) => Promise<any>
}

export interface DrawerOptions {
  component: Component
  props?: Record<string, any>
  peekHeight?: number
  dismissable?: boolean
  onClose?: () => void
  onSnapPointChange?: (snapPoint: string) => void
  onContinue?: (payload?: any) => Promise<any>
}

export type DialogOptions =
  | ComponentDialogOptions
  | ConfirmDialogOptions
  | PromptDialogOptions
  | AutoFormDialogOptions
  | TemplateDialogOptions
  | DrawerOptions
