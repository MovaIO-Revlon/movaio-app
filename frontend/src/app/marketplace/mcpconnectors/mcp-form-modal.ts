import {
  Component,
  computed,
  ElementRef,
  inject,
  model,
  output,
  resource,
  signal,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ConnectorStep } from './connector-step';
import { ExcelConnectorForm, IExcelForm, IFile } from './excel-connector-form';
import { IJiraForm, JiraConnectorForm } from './jira-connector-form';
import { SemarketplaceService } from '../../services/semarketplace.service';
import { lastValueFrom, Observable } from 'rxjs';
import {
  ApiResponse,
  IAgent,
  ISchemaForAgent,
  ISearchIndex,
  IUseCase,
  TConnectorType,
  TUseCaseType,
} from '../../types';
import { ColumnMapper, IColumn } from './column-mapper';
import {
  ENTITY_DEFAULT_FIELDS,
  INSIGHT_STATIC_USE_CASES,
  TRENDS_STATIC_USE_CASES,
} from './constants';
import { ToastService } from '../../services/toast.service';
import { NgxSpinnerService } from 'ngx-spinner';
import {
  ITeamDynamixForm,
  TeamDynamixForm,
} from './team-dynamix-connector-form';
import { ConnectorOverView } from './connector-overview';
import { UseCaseMapper } from './usecase-mapper';
import { WidgetBuilderComponent } from './widget-builder/widget-builder';
import { WidgetConfig } from '../../types/widget.types';
import {
  FilterStore,
  PAGE_NAME,
} from '../../commandcenter/trends/filter.store';

export type TStepperData = IJiraForm &
  IExcelForm &
  ITeamDynamixForm & {
    columns: IColumn[];
    useCases: Record<TUseCaseType, IUseCase[]>;
    visualization: Record<TUseCaseType, Record<string, Partial<WidgetConfig>>>;
  };
type TStepperPlainData = IJiraForm &
  Omit<IExcelForm, 'files' | 'sheetsList'> &
  ITeamDynamixForm;

enum CONNECTOR_STEPS {
  CONNECTOR_OVERVIEW = 'Connector Overview',
  SELECT_CONNECTOR = 'Select Connector',
  SOURCE_SETUP = 'Source Setup',
  FIELD_MAPPING = 'Field Mapping',
  USE_CASE_CONFIGURATION = 'Use Case Configuration',
  VISUALIZATION_CONFIGURATION = 'Visualization Configuration',
}

const INITIAL_STEPS: CONNECTOR_STEPS[] = Object.values(CONNECTOR_STEPS).filter(
  (item) => item !== CONNECTOR_STEPS.CONNECTOR_OVERVIEW,
);
declare var $: any;

const defaultData: TStepperData = {
  entity_type: null,
  index_name: '',
  onboarded_agent: '',

  columns: [],
  useCases: {
    insights: [],
    trends: [],
  },
  visualization: {
    insights: {},
    trends: {},
  },
  //excel
  sheet_name: '',
  files: [],
  //jira
  api_token: '',
  url: '',
  username: '',
  project_key: '',
  // team dynamix
  password: '',
  app_id: '',
};
@Component({
  selector: 'mcp-form-modal',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ConnectorStep,
    ExcelConnectorForm,
    JiraConnectorForm,
    FormsModule,
    ColumnMapper,
    TeamDynamixForm,
    ConnectorOverView,
    UseCaseMapper,
    WidgetBuilderComponent,
  ],
  providers: [{ provide: PAGE_NAME, useValue: 'insights' }, FilterStore],
  template: `
    <div
      class="modal fade"
      data-bs-backdrop="static"
      data-bs-keyboard="false"
      id="onboardMCPConnector"
      #modal
      tabindex="-1"
      aria-labelledby="onboardMCPConnectorLabel"
      aria-hidden="true"
    >
      <div class="modal-dialog modal-xl">
        <div class="modal-content">
          <div class="modal-header">
            <h1
              class="modal-title fw-semibold fs-14"
              id="onboardMCPConnectorLabel"
            >
              {{ isEdit() ? 'Edit' : 'Add' }} MCP Server
            </h1>
            <button
              type="button"
              class="btn-close"
              aria-label="Close"
              (click)="closeModal(false)"
            ></button>
          </div>

          @let currentStep = activeStep();
          @let index = steps().indexOf(currentStep);
          @let stepsLength = steps().length;
          @let isEditMode = isEdit();

          <div class="modal-body">
            <div
              class="stepper d-flex justify-content-center align-items-center gap-2 py-3"
            >
              @for (step of steps(); track step) {
                <div
                  class="step d-flex"
                  [class.active]="step === currentStep || $index < index"
                >
                  <span class="step-count">
                    @if ($index < index) {
                      <i class="fa-solid fa-check"></i>
                    } @else {
                      {{ $index + 1 }}
                    }
                  </span>
                  <span class="step-label">{{ step }}</span>
                </div>
                @if ($index < stepsLength - 1) {
                  <div class="spacer"></div>
                }
              }
            </div>

            @switch (currentStep) {
              @case (connectorSteps.CONNECTOR_OVERVIEW) {
                <connector-overview
                  class="border-top d-block pt-1"
                  [data]="searchIndex()"
                  (onDelete)="onDelete.emit(searchIndex()!)"
                />
              }
              @case (connectorSteps.SELECT_CONNECTOR) {
                <connector-step [(ngModel)]="connectorType" />
              }
              @case (connectorSteps.SOURCE_SETUP) {
                @switch (connectorType()) {
                  @case ('excel') {
                    <excel-connector-form
                      class="border-top d-block pt-1"
                      [isEdit]="isEditMode"
                      [(valid)]="isStepValid"
                      [isViewMode]="isViewMode()"
                      [agentsList]="agentsList()"
                      [entityList]="entityList()"
                      [data]="stepInitialData()"
                    />
                  }
                  @case ('jira') {
                    <jira-connector-form
                      class="border-top d-block pt-1"
                      [isEdit]="isEditMode"
                      [(valid)]="isStepValid"
                      [isViewMode]="isViewMode()"
                      [agentsList]="agentsList()"
                      [entityList]="entityList()"
                      [data]="stepInitialData()"
                    />
                  }
                  @case ('team_dynamix') {
                    <team-dynamix-connector-form
                      class="border-top d-block pt-1"
                      [isEdit]="isEditMode"
                      [(valid)]="isStepValid"
                      [isViewMode]="isViewMode()"
                      [agentsList]="agentsList()"
                      [entityList]="entityList()"
                      [data]="stepInitialData()"
                    />
                  }
                }
              }
              @case (connectorSteps.FIELD_MAPPING) {
                <column-mapper
                  [(valid)]="isStepValid"
                  [isViewMode]="isViewMode()"
                  [entity]="entity()"
                  [columnsList]="columnList()"
                  [data]="data().columns"
                />
              }
              @case (connectorSteps.USE_CASE_CONFIGURATION) {
                @let useCaseTab = selectedUseCaseTab();
                <ng-container
                  *ngTemplateOutlet="
                    pageTab;
                    context: {
                      $implicit: useCaseTab,
                    }
                  "
                >
                </ng-container>
                <usecase-mapper
                  [(valid)]="isStepValid"
                  [entity]="entity()"
                  [data]="data().useCases[useCaseTab]"
                  [indexId]="searchIndex()?.index_id || ''"
                  [useCaseTab]="useCaseTab"
                  [fullSchema]="fullSchema()"
                />
              }
              @case (connectorSteps.VISUALIZATION_CONFIGURATION) {
                @let useCaseTab = selectedUseCaseTab();
                <ng-container
                  *ngTemplateOutlet="
                    pageTab;
                    context: {
                      $implicit: useCaseTab,
                    }
                  "
                >
                </ng-container>
                <widget-builder
                  [(valid)]="isStepValid"
                  [cases]="data().useCases[useCaseTab]"
                  [useCaseConfig]="data().visualization[useCaseTab]"
                  [useCaseTab]="useCaseTab"
                />
              }
            }

            @if (error()) {
              <div class="text-danger text-center py-3">{{ error() }}</div>
            }
          </div>

          <div class="modal-footer">
            <button
              type="button"
              class="btn btn-secondary"
              (click)="prevStep()"
            >
              @if (index === 0) {
                Cancel
              } @else {
                Go Back
              }
            </button>
            <button
              type="button"
              class="btn btn-warning text-white px-3"
              (click)="nextStep()"
              [disabled]="
                !allowNext() || (!isPrivilegeEdit() && index === stepsLength)
              "
            >
              @if (index === steps().length - 1) {
                Submit
              } @else {
                Next
              }
            </button>
          </div>
        </div>
      </div>
    </div>

    <ng-template #pageTab let-tab>
      <ul class="nav nav-tabs mb-2">
        @for (item of ['insights', 'trends']; track item) {
          <li class="nav-item" (click)="changeUseCaseTab(item)">
            <span
              class="nav-link text-capitalize cursor-pointer"
              [class]="tab === item ? 'active text-warning' : 'text-muted'"
              >{{ item }} Usecases</span
            >
          </li>
        }
      </ul>
    </ng-template>
  `,
  styles: `
    .stepper .spacer {
      flex: 1;
      height: 1px;
      background: var(--color, #939795);
    }

    .stepper .step {
      --color: #939795;
      color: var(--color);
      display: flex;
      gap: 0.5rem;
      font-size: 0.875rem;
      font-weight: 400;
    }

    .step-count {
      --color: #939795;
      width: 1.3rem;
      height: 1.3rem;
      background: var(--color);
      color: #fff;
      display: grid;
      place-content: center;
      border-radius: 100%;
    }

    .stepper .step.active {
      --color: #000;
    }

    .stepper .step.active .step-count {
      --color: #ffa242;
    }
  `,
})
export class McpFormModal {
  @ViewChild('modal') modal!: ElementRef;

  @ViewChild(ExcelConnectorForm) excel!: ExcelConnectorForm;
  @ViewChild(JiraConnectorForm) jira!: JiraConnectorForm;
  @ViewChild(TeamDynamixForm) teamDynamix!: TeamDynamixForm;
  @ViewChild(ColumnMapper) columnMapping!: ColumnMapper;
  @ViewChild(UseCaseMapper) UseCaseMapper!: UseCaseMapper;
  @ViewChild(WidgetBuilderComponent) widgetBuilder!: WidgetBuilderComponent;

  private readonly service = inject(SemarketplaceService);
  private readonly toast = inject(ToastService);
  private readonly loading = inject(NgxSpinnerService);
  readonly connectorSteps = CONNECTOR_STEPS;

  private jiraFields: (keyof TStepperPlainData)[] = [
    'url',
    'username',
    'api_token',
    'project_key',
  ];
  private excelFields: (keyof TStepperPlainData)[] = ['sheet_name'];
  private teamDynamixFields: (keyof TStepperPlainData)[] = [
    'app_id',
    'password',
    'url',
    'username',
  ];
  private commonFields: (keyof TStepperPlainData)[] = [
    'index_name',
    'entity_type',
    'onboarded_agent',
  ];

  isStepValid = model<boolean>(false);
  onDelete = output<ISearchIndex>();
  steps = signal(INITIAL_STEPS);
  isEdit = signal<boolean>(false);
  entityList = signal<string[]>(['incident', 'defect', 'testcase']);
  agentsList = computed<IAgent[]>(
    () =>
      this.agentDetailsQuery
        .value()
        ?.data.filter((agent) => agent.agent_type_id === 'INSIGHT_AGENT') || [],
  );

  isPrivilegeEdit = signal(false);

  isViewMode = signal(false);
  activeStep = signal<CONNECTOR_STEPS>(CONNECTOR_STEPS.SELECT_CONNECTOR);
  connectorType = signal<TConnectorType>('excel');
  columnList = signal<string[]>([]);
  fullSchema = signal<ISchemaForAgent['full_schema']>([]);
  selectedUseCaseTab = signal<keyof TStepperData['useCases']>('insights');

  data = signal<TStepperData>({
    ...defaultData,
  });
  searchIndex = signal<ISearchIndex | undefined>(undefined);

  close = output<boolean>();

  error = signal('');

  stepInitialData = computed(() => {
    const {
      index_name,
      entity_type,
      onboarded_agent,
      api_token,
      project_key,
      url,
      username,
      files,
      sheet_name,
      sheetsList,
      app_id,
      password,
    } = this.data();
    const connectorType = this.connectorType();

    if (connectorType === 'excel') {
      return {
        index_name,
        entity_type,
        onboarded_agent,
        files,
        sheet_name,
        sheetsList,
      } satisfies IExcelForm;
    }

    if (connectorType === 'jira') {
      return {
        index_name,
        entity_type,
        onboarded_agent,
        api_token,
        project_key,
        url,
        username,
      } satisfies IJiraForm;
    }

    if (connectorType === 'team_dynamix') {
      return {
        index_name,
        entity_type,
        onboarded_agent,
        app_id,
        password,
        url,
        username,
      } satisfies ITeamDynamixForm;
    }

    return {};
  });

  agentDetailsQuery = resource({
    loader: ({}) => lastValueFrom(this.service.getAgentDetails()),
  });

  entity = computed(() => this.data().entity_type || 'incident');
  allowNext = computed(() => {
    const currentStep = this.activeStep();
    if (currentStep === this.connectorSteps.CONNECTOR_OVERVIEW) return true;
    if (currentStep === this.connectorSteps.SELECT_CONNECTOR)
      return !!this.connectorType();
    return this.isStepValid();
  });

  openModal(
    {
      columnsList,
      fullSchema,
      connector_type,
      isPrivilegeEdit,
      ...initialData
    }: Partial<
      TStepperData & {
        columnsList?: string[];
        fullSchema: ISchemaForAgent['full_schema'];
        connector_type?: TConnectorType;
        isPrivilegeEdit?: boolean;
      }
    >,
    searchIndex?: ISearchIndex,
  ) {
    this.isPrivilegeEdit.set(!!isPrivilegeEdit);
    this.isViewMode.set(!isPrivilegeEdit);

    if (initialData) {
      this.data.set({ ...defaultData, ...initialData });
      this.columnList.set(columnsList || []);
      this.fullSchema.set(fullSchema || []);
      this.connectorType.set(connector_type || 'excel');
    }

    this.searchIndex.set(searchIndex);
    this.isEdit.set(!!searchIndex);

    if (searchIndex) {
      this.steps.set(
        Object.values(CONNECTOR_STEPS).filter(
          (item) => item !== CONNECTOR_STEPS.SELECT_CONNECTOR,
        ),
      );
      this.activeStep.set(CONNECTOR_STEPS.CONNECTOR_OVERVIEW);
    }

    const el = this.modal.nativeElement;
    if (el) $(el).modal('show');
  }

  closeModal(refetch: boolean) {
    this.activeStep.set(CONNECTOR_STEPS.SELECT_CONNECTOR);
    this.isEdit.set(false);
    this.data.set({ ...defaultData });
    this.jira?.form?.reset();
    this.teamDynamix?.form?.reset();
    this.excel?.form?.reset();
    this.columnMapping?.form?.reset();
    this.loading.hide();
    const el = this.modal.nativeElement;
    if (el) $(el).modal('hide');
    this.steps.set(INITIAL_STEPS);
    this.close.emit(refetch);
    this.error.set('');
  }

  update(d: Partial<IExcelForm | IJiraForm | ITeamDynamixForm>) {
    this.data.update((v) => ({
      ...v,
      ...d,
      columns: v.entity_type !== d.entity_type ? [] : v.columns,
    }));
  }

  private updateFormData(connectorType: TConnectorType) {
    if (connectorType === 'excel') {
      const data = (this.excel?.onSubmit() || {}) as Partial<IExcelForm>;
      if (data.files?.length && !this.columnList().length) {
        this.fetchFileData(data.files, data.sheet_name || '');
      }
      ``;
      this.update(data);
    } else if (connectorType === 'jira') {
      this.columnList.set([]);
      this.fullSchema.set([]);
      const data = this.jira?.onSubmit() || {};
      this.update(data);
    } else if (connectorType === 'team_dynamix') {
      this.columnList.set([]);
      this.fullSchema.set([]);
      const data = this.teamDynamix?.onSubmit() || {};
      this.update(data);
    }
  }

  private updateColumnMappings() {
    const cType = this.connectorType();
    const columnMapping = this.columnMapping?.onSubmit() || {};
    this.data.update((v) => ({
      ...v,
      ...columnMapping,
    }));

    if (['jira', 'team_dynamix'].includes(cType)) {
      this.fetchFieldsSchema(this.data());
    }
  }

  private updateUseCases() {
    const useCases = this.UseCaseMapper?.onSubmit() || {};
    this.data.update((v) => ({
      ...v,
      useCases: {
        ...v.useCases,
        [this.selectedUseCaseTab()]:
          !useCases?.length && v?.entity_type
            ? Object.values(INSIGHT_STATIC_USE_CASES[v.entity_type])
            : useCases,
      },
    }));
  }

  private updateVisualization() {
    const visualization = this.widgetBuilder?.onSubmit() || {};
    this.data.update((v) => ({
      ...v,
      visualization: {
        ...v.visualization,
        [this.selectedUseCaseTab()]: visualization,
      },
    }));
  }

  nextStep() {
    const activeStep = this.activeStep();
    const steps = this.steps();

    if (activeStep === CONNECTOR_STEPS.SOURCE_SETUP) {
      const connectorType = this.connectorType();

      this.updateFormData(connectorType);

      this.data.update((v) => {
        const columns = v.columns || [];
        const columnsKeys = columns.map((c) => c.key);
        if (v.entity_type) {
          const missingColumns = ENTITY_DEFAULT_FIELDS[v.entity_type].filter(
            (item) => !columnsKeys.includes(item.key),
          );
          columns.push(
            ...missingColumns.map((item) => ({
              key: item.key,
              value: item.default || '',
            })),
          );
        }

        return {
          ...v,
          columns,
          useCases: {
            trends: v.useCases?.trends?.length
              ? v.useCases.trends
              : (v.entity_type &&
                  Object.values(TRENDS_STATIC_USE_CASES[v.entity_type])) ||
                [],
            insights: v.useCases?.insights?.length
              ? v.useCases.insights
              : (v.entity_type &&
                  Object.values(INSIGHT_STATIC_USE_CASES[v.entity_type])) ||
                [],
          },
        };
      });
    } else if (activeStep === CONNECTOR_STEPS.FIELD_MAPPING) {
      this.updateColumnMappings();
    } else if (activeStep === CONNECTOR_STEPS.USE_CASE_CONFIGURATION) {
      this.updateUseCases();
    } else if (activeStep === CONNECTOR_STEPS.VISUALIZATION_CONFIGURATION) {
      this.updateVisualization();
    }

    if (activeStep === steps[steps.length - 1]) {
      return this.submitForm();
    }

    this.activeStep.update(
      (v) => steps[Math.min(steps.length, steps.indexOf(v) + 1)],
    );
  }

  prevStep() {
    const activeStep = this.activeStep();
    const connectorType = this.connectorType();
    const steps = this.steps();

    if (activeStep === steps[0]) return this.closeModal(false);
    else if (activeStep === CONNECTOR_STEPS.SOURCE_SETUP) {
      this.updateFormData(connectorType);
    } else if (activeStep === CONNECTOR_STEPS.FIELD_MAPPING) {
      this.updateColumnMappings();
    } else if (activeStep === CONNECTOR_STEPS.USE_CASE_CONFIGURATION) {
      this.updateUseCases();
    } else if (activeStep === CONNECTOR_STEPS.VISUALIZATION_CONFIGURATION) {
      this.updateVisualization();
    }

    this.activeStep.update((v) => steps[Math.max(0, steps.indexOf(v) - 1)]);
  }

  changeUseCaseTab(item: string) {
    const activeStep = this.activeStep();
    if (activeStep === this.connectorSteps.USE_CASE_CONFIGURATION) {
      this.updateUseCases();
    } else if (activeStep === this.connectorSteps.VISUALIZATION_CONFIGURATION) {
      this.updateVisualization();
    }
    this.selectedUseCaseTab.set(item as TUseCaseType);
  }

  fetchFileData(files: IFile[], sheet_name: string): void {
    if (!files.length) return;

    const filteredFiles = files.filter((item) => !!item.file);
    if (!filteredFiles.length) return;

    const formData = new FormData();
    filteredFiles.forEach((file) => {
      formData.append('file', file.file);
    });
    formData.append('sheet_name', sheet_name || '');

    this.loading.show();

    this.service.getColumnsForExcelUpload(formData).subscribe({
      next: (response) => {
        if (response) {
          this.columnList.set(response.columns || []);
          this.fullSchema.set(response.schema_for_agent?.full_schema || []);
        } else {
          this.error.set('Failed to fetch columns from the file.');
        }

        this.loading.hide();
      },
      error: (err: any) => {
        this.loading.hide();
        this.error.set('Failed to fetch columns from the file.');
      },
    });
  }

  fetchFieldsSchema(data: Partial<IJiraForm | ITeamDynamixForm>): void {
    const connectorType = this.connectorType();
    let observable: Observable<ApiResponse<unknown>> | null = null;

    if (connectorType === 'jira') {
      const { api_token, project_key, url, username } = data as IJiraForm;
      if (!api_token || !project_key || !url || !username) return;
      observable = this.service.getJiraFieldsSchema({
        tool: 'jira',
        project_key,
        api_token,
        username,
        connector_url: url,
      });
    } else if (connectorType === 'excel') {
      const { app_id, url, username, password } = data as ITeamDynamixForm;
      if (!app_id || !url || !username || !password) return;
      observable = this.service.getJiraFieldsSchema({
        tool: 'teamdynamics',
        app_id,
        password,
        username,
        connector_url: url,
      });
    }

    this.loading.show();

    observable?.subscribe({
      next: (response) => {
        if (response?.data) {
          this.fullSchema.set(response.data);
        } else {
          this.error.set('Failed to fetch fields schema.');
        }

        this.loading.hide();
      },
      error: (err) => {
        this.loading.hide();
        this.error.set(err?.error?.error || 'Failed to fetch fields schema.');
      },
    });
  }

  submitForm(): void {
    this.error.set('');

    const connectorType = this.connectorType();
    const { files, columns, useCases, visualization, ...rest } = this.data();

    let formData = new FormData();

    if (connectorType === 'excel' && files.length) {
      files.forEach((file) => {
        if (file.file) {
          formData.append('file', file.file);
        }
      });
    }

    formData.append('connector_type', connectorType);
    formData.append(
      'onboarded_agent_name',
      this.agentsList().find((agent) => agent.agent_id === rest.onboarded_agent)
        ?.name || '',
    );

    [
      ...this.commonFields,
      ...this.excelFields,
      ...this.jiraFields,
      ...this.teamDynamixFields,
    ].forEach((item) => {
      formData.append(item, rest[item] || '');
    });

    columns.forEach((item) => {
      formData.append(item.key, item.value);
    });
    formData.append('full_schema', JSON.stringify(this.fullSchema()));
    const insightUsecase = useCases.insights.map((item) => ({
      raw_config: item.source === 'static' ? '' : item.json,
      usecase_name: item.description,
      source: item.source,
    }));
    const trendsUsecase = useCases.trends.map((item) => ({
      raw_config: item.source === 'static' ? '' : item.json,
      usecase_name: item.description,
      source: item.source,
    }));

    formData.append('usecase', JSON.stringify(insightUsecase));
    formData.append('visualization', JSON.stringify(visualization.insights));
    formData.append('trend_usecases', JSON.stringify(trendsUsecase));
    formData.append(
      'trends_visualization',
      JSON.stringify(visualization.trends),
    );

    this.loading.show();
    this.service.ingestandUpdateDocMcp(formData).subscribe({
      next: () => {
        this.toast.showToast(
          'success',
          `MCP Connector ${this.isEdit() ? 'updated' : 'onboarded'} successfully!`,
        );

        this.closeModal(true);
      },
      error: (error: any) => {
        this.error.set('Failed to submit the form. Please try again.');
        this.loading.hide();
      },
    });
  }
}
