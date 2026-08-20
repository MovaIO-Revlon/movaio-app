import {
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  OnDestroy,
  output,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidatorFn,
} from '@angular/forms';
import { startWith, switchMap } from 'rxjs';
import { FormError } from '../../components/form-error/form-error';
import { V } from '../../utils';
import { ITool, TConnectorType } from '../../types';
import { SemarketplaceService } from '../../services/semarketplace.service';
import { NgxSpinnerService } from 'ngx-spinner';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

type TConnectors = Extract<TConnectorType, 'OneDrive' | 'ServiceNow'>;
@Component({
  selector: 'dynamic-form',
  imports: [CommonModule, ReactiveFormsModule, FormError],
  template: ` @let formSchema = schema();
    @let dynamicForm = form();
    @if (formSchema) {
      <form
        [formGroup]="dynamicForm"
        novalidate
        style="min-height:300px;"
        class="px-3 py-2 d-flex justify-content-between flex-wrap flex-column flex-lg-row gap-2 align-content-start"
      >
        @for (field of formSchema.fields; track field.key) {
          <div style="flex-basis: 45%;">
            <label class="form-label fw-bold fs-14 text-capitalize">
              {{ field.label }}
              @if (field.required) {
                <span class="text-danger">*</span>
              }
            </label>

            <input
              class="form-control fs-14"
              [type]="field.isSecret ? 'password' : 'text'"
              [formControlName]="field.key"
              [placeholder]="
                field.isSecret && dynamicForm.get(field.key)?.value
                  ? '••••••••'
                  : 'Enter ' + field.label
              "
              [readOnly]="field.readonly"
              [class.is-invalid]="
                dynamicForm.get(field.key)?.invalid &&
                dynamicForm.get(field.key)?.touched
              "
              (focus)="onFieldFocus(field)"
              (blur)="onFieldBlur(field)"
            />

            <form-error [controlName]="field.key" />
          </div>
        }
      </form>

      @if (['oauth', 'api-key'].includes(formSchema.authScheme)) {
        @let connection = connectionState();

        <div class="d-flex gap-3 align-items-center px-3 pb-3">
          <button
            [disabled]="!dynamicForm.valid || connection.message"
            type="button"
            class="btn bg-warning text-white"
            (click)="testConnection()"
          >
            Test Connection
          </button>
          @if (connection.message) {
            <span
              class="fs-14"
              [class.text-success]="connection.status"
              [class.text-danger]="!connection.status"
              >{{ connection.message }}</span
            >
          }
        </div>
      }
    }`,
})
export class DynamicForm implements OnDestroy {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly service = inject(SemarketplaceService);
  private readonly loader = inject(NgxSpinnerService);

  connector = input<TConnectors>();
  excludeNames = input<string[]>([]);
  tools = input<ITool[]>();
  data = input<Record<string, any>>({});
  isEdit = input<boolean>(false);
  valid = model<boolean>(false);
  submit = output<Record<string, any>>();

  originalSecrets = new Map<string, string>();

  schema = computed(() => {
    const FIELDS_CONFIG: Record<
      string,
      {
        authScheme: 'no-auth' | 'oauth' | 'api-key';
        fields: {
          key: string;
          label: string;
          type: 'text' | 'select';
          validation?: ValidatorFn;
          default?: any;
          required?: boolean;
          readonly?: boolean;
          isSecret: boolean;
        }[];
      }
    > = {};

    const isEdit = this.isEdit();
    const excludeNames = this.excludeNames();

    this.tools()?.forEach((item) => {
      FIELDS_CONFIG[item.tool_name] = {
        authScheme: 'oauth',
        fields: ['name', ...item.tool_configs].map((name) => {
          const label = name.replaceAll('_', ' ');
          const readonly = isEdit && name === 'name';

          let validator = readonly
            ? V.string(label)
            : V.string(label).required();

          if (name === 'name') {
            validator = validator.test(
              'duplicate',
              'Name is already used',
              (val) => {
                if (!val || !excludeNames.length) return true;

                return !excludeNames.includes(val);
              },
            );
          }

          return {
            key: name,
            label,
            type: 'text',
            validation: validator.build(),
            required: true,
            readonly,
            isSecret: name !== 'name',
          };
        }),
      };
    });

    return FIELDS_CONFIG[this.connector()!];
  });

  connectionState = signal<{ status: boolean; message: string }>({
    status: false,
    message: '',
  });

  readonly form = computed<FormGroup>(() => {
    const schema = this.schema();
    const d = this.data();
    if (!schema) return this.fb.group({});

    const obj: Record<string, any> = {};
    schema.fields.forEach((item) => {
      obj[item.key] = this.fb.control(
        { value: d?.[item.key] ?? item.default ?? '', disabled: item.readonly },
        item.validation,
      );
    });

    return this.fb.group(obj);
  });

  readonly formValue = toSignal(
    toObservable(this.form).pipe(
      switchMap((f) => f.valueChanges.pipe(startWith(f.value))),
    ),
  );

  isConnectionTestingRequired = computed(() => {
    const formValue = this.formValue() || {};
    const oldValue = this.data() || {};

    const formKeys = Object.keys(formValue);
    const oldKeys = Object.keys(oldValue).filter((item) => item !== 'name');

    return (
      formKeys.length !== oldKeys.length ||
      formKeys.some((key) => key !== 'name' && formValue[key] !== oldValue[key])
    );
  });

  constructor() {
    effect((onCleanup) => {
      const currentForm = this.form();
      const schema = this.schema();
      const isConnectionTestingRequired = untracked(() =>
        this.isConnectionTestingRequired(),
      );

      const isConnectionValid =
        schema?.authScheme !== 'no-auth' ? this.connectionState().status : true;

      const sub = currentForm.statusChanges
        .pipe(startWith(currentForm.status))
        .subscribe((status) => {
          this.valid.set(
            !!(
              status === 'VALID' &&
              (isConnectionTestingRequired ? isConnectionValid : true)
            ),
          );
        });

      onCleanup(() => sub.unsubscribe());
    });

    effect(() => {
      const required = this.formValue();

      untracked(() => {
        this.connectionState.set({ status: false, message: '' });

        this.valid.set(
          !!(this.isConnectionTestingRequired() && this.form()?.valid),
        );
      });
    });
  }

  ngOnDestroy(): void {
    this.connectionState.set({ status: false, message: '' });
  }

  onSubmit() {
    const val = {
      ...this.form().getRawValue(),
      auth: this.schema().authScheme,
    };

    if (!this.form().valid) return val;

    this.submit.emit(val);
    return val;
  }

  testConnection() {
    const d = this.form().getRawValue() as {
      client_id: string;
      client_secret: string;
      auth_url: string;
      connector_type: TConnectors;
    };

    this.loader.show();

    this.service
      .authenticateTool({
        ...d,
        connector_type: this.connector()!,
      })
      .subscribe({
        next: (res) => {
          this.loader.hide();
          this.connectionState.set({
            status: true,
            message: res?.message || 'Connection Successful',
          });
        },
        error: (err) => {
          this.loader.hide();
          this.connectionState.set({
            status: false,
            message: err?.error?.message || 'Connection Failed',
          });
        },
      });
  }

  onFieldFocus(field: any) {
    if (field.isSecret) {
      const control = this.form().get(field.key);
      if (!control) return;

      if (!this.originalSecrets.has(field.key) && control?.value) {
        this.originalSecrets.set(field.key, control.value);

        control.setValue('');
      }
    }
  }

  onFieldBlur(field: any) {
    if (!field.isSecret) return;

    const control = this.form()?.get(field.key);
    if (!control) return;

    if (this.originalSecrets.has(field.key) && !control?.value?.trim()) {
      control.setValue(this.originalSecrets.get(field.key));

      this.originalSecrets.delete(field.key);
    }
  }
}
