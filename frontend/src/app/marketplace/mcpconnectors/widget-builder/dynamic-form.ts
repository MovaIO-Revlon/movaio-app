import {
  Component,
  computed,
  effect,
  input,
  model,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { FormField, FormSection } from '../../../types/form.types';
import {
  SelectOption,
  TableWidgetConfig,
  WidgetConfig,
  WidgetKeys,
} from '../../../types/widget.types';
import { FormSchemaService } from '../../../services/widget/form-schema.service';
import { DndDropEvent, DndModule } from 'ngx-drag-drop';
@Component({
  selector: 'app-dynamic-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, DndModule],
  template: `
    <form class="dynamic-form overflow-y-auto">
      <ng-content />
      @for (section of visibleSections(); track section.title) {
        <details class="form-section" [open]="!section.title">
          <summary
            class="section-title d-flex justify-content-between fw-semibold"
          >
            {{ section.title || '' }}
            @if (section.title) {
              <i class="fa-solid fa-chevron-down"></i>
            }
          </summary>
          <div
            class="fields-grid"
            [style.grid-template-columns]="
              'repeat(' + (section.columns || 1) + ', 1fr)'
            "
          >
            @for (field of section.fields; track field.name) {
              <div
                class="field-wrapper"
                [style.grid-column]="'span ' + (field.column || 1)"
              >
                @if (field.type !== 'checkbox') {
                  <label class="fw-semibold text-muted"
                    >{{ field.label }}
                    @if (field.required) {
                      <span class="text-danger">*</span>
                    }
                  </label>
                }

                @if (field.helpText) {
                  <small class="mb-1">{{ field.helpText }}</small>
                }

                @switch (field.type) {
                  @case ('text') {
                    <input
                      type="text"
                      class="form-control"
                      [value]="formData()[field.name]"
                      (input)="
                        updateField(
                          field.name,
                          $any($event.target)?.value || ''
                        )
                      "
                      [placeholder]="field.placeholder || ''"
                    />
                  }

                  @case ('number') {
                    <input
                      type="number"
                      class="form-control"
                      [value]="formData()[field.name]"
                      (change)="
                        updateField(
                          field.name,
                          +$any($event.target)?.value || 0
                        )
                      "
                      [placeholder]="field.placeholder || ''"
                      [min]="field.min || 1"
                      [max]="field.max || 500"
                      [step]="field.step || 1"
                    />
                  }

                  @case ('select') {
                    @let options = this.getOptions(field.optionKey);
                    <select
                      class="form-select"
                      [value]="formData()[field.name]"
                      [disabled]="!options?.length"
                      (change)="
                        updateField(
                          field.name,
                          $any($event.target)?.value || ''
                        )
                      "
                    >
                      <option value="">Select {{ field.label }}</option>
                      @for (option of options; track option.value) {
                        <option
                          [value]="option.value"
                          [selected]="formData()[field.name] === option.value"
                        >
                          {{ option.label }}
                        </option>
                      }
                    </select>
                  }

                  @case ('checkbox') {
                    <label class="checkbox-label">
                      <input
                        type="checkbox"
                        class="form-checkbox"
                        [checked]="formData()[field.name]"
                        (change)="
                          updateField(
                            field.name,
                            $any($event.target)?.checked ?? false
                          )
                        "
                      />
                      <span>{{ field.label }}</span>
                    </label>
                  }

                  @case ('radio') {
                    <div class="d-flex column-gap-4 row-gap-1 flex-wrap">
                      @for (
                        option of getOptions(field.optionKey);
                        track option.value
                      ) {
                        <label
                          class="radio-label d-flex gap-1 align-items-center"
                        >
                          <input
                            type="radio"
                            class="form-radio"
                            [value]="option.value"
                            [checked]="option.value === formData()[field.name]"
                            (change)="
                              updateField(field.name, option?.value || '')
                            "
                          />
                          <span>{{ option.label }}</span>
                        </label>
                      }
                    </div>
                  }

                  @case ('multi-checkbox') {
                    <div class="checkbox-group">
                      @for (
                        option of getOptions(field.optionKey);
                        track option.value
                      ) {
                        <label class="checkbox-label">
                          <input
                            type="checkbox"
                            class="form-checkbox"
                            [checked]="isChecked(field.name, option.value)"
                            (change)="toggleCheckbox(field.name, option.value)"
                          />
                          <span>{{ option.label }}</span>
                        </label>
                      }
                    </div>
                  }

                  @case ('textarea') {
                    <div class="textarea-wrapper">
                      <textarea
                        class="form-control"
                        [value]="formData()[field.name]"
                        (input)="
                          updateField(
                            field.name,
                            $any($event.target)?.value || ''
                          )
                        "
                        [placeholder]="field.placeholder || ''"
                        [rows]="field.rows || 3"
                      ></textarea>
                      @let variables =
                        field.variablesKey
                          ? getOptions(field.variablesKey)
                          : [];

                      @if (variables.length) {
                        <div class="variables-hint">
                          <strong>Available variables:</strong>
                          @for (variable of variables; track variable) {
                            <code class="variable-tag"
                              >{{ '{{' + variable + '}}' }}</code
                            >
                          }
                        </div>
                      }
                    </div>
                  }

                  @case ('color') {
                    <input
                      type="color"
                      class="form-color"
                      [value]="formData()[field.name]"
                      (input)="
                        updateField(
                          field.name,
                          $any($event.target)?.value || ''
                        )
                      "
                    />
                  }

                  @case ('color-map') {
                    <div class="d-flex flex-wrap gap-2">
                      @for (
                        item of getOptions(field.mapKey, 'keyValue') | keyvalue;
                        track $index
                      ) {
                        <div class="d-flex gap-1 align-items-center">
                          <span>{{ item.key }}: </span>
                          <input
                            type="color"
                            class="form-color"
                            [value]="
                              $any(formData()[field.name])?.[$any(item.key)] ||
                              ''
                            "
                            (input)="
                              updateMapField(
                                field.name,
                                item.key,
                                $any($event.target)?.value || ''
                              )
                            "
                          />
                        </div>
                      }
                    </div>
                  }

                  @case ('table') {
                    @let variables =
                      field.variablesKey ? getOptions(field.variablesKey) : [];

                    @if (variables.length) {
                      @let tableFields = getTableFields(field.name);

                      <table>
                        <colgroup>
                          <col style="width: 6%;" />
                          <col style="width: 44%;" />
                          <col style="width: 44%;" />
                          <col style="width: 6%;" />
                        </colgroup>
                        <thead>
                          <tr>
                            <th></th>
                            <th>Label</th>
                            <th>Value</th>
                            <th>
                              <button
                                class="btn btn-sm bg-white"
                                type="button"
                                title="Add Row"
                                (click)="addTableRow(field.name)"
                              >
                                <i
                                  class="fa-solid fa-circle-plus text-warning"
                                ></i>
                              </button>
                            </th>
                          </tr>
                        </thead>
                        <tbody
                          dndDropzone
                          (dndDrop)="onDrop($event, field.name)"
                        >
                          <tr
                            dndPlaceholderRef
                            class="dndPlaceholder border border-warning"
                            style="--bs-border-style: dashed"
                          ></tr>
                          @let lastClickIndex = lastClickedTableIndex();
                          @for (row of tableFields; track $index) {
                            <tr
                              (click)="lastClickedTableIndex.set($index)"
                              [dndDraggable]="$index"
                              dndEffectAllowed="move"
                            >
                              <td class="text-center align-top">
                                <div
                                  type="button"
                                  class="btn btn-sm text-muted bg-light-subtle"
                                  dndHandle
                                  style="cursor: grab;"
                                  title="Drag To Reorder"
                                >
                                  <i class="fa-solid fa-grip-vertical"></i>
                                </div>
                              </td>
                              <td class="align-top">
                                <input
                                  type="text"
                                  class="form-control form-control-sm"
                                  [value]="row.label"
                                  (input)="
                                    updateTableField(
                                      field.name,
                                      'label',
                                      $index,
                                      $any($event.target)?.value || ''
                                    )
                                  "
                                />
                              </td>
                              <td class="align-top">
                                <textarea
                                  class="form-control form-control-sm"
                                  [class]="
                                    lastClickIndex === $index
                                      ? 'border-warning'
                                      : ''
                                  "
                                  [value]="row.value"
                                  (input)="
                                    updateTableField(
                                      field.name,
                                      'value',
                                      $index,
                                      $any($event.target)?.value || ''
                                    )
                                  "
                                  rows="2"
                                ></textarea>
                              </td>
                              <td class="align-top">
                                <button
                                  class="btn btn-sm bg-white"
                                  title="Delete Row"
                                  type="button"
                                  (click)="removeTableRow(field.name, $index)"
                                >
                                  <i class="fa-solid fa-trash text-warning"></i>
                                </button>
                              </td>
                            </tr>
                          }
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colspan="4">
                              @if (variables.length) {
                                <div class="variables-hint">
                                  <strong>Available variables:</strong>
                                  @for (variable of variables; track variable) {
                                    <code
                                      class="variable-tag cursor-pointer"
                                      (click)="
                                        tableVariableClick(
                                          $any(variable),
                                          field.name,
                                          'value'
                                        )
                                      "
                                      >{{ '{{' + variable + '}}' }}</code
                                    >
                                  }
                                </div>
                              }
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    } @else {
                      <div class="text-muted text-center py-2">
                        Nothing to configure
                      </div>
                    }
                  }
                }
              </div>
            }
          </div>
        </details>
      }
    </form>
    @let err = errors();
    @if (err.length) {
      <div class="d-flex flex-column gap-1 fs-12 py-2">
        @for (item of err; track item) {
          <small class="text-danger">{{ item }}</small>
        }
      </div>
    }
  `,
  styles: `
    :host {
      overflow: auto;
      height: 100%;
      display: grid;
      grid-template-rows: 1fr auto;
    }
    .dynamic-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    small {
      font-size: 0.8rem;
      color: #858585;
    }

    .form-section {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .form-section i {
      transition: all 200ms ease-in-out;
    }

    .form-section:open > summary > i {
      transform: rotate(180deg);
      transition: all 200ms ease-in-out;
    }

    .fields-grid {
      display: grid;
      column-gap: 1rem;
      row-gap: 2rem;
    }

    .field-wrapper {
      display: flex;
      flex-direction: column;
    }

    .form-color {
      height: 1.5rem;
      border: 1px solid #e1e0e3;
      border-radius: 0.375rem;
      cursor: pointer;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      cursor: pointer;
    }

    .form-checkbox,
    .form-radio {
      cursor: pointer;
    }

    .checkbox-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .textarea-wrapper {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .variables-hint {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      font-size: 0.75rem;
      color: #718096;
    }

    .variable-tag {
      background-color: #edf2f7;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-family: 'Courier New', monospace;
      font-size: 0.75rem;
      color: #2d3748;
    }
  `,
})
export class DynamicFormComponent {
  schema = input.required<FormSection[]>();
  options = input.required<Record<string, unknown>>();
  formData = model<Partial<Record<WidgetKeys, unknown>>>({});
  isValid = model<boolean>(false);
  lastClickedTableIndex = signal(-1);

  visibleSections = computed(() => {
    const schema = this.schema();
    const formData = this.formData() as Partial<WidgetConfig>;
    return this.getVisibleSection(schema, formData);
  });

  errors = computed(() => {
    return FormSchemaService.getErrors(this.visibleSections(), this.formData());
  });

  constructor() {
    effect(() => {
      this.isValid.set(!this.errors().length);
    });
  }

  private getVisibleSection(
    schema: FormSection[],
    formData: Partial<WidgetConfig>,
  ): FormSection[] {
    return schema.map((item) => ({
      ...item,
      fields: item.fields.filter((field) =>
        this.shouldDisplay(field, formData),
      ),
    }));
  }

  private shouldDisplay(
    field: FormField,
    formData: Partial<WidgetConfig>,
  ): boolean {
    if (field.display === undefined) return true;

    if (field.display && typeof field.display === 'function') {
      return field.display(formData);
    }
    return field.display;
  }

  isChecked<T>(fieldName: WidgetKeys, value: T): boolean {
    const state = this.formData()[fieldName];
    return Array.isArray(state) && state.includes(value);
  }

  toggleCheckbox<T>(fieldName: WidgetKeys, value: T): void {
    const state = (this.formData()[fieldName] || []) as Array<T>;

    if (state.includes(value)) {
      this.formData.update((v) => ({
        ...v,
        [fieldName]: (v[fieldName] as unknown as T[]).filter(
          (v) => v !== value,
        ),
      }));
    } else {
      this.formData.update((v) => ({
        [fieldName]: [...(v[fieldName] as unknown as T[]), value],
      }));
    }
  }

  updateField<T>(fieldName: WidgetKeys, value: T): void {
    this.formData.update((v) => {
      let newState = { ...v };
      newState[fieldName] = value;

      if (fieldName === 'type') {
        newState = FormSchemaService.getValues(this.schema(), newState);
      }

      return newState;
    });
  }

  updateMapField<T>(fieldName: WidgetKeys, key: string, value: T): void {
    this.formData.update((v) => ({
      ...v,
      [fieldName]: { ...((v[fieldName] || {}) as object), [key]: value },
    }));
  }

  updateTableField<T>(
    fieldName: WidgetKeys,
    property: keyof TableWidgetConfig['headers'][0],
    index: number,
    value: T,
  ): void {
    this.formData.update((v) => {
      const newState = structuredClone(v);
      (newState[fieldName] as TableWidgetConfig['headers'])[index][property] =
        value as string;
      return newState;
    });
  }

  addTableRow(fieldName: WidgetKeys) {
    this.formData.update((v) => {
      const newState = structuredClone(v);
      if (!newState[fieldName]) newState[fieldName] = [];

      (newState[fieldName] as TableWidgetConfig['headers']).push({
        label: '',
        value: '',
      });
      return newState;
    });
  }

  removeTableRow(fieldName: WidgetKeys, index: number) {
    this.formData.update((v) => {
      const newState = structuredClone(v);
      if (!newState[fieldName]) newState[fieldName] = [];

      (newState[fieldName] as TableWidgetConfig['headers'])?.splice(index, 1);
      return newState;
    });
  }

  getOptions<T extends 'option' | 'keyValue' | 'variables' = 'option'>(
    optionKey: string,
    type: T = 'option' as T,
  ): T extends 'keyValue'
    ? Record<string, string>
    : T extends 'variables'
      ? string[]
      : SelectOption[] {
    const options = this.options();
    const data = options[optionKey];

    if (type === 'keyValue') return data as any;

    return data as any;
  }

  getTableFields(name: WidgetKeys) {
    return this.formData()[name] as TableWidgetConfig['headers'];
  }

  onDrop(event: DndDropEvent, fieldName: WidgetKeys) {
    let fromIndex = event.data;
    let toIndex = event.index;

    this.formData.update((v) => {
      const tableHeadings = [
        ...((v[fieldName] as TableWidgetConfig['headers']) || []),
      ];
      if (typeof toIndex === undefined) {
        toIndex = tableHeadings.length;
      }

      if (fromIndex === toIndex) return v;

      const controlToMove = tableHeadings[fromIndex];
      tableHeadings.splice(fromIndex, 1);
      tableHeadings.splice(
        Math.max(0, toIndex! - (fromIndex < toIndex! ? 1 : 0)),
        0,
        controlToMove,
      );

      return { ...v, [fieldName]: tableHeadings };
    });
  }

  tableVariableClick(
    variable: string,
    fieldName: WidgetKeys,
    property: keyof TableWidgetConfig['headers'][number],
  ) {
    const index = this.lastClickedTableIndex();
    if (index < 0) return;

    this.formData.update((v) => {
      if (!(v[fieldName] as TableWidgetConfig['headers'])[index]) return v;

      const newState = structuredClone(v);
      (newState[fieldName] as TableWidgetConfig['headers'])[index][property] =
        `{{${variable}}}`;
      return newState;
    });
  }
}
