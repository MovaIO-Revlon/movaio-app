import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  effect,
  input,
  output,
} from '@angular/core';
import {
  IAgentFormData,
  IApiFormData,
  IConditionFormData,
  IIterativeFormData,
  IReferenceData,
  TWorkflowFormData,
  IAgent,
} from '../../types';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { NgxSpinnerService } from 'ngx-spinner';
import { SemarketplaceService } from '../../services/semarketplace.service';
import { FormError } from '../../components/form-error/form-error';
import { HtmlTemplateDynamicNode } from 'ngx-vflow';
import { Select } from '../../components/select/select';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';

@Component({
  selector: 'app-workflow-element-form',
  imports: [ReactiveFormsModule, CommonModule, FormError, Select],
  templateUrl: './workflow-element-form.html',
  styleUrl: './workflow-element-form.css',
})
export class WorkflowElementForm {
  nodeId = input<string | undefined>();
  type = input<IReferenceData['type']>('api');
  isSubmitted = input<boolean | null>(null);
  connectedAgent = input<HtmlTemplateDynamicNode | null>(null);
  formState = input<{
    [key: string]: TWorkflowFormData;
  }>({});
  onSave = output<TWorkflowFormData>();
  onClose = output();
  onDelete = output<string>();
  onConfigMapping = output<string>();

  httpMethodOptions = ['get', 'post', 'put', 'patch', 'delete'];

  agentOptions: { label: string; value: string }[] = [];
  agentsData: IAgent[] = [];

  form: FormGroup = new FormGroup({});

  constructor(
    private fb: FormBuilder,
    private _stateService: AIInfuseStateService,
    private _loadingService: NgxSpinnerService,
    private _semarketPlaceService: SemarketplaceService,
    private cdr: ChangeDetectorRef
  ) {
    effect(() => {
      if (this.type() === 'agent') {
        this.form = this.fb.group({
          agent: this.fb.control('', {
            nonNullable: true,
            validators: Validators.required,
          }),
          input: this.fb.control('', {
            nonNullable: true,
            validators: Validators.required,
          }),
        });
      } else if (this.type() === 'iterative') {
        this.form = this.fb.group({
          loop_condition: this.fb.control('', {
            nonNullable: true,
            validators: Validators.required,
          }),
        });
      } else if (this.type() === 'api') {
        this.form = this.fb.group({
          api_url: this.fb.control('', {
            nonNullable: true,
            validators: Validators.required,
          }),
          http_method: this.fb.control('', {
            nonNullable: true,
            validators: Validators.required,
          }),
          // headers: {},
          // query: {},
        });
      } else if (this.type() === 'condition') {
        this.form = this.fb.group({
          condition: this.fb.control('', {
            nonNullable: true,
            validators: Validators.required,
          }),
        });
      }

      if (this.IsBaseWorkflow()) {
        this.form.disable();
      } else {
        this.form.enable();
      }

      this.initForm();
    });
  }

  ngOnInit() {
    this.fetchAgents();
    this.initForm();
  }

  ngAfterViewInit(): void {
    this._loadingService.hide();
  }

  IsBaseWorkflow(): boolean {
    return this._stateService.GetIsBaseWorkflow();
  }

  onSubmit() {
    const nid = this.nodeId();

    if (this.form.invalid || !nid) return;

    if (this.type() === 'agent') {
      this.onSave.emit({
        id: nid,
        type: this.type(),
        agent: this.form.value.agent || '',
        input: this.form.value.input || '',
        agentDetails: this.agentsData.find(
          (item) =>
            (item as { agent_id: string }).agent_id === this.form.value.agent
        ),
      } satisfies IAgentFormData);
    }

    if (this.type() === 'iterative') {
      this.onSave.emit({
        id: nid,
        type: this.type(),
        loop_condition: this.form.value.loop_condition || '',
      } satisfies IIterativeFormData);
    }

    if (this.type() === 'api') {
      this.onSave.emit({
        id: nid,
        type: this.type(),
        api_url: this.form.value.api_url || '',
        http_method: this.form.value.http_method || '',
      } satisfies IApiFormData);
    }

    if (this.type() === 'condition') {
      this.onSave.emit({
        id: nid,
        type: this.type(),
        condition: this.form.value.condition || '',
        true_cond_ids:
          (this.formState()[nid] as IConditionFormData)?.true_cond_ids || [],
        false_cond_ids:
          (this.formState()[nid] as IConditionFormData)?.false_cond_ids || [],
      } satisfies IConditionFormData);
    }
  }

  handleClose() {
    this.onClose.emit();
  }

  deleteNode() {
    const nid = this.nodeId();
    if (nid) this.onDelete.emit(nid);
  }

  configureMapping(e: MouseEvent) {
    e.stopPropagation();

    const nodeId = this.connectedAgent()?.id;
    if (!nodeId) return;

    this.onConfigMapping.emit(nodeId);
  }

  fetchAgents() {
    this._loadingService.show();
    this._semarketPlaceService.getAgentDetails().subscribe({
      next: (res) => {
        const items: typeof this.agentOptions = [];
        res.data.forEach((item) => {
          if (item.agent_type_name === 'Task Agent') {
            items.push({
              label: item.name,
              value: item.agent_id,
            });
            this.agentsData.push(item);
          }
        });
        this.agentOptions = items.sort((a, b) =>
          a.label.localeCompare(b.label)
        );
        this.cdr.detectChanges();
        this._loadingService.hide();
      },
      error: (err) => {
        console.error('Error: ----->', err);
        this._loadingService.hide();
      },
    });
  }

  initForm() {
    const nid = this.nodeId();

    if (!nid) return;

    const fs = this.formState()[nid];
    this.form.patchValue({
      agent: (fs as IAgentFormData)?.agent,
      input: (fs as IAgentFormData)?.input,

      loop_condition: (fs as IIterativeFormData)?.loop_condition,

      api_url: (fs as IApiFormData)?.api_url,
      http_method: (fs as IApiFormData)?.http_method,

      condition: (fs as IConditionFormData)?.condition,
    });
  }
}
