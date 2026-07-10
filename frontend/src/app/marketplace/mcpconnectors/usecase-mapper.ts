import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  model,
  OnInit,
  output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
} from '@angular/forms';
import {
  FormModel,
  ISchemaForAgent,
  IUseCase,
  TEntity,
  TUseCaseType,
} from '../../types';
import { startWith } from 'rxjs';
import { FormError } from '../../components/form-error/form-error';
import { AnalyticsService } from '../../services/analytics.service';
import { NgxSpinnerService } from 'ngx-spinner';
import {
  INSIGHT_DEFAULT_USE_CASE_JSON,
  TRENDS_DEFALUT_USE_CASE_JSON,
  V,
} from '../../utils';
import { DndDropEvent, DndModule } from 'ngx-drag-drop';
import { UseCaseGenerator } from './usecase-generator';

type IUseCaseModel = FormGroup<FormModel<IUseCase>>;

@Component({
  selector: 'usecase-mapper',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormError,
    DndModule,
    UseCaseGenerator,
  ],
  template: ` <div class="fw-14 mb-1">
      <strong>Note:</strong> Default use cases are included by default. You can
      add custom use cases below.
    </div>
    <div class="wrapper rounded-3 overflow-hidden">
      <form
        #scrollContainer
        class="overflow-auto position-relative"
        style="max-height: 30rem;"
        [formGroup]="form"
        novalidate
        (ngSubmit)="onSubmit()"
      >
        <table class="table table-borderless mb-0">
          <colgroup>
            <col style="width: 5%" />
            <col style="width: 42.5%" />
            <col style="width: 42.5%" />
            <col style="width: 10%" />
          </colgroup>
          <thead>
            <tr>
              <th
                class="bg-light border-bottom fs-14 position-sticky top-0"
              ></th>
              <th class="bg-light border-bottom fs-14 position-sticky top-0">
                Use Case
              </th>
              <th class="bg-light border-bottom fs-14 position-sticky top-0">
                Response
              </th>
              <th
                class="bg-light border-bottom fs-14 position-sticky top-0"
              ></th>
            </tr>
          </thead>
          <tbody formArrayName="cases" dndDropzone (dndDrop)="onDrop($event)">
            <tr
              dndPlaceholderRef
              class="dndPlaceholder border border-warning"
              style="--bs-border-style: dashed"
            ></tr>
            @for (item of fields.controls; track item.get('id')?.value) {
              @let description = item.get('description');
              @let jsonValue = item.get('json');
              @let isDefault = item.get('source')?.value === 'static';
              @let chartType = item.get('chartType');

              @let loading = item.get('loading');
              @let allowEdit = item.get('allowEdit');

              @let readOnly =
                loading?.value || (isDefault ? isDefault : !allowEdit?.value);

              <tr
                [formGroupName]="$index"
                [dndDraggable]="$index"
                dndEffectAllowed="move"
              >
                <td class="text-center">
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
                <td>
                  <input type="hidden" formControlName="id" />
                  <input type="hidden" formControlName="chartType" />
                  <input type="hidden" formControlName="source" />
                  <input type="hidden" formControlName="persistence" />
                  <input type="hidden" formControlName="allowEdit" />
                  <input type="hidden" formControlName="loading" />
                  <textarea
                    class="form-control fs-14"
                    [class]="readOnly ? 'bg-light' : ''"
                    formControlName="description"
                    placeholder="Type use case"
                    [readOnly]="readOnly"
                  >
                  </textarea>

                  <form-error
                    controlName="description"
                    [messages]="{
                      maxlength: 'Use case cannot exceed 300 characters.',
                      required: 'Use case is required',
                    }"
                  />
                </td>
                <td>
                  <textarea
                    class="form-control fs-14"
                    [class]="readOnly ? 'bg-light' : ''"
                    formControlName="json"
                    [rows]="isDefault ? 2 : 5"
                    [readOnly]="readOnly"
                  >
                  </textarea>
                  <form-error
                    controlName="json"
                    [messages]="{
                      required: 'Json is required',
                    }"
                  />
                </td>
                <td style="height: 1px;">
                  <div
                    class="d-flex gap-2 justify-content-around h-100 align-items-center"
                  >
                    <div
                      style="width: 1.8rem;"
                      class="d-flex align-items-center justify-content-center"
                    >
                      <i
                        [title]="chartType?.value + ' chart'"
                        class="fa-solid text-warning fs-4"
                        [class]="iconMap[chartType?.value]"
                        style="font-size: 1.8rem;"
                      ></i>
                    </div>

                    @if (!isDefault) {
                      <button
                        type="button"
                        [title]="
                          allowEdit?.value ? 'Save Usecase' : 'Edit Usecase'
                        "
                        [disabled]="
                          loading?.value ||
                          description?.errors ||
                          jsonValue?.errors
                        "
                        class="action-btn"
                        (click)="allowEdit?.setValue(!allowEdit?.value)"
                      >
                        <i
                          class="fa-solid"
                          [class]="allowEdit?.value ? 'fa-save' : 'fa-pencil'"
                        ></i>
                      </button>

                      <usecase-generator
                        [disabled]="!allowEdit?.value"
                        [isLoading]="loading?.value"
                        class="d-flex align-items-center flex-wrap"
                        controlName="json"
                        [useCase]="description?.value || ''"
                        [useCaseTab]="useCaseTab()"
                        [fullSchema]="fullSchema()"
                        (chartType)="chartType?.setValue($event)"
                        (useCaseJson)="jsonValue?.setValue($event)"
                        (loading)="loading?.setValue($event)"
                      />

                      <button
                        type="button"
                        title="Delete Usecase"
                        [disabled]="loading?.value"
                        class="action-btn"
                        (click)="
                          removeField(
                            $index,
                            description?.value || '',
                            item.get('persistence')?.value || 'local'
                          )
                        "
                      >
                        <i class="fa-solid fa-trash"></i>
                      </button>

                      <button
                        type="button"
                        title="Reset Usecase Json"
                        [disabled]="loading?.value"
                        class="action-btn"
                        (click)="jsonValue?.setValue(defaultJson())"
                      >
                        <i class="fa-solid fa-arrow-rotate-left"></i>
                      </button>
                    }
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
        <i class="fa-solid fa-circle-plus text-warning"></i> Add Use Case
      </button>
    </div>`,
  styles: `
    .wrapper {
      box-shadow: 0 0 0 1px var(--bs-border-color);
    }
    form {
      max-height: 30rem;
    }
    .action-btn {
      width: 1.8rem;
      height: 1.8rem;
      font-size: 0.875rem;
      background: #f9a84a;
      color: #fff;
      border-radius: 50%;
      border: transparent;
      outline: transparent;
      display: grid;
      place-content: center;
    }

    .action-btn:hover,
    .action-btn:disabled {
      opacity: 0.5;
    }

    .action-btn:disabled {
      cursor: not-allowed;
    }
  `,
})
export class UseCaseMapper implements OnInit {
  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLFormElement>;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly service = inject(AnalyticsService);
  private readonly loading = inject(NgxSpinnerService);
  readonly iconMap: Record<string, string> = {
    bar: 'fa-chart-simple',
    pie: 'fa-chart-pie',
    line: 'fa-chart-line',
  };

  form = this.fb.group<{
    cases: FormArray<IUseCaseModel>;
  }>({
    cases: this.fb.array([] as IUseCaseModel[]),
  });

  valid = model<boolean>(false);
  submit = output<IUseCase[]>();
  indexId = input.required<string>();
  data = input<IUseCase[]>([]);
  entity = input<TEntity | null>(null);
  useCaseTab = input<TUseCaseType>('insights');
  fullSchema = input<ISchemaForAgent['full_schema']>([]);

  get fields(): FormArray {
    return this.form.get('cases') as FormArray;
  }

  defaultJson = computed(() =>
    this.useCaseTab() === 'insights'
      ? INSIGHT_DEFAULT_USE_CASE_JSON
      : TRENDS_DEFALUT_USE_CASE_JSON,
  );

  constructor() {
    effect(() => {
      const data = this.data();
      const groups = data.map((item) => this.createField(item));
      this.form.setControl('cases', this.fb.array(groups));
    });
  }

  ngOnInit(): void {
    this.form.statusChanges.pipe(startWith(this.form.status)).subscribe(() => {
      this.valid.set(this.form.valid);
    });
  }

  private createField(data: IUseCase): FormGroup {
    return this.fb.group({
      description: this.fb.control(
        { value: data.description, disabled: data.source === 'static' },
        {
          validators: V.string('Usecase')
            .required()
            .max(300)
            .test(
              'duplicate',
              'Duplicate use case',
              (value) =>
                this.fields.controls.filter(
                  (item) => item.get('description')?.value === value,
                ).length <= 1,
            )
            .build(),
        },
      ),
      json: this.fb.control(
        { value: data.json, disabled: data.source === 'static' },
        {
          validators: V.string()
            .required()
            .json(
              undefined,
              this.useCaseTab() === 'insights'
                ? ['formats']
                : [
                    'chartfit_structure_json',
                    'opensearch_query',
                    'sample_response',
                  ],
            )
            .test(
              'duplicate',
              'Duplicate use case json',
              (value) =>
                this.fields.controls.filter(
                  (item) => item.get('json')?.value === value,
                ).length <= 1,
            )
            .build(),
        },
      ),
      source: this.fb.control(data.source),
      persistence: this.fb.control(data.persistence),
      id: this.fb.control(data.id),
      chartType: this.fb.control(data.chartType),
      allowEdit: this.fb.control(data.allowEdit),
      loading: this.fb.control(data.loading),
    });
  }

  addField() {
    this.fields.push(
      this.createField({
        id: crypto.randomUUID(),
        description: '',
        json: this.defaultJson(),
        chartType: '',
        loading: false,
        allowEdit: true,
        persistence: 'local',
        source: 'dynamic',
      }),
    );

    setTimeout(() => {
      const el = this.scrollContainer.nativeElement;
      if (!el?.scrollHeight) return;
      el?.scrollTo({ top: el.scrollHeight });
    });
  }

  removeField(
    index: number,
    useCase: string,
    persistence: IUseCase['persistence'],
  ) {
    const indexId = this.indexId();

    if (persistence === 'remote' && indexId) {
      this.loading.show();

      this.service
        .removeUseCase({ index_id: indexId, usecase_name: useCase })
        .subscribe({
          next: () => {
            this.fields.removeAt(index);
            this.loading.hide();
          },
          error: () => {
            this.loading.hide();
          },
        });
      return;
    }

    this.fields.removeAt(index);
  }

  onSubmit() {
    this.fields.controls.forEach((ctrl) => {
      ctrl.get('loading')?.setValue(false);
      ctrl.get('allowEdit')?.setValue(false);
    });
    const { cases } = this.form.getRawValue();
    if (!this.form.valid) return cases;

    this.submit.emit(cases);
    return cases;
  }

  onDrop(event: DndDropEvent) {
    let fromIndex = event.data;
    let toIndex = event.index;

    if (typeof toIndex === undefined) {
      toIndex = this.fields.length;
    }

    if (fromIndex === toIndex) return;

    const controlToMove = this.fields.at(fromIndex);
    this.fields.removeAt(fromIndex);
    this.fields.insert(
      Math.max(0, toIndex! - (fromIndex < toIndex! ? 1 : 0)),
      controlToMove,
    );
  }
}
