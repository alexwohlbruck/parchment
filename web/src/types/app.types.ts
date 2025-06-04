import { Globe2Icon } from 'lucide-vue-next'
import { Component } from 'vue'
import { ZodObject } from 'zod'

export type Icon = typeof Globe2Icon

export enum DialogType {
  Component,
  Confirm,
  Prompt,
  AutoForm,
  Template,
}

export interface BaseDialogOptions {
  title?: string
  description?: string
  continueText?: string
  cancelText?: string
}

export interface ComponentDialogOptions extends BaseDialogOptions {
  component: Component
  props?: any
  destructive?: boolean
}

export interface ConfirmDialogOptions extends BaseDialogOptions {
  destructive?: boolean
}

export interface PromptDialogOptions extends BaseDialogOptions {
  label?: string
  inputProps?: object
}

export interface AutoFormDialogOptions extends BaseDialogOptions {
  schema: ZodObject<any>
  initialValues?: Record<string, any>
  fieldConfig?: Record<string, any>
}

export interface TemplateDialogOptions extends BaseDialogOptions {}

export type DialogOptions =
  | ComponentDialogOptions
  | ConfirmDialogOptions
  | PromptDialogOptions
  | AutoFormDialogOptions
  | TemplateDialogOptions
