import {
  Component,
  inject,
  input,
  model,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormArray,
  FormGroup,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { FormModel, IAgent, TEntity } from '../../types';
import { SemarketplaceService } from '../../services/semarketplace.service';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { NgxSpinnerService } from 'ngx-spinner';
import {
  catchError,
  map,
  Observable,
  of,
  startWith,
  switchMap,
  timer,
} from 'rxjs';
import { V } from '../../utils';
import { FormError } from '../../components/form-error/form-error';
export interface IFile {
  name: string;
  extension: string;
  file: File | string;
}

export interface IExcelForm {
  index_name: string;
  entity_type: TEntity | null;
  onboarded_agent: string;
  sheet_name: string;
  files: IFile[];
  sheetsList?: string[];
}

type TFileForm = FormGroup<
  FormModel<
    Omit<IFile, 'file'> & {
      file: IExcelForm['files'][0]['file'];
    }
  >
>;

export function fileValidator(
  allowedExtensions: string[],
  maxMB: number,
): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const file = control.value as File;
    if (!file) return null;

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const maxSizeBytes = maxMB * 1024 * 1024;

    if (!allowedExtensions.includes(extension)) {
      return {
        invalidExtension: {
          allowed: allowedExtensions.join(', '),
          actual: extension,
        },
      };
    }

    if (file.size > maxSizeBytes) {
      return {
        maxSize: {
          limit: maxMB,
          actual: (file.size / (1024 * 1024)).toFixed(2),
        },
      };
    }

    return null;
  };
}

@Component({
  selector: 'excel-connector-form',
  imports: [CommonModule, ReactiveFormsModule, TooltipDirective, FormError],
  template: `<form [formGroup]="form" novalidate (ngSubmit)="onSubmit()">
    <div class="row" style="min-height:340px;">
      <div class="col-md-6 border-end pe-4">
        <div class="mb-2 fw-bold fs-14">
          Upload File<span class="text-danger">*</span>
        </div>
        <div
          class="file-upload-area mb-2 p-3 rounded d-flex flex-column align-items-center justify-content-center"
          style="border:1px dashed #d2d2d2; min-height:10em; background:#f9f9f9;"
        >
          <span class="fw-semibold mb-2"
            >Choose files or drag &amp; drop it here</span
          >
          <span class="fs-13 text-muted mb-2"
            >.xlsx, .xlsm, .xls, .csv files up to 100MB</span
          >
          <input
            type="file"
            class="form-control"
            (change)="onFilesAdded($event)"
            style="display:none;"
            #fileInput
            [disabled]="isViewMode()"
            accept=".xlsx,.xlsm,.xls,.csv"
          />
          <button
            type="button"
            class="btn btn-outline-primary"
            (click)="fileInput.click()"
          >
            Browse Files
          </button>
        </div>
        <div class="mb-3">
          <div>
            <div style="max-height:310px; overflow-y:auto;">
              @for (file of filesControl.controls; track $index) {
                <div
                  class="file-card mb-3 py-2 px-3 rounded d-flex align-items-center justify-content-between"
                  style="background:#fff7ea; border:1px solid #ffd197; min-height:48px;"
                >
                  <span class="me-2"
                    ><i
                      class="fs-4"
                      [class]="
                        (
                          FILE_TYPES[
                            file.get('extension')?.value || 'default'
                          ] || FILE_TYPES['default']
                        ).icon +
                        ' ' +
                        (
                          FILE_TYPES[
                            file.get('extension')?.value || 'default'
                          ] || FILE_TYPES['default']
                        ).class
                      "
                    ></i
                  ></span>

                  <span class="fs-14 fw-semibold" style="flex:1;">{{
                    file.get('name')?.value
                  }}</span>
                  <button
                    type="button"
                    class="btn btn-link text-danger px-2"
                    (click)="removeFile($index)"
                    [disabled]="isViewMode()"
                  >
                    <img
                      src="assets/img/delete_icon.png"
                      alt="Delete"
                      width="16"
                      height="16"
                    />
                  </button>
                </div>
              }
              <div
                *ngIf="filesControl.controls.length === 0"
                class="text-muted fs-13 mt-3"
              >
                No files added yet.
              </div>
            </div>
          </div>

          @if (
            $any(filesControl.controls[0])?.get('file')?.invalid &&
            $any(filesControl.controls[0])?.get('file')?.touched
          ) {
            <div class="invalid-feedback d-block">
              @if (filesControl.controls[0].get('file')?.hasError('mazSize')) {
                Maximum of 100MB is allowed
              }
              else
              @if (
                filesControl.controls[0]
                  .get('file')
                  ?.hasError('invalidExtension')
              ) {
                Invalid File Type
              } @else {
                File is required
              }
            </div>
          }
        </div>
      </div>

      <div class="col-md-6 ps-4">
        <div class="mb-3">
          <label
            class="form-label fw-bold fs-14"
            appTooltip="Enter the Unique Index Name for this MCP Server"
            >Name<span class="text-danger">*</span></label
          >
          <input
            type="text"
            class="form-control fs-14"
            [class.is-invalid]="
              form.get('index_name')?.invalid && form.get('index_name')?.touched
            "
            formControlName="index_name"
            placeholder="Enter index name"
            [disabled]="isViewMode()"
            [readOnly]="isEdit()"
          />
          <form-error controlName="index_name" />
        </div>
        <div class="mb-3">
          <label
            class="form-label fw-bold fs-14"
            appTooltip="Select the Sheet Name from the file uploaded"
            >Sheet Name <span class="text-danger">*</span></label
          >

          <select
            class="form-control form-select fs-14"
            [class.is-invalid]="
              form.get('sheet_name')?.invalid && form.get('sheet_name')?.touched
            "
            formControlName="sheet_name"
          >
            <option value="">Select Sheet</option>
            <option *ngFor="let sheet of sheetsList()" [value]="sheet">
              {{ sheet }}
            </option>
          </select>
          @if (
            form.get('sheet_name')?.invalid && form.get('sheet_name')?.touched
          ) {
            <div class="invalid-feedback d-block">Sheet Name is required</div>
          }
        </div>
        <div class="mb-3">
          <label
            class="form-label fw-bold fs-14"
            appTooltip="Select the Entity Type for this MCP Server"
            >Entity Type <span class="text-danger">*</span></label
          >
          <select
            class="form-control form-select fs-14 text-capitalize"
            [class.is-invalid]="
              form.get('entity_type')?.invalid &&
              form.get('entity_type')?.touched
            "
            formControlName="entity_type"
          >
            <option value="">Select Entity</option>
            <option
              class="text-capitalize"
              *ngFor="let entity of entityList()"
              [value]="entity"
            >
              {{ entity }}
            </option>
          </select>

          @if (
            form.get('entity_type')?.invalid && form.get('entity_type')?.touched
          ) {
            <div class="invalid-feedback d-block">Entity Type is required</div>
          }
        </div>

        <div class="mb-3">
          <label
            class="form-label fw-bold fs-14"
            appTooltip="Select the Agent to Map with"
            >Onboarded Agent<span class="text-danger">*</span></label
          >
          <select
            class="form-control form-select fs-14"
            [class.is-invalid]="
              form.get('onboarded_agent')?.invalid &&
              form.get('onboarded_agent')?.touched
            "
            formControlName="onboarded_agent"
          >
            <option value="">Select Agent</option>
            <option *ngFor="let agent of agentsList()" [value]="agent.agent_id">
              {{ agent.name }}
            </option>
          </select>

          @if (
            form.get('onboarded_agent')?.invalid &&
            form.get('onboarded_agent')?.touched
          ) {
            <div class="invalid-feedback d-block">
              Onboarded Agent is required
            </div>
          }
          @if (form.get('onboarded_agent')?.value) {
            <span
              [appTooltip]="'This is the KG mapped with the Selected Agent'"
              class="ms-1 fs-12"
              ><span class="fw-semibold">Knowledge Base:</span>
              {{
                this.getAddedKnowledgeStoreForAgent(
                  form.get('onboarded_agent')?.value
                )
              }}</span
            >
          }
        </div>
      </div>
    </div>
  </form>`,
})
export class ExcelConnectorForm implements OnInit {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly marketPlaceService = inject(SemarketplaceService);
  private readonly loading = inject(NgxSpinnerService);

  readonly FILE_TYPES: Record<string, { icon: string; class: string }> = {
    pdf: { icon: 'bi bi-file-earmark-pdf', class: 'text-danger' },
    docx: {
      class: 'text-primary',
      icon: 'bi bi-file-earmark-word',
    },
    csv: { icon: 'bi bi-file-earmark-excel', class: 'text-success' },
    txt: { icon: 'bi bi-file-earmark-text', class: 'text-info' },
    text: { icon: 'bi bi-fonts', class: 'text-info' },
    website: { icon: 'bi bi-globe2', class: 'text-success' },
    default: { icon: 'bi bi-file-earmark', class: 'text-secondary' },
  };

  isEdit = input.required<boolean>();
  isViewMode = input.required<boolean>();
  agentsList = input.required<IAgent[]>();
  entityList = input.required<string[]>();
  data = input<Partial<IExcelForm>>({});

  valid = model<boolean>(false);

  submit = output<IExcelForm>();

  private validateIndexName = (
    control: AbstractControl,
  ): Observable<ValidationErrors | null> => {
    const value = control.value;

    if (!value) {
      return of(null);
    }

    if (value === this.data().index_name) {
      return of(null);
    }

    return timer(500).pipe(
      switchMap(() =>
        this.marketPlaceService.checkDuplicateIndex({
          index_name: value,
        }),
      ),
      map((res) =>
        res?.exists ? { duplicate: 'Index name is already being used' } : null,
      ),
      catchError(() => of(null)),
    );
  };

  form = this.fb.group<
    FormModel<Omit<IExcelForm, 'files'>> & {
      files: FormArray<TFileForm>;
    }
  >({
    index_name: this.fb.control(
      '',
      V.string('Name').required().noSpaces().underscoreBetween().build(),
      [this.validateIndexName.bind(this)],
    ),
    entity_type: this.fb.control(null, Validators.required),
    onboarded_agent: this.fb.control('', Validators.required),
    sheet_name: this.fb.control('', Validators.required),
    files: this.fb.array([] as TFileForm[]),
  });

  sheetsList = signal<string[]>([]);

  ngOnInit() {
    let { files = [], sheetsList = [], ...rest } = this.data();

    if (!sheetsList.length) {
      if (rest.sheet_name) sheetsList.push(rest.sheet_name);
      else if (files?.length) sheetsList.push(files[files.length - 1].name);
    }

    this.sheetsList.set(sheetsList);

    if (!rest.sheet_name) {
      rest.sheet_name = sheetsList[0];
    }

    this.form.patchValue(rest);

    files?.forEach((item) => {
      this.filesControl.push(this.addFile(item));
    });

    this.form.statusChanges.pipe(startWith(this.form.status)).subscribe(() => {
      this.valid.set(this.form.valid);
    });
  }

  get filesControl() {
    return this.form.get('files') as FormArray<TFileForm>;
  }

  getAddedKnowledgeStoreForAgent(agentId?: string): string {
    return (
      this.agentsList().find((agent) => agent.agent_id === agentId)
        ?.knowledge_store?.name || ''
    );
  }

  removeFile(index: number) {
    this.filesControl?.removeAt(index);
    this.form.patchValue({ sheet_name: '' });
    this.sheetsList.set([]);
  }

  addFile({ name = '', extension = '', file = '' }: Partial<IFile>) {
    return this.fb.group({
      name: this.fb.control(name, Validators.required),
      extension: this.fb.control(extension, Validators.required),
      file: this.fb.control<IFile['file']>(file, [
        // Validators.required,
        fileValidator(['xlsx', 'xls', 'csv'], 100), // 100MB limit
      ]),
    }) satisfies TFileForm;
  }

  onFilesAdded(event: any) {
    const files: FileList = event.target.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const extension = file.name.split('.').pop()?.toLowerCase() || '';

      const fileGroup = this.addFile({
        name: file.name,
        extension,
        file,
      });

      this.filesControl.push(fileGroup);
    }

    this.getSheetsList();
    event.target.value = '';
  }

  getSheetsList(): void {
    const addedFiles = (this.form.get('files')?.value || []).filter(
      (item) => !!item.file,
    );

    if (!addedFiles.length) return;

    if (addedFiles[0].extension === 'csv') {
      this.sheetsList.set([addedFiles[0].name]);
      this.form.patchValue({ sheet_name: addedFiles[0].name });
      return;
    }

    const formData = new FormData();
    addedFiles.forEach((file) => {
      formData.append('file', file.file);
    });

    this.loading.show();

    this.marketPlaceService.getSheetsForExcelUpload(formData).subscribe({
      next: (response) => {
        if (response.status === 'success') {
          this.sheetsList.set(response.sheet_names || []);
          this.form.patchValue({ sheet_name: response.sheet_names?.[0] || '' });
        }
        this.loading.hide();
      },
      error: (err: any) => {
        this.loading.hide();
      },
    });
  }

  onSubmit(): IExcelForm | undefined {
    const val = this.form.getRawValue();

    if (!this.form.valid) return { ...val, sheetsList: this.sheetsList() };

    this.submit.emit(val);
    return { ...val, sheetsList: this.sheetsList() };
  }
}
