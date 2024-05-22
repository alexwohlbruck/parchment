export enum DialogType {
  Confirm,
  Prompt,
  AutoForm,
  Template,
}

export interface BaseDialogOptions {
  title: string
  description?: string
}

export interface ConfirmDialogOptions extends BaseDialogOptions {
  continueText?: string
  cancelText?: string
  destructive?: boolean
}

export interface PromptDialogOptions extends BaseDialogOptions {}

export interface AutoFormDialogOptions extends BaseDialogOptions {}

export interface TemplateDialogOptions extends BaseDialogOptions {}

export type DialogOptions =
  | ConfirmDialogOptions
  | PromptDialogOptions
  | AutoFormDialogOptions
  | TemplateDialogOptions
