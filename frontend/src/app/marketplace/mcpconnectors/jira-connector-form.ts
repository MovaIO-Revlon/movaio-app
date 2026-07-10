import {
  Component,
  computed,
  inject,
  input,
  model,
  OnInit,
  output,
  resource,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { FormModel, IAgent, TEntity } from '../../types';
import { SemarketplaceService } from '../../services/semarketplace.service';
import {
  catchError,
  lastValueFrom,
  map,
  Observable,
  of,
  startWith,
  switchMap,
  timer,
} from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormError } from '../../components/form-error/form-error';
import { V } from '../../utils';

export interface IJiraForm {
  index_name: string;
  entity_type: TEntity | null;
  onboarded_agent: string;
  url: string;
  username: string;
  api_token: string;
  project_key: string;
}
@Component({
  selector: 'jira-connector-form',
  imports: [CommonModule, ReactiveFormsModule, TooltipDirective, FormError],
  template: `<form [formGroup]="form" novalidate>
    <div class="row" style="min-height:340px;">
      <div class="col-md-6 border-end pe-4">
        <div class="mb-3">
          <label
            class="form-label fw-bold fs-14"
            appTooltip="Enter the Unique Index Name for this MCP Server"
            >Dataset Index Name<span class="text-danger">*</span></label
          >
          <input
            type="text"
            class="form-control fs-14"
            [class.is-invalid]="
              form.get('index_name')?.invalid && form.get('index_name')?.touched
            "
            formControlName="index_name"
            placeholder="Enter Dataset Index Name"
            [disabled]="isViewMode()"
            [readOnly]="isEdit()"
          />

          <form-error controlName="index_name" />
        </div>

        <div class="mb-3">
          <label
            class="form-label fw-bold fs-14"
            appTooltip="Enter the Unique Index Name for this MCP Server"
            >Connector URL<span class="text-danger">*</span></label
          >
          <input
            type="text"
            class="form-control fs-14"
            [class.is-invalid]="
              form.get('url')?.invalid && form.get('url')?.touched
            "
            formControlName="url"
            placeholder="Enter URL"
            [disabled]="isViewMode()"
          />
          <div
            class="invalid-feedback d-block"
            *ngIf="form.get('url')?.invalid && form.get('url')?.touched"
          >
            @if (form.get('url')?.hasError('pattern')) {
              Invalid URL
            } @else {
              URL is required
            }
          </div>
        </div>

        <div class="mb-3">
          <label
            class="form-label fw-bold fs-14"
            appTooltip="Enter the Unique Index Name for this MCP Server"
            >Username<span class="text-danger">*</span></label
          >
          <input
            type="text"
            class="form-control fs-14"
            [class.is-invalid]="
              form.get('username')?.invalid && form.get('username')?.touched
            "
            formControlName="username"
            placeholder="Enter Username"
            [disabled]="isViewMode()"
          />
          <div
            class="invalid-feedback d-block"
            *ngIf="
              form.get('username')?.invalid && form.get('username')?.touched
            "
          >
            @if (form.get('username')?.hasError('email')) {
              Invalid Email
            } @else {
              Username is required
            }
          </div>
        </div>

        <div class="mb-3">
          <label
            class="form-label fw-bold fs-14"
            appTooltip="Enter the Unique Index Name for this MCP Server"
            >Api token<span class="text-danger">*</span></label
          >
          <input
            type="password"
            class="form-control fs-14"
            [class.is-invalid]="
              form.get('api_token')?.invalid && form.get('api_token')?.touched
            "
            formControlName="api_token"
            placeholder="Enter api_token"
            [disabled]="isViewMode()"
          />
          <div
            class="invalid-feedback d-block"
            *ngIf="
              form.get('api_token')?.invalid && form.get('api_token')?.touched
            "
          >
            Api Token is required
          </div>
        </div>

        <div class="mb-3">
          <label
            class="form-label fw-bold fs-14"
            appTooltip="Select the Sheet Name from the file uploaded"
            >AI Solution <span class="text-danger">*</span></label
          >
          <select
            class="form-control form-select fs-14"
            [disabled]="projectListQuery.isLoading()"
            [class.is-invalid]="
              form.get('project_key')?.invalid &&
              form.get('project_key')?.touched
            "
            formControlName="project_key"
          >
            <option value="">
              @if (projectListQuery.isLoading()) {
                Loading...
              } @else {
                Select AI Solution
              }
            </option>
            <option
              *ngFor="let project_key of projectList()"
              [value]="project_key"
            >
              {{ project_key }}
            </option>
          </select>
          <div
            class="invalid-feedback d-block"
            *ngIf="
              form.get('project_key')?.invalid &&
              form.get('project_key')?.touched
            "
          >
            AI Solution is required
          </div>
        </div>
      </div>
      <div class="col-md-6 ps-4">
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
          <div
            class="invalid-feedback d-block"
            *ngIf="
              form.get('entity_type')?.invalid &&
              form.get('entity_type')?.touched
            "
          >
            Entity Type is required
          </div>
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
          <div
            class="invalid-feedback d-block"
            *ngIf="
              form.get('onboarded_agent')?.invalid &&
              form.get('onboarded_agent')?.touched
            "
          >
            Onboarded Agent is required
          </div>
          <span
            [appTooltip]="'This is the KG mapped with the Selected Agent'"
            *ngIf="form.get('onboarded_agent')?.value"
            class="ms-1 fs-12"
            ><span class="fw-semibold">Knowledge Base:</span>
            {{
              this.getAddedKnowledgeStoreForAgent(
                form.get('onboarded_agent')?.value
              )
            }}</span
          >
        </div>
      </div>
    </div>
  </form>`,
})
export class JiraConnectorForm implements OnInit {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly marketPlaceService = inject(SemarketplaceService);

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

  form = this.fb.group<FormModel<IJiraForm>>({
    index_name: this.fb.control(
      '',
      V.string('Name').required().noSpaces().underscoreBetween().build(),
      [this.validateIndexName.bind(this)],
    ),
    entity_type: this.fb.control(null, Validators.required),
    onboarded_agent: this.fb.control('', Validators.required),
    url: this.fb.control('', [
      Validators.required,
      Validators.pattern(/https?:\/\/.+/),
    ]),
    username: this.fb.control('', [Validators.required, Validators.email]),
    api_token: this.fb.control('', Validators.required),
    project_key: this.fb.control('', Validators.required),
  });

  username = toSignal(this.form.controls.username.valueChanges, {
    initialValue: this.form.controls.username.value,
  });
  apiToken = toSignal(this.form.controls.api_token.valueChanges, {
    initialValue: this.form.controls.api_token.value,
  });
  url = toSignal(this.form.controls.url.valueChanges, {
    initialValue: this.form.controls.url.value,
  });

  isEdit = input.required<boolean>();
  isViewMode = input.required<boolean>();
  agentsList = input.required<IAgent[]>();
  entityList = input.required<string[]>();
  data = input<Partial<IJiraForm>>({
    api_token: '',
    entity_type: null,
    index_name: '',
    onboarded_agent: '',
    project_key: '',
    url: '',
    username: '',
  });

  valid = model<boolean>(false);

  submit = output<IJiraForm>();

  projectList = computed<string[]>(
    () => this.projectListQuery.value()?.project_keys || [],
  );

  ngOnInit(): void {
    this.form.reset({ ...this.data() });
    this.form.statusChanges.pipe(startWith(this.form.status)).subscribe(() => {
      this.valid.set(this.form.valid);
    });
  }

  getAddedKnowledgeStoreForAgent(agentId?: string): string {
    return (
      this.agentsList().find((agent) => agent.agent_id === agentId)
        ?.knowledge_store?.name || ''
    );
  }

  projectListQuery = resource({
    params: () => {
      const username = this.username();
      const api_token = this.apiToken();
      const connector_url = this.url();

      if (!username || !api_token || !connector_url) return;

      return { api_token, connector_url, username };
    },
    loader: ({ params, abortSignal }) =>
      lastValueFrom(
        this.marketPlaceService
          .getJiraProjects(params, abortSignal)
          .pipe(catchError(() => of(null))),
      ),
  });

  onSubmit() {
    const val = this.form.getRawValue();

    if (!this.form.valid) return val;

    this.submit.emit(val);
    return val;
  }
}
