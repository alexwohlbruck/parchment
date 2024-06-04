import { ZodObject } from 'zod'

export enum DialogType {
  Confirm,
  Prompt,
  AutoForm,
  Template,
}

export interface BaseDialogOptions {
  title: string
  description?: string
  continueText?: string
  cancelText?: string
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
}

export interface TemplateDialogOptions extends BaseDialogOptions {}

export type DialogOptions =
  | ConfirmDialogOptions
  | PromptDialogOptions
  | AutoFormDialogOptions
  | TemplateDialogOptions
