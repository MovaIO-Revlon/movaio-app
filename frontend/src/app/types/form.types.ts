import { WidgetConfig, WidgetKeys } from './widget.types';

export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'multi-checkbox'
  | 'textarea'
  | 'color'
  | 'color-map'
  | 'table';

export interface BaseField {
  name: WidgetKeys;
  type: FieldType;
  label?: string;
  column?: number;
  defaultValue?: unknown;
  required?: boolean;
  display?: boolean | ((value: Partial<WidgetConfig>) => boolean);
  isDataSection?: boolean;
  helpText?: string;
}

export interface TextField extends BaseField {
  type: 'text';
  placeholder?: string;
}

export interface NumberField extends BaseField {
  type: 'number';
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface SelectField<T = string> extends BaseField {
  type: 'select';
  optionKey: string;
}

export interface CheckboxField extends BaseField {
  type: 'checkbox';
}

export interface RadioField<T = string> extends BaseField {
  type: 'radio';
  optionKey: string;
}

export interface MultiCheckboxField<T = string> extends BaseField {
  type: 'multi-checkbox';
  optionKey: string;
}

export interface TextareaField extends BaseField {
  type: 'textarea';
  placeholder?: string;
  variablesKey?: string;
  rows?: number;
}

export interface ColorField extends BaseField {
  type: 'color';
}

export interface ColorMapField extends BaseField {
  type: 'color-map';
  mapKey: string;
}

export interface TableField extends BaseField {
  type: 'table';
  variablesKey: string;
}

export type FormField =
  | TextField
  | NumberField
  | SelectField
  | CheckboxField
  | RadioField
  | MultiCheckboxField
  | TextareaField
  | ColorField
  | ColorMapField
  | TableField;

export interface FormSection {
  title: string;
  fields: FormField[];
  columns?: number;
}
