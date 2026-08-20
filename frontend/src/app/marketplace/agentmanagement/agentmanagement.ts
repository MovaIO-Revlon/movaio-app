import {
  Component,
  OnInit,
  AfterViewInit,
  ViewChild,
  ElementRef,
  computed,
  signal,
} from '@angular/core';
import { NgxSpinnerService } from 'ngx-spinner';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import Chart from 'chart.js/auto';
import { Header } from '../../header/header';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  FormArray,
  AbstractControl,
  Validators,
  ValidatorFn,
  ValidationErrors,
} from '@angular/forms';
import { ChangeDetectorRef } from '@angular/core';
import { SemarketplaceService } from '../../services/semarketplace.service';
import { Chatbot } from '../../chatbot/chatbot';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { HomeService } from '../../services/home.service';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { RolePrivilegeMappingService } from '../../services/role-privilege-mapping.service';
import { finalize } from 'rxjs/operators';
import { environment as config } from '../../../environments/environment';
import { getApiError, V } from '../../utils';
import { MultiSelect } from '../../components/multi-select/multi-select';
import { Select, TOption } from '../../components/select/select';
import { rxResource } from '@angular/core/rxjs-interop';
import { IAgent } from '../../types';
import { FormError } from '../../components/form-error/form-error';

declare var $: any;
declare var bootstrap: any;
type Frequency = 'daily' | 'weekly' | 'monthly';

@Component({
  selector: 'app-agentmanagement',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, TooltipDirective, MultiSelect, Select, FormError],
  templateUrl: './agentmanagement.html',
  styleUrl: './agentmanagement.css',
})
export class Agentmanagement implements AfterViewInit, OnInit {
  constructor(
    private _loadingService: NgxSpinnerService,
    private _router: Router,
    private _marketService: SemarketplaceService,
    private fb: FormBuilder,
    private cdRef: ChangeDetectorRef,
    private _homeService: HomeService,
    private http: HttpClient,
    private _stateService: AIInfuseStateService,
    private _rolePrivilegeService: RolePrivilegeMappingService
  ) {}

  @ViewChild('onboardagent') onboardAgentModal!: ElementRef;
  @ViewChild('createAgentModal') createAgentModal!: ElementRef;
  @ViewChild('editAgentModal') editAgentModal!: ElementRef;
  @ViewChild('donutCanvas') donutCanvas!: ElementRef;
  @ViewChild('filt') filterModalRef!: ElementRef;
  @ViewChild('agentTypeCanvas', { static: false }) agentTypeCanvas!: ElementRef;
  @ViewChild('agencyCanvas') agencyCanvas!: ElementRef;

  agents: any[] = [];
  agenciesWithAgents: any[] = [];
  agentForm!: FormGroup;
  createAgentForm!: FormGroup;
  filterForm!: FormGroup;
  deleteAgentForm!: FormGroup;
  kgConfigForm!: FormGroup;
  toolsConfigForm!: FormGroup;
  dataQueryConfigForm!: FormGroup;
  memoryConfigForm!: FormGroup;
  contextConfigForm!: FormGroup;
  promptBuilderForm!: FormGroup;
  selectedAgentId: string = '';
  selectedAgent: any = null;
  selectedObjectId: string = '';
  totalItems = 24;
  itemsPerPage = 6;
  currentPage = 1;
  pageSizeOptions = [6, 12, 24];
  allAgents: any[] = [];
  filteredAgents: any[] = [];
  paginatedAgents: any[] = [];
  toastMessage: string = '';
  roleChart: any;
  roleLegendData: { label: string; count: number; color: string }[] = [];
  aiCapabilityData: { label: string; value: number; width: string }[] = [];
  rolesList: any[] = [];
  totalRoleList = [];
  activeRoleList = [];
  trendingRoleList = [];
  modelsList: any[] = [];
  totalmodelsList: any[] = [];
  activemodelsList = [];
  trendingmodelsList = [];
  mcpConnectors: any[] = [];
  totalmcpConnectors: any[] = [];
  trendingmcpConnectors: any[] = [];
  activemcpConnectors: any[] = [];
  knowledgeStores: any[] = [];
  totalknowledgeStores: any[] = [];
  trendingknowledgeStores: any[] = [];
  activeknowledgeStores: any[] = [];
  agentTypes: any[] = [];
  agentProvidersList: any[] = [];
  isEditingRole: boolean = false;
  searchTerm: string = '';
  roles: any[] = [];
  currentTabAgents: any[] = [];
  agentRatings: { [key: string]: number } = {};
  trendingCount: number = 0;
  isEditingName = false;
  formSubmitted = false;
  originalAgentName: string = '';
  filteredAgentsMap: { [key: string]: any[] } = {
    total_agents: [],
    active_agents: [],
    trending_agents: [],
  };
  aiFoundations: any[] = [];
  ai_foundation: { label: string; value: string }[] = [];
  selectedAIFoundations: string[] = [];
  activeTabKey: string = 'total_agents';
  tabFilterValues: { [key: string]: any } = {
    total_agents: null,
    active_agents: null,
    trending_agents: null,
  };

  searchResultsMap: { [key: string]: any[] } = {
    total_agents: [],
    active_agents: [],
    trending_agents: [],
  };
  tabSearchTerms: { [key: string]: string } = {
    total_agents: '',
    active_agents: '',
    trending_agents: '',
  };

  agentCountsList = [
    { label: 'Total Agents', key: 'total_agents', count: 0, active: true },
    {
      label: 'Trending Agents',
      key: 'trending_agents',
      count: 0,
      active: false,
    },
    { label: 'Active Agents', key: 'active_agents', count: 0, active: false },
  ];
  agentTypesList: { value: string; label: string }[] = [];
  agentTypeChart: Chart | null = null;
  agentTypeData: { label: string; count: number; color: string }[] = [];
  avatarUploading: boolean = false;
  agentToDelete: any = null;
  deleteModal: any;
  configureKGModal: any;
  configureToolsModal: any;
  promptBuilderModal: any;
  versionHistoryModal: any;
  fileError: string | null = null;
  showDailyTime = false;
  showWeeklyTime = false;
  showMonthlyTime = false;
  selectedDays: number[] = [];
  selectedDates: string[] = [];
  days = [
    { label: 'Mon', value: 1 },
    { label: 'Tue', value: 2 },
    { label: 'Wed', value: 3 },
    { label: 'Thu', value: 4 },
    { label: 'Fri', value: 5 },
    { label: 'Sat', value: 6 },
    { label: 'Sun', value: 0 },
  ];
  showDefaultTime: any;
  minDate: Date = new Date();
  isavatarvalid: boolean = false;
  isEditMode: boolean = false;
  currentStep: number = 1;
  currentCreateAgentStep: number = 1;
  totalSteps: number = 3;
  hasDailySchedule = false;
  hasWeeklySchedule = false;
  hasMonthlySchedule = false;
  newActionForm!: FormGroup;
  totalPercentage = 0;
  scheduleFrequency: string[] = [];
  schedulerTime: {
    daily?: { time: string };
    weekly?: { days: number[]; time: string };
    monthly?: { dates: string[]; time: string };
  } = {};
  schedules: Array<{
    frequency: Frequency;
    time: string;
    days: number[];
    dates: string[];
  }> = [];
  agentTypeSubscription: Subscription | null = null;
  isSideCollapsed = false;
  isRightCollapsed = false;
  showSensitive = false;
  loggedUser: any;
  role: any;
  isPrivilegeView: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeRefresh: boolean = false;
  isPrivilegeExecute: boolean = false;
  isload = false;
  selectedKnowledgeStore: { value: string; label: string }[] = [];
  masterDatabase = config.masterDatabase;
  agencyLegendData: any[] = [];
  agencyChart: Chart | null = null;
  agenciesList: any[] = [];
  agentAgencyMap: { [agentId: string]: string } = {};
  kgsFromLyzr: any = [];
  configuredKGDetails: { name: string; chunks: number; type: string , data: any} | null = null;
  configuredAgenticRAGs: any[] = [];
  newAgenticRAGForm!: FormGroup;
  configuredToolDetails: { name: string , data: any} | null = null;
  configuredDataQueryDetails: { model: string; maxTries: number; timeLimit: number , data: any} | null = null;
  configuredMemoryDetails: { provider: string; crossSession: boolean; extractionInstructions: string; data: any } | null = null;
  configuredContextDetails: { id: string; name: string; data: any} | null = null;
  toolsFromLyzr: any = [];
  providerModelsFromLyzr: any = [];
  semanticDataModels: any = [];
  providerMemoryFromLyzr: any = [];
  mcpConnectorsFromLyzr: any = [];
  contextsFromLyzr: any = [];
  promptBuilderMessages: { type: string; content: string ; json_response?: any}[] = [];
  promptBuilderContext: string = '';
  promptBuilderDescription: string = '';
  isPromptLoading: boolean = false;
  promptBuilderSessionId: string = this.generateObjectId();
  isExternalNewAgentVar: boolean = false;
  approverEmails : any[] = []
  approvalState : any ={}
  versionHistory: any[] = [];

  navigateToAgencyManagement(): void {
    this._router.navigate(['/qemarketplace/agencymanagement']);
  }

  ngOnInit(): void {
    this.loggedUser = this._stateService.getLoginDetails();
    console.log('Logged User Details:', this.loggedUser);
    this.fetchAgenciesWithAgents();
    this.initAgentForm();
    this.initCreateAgentForm();
    this.filterForm = this.fb.group({
      agent_id: [''],
      user_id: [''],
      role_id: [''],
      mcp_connector_id: [''],
      knowledge_store_id: [''],
      model: [''],
      foundation: [''],
      agent_type_id: [''],
      agent_type_name: [''],
    });
    this.deleteAgentForm = this.fb.group({
      approverEmail: ['', [Validators.required, Validators.email]],
      reason: ['', [Validators.required, Validators.maxLength(500)]],
    });

    // Initialize KG Configuration Form
    this.kgConfigForm = this.fb.group({
      kgType: ['RAG', Validators.required],
      knowledgeBaseId: ['', Validators.required],
      numberOfChunks: [5, [Validators.required, Validators.min(1)]],
      retrievalType: ['Basic', Validators.required],
      scoreThreshold: [0.0, [Validators.required]],
    });

    // Initialize Agentic RAG Form for adding multiple RAGs
    this.newAgenticRAGForm = this.fb.group({
      knowledgeBaseId: ['', Validators.required],
      numberOfChunks: [5, [Validators.required, Validators.min(1)]],
      retrievalType: ['Basic', Validators.required],
      scoreThreshold: [0.0, [Validators.required]],
    });

    // Initialize Tools Configuration Form
    this.toolsConfigForm = this.fb.group({
      toolId: ['', Validators.required],
      toolEnabled: [true],
    });

    // Initialize Data Query Configuration Form
    this.dataQueryConfigForm = this.fb.group({
      semanticDataModelId: ['', Validators.required],
      maxTries: [3, [Validators.required, Validators.min(1), Validators.max(10)]],
      generationTimeLimit: [60, [Validators.required, Validators.min(1)]],
      autoTrain: [false],
    });

    // Initialize Memory Configuration Form
    this.memoryConfigForm = this.fb.group({
      memoryProvider: ['', Validators.required],
      crossSession: [false],
      extractionInstructions: ['', [Validators.maxLength(2000)]],
    });

    // Initialize Context Configuration Form
    this.contextConfigForm = this.fb.group({
      context_id: ['', Validators.required],
    });

    // Initialize Prompt Builder Form
    this.promptBuilderForm = this.fb.group({
      userQuery: [''],
    });

    this.agentForm
      .get('knowledge_store_enabled')
      ?.valueChanges.subscribe((enabled) => {
        if (!enabled) {
          this.agentForm
            .get('knowledge_store_id')
            ?.setValue('', { emitEvent: false });
        }
        this.cdRef.detectChanges();
      });

    this.agentForm
      .get('ai_foundation_enabled')
      ?.valueChanges.subscribe((enabled) => {
        if (!enabled) {
          // Clear selected AI foundations array
          this.selectedAIFoundations = [];

          // Clear the FormArray
          const aiFoundationControl = this.agentForm.get(
            'ai_foundation'
          ) as FormArray;
          aiFoundationControl.clear();

          // Optional: reset dropdown label
          this.cdRef.detectChanges();
        }
      });

    // Agent owner change handling
    this.agentForm.get('agent_owner')?.valueChanges.subscribe((owner) => {
      const isExternal = owner?.trim().toLowerCase() === 'external';
      const fieldsToToggle = [
        'prompt_template',
        'prompt_template',
        'mcp_connector_enabled',
        'mcp_connector_value',
        'knowledge_store_value',
        'foundation_resp_ai_toggle',
        'foundation_resp_ai_value',
        'foundation_ethic_ai_toggle',
        'foundation_ethic_ai_value',
        'foundation_guardrails_ai_toggle',
        'foundation_guardrails_ai_value',
      ];
      fieldsToToggle.forEach((field) => {
        if (field === 'prompt_template') return;
        const control = this.agentForm.get(field);
        if (!control) return;
        if (isExternal && control.enabled) {
          control.disable({ emitEvent: false });
        } else if (!isExternal && control.disabled) {
          control.enable({ emitEvent: false });
        }
      });
      if (this.isEditMode) {
        this.agentForm.get('prompt_template')?.disable({ emitEvent: false });
        this.agentForm.get('agent_owner')?.disable({ emitEvent: false });
        this.agentForm.get('agent_provider_type')?.disable({ emitEvent: false });
      }
    });
    // Schedule frequency change handling
    this.agentForm.get('scheduleFrequency')?.valueChanges.subscribe((freq) => {
      const schedulerControl = this.agentForm.get('schedulerTime');
      const daysControl = this.agentForm.get('selectedDays');
      const datesControl = this.agentForm.get('selectedDates');
      // Clear all validators first
      schedulerControl?.clearValidators();
      daysControl?.clearValidators();
      datesControl?.clearValidators();
      // Apply validators based on frequency
      if (freq) {
        schedulerControl?.setValidators([Validators.required]);
        if (freq === 'weekly') {
          daysControl?.setValidators([
            Validators.required,
            this.minSelectedCheckboxes(1),
          ]);
        } else if (freq === 'monthly') {
          datesControl?.setValidators([
            Validators.required,
            this.minSelectedDates(1),
          ]);
        }
      }
      // Update validity
      schedulerControl?.updateValueAndValidity({ emitEvent: false });
      daysControl?.updateValueAndValidity({ emitEvent: false });
      datesControl?.updateValueAndValidity({ emitEvent: false });
      // Update UI flags
      this.showDailyTime = freq === 'daily' && !this.hasDailySchedule;
      this.showWeeklyTime = freq === 'weekly' && !this.hasWeeklySchedule;
      this.showMonthlyTime = freq === 'monthly' && !this.hasMonthlySchedule;
      this.showDefaultTime = !freq;
      // Subscribe to agent_type_id changes to update totalSteps
      this.agentForm.get('agent_type_id')?.valueChanges.subscribe(() => {
        this.totalSteps = this.isTaskAgent() ? 3 : 2;
        // If currentStep exceeds totalSteps, adjust it
        if (this.currentStep > this.totalSteps) {
          this.currentStep = this.totalSteps;
        }
        this.cdRef.detectChanges();
      });
      // Reset fields if frequency changes
      this.selectedDays = [];
      this.selectedDates = [];
      daysControl?.setValue([]);
      datesControl?.setValue([]);
      schedulerControl?.setValue('');
      this.cdRef.detectChanges();
    });
    this.loadAgents();
    this.loadDropdowns();
    this.loadDropdownsForLyzrAgentCreation();
    this.getAgentCounts();
    this.newActionForm = this.fb.group(
      {
        name: ['', Validators.required],
        percentage: ['', [Validators.min(0), Validators.max(100)]],
      },
      { validators: this.requireBothIfOneFilled }
    );

    this.loadPrivileges();
    // Subscribe to privilege updates
    // this._rolePrivilegeService.privilegeData$.subscribe((allPrivileges) => {
    //   this.rolePrivilegMapping(allPrivileges);
    // });
  }
  loadPrivileges() {
    this._stateService.getPrivilegesByPage('Agent Management').subscribe({
      next: (loaded_privileges:any) => {
        //console.log('Loaded privileges for Chatbot by page: ', loaded_privileges);
        if (loaded_privileges) {
          this.isPrivilegeView = loaded_privileges?.view || false;
          this.isPrivilegeEdit = loaded_privileges?.['insert / edit'] || loaded_privileges?.edit || false;
          this.isPrivilegeDelete = loaded_privileges?.delete || false;
          this.isPrivilegeRefresh = loaded_privileges?.refresh || false;
          this.isPrivilegeExecute = loaded_privileges?.execute || false;
          this.cdRef.detectChanges();
        }
      }
    });
    // let privileges = this._stateService.loadPrivilegesByPage('Agent Management');
    // this.isPrivilegeView = privileges?.view || false;
    // this.isPrivilegeEdit = privileges?.['insert / edit'] || privileges?.edit || false;
    // this.isPrivilegeDelete = privileges?.delete || false;
    // this.isPrivilegeRefresh = privileges?.refresh || false;
    // this.isPrivilegeExecute = privileges?.execute || false;
    // this._rolePrivilegeService.getPermissions().subscribe({
    //   next: (res) => {
    //     console.log('API Response:', res.data);
    //     if (res?.data?.length) {
    //       // Push data to mapping
    //       this.rolePrivilegMapping(res.data);
    //     } else {
    //       console.warn('No privileges returned from API');
    //     }
    //   },
    //   error: (err) => console.error('Error fetching privileges:', err),
    // });
  }

  // rolePrivilegMapping(allPrivileges: any) {
  //   const loggedUser = this._stateService.getLoginDetails();
  //   const roleName = loggedUser?.Role?.toLowerCase() || '';
  //   const projectId = String(
  //     loggedUser?.ProjectDtl?.[0]?.prj_id ||
  //       loggedUser?.ProjectDtl?.[0]?.ProjectId ||
  //       ''
  //   );
  //   const teamId = String(
  //     loggedUser?.ProjectDtl?.[0]?.team_id ||
  //       loggedUser?.ProjectDtl?.[0]?.TeamId ||
  //       ''
  //   );
  //   const roleId = String(loggedUser?.ProjectDtl?.[0]?.RoleId || '0'); // fallback to "0"

  //   console.log('--- Logged User Details ---', {
  //     projectId,
  //     teamId,
  //     roleId,
  //     roleName,
  //   });
  //   console.log('Privileges from DB:', allPrivileges);

  //   this.isPrivilegeView = false;
  //   this.isPrivilegeEdit = false;
  //   this.isPrivilegeDelete = false;

  //   // Super Admin special case
  //   if (roleName === 'super admin') {
  //     const activeProject = loggedUser?.ActiveProject?.toLowerCase() || '';
  //     if (activeProject === this.masterDatabase.toLowerCase()) {
  //       this.isPrivilegeView = true;
  //       this.isPrivilegeEdit = true;
  //       this.isPrivilegeDelete = true;
  //     } else {
  //       this.isPrivilegeView = true;
  //       this.isPrivilegeEdit = false;
  //       this.isPrivilegeDelete = false;
  //     }

  //     this.agentForm[
  //       this.isPrivilegeView && !this.isPrivilegeEdit ? 'disable' : 'enable'
  //     ]({ emitEvent: false });
  //     this.cdRef.detectChanges();
  //     return;
  //   }

  //   // Match privilege
  //   let privMap = allPrivileges.find((rp: any) => {
  //     const matchProject =
  //       String(rp.ProjectId || rp.prj_id || rp.projectId) === projectId;
  //     const matchTeam = String(rp.TeamId || rp.team_id || rp.teamId) === teamId;
  //     const matchRole = String(rp.RoleId || rp.role_id || rp.roleId) === roleId;
  //     return matchProject && matchTeam && matchRole;
  //   });

  //   // fallback to RoleId = "0" if no exact match
  //   if (!privMap) {
  //     privMap = allPrivileges.find(
  //       (rp: any) =>
  //         rp.RoleId === '0' &&
  //         String(rp.ProjectId) === projectId &&
  //         String(rp.TeamId) === teamId
  //     );
  //   }

  //   if (privMap && privMap.permissions) {
  //     const pagePerms = privMap.permissions['Agent Management'] || {};
  //     this.isPrivilegeView = !!pagePerms.view;
  //     this.isPrivilegeEdit = !!pagePerms['insert / edit'] || !!pagePerms.edit;
  //     this.isPrivilegeDelete = !!pagePerms.delete;
  //     console.log('Mapped Permissions =>', {
  //       View: this.isPrivilegeView,
  //       Edit: this.isPrivilegeEdit,
  //       Delete: this.isPrivilegeDelete,
  //     });
  //   } else {
  //     console.warn(
  //       `Privileges not found for ProjectId: ${projectId}, TeamId: ${teamId}, RoleId: ${roleId}`
  //     );
  //     this.isPrivilegeView = true;
  //   }

  //   this.agentForm[
  //     this.isPrivilegeView && !this.isPrivilegeEdit ? 'disable' : 'enable'
  //   ]({ emitEvent: false });
  //   this.cdRef.detectChanges();
  // }

  // rolePrivilegMapping(allPrivileges: any) {
  //   const roles = this._stateService.getRoleManagementData() || [];
  //   const loggedUser = this._stateService.getLoginDetails();
  //   const roleName = loggedUser?.Role?.toLowerCase() || '';
  //   const activeProject = loggedUser?.ActiveProject?.toLowerCase() || '';

  //   // Reset
  //   this.isPrivilegeView = false;
  //   this.isPrivilegeEdit = false;
  //   this.isPrivilegeDelete = false;

  //   // Super Admin special case
  //   if (roleName === 'super admin') {
  //     if (activeProject === 'master') {
  //       // Full access in Master project
  //       this.isPrivilegeView = true;
  //       this.isPrivilegeEdit = true;
  //       this.isPrivilegeDelete = true;
  //     } else {
  //       // View only in other projects
  //       this.isPrivilegeView = true;
  //       this.isPrivilegeEdit = false;
  //       this.isPrivilegeDelete = false;
  //     }

  //     // Apply form disabling if view-only
  //     if (this.isPrivilegeView && !this.isPrivilegeEdit) {
  //       this.agentForm.disable({ emitEvent: false });
  //     } else {
  //       this.agentForm.enable({ emitEvent: false });
  //     }

  //     this.cdRef.detectChanges();
  //     return;
  //   }

  //   // Normal roles — use DB privileges
  //   const role = roles.find(
  //     (r: { RoleName: string }) => r.RoleName.toLowerCase() === roleName
  //   );
  //   if (!role) return;

  //   const rolePrivilegeList = allPrivileges || [];
  //   const privMap = rolePrivilegeList.find(
  //     (rp: { RoleId: any }) => rp.RoleId === role.RoleId.toString()
  //   );

  //   if (privMap && privMap.permissions) {
  //     const pageKey = 'Agent Management';
  //     const pagePerms = privMap.permissions[pageKey];
  //     if (pagePerms) {
  //       this.isPrivilegeView = !!pagePerms.view;
  //       this.isPrivilegeEdit = !!pagePerms['insert / edit'] || !!pagePerms.edit;
  //       this.isPrivilegeDelete = !!pagePerms.delete;
  //     } else {
  //       console.log(`No permissions found for page: ${pageKey}`);
  //     }
  //   } else {
  //     console.log(`Privileges not found for RoleId: ${role.RoleId}`);
  //   }

  //   // ✅ Disable form if view-only
  //   if (this.isPrivilegeView && !this.isPrivilegeEdit) {
  //     this.agentForm.disable({ emitEvent: false });
  //   } else {
  //     this.agentForm.enable({ emitEvent: false });
  //   }

  //   this.cdRef.detectChanges();
  // }

  initAgentForm(): void {
    this.agentForm = this.fb.group({
      name: ['', Validators.required],
      role_id: ['', Validators.required],
      agent_id: [''],
      user_id: [''],
      description: ['', Validators.required],
      version: [{ value: '1.0.0', disabled: true }, Validators.required],
      agent_role: ['', Validators.required],
      agent_goal: ['', Validators.required],
      prompt_template: [{ value: '', disabled: true }],
      agent_prompt: [''],
      model: ['', Validators.required],
      ref_output: [''],
      example: [''],
      mcp_connector_id: [null],
      foundation_resp_ai: [false],
      foundation_ethic_ai: [false],
      foundation_guardrails_ai: [false],
      status: [''],
      agent_owner: ['', Validators.required],
      agent_provider_type: ['external', Validators.required],
      knowledge_store_id: [''],
      knowledge_store_value: [''],
      knowledge_store_enabled: [true],
      knowledge_store_checkbox: [false],
      data_store_checkbox: [false],
      memory_checkbox: [false],
      context_checkbox: [false],
      mcp_connector_value: [''],
      mcp_connector_enabled: [true],
      mcp_connector_checkbox: [false],
      ai_foundation_enabled: [{ value: false, disabled: true }],
      model_enabled: [true],
      foundation_resp_ai_toggle: [true],
      foundation_resp_ai_value: [''],
      foundation_ethic_ai_toggle: [true],
      foundation_ethic_ai_value: [''],
      foundation_guardrails_ai_toggle: [true],
      foundation_guardrails_ai_value: [''],
      agent_api_key: ['', Validators.required],
      session_id: [''],
      agent_type_id: ['', Validators.required],
      agent_type_name: [''],
      agent_api_url: ['', Validators.required],
      agent_session_id: ['', Validators.required],
      scheduleFrequency: [''],
      schedulerTime: [''],
      action_required: [''],
      avatar: [''],
      selectedDays: [[]],
      selectedDates: [[]],
      actions: this.fb.array([]),
      run_count: [0],
      api_agent_id: [''],
      rating: [0],
      usage_count: [0],
      trending: [false],
      ai_foundation: this.fb.array([]),
      approverEmail: [''],
      saveHistory: [false],
      session_start_url: ['',  V.string('Start Session URL')
                  .url()
                  .required()
                  .when(() => this.isVoiceAgent)],
      session_end_url: ['',  V.string('End')
                  .url()
                  .required()
                  .when(() => this.isVoiceAgent)],
      connector: ['', V.string('Connector').build()],
      internal_tool: [[], V.array()
                  .test(
                    "validate_internal_tool",
                    "At least one tool should be selected",
                    (value: string[]) => {

                      if(!this.connectorId()) return true;

                      return !!value.length
                    }).build()
                  ],
    });
    this.schedules = [];
    this.hasDailySchedule = false;
    this.hasWeeklySchedule = false;
    this.hasMonthlySchedule = false;
    this.selectedDays = [];
    this.selectedDates = [];
    // Clear validators initially for schedule-related fields
    this.agentForm.get('schedulerTime')?.clearValidators();
    this.agentForm.get('selectedDays')?.clearValidators();
    this.agentForm.get('selectedDates')?.clearValidators();
    this.agentForm
      .get('schedulerTime')
      ?.updateValueAndValidity({ emitEvent: false });
    this.agentForm
      .get('selectedDays')
      ?.updateValueAndValidity({ emitEvent: false });
    this.agentForm
      .get('selectedDates')
      ?.updateValueAndValidity({ emitEvent: false });
    this.resetScheduleFields();
    this.setupConditionalValidation();
  }
  setupConditionalValidation(): void {
    const agentOwnerControl = this.agentForm.get('agent_owner');
    const agentProviderTypeControl = this.agentForm.get('agent_provider_type');
    const modelEnabledControl = this.agentForm.get('model_enabled');
    // Handle agent_owner changes
    agentOwnerControl?.valueChanges.subscribe((owner: string) => {
      // console.log('Agent Owner changed to:', (owner === 'external' && agentProviderTypeControl?.value === 'existing'), owner, agentProviderTypeControl?.value);
      const isExternalExisting = (owner === 'external');
      const approvalRequired = (owner === 'external' && agentProviderTypeControl?.value === 'new');
      this.toggleRequired('agent_provider_type', owner === 'external');
      this.toggleRequired('agent_prompt', (!isExternalExisting));
      this.toggleRequired('description', !isExternalExisting);
      this.toggleRequired('version', !isExternalExisting);
      this.toggleRequired('agent_api_url', isExternalExisting);
      this.toggleRequired('agent_role', !isExternalExisting);
      this.toggleRequired('agent_goal', !isExternalExisting);
      this.toggleRequired('agent_api_key', isExternalExisting);
      this.toggleRequired('user_id', isExternalExisting);
      this.toggleRequired('agent_session_id', isExternalExisting);
      this.toggleRequired('model', !isExternalExisting && modelEnabledControl?.value);
      this.toggleRequired('approverEmail', approvalRequired);
    });

    // agentProviderTypeControl?.valueChanges.subscribe((providerType: string) => {
    //   //console.log('Agent Provider Type changed to:', providerType, agentOwnerControl?.value);
    //   const isExternalNew = (agentOwnerControl?.value === 'external' && providerType === 'new');
    //   this.toggleRequired('agent_prompt', isExternalNew);
    //   this.toggleRequired('description', isExternalNew);
    //   this.toggleRequired('version', isExternalNew);
    //   this.toggleRequired('agent_api_url', !isExternalNew);
    //   this.toggleRequired('agent_role', isExternalNew);
    //   this.toggleRequired('agent_goal', isExternalNew);
    //   this.toggleRequired('agent_api_key', !isExternalNew);
    //   this.toggleRequired('user_id', !isExternalNew);
    //   this.toggleRequired('agent_session_id', !isExternalNew);
    //   this.toggleRequired('model', isExternalNew );
    //   this.toggleRequired('approverEmail', isExternalNew);
    // });


    // agentProviderTypeControl?.valueChanges.subscribe((providerType: string) => {
    //   const isExternalExisting = (agentOwnerControl?.value === 'external' && providerType === 'existing');
    //   const approvalRequired = (agentOwnerControl?.value === 'external' && providerType === 'new');
    //   this.toggleRequired('agent_prompt', !isExternalExisting);
    //   this.toggleRequired('description', !isExternalExisting);
    //   this.toggleRequired('version', !isExternalExisting);
    //   this.toggleRequired('agent_api_url', isExternalExisting);
    //   this.toggleRequired('agent_role', !isExternalExisting);
    //   this.toggleRequired('agent_goal', !isExternalExisting);
    //   this.toggleRequired('agent_api_key', isExternalExisting);
    //   this.toggleRequired('user_id', isExternalExisting);
    //   this.toggleRequired('agent_session_id', isExternalExisting);
    //   this.toggleRequired('model', !isExternalExisting && (modelEnabledControl?.value || providerType === 'new'));
    //   this.toggleRequired('approverEmail', approvalRequired);
    // });
    // Handle model_enabled changes
    modelEnabledControl?.valueChanges.subscribe((enabled: boolean) => {
      const isExternalExisting = agentOwnerControl?.value === 'external' && agentProviderTypeControl?.value === 'existing';
      this.toggleRequired('model', enabled && !isExternalExisting);
      if (!enabled) {
        this.agentForm.get('model')?.setValue('');
      }
    });

    const initialOwner = agentOwnerControl?.value;
    if (initialOwner) {
      agentOwnerControl.setValue(initialOwner, { emitEvent: true });
    } else {
      // Ensure model is not required initially if model_enabled is false
      if (!modelEnabledControl?.value) {
        this.toggleRequired('model', false);
      }
    }
  }
  toggleRequired(controlName: string, required: boolean): void {
    const control = this.agentForm.get(controlName);
    if (!control) return;
    if (required) {
      control.setValidators([Validators.required]);
    } else {
      control.clearValidators();
    }
    control.updateValueAndValidity();
  }

  toggleEditRequired(controlName: string, isRequired: boolean): void {
    const control = this.agentForm.get(controlName);
    if (control) {
      if (isRequired) {
        control.setValidators(Validators.required);
      } else {
        control.clearValidators();
      }
      control.updateValueAndValidity();
    }
  }

  minSelectedCheckboxes(min = 1) {
    return (control: AbstractControl) => {
      const selected = control.value as number[];
      return selected && selected.length >= min ? null : { required: true };
    };
  }

  minSelectedDates(min = 1) {
    return (control: AbstractControl) => {
      const selected = control.value as string[];
      return selected && selected.length >= min ? null : { required: true };
    };
  }

  toggleDay(dayValue: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      if (!this.selectedDays.includes(dayValue)) {
        this.selectedDays.push(dayValue);
      }
    } else {
      this.selectedDays = this.selectedDays.filter((d) => d !== dayValue);
    }
    this.agentForm.get('selectedDays')?.setValue([...this.selectedDays]);
    this.agentForm.get('selectedDays')?.markAsTouched();
    this.cdRef.detectChanges();
  }

  toggleDayCreateNew(dayValue: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      if (!this.selectedDays.includes(dayValue)) {
        this.selectedDays.push(dayValue);
      }
    } else {
      this.selectedDays = this.selectedDays.filter((d) => d !== dayValue);
    }
    this.createAgentForm.get('selectedDays')?.setValue([...this.selectedDays]);
    this.createAgentForm.get('selectedDays')?.markAsTouched();
    this.cdRef.detectChanges();
  }

  addDate(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (!target || !target.value) {
      this.agentForm.get('selectedDates')?.markAsTouched();
      this.cdRef.detectChanges();
      return;
    }
    const dateString = target.value;
    const selectedDate = new Date(dateString);
    const today = new Date();
    selectedDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) {
      this.agentForm.get('selectedDates')?.setErrors({ pastDate: true });
      target.value = '';
      this.cdRef.detectChanges();
      return;
    }
    const formattedDate = dateString;
    if (!this.selectedDates.includes(formattedDate)) {
      this.selectedDates.push(formattedDate);
      this.agentForm.get('selectedDates')?.setValue([...this.selectedDates]);
      this.agentForm.get('selectedDates')?.markAsTouched();
    }
    // Clear and blur the input to close the date picker
    target.value = '';
    target.blur();
    this.cdRef.detectChanges();
  }

  addDateCreateNew(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (!target || !target.value) {
      this.createAgentForm.get('selectedDates')?.markAsTouched();
      this.cdRef.detectChanges();
      return;
    }
    const dateString = target.value;
    const selectedDate = new Date(dateString);
    const today = new Date();
    selectedDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) {
      this.createAgentForm.get('selectedDates')?.setErrors({ pastDate: true });
      target.value = '';
      this.cdRef.detectChanges();
      return;
    }
    const formattedDate = dateString;
    if (!this.selectedDates.includes(formattedDate)) {
      this.selectedDates.push(formattedDate);
      this.createAgentForm.get('selectedDates')?.setValue([...this.selectedDates]);
      this.createAgentForm.get('selectedDates')?.markAsTouched();
    }
    // Clear and blur the input to close the date picker
    target.value = '';
    target.blur();
    this.cdRef.detectChanges();
  }

  removeDate(dateToRemove: string): void {
    this.selectedDates = this.selectedDates.filter(
      (date) => date !== dateToRemove
    );
    this.agentForm.get('selectedDates')?.setValue(this.selectedDates);
    this.agentForm.get('selectedDates')?.markAsTouched();
  }

  removeDateCreateNew(dateToRemove: string): void {
    this.selectedDates = this.selectedDates.filter(
      (date) => date !== dateToRemove
    );
    this.createAgentForm.get('selectedDates')?.setValue(this.selectedDates);
    this.createAgentForm.get('selectedDates')?.markAsTouched();
  }

  confirmDelete(agent: any): void {
    this.agentToDelete = agent;
    this.deleteModal.show();
  }

  updateFrequencyFields(value: string) {
    this.showDailyTime = value === 'daily';
    this.showWeeklyTime = value === 'weekly';
    this.showMonthlyTime = value === 'monthly';
    this.showDefaultTime = !value || value === '';
  }

  formatRating(rating: any): string {
    const num = parseFloat(rating);
    return isNaN(num) ? 'N/A' : num.toFixed(1);
  }

  prepareFormData(form: FormGroup): any {
    const formValue = form.getRawValue();
    const schedulerTime: {
      daily?: { time: string };
      weekly?: { days: number[]; time: string };
      monthly?: { dates: string[]; time: string };
    } = {};
    this.schedules.forEach((schedule) => {
      if (schedule.frequency === 'daily') {
        schedulerTime.daily = { time: schedule.time };
      } else if (schedule.frequency === 'weekly') {
        schedulerTime.weekly = { days: schedule.days, time: schedule.time };
      } else if (schedule.frequency === 'monthly') {
        schedulerTime.monthly = { dates: schedule.dates, time: schedule.time };
      }
    });
    const scheduleFrequency = this.schedules.map(
      (schedule) => schedule.frequency
    );
    return {
      ...formValue,
      scheduleFrequency,
      schedulerTime,
      selectedDays:
        formValue.scheduleFrequency === 'weekly' ? formValue.selectedDays : [],
      selectedDates:
        formValue.scheduleFrequency === 'monthly'
          ? formValue.selectedDates
          : [],
      schedules: this.schedules,
    };
  }

  ngAfterViewInit(): void {
    $(this.onboardAgentModal.nativeElement).on('hidden.bs.modal', () => {
      this.isEditMode = false;
      this.isEditingName = false;
      this.selectedAgentId = '';
      this.fileError = null;
      this.selectedDays = [];
      this.selectedDates = [];
      this.schedules = [];
      this.showDailyTime = false;
      this.showWeeklyTime = false;
      this.showMonthlyTime = false;
      this.showDefaultTime = true;
      this.totalPercentage = 0; // Reset totalPercentage
      this.actions.clear(); // Clear actions
      this.newActionForm.reset({ name: '', percentage: '' });
      this.setupFormForOnboard();
      this.agentForm.reset({
        name: '',
        agent_owner: '',
        agent_provider_type: 'external',
        agent_type_id: '',
        role_id: '',
        description: '',
        version: '',
        agent_role: '',
        agent_goal: '',
        prompt_template: '',
        agent_prompt: '',
        ref_output: '',
        example: '',
        avatar: '',
        agent_api_url: '',
        agent_api_key: '',
        user_id: '',
        agent_id: '',
        agent_session_id: '',
        api_agent_id: '',
        scheduleFrequency: '',
        schedulerTime: '',
        selectedDays: [],
        selectedDates: [],
        trending: false,
        status: '',
        rating: 0,
        run_count: 0,
        mcp_connector_enabled: true,
        mcp_connector_checkbox: false,
        mcp_connector_value: '',
        knowledge_store_enabled: true,
        knowledge_store_checkbox: false,
        data_store_checkbox: false,
        memory_checkbox: false,
        context_checkbox: false,
        knowledge_store_value: '',
        ai_foundation_enabled: true,
        ai_foundation: [],
        model_enabled: true,
        model: '',
        foundation_resp_ai_toggle: true,
        foundation_resp_ai_value: '',
        foundation_ethic_ai_toggle: true,
        foundation_ethic_ai_value: '',
        foundation_guardrails_ai_toggle: true,
        foundation_guardrails_ai_value: '',
        approverEmail: '',
        saveHistory: false
      });
      this.agentForm.patchValue({
        knowledge_store_enabled: true,
        knowledge_store_id: '',
        ai_foundation_enabled: true,
        ai_foundation: [],
      });
      this.actions.clear();
      this.cdRef.detectChanges();
    });

    const toggleFields = [
      'model_enabled',
      'mcp_connector_enabled',
      'knowledge_store_enabled',
      'ai_foundation_enabled',
      'foundation_resp_ai_toggle',
      'foundation_ethic_ai_toggle',
      'foundation_guardrails_ai_toggle',
    ];

    toggleFields.forEach((field) => {
      const control = this.agentForm.get(field);
      if (control) {
        control.enable();
        control.setValue(true);
      }
    });

    this.deleteModal = new bootstrap.Modal(
      document.getElementById('deleteConfirmModal1')
    );

    this.configureKGModal = new bootstrap.Modal(
      document.getElementById('configureKGModal')
    );

    this.configureToolsModal = new bootstrap.Modal(
      document.getElementById('configureToolsModal')
    );

    this.promptBuilderModal = new bootstrap.Modal(
      document.getElementById('promptBuilderModal')
    );

    this.versionHistoryModal= new bootstrap.Modal(
      document.getElementById('versionHistoryModal')
    );
    // this.loadAgents();
    // this.loadDropdowns();
    // this.getAgentCounts();
    this.updateRoleChart(this.allAgents);
    this.updateAICapabilityChart(this.allAgents);
    this.updateAgentTypeChart(this.allAgents);
    this.updateAgencyChart(this.allAgents);

    const toggleBtn = document.querySelector('.toggleAgentBtn');
    const sidebar = document.querySelector('.sidebarAgent');
    sidebar?.classList.add('expanded');
    toggleBtn?.addEventListener('click', () => {
      sidebar?.classList.toggle('expanded');
    });
  }

  getRoleName(roleId: string): string {
    const role = this.rolesList.find((r) => r.value === roleId);
    return role ? role.label : roleId;
  }

  getAgentProviderName(providerId: string): string {
    const provider = this.agentProvidersList.find(
      (p) => p.value === providerId
    );
    return provider ? provider.label : providerId;
  }

  isAgentIdVisible(): boolean {
    const provider = this.agentForm.get('agent_owner')?.value;
    return provider && !['internal', 'movate'].includes(provider.toLowerCase());
  }

  loadAgents_old(): void {
    this.isload = true;
    this._loadingService.show();
    this._marketService.getAgentDetails().subscribe({
      next: (response) => {
        if (response && response.data) {
          // Fetch project list from state
          const activePrj = this.loggedUser?.ActiveProject;
          //console.log('Active Project:', activePrj);

          // ✅ Extract mapped team & role from PrjDetails for the active project
          const projectDetails = this.loggedUser?.ProjectDtl || [];
          //console.log('User Project Details:', projectDetails);

          // ✅ Find project mapping for the active project (case-insensitive)
          const mappedProject = projectDetails.find(
            (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
          );
          //console.log('Mapped Project:', mappedProject);

          const mappedTeam = mappedProject?.team_name || '';
          const mappedRole = mappedProject?.role_name?.toLowerCase() || '';
          //console.log('Mapped Team:', mappedTeam);
          //console.log('Mapped Role:', mappedRole);
          if (
            activePrj &&
            activePrj.toLowerCase() !== this.masterDatabase.toLowerCase() &&
            mappedRole !== 'super admin' &&
            mappedRole !== 'admin'
          ) {
            const projects =
              this._stateService.getProjectManagementData() || [];
            //console.log('proj', projects);
            const activeProject = projects.find(
              (prj: any) =>
                prj.projectName &&
                prj.projectName.toLowerCase() === activePrj.toLowerCase()
            );
            //console.log('Active pppp:', activeProject);

            if (mappedTeam) {
              //console.log('needagency0:', this.agenciesWithAgents);
              this.agenciesWithAgents = this.agenciesWithAgents.filter(
                (agency) =>
                  agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
              );

              const agentIds = this.agenciesWithAgents.flatMap((agency) =>
                (agency.agents || [])
                  .filter(
                    (agent: { status: string }) => agent.status === 'active'
                  ) // optional: include only active agents
                  .map((agent: { agent_id: any }) => agent.agent_id)
              );

              // Assuming agentIds is an array of agent_id strings extracted earlier
              this.allAgents = (response.data || []).filter(
                (agent: { agent_id: any }) => agentIds.includes(agent.agent_id)
              );
              const countsByType: { [key: string]: number } = {
                total_agents: this.allAgents.length,
                trending_agents: this.allAgents.filter(
                  (agent) => agent.trending === true
                ).length,
                active_agents: this.allAgents.filter(
                  (agent) => agent.status?.toLowerCase() === 'active'
                ).length,
              };
              //console.log('counts', countsByType);
              this.agentCountsList = this.agentCountsList.map((item) => ({
                ...item,
                count: countsByType[item.key] || 0,
              }));
              //console.log('countsagents', this.agentCountsList);
            } else {
              // Handle case if no teams found or active project missing
              this.agenciesWithAgents = [];
              this.allAgents = [];
            }
          } else {
            this.allAgents = response.data;
            const countsByType: { [key: string]: number } = {
              total_agents: this.allAgents.length,
              trending_agents: this.allAgents.filter(
                (agent) => agent.trending === true
              ).length,
              active_agents: this.allAgents.filter(
                (agent) => agent.status?.toLowerCase() === 'active'
              ).length,
            };
            //console.log('counts', countsByType);
            this.agentCountsList = this.agentCountsList.map((item) => ({
              ...item,
              count: countsByType[item.key] || 0,
            }));
            //console.log('countsagents', this.agentCountsList);
          }

          // Count agents by key type

          // Update agentCountsList counts based on these counts

          this.cdRef.detectChanges();
          //console.log('All Agents:', this.allAgents);
          const agentModels = Array.from(
            new Set(
              this.allAgents
                .map((agent) => agent.model)
                .filter((model) => !!model)
            )
          );
          this.modelsList = agentModels.map((model) => ({
            value: model,
            label: model,
          }));

          const agentTypes = Array.from(
            new Map(
              this.allAgents
                .filter((agent) => agent.agent_type_id && agent.agent_type_name)
                .map((agent) => [
                  agent.agent_type_id,
                  { value: agent.agent_type_id, label: agent.agent_type_name },
                ])
            ).values()
          );
          const knowledgeStores = Array.from(
            new Map(
              this.allAgents
                .filter(
                  (agent) =>
                    agent.knowledge_store &&
                    agent.knowledge_store.id &&
                    agent.knowledge_store.id !== 'None'
                )
                .map((agent) => [
                  agent.knowledge_store.id,
                  {
                    value: agent.knowledge_store.id,
                    label:
                      agent.knowledge_store.name ||
                      agent.knowledge_store.id ||
                      'Unknown',
                  },
                ])
            ).values()
          );
          this.knowledgeStores = knowledgeStores;
          this.agentTypesList = agentTypes;
          this.setActiveCountTab(0);
          this.totalItems = this.filteredAgents.length;
          this.updatePagination();
          this.updateRoleChart(this.filteredAgents);
          this.updateAICapabilityChart(this.filteredAgents);
          this.updateAgentTypeChart(this.filteredAgents);
          this.updateAgencyChart(this.filteredAgents);
        }
        this._loadingService.hide();
        this.isload = false;
        this.cdRef.detectChanges();
      },
      error: (err) => {
        console.error('Error loading agents:', err);
        this._loadingService.hide();
        this.isload = false;
      },
    });
  }

  loadAgents(): void {
    this.isload = true;
    this._loadingService.show();
    this._marketService.getAgentDetails().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          // Fetch project list from state
          const activePrj = this.loggedUser?.ActiveProject;
          //console.log('Active Project:', activePrj);

          // ✅ Extract mapped team & role from PrjDetails for the active project
          const projectDetails = this.loggedUser?.ProjectDtl || [];
          //console.log('User Project Details:', projectDetails);

          let mappedProject: any = null; // Use `any` or a proper type, not `any[]`
          var mappedTeam = '';
          var mappedRole = '';
          // let mapTeam = projectDetails.find(
          // (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
          // );
          // var mapRole = mapTeam?.role_name?.toLowerCase() || '';
          // const projectManagementDetailsOrg = this._stateService.getProjectManagementData() || [];

          // if (mapRole === "Super Admin") {
          // mappedProject = projectManagementDetailsOrg.find(
          // (p: any) => p.projectName?.toLowerCase() === activePrj?.toLowerCase()
          // );

          // mappedTeam = mappedProject?.teams[0].teamName || '';
          // mappedRole = mappedProject?.teams[0].roles[0].role?.toLowerCase() || '';

          // } else {
          // Assuming `projectDetails` is defined elsewhere in your component
          mappedProject = projectDetails.find(
            (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
          );

          mappedTeam = mappedProject?.team_name || '';
          mappedRole = mappedProject?.role_name?.toLowerCase() || '';

          //console.log('Mapped Project:', mappedProject);

          //console.log('Mapped Team:', mappedTeam);
          //console.log('Mapped Role:', mappedRole);
          if (
            activePrj &&
            activePrj.toLowerCase() !== this.masterDatabase.toLowerCase() &&
            mappedRole !== 'super admin' &&
            mappedRole !== 'admin'
          ) {
            const projects =
              this._stateService.getProjectManagementData() || [];
            //console.log('proj', projects);
            const activeProject = projects.find(
              (prj: any) =>
                prj.projectName &&
                prj.projectName.toLowerCase() === activePrj.toLowerCase()
            );
            //console.log('Active pppp:', activeProject);

            if (mappedTeam) {
              //console.log('needagency0:', this.agenciesWithAgents);
              this.agenciesWithAgents = this.agenciesWithAgents.filter(
                (agency) =>
                  agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
              );

              const agentIds = this.agenciesWithAgents.flatMap((agency) =>
                (agency.agents || [])
                  .filter(
                    (agent: { status: string }) => agent.status === 'active'
                  ) // optional: include only active agents
                  .map((agent: { agent_id: any }) => agent.agent_id)
              );

              // Assuming agentIds is an array of agent_id strings extracted earlier
              this.allAgents = (response.data || []).filter(
                (agent: { agent_id: any }) => agentIds.includes(agent.agent_id)
              );

              

              //console.log('Filtered Agents for Team:', this.allAgents);
              const countsByType: { [key: string]: number } = {
                total_agents: this.allAgents.length,
                trending_agents: this.allAgents.filter(
                  (agent) => agent.trending === true
                ).length,
                active_agents: this.allAgents.filter(
                  (agent) => agent.status?.toLowerCase() === 'active'
                ).length,
              };
              //console.log('counts', countsByType);
              this.agentCountsList = this.agentCountsList.map((item) => ({
                ...item,
                count: countsByType[item.key] || 0,
              }));
              //console.log('countsagents', this.agentCountsList);
            } else {
              // Handle case if no teams found or active project missing
              this.agenciesWithAgents = response.data;
              this.allAgents = response.data;
              const countsByType: { [key: string]: number } = {
                total_agents: this.allAgents.length,
                trending_agents: this.allAgents.filter(
                  (agent) => agent.trending === true
                ).length,
                active_agents: this.allAgents.filter(
                  (agent) => agent.status?.toLowerCase() === 'active'
                ).length,
              };
              //console.log('counts', countsByType);
              this.agentCountsList = this.agentCountsList.map((item) => ({
                ...item,
                count: countsByType[item.key] || 0,
              }));
            }
          } else {
            this.allAgents = response.data;
            // this.allAgents= [{"agent_id":"6a05923373f367823a2d43ed","name":"new","role_id":"ROLE001","description":"New","version":"1.0.0","agent_role":"New","agent_goal":"New","prompt_template":"","agent_prompt":"New","ref_output":"New","example":"","model":"gpt-4o","mcp_connector_id":"","mcp_connector_checkbox":true,"mcp_connector_value":{"name":"openapi-test3_-getUsers","data":{"tool_id":"openapi-test3_-getUsers","tool_name":"openapi-test3_-getUsers","tool_source":"openapi"}},"knowledge_store_id":"","knowledge_store_enabled":true,"knowledge_store_checkbox":true,"knowledge_store_value":{"name":"test_pranav","chunks":5,"type":"RAG","data":{"_id":"69f0ee34ed4f984dfd2d5737","api_key":"sk-default-ThcU9FBynRuQzq4aiNhQi4gWTYHGWzVc","collection_name":"test_pranav01es","created_at":"2026-04-28T17:28:20.793000","description":"test","embedding_credential_id":"lyzr_openai","embedding_model":"text-embedding-ada-002","llm_credential_id":"lyzr_openai","llm_model":"gpt-4o-mini","meta_data":{},"multi_tenancy_enabled":true,"name":"test_pranav","semantic_data_model":false,"shared":null,"updated_at":"2026-04-28T17:28:20.793000","user_id":"sk-default-ThcU9FBynRuQzq4aiNhQi4gWTYHGWzVc","vector_db_credential_id":"lyzr_qdrant_2","vector_store_provider":"Qdrant [Lyzr 2]"}},"data_store_checkbox":true,"data_store_value":{"model":"movateai","maxTries":3,"timeLimit":60,"data":{"_id":"69fda97b8c57347d0a04fb7b","api_key":"sk-default-ThcU9FBynRuQzq4aiNhQi4gWTYHGWzVc","collection_name":"movateaiv24z","created_at":"2026-05-08T09:14:35.160000","description":"Test","embedding_credential_id":"lyzr_openai","embedding_model":"text-embedding-ada-002","llm_credential_id":"lyzr_openai","llm_model":"gpt-4o-mini","meta_data":{"database_id":"fff5ddc9-405f-48cb-a50f-6e0684643d0b","database_name":"testtt","database_provider_id":"file_upload","documentation_agent_id":"69fda9746209150249fcb434"},"multi_tenancy_enabled":true,"name":"movateai","semantic_data_model":true,"shared":null,"updated_at":"2026-05-08T09:14:35.160000","user_id":"sk-default-ThcU9FBynRuQzq4aiNhQi4gWTYHGWzVc","vector_db_credential_id":"lyzr_qdrant_2","vector_store_provider":"Qdrant [Lyzr 2]"}},"memory_checkbox":true,"memory_value":{"provider":"aws-agentcore","crossSession":false,"data":{"_id":"693060cdd4e9ae41a5a27848","createdAt":"2025-12-03T16:09:49.544000","form":{"description":"Bring your own AWS account for agent memory using Amazon Bedrock AgentCore","fields":[{"label":"Credential Name","name":"name","placeholder":"My AWS Memory","required":true,"type":"text"},{"description":"The IAM Role ARN that Lyzr will assume to access your AWS account","label":"IAM Role ARN","name":"aws_role_name","placeholder":"arn:aws:iam::123456789012:role/LyzrAgentCoreRole","required":true,"type":"text"},{"default":"LyzrAgentCoreMemory","label":"Session Name","name":"aws_session_name","placeholder":"LyzrAgentCoreMemory","required":false,"type":"text"},{"default":"us-east-1","label":"AWS Region","name":"aws_region_name","options":[{"label":"US East (N. Virginia)","value":"us-east-1"},{"label":"US West (Oregon)","value":"us-west-2"},{"label":"Europe (Ireland)","value":"eu-west-1"},{"label":"Asia Pacific (Singapore)","value":"ap-southeast-1"},{"label":"Asia Pacific (Tokyo)","value":"ap-northeast-1"}],"required":true,"type":"select"}],"title":"Amazon Bedrock AgentCore Memory"},"meta_data":{"category":"memory","documentation_url":"https://docs.aws.amazon.com/bedrock/latest/userguide/agents-memory.html","icon":"https://dmd0zix65vwdz.cloudfront.net/memory/aws-bedrock.png","lambda_registration_required":true,"provisioning_time_seconds":180,"supports_role_based_auth":true},"provider_id":"aws-agentcore","type":"memory","updatedAt":"2026-02-11T11:17:26.040000"}},"context_checkbox":true,"context_value":{"id":"69fdb068c5e13fc5fa98dafb","name":"test","data":{"_id":"69fdb068c5e13fc5fa98dafb","api_key":"sk-default-ThcU9FBynRuQzq4aiNhQi4gWTYHGWzVc","created_at":"2026-05-08T09:44:08.999000","name":"test","updated_at":"2026-05-08T09:44:08.999000","value":"testtt"}},"foundation_resp_ai":"","foundation_ethic_ai":"","foundation_guardrails_ai":"","status":"","agent_owner":"external","agent_provider_type":"new","agent_type_id":"INSIGHT_AGENT","agent_type_name":"","scheduleFrequency":[],"schedulerTime":{},"actions":[],"avatar":"","ai_foundation":[]}]
            const countsByType: { [key: string]: number } = {
              total_agents: this.allAgents.length,
              trending_agents: this.allAgents.filter(
                (agent) => agent.trending === true
              ).length,
              active_agents: this.allAgents.filter(
                (agent) => agent.status?.toLowerCase() === 'active'
              ).length,
            };
            //console.log('counts', countsByType);
            this.agentCountsList = this.agentCountsList.map((item) => ({
              ...item,
              count: countsByType[item.key] || 0,
            }));
            //console.log('countsagents', this.agentCountsList);
          }

          // Count agents by key type

          // Update agentCountsList counts based on these counts

          this.cdRef.detectChanges();
          //console.log('All Agents:', this.allAgents);
          const agentModels = Array.from(
            new Set(
              this.allAgents
                .map((agent) => agent.model)
                .filter((model) => !!model)
            )
          );
          this.modelsList = agentModels.map((model) => ({
            value: model,
            label: model,
          }));

          const agentTypes = Array.from(
            new Map(
              this.allAgents
                .filter((agent) => agent.agent_type_id && agent.agent_type_name)
                .map((agent) => [
                  agent.agent_type_id,
                  { value: agent.agent_type_id, label: agent.agent_type_name },
                ])
            ).values()
          );
          const knowledgeStores = Array.from(
    new Map(
      this.allAgents
        .filter((agent) => 
          agent.knowledge_store && 
          Array.isArray(agent.knowledge_store) && 
          agent.knowledge_store.length > 0 &&
          agent.knowledge_store[0].id &&
          agent.knowledge_store[0].id !== 'None'
        )
        .map((agent) => [
          agent.knowledge_store[0].id,
          {
            value: agent.knowledge_store[0].id,
            label: agent.knowledge_store[0].name || agent.knowledge_store[0].id || 'Unknown',
          },
        ])
    ).values()
  );
  
  this.knowledgeStores = knowledgeStores;
          this.agentTypesList = agentTypes;
          this.setActiveCountTab(0);
          this.totalItems = this.filteredAgents.length;
          this.updatePagination();
          this.updateRoleChart(this.filteredAgents);
          this.updateAICapabilityChart(this.filteredAgents);
          this.updateAgentTypeChart(this.filteredAgents);
          this.updateAgencyChart(this.filteredAgents);
        }
        this._loadingService.hide();
        this.isload = false;
        this.cdRef.detectChanges();
      },
      error: (err) => {
        console.error('Error loading agents:', err);
        this._loadingService.hide();
        this.isload = false;
      },
    });
  }
fetchAgenciesWithAgents(): void {
  this._marketService.getAgencyWithAgents().subscribe({
    next: (res) => {
      if (res.success) {
        this.agenciesWithAgents = res.data;
      }
    },
    error: (err) => console.error('Error:', err),
  });
}
  loadDropdowns(): void {
    this._marketService.getAllDropdowns().subscribe({
      next: (res) => {
        if (res.success) {
          this.agentProvidersList = res.data.agent_providers;
          this.rolesList = res.data.roles;
          this.mcpConnectors = res.data.mcp_connectors;
          // this.knowledgeStores = res.dropdowns.knowledge_store;
          // console.log('Knowledge Stores:', this.knowledgeStores);
          this.ai_foundation = res.data.ai_foundations;
          // console.log('AI Foundations:', this.ai_foundation);
          this.agentTypes = res.data.agent_types;
          this.cdRef.detectChanges();
          this.updateRoleChart(this.allAgents);
        }
      },
      error: (err) => {
        console.error('Failed to load dropdowns:', err);
      },
    });
  }

  loadDropdownsForLyzrAgentCreation(): void {
    this.loadKgsFromLyzr();
    this.loadToolsFromLyzr();
    this.loadProviderModelsFromLyzr();
    this.loadSemanticDataFromLyzr();
    this.loadProviderMemoryFromLyzr();
    this.loadMCPConnectorsFromLyzr();
    this.loadContextsFromLyzr();
    this.getApproverEmailsList();
  }

  loadToolsFromLyzr(): void {
    this._marketService.getToolsFromLyzr().subscribe({
      next: (res:any) => {
        if (res.success) {
          this.toolsFromLyzr = res.message;
          this.cdRef.detectChanges();
        }
      },
      error: (err:any) => {
        console.error('Failed to load tools from Lyzr:', err);
      },
    });
  }

  loadKgsFromLyzr(): void {
    this._marketService.getKgsFromLyzr().subscribe({
      next: (res:any) => {
        if (res.success) {
          this.kgsFromLyzr = res.message.configs;
          this.cdRef.detectChanges();
        }
      },
      error: (err:any) => {
        console.error('Failed to load knowledge graphs from Lyzr:', err);
      },
    });
  }

  loadProviderModelsFromLyzr(): void {
    this._marketService.getProviderModelsFromLyzr().subscribe({
      next: (res:any) => {
        if (res.success) {
          const providersList = res.message;
          const providerModels: any[] = [];
          providersList?.forEach((provider: any) => {
            if (Array.isArray(provider.meta_data?.models)) {
              provider.meta_data.models.forEach((model: any) => {
                providerModels.push({
                  "credential_id":provider.meta_data?.credential_id,
                  "provider_id":provider.provider_id,
                  "model":model
                });
              });
            }
          });
          //console.log('Provider Models from Lyzr:', providerModels);
          this.providerModelsFromLyzr = providerModels;
          this.cdRef.detectChanges();
        }
      },
      error: (err:any) => {
        console.error('Failed to load provider models from Lyzr:', err);
      },
    });
  }

  loadSemanticDataFromLyzr(): void {
    this._marketService.getSemanticDataFromLyzr().subscribe({
      next: (res:any) => {
        if (res.success) {
          this.semanticDataModels = res.message.configs;
          this.cdRef.detectChanges();
        }
      },
      error: (err:any) => {
        console.error('Failed to load semantic data from Lyzr:', err);
      },
    });
  }

  loadProviderMemoryFromLyzr(): void {
    this._marketService.getProviderMemoryFromLyzr().subscribe({
      next: (res:any) => {
        if (res.success) {
          this.providerMemoryFromLyzr = res.message;
          this.cdRef.detectChanges();
        }
      },
      error: (err:any) => {
        console.error('Failed to load provider memory from Lyzr:', err);
      },
    });
  }

  loadMCPConnectorsFromLyzr(): void {
    this._marketService.getMCPConnectorsFromLyzr().subscribe({
      next: (res:any) => {
        if (res.success) {
          this.mcpConnectorsFromLyzr = res.data;
          this.cdRef.detectChanges();
        }
      },
      error: (err:any) => {
        console.error('Failed to load MCP connectors from Lyzr:', err);
      },
    });
  }

  loadContextsFromLyzr(): void {
    this._marketService.getContextsFromLyzr().subscribe({
      next: (res:any) => {
        if (res.success) {
          this.contextsFromLyzr = res.message;
          this.cdRef.detectChanges();
        }
      },
      error: (err:any) => {
        console.error('Failed to load contexts from Lyzr:', err);
      },
    });
  }

  sendPromptQuery(): void {
    const userQuery = this.promptBuilderForm.get('userQuery')?.value?.trim();
    
    if (!userQuery || !this.promptBuilderSessionId) {
      return;
    }

    // Add user message to chat
    this.promptBuilderMessages.push({
      type: 'user',
      content: userQuery,
    });

    this.promptBuilderForm.get('userQuery')?.setValue('', { emitEvent: false });

    this.isPromptLoading = true;

    let payload={
      prompt:userQuery,
      session_id:this.promptBuilderSessionId,
    }

    this._marketService.generateWithAI(payload).subscribe({
      next:(res:any)=>{
        //console.log('Prompt Builder Response:', res);
        let aiResponse = res.message.response;
        this.promptBuilderMessages.push({
          type: 'ai',
          content: aiResponse,
          json_response: res.message.json_response? res.message.json_response : null, // Store the structured JSON output
        });
        this.isPromptLoading = false;

        //console.log('sfds',this.promptBuilderMessages)
        // Auto-scroll to latest message
        this.cdRef.detectChanges();
        setTimeout(() => {
          const messagesContainer = document.querySelector('.prompt-messages-container');
          if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
          }
        }, 100);
      },
      error:(err:any)=>{
        console.error('Error fetching prompt builder response:', err);
        this.isPromptLoading = false;
      }
    });

    // Simulate AI response based on user query
    // setTimeout(() => {
    //   let aiResponse = '';
    //   let context = '';
    //   let description = '';

    //   // Parse user query and generate contextual responses
    //   const lowerQuery = userQuery.toLowerCase();
      
    //   if (lowerQuery.includes('epic') || lowerQuery.includes('epics')) {
    //     context = 'creating epics';
    //     description = 'Got it — you want help with "creating epics." Quick couple of clarifying questions so I can build a focused agent prompt for you:';
    //     aiResponse = 'Quick couple of clarifying questions so I can build a focused agent prompt for you:';
    //   } else if (lowerQuery.includes('customer') || lowerQuery.includes('support')) {
    //     context = 'customer support';
    //     description = 'You want to build a customer support agent. Let me help you create the perfect role and instructions.';
    //     aiResponse = 'Great! Let me ask a few questions to help design your customer support agent.';
    //   } else if (lowerQuery.includes('sales') || lowerQuery.includes('sale')) {
    //     context = 'sales agent';
    //     description = 'Perfect! You want to build a sales-focused agent. I can help craft the ideal instructions.';
    //     aiResponse = "I'll help you build an effective sales agent. Tell me more about your sales process.";
    //   } else {
    //     context = userQuery;
    //     description = `I understand you'd like help with "${userQuery}". Let me ask some clarifying questions.`;
    //     aiResponse = description;
    //   }

    //   // Set context and add AI response
    //   this.promptBuilderContext = context;
    //   this.promptBuilderDescription = description;
      
    //   this.promptBuilderMessages.push({
    //     type: 'ai',
    //     content: aiResponse,
    //   });

    //   this.isPromptLoading = false;

    //   // Clear input
      
    // }, 800);
  }

  openPromptBuilder(): void {
    // Reset prompt builder state
    // this.promptBuilderMessages = [];
    // this.promptBuilderContext = '';
    // this.promptBuilderDescription = '';
    // this.promptBuilderForm.reset();
    // this.promptBuilderSessionId = this.generateObjectId();
    
    const modal = new bootstrap.Modal(document.getElementById('promptBuilderModal'));
    modal.show();
  }

  openVersionHistory(): void {
    this.loadVersionHistory();
    this.versionHistoryModal.show();
  }

  generateObjectId(): string {
    const timestamp = Math.floor(new Date().getTime() / 1000).toString(16);
    const random = 'xxxxxxxxxxxxxxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
    return timestamp + random;
  }

  get isAgentNameDuplicate(): boolean {
    const nameControl = this.agentForm.get('name');
    const name = nameControl?.value?.trim().toLowerCase();
    const originalName = this.originalAgentName?.trim().toLowerCase();
    if (!name || name === originalName) return false;
    const hasInteracted =
      nameControl?.dirty || nameControl?.touched || this.formSubmitted;
    if (!hasInteracted) return false;
    return this.allAgents.some(
      (agent) =>
        agent.name?.trim().toLowerCase() === name &&
        agent.agent_id !== this.selectedAgentId
    );
  }

  get isNewAgentNameDuplicate(): boolean {
    const name = this.agentForm.get('name')?.value?.trim().toLowerCase();
    const originalName = this.originalAgentName?.trim().toLowerCase();
    if (!name || name === originalName) return false;
    return this.allAgents.some(
      (agent) => agent.name?.trim().toLowerCase() === name
    );
  }

  submitAgentForm(): void {
    //console.log('Form valid:', this.agentForm.valid);
    //console.log('Form errors:', this.agentForm.errors);
    //console.log('Form value:', this.agentForm.getRawValue());
    //console.log('formm', this.agentForm);
    if (this.agentForm.invalid) {
      console.log(
        'Invalid controls:',
        Object.keys(this.agentForm.controls).filter(
          (key) => this.agentForm.get(key)?.invalid
        )
      );
      this.agentForm.markAllAsTouched();
      return;
    }
    if (this.isEditMode) {
      this.submitEditAgent();
    } else {
      this.submitNewAgent();
    }
  }

  submitNewAgent(): void {
    this._loadingService.show();
    const formValue = this.prepareFormData(this.agentForm);
    //console.log('Prepared Form Value:', formValue);
    const selectedType = this.agentTypes.find(
      (t) => t.value === formValue.agent_type_id
    );
    const selectedMcp = this.mcpConnectors.find(
      (m) => m.value === formValue.mcp_connector_value
    );
    const agent_type_name = selectedType ? selectedType.label : '';
    // const mcp_connector_name = selectedMcp ? selectedMcp.label : '';
    this.agentForm.patchValue({
      mcp_connector_value: formValue.mcp_connector_value,
      knowledge_store_value: formValue.knowledge_store_value,
      knowledge_store_enabled: formValue.knowledge_store_enabled,
      knowledge_store_checkbox: formValue.knowledge_store_checkbox,
      data_store_checkbox: formValue.data_store_checkbox,
      memory_checkbox: formValue.memory_checkbox,
      context_checkbox: formValue.context_checkbox,
      ai_foundation: formValue.ai_foundation,
      ai_foundation_enabled: formValue.ai_foundation_enabled,
      model: formValue.model,
      foundation_resp_ai_value: formValue.foundation_resp_ai_value,
      foundation_ethic_ai_value: formValue.foundation_ethic_ai_value,
      foundation_guardrails_ai_value: formValue.foundation_guardrails_ai_value,
    });
    //console.log('Prepared Form Value submit:', formValue);
    //console.log(this.providerModelsFromLyzr)
    const payload: any = {
      agent_submit_type:"new",
      agent_id: this.generateObjectId(),
      name: formValue.name,
      role_id: formValue.role_id,
      description: formValue.description,
      version: formValue.version,
      agent_role: formValue.agent_role,
      agent_goal: formValue.agent_goal,
      prompt_template: formValue.prompt_template,
      agent_prompt: formValue.agent_prompt,
      ref_output: formValue.ref_output,
      example: formValue.example,
      model: formValue.model_enabled ? formValue.model : null,
      model_data: this.providerModelsFromLyzr.find((m:any) => m.model?.name === formValue.model)? this.providerModelsFromLyzr.find((m:any) => m.model?.name === formValue.model) : null,
      mcp_connector_id: formValue.mcp_connector_enabled
        ? formValue.mcp_connector_value
        : null,
      mcp_connector_checkbox: formValue.mcp_connector_checkbox ? formValue.mcp_connector_checkbox : null,
      mcp_connector_value: this.configuredToolDetails,
      knowledge_store_id: formValue.knowledge_store_enabled
        ? formValue.knowledge_store_id
        : null,
      knowledge_store_enabled: formValue.knowledge_store_enabled,
      knowledge_store_checkbox: formValue.knowledge_store_checkbox,
      knowledge_store_value: this.configuredKGDetails,
      data_store_checkbox: formValue.data_store_checkbox,
      data_store_value: this.configuredDataQueryDetails,
      memory_checkbox: formValue.memory_checkbox,
      memory_value: this.configuredMemoryDetails,
      context_checkbox: formValue.context_checkbox,
      context_value: this.configuredContextDetails,
      foundation_resp_ai: formValue.foundation_resp_ai_toggle
        ? formValue.foundation_resp_ai_value
        : null,
      foundation_ethic_ai: formValue.foundation_ethic_ai_toggle
        ? formValue.foundation_ethic_ai_value
        : null,
      foundation_guardrails_ai: formValue.foundation_guardrails_ai_toggle
        ? formValue.foundation_guardrails_ai_value
        : null,
      status: formValue.status,
      agent_owner: formValue.agent_owner,
      agent_provider_type: formValue.agent_provider_type,
      agent_type_id: formValue.agent_type_id,
      agent_type_name: formValue.agent_type_name,
      scheduleFrequency: formValue.scheduleFrequency,
      schedulerTime: formValue.schedulerTime,
      actions: formValue.actions,
      approverEmail: formValue.approverEmail,
      avatar: formValue.avatar,
      ai_foundation: formValue.ai_foundation,
      modified_by: {
        "email":this.loggedUser?.Email,
        "name":this.loggedUser?.UserName,
      },
      connector: formValue.connector,
      internal_tool: formValue.internal_tool,
      Iscustomtool: !!formValue.connector
    };
    //console.log('Onboard Payload internal:', payload);
    const payload1 = {
      agent_id: formValue.agent_id,
      user_id: formValue.user_id,
      agent_name: formValue.name,
      api_key: formValue.agent_api_key,
      agent_session_id: formValue.agent_session_id,
      agent_api_url: formValue.agent_api_url,
      role_id: formValue.role_id,
      agent_type_id: formValue.agent_type_id,
      agent_type_name: formValue.agent_type_name,
      scheduleFrequency: formValue.scheduleFrequency,
      schedulerTime: formValue.schedulerTime,
      actions: formValue.actions,
      approverEmail: formValue.approverEmail,
      avatar: formValue.avatar,
      session_start_url: formValue.session_start_url,
      session_end_url: formValue.session_end_url,
      modified_by: {
        "email":this.loggedUser?.Email,
        "name":this.loggedUser?.UserName,
      },
      connector: formValue.connector,
      internal_tool: formValue.internal_tool,
      Iscustomtool: !!formValue.connector
    };
    //console.log('Onboard Payload external:', payload1);
    
    // const rawProvider = formValue.agent_owner || 'movate';
    const rawProvider = formValue.agent_owner || 'internal';
    const provider = rawProvider.toLowerCase();
    const providerType = formValue.agent_provider_type ? formValue.agent_provider_type.toLowerCase() : 'external';
    const apiCall =
      provider?.trim().toLowerCase() === 'external'
        ? providerType === 'new'
          ? this._marketService.onboardExternalNewAgent(payload)
          : this._marketService.onboardExternalExistingAgent(payload1)
        : this._marketService.onboardInternalAgent(payload);
    if (provider?.trim().toLowerCase() === 'external' && providerType === 'existing') {
      const alreadyExists = this.allAgents.some(
        (agent) => agent.agent_id === formValue.agent_id
      );
      if (alreadyExists) {
        this._loadingService.hide();
        this.showToast('error', 'An agent with this ID already exists.');
        return;
    }}
    const alreadyExistsByName = this.allAgents.some(
      (agent) =>
        agent.name?.trim().toLowerCase() ===
        formValue.name?.trim().toLowerCase()
    );
    if (alreadyExistsByName) {
      this._loadingService.hide();
      this.showToast('error', 'An agent with this name already exists.');
      return;
    }
    // this._loadingService.show();
    apiCall.subscribe({
      next: () => {
        this._loadingService.hide();
        provider?.trim().toLowerCase() === 'external'
        ? providerType === 'new'
          ? this.showToast('success', 'Agent Details Sent For Approval Successfully')
          : this.showToast('success', 'Agent onboarded successfully')
        : this.showToast('success', 'Agent onboarded successfully');
        this.agentForm.reset();
        this.approvalState={}
        this.closeOnboardModal();
        this.loadAgents();
        this.getAgentCounts();
        this.cdRef.detectChanges();
      },
      error: (err) => {
        this._loadingService.hide();
        console.error('Onboarding error:', JSON.stringify(err));

        const error = getApiError(err);
        if (error) {
          const errorMessage =
            error.message ||
            'Failed to onboard agent: No additional details provided.';
          this.showToast('error', errorMessage);
          this._loadingService.hide();
          this.cdRef.detectChanges();
          return;
        }
        let errorMessage =
          'Failed to onboard agent: An unexpected error occurred.';
        if (err.error) {
          if (err.error.Message) {
            errorMessage = err.error.Message;
          } else if (err.error.message) {
            errorMessage = err.error.message;
          } else if (err.error.errors) {
            // Handle cases where errors are returned as an array or object
            if (Array.isArray(err.error.errors)) {
              errorMessage = err.error.errors.join(', ');
            } else if (typeof err.error.errors === 'object') {
              errorMessage = Object.values(err.error.errors).join(', ');
            }
          } else if (typeof err.error === 'string') {
            errorMessage = err.error;
          }
        } else if (err.message) {
          errorMessage = err.message;
        } else if (err.statusText) {
          errorMessage = `Failed to onboard agent: ${err.statusText}`;
        }

        this.showToast('error', errorMessage);
        this.cdRef.detectChanges();
      },
    });
  }

  submitEditAgent(): void {
    this._loadingService.show();
    this.formSubmitted = true;
    const form = this.prepareFormData(this.agentForm);
    const payload = {
      agent_submit_type: "edit",
      agent_id: this.selectedAgentId,
      user_id: form.user_id,
      name: form.name,
      role_id: form.role_id,
      description: form.description,
      version: form.version,
      agent_role: form.agent_role,
      agent_goal: form.agent_goal,
      prompt_template: form.prompt_template,
      agent_prompt: form.agent_prompt,
      ref_output: form.ref_output,
      example: form.example,
      model: form.model_enabled ? form.model : null,
      model_data: this.providerModelsFromLyzr.find((m:any) => m.model?.name === form.model)? this.providerModelsFromLyzr.find((m:any) => m.model?.name === form.model) : null,
      mcp_connector_id: form.mcp_connector_enabled
        ? form.mcp_connector_value
        : null,
      mcp_connector_checkbox: form.mcp_connector_checkbox ? form.mcp_connector_checkbox : null,
      knowledge_store_id: form.knowledge_store_enabled
        ? form.knowledge_store_id
        : null,
      knowledge_store_enabled: form.knowledge_store_enabled,
      knowledge_store_checkbox: form.knowledge_store_checkbox,
      data_store_checkbox: form.data_store_checkbox,
      memory_checkbox: form.memory_checkbox,
      context_checkbox: form.context_checkbox,
      mcp_connector_value: this.configuredToolDetails,
      knowledge_store_value: this.configuredKGDetails,
      data_store_value: this.configuredDataQueryDetails,
      memory_value: this.configuredMemoryDetails,
      context_value: this.configuredContextDetails,
      foundation_resp_ai: form.foundation_resp_ai_toggle
        ? form.foundation_resp_ai_value
        : null,
      foundation_ethic_ai: form.foundation_ethic_ai_toggle
        ? form.foundation_ethic_ai_value
        : null,
      foundation_guardrails_ai: form.foundation_guardrails_ai_toggle
        ? form.foundation_guardrails_ai_value
        : null,
      status: form.status,
      agent_owner: form.agent_owner,
      agent_provider_type: form.agent_provider_type,
      agent_type_id: form.agent_type_id,
      agent_type_name: form.agent_type_name,
      scheduleFrequency: form.scheduleFrequency,
      schedulerTime: form.schedulerTime,
      agent_api_key: form.agent_api_key,
      agent_session_id: form.agent_session_id,
      agent_api_url: form.agent_api_url,
      api_agent_id: form.api_agent_id,
      actions: form.actions,
      approverEmail: form.approverEmail,
      avatar: form.avatar,
      ai_foundation: form.ai_foundation,
      save_history: form.saveHistory,
      session_start_url: form.session_start_url,
      session_end_url: form.session_end_url,
      connector: form.connector,
      internal_tool: form.internal_tool,
      Iscustomtool: !!form.connector,
      modified_by: {
        "email":this.loggedUser?.Email,
        "name":this.loggedUser?.UserName,
      }
    };
    //console.log('Edit Payload:', payload);
    const alreadyExistsByName = this.allAgents.some(
      (agent) =>
        agent.name?.trim().toLowerCase() === form.name?.trim().toLowerCase() &&
        agent.agent_id !== this.selectedAgentId
    );
    if (alreadyExistsByName) {
      this._loadingService.hide();
      this.showToast('error', 'An agent with this name already exists.');
      return;
    }
    if (this.isExternalNewAgentVar){
      if (this.selectedAgent?.agent_id==='') {
        this._loadingService.hide();
        this.showToast('error', 'Cannot update agent since it is Pending Approval or Rejected.');
        return;
      }
      this._marketService.onboardExternalNewAgent(payload).subscribe({
        next: () => {
          this.showToast('success', 'Agent Updates Sent For Approval Successfully');
          this.loadAgents();
          // $(this.onboardAgentModal.nativeElement).modal('hide');
          this.closeOnboardModal();
          this.cdRef.detectChanges();
          this._loadingService.hide();
        },
        error: (err) => {
          this._loadingService.hide();
        console.error('Updating error:', JSON.stringify(err));
        let errorMessage =
          'Failed to update agent: An unexpected error occurred.';
        if (err.error) {
          if (err.error.Message) {
            errorMessage = err.error.Message;
          } else if (err.error.message) {
            errorMessage = err.error.message;
          } else if (err.error.errors) {
            // Handle cases where errors are returned as an array or object
            if (Array.isArray(err.error.errors)) {
              errorMessage = err.error.errors.join(', ');
            } else if (typeof err.error.errors === 'object') {
              errorMessage = Object.values(err.error.errors).join(', ');
            }
          } else if (typeof err.error === 'string') {
            errorMessage = err.error;
          }
        } else if (err.message) {
          errorMessage = err.message;
        } else if (err.statusText) {
          errorMessage = `Failed to update agent: ${err.statusText}`;
        }

        this.showToast('error', errorMessage);
        this.cdRef.detectChanges();
        },
      });
      
    }
    else{
    this._marketService.updateAgentDetails(payload).subscribe({
      next: () => {
        this.showToast('success', 'Agent updated successfully');
        this.loadAgents();
        // $(this.onboardAgentModal.nativeElement).modal('hide');
        this.closeOnboardModal();
        this.cdRef.detectChanges();
      },
      error: (err) => {
        this._loadingService.hide();
        console.error('Updating error:', JSON.stringify(err));
        let errorMessage =
          'Failed to update agent: An unexpected error occurred.';
        if (err.error) {
          if (err.error.Message) {
            errorMessage = err.error.Message;
          } else if (err.error.message) {
            errorMessage = err.error.message;
          } else if (err.error.errors) {
            // Handle cases where errors are returned as an array or object
            if (Array.isArray(err.error.errors)) {
              errorMessage = err.error.errors.join(', ');
            } else if (typeof err.error.errors === 'object') {
              errorMessage = Object.values(err.error.errors).join(', ');
            }
          } else if (typeof err.error === 'string') {
            errorMessage = err.error;
          }
        } else if (err.message) {
          errorMessage = err.message;
        } else if (err.statusText) {
          errorMessage = `Failed to update agent: ${err.statusText}`;
        }

        this.showToast('error', errorMessage);
        this.cdRef.detectChanges();
      },
    });
  }
  }

  openOnboardModal(): void {
    this.isEditMode = false;
    this.initAgentForm();
    this.actions.clear();
    this.totalPercentage = 0;
    this.newActionForm.reset({ name: '', percentage: '' });
    this.approvalState={};
    this.setupFormForOnboard();
    this.selectedAIFoundations = [];
    const aiFoundationControl = this.agentForm.get(
      'ai_foundation'
    ) as FormArray;
    aiFoundationControl.clear();
    this.agentForm.patchValue({
      knowledge_store_enabled: true,
      knowledge_store_checkbox: false,
      data_store_checkbox: false,
      memory_checkbox: false,
      context_checkbox: false,
      knowledge_store_id: '',
      ai_foundation_enabled: true,
      ai_foundation: [],
    });
    // $(this.onboardAgentModal.nativeElement).modal('show');
    this.openOnboardModalPopup();
  }

  setupFormForOnboard(): void {
    this.currentStep = 1;
    this.agentForm.reset();
    this.approvalState = {};
    this.fileError = null;
    this.selectedDays = [];
    this.selectedDates = [];
    this.showDailyTime = false;
    this.showWeeklyTime = false;
    this.showMonthlyTime = false;
    this.showDefaultTime = true;
    this.isEditMode = false;
    this.isEditingName = false;
    this.selectedAgentId = '';
    this.originalAgentName = '';
    this.schedules = [];
    this.hasDailySchedule = false;
    this.hasWeeklySchedule = false;
    this.hasMonthlySchedule = false;
    this.totalPercentage = 0; // Reset totalPercentage
    this.actions.clear(); // Clear actions
    this.newActionForm.reset({ name: '', percentage: '' });
    this.selectedAIFoundations = [];
    this.selectedKnowledgeStore = [];
    this.configuredKGDetails = null;
    this.configuredToolDetails = null;
    this.configuredDataQueryDetails = null;
    this.configuredMemoryDetails = null;
    this.configuredContextDetails = null;
    const aiFoundationControl = this.agentForm.get(
      'ai_foundation'
    ) as FormArray;
    aiFoundationControl.clear();
    const agentOwnerControl = this.agentForm.get('agent_owner');
    agentOwnerControl?.reset('');
    agentOwnerControl?.enable({ emitEvent: false });
    const agentProviderTypeControl = this.agentForm.get('agent_provider_type');
    agentProviderTypeControl?.reset('');
    agentProviderTypeControl?.enable({ emitEvent: false });
    this.agentForm.patchValue({
      agent_owner: '',
      role_id: '',
      agent_type_id: '',
      agent_type_name: '',
      name: '',
      description: '',
      version: '1.0.0',
      agent_role: '',
      agent_goal: '',
      prompt_template: '',
      agent_prompt: '',
      ref_output: '',
      example: '',
      model: '',
      model_enabled: true,
      mcp_connector_value: '',
      mcp_connector_enabled: true,
      mcp_connector_checkbox: false,
      ai_foundation: [],
      ai_foundation_enabled: true,
      knowledge_store_value: '',
      knowledge_store_id: '',
      knowledge_store_enabled: true,
      knowledge_store_checkbox: false,
      data_store_checkbox: false,
      memory_checkbox: false,
      context_checkbox: false,
      foundation_resp_ai_value: '',
      foundation_resp_ai_toggle: true,
      foundation_ethic_ai_value: '',
      foundation_ethic_ai_toggle: true,
      foundation_guardrails_ai_value: '',
      foundation_guardrails_ai_toggle: true,
      agent_api_url: '',
      agent_api_key: '',
      user_id: '',
      agent_id: '',
      agent_session_id: '',
      scheduleFrequency: '',
      schedulerTime: '',
      selectedDays: [],
      selectedDates: [],
      run_count: 0,
      api_agent_id: '',
      rating: 0,
      usage_count: 128,
      status: '',
      avatar: '',
      saveHistory: false
    });

    this.agentForm.get('knowledge_store_enabled')?.setValue(true);
    this.agentForm.get('ai_foundation_enabled')?.setValue(true);
    this.agentForm.get('agent_owner')?.enable({ emitEvent: false });
    this.agentForm.get('agent_provider_type')?.enable({ emitEvent: false });
    const controlsToClear = [
      'scheduleFrequency',
      'schedulerTime',
      'selectedDays',
      'selectedDates',
    ];
    controlsToClear.forEach((controlName) => {
      const control = this.agentForm.get(controlName);
      if (control) {
        control.clearValidators();
        control.updateValueAndValidity();
      }
    });
    this.totalSteps = 2; // Default to 2 steps for non-task agents
    this.setupConditionalValidation();
    // Unsubscribe and reset agent_type_id subscription
    if (this.agentTypeSubscription) {
      this.agentTypeSubscription.unsubscribe();
    }
    this.agentTypeSubscription = null;
    this.cdRef.detectChanges();
  }

  setupAgentTypeSubscription(): void {
    if (this.agentTypeSubscription) {
      this.agentTypeSubscription.unsubscribe();
    }
    const agentTypeControl = this.agentForm.get('agent_type_id');
    if (agentTypeControl) {
      this.agentTypeSubscription = agentTypeControl.valueChanges.subscribe(
        () => {
          this.totalSteps = (this.isTaskAgent() || this.isExternalNewAgentVar) ? 3 : 2;
          if (this.currentStep > this.totalSteps) {
            this.currentStep = this.totalSteps;
          }
          if (
            (this.isTaskAgent() || this.isExternalNewAgentVar) &&
            this.currentStep === 3 &&
            this.actions.length === 0
          ) {
            this.actions.push(this.createAction());
            this.calculateTotal();
          }
          this.cdRef.detectChanges();
        }
      );
    } else {
      console.warn('agent_type_id control not found in form');
      this.agentTypeSubscription = null;
    }
  }

  ngOnDestroy(): void {
    if (this.agentTypeSubscription) {
      this.agentTypeSubscription.unsubscribe();
    }
  }

  openEditModal(agent: any): void {
    this.isEditMode = true;
    this.isEditingName = false;
    this.originalAgentName = agent.name;
    this.selectedAgentId = agent.agent_id;
    this.selectedAgent=agent
    this.selectedObjectId = agent._id;
    this.approvalState = {
      'status':agent.Approval_Status? agent.Approval_Status : 'Approved',
      'approverEmail':agent.approverEmail? agent.approverEmail : '',
      'status_msg': agent.Approval_Status_Message? agent.Approval_Status_Message : agent.Approval_Status? agent.Approval_Status : 'Unknown',
      // 'approvedAt':agent.Approved_At? agent.Approved_At : '',
    }
    //console.log('Editing agent:', agent);
    // Reset schedule-related fields
    this.selectedDays = [];
    this.selectedDates = [];
    this.schedules = [];
    this.scheduleFrequency = [];
    this.schedulerTime = {};
    this.hasDailySchedule = false;
    this.hasWeeklySchedule = false;
    this.hasMonthlySchedule = false;
    this.selectedAIFoundations = [];

    if (agent.agent_owner==='external' && agent.agent_provider_type==='new'){
      this.openExternalNewAgentEditModal(agent);
      return;
    }
    const latestAgent = this.agents.find((a) => a.agent_id === agent.agent_id);
    const agentToUse = latestAgent || agent;
    this.patchAgentForm(agentToUse);

    //console.log('Patching form with:', this.agentForm.getRawValue());
    // Disable agent_owner in edit mode
    this.agentForm.get('agent_owner')?.disable();
    this.agentForm.get('agent_provider_type')?.disable();
    this.actions.clear();
    if (this.isTaskAgent()) {
      if (agent.actions && agent.actions.length > 0) {
        agent.actions.forEach((a: any) => {
          const actionGroup = this.fb.group(
            {
              name: [a.name || '', Validators.required],
              percentage: [
                Number(a.percentage) || 0,
                [Validators.required, Validators.min(0), Validators.max(100)],
              ],
            },
            { validators: this.requireBothIfOneFilled }
          );
          this.actions.push(actionGroup);
        });
      } else {
        this.actions.push(this.createAction());
      }
      this.calculateTotal();
      this.actions.updateValueAndValidity();
    }
    // Set total steps and current step
    this.totalSteps = (this.isTaskAgent() || this.isExternalNewAgentVar) ? 3 : 2;
    this.currentStep = 1;
    this.updateFrequencyFlags();
    this.agentForm.updateValueAndValidity();
    if (this.isTaskAgent()) {
      this.actions.controls.forEach((control) => {
        control.get('name')?.updateValueAndValidity();
        control.get('percentage')?.updateValueAndValidity();
      });
      this.actions.updateValueAndValidity();
    }
    // $(this.onboardAgentModal.nativeElement).modal('show');
    this.openOnboardModalPopup();
  }

  private patchAgentForm(agent: any) {
    // Extract Knowledge Store details
    let knowledgeStoreEnabled = false;
    let knowledgeStoreId = null;
    this.selectedKnowledgeStore = [];

    if (agent.knowledge_store && Array.isArray(agent.knowledge_store) && agent.knowledge_store.length > 0) {

      // === Handle Multiple Knowledge Stores ===
      this.selectedKnowledgeStore = agent.knowledge_store.map((ks: any) => ({
        value: ks.id,
        label: ks.name || ks.title || ks.id || 'Unknown'
      }));

      // Prefer enabled one, otherwise take the first one
      const enabledKs = agent.knowledge_store.find((ks: any) => ks.enabled !== false);
      const primaryKs = enabledKs || agent.knowledge_store[0];

      if (primaryKs) {
        knowledgeStoreId = primaryKs.id;
        knowledgeStoreEnabled = primaryKs.enabled !== false;
      }

      //console.log("Loaded multiple Knowledge Stores:", this.selectedKnowledgeStore);
      //console.log("Primary Knowledge Store:", primaryKs?.id);

    }
    else if (agent.knowledge_store_id && agent.knowledge_store_id !== 'None') {
      // === Legacy fallback ===
      knowledgeStoreId = agent.knowledge_store_id;
      knowledgeStoreEnabled = true;

      const foundStore = this.knowledgeStores.find(
        (store) => store.value === agent.knowledge_store_id
      );

      this.selectedKnowledgeStore = foundStore ? [foundStore] : [{
        value: agent.knowledge_store_id,
        label: agent.knowledge_store_id || 'Unknown'
      }];
    }
    // Handle multiple schedule frequencies
    const frequencies: Frequency[] = Array.isArray(agent.scheduleFrequency)
      ? agent.scheduleFrequency.filter((f: string): f is Frequency =>
          ['daily', 'weekly', 'monthly'].includes(f)
        )
      : agent.scheduleFrequency &&
        ['daily', 'weekly', 'monthly'].includes(agent.scheduleFrequency)
      ? [agent.scheduleFrequency as Frequency]
      : [];

    frequencies.forEach((frequency: Frequency) => {
      let scheduleData: {
        frequency: Frequency;
        time: string;
        days: number[];
        dates: string[];
      } = {
        frequency,
        time: '',
        days: [],
        dates: [],
      };
      if (agent.schedulerTime && frequency) {
        if (frequency === 'daily') {
          scheduleData.time = agent.schedulerTime.daily?.time || '00:00';
          this.hasDailySchedule = true;
        } else if (frequency === 'weekly') {
          this.selectedDays = Array.isArray(agent.schedulerTime.weekly?.days)
            ? agent.schedulerTime.weekly.days
                .map((d: string | number) => Number(d))
                .filter((d: number) => !isNaN(d) && d >= 0 && d <= 6)
            : [];
          scheduleData.time = agent.schedulerTime.weekly?.time || '00:00';
          scheduleData.days = this.selectedDays;
          this.hasWeeklySchedule = true;
        } else if (frequency === 'monthly') {
          this.selectedDates = Array.isArray(agent.schedulerTime.monthly?.dates)
            ? agent.schedulerTime.monthly.dates.map((d: string | Date) =>
                typeof d === 'string'
                  ? d.split('T')[0]
                  : d.toISOString().split('T')[0]
              )
            : [];
          scheduleData.time = agent.schedulerTime.monthly?.time || '00:00';
          scheduleData.dates = this.selectedDates;
          this.hasMonthlySchedule = true;
        }
      }
      if (scheduleData.frequency && scheduleData.time) {
        this.schedules.push(scheduleData);
        this.scheduleFrequency.push(scheduleData.frequency);
        (
          this.schedulerTime as Record<
            Frequency,
            { time: string; days?: number[]; dates?: string[] }
          >
        )[frequency] = {
          time: scheduleData.time,
          ...(scheduleData.days.length ? { days: scheduleData.days } : {}),
          ...(scheduleData.dates.length ? { dates: scheduleData.dates } : {}),
        };
      }
    });
    const mcpEnabled =
      agent.mcp_connector_id && agent.mcp_connector_id !== 'None';
    const connector = (agent.internal_tool as IAgent['internal_tool'])?.[0]?.connection_id || '';
    this.agentForm.patchValue({
      name: agent.name || '',
      agent_owner: agent.agent_owner || '',
      agent_provider_type: agent.agent_provider_type || 'existing',
      agent_type_id: agent.agent_type_id || '',
      role_id: agent.role_id || '',
      description: agent.description || '',
      version: agent.version || '',
      agent_role: agent.agent_role || '',
      agent_goal: agent.agent_goal || '',
      prompt_template: agent.prompt_template || '',
      agent_prompt: agent.agent_prompt || '',
      ref_output: (typeof agent.ref_output === 'object' ? JSON.stringify(agent.ref_output, null, 2) : decodeURIComponent(agent.ref_output))  || '',
      example: agent.example || '',
      avatar: agent.avatar || '',
      agent_api_url: agent.agent_api_url || '',
      agent_api_key: agent.agent_api_key || '',
      user_id: agent.user_id || '',
      agent_id: agent.agent_id || '',
      agent_session_id: agent.agent_session_id || '',
      api_agent_id: agent.api_agent_id || '',
      scheduleFrequency: frequencies[0] || '',
      schedulerTime: '',
      selectedDays: this.selectedDays,
      selectedDates: this.selectedDates,
      trending: agent.trending || false,
      status: agent.status || '',
      rating: agent.rating || 0,
      run_count: agent.run_count || 0,
      // mcp_connector_enabled: agent.mcp_connector_id && agent.mcp_connector_id !== 'None',
      // mcp_connector_value: agent.mcp_connector_id !== 'None' ? agent.mcp_connector_id : '',
      mcp_connector_enabled: mcpEnabled,
      mcp_connector_value: mcpEnabled ? String(agent.mcp_connector_id) : '',
      mcp_connector_checkbox: agent.mcp_connector_checkbox || false,
      knowledge_store_checkbox: agent.knowledge_store_checkbox || false,
      data_store_checkbox: agent.data_store_checkbox || false,
      memory_checkbox: agent.memory_checkbox || false,
      context_checkbox: agent.context_checkbox || false,
      knowledge_store_enabled: knowledgeStoreEnabled,
      knowledge_store_id: knowledgeStoreId || '',
      ai_foundation_enabled:
        agent.ai_foundation && agent.ai_foundation !== 'None',
      model_enabled: !!agent.model,
      model: agent.model || '',
      foundation_resp_ai_toggle: !!agent.foundation_resp_ai,
      foundation_resp_ai_value: agent.foundation_resp_ai || '',
      foundation_ethic_ai_toggle: !!agent.foundation_ethic_ai,
      foundation_ethic_ai_value: agent.foundation_ethic_ai || '',
      foundation_guardrails_ai_toggle: !!agent.foundation_guardrails_ai,
      foundation_guardrails_ai_value: agent.foundation_guardrails_ai || '',
      session_start_url: agent.session_start_url || '',
      session_end_url: agent.session_end_url || '',
      connector,
      internal_tool: (agent.internal_tool as IAgent['internal_tool'])?.map(i => i.tool) || [],
      Iscustomtool: !!connector
    });
    if(connector) {
      this.connectorId.set(connector)
    }
    //console.log('Patched form values:', this.agentForm.getRawValue());

    // Populate selected checkboxes
    this.configuredToolDetails = agent.mcp_connector_value || '';
    this.configuredKGDetails = agent.knowledge_store_value || '';
    this.configuredDataQueryDetails = agent.data_store_value || '';
    this.configuredMemoryDetails = agent.memory_value || '';
    this.configuredContextDetails = agent.context_value || '';

    // Populate selected AI foundations
    const aiFoundationControl = this.agentForm.get(
      'ai_foundation'
    ) as FormArray;
    aiFoundationControl.clear();
    if (agent.ai_foundation && agent.ai_foundation.length > 0) {
      agent.ai_foundation.forEach((feature: any) => {
        const modulesArray = this.fb.array(
          feature.modules.map((m: any) =>
            this.fb.group({
              name: [m.name],
              enabled: [!!m.enabled],
            })
          )
        );
        this.selectedAIFoundations = feature.modules
          .filter((m: any) => m.enabled)
          .map((m: any) => m.name);
        const foundationGroup = this.fb.group({
          type: [feature.type],
          modules: modulesArray,
        });
        aiFoundationControl.push(foundationGroup);
      });
    }
  }

  // Helper methods for AI Foundation checkboxes
  getSelectedAIFoundationsLabel(): string {
    if (this.selectedAIFoundations.length === 0) return '';
    return this.selectedAIFoundations
      .map((f) => this.ai_foundation.find((a) => a.value === f)?.label)
      .filter((l) => l)
      .join(', ');
  }

  isAIFoundationSelected(value: string): boolean {
    return this.selectedAIFoundations.includes(value);
  }

  toggleAIFoundation(value: string, event: any): void {
    if (event.target.checked) {
      if (!this.selectedAIFoundations.includes(value)) {
        this.selectedAIFoundations.push(value);
      }
    } else {
      const index = this.selectedAIFoundations.indexOf(value);
      if (index > -1) {
        this.selectedAIFoundations.splice(index, 1);
      }
    }

    const aiFoundationControl = this.agentForm.get(
      'ai_foundation'
    ) as FormArray;
    aiFoundationControl.clear();

    if (this.selectedAIFoundations.length > 0) {
      const foundationGroup = this.fb.group({
        type: ['SRS'],
        modules: this.fb.array(
          this.selectedAIFoundations.map((f) =>
            this.fb.group({
              name: [f],
              enabled: [true],
            })
          )
        ),
      });
      aiFoundationControl.push(foundationGroup);

      // Enable toggle but do not trigger subscription (already true)
      this.agentForm.get('ai_foundation_enabled')?.enable();
      this.agentForm
        .get('ai_foundation_enabled')
        ?.setValue(true, { emitEvent: false });
    } else {
      // No items → disable toggle and trigger subscription to clear FormArray
      this.agentForm
        .get('ai_foundation_enabled')
        ?.setValue(false, { emitEvent: true });
      this.agentForm.get('ai_foundation_enabled')?.disable();
    }

    this.cdRef.detectChanges();
  }

  openOnboardModalPopup(): void {
    const modal = bootstrap.Modal.getOrCreateInstance(this.onboardAgentModal.nativeElement);
    modal.show();
  }

  openCreateAgentPopup(): void {
    this.initCreateAgentForm();
    this.currentCreateAgentStep = 1;
    this.approvalState = {};
    this.fileError = null;
    this.selectedDays = [];
    this.selectedDates = [];
    this.showDailyTime = false;
    this.showWeeklyTime = false;
    this.showMonthlyTime = false;
    this.showDefaultTime = true;
    this.isEditMode = false;
    this.isEditingName = false;
    this.selectedAgentId = '';
    this.originalAgentName = '';
    this.schedules = [];
    this.hasDailySchedule = false;
    this.hasWeeklySchedule = false;
    this.hasMonthlySchedule = false;
    this.totalPercentage = 0; // Reset totalPercentage
    this.actions.clear(); // Clear actions
    this.newActionForm.reset({ name: '', percentage: '' });
    this.selectedAIFoundations = [];
    this.selectedKnowledgeStore = [];
    this.configuredKGDetails = null;
    this.configuredToolDetails = null;
    this.configuredDataQueryDetails = null;
    this.configuredMemoryDetails = null;
    this.configuredContextDetails = null;
    const modal = bootstrap.Modal.getOrCreateInstance(this.createAgentModal.nativeElement);
    modal.show();
  }


  closeOnboardModal(): void {
    (document.activeElement as HTMLElement)?.blur();
    const modal = bootstrap.Modal.getOrCreateInstance(this.onboardAgentModal.nativeElement);
    modal.hide();
    // // $(this.onboardAgentModal.nativeElement).modal('hide');
    // let modalElement = this.onboardAgentModal.nativeElement;
    // const modal = bootstrap.Modal.getInstance(modalElement);
    // console.log('Closing modal:', modal);
    // modal?.hide();

    // setTimeout(() => {
    //   // document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
    //   // document.body.classList.remove('modal-open');
    // }, 500);
  }

  closeCreateAgentModal(): void {
    (document.activeElement as HTMLElement)?.blur();
    const modal = bootstrap.Modal.getOrCreateInstance(this.createAgentModal.nativeElement);
    modal.hide();
  }

  // openEditModal(agent: any): void {
  //   this.isEditMode = true;
  //   this.isEditingName = false;
  //   this.originalAgentName = agent.name;
  //   this.selectedAgentId = agent.agent_id;

  //   this.selectedDays = [];
  //   this.selectedDates = [];
  //   let schedulerTime: string = '';
  //   this.showWeeklyTime = agent.scheduleFrequency === 'weekly';

  //   this.showDailyTime = agent.scheduleFrequency === 'daily';
  //   this.showWeeklyTime = agent.scheduleFrequency === 'weekly';
  //   this.showMonthlyTime = agent.scheduleFrequency === 'monthly';

  //   if (agent.schedulerTime) {
  //     switch (agent.scheduleFrequency) {
  //       case 'daily':
  //         if (/^\d{2}:\d{2}$/.test(agent.schedulerTime)) {
  //           schedulerTime = agent.schedulerTime;
  //         } else {
  //           const dt = new Date(agent.schedulerTime);
  //           schedulerTime = !isNaN(dt.getTime())
  //             ? dt.toISOString().substring(11, 16)
  //             : '';
  //         }
  //         break;

  //       case 'weekly':
  //         this.selectedDays = Array.isArray(agent.schedulerTime?.days)
  //           ? agent.schedulerTime.days
  //               .map((d: string | number) => Number(d))
  //               .filter((d: number) => !isNaN(d) && d >= 0 && d <= 6)
  //           : [];
  //         schedulerTime = agent.schedulerTime?.time || '00:00';
  //         console.log('Weekly days:', this.selectedDays, 'Time:', schedulerTime);
  //         break;

  //       case 'monthly':
  //         if (agent.schedulerTime?.dates) {
  //           this.selectedDates = agent.schedulerTime.dates;
  //           schedulerTime = agent.schedulerTime.time || '';
  //         } else if (Array.isArray(agent.schedulerTime)) {
  //           this.selectedDates = agent.schedulerTime.map((d: string | Date) =>
  //             typeof d === 'string' ? d.split('T')[0] : d.toISOString().split('T')[0]
  //           );
  //           schedulerTime = '00:00';
  //         } else if (typeof agent.schedulerTime === 'string') {
  //           const [dateStr, timeStr] = agent.schedulerTime.split(' ');
  //           this.selectedDates = [dateStr];
  //           schedulerTime = timeStr || '00:00';
  //         }
  //         break;
  //     }
  //   }
  //   console.log('Dates:', this.selectedDates, 'Time:', schedulerTime);
  //   this.selectedDays = (agent.schedulerTime?.days || []).map((d: string | number) => +d);
  //   console.log('Weekly days:', this.selectedDays, 'Time:', schedulerTime);
  //   this.agentForm.patchValue({
  //     ...agent,
  //     scheduleFrequency: agent.scheduleFrequency || '',
  //     schedulerTime: schedulerTime,
  //     selectedDays: this.selectedDays,
  //     selectedDates: this.selectedDates,
  //     trending: agent.trending,
  //     agent_api_key: agent.agent_api_key,
  //     agent_session_id: agent.agent_session_id,
  //     agent_api_url: agent.agent_api_url,
  //     api_agent_id: agent.api_agent_id,
  //     user_id: agent.user_id,
  //     role_name: agent.role?.agent_role_id || '',
  //     prompt_template: agent.prompt_template || '',
  //     mcp_connector_enabled: agent.mcp_connector_id && agent.mcp_connector_id !== 'None',
  //     mcp_connector_value: agent.mcp_connector_id !== 'None' ? agent.mcp_connector_id : '',
  //     knowledge_store_enabled: agent.knowledge_store_id && agent.knowledge_store_id !== 'None',
  //     knowledge_store_value: agent.knowledge_store_id !== 'None' ? agent.knowledge_store_id : '',
  //     model_enabled: !!agent.model,
  //     model: agent.model || '',
  //     foundation_resp_ai_toggle: !!agent.foundation_resp_ai,
  //     foundation_resp_ai_value: agent.foundation_resp_ai || '',
  //     foundation_ethic_ai_toggle: !!agent.foundation_ethic_ai,
  //     foundation_ethic_ai_value: agent.foundation_ethic_ai || '',
  //     foundation_guardrails_ai_toggle: !!agent.foundation_guardrails_ai,
  //     foundation_guardrails_ai_value: agent.foundation_guardrails_ai || '',
  //     rating: agent.rating || 0,
  //     usage_count: agent.usage_count || 128,
  //     schedulerDays: agent.schedulerDays || [],
  //   });

  //   this.actions.clear();

  //   if (agent.actions && agent.actions.length > 0) {
  //     agent.actions.forEach((a: any) => {
  //       this.actions.push(this.fb.group({
  //         name: [''],
  //         percentage: ['', [Validators.min(0), Validators.max(100)]]
  //       }, { validators: this.requireBothIfOneFilled }));
  //     });
  //   } else {
  //     this.actions.push(this.createAction());
  //   }

  //   this.agentForm.updateValueAndValidity();
  //   this.cdRef.detectChanges();

  //   $(this.editAgentModal.nativeElement).modal('show');
  // }

  closeEditModal(): void {
    this.isEditMode = false;
    $(this.editAgentModal.nativeElement).modal('hide');
  }

  isActiveRoute(route: string): boolean {
    return this._router.url === route;
  }

  home_link(): void {
    this._router.navigate(['/home']);
  }

  testscript_link(): void {
    this._router.navigate(['/commandcenter/testscript']);
  }

  get totalPages(): number {
    return Math.ceil(this.totalItems / this.itemsPerPage);
  }

  get startItem(): number {
    return (this.currentPage - 1) * this.itemsPerPage + 1;
  }

  get endItem(): number {
    return Math.min(this.startItem + this.itemsPerPage - 1, this.totalItems);
  }

  updatePagination(): void {
    const previousTotalItems = this.totalItems;
    this.totalItems = this.filteredAgents.length;
    if (
      previousTotalItems !== this.totalItems &&
      this.currentPage > this.totalPages
    ) {
      this.currentPage = 1;
    }
    this.paginate();
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.paginate();
    }
  }

  paginate(): void {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    this.paginatedAgents = this.filteredAgents.slice(startIndex, endIndex);
  }

  changePageSize(eventTarget: EventTarget | null): void {
    if (eventTarget instanceof HTMLSelectElement) {
      const size = Number(eventTarget.value);
      if (this.pageSizeOptions.includes(size)) {
        this.itemsPerPage = size;
        this.currentPage = 1;
        this.updatePagination();
        this.cdRef.detectChanges();
      }
    }
  }
  showToast(type: 'success' | 'error', message: string): void {
    this.toastMessage = message;
    const toastId = type === 'success' ? '#successToast' : '#errorToast';
    const toastEl = document.querySelector(toastId);
    if (toastEl) {
      const toast = new bootstrap.Toast(toastEl);
      toast.show();
    }
  }

  updateAICapabilityChart(agents: any[]): void {
    if (!agents || agents.length === 0) {
      this.aiCapabilityData = [];
      return;
    }
    const valueCounts: { [label: string]: number } = {};
    const totalAgents = agents.length;
    agents.forEach((agent) => {
      const ksLabel = agent.knowledge_store_id
        ? this.knowledgeStores.find((k) => k.value === agent.knowledge_store_id)
            ?.label
        : null;
      const fields = [
        agent.model_name,
        agent.model,
        agent.mcp_connector_name,
        // Flatten enabled module names into a comma-separated string
        agent.ai_foundation && Array.isArray(agent.ai_foundation)
          ? agent.ai_foundation
              .flatMap(
                (f: any) =>
                  f.modules
                    ?.filter((m: any) => m.enabled)
                    .map((m: any) => m.name) || []
              )
              .join(', ')
          : null,
      ];
      fields.forEach((raw) => {
        let label: string | null = null;
        if (Array.isArray(raw)) {
          const joined = raw.map((v) => String(v).toLowerCase().trim());
          if (
            joined.length === 0 ||
            joined.every((v) =>
              ['none', '', 'null', 'undefined', 'false', '0'].includes(v)
            )
          ) {
            return;
          }
          label = raw.join(', ').trim();
        } else if (typeof raw === 'boolean' || typeof raw === 'number') {
          if (!raw || raw === 0) {
            return;
          }
          label = String(raw).trim();
        } else if (typeof raw === 'string') {
          const lowered = raw.toLowerCase().trim();
          if (
            [
              'none',
              '',
              'null',
              'undefined',
              'false',
              "['none']",
              '["none"]',
              '0',
              '3',
            ].includes(lowered)
          ) {
            return;
          }
          label = raw.trim();
        } else if (raw != null) {
          label = String(raw).trim();
        }
        if (!label) {
          return;
        }
        valueCounts[label] = (valueCounts[label] || 0) + 1;
      });
    });
    this.aiCapabilityData = Object.entries(valueCounts).map(
      ([label, count]) => ({
        label,
        value: count,
        width: ((count / totalAgents) * 100).toFixed(1) + '%',
      })
    );
    this.cdRef.detectChanges();
  }

  updateRoleChart(agents: any[]): void {
    const roleCountMap: { [key: string]: number } = {};
    agents.forEach((agent) => {
      const roleId = agent.role_id;
      if (!roleId || roleId === 'Unknown' || roleId === 'None') return;
      roleCountMap[roleId] = (roleCountMap[roleId] || 0) + 1;
    });
    const roleIds = Object.keys(roleCountMap);
    const data = Object.values(roleCountMap);
    const getRoleLabel = (roleId: string): string => {
      const found = this.rolesList.find((r) => r.value === roleId);
      return found ? found.label : roleId;
    };
    const generateColor = (index: number) => {
      const colors = [
        '#ffe0b2',
        '#ffcc80',
        '#ffb74d',
        '#ffa726',
        '#ff9800',
        '#fb8c00',
        '#f57c00',
      ];
      return colors[index % colors.length];
    };
    this.roleLegendData = roleIds.map((roleId, index) => ({
      label: getRoleLabel(roleId),
      count: roleCountMap[roleId],
      color: generateColor(index),
    }));
    const labels = this.roleLegendData.map((item) => item.label);
    const backgroundColors = this.roleLegendData.map((item) => item.color);
    if (this.roleChart) {
      this.roleChart.destroy();
    }
    const ctx = this.donutCanvas.nativeElement.getContext('2d');
    if (!ctx) return;
    this.roleChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: backgroundColors,
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
      },
      // Add this onClick handler
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const roleId = roleIds[index];
          
          // Toggle filter
          if (this.activeFilters.role === roleId) {
            delete this.activeFilters.role;
          } else {
            this.activeFilters.role = roleId;
            // Clear other filters
            delete this.activeFilters.agency;
            delete this.activeFilters.agentType;
            delete this.activeFilters.aiCapability;
          }
          
          this.applyChartFilters();
        }
      }
    },
  });

  this.cdRef.detectChanges();
}


  updateAgentTypeChart(agents: any[]): void {
    const typeCountMap: { [key: string]: number } = {};
    agents.forEach((agent) => {
      const typeId = agent.agent_type_id;
      if (!typeId || typeId === 'Unknown' || typeId === 'None') return;
      typeCountMap[typeId] = (typeCountMap[typeId] || 0) + 1;
    });
    const typeIds = Object.keys(typeCountMap);
    const data = Object.values(typeCountMap);
    const getTypeLabel = (typeId: string): string => {
      const found = this.agentTypes.find((t) => t.value === typeId);
      return found ? found.label : typeId;
    };
    const generateColor = (index: number) => {
      const colors = [
        '#ffe0b2',
        '#ffcc80',
        '#ffb74d',
        '#ffa726',
        '#ff9800',
        '#fb8c00',
        '#f57c00',
      ];
      return colors[index % colors.length];
    };
    this.agentTypeData = typeIds.map((typeId, index) => ({
      label: this.getAgentTypeLabel(typeId),
      count: typeCountMap[typeId],
      color: generateColor(index),
    }));
    const labels = this.agentTypeData.map((item) => item.label);
    const backgroundColors = this.agentTypeData.map((item) => item.color);
    if (this.agentTypeChart) {
      this.agentTypeChart.destroy();
    }
    const ctx = this.agentTypeCanvas.nativeElement.getContext('2d');
    if (!ctx) return;
    this.agentTypeChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: backgroundColors,
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
      },
      // Add this onClick handler
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const typeId = typeIds[index];
          
          // Toggle filter
          if (this.activeFilters.agentType === typeId) {
            delete this.activeFilters.agentType;
          } else {
            this.activeFilters.agentType = typeId;
            // Clear other filters
            delete this.activeFilters.agency;
            delete this.activeFilters.role;
            delete this.activeFilters.aiCapability;
          }
          
          this.applyChartFilters();
        }
      }
    },
  });

  this.cdRef.detectChanges();
}
  
totalAgentsInAgenciesChart: number = 0;
activeFilters: {
  agency?: string;
  role?: string;
  agentType?: string;
  aiCapability?: string;
} = {};

isUpdatingAgencyChart = false;
agencyData: Array<{ label: string; count: number; color: string }> = [];
mappedAgencyAgentsCount: number = 0;

updateAgencyChart(agents: any[]): void {
  // Create map of agent IDs to agency names
  const agentToAgencyMap = new Map<string, string>();
  this.agenciesWithAgents.forEach(agency => {
    agency.agents?.forEach((agent:any) => {
      agentToAgencyMap.set(agent.agent_id, agency.agency_name);
    });
  });

  // Count agents by agency
  const agencyCountMap: { [key: string]: number } = {};
  let mappedCount = 0; // Track agents with agencies

  agents.forEach(agent => {
    const agencyName = agentToAgencyMap.get(agent.agent_id);
    if (agencyName) {
      mappedCount++;
      agencyCountMap[agencyName] = (agencyCountMap[agencyName] || 0) + 1;
    }
  });

  // Update the count for the chart center
  this.mappedAgencyAgentsCount = mappedCount;

  // Prepare chart data
  const agencyNames = Object.keys(agencyCountMap);
  const data = Object.values(agencyCountMap);
  
  // Generate colors
  const generateColor = (index: number) => {
    const colors = [
       '#ffe0b2',
        '#ffcc80',
        '#ffb74d',
        '#ffa726',
        '#ff9800',
        '#fb8c00',
        '#f57c00',
    ];
    return colors[index % colors.length];
  };
  
  this.agencyData = agencyNames.map((agencyName, index) => ({
    label: agencyName,
    count: agencyCountMap[agencyName],
    color: generateColor(index)
  }));

  // Create chart
  const labels = this.agencyData.map(item => item.label);
  const backgroundColors = this.agencyData.map(item => item.color);
  
  if (this.agencyChart) {
    this.agencyChart.destroy();
  }
  
  const ctx = this.agencyCanvas.nativeElement.getContext('2d');
  if (!ctx) return;
  
  this.agencyChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: backgroundColors,
        borderColor: '#fff',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true }
      },
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const agencyName = agencyNames[index];
          
          if (this.activeFilters.agency === agencyName) {
            delete this.activeFilters.agency;
          } else {
            this.activeFilters.agency = agencyName;
            // Clear other filters
            delete this.activeFilters.role;
            delete this.activeFilters.agentType;
            delete this.activeFilters.aiCapability;
          }
          
          this.applyChartFilters();
        }
      }
    }
  });
  
  this.cdRef.detectChanges();
}

destroyAgencyChart(): void {
  if (this.agencyChart) {
    this.agencyChart.destroy();
    this.agencyChart = null;
  }
}


toggleAgencyFilter(agencyName: string): void {
  if (this.activeFilters.agency === agencyName) {
    delete this.activeFilters.agency;
  } else {
    this.activeFilters.agency = agencyName;
    // Clear other filters
    delete this.activeFilters.role;
    delete this.activeFilters.agentType;
    delete this.activeFilters.aiCapability;
  }
  this.applyChartFilters();
}

applyChartFilters(): void {
  let filtered = [...this.currentTabAgents];

  if (this.activeFilters.agency) {
    filtered = filtered.filter((agent: any) => {
      const agency = this.agenciesWithAgents.find((a: any) => 
        a.agency_name === this.activeFilters.agency || a.agency_id === this.activeFilters.agency
      );
      
      if (!agency || !agency.agents) return false;
    
      return agency.agents.some((a: any) => {
        return a.agent_id === agent.agent_id && 
               a.name === agent.name &&
               a.agent_type_id === agent.agent_type_id &&
               a.role_id === agent.role_id;
      });
    });
  }
  
  // Apply role filter if set
  if (this.activeFilters.role) {
    filtered = filtered.filter((agent: any) => agent.role_id === this.activeFilters.role);
  }
  
  // Apply agent type filter if set
  if (this.activeFilters.agentType) {
    filtered = filtered.filter((agent: any) => agent.agent_type_id === this.activeFilters.agentType);
  }
  
  // Apply AI capability filter if set
  if (this.activeFilters.aiCapability) {
    filtered = filtered.filter((agent: any) => {
      const ksLabel = agent.knowledge_store_id
        ? this.knowledgeStores.find((k: any) => k.value === agent.knowledge_store_id)?.label
        : null;
      
      return (
        agent.model_name === this.activeFilters.aiCapability ||
        agent.model === this.activeFilters.aiCapability ||
        ksLabel === this.activeFilters.aiCapability ||
        agent.mcp_connector_name === this.activeFilters.aiCapability ||
        (agent.ai_foundation && Array.isArray(agent.ai_foundation) &&
          agent.ai_foundation.some((f: any) => 
            f.modules?.some((m: any) => m.enabled && m.name === this.activeFilters.aiCapability)
          )
        )
      );
    });
  }
  
  // Update filtered agents and refresh the UI
  this.filteredAgentsMap[this.activeTabKey] = filtered;
  this.applySearch();
  this.updatePagination();
  this.updateRoleChart(filtered);
  this.updateAICapabilityChart(filtered);
  this.updateAgentTypeChart(filtered);
  this.updateAgencyChart(filtered);
}

toggleAICapabilityFilter(capability: string): void {
  // Toggle filter
  if (this.activeFilters.aiCapability === capability) {
    delete this.activeFilters.aiCapability;
  } else {
    this.activeFilters.aiCapability = capability;
    // Clear other filters
    delete this.activeFilters.agency;
    delete this.activeFilters.role;
    delete this.activeFilters.agentType;
  }
  
  this.applyChartFilters();
}

toggleRoleFilter(roleLabel: string): void {
  // Get the role ID from the label
  const roleId = this.getRoleIdByLabel(roleLabel);
  
  // Toggle filter
  if (this.activeFilters.role === roleId) {
    delete this.activeFilters.role;
  } else {
    this.activeFilters.role = roleId;
    // Clear other filters
    delete this.activeFilters.agency;
    delete this.activeFilters.agentType;
    delete this.activeFilters.aiCapability;
  }
  
  this.applyChartFilters();
}

toggleAgentTypeFilter(typeLabel: string): void {
  const typeId = this.getAgentTypeIdByLabel(typeLabel);
  
  // Toggle filter
  if (this.activeFilters.agentType === typeId) {
    delete this.activeFilters.agentType;
  } else {
    this.activeFilters.agentType = typeId;
    // Clear other filters
    delete this.activeFilters.agency;
    delete this.activeFilters.role;
    delete this.activeFilters.aiCapability;
  }
  
  this.applyChartFilters();
}

// Helper methods to get IDs from labels
getRoleIdByLabel(label: string): string {
  const role = this.rolesList.find(r => r.label === label);
  return role ? role.value : '';
}

getAgentTypeIdByLabel(label: string): string {
  const agentType = this.agentTypes.find(t => t.label === label);
  return agentType ? agentType.value : '';
}

applyFilters(): void {
  this.activeFilters = {};
  const filters = this.filterForm.value;
  const filtered = this.currentTabAgents.filter((agent) => {
    return (
      (!filters.agent_id || agent.agent_id === filters.agent_id) &&
      (!filters.role_id || agent.role_id === filters.role_id) &&
      (!filters.mcp_connector_id ||
        agent.mcp_connector_id === filters.mcp_connector_id) &&
      (!filters.knowledge_store_id ||
        agent.knowledge_store_id === filters.knowledge_store_id) &&
      (!filters.model || agent.model === filters.model) &&
      (!filters.foundation ||
        agent.ai_foundation?.some((f: any) =>
          f.modules?.some((m: any) => m.name === filters.foundation)
        )) &&
      (!filters.agent_type_id ||
        agent.agent_type_id === filters.agent_type_id)
    );
  });
  this.filteredAgentsMap[this.activeTabKey] = filtered;
  this.applySearch();
  this.updatePagination();
  this.updateRoleChart(this.filteredAgents);
  this.updateAICapabilityChart(this.filteredAgents);
  this.updateAgentTypeChart(this.filteredAgents);
  // Pass the filtered agents to updateAgencyChart
  this.updateAgencyChart(this.filteredAgents);
  $('#filt').modal('hide');
}
  openFilterModal(): void {
    if (this.filterModalRef && this.filterModalRef.nativeElement) {
      const modal = new bootstrap.Modal(this.filterModalRef.nativeElement);
      modal.show();
    }
  }

  clearFilters(): void {
    this.filterForm.reset({
      agent_id: '',
      role_id: '',
      mcp_connector_id: '',
      knowledge_store_id: '',
      model: '',
      ai_foundation: '',
      agent_type_id: '',
    });
    this.filteredAgentsMap[this.activeTabKey] = [...this.currentTabAgents];
    this.applySearch();
    this.updatePagination();
    this.updateRoleChart(this.filteredAgents);
    this.updateAICapabilityChart(this.filteredAgents);
    this.updateAgentTypeChart(this.filteredAgents);
      this.updateAgencyChart(this.filteredAgents);
  }

  // Knowledge Graph Configuration Methods
  openConfigureKGModal( event: any, action: string): void {
    if (action === 'add') {
      if (event.target.checked){
      this.kgConfigForm.reset({
        kgType: 'RAG',
        knowledgeBaseId: '',
        numberOfChunks: 5,
        retrievalType: 'Basic',
        scoreThreshold: 0.0,
      });
      const modal = new bootstrap.Modal(document.getElementById('configureKGModal'));
      modal.show();
      } else {
        // If toggled off, clear any existing configuration
        this.kgConfigForm.reset({
          kgType: 'RAG',
          knowledgeBaseId: '',
          numberOfChunks: 5,
          retrievalType: 'Basic',
          scoreThreshold: 0.0,
        });
        this.configuredKGDetails = null;
        this.configuredAgenticRAGs = [];
        this.newAgenticRAGForm.reset({
          knowledgeBaseId: '',
          numberOfChunks: 5,
          retrievalType: 'Basic',
          scoreThreshold: 0.0,
        });
      }
    }
    else{
      // edit mode - open modal with existing config
      
      if (this.configuredKGDetails?.type==='RAG'){
        this.kgConfigForm.patchValue({
          kgType: this.configuredKGDetails?.type || 'RAG',
          knowledgeBaseId: this.configuredKGDetails?.data?._id || '',
          numberOfChunks: this.configuredKGDetails?.chunks || 5,
          retrievalType: 'Basic',
          scoreThreshold: 0.0,
        });
      }
      else{
        //console.log('No existing RAG configuration found, opening with default values.');
        this.kgConfigForm.reset({
          kgType: 'Agentic RAG',
          knowledgeBaseId: '',
          numberOfChunks: 5,
          retrievalType: 'Basic',
          scoreThreshold: 0.0,
        });
        this.newAgenticRAGForm.reset({
          knowledgeBaseId: '',
          numberOfChunks: 5,
          retrievalType: 'Basic',
          scoreThreshold: 0.0,
        });
        this.configuredAgenticRAGs= this.configuredKGDetails?.data || [];
      }
      
      // this.kgConfigForm.reset({
      //   kgType: 'RAG',
      //   knowledgeBaseId: '',
      //   numberOfChunks: 5,
      //   retrievalType: 'Basic',
      //   scoreThreshold: 0.0,
      // });
      // this.configuredKGDetails = null;
      const modal = new bootstrap.Modal(document.getElementById('configureKGModal'));
      modal.show();
    }

  }

  resetKGConfigForm(): void {
    if (this.configuredKGDetails || this.configuredAgenticRAGs.length > 0) {
      return;
    }
    this.configuredAgenticRAGs = [];
    this.kgConfigForm.reset({
      kgType: 'RAG',
      knowledgeBaseId: '',
      numberOfChunks: 5,
      retrievalType: 'Basic',
      scoreThreshold: 0.0,
    });
    this.newAgenticRAGForm.reset({
      knowledgeBaseId: '',
      numberOfChunks: 5,
      retrievalType: 'Basic',
      scoreThreshold: 0.0,
    });
    this.configuredKGDetails = null;
    this.agentForm.get('knowledge_store_checkbox')?.setValue(false, { emitEvent: true });
    this.createAgentForm.get('knowledge_store_checkbox')?.setValue(false, { emitEvent: true });
  }

  saveKGConfiguration(): void {
    if (this.kgConfigForm.invalid) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.kgConfigForm.controls).forEach(key => {
        this.kgConfigForm.get(key)?.markAsTouched();
      });
      return;
    }

    const kgConfig = this.kgConfigForm.value;
    //console.log('Saving KG Configuration:', kgConfig);

    // Find the selected knowledge base name
    const selectedKB = this.kgsFromLyzr.find((kb: any) => kb._id === kgConfig.knowledgeBaseId);
    const kbName = selectedKB?.name || 'Unknown';

    // Store the configuration details for display
    this.configuredKGDetails = {
      name: kbName,
      chunks: kgConfig.numberOfChunks,
      type: kgConfig.kgType,
      data: selectedKB
    };

    //console.log('Configured KG Details:', this.configuredKGDetails);

    // Show success toast
    this.toastMessage = 'Knowledge Graph configuration saved successfully!';
    const successToast = new bootstrap.Toast(document.getElementById('successToast')!);
    successToast.show();

    // Dismiss the modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('configureKGModal'));
    modal?.hide();

    // Reset form
    this.kgConfigForm.reset({
      kgType: 'RAG',
      knowledgeBaseId: '',
      numberOfChunks: 5,
      retrievalType: 'Basic',
      scoreThreshold: 0.0,
    });
  }

  addAgenticRAG(): void {
    if (this.newAgenticRAGForm.invalid) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.newAgenticRAGForm.controls).forEach(key => {
        this.newAgenticRAGForm.get(key)?.markAsTouched();
      });
      return;
    }

    const ragConfig = this.newAgenticRAGForm.value;
    const selectedKB = this.kgsFromLyzr.find((kb: any) => kb._id === ragConfig.knowledgeBaseId);
    
    if (selectedKB) {
      const newRAG = {
        id: Date.now(), // Unique ID for each RAG
        name: selectedKB.name,
        knowledgeBaseId: ragConfig.knowledgeBaseId,
        numberOfChunks: ragConfig.numberOfChunks,
        retrievalType: ragConfig.retrievalType,
        scoreThreshold: ragConfig.scoreThreshold,
        data: selectedKB
      };

      this.configuredAgenticRAGs.push(newRAG);

      // Reset form for next entry
      this.newAgenticRAGForm.reset({
        knowledgeBaseId: '',
        numberOfChunks: 5,
        retrievalType: 'Basic',
        scoreThreshold: 0.0,
      });

      // Show success toast
      this.toastMessage = `RAG "${selectedKB.name}" added successfully!`;
      const successToast = new bootstrap.Toast(document.getElementById('successToast')!);
      successToast.show();
    }
  }

  removeAgenticRAG(ragId: number): void {
    const index = this.configuredAgenticRAGs.findIndex(rag => rag.id === ragId);
    if (index > -1) {
      const removedRAG = this.configuredAgenticRAGs[index];
      this.configuredAgenticRAGs.splice(index, 1);
      
      this.toastMessage = `RAG "${removedRAG.name}" removed successfully!`;
      const successToast = new bootstrap.Toast(document.getElementById('successToast')!);
      successToast.show();
    }
  }

  saveAgenticRAGConfiguration(): void {
    if (this.configuredAgenticRAGs.length === 0) {
      this.toastMessage = 'Please add at least one RAG before saving!';
      const errorToast = new bootstrap.Toast(document.getElementById('errorToast')!);
      errorToast.show();
      return;
    }

    // Store the configuration details for display
    this.configuredKGDetails = {
      name: `Agentic RAG (${this.configuredAgenticRAGs.length} RAGs)`,
      chunks: this.configuredAgenticRAGs.reduce((sum, rag) => sum + rag.numberOfChunks, 0),
      type: 'Agentic RAG',
      data: this.configuredAgenticRAGs
    };

    // Show success toast
    this.toastMessage = 'Agentic RAG configuration saved successfully!';
    const successToast = new bootstrap.Toast(document.getElementById('successToast')!);
    successToast.show();

    // Dismiss the modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('configureKGModal'));
    modal?.hide();
  }

  resetKGConfigFormAndRAGs(): void {
    this.configuredAgenticRAGs = [];
    this.newAgenticRAGForm.reset({
      knowledgeBaseId: '',
      numberOfChunks: 5,
      retrievalType: 'Basic',
      scoreThreshold: 0.0,
    });
    this.kgConfigForm.reset({
      kgType: 'RAG',
      knowledgeBaseId: '',
      numberOfChunks: 5,
      retrievalType: 'Basic',
      scoreThreshold: 0.0,
    });
    this.configuredKGDetails = null;
    this.agentForm.get('knowledge_store_checkbox')?.setValue(false, { emitEvent: true });
    this.createAgentForm.get('knowledge_store_checkbox')?.setValue(false, { emitEvent: true });
  }

  openCreateKnowledgeBase(): void {
    //console.log('Opening Create Knowledge Base modal');
    // This will open a new knowledge base creation dialog
    // You can implement this as a separate modal or navigate to a KB management page
    this.toastMessage = 'Knowledge Base creation feature coming soon!';
    const infoToast = new bootstrap.Toast(document.getElementById('successToast')!);
    infoToast.show();
  }

  refreshKnowledgeStores(): void {
    //refresh logic
  }

  // Tools Configuration Methods
  openConfigureToolsModal(event: any, action:string): void {
    if (action === 'add') {
      if (event.target.checked){
      this.toolsConfigForm.reset({
        toolId: '',
        toolEnabled: true,
      });
      const modal = new bootstrap.Modal(document.getElementById('configureToolsModal'));
      modal.show();
      } else {
        // If toggled off, clear any existing configuration
        this.toolsConfigForm.reset({
          toolId: '',
          toolEnabled: false,
        });
        this.configuredToolDetails = null;
      }
    }
    else{
      // edit mode - open modal with existing config
      this.toolsConfigForm.patchValue({
        toolId: this.configuredToolDetails?.name || '',
        toolEnabled: true,
      });
      const modal = new bootstrap.Modal(document.getElementById('configureToolsModal'));
      modal.show();
    }
  }

  resetToolsConfigForm(): void {
    if (this.configuredToolDetails){
      return;
    }
    this.toolsConfigForm.reset({
      toolId: '',
      toolEnabled: false,
    });
    this.configuredToolDetails = null;
    this.agentForm.get('mcp_connector_checkbox')?.setValue(false, { emitEvent: true });
    this.createAgentForm.get('mcp_connector_checkbox')?.setValue(false, { emitEvent: true });
  }

  connectTool(): void {
    if (this.toolsConfigForm.invalid) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.toolsConfigForm.controls).forEach(key => {
        this.toolsConfigForm.get(key)?.markAsTouched();
      });
      return;
    }

    const toolConfig = this.toolsConfigForm.value;
    //console.log('Connecting Tool:', toolConfig);

    // Find the selected tool name
    const selectedToolId = toolConfig.toolId;
    const toolName = selectedToolId; // In a real scenario, lookup the tool name from mcpConnectors array
    let selectedToolData = this.toolsFromLyzr.find((tool: any) => tool.tool_id === selectedToolId);

    // Store the configuration details for display
    this.configuredToolDetails = {
      name: toolName,
      data: selectedToolData
    };

    //console.log('Configured Tool Details:', this.configuredToolDetails);

    // Show success toast
    this.toastMessage = 'Tool connected successfully!';
    const successToast = new bootstrap.Toast(document.getElementById('successToast')!);
    successToast.show();

    // Dismiss the modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('configureToolsModal'));
    modal?.hide();

    // Reset form
    this.toolsConfigForm.reset({
      toolId: '',
      toolEnabled: true,
    });
  }

  refreshTools(): void {
    //console.log('Refreshing tools list');
    // Trigger refresh logic for tools/MCP connectors
    this.toastMessage = 'Tools list refreshed!';
    const infoToast = new bootstrap.Toast(document.getElementById('successToast')!);
    infoToast.show();
  }

  openConfigureMoreTools(): void {
    //console.log('Opening Configure More Tools');
    // This can open a separate tools management page or modal
    this.toastMessage = 'Tools management feature coming soon!';
    const infoToast = new bootstrap.Toast(document.getElementById('successToast')!);
    infoToast.show();
  }

  // Data Query Configuration Methods
  openConfigureDataQueryModal(event: any, action: string): void {
    if (action === 'add') {
      if (event.target.checked){
      this.dataQueryConfigForm.reset({
        semanticDataModelId: '',
        maxTries: 3,
        generationTimeLimit: 60,
        autoTrain: false,
      });
      const modal = new bootstrap.Modal(document.getElementById('configureDataQueryModal'));
      modal.show();
        } else {
      // If toggled off, clear any existing configuration
      this.dataQueryConfigForm.reset({
        semanticDataModelId: '',
        maxTries: 3,
        generationTimeLimit: 60,
        autoTrain: false,
      });
      this.configuredDataQueryDetails = null;
      }
    }
    else{
      // edit mode - open modal with existing config
      this.dataQueryConfigForm.patchValue({
        semanticDataModelId: this.configuredDataQueryDetails?.data?._id || '',
        maxTries: this.configuredDataQueryDetails?.maxTries || 3,
        generationTimeLimit: this.configuredDataQueryDetails?.timeLimit || 60
      });
      // this.dataQueryConfigForm.reset({
      //   semanticDataModelId: '',
      //   maxTries: 3,
      //   generationTimeLimit: 60,
      //   autoTrain: false,
      // });
      // this.configuredDataQueryDetails = null;
      const modal = new bootstrap.Modal(document.getElementById('configureDataQueryModal'));
      modal.show();
    }
  }

  resetDataQueryConfigForm(): void {
    if (this.configuredDataQueryDetails){
      return;
    }
    this.dataQueryConfigForm.reset({
      semanticDataModelId: '',
      maxTries: 3,
      generationTimeLimit: 60,
      autoTrain: false,
    });
    this.configuredDataQueryDetails = null;
    this.agentForm.get('data_store_checkbox')?.setValue(false, { emitEvent: true });
    this.createAgentForm.get('data_store_checkbox')?.setValue(false, { emitEvent: true });
  }

  saveDataQueryConfiguration(): void {
    if (this.dataQueryConfigForm.invalid) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.dataQueryConfigForm.controls).forEach(key => {
        this.dataQueryConfigForm.get(key)?.markAsTouched();
      });
      return;
    }

    const dataQueryConfig = this.dataQueryConfigForm.value;
    //console.log('Saving Data Query Configuration:', dataQueryConfig);

    const selectedDataConfig = this.semanticDataModels.find((dq: any) => dq._id === dataQueryConfig.semanticDataModelId);

    // Store the configuration details for display
    this.configuredDataQueryDetails = {
      model: selectedDataConfig?.collection_name || 'Unknown',
      maxTries: dataQueryConfig.maxTries,
      timeLimit: dataQueryConfig.generationTimeLimit,
      data: selectedDataConfig
    };

    //console.log('Configured Data Query Details:', this.configuredDataQueryDetails);

    // Show success toast
    this.toastMessage = 'Data Query configuration saved successfully!';
    const successToast = new bootstrap.Toast(document.getElementById('successToast')!);
    successToast.show();

    // Dismiss the modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('configureDataQueryModal'));
    modal?.hide();

    // Reset form
    this.dataQueryConfigForm.reset({
      semanticDataModelId: '',
      maxTries: 3,
      generationTimeLimit: 60,
      autoTrain: false,
    });
  }

  openMemoryConfigurationModal(event: any, action: string): void {
    if (action === 'add') {
      if (event.target.checked){
      this.memoryConfigForm.reset({
        memoryProvider: '',
        crossSession: false,
        extractionInstructions: '',
      });
      const modal = new bootstrap.Modal(document.getElementById('configureMemoryModal'));
      modal.show();
    } else {
      this.memoryConfigForm.reset({
        memoryProvider: '',
        crossSession: false,
        extractionInstructions: '',
      });
      this.configuredMemoryDetails = null;
    }
    }
    else{
      // edit mode - open modal with existing config
      this.memoryConfigForm.patchValue({
        memoryProvider: this.configuredMemoryDetails?.data._id || '',
        crossSession: this.configuredMemoryDetails?.crossSession || false,
        extractionInstructions: this.configuredMemoryDetails?.extractionInstructions || '',
      });
      // this.configuredMemoryDetails = null;
      const modal = new bootstrap.Modal(document.getElementById('configureMemoryModal'));
      modal.show();
    }
  }

  resetMemoryConfigForm(): void {
    if (this.configuredMemoryDetails){
      return;
    }
    this.memoryConfigForm.reset({
      memoryProvider: '',
      crossSession: false,
      extractionInstructions: '',
    });
    this.configuredMemoryDetails = null;
    this.agentForm.get('memory_checkbox')?.setValue(false, { emitEvent: true });
  }

  saveMemoryConfiguration(): void {
    if (this.memoryConfigForm.invalid) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.memoryConfigForm.controls).forEach(key => {
        this.memoryConfigForm.get(key)?.markAsTouched();
      });
      return;
    }

    const memoryConfig = this.memoryConfigForm.value;
    //console.log('Saving Memory Configuration:', memoryConfig);
    const selectedMemoryProvider = this.providerMemoryFromLyzr.find((mp: any) => mp._id === memoryConfig.memoryProvider);

    // Store the configuration details for display
    this.configuredMemoryDetails = {
      provider: selectedMemoryProvider?.provider_id || 'Unknown',
      crossSession: memoryConfig.crossSession,
      extractionInstructions: memoryConfig.extractionInstructions,
      data: selectedMemoryProvider
    };

    //console.log('Configured Memory Details:', this.configuredMemoryDetails);

    // Show success toast
    this.toastMessage = 'Memory configuration saved successfully!';
    const successToast = new bootstrap.Toast(document.getElementById('successToast')!);
    successToast.show();

    // Dismiss the modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('configureMemoryModal'));
    modal?.hide();

    // Reset form
    this.memoryConfigForm.reset({
      memoryProvider: '',
      crossSession: false,
      extractionInstructions: '',
    });
  }

  resetContextConfigForm(): void {
    if (this.configuredContextDetails){
      return;
    }
    //console.log('Resetting context configuration form and details', this.configuredContextDetails, this.contextConfigForm.value);
    this.contextConfigForm.reset({
      context_id: '',
    });
    this.configuredContextDetails = null;
    this.agentForm.get('context_checkbox')?.setValue(false, { emitEvent: true });
    this.createAgentForm.get('context_checkbox')?.setValue(false, { emitEvent: true });
  }

  saveContextConfiguration(): void {
    if (this.contextConfigForm.invalid) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.contextConfigForm.controls).forEach(key => {
        this.contextConfigForm.get(key)?.markAsTouched();
      });
      return;
    }

    const contextConfig = this.contextConfigForm.value;
    //console.log('Saving Context Configuration:', contextConfig);

    const contextData = this.contextsFromLyzr.find((ctx: any) => ctx._id === contextConfig.context_id);

    // Store the configuration details for display
    this.configuredContextDetails = {
      id: contextConfig.context_id,
      name : contextData?.name || 'Unknown',
      data: contextData
    };

    //console.log('Configured Context Details:', this.configuredContextDetails);

    // Show success toast
    this.toastMessage = 'Context configuration saved successfully!';
    const successToast = new bootstrap.Toast(document.getElementById('successToast')!);
    successToast.show();

    // Dismiss the modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('configureContextModal'));
    modal?.hide();

    // Reset form
    this.contextConfigForm.reset({
      context_id: ''
    });
  }

  refreshContexts(): void {
    //console.log('Refreshing contexts');
    this.loadContextsFromLyzr();
    this.toastMessage = 'Contexts list refreshed!';
    const infoToast = new bootstrap.Toast(document.getElementById('successToast')!);
    infoToast.show();
  }

  openContextConfigurationModal(event: any, action: string): void {
    if (action === 'add') {
      if (event.target.checked){
      this.contextConfigForm.reset({
        context_id: '',
      });
      const modal = new bootstrap.Modal(document.getElementById('configureContextModal'));
      modal.show();
    } else {
      this.contextConfigForm.reset({
        context_id: '',
      });
      this.configuredContextDetails = null;
    }
    }
    else{
      // edit mode - open modal with existing config
      this.contextConfigForm.patchValue({
        context_id: this.configuredContextDetails?.data._id || '',
      });
      // this.contextConfigForm.reset({
      //   context_id: '',
      // });
      // this.configuredContextDetails = null;
      const modal = new bootstrap.Modal(document.getElementById('configureContextModal'));
      modal.show();
    }
  }

  openManageContexts(): void {
    //console.log('Opening manage contexts');
    // This would navigate to context management or open a configuration page
    this.toastMessage = 'Opening context management...';
    const infoToast = new bootstrap.Toast(document.getElementById('successToast')!);
    infoToast.show();
  }

  refreshSemanticModels(): void {
    //console.log('Refreshing semantic data models');
    // Trigger refresh logic for semantic models
    this.toastMessage = 'Semantic models list refreshed!';
    const infoToast = new bootstrap.Toast(document.getElementById('successToast')!);
    infoToast.show();
  }

  openCreateSemanticModel(): void {
    //console.log('Opening Create Semantic Model');
    // This can open a separate semantic model creation page or modal
    this.toastMessage = 'Semantic model creation feature coming soon!';
    const infoToast = new bootstrap.Toast(document.getElementById('successToast')!);
    infoToast.show();
  }

  applySearch(): void {
    const term = this.searchTerm.trim().toLowerCase();
    this.tabSearchTerms[this.activeTabKey] = term;

    const sourceList =
      this.filteredAgentsMap[this.activeTabKey] ?? this.currentTabAgents;

    if (term === '') {
      this.searchResultsMap[this.activeTabKey] = [...sourceList];
    } else {
      const matches = (field: string | undefined | null) => {
        const value = field?.toString().trim().toLowerCase();
        return value === term || value?.includes(term);
      };

      this.searchResultsMap[this.activeTabKey] = sourceList.filter((agent) => {
        // search inside AI foundation modules
        const foundationMatches =
          agent.ai_foundation?.some((f: any) =>
            f.modules?.some((m: any) => matches(m.name) && m.enabled)
          ) ?? false;

        // search inside knowledge store object/array
        let knowledgeStoreMatches = false;

        if (agent.knowledge_store_id) {
          const ks = this.knowledgeStores.find(
            (k) => k.value === agent.knowledge_store_id
          );
          const ksLabel = ks ? ks.label : ''; // <-- force a string
          knowledgeStoreMatches =
            !!matches(agent.knowledge_store_id) || !!matches(ksLabel);
        }

        return (
          matches(agent.agent_id) ||
          matches(agent.name) ||
          matches(agent.role_id) ||
          matches(agent.role_name) ||
          matches(agent.model) ||
          matches(agent.model_name) ||
          matches(agent.mcp_connector_id) ||
          matches(agent.mcp_connector_name) ||
          knowledgeStoreMatches ||
          matches(agent.description) ||
          matches(agent.version) ||
          matches(agent.agent_role) ||
          matches(agent.agent_goal) ||
          matches(agent.agent_type_id) ||
          matches(agent.agent_type_name) ||
          foundationMatches
        );
      });
    }

    this.filteredAgents = [...this.searchResultsMap[this.activeTabKey]];
    this.updatePagination();
    this.updateRoleChart(this.filteredAgents);
    this.updateAICapabilityChart(this.filteredAgents);
    this.updateAgentTypeChart(this.filteredAgents);
    this.updateAgencyChart(this.filteredAgents);
  }
    

  getMcpConnectorLabel(id: string): string {
    const found = this.mcpConnectors.find((conn) => conn.value === id);
    return found ? found.label : id;
  }

  getKnowledgeStoreLabel(id: string): string {
    const found = this.knowledgeStores.find((store) => store.value === id);
    return found ? found.label : id || 'Unknown';
  }

  getAgentTypeLabel(id: string): string {
    const found = this.agentTypesList.find((t) => t.value === id);
    return found ? found.label : id;
  }

  getModelLabel(id: string): string {
    const found = this.modelsList.find((model) => model.value === id);
    return found ? found.label : id;
  }

  getFilteredRoles() {
    const roleIds = new Set(this.currentTabAgents.map((a) => a.role_id));
    return this.rolesList.filter((role) => roleIds.has(role.value));
  }

  getFilteredMcpConnectors() {
    const mcpIds = new Set(
      this.currentTabAgents.map((a) => a.mcp_connector_id)
    );
    return this.mcpConnectors.filter((mcp) => mcpIds.has(mcp.value));
  }

  getFilteredModels() {
    const modelValues = new Set(
      this.currentTabAgents.map((a) => a.model).filter(Boolean)
    );
    return this.modelsList.filter((model) => modelValues.has(model.value));
  }

  getFilteredAgentTypes(): any[] {
    const typeIds = new Set(
      this.currentTabAgents
        .map((agent) => agent.agent_type_id)
        .filter((id) => id)
    );
    return this.agentTypes.filter((type) => typeIds.has(type.value));
  }

  getFilteredKnowledgeStores(): any[] {
    const ksIds = new Set(
      this.currentTabAgents
        .map((agent) => agent.knowledge_store_id)
        .filter((id) => id && id !== 'None')
    );
    return this.knowledgeStores.filter((ks) => ksIds.has(ks.value));
  }

  getFilteredFoundations(): any[] {
    const foundations: any[] = [];
    this.currentTabAgents.forEach((agent) => {
      if (agent.ai_foundation && Array.isArray(agent.ai_foundation)) {
        agent.ai_foundation.forEach((ai_foundation: any) => {
          if (ai_foundation.modules && ai_foundation.modules.length > 0) {
            ai_foundation.modules.forEach((m: any) => {
              if (m.name && m.enabled) {
                // only take enabled modules
                foundations.push({ value: m.name, label: m.name });
              }
            });
          }
        });
      }
    });

    // remove duplicates
    const unique = new Map(foundations.map((f) => [f.value, f]));
    return Array.from(unique.values());
  }

  getAgentCounts(): void {
    this._marketService.getAgentCounts().subscribe({
      next: (response) => {
        if (response.success) {
          // this.agentCountsList = this.agentCountsList.map(item => ({
          // ...item,
          // count: response.counts[item.key] || 0
          // }));
          // this.cdRef.detectChanges();
        }
      },
      error: (err) => {
        console.error('Error fetching agent counts:', err);
      },
    });
  }

setActiveCountTab(index: number): void {
  if (this.activeTabKey) {
    this.tabFilterValues[this.activeTabKey] = this.filterForm.value;
    this.tabSearchTerms[this.activeTabKey] = this.searchTerm;
  }
  this.agentCountsList.forEach((item, i) => (item.active = i === index));
  this.activeTabKey = this.agentCountsList[index].key;
  
  // Clear active filters when switching tabs
  this.activeFilters = {};
  
  switch (this.activeTabKey) {
    case 'active_agents':
      this.currentTabAgents = this.allAgents.filter(
        (agent) => agent.status?.toLowerCase() === 'active'
      );
      break;
    case 'trending_agents':
      this.currentTabAgents = this.allAgents.filter(
        (agent) => agent.trending === true
      );
      break;
    default:
      this.currentTabAgents = [...this.allAgents];
  }
  const savedValues = this.tabFilterValues[this.activeTabKey];
  if (savedValues) {
    this.filterForm.patchValue(savedValues);
    const filtered = this.currentTabAgents.filter((agent) => {
      return (
        (!savedValues.agent_id || agent.agent_id === savedValues.agent_id) &&
        (!savedValues.role_id || agent.role_id === savedValues.role_id) &&
        (!savedValues.mcp_connector_id ||
          agent.mcp_connector_id === savedValues.mcp_connector_id) &&
        (!savedValues.knowledge_store_id ||
          agent.knowledge_store_id === savedValues.knowledge_store_id) &&
        (!savedValues.model || agent.model === savedValues.model) &&
        (!savedValues.agent_type_id ||
          agent.agent_type_id === savedValues.agent_type_id) &&
        (!savedValues.foundation ||
          agent.foundation_resp_ai === savedValues.foundation ||
          agent.foundation_ethic_ai === savedValues.foundation ||
          agent.foundation_guardrails_ai === savedValues.foundation)
      );
    });
    this.filteredAgentsMap[this.activeTabKey] = filtered;
  } else {
    this.filterForm.reset({
      agent_id: '',
      role_id: '',
      mcp_connector_id: '',
      knowledge_store_id: '',
      model: '',
      ai_foundation: '',
      agent_type_id: '',
    });

    this.filteredAgentsMap[this.activeTabKey] = [...this.currentTabAgents];
  }
  this.searchTerm = this.tabSearchTerms[this.activeTabKey] || '';
  if (this.searchTerm) {
    this.applySearch();
  } else {
    this.filteredAgents = [...this.filteredAgentsMap[this.activeTabKey]];
    this.updatePagination();
    this.updateRoleChart(this.filteredAgents);
    this.updateAICapabilityChart(this.filteredAgents);
    this.updateAgentTypeChart(this.filteredAgents);
    // Call updateAgencyChart without arguments to reset it properly
    this.updateAgencyChart(this.filteredAgents);
  }
}
  toggleSidePanel(panel: 'left' | 'right') {
    if (panel === 'left') {
      this.isSideCollapsed = !this.isSideCollapsed;
      if (!this.isSideCollapsed) {
        this.isRightCollapsed = true;
        this.updateRoleChart(this.allAgents);
      }
    } else {
      this.isRightCollapsed = !this.isRightCollapsed;
      if (!this.isRightCollapsed) {
        this.isSideCollapsed = true;
      }
    }
  }

  get isExternalAgent(): boolean {
    const owner = this.agentForm?.get('agent_owner')?.value;
    return owner?.trim().toLowerCase() === 'external';
  }

  get isVoiceAgent(): boolean { 
    return this.agentForm?.get('agent_type_id')?.value === 'VOICE_AGENT'
  }

  get isExternalNewAgent(): boolean {
    const owner = this.agentForm?.get('agent_provider_type')?.value;
    this.isExternalNewAgentVar = (owner?.trim().toLowerCase() === 'new' && this.agentForm.get('agent_owner')?.value?.trim().toLowerCase() === 'external');
    // console.log('Agent Provider Type:', owner, this.agentForm); // Debug log
    return owner?.trim().toLowerCase() === 'new' && this.agentForm.get('agent_owner')?.value?.trim().toLowerCase() === 'external';
  }

  onProviderChange(event: any): void {
    const selectedProviderId = (event.target.value || '').toLowerCase();
    if (!selectedProviderId || selectedProviderId === 'movate') {
      this.agentForm.patchValue({
        agent_api_url: '',
        agent_api_key: '',
        agent_id: '',
      });
      return;
    }
    this._marketService
      .getProviderDetails({ provider_id: selectedProviderId })
      .subscribe({
        next: (res) => {
          if (res.success) {
            const url = res.data.provider_url || '';
            const key = res.data.provider_key || '';
            const newAgentId = this.generateObjectId();
            this.agentForm.patchValue({
              agent_api_url: url,
              agent_api_key: key,
              agent_id: newAgentId,
            });
          }
        },
        error: (err) => {
          const error = getApiError(err);
          if (error) {
            this.showToast(
              'error',
              error.message || 'Failed to fetch provider details'
            );
          }
          console.error('Error fetching provider details:', err);
          this.showToast('error', 'API call failed');
        },
      });
  }

  getAllAgentTags(agent: any): string[] {
    const tags: string[] = [];

    const pushIfValid = (value: any) => {
      if (
        value &&
        typeof value === 'string' &&
        value.trim().toLowerCase() !== 'none'
      ) {
        tags.push(value);
      }
    };

    if (agent.mcp_connector_id && agent.mcp_connector_id !== 'None') {
      pushIfValid(this.getMcpConnectorLabel(agent.mcp_connector_id));
    }

    if (agent.model && agent.model !== 'None') {
      pushIfValid(this.getModelLabel(agent.model));
    }
    return tags;
  }

  getVisibleTags(agent: any): string[] {
    const allTags = this.getAllAgentTags(agent);
    return allTags.slice(0, 3);
  }

  getHiddenTagCount(agent: any): number {
    const allTags = this.getAllAgentTags(agent);
    return allTags.length > 3 ? allTags.length - 3 : 0;
  }

  getAgentTypeImage(typeName: string): string | null {
    const type = typeName?.trim();

    switch (type) {
      case 'Insight Agent':
        return 'assets/img/insight.png';
      case 'Task Agent':
        return 'assets/img/task.png';
      case 'Workflow Agent':
        return 'assets/img/workflow.png';
      case 'Master Agent':
        return 'assets/img/master.png';
      default:
        return null;
    }
  }

  toggleNameEdit(): void {
    this.isEditingName = !this.isEditingName;
    if (this.isEditingName) {
      this.originalAgentName = this.agentForm.get('name')?.value || '';
    }
  }

  onImageChange(event: any) {
    this.isavatarvalid = false;
    const file = event.target.files[0];
    this.fileError = null;
    if (file) {
      const allowedTypes = ['image/png', 'image/jpeg', 'image/svg+xml'];
      if (!allowedTypes.includes(file.type)) {
        this.fileError = 'Only PNG,JPG and SVG images are allowed.';
        return;
      }
      this.avatarUploading = true;
      const formData = new FormData();
      formData.append('file', file);
      this._homeService.uploadImage(formData).subscribe({
        next: ({ data: response }) => {
          if (response && response.filePath) {
            this.agentForm.patchValue({ avatar: response.dataUrl });
            this.avatarUploading = false;
            this.isavatarvalid = true;
            this.cdRef.detectChanges();
          }
        },
        error: (err: any) => {
          console.error('Upload failed:', err);
          this.avatarUploading = false;
        },
      });
    } else {
      this.agentForm.patchValue({ avatar: '' });
    }
  }

deleteAgent(): void {
    if (!this.agentToDelete) return;
    this._loadingService.show();
    //console.log('Deleting agent with ID:', this.agentToDelete);
    this._marketService.deleteAgent(this.agentToDelete._id).subscribe({
      next: () => {
        this._loadingService.hide();
        this.deleteModal.hide();
        // Add success toast here
        this.showToast('success', 'Agent deleted successfully');
        // Remove the deleted agent from the list
        this.loadAgents();
        this.agentToDelete = null;
      },
      error: (err) => {
        this._loadingService.hide();
        const error = getApiError(err);
        if (error)
          this.showToast('error', error.message || 'Failed to delete agent');
        else this.showToast('error', 'Error deleting agent');

        console.error('Error deleting agent:', err);
        this.deleteModal.hide();
        this.agentToDelete = null;
      },
    });
  }

  deleteAgentWithApproval(): void {
    if (!this.agentToDelete) return;
    if (this.deleteAgentForm.valid) {
      const payload = {
        agent_id: this.agentToDelete._id,
        reason: this.deleteAgentForm.get('reason')?.value,
        approver_email: this.deleteAgentForm.get('approverEmail')?.value,
        modified_by: {
          "email":this.loggedUser?.Email,
          "name":this.loggedUser?.UserName,
        }
      };
      this._loadingService.show();
      //console.log('Requesting deletion for agent with ID:', this.agentToDelete._id, 'Payload:', payload);
      this._marketService.deleteAgentWithApproval(payload).subscribe({
        next: () => {
          this._loadingService.hide();
          this.deleteModal.hide();
          // Add success toast here
          this.showToast('success', 'Agent deletion requested successfully');
          // Remove the deleted agent from the list
          this.loadAgents();
          this.agentToDelete = null;
          this.deleteAgentForm.reset();
        },
        error: (err) => {
          this._loadingService.hide();
          const error = getApiError(err);
          if (error)
            this.showToast('error', error.message || 'Failed to request agent deletion');
          else this.showToast('error', 'Error requesting agent deletion');

          console.error('Error requesting agent deletion:', err);
          this.deleteModal.hide();
          this.agentToDelete = null;
          this.deleteAgentForm.reset();
        },
      });
    }
  }

  clearDeleteModal(): void {
    this.agentToDelete = null;
    this.deleteAgentForm.reset();
  }

  get actions(): FormArray {
    return this.agentForm.get('actions') as FormArray;
  }

  get createNewActions(): FormArray {
    return this.createAgentForm.get('actions') as FormArray;
  }

  createAction(): FormGroup {
    return this.fb.group(
      {
        name: ['', Validators.required],
        percentage: ['', [Validators.min(0), Validators.max(100)]],
      },
      { validators: this.requireBothIfOneFilled }
    );
  }

  requireBothIfOneFilled(group: FormGroup): ValidationErrors | null {
    const nameControl = group.get('name');
    const percentageControl = group.get('percentage');
    const name = nameControl?.value?.trim();
    const percentage = percentageControl?.value;
    // Clear previous errors
    nameControl?.setErrors(null);
    percentageControl?.setErrors(null);

    // Check if one field is filled and the other is not
    if (
      name &&
      (percentage === '' || percentage === null || percentage === undefined)
    ) {
      percentageControl?.setErrors({ required: true });
      return { bothRequired: true };
    }
    if (
      percentage !== '' &&
      percentage !== null &&
      percentage !== undefined &&
      !name
    ) {
      nameControl?.setErrors({ required: true });
      return { bothRequired: true };
    }
    // Re-apply other validators (e.g., min, max for percentage)
    if (percentage !== '' && percentage !== null && percentage !== undefined) {
      const numPercentage = Number(percentage);
      if (isNaN(numPercentage) || numPercentage < 0) {
        percentageControl?.setErrors({ min: true });
        return { min: true };
      }
      if (numPercentage > 100) {
        percentageControl?.setErrors({ max: true });
        return { max: true };
      }
    }
    return null;
  }

getAgentDate(agent: any): string {
  if (!agent) return "N/A";

  if (agent.updated_ts) {
    return new Date(agent.updated_ts).toLocaleDateString(); 
  }

  if (agent.created_ts) {
    return new Date(agent.created_ts).toLocaleDateString();
  }

  return "N/A";
}

get hasActionWith100Percent(): boolean {
  return this.actions.controls.some(action => action.value.percentage === 100);
}

get lastAddedActionPercentage(): number {
  const actionControls = this.actions.controls;
  if (actionControls.length > 0) {
    const lastAction = actionControls[actionControls.length - 1].value;
    return lastAction.percentage || 0;
  }
  return 0;
}

get isCurrentActionProgressValid(): boolean {
  const newPercentage = this.newActionForm.get('percentage')?.value;

  if (newPercentage === null || newPercentage === undefined || newPercentage === '') {
    return true;
  }

  const num = Number(newPercentage);

  // Basic range check
  if (num < 0 || num > 100) {
    return false;
  }

  // Prevent exceeding 100% total (except when editing)
  if (!this.isEditing) {
    const projectedTotal = this.totalPercentage + num;
    if (projectedTotal > 100) {
      return false;
    }
  }

  return true;
}

get progressValidationMessage(): string {
  const newPercentage = this.newActionForm.get('percentage')?.value;
  
  if (newPercentage === null || newPercentage === undefined || newPercentage === '') {
    return '';
  }

  const num = Number(newPercentage);

  if (this.hasActionWith100Percent && num === 100) {
    return `Task completion 100% is already added.`;
  }

  if (!this.isEditing) {
    const projectedTotal = this.totalPercentage + num;
    if (projectedTotal > 100) {
      return `Total cannot exceed 100%. Current total is ${this.totalPercentage}%. Adding ${num}% would make it ${projectedTotal}%.`;
    }
  }

  return `Percentage must be between 0 and 100.`;
}

get isTotalPercentageValid(): boolean {
  return this.totalPercentage === 100;
}

get totalValidationMessage(): string {
  if (this.totalPercentage > 100) {
    return `Total progress cannot exceed 100%. Current total is ${this.totalPercentage}%. Please remove some actions.`;
  }
  return '';
}

isEditing = false;
editingIndex: number | null = null;

 addAction(): void {
  const nameControl = this.newActionForm.get('name');
  const percentageControl = this.newActionForm.get('percentage');

  nameControl?.markAsTouched();
  percentageControl?.markAsTouched();
  this.newActionForm.updateValueAndValidity();

  const nameValue = nameControl?.value?.trim();
  const percentageValue = percentageControl?.value;

  if (!nameValue || percentageValue === '' || percentageValue === null || percentageValue === undefined) {
    this.showToast('error', 'Please fill out both action name and percentage.');
    return;
  }

  if (!this.newActionForm.valid) {
    this.showToast('error', 'Please fill out both action name and percentage correctly.');
    return;
  }

  const newAction = {
    name: nameValue,
    percentage: Number(percentageValue)
  };

  if (this.isEditing && this.editingIndex !== null) {
    // UPDATE existing action
    this.actions.at(this.editingIndex).patchValue(newAction);
    this.isEditing = false;
    this.editingIndex = null;
  } else {
    // ADD new action
    this.actions.push(
      this.fb.group({
        name: [newAction.name, Validators.required],
        percentage: [
          newAction.percentage,
          [Validators.required, Validators.min(0), Validators.max(100)]
        ]
      })
    );
  }

  this.newActionForm.reset({ name: '', percentage: '' });
  this.calculateTotal();
  this.cdRef.detectChanges();
}
  removeAction(index: number) {
    this.actions.removeAt(index);
    this.calculateTotal();
  }

 editAction(index: number): void {
  const action = this.actions.at(index).value;
  
  this.newActionForm.setValue({
    name: action.name || '',
    percentage: action.percentage || '',
  });

  this.isEditing = true;
  this.editingIndex = index;

  this.newActionForm.markAsDirty();
  this.newActionForm.markAsTouched();
  this.newActionForm.updateValueAndValidity();
}


addActionCreateNew(): void {
  const nameControl = this.newActionForm.get('name');
  const percentageControl = this.newActionForm.get('percentage');

  nameControl?.markAsTouched();
  percentageControl?.markAsTouched();
  this.newActionForm.updateValueAndValidity();

  const nameValue = nameControl?.value?.trim();
  const percentageValue = percentageControl?.value;

  if (!nameValue || percentageValue === '' || percentageValue === null || percentageValue === undefined) {
    this.showToast('error', 'Please fill out both action name and percentage.');
    return;
  }

  if (!this.newActionForm.valid) {
    this.showToast('error', 'Please fill out both action name and percentage correctly.');
    return;
  }

  const newAction = {
    name: nameValue,
    percentage: Number(percentageValue)
  };

  if (this.isEditing && this.editingIndex !== null) {
    // UPDATE existing action
    this.createNewActions.at(this.editingIndex).patchValue(newAction);
    this.isEditing = false;
    this.editingIndex = null;
  } else {
    // ADD new action
    this.createNewActions.push(
      this.fb.group({
        name: [newAction.name, Validators.required],
        percentage: [
          newAction.percentage,
          [Validators.required, Validators.min(0), Validators.max(100)]
        ]
      })
    );
  }

  

  this.newActionForm.reset({ name: '', percentage: '' });
  this.calculateTotalCreateNew();
  this.cdRef.detectChanges();
}
  removeActionCreateNew(index: number) {
    this.createNewActions.removeAt(index);
    this.calculateTotalCreateNew();
  }

 editActionCreateNew(index: number): void {
  const action = this.createNewActions.at(index).value;
  
  this.newActionForm.setValue({
    name: action.name || '',
    percentage: action.percentage || '',
  });

  this.isEditing = true;
  this.editingIndex = index;

  this.newActionForm.markAsDirty();
  this.newActionForm.markAsTouched();
  this.newActionForm.updateValueAndValidity();
}

  calculateTotal() {
    this.totalPercentage = this.actions.value.reduce(
      (sum: number, action: any) => sum + Number(action.percentage),
      0
    );
  }

  calculateTotalCreateNew() {
    this.totalPercentage = this.createNewActions.value.reduce(
      (sum: number, action: any) => sum + Number(action.percentage),
      0
    );
  }


  validateTotal: ValidatorFn = (
    control: AbstractControl
  ): ValidationErrors | null => {
    const formArray = control as FormArray;
    if (!formArray || formArray.length === 0) {
      return null;
    }
    const total = formArray.value.reduce(
      (sum: number, action: any) => sum + Number(action.percentage || 0),
      0
    );
    return total === 100 ? null : { invalidTotalPercentage: true };
  };

  onNewPercentageInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const percentageControl = this.newActionForm.get('percentage');
    if (value !== '' && Number(value) > 100) {
      percentageControl?.setValue('100');
    }
    percentageControl?.markAsTouched();
    this.newActionForm.updateValueAndValidity();
    this.cdRef.detectChanges();
  }

  goNext(): void {
    //console.log('Current Step:', this.isExternalNewAgentVar);
    this.totalSteps = (this.isTaskAgent() || this.isExternalNewAgentVar) ? 3 : 2;

    if (this.currentStep < this.totalSteps) {
      const stepControls = this.getStepControls(this.currentStep);
      let isValid = true;

      if (this.currentStep === 2) {
        const frequencyControl = this.agentForm.get('scheduleFrequency');
        const schedulerControl = this.agentForm.get('schedulerTime');
        const daysControl = this.agentForm.get('selectedDays');
        const datesControl = this.agentForm.get('selectedDates');
        // Clear validators initially
        schedulerControl?.clearValidators();
        daysControl?.clearValidators();
        datesControl?.clearValidators();
        frequencyControl?.clearValidators();
        // Apply validators only if a frequency is selected
        if (frequencyControl?.value) {
          frequencyControl?.setValidators([Validators.required]);
          schedulerControl?.setValidators([Validators.required]);
          if (frequencyControl.value === 'weekly') {
            daysControl?.setValidators([
              Validators.required,
              this.minSelectedCheckboxes(1),
            ]);
          } else if (frequencyControl.value === 'monthly') {
            datesControl?.setValidators([
              Validators.required,
              this.minSelectedDates(1),
            ]);
          }
          // Update validity
          schedulerControl?.updateValueAndValidity({ emitEvent: false });
          daysControl?.updateValueAndValidity({ emitEvent: false });
          datesControl?.updateValueAndValidity({ emitEvent: false });
          frequencyControl?.updateValueAndValidity({ emitEvent: false });
          // Validate fields only if a frequency is selected
          if (!frequencyControl.valid) {
            frequencyControl?.markAsTouched();
            isValid = false;
          }
          if (!schedulerControl?.value || schedulerControl.invalid) {
            schedulerControl?.markAsTouched();
            isValid = false;
          }
          if (
            frequencyControl.value === 'weekly' &&
            (!daysControl?.value || daysControl.value.length === 0)
          ) {
            daysControl?.markAsTouched();
            daysControl?.setErrors({ required: true });
            isValid = false;
          } else if (
            frequencyControl.value === 'monthly' &&
            (!datesControl?.value || datesControl.value.length === 0)
          ) {
            datesControl?.markAsTouched();
            datesControl?.setErrors({ required: true });
            isValid = false;
          }
          // if (!isValid) {
          //   this.showToast('error', 'Please complete the current schedule or clear the frequency to proceed.');
          //   return;
          // }
        }
        // If no frequency is selected or fields are valid, proceed to next step
        this.currentStep++;
        // Reset schedule fields to clear temporary selections
        this.resetScheduleFields();
      } else {
        // Validate other steps (e.g., Step 1 or Step 3)
        stepControls.forEach((controlName) => {
          const control = this.agentForm.get(controlName);
          if (control) {
            control.markAsTouched();
            if (control.invalid) isValid = false;
          }
        });
        if (!isValid) {
          this.showToast(
            'error',
            'Please fill out all required fields in this step.'
          );
          return;
        }
        this.currentStep++;
      }
    } else {
      // Clear scheduling validators before submission
      const schedulerTimeControl = this.agentForm.get('schedulerTime');
      const daysControl = this.agentForm.get('selectedDays');
      const datesControl = this.agentForm.get('selectedDates');
      const frequencyControl = this.agentForm.get('scheduleFrequency');

      schedulerTimeControl?.clearValidators();
      daysControl?.clearValidators();
      datesControl?.clearValidators();
      frequencyControl?.clearValidators();

      schedulerTimeControl?.updateValueAndValidity({ emitEvent: false });
      daysControl?.updateValueAndValidity({ emitEvent: false });
      datesControl?.updateValueAndValidity({ emitEvent: false });
      frequencyControl?.updateValueAndValidity({ emitEvent: false });

      // Optional: Require at least one schedule for submission
      // if (this.schedules.length === 0) {
      //   this.showToast('error', 'At least one schedule is required.');
      //   this.currentStep = 2; // Redirect to Step 2
      //   return;
      // }
      if (
        this.isTaskAgent() &&
        this.actions.errors?.['invalidTotalPercentage']
      ) {
        this.showToast('error', 'Total percentage of actions must equal 100%');
        return;
      }
      this.submitAgentForm();
    }
    // Activate agent_type_id subscription only when moving to step 3 for task agents
    if (
      this.currentStep === 3 &&
      (this.isTaskAgent() || this.isExternalNewAgentVar) &&
      !this.agentTypeSubscription
    ) {
      this.setupAgentTypeSubscription();
    }
    this.cdRef.detectChanges();
  }

  goBack(): void {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.cdRef.detectChanges();
    }
  }

  isStepActive(step: number): boolean {
    if (step > this.totalSteps) return false;
    return this.currentStep === step;
  }

  isStepCompleted(step: number): boolean {
    if (step > this.totalSteps) return false;
    return step < this.currentStep;
  }

  getStepControls(step: number): string[] {
    const isExternal =
      this.agentForm.get('agent_owner')?.value?.toLowerCase() === 'external';
    const modelEnabled = this.agentForm.get('model_enabled')?.value || this.agentForm.get('agent_provider_type')?.value=='new';
    switch (step) {
      case 1:
        const commonControls = [
          'name',
          'agent_owner',
          'agent_provider_type',
          'agent_type_id',
          'role_id',
          'connector',
          'internal_tool'
        ];
        const externalExistingControls = [
          'agent_api_url',
          'agent_api_key',
          'user_id',
          'agent_session_id'
        ];
        if (this.isVoiceAgent) {
          externalExistingControls.push("session_start_url", "session_end_url")
        }
        const externalNewControls = [
          'description',
          'version',
          'agent_prompt',
          'agent_role',
          'agent_goal',
          'model'
        ];
        const internalControls = [
          'description',
          'version',
          'agent_prompt',
          'agent_role',
          'agent_goal',
        ];
        if (!isExternal && modelEnabled) {
          internalControls.push('model');
        }
        return isExternal
          ? this.isExternalNewAgent
            ? [...commonControls, ...externalNewControls]
            : [...commonControls, ...externalExistingControls]
          : [...commonControls, ...internalControls];
      case 2:
        return [
          'scheduleFrequency',
          'schedulerTime',
          'selectedDays',
          'selectedDates',
        ];
      case 3:
        return (this.isTaskAgent() && this.isExternalNewAgentVar)  ? ['actions', 'approverEmail'] : this.isTaskAgent() ? ['actions'] : this.isExternalNewAgentVar ? ['approverEmail'] : [];
      default:
        return [];
    }
  }

  isStep1Valid(): boolean {
    const stepControls = this.getStepControls(1);
    // console.log('stepControls for validation:', stepControls);
    return stepControls.every((controlName) => {
      const control = this.agentForm.get(controlName);
      // console.log(`Control: ${control}, Valid: ${control?.valid}, Disabled: ${control?.disabled}`);
      return control?.valid || control?.disabled;
    });
  }

  formatDate(date: string): string {
    try {
      const dateObj = new Date(date);
      return dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    } catch (e) {
      return date;
    }
  }

  addSchedule(): void {
    const frequencyControl = this.agentForm.get('scheduleFrequency');
    const timeControl = this.agentForm.get('schedulerTime');
    const daysControl = this.agentForm.get('selectedDays');
    const datesControl = this.agentForm.get('selectedDates');

    let hasError = false;
    // Apply validators based on current frequency
    timeControl?.clearValidators();
    daysControl?.clearValidators();
    datesControl?.clearValidators();

    if (frequencyControl?.value) {
      timeControl?.setValidators([Validators.required]);
      if (frequencyControl.value === 'weekly') {
        daysControl?.setValidators([
          Validators.required,
          this.minSelectedCheckboxes(1),
        ]);
      } else if (frequencyControl.value === 'monthly') {
        datesControl?.setValidators([
          Validators.required,
          this.minSelectedDates(1),
        ]);
      }
    }
    timeControl?.updateValueAndValidity({ emitEvent: false });
    daysControl?.updateValueAndValidity({ emitEvent: false });
    datesControl?.updateValueAndValidity({ emitEvent: false });

    if (!frequencyControl?.value) {
      frequencyControl?.markAsTouched();
      frequencyControl?.setErrors({ required: true });
      hasError = true;
    }
    if (!timeControl?.value && frequencyControl?.value) {
      timeControl?.markAsTouched();
      timeControl?.setErrors({ required: true });
      hasError = true;
    }
    if (
      frequencyControl?.value === 'weekly' &&
      (!this.selectedDays || this.selectedDays.length === 0)
    ) {
      daysControl?.markAsTouched();
      daysControl?.setErrors({ required: true });
      hasError = true;
    }
    if (
      frequencyControl?.value === 'monthly' &&
      (!this.selectedDates || this.selectedDates.length === 0)
    ) {
      datesControl?.markAsTouched();
      datesControl?.setErrors({ required: true });
      hasError = true;
    }
    if (hasError) {
      this.showToast(
        'error',
        'Please complete all required fields for the schedule.'
      );
      this.cdRef.detectChanges();
      return;
    }
    const frequency = frequencyControl?.value;
    const time = timeControl?.value;
    // Check if the frequency is already used
    if (this.schedules.some((s) => s.frequency === frequency)) {
      this.showToast('error', `A ${frequency} schedule already exists.`);
      return;
    }
    const newSchedule = {
      frequency,
      time,
      days: frequency === 'weekly' ? [...this.selectedDays] : [],
      dates: frequency === 'monthly' ? [...this.selectedDates] : [],
    };

    this.schedules.push(newSchedule);
    // Update schedulerTime and scheduleFrequency
    if (!this.schedulerTime) this.schedulerTime = {};
    if (!this.scheduleFrequency.includes(frequency)) {
      this.scheduleFrequency.push(frequency);
    }
    if (frequency === 'daily') {
      this.schedulerTime['daily'] = { time };
      this.hasDailySchedule = true;
    } else if (frequency === 'weekly') {
      this.schedulerTime['weekly'] = { days: [...this.selectedDays], time };
      this.hasWeeklySchedule = true;
    } else if (frequency === 'monthly') {
      this.schedulerTime['monthly'] = { dates: [...this.selectedDates], time };
      this.hasMonthlySchedule = true;
    }
    // Reset fields and clear all validators
    this.resetScheduleFields();
    // Set the next available frequency
    const frequencyOrder = ['daily', 'weekly', 'monthly'];
    const availableFrequencies = frequencyOrder.filter(
      (f) => !this.schedules.some((s) => s.frequency === f)
    );
    const newFrequency = availableFrequencies[0] || '';

    frequencyControl?.setValue(newFrequency, { emitEvent: true });

    this.updateFrequencyFlags();
    this.cdRef.detectChanges();
  }

  addScheduleCreateNew(): void {
    const frequencyControl = this.createAgentForm.get('scheduleFrequency');
    const timeControl = this.createAgentForm.get('schedulerTime');
    const daysControl = this.createAgentForm.get('selectedDays');
    const datesControl = this.createAgentForm.get('selectedDates');

    let hasError = false;
    // Apply validators based on current frequency
    timeControl?.clearValidators();
    daysControl?.clearValidators();
    datesControl?.clearValidators();

    if (frequencyControl?.value) {
      timeControl?.setValidators([Validators.required]);
      if (frequencyControl.value === 'weekly') {
        daysControl?.setValidators([
          Validators.required,
          this.minSelectedCheckboxes(1),
        ]);
      } else if (frequencyControl.value === 'monthly') {
        datesControl?.setValidators([
          Validators.required,
          this.minSelectedDates(1),
        ]);
      }
    }
    timeControl?.updateValueAndValidity({ emitEvent: false });
    daysControl?.updateValueAndValidity({ emitEvent: false });
    datesControl?.updateValueAndValidity({ emitEvent: false });

    if (!frequencyControl?.value) {
      frequencyControl?.markAsTouched();
      frequencyControl?.setErrors({ required: true });
      hasError = true;
    }
    if (!timeControl?.value && frequencyControl?.value) {
      timeControl?.markAsTouched();
      timeControl?.setErrors({ required: true });
      hasError = true;
    }
    if (
      frequencyControl?.value === 'weekly' &&
      (!this.selectedDays || this.selectedDays.length === 0)
    ) {
      daysControl?.markAsTouched();
      daysControl?.setErrors({ required: true });
      hasError = true;
    }
    if (
      frequencyControl?.value === 'monthly' &&
      (!this.selectedDates || this.selectedDates.length === 0)
    ) {
      datesControl?.markAsTouched();
      datesControl?.setErrors({ required: true });
      hasError = true;
    }
    if (hasError) {
      this.showToast(
        'error',
        'Please complete all required fields for the schedule.'
      );
      this.cdRef.detectChanges();
      return;
    }
    const frequency = frequencyControl?.value;
    const time = timeControl?.value;
    // Check if the frequency is already used
    if (this.schedules.some((s) => s.frequency === frequency)) {
      this.showToast('error', `A ${frequency} schedule already exists.`);
      return;
    }
    const newSchedule = {
      frequency,
      time,
      days: frequency === 'weekly' ? [...this.selectedDays] : [],
      dates: frequency === 'monthly' ? [...this.selectedDates] : [],
    };

    this.schedules.push(newSchedule);
    // Update schedulerTime and scheduleFrequency
    if (!this.schedulerTime) this.schedulerTime = {};
    if (!this.scheduleFrequency.includes(frequency)) {
      this.scheduleFrequency.push(frequency);
    }
    if (frequency === 'daily') {
      this.schedulerTime['daily'] = { time };
      this.hasDailySchedule = true;
    } else if (frequency === 'weekly') {
      this.schedulerTime['weekly'] = { days: [...this.selectedDays], time };
      this.hasWeeklySchedule = true;
    } else if (frequency === 'monthly') {
      this.schedulerTime['monthly'] = { dates: [...this.selectedDates], time };
      this.hasMonthlySchedule = true;
    }
    // Reset fields and clear all validators
    this.resetScheduleFieldsCreateNew();
    // Set the next available frequency
    const frequencyOrder = ['daily', 'weekly', 'monthly'];
    const availableFrequencies = frequencyOrder.filter(
      (f) => !this.schedules.some((s) => s.frequency === f)
    );
    const newFrequency = availableFrequencies[0] || '';

    frequencyControl?.setValue(newFrequency, { emitEvent: true });

    this.updateFrequencyFlags();
    this.cdRef.detectChanges();
  }

  formatSchedule(schedule: any): string {
    if (!schedule || !schedule.frequency) {
      return 'No schedule defined';
    }

    const formatTime = (timeString: string): string => {
      if (!timeString) return 'No time specified';
      const [hours, minutes] = timeString.split(':').map((part) => part.trim());
      if (!hours || !minutes) return 'No time specified';
      const hour = parseInt(hours, 10);
      if (isNaN(hour) || hour < 0 || hour > 23) return 'No time specified';
      const period = hour >= 12 ? 'PM' : 'AM';
      const formattedHour = hour % 12 || 12;
      return `${formattedHour}:${minutes.padStart(2, '0')} ${period}`;
    };

    const formattedTime = formatTime(schedule.time);

    let result: string;
    switch (schedule.frequency) {
      case 'daily':
        result = `Daily at ${formattedTime}`;
        break;
      case 'weekly':
        if (!Array.isArray(schedule.days) || schedule.days.length === 0) {
          result = `Weekly (no days selected) at ${formattedTime}`;
        } else {
          const dayNames = schedule.days
            .map((day: number) => this.days.find((d) => d.value === day)?.label)
            .filter((label: string | undefined) => label);
          if (dayNames.length === 0) {
            result = `Weekly (no valid days) at ${formattedTime}`;
          } else {
            let daysText = '';
            if (dayNames.length === 1) {
              daysText = dayNames[0];
            } else if (dayNames.length === 2) {
              daysText = dayNames.join(' & ');
            } else {
              const lastDay = dayNames.pop();
              daysText = `${dayNames.join(', ')}, & ${lastDay}`;
            }
            result = `Weekly on ${daysText} at ${formattedTime}`;
          }
        }
        break;
      case 'monthly':
        if (!Array.isArray(schedule.dates) || schedule.dates.length === 0) {
          result = `Monthly (no dates selected) at ${formattedTime}`;
        } else {
          const formattedDates = schedule.dates
            .map((date: string) => this.formatDate(date))
            .filter((date: string) => date !== 'Invalid date');
          if (formattedDates.length === 0) {
            result = `Monthly (no valid dates) at ${formattedTime}`;
          } else {
            let datesText = '';
            if (formattedDates.length === 1) {
              datesText = formattedDates[0];
            } else if (formattedDates.length === 2) {
              datesText = formattedDates.join(' & ');
            } else {
              const lastDate = formattedDates.pop();
              datesText = `${formattedDates.join(', ')}, & ${lastDate}`;
            }
            result = `Monthly from ${datesText} at ${formattedTime}`;
          }
        }
        break;
      default:
        result = 'No schedule defined';
        break;
    }
    return result;
  }

  formatScheduleCreateNew(schedule: any): string {
    if (!schedule || !schedule.frequency) {
      return 'No schedule defined';
    }

    const formatTime = (timeString: string): string => {
      if (!timeString) return 'No time specified';
      const [hours, minutes] = timeString.split(':').map((part) => part.trim());
      if (!hours || !minutes) return 'No time specified';
      const hour = parseInt(hours, 10);
      if (isNaN(hour) || hour < 0 || hour > 23) return 'No time specified';
      const period = hour >= 12 ? 'PM' : 'AM';
      const formattedHour = hour % 12 || 12;
      return `${formattedHour}:${minutes.padStart(2, '0')} ${period}`;
    };

    const formattedTime = formatTime(schedule.time);

    let result: string;
    switch (schedule.frequency) {
      case 'daily':
        result = `Daily at ${formattedTime}`;
        break;
      case 'weekly':
        if (!Array.isArray(schedule.days) || schedule.days.length === 0) {
          result = `Weekly (no days selected) at ${formattedTime}`;
        } else {
          const dayNames = schedule.days
            .map((day: number) => this.days.find((d) => d.value === day)?.label)
            .filter((label: string | undefined) => label);
          if (dayNames.length === 0) {
            result = `Weekly (no valid days) at ${formattedTime}`;
          } else {
            let daysText = '';
            if (dayNames.length === 1) {
              daysText = dayNames[0];
            } else if (dayNames.length === 2) {
              daysText = dayNames.join(' & ');
            } else {
              const lastDay = dayNames.pop();
              daysText = `${dayNames.join(', ')}, & ${lastDay}`;
            }
            result = `Weekly on ${daysText} at ${formattedTime}`;
          }
        }
        break;
      case 'monthly':
        if (!Array.isArray(schedule.dates) || schedule.dates.length === 0) {
          result = `Monthly (no dates selected) at ${formattedTime}`;
        } else {
          const formattedDates = schedule.dates
            .map((date: string) => this.formatDate(date))
            .filter((date: string) => date !== 'Invalid date');
          if (formattedDates.length === 0) {
            result = `Monthly (no valid dates) at ${formattedTime}`;
          } else {
            let datesText = '';
            if (formattedDates.length === 1) {
              datesText = formattedDates[0];
            } else if (formattedDates.length === 2) {
              datesText = formattedDates.join(' & ');
            } else {
              const lastDate = formattedDates.pop();
              datesText = `${formattedDates.join(', ')}, & ${lastDate}`;
            }
            result = `Monthly from ${datesText} at ${formattedTime}`;
          }
        }
        break;
      default:
        result = 'No schedule defined';
        break;
    }
    return result;
  }

  editSchedule(index: number): void {
    const schedule = this.schedules[index];

    // Store the schedule data
    const frequency = schedule.frequency;
    const time = schedule.time;
    const days = [...schedule.days];
    const dates = [...schedule.dates];

    // Remove the schedule to update frequency flags
    this.schedules.splice(index, 1);
    this.updateFrequencyFlags();

    // Reset form fields and clear validators to avoid conflicts
    this.resetScheduleFields();

    // Patch the form with schedule values
    this.agentForm.patchValue({
      scheduleFrequency: frequency,
      schedulerTime: time,
      selectedDays: days,
      selectedDates: dates,
    });

    // Sync component properties
    this.selectedDays = days;
    this.selectedDates = dates;

    // Update UI and validators based on frequency
    this.onFrequencyChange(frequency);
    //console.log('Form after patch:', this.agentForm.value);
    this.cdRef.detectChanges();
  }

  editScheduleCreateNew(index: number): void {
    const schedule = this.schedules[index];

    // Store the schedule data
    const frequency = schedule.frequency;
    const time = schedule.time;
    const days = [...schedule.days];
    const dates = [...schedule.dates];

    // Remove the schedule to update frequency flags
    this.schedules.splice(index, 1);
    this.updateFrequencyFlags();

    // Reset form fields and clear validators to avoid conflicts
    this.resetScheduleFieldsCreateNew();

    // Patch the form with schedule values
    this.createAgentForm.patchValue({
      scheduleFrequency: frequency,
      schedulerTime: time,
      selectedDays: days,
      selectedDates: dates,
    });

    // Sync component properties
    this.selectedDays = days;
    this.selectedDates = dates;

    // Update UI and validators based on frequency
    this.onFrequencyChange(frequency);
    //console.log('Form after patch:', this.createAgentForm.value);
    this.cdRef.detectChanges();
  }

  removeSchedule(index: number): void {
    const removedSchedule = this.schedules[index];
    this.schedules.splice(index, 1);
    if (removedSchedule.frequency === 'daily') this.hasDailySchedule = false;
    if (removedSchedule.frequency === 'weekly') this.hasWeeklySchedule = false;
    if (removedSchedule.frequency === 'monthly')
      this.hasMonthlySchedule = false;
    this.updateFrequencyFlags();
    this.cdRef.detectChanges();
  }

  removeScheduleCreateNew(index: number): void {
    const removedSchedule = this.schedules[index];
    this.schedules.splice(index, 1);
    if (removedSchedule.frequency === 'daily') this.hasDailySchedule = false;
    if (removedSchedule.frequency === 'weekly') this.hasWeeklySchedule = false;
    if (removedSchedule.frequency === 'monthly')
      this.hasMonthlySchedule = false;
    this.updateFrequencyFlags();
    this.cdRef.detectChanges();
  }

  updateFrequencyFlags(): void {
    this.hasDailySchedule = this.schedules.some((s) => s.frequency === 'daily');
    this.hasWeeklySchedule = this.schedules.some(
      (s) => s.frequency === 'weekly'
    );
    this.hasMonthlySchedule = this.schedules.some(
      (s) => s.frequency === 'monthly'
    );

    const scheduleFrequencyControl = this.agentForm.get('scheduleFrequency');
    // Enable frequency control unless explicitly disabled in other logic
    scheduleFrequencyControl?.enable();

    const currentFrequency = scheduleFrequencyControl?.value;
    this.showDailyTime = currentFrequency === 'daily' && !this.hasDailySchedule;
    this.showWeeklyTime =
      currentFrequency === 'weekly' && !this.hasWeeklySchedule;
    this.showMonthlyTime =
      currentFrequency === 'monthly' && !this.hasMonthlySchedule;
    this.showDefaultTime = !currentFrequency;
    console.log('Updated frequency flags:', {
      hasDailySchedule: this.hasDailySchedule,
      hasWeeklySchedule: this.hasWeeklySchedule,
      hasMonthlySchedule: this.hasMonthlySchedule,
      selectedFrequency: scheduleFrequencyControl?.value,
      showDailyTime: this.showDailyTime,
      showWeeklyTime: this.showWeeklyTime,
      showMonthlyTime: this.showMonthlyTime,
      showDefaultTime: this.showDefaultTime,
    });
    this.cdRef.detectChanges();
  }

  getSelectedDaysLabel(): string {
    if (!this.selectedDays || this.selectedDays.length === 0) {
      return 'Select days';
    }
    return this.selectedDays
      .map((value) => this.days.find((day) => day.value === value)?.label)
      .filter((label) => !!label)
      .join(', ');
  }

  onFrequencyChange(frequency: string): void {
    const scheduleFrequencyControl = this.agentForm.get('scheduleFrequency');
    const schedulerTimeControl = this.agentForm.get('schedulerTime');
    const daysControl = this.agentForm.get('selectedDays');
    const datesControl = this.agentForm.get('selectedDates');

    // Log initial state
    console.log('onFrequencyChange initial state:', {
      frequency,
      formErrors: {
        frequency: scheduleFrequencyControl?.errors,
        time: schedulerTimeControl?.errors,
        days: daysControl?.errors,
        dates: datesControl?.errors,
      },
    });

    // Check if the selected frequency is already used
    if (frequency && this.schedules.some((s) => s.frequency === frequency)) {
      this.showToast(
        'error',
        `A ${frequency} schedule already exists. Please select a different frequency.`
      );
      scheduleFrequencyControl?.setValue('', { emitEvent: false }); // Reset to "None"
      this.showDailyTime = false;
      this.showWeeklyTime = false;
      this.showMonthlyTime = false;
      this.showDefaultTime = true;
    } else {
      // Update UI visibility based on frequency
      this.showDailyTime = frequency === 'daily' && !this.hasDailySchedule;
      this.showWeeklyTime = frequency === 'weekly' && !this.hasWeeklySchedule;
      this.showMonthlyTime =
        frequency === 'monthly' && !this.hasMonthlySchedule;
      this.showDefaultTime = !frequency;
    }

    // Clear existing validators and errors
    schedulerTimeControl?.clearValidators();
    daysControl?.clearValidators();
    datesControl?.clearValidators();
    schedulerTimeControl?.setErrors(null);
    daysControl?.setErrors(null);
    datesControl?.setErrors(null);

    // Apply validators based on frequency
    if (frequency) {
      schedulerTimeControl?.setValidators([Validators.required]);
      if (frequency === 'weekly') {
        daysControl?.setValidators([
          Validators.required,
          this.minSelectedCheckboxes(1),
        ]);
      } else if (frequency === 'monthly') {
        datesControl?.setValidators([
          Validators.required,
          this.minSelectedDates(1),
        ]);
      }
    }

    // Update validity without emitting events
    schedulerTimeControl?.updateValueAndValidity({ emitEvent: false });
    daysControl?.updateValueAndValidity({ emitEvent: false });
    datesControl?.updateValueAndValidity({ emitEvent: false });

    // Log final state
    console.log('onFrequencyChange final state:', {
      frequency,
      showDailyTime: this.showDailyTime,
      showWeeklyTime: this.showWeeklyTime,
      showMonthlyTime: this.showMonthlyTime,
      showDefaultTime: this.showDefaultTime,
      formValues: this.agentForm.getRawValue(),
      formErrors: {
        frequency: scheduleFrequencyControl?.errors,
        time: schedulerTimeControl?.errors,
        days: daysControl?.errors,
        dates: datesControl?.errors,
      },
    });

    this.cdRef.detectChanges();
  }

  onFrequencyChangeCreateNew(frequency: string): void {
    const scheduleFrequencyControl = this.createAgentForm.get('scheduleFrequency');
    const schedulerTimeControl = this.createAgentForm.get('schedulerTime');
    const daysControl = this.createAgentForm.get('selectedDays');
    const datesControl = this.createAgentForm.get('selectedDates');

    // Log initial state
    console.log('onFrequencyChange initial state:', {
      frequency,
      formErrors: {
        frequency: scheduleFrequencyControl?.errors,
        time: schedulerTimeControl?.errors,
        days: daysControl?.errors,
        dates: datesControl?.errors,
      },
    });

    // Check if the selected frequency is already used
    if (frequency && this.schedules.some((s) => s.frequency === frequency)) {
      this.showToast(
        'error',
        `A ${frequency} schedule already exists. Please select a different frequency.`
      );
      scheduleFrequencyControl?.setValue('', { emitEvent: false }); // Reset to "None"
      this.showDailyTime = false;
      this.showWeeklyTime = false;
      this.showMonthlyTime = false;
      this.showDefaultTime = true;
    } else {
      // Update UI visibility based on frequency
      this.showDailyTime = frequency === 'daily' && !this.hasDailySchedule;
      this.showWeeklyTime = frequency === 'weekly' && !this.hasWeeklySchedule;
      this.showMonthlyTime =
        frequency === 'monthly' && !this.hasMonthlySchedule;
      this.showDefaultTime = !frequency;
    }

    // Clear existing validators and errors
    schedulerTimeControl?.clearValidators();
    daysControl?.clearValidators();
    datesControl?.clearValidators();
    schedulerTimeControl?.setErrors(null);
    daysControl?.setErrors(null);
    datesControl?.setErrors(null);

    // Apply validators based on frequency
    if (frequency) {
      schedulerTimeControl?.setValidators([Validators.required]);
      if (frequency === 'weekly') {
        daysControl?.setValidators([
          Validators.required,
          this.minSelectedCheckboxes(1),
        ]);
      } else if (frequency === 'monthly') {
        datesControl?.setValidators([
          Validators.required,
          this.minSelectedDates(1),
        ]);
      }
    }

    // Update validity without emitting events
    schedulerTimeControl?.updateValueAndValidity({ emitEvent: false });
    daysControl?.updateValueAndValidity({ emitEvent: false });
    datesControl?.updateValueAndValidity({ emitEvent: false });

    // Log final state
    console.log('onFrequencyChange final state:', {
      frequency,
      showDailyTime: this.showDailyTime,
      showWeeklyTime: this.showWeeklyTime,
      showMonthlyTime: this.showMonthlyTime,
      showDefaultTime: this.showDefaultTime,
      formValues: this.agentForm.getRawValue(),
      formErrors: {
        frequency: scheduleFrequencyControl?.errors,
        time: schedulerTimeControl?.errors,
        days: daysControl?.errors,
        dates: datesControl?.errors,
      },
    });

    this.cdRef.detectChanges();
  }


  resetScheduleFields(): void {
    const schedulerTimeControl = this.agentForm.get('schedulerTime');
    const daysControl = this.agentForm.get('selectedDays');
    const datesControl = this.agentForm.get('selectedDates');

    // Reset form controls
    this.agentForm.get('scheduleFrequency')?.reset();
    schedulerTimeControl?.reset();
    daysControl?.reset();
    datesControl?.reset();

    // Clear validators
    schedulerTimeControl?.clearValidators();
    daysControl?.clearValidators();
    datesControl?.clearValidators();

    // Clear component properties
    this.selectedDays = [];
    this.selectedDates = [];

    // Update validity
    schedulerTimeControl?.updateValueAndValidity();
    daysControl?.updateValueAndValidity();
    datesControl?.updateValueAndValidity();

    this.showDailyTime = false;
    this.showWeeklyTime = false;
    this.showMonthlyTime = false;
    this.showDefaultTime = true;

    //console.log('Form after reset:', this.agentForm.value);
  }

  resetScheduleFieldsCreateNew(): void {
    const schedulerTimeControl = this.createAgentForm.get('schedulerTime');
    const daysControl = this.createAgentForm.get('selectedDays');
    const datesControl = this.createAgentForm.get('selectedDates');

    // Reset form controls
    this.createAgentForm.get('scheduleFrequency')?.reset();
    schedulerTimeControl?.reset();
    daysControl?.reset();
    datesControl?.reset();

    // Clear validators
    schedulerTimeControl?.clearValidators();
    daysControl?.clearValidators();
    datesControl?.clearValidators();

    // Clear component properties
    this.selectedDays = [];
    this.selectedDates = [];

    // Update validity
    schedulerTimeControl?.updateValueAndValidity();
    daysControl?.updateValueAndValidity();
    datesControl?.updateValueAndValidity();

    this.showDailyTime = false;
    this.showWeeklyTime = false;
    this.showMonthlyTime = false;
    this.showDefaultTime = true;

    //console.log('Form after reset:', this.agentForm.value);
  }

  isTaskAgent(): boolean {
    const agentTypeId = this.agentForm.get('agent_type_id')?.value;
    const agentType = this.agentTypes.find(
      (type) => type.value === agentTypeId
    );
    return agentType?.label.toLowerCase() === 'task agent';
  }

  isScheduleFormValid(): boolean {
    const frequencyControl = this.agentForm.get('scheduleFrequency');
    const timeControl = this.agentForm.get('schedulerTime');
    const daysControl = this.agentForm.get('selectedDays');
    const datesControl = this.agentForm.get('selectedDates');

    // If no frequency is selected, the form is invalid
    if (!frequencyControl?.value) {
      return false;
    }

    // Check if the frequency is already used
    if (this.schedules.some((s) => s.frequency === frequencyControl.value)) {
      return false;
    }

    // Ensure time is provided and valid
    if (!timeControl?.value || timeControl.invalid) {
      return false;
    }

    // For weekly, ensure at least one day is selected
    if (frequencyControl.value === 'weekly') {
      const selectedDays = daysControl?.value as number[];
      if (!selectedDays || selectedDays.length === 0) {
        return false;
      }
    }

    // For monthly, ensure at least one date is selected
    if (frequencyControl.value === 'monthly') {
      const selectedDates = datesControl?.value as string[];
      if (!selectedDates || selectedDates.length === 0) {
        return false;
      }
    }

    return true;
  }

  isScheduleFormValidCreateNew(): boolean {
    const frequencyControl = this.createAgentForm.get('scheduleFrequency');
    const timeControl = this.createAgentForm.get('schedulerTime');
    const daysControl = this.createAgentForm.get('selectedDays');
    const datesControl = this.createAgentForm.get('selectedDates');

    // If no frequency is selected, the form is invalid
    if (!frequencyControl?.value) {
      return false;
    }

    // Check if the frequency is already used
    if (this.schedules.some((s) => s.frequency === frequencyControl.value)) {
      return false;
    }

    // Ensure time is provided and valid
    if (!timeControl?.value || timeControl.invalid) {
      return false;
    }

    // For weekly, ensure at least one day is selected
    if (frequencyControl.value === 'weekly') {
      const selectedDays = daysControl?.value as number[];
      if (!selectedDays || selectedDays.length === 0) {
        return false;
      }
    }

    // For monthly, ensure at least one date is selected
    if (frequencyControl.value === 'monthly') {
      const selectedDates = datesControl?.value as string[];
      if (!selectedDates || selectedDates.length === 0) {
        return false;
      }
    }

    return true;
  }
  

  isNextOrSubmitDisabled(): boolean {
    const frequencyControl = this.agentForm.get('scheduleFrequency');
    const timeControl = this.agentForm.get('schedulerTime');
    const daysControl = this.agentForm.get('selectedDays');
    const datesControl = this.agentForm.get('selectedDates');

    // Log state for debugging
    console.log('isNextOrSubmitDisabled state:', {
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      schedules: this.schedules,
      isScheduleFormValid: this.isScheduleFormValid(),
      frequency: frequencyControl?.value,
      formErrors: {
        frequency: frequencyControl?.errors,
        time: timeControl?.errors,
        days: daysControl?.errors,
        dates: datesControl?.errors,
      },
      formValid: this.agentForm.valid,
    });

    if (this.currentStep === 2) {
      // On Step 2, enable "Next" if:
      // 1. No frequency is selected and no validation errors exist
      // 2. At least one schedule is added
      if (!frequencyControl?.value && this.schedules.length === 0) {
        // No frequency selected, check if there are no residual errors
        return !!(
          frequencyControl?.errors ||
          timeControl?.errors ||
          daysControl?.errors ||
          datesControl?.errors
        );
      } else if (this.schedules.length > 0) {
        // At least one schedule is added, enable "Next" if no invalid form state
        return !!(
          frequencyControl?.errors ||
          timeControl?.errors ||
          daysControl?.errors ||
          datesControl?.errors
        );
      } else {
        // A frequency is selected but schedule not added, enable only if "Add Schedule" is disabled
        return this.isScheduleFormValid();
      }
    } else if (this.currentStep === this.totalSteps) {
      // On the final step, require at least one schedule for "Submit"
      if (this.schedules.length === 0) {
        return true; // Disable if no schedules
      }
      // Check if there are any residual errors
      return !!(
        frequencyControl?.errors ||
        timeControl?.errors ||
        daysControl?.errors ||
        datesControl?.errors
      );
    } else {
      // For other steps, check if the step controls are valid
      const stepControls = this.getStepControls(this.currentStep);
      return stepControls.some((controlName) => {
        const control = this.agentForm.get(controlName);
        return control?.invalid && !control?.disabled;
      });
    }
  }
  isAdmin(): boolean {
    const loggedUser = this._stateService.getLoginDetails();

    if (!loggedUser) return false;

    const role = loggedUser.Role || loggedUser.role || loggedUser.RoleName;

    //console.log('Detected Role:', role);
    return role?.toLowerCase() === 'super admin';
  }

  isRefreshing = false;

  Onrefresh() {
    this.isRefreshing = true;

    const params = {
      agent_id: this.agentForm.get('api_agent_id')?.value,
      api_key: this.agentForm.get('agent_api_key')?.value,
    };

    this._marketService
      .getUpdatedExternalData(params)
      .pipe(finalize(() => (this.isRefreshing = false)))
      .subscribe({
        next: (response) => {
          this._marketService.getAgentDetails().subscribe({
            next: (allAgentsResponse) => {
              this.agents = allAgentsResponse.data;

              if (this.isEditMode && this.selectedAgentId) {
                const updatedAgent = this.agents.find(
                  (a) => a.agent_id === this.selectedAgentId
                );
                if (updatedAgent) {
                  this.openEditModal(updatedAgent);
                }
              }
            },
            error: (err) => {
              console.error('Error fetching all agents:', err);

              const error = getApiError(err);
              if (!error) {
                console.error('Failed to update agent:', response.message);
              }
            },
          });
        },
        error: (err: any) => console.error('Error updating agent:', err),
      });
  }

  useThisPrompt(json_response: any): void {
    //console.log('Using this prompt with JSON output:', json_response);

    this.createAgentForm.patchValue({
      description: json_response.agent_description,
      agent_goal: json_response.agent_goal,
      agent_prompt: json_response.agent_instructions,
      name: json_response.agent_name,
      agent_role: json_response.agent_role,
    });

    // Dismiss the modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('promptBuilderModal'));
    modal?.hide();


    // this.cdRef.detectChanges();

  }

  getApproverEmailsList(): void {
    this._marketService.getApproverEmailsList().subscribe({
      next: (response) => {
        //console.log('Approver Emails List:', response.data);
        this.approverEmails = response.data;
      },
      error: (err) => {
        console.error('Error fetching approver emails:', err);
      }
    });
  }

  getApprovalStatusColor(status: string): string {
    switch (status.toLowerCase()) {
      case 'approved':
        return 'green';
      case 'pending approval':
        return 'orange';
      case 'rejected':
        return 'red';
      default:
        return 'gray';
    } 
  }

  // Version History Methods
  loadVersionHistory(): void {
    //console.log('selectedAgent in loadVersionHistory:', this.selectedAgent);
    if (!this.selectedAgent || !this.selectedAgent._id) {
      this.showToast('error','Error loading version history: Invalid agent ID');
      return;
    }
    
    this._loadingService.show();
    const payload={
      'agent_id':this.selectedAgent._id
    }
    this._marketService.getAgentVersionHistory(payload).subscribe({
      next: (response) => {
        this._loadingService.hide();
        this.versionHistory = response.data || [];
        //console.log('Version History loaded:', this.versionHistory);
        this.cdRef.detectChanges();
      },
      error: (err) => {
        this._loadingService.hide();
        console.error('Error loading version history:', err);
        this.showToast('error', 'Failed to load version history');
      }
    });
  }

  loadVersionDetails(version: any): void {
    if (!version || !version.version) {
      return;
    }
    
    this._loadingService.show();
    const payload={
      'agent_id':this.selectedAgent._id,
      'version':version
    }
    let agent_data = version.agent_doc_data;
    agent_data._id = version.agent_id;
    agent_data.agent_id = this.selectedAgentId
    this.versionHistoryModal.hide();
    this.openExternalNewAgentEditModal(agent_data);
    this._loadingService.hide();
    // this._marketService.getAgentVersionDetails(payload).subscribe({
    //   next: (response) => {
    //     console.log('Version Details:', response.data);
    //     const agent_data = response.data;
    //     this.versionHistoryModal.hide();
    //     this.openEditModal(agent_data);
    //     this._loadingService.hide();
        
    //     // You can populate the form with these details or display in a separate modal
    //     this.showToast('success', `Version ${version.version} details loaded`);
    //   },
    //   error: (err) => {
    //     this._loadingService.hide();
    //     console.error('Error loading version details:', err);
    //     this.showToast('error', 'Failed to load version details');
    //   }
    // });
  }

  deleteVersion(version: any): void {
    if (!version || !version.version) {
      return;
    }
    
    if (confirm(`Are you sure you want to delete version ${version.version}?`)) {
      this._loadingService.show();
      this._marketService.deleteAgentVersion(this.selectedAgent._id, version.version).subscribe({
        next: (response) => {
          this._loadingService.hide();
          this.showToast('success', `Version ${version.version} deleted successfully`);
          this.loadVersionHistory();
        },
        error: (err) => {
          this._loadingService.hide();
          console.error('Error deleting version:', err);
          this.showToast('error', 'Failed to delete version');
        }
      });
    }
  }

  // Helper method to extract date from MongoDB format
  extractDate(dateObj: any): any {
    if (!dateObj) {
      return null;
    }
    
    // If it's a MongoDB date object with $date property
    if (typeof dateObj === 'object' && dateObj.$date) {
      return new Date(dateObj.$date);
    }
    
    // If it's already a string
    if (typeof dateObj === 'string') {
      return new Date(dateObj);
    }
    
    // If it's already a Date object
    if (dateObj instanceof Date) {
      return dateObj;
    }
    
    return null;
  }


  // functionality for create Agent Form

  get isAgentNameDuplicateCreateAgent(): boolean {
    const nameControl = this.createAgentForm.get('name');
    const name = nameControl?.value?.trim().toLowerCase();
    const originalName = this.originalAgentName?.trim().toLowerCase();
    if (!name || name === originalName) return false;
    const hasInteracted =
      nameControl?.dirty || nameControl?.touched || this.formSubmitted;
    if (!hasInteracted) return false;
    return this.allAgents.some(
      (agent) =>
        agent.name?.trim().toLowerCase() === name &&
        agent.agent_id !== this.selectedAgentId
    );
  }

  initCreateAgentForm(): void {
    this.createAgentForm = this.fb.group({
      name: ['', Validators.required],
      agent_owner: [{value:'external', disabled: true }],
      agent_provider_type: [{value:'new', disabled: true }],
      agent_type_id: ['', Validators.required],
      agent_type_name: [''],
      role_id: ['', Validators.required],
      agent_id: [''],
      user_id: [''],
      description: ['', Validators.required],
      version: [{ value: '1.0.0', disabled: true }, Validators.required],
      agent_role: ['', Validators.required],
      agent_goal: ['', Validators.required],
      prompt_template: [{ value: '', disabled: true }],
      agent_prompt: ['', Validators.required],
      model: ['', Validators.required],
      ref_output: [''],
      example: [''],
      mcp_connector_id: [null],
      foundation_resp_ai: [false],
      foundation_ethic_ai: [false],
      foundation_guardrails_ai: [false],
      status: [''],
      knowledge_store_id: [''],
      knowledge_store_value: [''],
      knowledge_store_enabled: [true],
      knowledge_store_checkbox: [false],
      data_store_checkbox: [false],
      memory_checkbox: [false],
      context_checkbox: [false],
      mcp_connector_value: [''],
      mcp_connector_enabled: [true],
      mcp_connector_checkbox: [false],
      ai_foundation_enabled: [{ value: false, disabled: true }],
      model_enabled: [true],
      foundation_resp_ai_toggle: [true],
      foundation_resp_ai_value: [''],
      foundation_ethic_ai_toggle: [true],
      foundation_ethic_ai_value: [''],
      foundation_guardrails_ai_toggle: [true],
      foundation_guardrails_ai_value: [''],
      agent_api_key: [''],
      session_id: [''],
      agent_api_url: [''],
      agent_session_id: [''],
      scheduleFrequency: [''],
      schedulerTime: [''],
      action_required: [''],
      avatar: [''],
      selectedDays: [[]],
      selectedDates: [[]],
      actions: this.fb.array([]),
      run_count: [0],
      api_agent_id: [''],
      rating: [0],
      usage_count: [0],
      trending: [false],
      ai_foundation: this.fb.array([]),
      approverEmail: ['', [Validators.required, Validators.email]],
      saveHistory: [false],
      session_start_url: [''],
      session_end_url: ['']
    });
  }

  goNextCreateAgent(): void {
    if (this.currentCreateAgentStep === 1) {
      this.currentCreateAgentStep = 2;
    } else if (this.currentCreateAgentStep === 2) {
      this.currentCreateAgentStep = 3;
    } else if (this.currentCreateAgentStep === 3) {
      if (this.createAgentForm.invalid) {
        this.showToast('error', 'Please fill in all required fields.');
        console.log(
          'Invalid controls:',
          Object.keys(this.createAgentForm.controls).filter(
            (key) => this.createAgentForm.get(key)?.invalid
          )
        );
        this.createAgentForm.markAllAsTouched();
        return;
      }
      this.submitCreateAgentForm();
    }
  }

  goBackCreateAgent(): void {
    if (this.currentCreateAgentStep === 1) {
      this.closeCreateAgentModal();
    } else if (this.currentCreateAgentStep === 2) {
      this.currentCreateAgentStep = 1;
    } else if (this.currentCreateAgentStep === 3) {
      this.currentCreateAgentStep = 2;
    }
  }

  isCreateAgentStepValid(step: number): boolean {
    if (step === 1) {
      const controlsToCheck = ['name', 'agent_type_id', 'role_id', 'description', 'version', 'agent_role', 'agent_goal', 'agent_prompt', 'model'];
      return controlsToCheck.every((controlName) => {
        const control = this.createAgentForm.get(controlName);
        return control?.valid || control?.disabled;
      });
    } else if (step === 2) {
      // Schedule step: optional, allow proceeding to Actions
      return true;
    } else if (step === 3) {
      let controlsToCheck = ['approverEmail'];
      if (this.createAgentForm.get('agent_type_id')?.value?.toLowerCase() === 'type_master' && this.totalPercentage!=100) {
        return false;  
      }
      return controlsToCheck.every((controlName) => {
        const control = this.createAgentForm.get(controlName);
        return control?.valid || control?.disabled;
      });
    } else {
      return false;
    }
  }


  submitCreateAgentForm(): void {
    this._loadingService.show();
    console.log('Submitting Create Agent Form:', this.createAgentForm);

    const formValue = this.prepareFormData(this.createAgentForm);
    this.agentForm.patchValue({
      mcp_connector_value: formValue.mcp_connector_value,
      knowledge_store_value: formValue.knowledge_store_value,
      knowledge_store_enabled: formValue.knowledge_store_enabled,
      knowledge_store_checkbox: formValue.knowledge_store_checkbox,
      data_store_checkbox: formValue.data_store_checkbox,
      memory_checkbox: formValue.memory_checkbox,
      context_checkbox: formValue.context_checkbox,
      ai_foundation: formValue.ai_foundation,
      ai_foundation_enabled: formValue.ai_foundation_enabled,
      model: formValue.model,
      foundation_resp_ai_value: formValue.foundation_resp_ai_value,
      foundation_ethic_ai_value: formValue.foundation_ethic_ai_value,
      foundation_guardrails_ai_value: formValue.foundation_guardrails_ai_value,
    });
    //console.log('Prepared Form Value submit:', formValue);
    //console.log(this.providerModelsFromLyzr)
    const payload: any = {
      agent_submit_type:this.isEditMode ? "edit" : "new",
      agent_id: this.isEditMode ? this.selectedAgentId : this.generateObjectId(),
      name: formValue.name,
      role_id: formValue.role_id,
      description: formValue.description,
      version: formValue.version,
      agent_role: formValue.agent_role,
      agent_goal: formValue.agent_goal,
      prompt_template: formValue.prompt_template,
      agent_prompt: formValue.agent_prompt,
      ref_output: formValue.ref_output,
      example: formValue.example,
      model: formValue.model_enabled ? formValue.model : null,
      model_data: this.providerModelsFromLyzr.find((m:any) => m.model?.name === formValue.model)? this.providerModelsFromLyzr.find((m:any) => m.model?.name === formValue.model) : null,
      mcp_connector_id: formValue.mcp_connector_enabled
        ? formValue.mcp_connector_value
        : null,
      mcp_connector_checkbox: formValue.mcp_connector_checkbox ? formValue.mcp_connector_checkbox : null,
      mcp_connector_value: this.configuredToolDetails,
      knowledge_store_id: formValue.knowledge_store_enabled
        ? formValue.knowledge_store_id
        : null,
      knowledge_store_enabled: formValue.knowledge_store_enabled,
      knowledge_store_checkbox: formValue.knowledge_store_checkbox,
      knowledge_store_value: this.configuredKGDetails,
      data_store_checkbox: formValue.data_store_checkbox,
      data_store_value: this.configuredDataQueryDetails,
      memory_checkbox: formValue.memory_checkbox,
      memory_value: this.configuredMemoryDetails,
      context_checkbox: formValue.context_checkbox,
      context_value: this.configuredContextDetails,
      foundation_resp_ai: formValue.foundation_resp_ai_toggle
        ? formValue.foundation_resp_ai_value
        : null,
      foundation_ethic_ai: formValue.foundation_ethic_ai_toggle
        ? formValue.foundation_ethic_ai_value
        : null,
      foundation_guardrails_ai: formValue.foundation_guardrails_ai_toggle
        ? formValue.foundation_guardrails_ai_value
        : null,
      status: formValue.status,
      agent_owner: formValue.agent_owner,
      agent_provider_type: formValue.agent_provider_type,
      agent_type_id: formValue.agent_type_id,
      agent_type_name: formValue.agent_type_name,
      scheduleFrequency: formValue.scheduleFrequency,
      schedulerTime: formValue.schedulerTime,
      actions: formValue.actions,
      approverEmail: formValue.approverEmail,
      avatar: formValue.avatar,
      ai_foundation: formValue.ai_foundation,
      save_history: formValue.saveHistory,
      session_start_url: formValue.session_start_url,
      session_end_url: formValue.session_end_url,
      modified_by: {
        "email":this.loggedUser?.Email,
        "name":this.loggedUser?.UserName,
      },
    };

    console.log('Final Payload for submission:', payload);

    this._marketService.onboardExternalNewAgent(payload).subscribe({
      next: () => {
        this._loadingService.hide();
        this.showToast('success', 'Agent Details Sent For Approval Successfully')
        this.loadAgents();
        this.getAgentCounts();
        this.closeCreateAgentModal();
        this.cdRef.detectChanges();
      },
      error: (err) => {
        this._loadingService.hide();
        console.error('Onboarding error:', JSON.stringify(err));

        const error = getApiError(err);
        if (error) {
          const errorMessage =
            error.message ||
            'Failed to onboard agent: No additional details provided.';
          this.showToast('error', errorMessage);
          this._loadingService.hide();
          this.cdRef.detectChanges();
          return;
        }
        let errorMessage =
          'Failed to onboard agent: An unexpected error occurred.';
        if (err.error) {
          if (err.error.Message) {
            errorMessage = err.error.Message;
          } else if (err.error.message) {
            errorMessage = err.error.message;
          } else if (err.error.errors) {
            // Handle cases where errors are returned as an array or object
            if (Array.isArray(err.error.errors)) {
              errorMessage = err.error.errors.join(', ');
            } else if (typeof err.error.errors === 'object') {
              errorMessage = Object.values(err.error.errors).join(', ');
            }
          } else if (typeof err.error === 'string') {
            errorMessage = err.error;
          }
        } else if (err.message) {
          errorMessage = err.message;
        } else if (err.statusText) {
          errorMessage = `Failed to onboard agent: ${err.statusText}`;
        }

        this.showToast('error', errorMessage);
        this.cdRef.detectChanges();
      },
    });
  }

  submitCreateAgentEditForm(): void {
  }

  openExternalNewAgentEditModal(agent: any): void {
    this.isEditingName = false;
    this.originalAgentName = agent.name;
    this.selectedAgentId = agent.agent_id;
    this.selectedAgent=agent
    this.selectedObjectId = agent._id;
    this.currentCreateAgentStep = 1;
    this.approvalState = {
      'status':agent.Approval_Status? agent.Approval_Status : 'Approved',
      'approverEmail':agent.approverEmail? agent.approverEmail : '',
      'status_msg': agent.Approval_Status_Message? agent.Approval_Status_Message : agent.Approval_Status? agent.Approval_Status : 'Unknown',
      // 'approvedAt':agent.Approved_At? agent.Approved_At : '',
    }
    this.createAgentForm.reset();
    this.createAgentForm.patchValue({
      name: agent.name || '',
      agent_owner: agent.agent_owner || '',
      agent_provider_type: agent.agent_provider_type || 'existing',
      agent_type_id: agent.agent_type_id || '',
      role_id: agent.role_id || '',
      description: agent.description || '',
      version: agent.version || '',
      agent_role: agent.agent_role || '',
      agent_goal: agent.agent_goal || '',
      prompt_template: agent.prompt_template || '',
      agent_prompt: agent.agent_prompt || '',
      ref_output: JSON.stringify(agent.ref_output, null, 2) || '',
      example: agent.example || '',
      avatar: agent.avatar || '',
      agent_api_url: agent.agent_api_url || '',
      agent_api_key: agent.agent_api_key || '',
      user_id: agent.user_id || '',
      agent_id: agent.agent_id || '',
      agent_session_id: agent.agent_session_id || '',
      api_agent_id: agent.api_agent_id || '',
      schedulerTime: '',
      selectedDays: this.selectedDays,
      selectedDates: this.selectedDates,
      trending: agent.trending || false,
      status: agent.status || '',
      rating: agent.rating || 0,
      run_count: agent.run_count || 0,
      mcp_connector_checkbox: agent.mcp_connector_checkbox || false,
      knowledge_store_checkbox: agent.knowledge_store_checkbox || false,
      data_store_checkbox: agent.data_store_checkbox || false,
      memory_checkbox: agent.memory_checkbox || false,
      context_checkbox: agent.context_checkbox || false,
      ai_foundation_enabled:
        agent.ai_foundation && agent.ai_foundation !== 'None',
      model_enabled: !!agent.model,
      model: agent.model || '',
      foundation_resp_ai_toggle: !!agent.foundation_resp_ai,
      foundation_resp_ai_value: agent.foundation_resp_ai || '',
      foundation_ethic_ai_toggle: !!agent.foundation_ethic_ai,
      foundation_ethic_ai_value: agent.foundation_ethic_ai || '',
      foundation_guardrails_ai_toggle: !!agent.foundation_guardrails_ai,
      foundation_guardrails_ai_value: agent.foundation_guardrails_ai || '',
      saveHistory: agent.saveHistory || false
    });
    //console.log('Patched form values:', this.createAgentForm.getRawValue());

    // Populate selected checkboxes
    this.configuredToolDetails = agent.mcp_connector_value || '';
    this.configuredKGDetails = agent.knowledge_store_value || '';
    this.configuredDataQueryDetails = agent.data_store_value || '';
    this.configuredMemoryDetails = agent.memory_value || '';
    this.configuredContextDetails = agent.context_value || '';

    this.createNewActions.clear();
    if (agent.agent_type_id==='TYPE_MASTER') {
      if (agent.actions && agent.actions.length > 0) {
        agent.actions.forEach((a: any) => {
          const actionGroup = this.fb.group(
            {
              name: [a.name || '', Validators.required],
              percentage: [
                Number(a.percentage) || 0,
                [Validators.required, Validators.min(0), Validators.max(100)],
              ],
            },
            { validators: this.requireBothIfOneFilled }
          );
          this.createNewActions.push(actionGroup);
        });
      } else {
        this.createNewActions.push(this.createAction());
      }
      this.calculateTotalCreateNew();
      this.createNewActions.updateValueAndValidity();
    }

    const modal = bootstrap.Modal.getOrCreateInstance(this.createAgentModal.nativeElement);
    modal.show();
  }

  getAvatarUrl(d: unknown) {
    return (d && typeof d === 'string')  ? d : 'assets/img/Agent_Profile_Icon.svg'
  }

  connectorId = signal('');

  onConnectorSelect(id: string) {
    this.connectorId.set(id)
    this.agentForm.patchValue({ internal_tool: [] })
  }

  toolOptions = computed(() => {
    if (this.toolsQuery.error()) return [];

    const data =  this.toolsQuery
          .value()
          ?.data?.[this.connectorId()];

    if(!data) return []
      
   

    if(data.tools_order?.length) {

      const map = data.active_tools.reduce<Record<string,string>>((a,b) => {
        a[b.tool_action_name] = b._id;
        return a
      },{})

      return  data.tools_order?.map((label) => ({
        label,
        value: map[label],
      }))
    }

    return data.active_tools?.map(item => ({
      label: item.tool_action_name,
      value: item._id
    })) || []
  });

  connectorsOptions = computed<TOption[]>(() => {
    const arr = !this.connectionQuery.error() && this.connectionQuery.value()?.data?.flatMap((item) =>
          item.connections.map((connection) => ({
            label: connection.connection_name,
            value: connection.connection_id,
            data: item.connector_type,
          })),
        );

    return arr && arr.length ? [{ label: 'Select', value: '' }, ...arr] : []
  });
  connectionQuery = rxResource({
    stream: () => this._marketService.fetchConnection(),
  });
  toolsQuery = rxResource({
    params: () => this.connectorId() || undefined,
    stream: ({ params }) => this._marketService.getConnectionData(params),
  });
}
