import {
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  OnInit,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormArray,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { FormModel, TEntity } from '../../types';
import { startWith } from 'rxjs';
import { ENTITY_DEFAULT_FIELDS, IField } from './constants';
import { FormError } from '../../components/form-error/form-error';

export interface IColumn {
  key: string;
  value: string;
}

type IColumnModel = FormGroup<FormModel<IColumn>>;

export function objectKeyValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (!value) return null;

    const valid = /^[a-zA-Z][a-zA-Z0-9_ ]*$/.test(value);
    return !valid ? { invalidKey: { value: control.value } } : null;
  };
}

@Component({
  selector: 'column-mapper',
  imports: [CommonModule, ReactiveFormsModule, FormError],
  template: `
    <div class="wrapper rounded-3 overflow-hidden">
      <form
        class="overflow-auto position-relative"
        [formGroup]="form"
        novalidate
        (ngSubmit)="onSubmit()"
      >
        <table class="table table-borderless table-sm">
          <thead>
            <tr>
              <th
                class="w-25 bg-light border-bottom fs-14 position-sticky top-0 z-3"
              >
                Key Field
              </th>
              <th
                class="bg-light border-bottom fs-14 position-sticky top-0 z-3"
              >
                Value
              </th>
            </tr>
          </thead>
          <tbody formArrayName="columns">
            @for (item of fields.controls; track item) {
              <tr [formGroupName]="$index">
                <td class="position-relative">
                  @if ($any(defaultFields()[$index])?.required !== false) {
                    <span
                      class="position-absolute text-danger fs-12"
                      style="right: 10px; top: 10px;"
                      >*</span
                    >
                  }
                  <input
                    type="text"
                    class="form-control form-control fs-14"
                    [class.text-capitalize]="defaultFields()[$index]"
                    formControlName="key"
                    [placeholder]="getPlaceholder($index, 'key')"
                    [disabled]="isViewMode()"
                    [readOnly]="!!defaultFields()[$index]"
                  />

                  <form-error
                    controlName="key"
                    [messages]="{
                      maxLength: 'Key cannot exceed 20 characters.',
                      invalidKey:
                        'Key must start with a letter and be alphanumeric.',
                      required: 'Key mapping is required',
                    }"
                  />
                </td>
                <td>
                  <div class="d-flex align-items-center flex-wrap">
                    @if (columnsList().length) {
                      <select
                        class="form-control form-control-sm form-select fs-14"
                        formControlName="value"
                        [style.flexBasis]="
                          !defaultFields()[$index]
                            ? 'calc(100% - 100px)'
                            : '100%'
                        "
                      >
                        <option value="">Select Field</option>
                        <option
                          *ngFor="let columnvalue of columnsList()"
                          [value]="columnvalue"
                        >
                          {{ columnvalue }}
                        </option>
                      </select>
                    } @else {
                      <input
                        type="text"
                        class="form-control form-control fs-14"
                        formControlName="value"
                        [placeholder]="getPlaceholder($index, 'value')"
                        [disabled]="isViewMode()"
                        [style.flexBasis]="
                          !defaultFields()[$index]
                            ? 'calc(100% - 50px)'
                            : '100%'
                        "
                        [readOnly]="$any(defaultFields()[$index])?.readonly"
                      />
                    }
                    @if (!defaultFields()[$index]) {
                      <button
                        (click)="removeField($index)"
                        class="text-danger bg-white btn btn-sm px-3 border-none"
                        type="button"
                      >
                        <i class="fa-solid fa-x"></i>
                      </button>
                    }

                    <form-error
                      controlName="value"
                      [messages]="{
                        required: 'Value mapping is required',
                      }"
                    />
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </form>
    </div>
    <div class="pt-2">
      <button
        class="btn btn-sm bg-white text-muted border-0"
        type="button"
        (click)="addField()"
      >
        <i class="fa-solid fa-circle-plus text-warning"></i> Add Key Field
      </button>
    </div>
  `,
  styles: `
    .wrapper {
      box-shadow: 0 0 0 1px var(--bs-border-color);
    }
    form {
      max-height: 30rem;
    }
  `,
})
export class ColumnMapper implements OnInit {
  private readonly fb = inject(NonNullableFormBuilder);

  form = this.fb.group<{
    columns: FormArray<IColumnModel>;
  }>({
    columns: this.fb.array([] as IColumnModel[]),
  });

  isViewMode = input.required<boolean>();
  columnsList = input.required<string[]>();
  entity = input<TEntity | null>(null);

  valid = model<boolean>(false);

  submit = output<{ columns: IColumn[] }>();

  defaultFields = computed(() => {
    const entity = this.entity();

    if (!entity) return [];

    return ENTITY_DEFAULT_FIELDS[entity] || [];
  });
  data = input<IColumn[]>([]);

  get fields(): FormArray {
    return this.form.get('columns') as FormArray;
  }

  constructor() {
    effect(() => {
      const columnList = this.columnsList();
      if (!columnList.length) return;

      this.fields.controls.forEach((control, index) => {
        const ctrl = control as FormGroup;

        ctrl.get('value')?.setValue('');
      });
    });
  }

  ngOnInit(): void {
    const defaultFields = this.defaultFields();
    const groups = this.data().map((item, index) =>
      this.createField(item, defaultFields[index]),
    );
    this.form.setControl('columns', this.fb.array(groups));

    this.form.statusChanges.pipe(startWith(this.form.status)).subscribe(() => {
      this.valid.set(this.form.valid);
    });
  }

  private createField(
    {
      key,
      value,
    }: {
      key: string;
      value: string;
    },
    defaultField?: IField,
  ): FormGroup {
    const isRequired = defaultField?.required ?? true;

    const keyValidators: ValidatorFn[] = [
      objectKeyValidator(),
      Validators.maxLength(20),
    ];
    const valueValidators: ValidatorFn[] = [];

    if (isRequired) {
      keyValidators.push(Validators.required);
      valueValidators.push(Validators.required);
    }

    return this.fb.group({
      key: [key, keyValidators],
      value: [value, valueValidators],
    });
  }

  addField() {
    this.fields.push(this.createField({ key: '', value: '' }));
  }

  removeField(index: number) {
    this.fields.removeAt(index);
  }

  getPlaceholder(index: number, type: 'key' | 'value'): string {
    const defaultFields = this.defaultFields();
    const msg =
      type === 'key'
        ? `Enter Key ${defaultFields[index]?.name || 'field'}`
        : `Enter ${defaultFields[index]?.name || 'Value'}`;
    return msg;
  }

  onSubmit() {
    const val = this.form.getRawValue();

    if (!this.form.valid) return val;

    this.submit.emit(val);
    return val;
  }
}
