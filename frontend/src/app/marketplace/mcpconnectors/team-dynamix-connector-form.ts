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
import { SemarketplaceService } from '../../services/semarketplace.service';
import { V } from '../../utils';
import { FormError } from '../../components/form-error/form-error';

export interface ITeamDynamixForm {
  index_name: string;
  entity_type: TEntity | null;
  onboarded_agent: string;
  url: string;
  username: string;
  password: string;
  app_id: string;
}
@Component({
  selector: 'team-dynamix-connector-form',
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
            >Password<span class="text-danger">*</span></label
          >
          <input
            type="password"
            class="form-control fs-14"
            [class.is-invalid]="
              form.get('password')?.invalid && form.get('password')?.touched
            "
            formControlName="password"
            placeholder="Enter password"
            [disabled]="isViewMode()"
          />
          <div
            class="invalid-feedback d-block"
            *ngIf="
              form.get('password')?.invalid && form.get('password')?.touched
            "
          >
            Api Token is required
          </div>
        </div>

        <div class="mb-3">
          <label
            class="form-label fw-bold fs-14"
            appTooltip="Select the Sheet Name from the file uploaded"
            >Application <span class="text-danger">*</span></label
          >
          <select
            class="form-control form-select fs-14"
            [disabled]="applicationListQuery.isLoading()"
            [class.is-invalid]="
              form.get('app_id')?.invalid && form.get('app_id')?.touched
            "
            formControlName="app_id"
          >
            <option value="">
              @if (applicationListQuery.isLoading()) {
                Loading...
              } @else {
                Select Application
              }
            </option>
            <option *ngFor="let app of applicationList()" [value]="app">
              {{ app }}
            </option>
          </select>
          <div
            class="invalid-feedback d-block"
            *ngIf="form.get('app_id')?.invalid && form.get('app_id')?.touched"
          >
            Application is required
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
export class TeamDynamixForm implements OnInit {
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

  form = this.fb.group<FormModel<ITeamDynamixForm>>({
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
    password: this.fb.control('', Validators.required),
    app_id: this.fb.control('', Validators.required),
  });

  username = toSignal(this.form.controls.username.valueChanges, {
    initialValue: this.form.controls.username.value,
  });
  password = toSignal(this.form.controls.password.valueChanges, {
    initialValue: this.form.controls.password.value,
  });
  url = toSignal(this.form.controls.url.valueChanges, {
    initialValue: this.form.controls.url.value,
  });

  isEdit = input.required<boolean>();
  isViewMode = input.required<boolean>();
  agentsList = input.required<IAgent[]>();
  entityList = input.required<string[]>();
  data = input<Partial<ITeamDynamixForm>>({
    password: '',
    entity_type: null,
    index_name: '',
    onboarded_agent: '',
    app_id: '',
    url: '',
    username: '',
  });

  valid = model<boolean>(false);

  submit = output<ITeamDynamixForm>();

  applicationList = computed<string[]>(
    () => this.applicationListQuery.value()?.app_ids || [],
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

  applicationListQuery = resource({
    params: () => {
      const username = this.username();
      const password = this.password();
      const connector_url = this.url();

      if (!username || !password || !connector_url) return;

      return { password, connector_url, username };
    },
    loader: ({ params, abortSignal }) =>
      lastValueFrom(
        this.marketPlaceService
          .getTeamDynamixApplications(params, abortSignal)
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
