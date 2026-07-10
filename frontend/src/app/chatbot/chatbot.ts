// @ts-nocheck
import { Component, OnInit, ViewChild, ElementRef, AfterViewChecked, AfterViewInit, ChangeDetectorRef, viewChild, signal, NgZone, ViewChildren, QueryList,HostListener } from '@angular/core';
import { HomeService } from '../services/home.service';
import { CommonModule, Location } from '@angular/common';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { FormsModule } from '@angular/forms';
import * as FileSaver from 'file-saver';
import { SemarketplaceService } from '../services/semarketplace.service';
import { TooltipDirective } from '../custom-tooltip/tooltip.directive';
import { MessageExpandDirective } from '../utils/message-expand.directive';
import { NgxSpinnerService } from 'ngx-spinner';
import { secommendcenter } from '../services/secommedcenter.service';
import { Router, NavigationEnd, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Header } from '../header/header';
import { __param } from 'tslib';
import { environment as config, environment } from '../../environments/environment';
import { WorkflowService } from '../services/workflow.service';
import { interval, Subscription } from 'rxjs';
import { io,Socket } from 'socket.io-client';
import { Vflow, VflowComponent, Edge, Connection, DynamicNode, HtmlTemplateDynamicNode, NodeChange } from 'ngx-vflow';
import { DndDropEvent, DndModule } from 'ngx-drag-drop';
import { IReferenceData, IFlowTask, TWorkflowFormData, IConditionFormData, IWorkflow } from '../types';
import { ProgressBarDirective } from '../utils/progress-bar.directive';
import { getApiError, PSV_REGEX } from '../utils';
import MarkdownIt from 'markdown-it';
import { extractMarkdownTables, jsonToCsv, parseSerializedBddJson, repairTableStructure, tablesToCsvJson, extractJsonFromMarkdown, transformBddJsonToMarkdownTables, normalizeBddJSON, MarkdownTable, extractPsvTables } from '../utils/table.util';
import { EditableTable } from './editable-table';
import { PromptRepositoryService, TryPromptData } from '../services/prompt-repository.service';
import { Popover } from '../components/popover/popover';


declare var $: any;
declare var bootstrap: any;

type TCard = 'basicDetails' | 'nodes' | 'workflowComposition';
interface IDragComponentConfig {
  id: string;
  label: string;
  icon: string;
  type: IReferenceData['type'];
}

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [CommonModule, FormsModule, TooltipDirective, Header, Vflow, DndModule, ProgressBarDirective, EditableTable,MessageExpandDirective, RouterLink, Popover],
  templateUrl: './chatbot.html',
  styleUrl: './chatbot.css'
})
export class Chatbot implements OnInit, AfterViewChecked, AfterViewInit {
  isChatOpen: boolean = false;
  isNewChatOpen: boolean = false;
  isOtherPopupOpen: boolean = false;
  agentTypes: any[] = [];
  trendingAgents: any[] = [];
  allAgents: any[] = [];
  modelsList: any[] = [];
  filteredAgents: any[] = [];
  totalItems: number = 0;
  showAll: boolean = false;

  userName: any;
  Email: any;
  masterAgents: any[] = [];
  userQuery: string = '';
  userQuery1: string = '';
  showSendIcon: boolean = false;
  showSendIcon1: boolean = false;
  isChatSubmitted: boolean = false;
  isChatMinimized: boolean = false;
  chatResponses: any[] = [];
  eventResponses: any[] = [];
  selectedResponseIndex: Record<number, boolean> = {};
  plainResponses: string[] = [];
  isConversationStarted: boolean = false;
  isThinkingShown: boolean = false;
  isCollapsed = true;
  isSidebarExpanded: boolean = false;
  isSidebarPinned: boolean = false;
  pageTitle: string = '';
  selectedAgentOption: string | null = null;
  selectedAgent: any = null;
  isFeedbackSubmitted = false;
  submittedRating: number = 0;
  submittedFeedbackText: string = '';
  
  isRecentChat: boolean = false;
  loaderSteps = [
    { icon: '🪄', title: 'Identifying suitable AI Agent...', desc: '“Matching task with relevant agent.”' },
    { icon: '⚙️', title: `Connecting with Master Agent: ${this.selectedAgent?.name}...`, desc: `“Engaging expert in ${this.selectedAgent?.name}-related tasks.”` },
    { icon: '🔗', title: `${this.selectedAgent?.name} engaged. Scanning agent pool...`, desc: '“Looking for specialized Task Agent.”' },
    // { icon: '🌱', title: `Assigning Task Agent: ${this.selectedAgentOption}...`, desc: '“Agent selected for generating context-aware user stories.”' },
    { icon: '🌱', title: `Assigning Task Agent: ${this.selectedAgentOption}...` },
    // { icon: '🛠️', title: `Initializing ${this.selectedAgentOption} workflow...`, desc: '“Mapping out use cases, validating user intents, applying business logic.”' },
    { icon: '🛠️', title: `Initializing ${this.selectedAgentOption} workflow...` },
    // { icon: '🧾', title: `Generating ${this.selectedAgentOption}...`, desc: '“Formulating structured user stories based on identified KYC scenarios.”' },
    { icon: '🧾', title: `Generating ${this.selectedAgentOption}...` },
    { icon: '✅', title: 'Finalizing output...', desc: '“Preparing to display.”' }
  ];

  additionalChatPopoverOptions = [
    { label: "Call Agent", caption: 'Talk-based Support', icon: 'fa-phone', link: '/voice-chat'},
    { label: "AI Assistant", caption: 'Text-based Support', icon: 'fa-commenting', link: '/chatbot'},
  ]
  
  currentLoaderStep = 0;
  isLoading = false;
  showThinking: boolean = false;
  isagentrouted: boolean = false;
  isWorkflowrouted: boolean = false;
  isWorkflowrouted1: boolean = false;
  routefromagent: boolean = false;
  latestUserQuery: string = '';
  titleFromResponse: string = '';
  showWelcomePanel: boolean = false;
  secondaryAgents: any[] = [];
  chatMessages: { from: string; text: string, expanded: false, showToggle: false }[] = [];
  gherkinKeywords: string[] = ['Feature:', 'Scenario:', 'Given', 'When', 'Then', 'And'];
  secondryAgentId: string = '';
  isChatOpenedByAgent: boolean = false;
  isWorkflow: boolean = false;
  copyBlink: boolean = false;
  agentId: any;
  workflowId: any;
  taskagentId = '';
  showAgentPrompt = false;
  isChatInProgressBeforeMinimize: boolean = false;
  isNewChatOpenBeforeMinimize: boolean = false;
  recentQueries: any[] = [];
  popularQueriesLoading: boolean = false;
  IsReviewCases: boolean = false;
  recentData: any[] = [];
  recentOGData : any[] = [];
  recentQueryForSuggestionData: any[] = [];
  recentQueryForSuggestionOGData: any[] = [];
  isSuggestionLoading: boolean = false;
  selectedQueries = new Set<string>();   // Track selected queries by user_query
  expandedIndexes = new Set<number>();
  currentView: string = 'text';
  systemPrompt: string = "";
  thoughts: any[] = [];
  actions: string = "";
  refrainPrompt: string = "";
  thoughtsInput: string = '';
  isfeedback: boolean = false;
  explanationtab: boolean = false;
  taskagentName = '';
  agentDetails: any;
  selectedRating: number = 0;   // Stores the selected star rating
  hoveredRating: number = 0;    // For temporary hover effect on stars
  feedbackText: string = '';    // Feedback input text
  isPopupVisible: boolean = false;
  rawResponses: string[] = [];
  openIndex: number | null = 0;
  results: any[] = [];
  toastMessage: string = '';
  loggedUser: any;
  masterDatabase = config.masterDatabase;
  alltaskAgents: any[] = [];
  agenciesWithAgents: any[] = [];
  workflowIdFromState: string | null = null;
  workflowQuery: string = '';
  workflowDetails: any = null;
  workflows: IWorkflow[] = [];
  isWorkflowReviewMode: boolean = false;
  workflowResponse: any = null;
  workflowResponseResults: any[] = [];
  private workflowPollingSubscription: Subscription | null = null;
  eventTrackingUniqueId: string = '';
  selectedEventId: string = '';
  private processedResultIds: Set<string> = new Set();
  private expectedResultCount: number = 0;
  workflowCompleted: boolean = false;
  private emptyResponseCount: number = 0;
  isWorkflowLoading: boolean = false;
  isWorkFlowExternal: boolean = false;
  isActive = false;
  useIcon:Boolean=false;
  showThinkingDuringLoading: boolean = true;
  isThinkingCollapsed: boolean = false;
  hasRealLogs: boolean = false;
  logsDuringLoading: Array<{timestamp: string, message: string, type: string, source: string, icon: string, title: string, desc: string, originalData: any}> = [];
  isProcessingCompleted: boolean = false;
  completionMessageReceived: boolean = false;
  isLoadingExplanationData = false;
  explanationDataPollingSubscription: any = null;
  explanationDataRetrieved = new Set<string>();
  isLoadingLogsAndTraces = false;
  logsDuringWorkflowLoading: any[] = [];
  hasWorkflowLogs = false;
  isWorkflowThinkingCollapsed = false;
  workflowThinkingLogs: any[] = [];
  workflowAllLogsLoaded = false;
  isWorkflowThinkingLoading = false;
  isResponseFullyLoaded: boolean = false;
  sidebarWidth: number = 320;   // Initial width in pixels (you can adjust)
  md: MarkdownIt;
  agent_inputs: any[] = [];

  private isResizing = false;
  private startX = 0;
  private startWidth = 0;
  
  //#region Workflow Builder Variables
  vflow = viewChild.required(VflowComponent);
  @ViewChild('vflowContainer') vflowContainer!: ElementRef<HTMLDivElement>;

  cardState: { [key in TCard]: { open: boolean } } = {
    basicDetails: { open: true },
    nodes: { open: true },
    workflowComposition: { open: true },
  };

  typeMapping: {
    [key in IReferenceData['type']]: Pick<
      IDragComponentConfig,
      'icon' | 'label'
    >;
  } = {
      agent: { label: 'Agent', icon: 'assets/img/bot.svg' },
      iterative: {
        label: 'Iterative',
        icon: 'assets/img/iterative.svg',
      },
      condition: {
        label: 'Condition',
        icon: '<i class="fa-solid fa-code-branch"></i>',
      },
      api: { label: 'Api Call', icon: 'assets/img/bot.svg' },
    };

  dragComponents: IDragComponentConfig[] = Object.keys(this.typeMapping).map(
    (type) => ({
      id: crypto.randomUUID(),
      label: this.typeMapping[type as IReferenceData['type']].label,
      icon: this.typeMapping[type as IReferenceData['type']].icon,
      type: type as IReferenceData['type'],
    })
  );

  edges: Edge[] = [];
  nodes: DynamicNode[] = [];
  zoomStep = 0.1;

  selectedNode?: HtmlTemplateDynamicNode;

  nodesFormState: {
    [key: string]: TWorkflowFormData;
  } = {};

  workflowBondingDetails: IWorkflow | null = null;

  agencyOptions: { id: string; name: string }[] = [];

  isSubmitted = false;
  isSubmitting = false;

  IsWorkFlowLoad: boolean = false;

  nodeStatus: {
    [nodeId: string]: {
      status: 'Not Started' | 'Running' | 'Completed';
      progress?: number;      // 0–100
      elapsedTime?: number;   // seconds
    };
  } = {};

  selectedNodeData: any = null;

  jobMap = new Map<string, any>(); // id → job
  runningCount = 0;
  completedCount = 0;
  failedCount = 0;
  avgDuration = 0; // or fetch from data
  agentDurations: number[] = []; // stores elapsedTime of each completed agent
  false_condition_node_ids: string = '';
  activeTab: 'workflow' | 'output' = 'workflow';
  baseURL: string = environment.baseUrl;
  websocketPath: string = environment.WebSocketPath;
  IsConditionNodeAdded: boolean = false;
  isWorkEnd: boolean = false;
  conditionExecutionDetails: any = null;
  private initialResultsProcessed: boolean = false;
  firstResponseLoaded: boolean = false;
  workflowLogsByAgent: { [agentName: string]: any[] } = {};
  isLoadingExplanation = false;
  explanationDataLoaded = false;
  isPrivilegeView: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeRefresh: boolean = false;
  isPrivilegeExecute: boolean = false;

  isPrivilegeViewWorkflow: boolean = false;
  isPrivilegeEditWorkflow: boolean = false;
  isPrivilegeDeleteWorkflow: boolean = false;
  isPrivilegeRefreshWorkflow: boolean = false;
  isPrivilegeExecuteWorkflow: boolean = false;
  
  isPrivilegeVoiceAgentView: boolean = false;
  isPrivilegeVoiceAgentEdit: boolean = false;
  isPrivilegeVoiceAgentDelete: boolean = false;
  isPrivilegeVoiceAgentRefresh: boolean = false;
  isPrivilegeVoiceAgentExecute: boolean = false;
  
  currentSessionId: string | null = null;
  lastUsedAgentId: string = '';
  private tryPromptSubscription!: Subscription;
  saveToRepoModalVisible = false;
  currentResponseToSave: any = null;
  repoTitle: string = '';
  isEditingTitle: boolean = false;
  isFromPromptRepository: boolean = false;
  isPromptSaved: boolean = false;
  originalPromptData: any = null;
  isPromptUpdated: boolean = false;
  cameFromPromptRepository: boolean = false;  
  isPrivilegeViewPromptRepo: boolean = false;
  isPrivilegeEditPromptRepo: boolean = false;
  isPrivilegeAddPromptRepo: boolean = false;
  isPrivilegeDeletePromptRepo: boolean = false;
  isPrivilegeRefreshPromptRepo: boolean = false;
  isPrivilegeExecutePromptRepo: boolean = false;


  //#endregion

  constructor(private location: Location, private _router: Router, private _loadingService: NgxSpinnerService, private _homeService: HomeService, private _commentService: secommendcenter, private _marketService: SemarketplaceService, private cdRef: ChangeDetectorRef, private _stateService: AIInfuseStateService, private _workflowService: WorkflowService, private ngZone: NgZone,private promptRepoService: PromptRepositoryService) {
    this.md = MarkdownIt();
    this.md.renderer.rules['table_open'] = () => '<table class="table table-bordered">\n';
    const defaultFence = this.md.renderer.rules.fence || function(tokens,idx,options,env,self) {
      return self.renderToken(tokens, idx, options)
    }
    this.md.renderer.rules.fence = function (tokens, idx, options, env, self) {
      const token = tokens[idx];
      if(token?.info?.trim()?.startsWith('psv')) return ''

      return defaultFence(tokens, idx, options, env, self)
    }
   }

  @ViewChild('scrollContainer') scrollContainer!: ElementRef;
  @ViewChild('copyTooltip') copyTooltip!: ElementRef;
  @ViewChild('chatContainer') chatContainer!: ElementRef;
  @ViewChild('mainContainer') mainContainer!: ElementRef;
  @ViewChild('workflowTextAccordion', { static: false }) workflowTextAccordion?: ElementRef;

  ngOnInit(): void {
    this.loadPrivileges();
    this.fetchAgenciesWithAgents();
    this.loggedUser = this._stateService.getLoginDetails();
    this.loadDropdowns();


    this.userName = this.loggedUser.UserName;
    this.Email = this.loggedUser.Email;

    if (this.chatResponses?.length) {
      this.extractTitleFromResponse(this.chatResponses[0]);
    }
    this.chatMessages = [];
    this.IsReviewCases = this._stateService.getIsReviewCase();
    this.agentId = this._stateService.getSelectedAgency();
    console.log("aaaagentid", this.agentId)
    this.taskagentId = this._stateService.getSelectedAgency()?.agent_id ?? null;
    this.taskagentName = this._stateService.getSelectedAgency()?.agent_name ?? null;
    this.agentDetails = this._stateService.getAgentWithAgencyDetails();

    // Find the agent details matching the selected agent id
    if (this.taskagentId && this.agentDetails) {
      var selectedAgentDtls = this.agentDetails.find((agent: { agent_id: string; }) => agent.agent_id === this.taskagentId) ?? null;
      this.hoveredRating = selectedAgentDtls?.rating ?? 0;
      this.feedbackText = selectedAgentDtls?.feedback ?? "";
    }
    if (this.IsReviewCases == false && this.agentId) {
      // const { agent_name, ...rest } = this.agentId;
      // this.agentId = { ...rest, name: agent_name };
      // this.selectedAgent = this.agentId;
      // this.startrouteAgent(this.taskagentId,this.taskagentName);
      this.routefromagent = true;
      this.isagentrouted = true;
      console.log("iii")
      this.isSidebarExpanded = false;
      this.isNewChatOpen = true;
      this.explanationtab = false;
      this.selectedAgent = this.agentId;
      console.log("agent-id", this.selectedAgent)

      this.showWelcomePanel = true;
      this.latestUserQuery = '';
      this.chatResponses = [];
      this.chatMessages = [];
      this.selectedAgentOption = null;
	  this.isSuggestionLoading = false;
	  this.resetSelectedQueries();
      this.secondaryAgents = [];
      this.showThinking = false;
      this.isLoading = false;
      this.currentLoaderStep = 0;
      this.isChatOpenedByAgent = true;
      this.gettestcases(this.taskagentId)

    }
    if (this.IsReviewCases) {
      if (this.agentId) {
        this.routefromagent = true;
        this.isagentrouted = true;
        this.isSidebarExpanded = false;
        this.isNewChatOpen = true;
        this.explanationtab = false;
        this.selectedAgent = this.agentId;
        console.log("agent-id", this.selectedAgent)

        this.showWelcomePanel = true;
        this.latestUserQuery = '';
        this.chatResponses = [];
        this.chatMessages = [];
        this.selectedAgentOption = null;
        this.secondaryAgents = [];
		this.isSuggestionLoading = false;
		this.resetSelectedQueries();
        this.showThinking = false;
        this.isLoading = false;
        this.currentLoaderStep = 0;
        this.isChatOpenedByAgent = true;
        // this.gettestcases();
        this.geteventresponse();
        this.onBindAIExplanations();



      }
      else {
        this.isagentrouted = false;
      }
    }

    console.log("sss", this._stateService.getSelectedWorkflow())

    this._router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        if (event.urlAfterRedirects.includes('/commandcenterdashboard')) {
          console.log('Resetting state on navigation');
          this.isagentrouted = false;
          this.isWorkflowrouted = false;
          this.isWorkflowrouted1 = false;
          this.resetEventTracking();
          this._stateService.setSelectedWorkflow(null)
          this._stateService.setWorkflowDetails(null);
          this._stateService.setSelectedAgency(null);
          this._stateService.setIsReviewCase(false);
          this._stateService.clearWorkflowDetails();

        }
      });

    this._stateService.getWorkflowRoutedObservable().subscribe(isRouted => {
      this.isWorkflowrouted = isRouted;

      if (this.isWorkflowrouted && !this.isWorkflowReviewMode) {
        const wf = this._stateService.getWorkflowDetails();
        if (wf) {
          this.workflowIdFromState = wf.flow_id;
          this.workflowDetails = wf;
          console.log("test:",this.workflowDetails)
          this.workFlowRun();
          this.cdRef.detectChanges();
        }
      }
    });


    this._stateService.getWorkflowReviewObservable?.()?.subscribe(isReview => {
      this.isWorkflowReviewMode = isReview;
      if (this.isWorkflowReviewMode) {
        const wf = this._stateService.getSelectedWorkflow(); // the saved workflow
        if (wf) {
          this.workflowIdFromState = wf.flow_id;
          this.workflowDetails = wf;
          this.reviewFlowRun();
          this.IsWorkFlowLoad = true;
          this.isWorkEnd=true;
          this.cdRef.detectChanges();
          this.LoadWorkflowDetails();
          this.loadWorkflowResponses(wf.flow_id);
        }
      }
    });

    this.tryPromptSubscription = this._stateService.tryPrompt$.subscribe((data: any) => {
    if (data?.isFromPromptRepository) {
      this.handleTryPromptFromRepository(data);
    }
  });

  const pendingPrompt = this._stateService.getTryPromptData();
  if (pendingPrompt?.isFromPromptRepository) {
    console.log('Immediate prompt data found');
    this.handleTryPromptFromRepository(pendingPrompt);
  }
  this.cleanupBootstrapModals();
    this._loadingService.hide();

  }

loadPrivileges() {
    this._stateService.getPrivilegesByPage('Chatbot').subscribe({
      next: (loaded_privileges:any) => {
        console.log('Loaded privileges for Chatbot by page: ', loaded_privileges);
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

    // since chatbot and workflow builder are in the same component, we can load both privileges here
    this._stateService.getPrivilegesByPage('Workflow').subscribe({
      next: (loaded_privileges:any) => {
        console.log('Loaded privileges for Workflow by page: ', loaded_privileges);
        if (loaded_privileges) {
          this.isPrivilegeViewWorkflow = loaded_privileges?.view || false;
          this.isPrivilegeEditWorkflow = loaded_privileges?.['insert / edit'] || loaded_privileges?.edit || false;
          this.isPrivilegeDeleteWorkflow = loaded_privileges?.delete || false;
          this.isPrivilegeRefreshWorkflow = loaded_privileges?.refresh || false;
          this.isPrivilegeExecuteWorkflow = loaded_privileges?.execute || false;
          this.cdRef.detectChanges();
        }
      }
    });

    this._stateService.getPrivilegesByPage('Prompt Repository').subscribe({
      next: (loaded_privileges:any) => {
        console.log('Loaded privileges for PromptRepo by page: ', loaded_privileges);
        if (loaded_privileges) {
          this.isPrivilegeViewPromptRepo = loaded_privileges?.view || false;
          this.isPrivilegeAddPromptRepo = loaded_privileges?.['add / create'] || loaded_privileges?.add || false;
          this.isPrivilegeEditPromptRepo = loaded_privileges?.['insert / edit'] || loaded_privileges?.edit || false;
          this.isPrivilegeDeletePromptRepo = loaded_privileges?.delete || false;
          this.isPrivilegeRefreshPromptRepo = loaded_privileges?.refresh || false;
          this.isPrivilegeExecutePromptRepo = loaded_privileges?.execute || false;
          this.cdRef.detectChanges();
        }
      }
    });
	
	this._stateService.getPrivilegesByPage('Voice Agent').subscribe({
      next: (loaded_privileges: any) => {
        console.log('Loaded privileges for Voice Agent by page: ', loaded_privileges);
        if (loaded_privileges) {
          this.isPrivilegeVoiceAgentView = loaded_privileges?.view || false;
          this.isPrivilegeVoiceAgentEdit = loaded_privileges?.['insert / edit'] || loaded_privileges?.edit || false;
          this.isPrivilegeVoiceAgentDelete = loaded_privileges?.delete || false;
          this.isPrivilegeVoiceAgentRefresh = loaded_privileges?.refresh || false;
          this.isPrivilegeVoiceAgentExecute = loaded_privileges?.execute || false;
          this.cdRef.detectChanges();
        }
      }
    });
    
  }

 WorkFlowResponseLoadBasedOnNodeId(workflowResponseResults: any): void {
  if (!workflowResponseResults || !this.nodes?.length) return;

  const isExternal = this.workflowDetails?.IsExternal ?? false;

  // parsedResponses = Array<{ agent: string, content: string }>
  const parsedResponses = this.parseWFAgents(workflowResponseResults);

  // Early exit if nothing useful came back
  if (!Array.isArray(parsedResponses) || parsedResponses.length === 0) {
    return;
  }

  // ────────────────────────────────────────────────
  // Step 1: Collect completed agents (those with non-empty content)
  // ────────────────────────────────────────────────
  const completedAgents = new Set<string>(
    parsedResponses
      .filter(block => block?.content)
      .map(block => block.agent.trim())
  );

  // Optional: debug
  // console.log('Completed agents:', Array.from(completedAgents));

  let hasChanges = false;

  for (const node of this.getExecutionOrderNodes()) {
    // if (!node?.id || node.id.toLowerCase().includes('conditional')) {
    //   continue;
    // }

    let nodeId = node.id;

    // ────────────────────────────────────────────────
    // Step 2: Find matching agent block for this node
    // ────────────────────────────────────────────────
    let responseContent: string | undefined;

    // Option A: exact match on node.agent_id === block.agent
     const task = this.workflowDetails?.flow_data?.tasks?.find(
              (t: any) => t.params.config?.agent_id === node.agent_id
            );

    const agentNodeId = task?.params?.config?.agent_name ?? null; 

    let matchingBlock = parsedResponses.find(
      b => b.agent === node.agent_id || b.agent === node.id || b.agent === agentNodeId
    );

    // Option B: fallback – try prefix match (agent_xxx vs xxx)
    if (!matchingBlock && node.id) {
      matchingBlock = parsedResponses.find(
        b => b.agent === `agent_${node.id}` ||
             b.agent.endsWith(node.id) ||
             node.id.includes(b.agent.replace(/^agent_/, ''))
      );
    }

    if (matchingBlock) {
      responseContent = matchingBlock.content;
    }

    // ────────────────────────────────────────────────
    // Step 3: Update node if we have content
    // ────────────────────────────────────────────────
    if (responseContent) {
      this.updateNodeInArrayWFReview(nodeId, { agent_response: responseContent }, isExternal);
      hasChanges = true;
    }

    // ────────────────────────────────────────────────
    // Step 4: Update status → Completed if agent finished
    // ────────────────────────────────────────────────
    if (node.id?.trim()) {
      const agentKey = isExternal ? node.id.trim() : agentNodeId;

      if (completedAgents.has(agentKey)) {
        // Direct status update
        this.nodeStatus[nodeId] = { status: 'Completed' };

        // Also update jobMap if you still use it
        this.jobMap.set(agentKey, { status: 'Completed' });

        hasChanges = true;
      }
      // else → leave as 'Not Started' or 'In Progress' (your choice)
    }
  }

  if (hasChanges) {
    this.updateCounts();
    this.cdRef.detectChanges();
  }
}

parseWFAgents(response: string): { agent: string; content: string }[] {
  try{
  // Lookbehind + positive lookahead for safety
  const agentHeaderPattern = /(?=^##\s+agent_[a-zA-Z0-9_]+(?:\s*$))/m;
  const blocks = response.split(agentHeaderPattern);

  return blocks
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const match = block.match(/^##\s+(agent_[a-zA-Z0-9_]+)/);
      if (!match) return null;

      const agent = match[1];
      const content = block
        .slice(block.indexOf('\n') + 1) // everything after first line
        .trim();

      return { agent, content };
    })
    .filter((item): item is { agent: string; content: string } => item !== null);
  } catch {
  }
  try{
 // Assuming your object is stored in a variable called `data`
  const agentContentPairs = Object.entries(response)
  .filter(([key]) => key)
  .map(([key, value]) => ({
    agent: key, 
    content: value
  }));

  return agentContentPairs;
  }
  catch {
  }
    return [];
}
private getExecutionOrderNodes(): any[] {
  if (!this.nodes?.length || !this.edges?.length) {
    return this.nodes || [];
  }

  // Build adjacency list: nodeId → [child nodeIds]
  const adjacency = new Map<string, string[]>();
  this.nodes.forEach(node => adjacency.set(node.id, []));

  this.edges.forEach(edge => {
    const children = adjacency.get(edge.source) || [];
    children.push(edge.target);
    adjacency.set(edge.source, children);
  });

  // Find starting nodes (no incoming edges)
  const incomingCount = new Map<string, number>();
  this.nodes.forEach(n => incomingCount.set(n.id, 0));
  this.edges.forEach(e => {
    incomingCount.set(e.target, (incomingCount.get(e.target) || 0) + 1);
  });

  // Usually only one real start node
  let startNodes = this.nodes.filter(n => (incomingCount.get(n.id) || 0) === 0);

  // If multiple starts → fallback to original array order (rare case)
  if (startNodes.length !== 1) {
    console.warn("Multiple start nodes detected — falling back to node array order");
    return this.nodes;
  }

  const start = startNodes[0];

  // DFS / BFS to get execution order (DFS usually better matches visual left→right flow)
  const order: any[] = [];
  const visited = new Set<string>();

  const dfs = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = this.nodes.find(n => n.id === nodeId);
    if (node) order.push(node);

    const children = adjacency.get(nodeId) || [];
    // Optional: sort children if you have x-coordinate based layout hint
    // children.sort((a,b) => this.getNodeX(a) - this.getNodeX(b));

    children.forEach(childId => dfs(childId));
  };

  dfs(start.id);

  // Add any disconnected nodes at the end (safety)
  this.nodes.forEach(n => {
    if (!visited.has(n.id)) order.push(n);
  });

  return order;
}

private extractTraceDetails(traceInfo: any, nodeId: string): any[] {
  if (!traceInfo || !nodeId) return [];
  
  // Handle different formats of traceInfo
  if (Array.isArray(traceInfo)) {
    return traceInfo.filter((trace: any) => 
      trace.node_id === nodeId || 
      trace.agent_id === nodeId || 
      trace.id === nodeId
    );
  } else if (typeof traceInfo === 'object') {
    // If it's an object, check if it has properties that match our node
    const result = [];
    for (const key in traceInfo) {
      if (key.includes(nodeId) || 
          (traceInfo[key] && traceInfo[key].node_id === nodeId)) {
        result.push(traceInfo[key]);
      }
    }
    return result;
  }
  
  return [];
}

private extractLogDetails(logs: any, nodeId: string): any[] {
  if (!logs || !nodeId) return [];
  
  console.log("Extracting log details for nodeId:", nodeId, "from logs:", logs);
  
  // Handle different formats of logs
  if (Array.isArray(logs)) {
    return logs.filter((log: any) => 
      log.node_id === nodeId || 
      log.agent_id === nodeId || 
      log.id === nodeId
    );
  } else if (typeof logs === 'object') {
    // If it's an object, check if it has properties that match our node
    const result = [];
    for (const key in logs) {
      // Check if the key matches the nodeId (same logic as extractTraceDetails)
      if (key.includes(nodeId) || 
          (logs[key] && logs[key].node_id === nodeId)) {
        result.push(logs[key]);
        console.log("Found logs by key match:", key, "for nodeId:", nodeId);
      }
    }
    return result;
  }
  
  return [];
}

processWorkflowThinkingLogs(realTimeLogs: any): void {
    console.log('🔄 Processing workflow thinking logs from API...');
    
    // Reset logs
    this.logsDuringWorkflowLoading = [];
    this.hasWorkflowLogs = false;
    this.workflowThinkingLogs = [];
    this.workflowAllLogsLoaded = false;
    this.isWorkflowThinkingLoading = false;
    this.isWorkflowThinkingCollapsed = false;
    this.showThinking = false;
    this.workflowCompleted = false;

    // Get the execution order of nodes
    const executionOrderNodes = this.getExecutionOrderNodes();
    
    // Create a map of agent IDs to their execution order
    const agentExecutionOrder: { [agentId: string]: number } = {};
    executionOrderNodes.forEach((node, index) => {
        agentExecutionOrder[node.agent_id] = index;
    });
    
    // Create a map of agent IDs to agent names
    const agentIdToName: { [agentId: string]: string } = {};
    this.workflowDetails?.flow_data?.tasks?.forEach((task: any) => {
        if (task.params.config?.agent_id && task.params.config?.agent_name) {
            agentIdToName[task.params.config.agent_id] = task.params.config.agent_name;
        }
    });

    // Process each agent's logs in execution order
    const orderedAgents: { agentId: string, agentName: string, logs: any[] }[] = [];
    
    // First, collect all agents and their logs
    Object.entries(realTimeLogs).forEach(([agentKey, agentData]: [string, any]) => {
        if (agentData.logs && Array.isArray(agentData.logs)) {
            // Try to find the agent ID from the logs
            const agentId = agentData.agent_id;
            const agentName = agentData.logs[0]?.agent_name || agentKey;
            
            orderedAgents.push({
                agentId,
                agentName,
                logs: agentData.logs
            });
        }
    });
    
    // Sort agents by their execution order using agent ID
    orderedAgents.sort((a, b) => {
        const orderA = agentExecutionOrder[a.agentId] !== undefined ? agentExecutionOrder[a.agentId] : 999;
        const orderB = agentExecutionOrder[b.agentId] !== undefined ? agentExecutionOrder[b.agentId] : 999;
        return orderA - orderB;
    });
    
    // Process logs in the correct order
    orderedAgents.forEach(({ agentId, agentName, logs }) => {
        logs.forEach((log: any) => {
            // Create log entry using the same method as live workflow
            const logEntry = this.createLogStep(log, agentName);
            this.logsDuringWorkflowLoading.push(logEntry);
        });
    });

    // Set flags to show thinking
    if (this.logsDuringWorkflowLoading.length > 0) {
        this.hasWorkflowLogs = true;
        this.isWorkflowThinkingLoading = false; // Show completed state
        this.workflowAllLogsLoaded = true;
        this.showThinking = true;
        this.workflowCompleted = true;
        
        // Prepare thinking logs in agent-grouped format
        this.prepareWorkflowThinkingLogs();
        
        console.log('✅ Workflow thinking logs prepared from API:', this.workflowThinkingLogs);
    }
    
    this.cdRef.detectChanges();
}

private loadWorkflowResponses_old(flowId: string): void {
  if (this.isWorkflowReviewMode) {
    this.activeTab = 'output';
    this.isLoading = false;
    this.showThinking = false;
    this.currentLoaderStep = 0;
    this._loadingService.hide();
  }

  if (!this.isWorkflowReviewMode) {
    this._loadingService.show();
    this.isLoading = true;
  }

  this._homeService.getWorkflowResponse(flowId,true).subscribe({
    next: (res) => {
      console.log("Raw API response:", res.data);

      let workflowEntry: any = null;
      if (Array.isArray(res.data)) {
        workflowEntry = res.data.find((entry: any) => entry.workflow_id === flowId);
      } else if ((res.data as any).workflow_id === flowId) {
        workflowEntry = res.data;
      }

      if (!workflowEntry) {
        console.warn("No workflow found for flowId:", flowId);
        this.workflowResponseResults = [];
        this.chatResponses = [];
        this.eventResponses = [];
        this._loadingService.hide();
        this.isLoading = false;
        setTimeout(() => this.cdRef.detectChanges(), 0);
        return;
      }

      // Get the results array from the current API format
      const results = workflowEntry.response?.results || [];
      console.log("Found results array with length:", results.length);

      // Collect all raw response content from results
      const allRawContent = results[0]?.response || '';
      
      // Parse and filter only ## agent_... blocks
      const agentBlocks = this.parseAndFilterAgentBlocks(allRawContent);
      console.log("Parsed agent blocks count:", agentBlocks.length);

      // Create a mapping between agent names and their content
      const agentContentMap = new Map<string, string>();
      agentBlocks.forEach((block: { key: string; value: string }) => {
        const agentName = block.key.replace(/^##\s*/, '');
        agentContentMap.set(agentName, block.value);
      });

      // Create chat responses in the order of the workflow nodes
      this.chatResponses = [];
      const isExternal = this.workflowDetails?.IsExternal ?? false;

      // Get execution order nodes
      const getNodeNumber = (id: string): number | null => {
        const match = id.match(/_(?:input|output)_(\d+)$/i);
        return match ? Number(match[1]) : null;
      };

      const executionNodes = this.getExecutionOrderNodes()
        .filter(node => {
          if (!node?.id) return false;
          const idLower = node.id.toLowerCase();
          return !idLower.includes("conditional") && !idLower.includes("api");
        });

      // Group by number
      const groups = new Map<number, {
        input?: typeof executionNodes[number];
        unnumbered: typeof executionNodes[number][];
        output?: typeof executionNodes[number];
      }>();

      const leftoverUnnumbered: typeof executionNodes[number][] = [];
      let currentGroupNum: number | null = null;

      for (const node of executionNodes) {
        const num = getNodeNumber(node.id);
        const idLower = node.id.toLowerCase();

        if (num !== null) {
          currentGroupNum = num;
          if (!groups.has(num)) {
            groups.set(num, { unnumbered: [] });
          }
          const group = groups.get(num)!;

          if (idLower.startsWith("input_")) {
            if (group.input) console.warn(`Duplicate input for group ${num}`);
            group.input = node;
          } else if (idLower.startsWith("output_")) {
            if (group.output) console.warn(`Duplicate output for group ${num}`);
            group.output = node;
          }
        } else {
          if (currentGroupNum !== null) {
            groups.get(currentGroupNum)!.unnumbered.push(node);
          } else {
            leftoverUnnumbered.push(node);
          }
        }
      }

      // Build final ordered list
      const orderedNodes: typeof executionNodes[number][] = [];
      const sortedNumbers = [...groups.keys()].sort((a, b) => a - b);

      for (const num of sortedNumbers) {
        const g = groups.get(num)!;
        if (g.input) orderedNodes.push(g.input);
        orderedNodes.push(...g.unnumbered);
        if (g.output) orderedNodes.push(g.output);
      }
      orderedNodes.push(...leftoverUnnumbered);

      // Debug logs
      console.log("Real-time logs from API:", workflowEntry.real_time_logs);

      // Process each node and create chat responses
      for (const node of orderedNodes) {
        let agentName: string;
        let content: string | undefined;
        let originalAgentName: string;

        const task = this.workflowDetails?.flow_data?.tasks?.find(
          (t: any) => t.params.config?.agent_id === node.agent_id
        );

        if (isExternal) {
          agentName = node.id;
          originalAgentName = task?.params.config?.agent_name || node.id;
          content = agentContentMap.get(agentName);
        } else {
          const task = this.workflowDetails?.flow_data?.tasks?.find(
            (t: any) => t.params.config?.agent_id === node.agent_id
          );
          
          if (task?.params.config?.agent_name) {
            originalAgentName = task.params.config.agent_name;
            //agentName = `agent_${task.name}`;
            agentName = originalAgentName;
            content = agentContentMap.get(agentName);
          }
        }

        if (content) {
          // Check if the content is JSON format
          let isJsonFormat = false;
          try {
            JSON.parse(content);
            isJsonFormat = true;
          } catch (e) {
            isJsonFormat = false;
          }

          let title: string;
          if (isJsonFormat) {
            title = originalAgentName || 'Response';
          } else {
            title = this.extractTitleFromResponse(content, originalAgentName)?.trim();
            if (!title) {
              title = (agentName || '')
                .replace(/^##\s*agent_[^\s]+/i, '')
                .trim()
                || 'Response';
            }
          }

          title = title.charAt(0).toUpperCase() + title.slice(1);
          const formatted = this.formatWorkflowResponse(content);

          // Extract trace and log details from the API response
          // Using node.id for both trace and log extraction (same logic)
          const traceDetails = this.extractTraceDetails(workflowEntry.trace_info, node.id);
          const logDetails = this.extractLogDetails(workflowEntry.real_time_logs, node.id);
          
          // Debug log
          console.log(`Node: ${node.id}, Agent: ${originalAgentName}`);
          console.log(`Trace details:`, traceDetails);
          console.log(`Log details:`, logDetails);
          
          // Create simple chat messages object directly here
          let chatMessages = [];
          try {
            // Try to parse content as JSON first
            const parsed = JSON.parse(content);
            if (parsed.input || parsed.output) {
              chatMessages = [
                { type: 'input', text: parsed.input || 'No input available' },
                { type: 'output', text: parsed.output || 'No output available' }
              ];
            } else {
              // If JSON but no input/output, create default messages
              chatMessages = [
                { type: 'input', text: content.substring(0, 200) + (content.length > 200 ? '...' : '') },
                { type: 'output', text: content.substring(0, 200) + (content.length > 200 ? '...' : '') }
              ];
            }
          } catch (e) {
            // If not JSON, create default messages
            chatMessages = [
              { type: 'input', text: content.substring(0, 200) + (content.length > 200 ? '...' : '') },
              { type: 'output', text: content.substring(0, 200) + (content.length > 200 ? '...' : '') }
            ];
          }

          this.chatResponses.push({
            title,
            description: '',
            html: formatted.html,
            plain: formatted.plain,
            json: formatted.json,
            table: formatted.table,
            serializedBddJson: formatted.serializedBddJson,
            tables: formatted.tables,
            explanation: content,
            isLoading: false,
            timestamp: workflowEntry.timestamp,
            workflow_id: workflowEntry.workflow_id,
            _id: workflowEntry._id,
            agentKey: `## ${agentName}`,
            // Add trace and log details (empty arrays if no data)
            traceDetails: traceDetails || [],
            logDetails: logDetails || [],
            // Add chat messages for Run Details tab
            chatMessages: chatMessages,
            // Set default active tab to 'trace'
            activeTab: 'trace'
          });
        }
      }

      // Keep original results for left panel / raw view / debugging
      this.workflowResponseResults = results;
      this.eventResponses = results;

      // Optional: call WorkFlowResponseLoadBasedOnNodeId if still needed
      if (results.length > 0 && results[0].response) {
        this.WorkFlowResponseLoadBasedOnNodeId(results[0].response);
      }

      // Debug: Check the final chatResponses
      console.log("Final chatResponses:", this.chatResponses);

      // Defer title extraction & change detection
      setTimeout(() => {
        if (this.chatResponses.length > 0) {
          this.extractTitleFromResponse(this.chatResponses[0].explanation);
        }
        this.cdRef.detectChanges();
      }, 0);

      this._loadingService.hide();
      this.isLoading = false;
    },

    error: (err) => {
      console.error("Failed to load workflow responses", err);
      this.workflowResponseResults = [];
      this.chatResponses = [];
      this.eventResponses = [];
      this._loadingService.hide();
      this.isLoading = false;
      setTimeout(() => this.cdRef.detectChanges(), 0);
    },

    complete: () => {
      this._loadingService.hide();
      this.isLoading = false;
    }
  });
}

private loadWorkflowResponses(flowId: string): void {
  if (this.isWorkflowReviewMode) {
    this.activeTab = 'output';
    this.isLoading = false;
    this.showThinking = false;
    this.currentLoaderStep = 0;
    this._loadingService.hide();
    
    // Clear existing chat messages when entering review mode
    this.chatMessages = [];
  }

  if (!this.isWorkflowReviewMode) {
    this._loadingService.show();
    this.isLoading = true;
  }

  this._homeService.getWorkflowResponse(flowId, true).subscribe({
    next: (res) => {
      console.log("Raw API response:", res.data);

      let workflowEntry: any = null;
      if (Array.isArray(res.data)) {
        workflowEntry = res.data.find((entry: any) => entry.workflow_id === flowId);
      } else if ((res.data as any).workflow_id === flowId) {
        workflowEntry = res.data;
      }

      if (!workflowEntry) {
        console.warn("No workflow found for flowId:", flowId);
        this.workflowResponseResults = [];
        this.chatResponses = [];
        this.eventResponses = [];
        this._loadingService.hide();
        this.isLoading = false;
        setTimeout(() => this.cdRef.detectChanges(), 0);
        return;
      }

      // Get the results array from the current API format
      const results = workflowEntry.response?.results || [];
      console.log("Found results array with length:", results.length);

      if (workflowEntry.real_time_logs) {
        console.log("Processing real-time logs for thinking section...");
        this.processWorkflowThinkingLogs(workflowEntry.real_time_logs);
      }

      // Store the workflow entry for later use in review mode
      this.currentWorkflowEntry = workflowEntry;

      // Collect all raw response content from results
      const allRawContent = results[0]?.response || '';
      
      // Parse and filter only ## agent_... blocks
      const agentBlocks = this.parseAndFilterAgentBlocks(allRawContent);
      console.log("Parsed agent blocks count:", agentBlocks.length);

      // Create a mapping between agent names and their content
      const agentContentMap = new Map<string, string>();
      agentBlocks.forEach((block: { key: string; value: string }) => {
        const agentName = block.key.replace(/^##\s*/, '');
        agentContentMap.set(agentName, block.value);
      });

      // Create chat responses in the order of the workflow nodes
      this.chatResponses = [];
      const isExternal = this.workflowDetails?.IsExternal ?? false;

      // Get execution order nodes
      const getNodeNumber = (id: string): number | null => {
        const match = id.match(/_(?:input|output)_(\d+)$/i);
        return match ? Number(match[1]) : null;
      };

      const executionNodes = this.getExecutionOrderNodes()
        .filter(node => {
          if (!node?.id) return false;
          const idLower = node.id.toLowerCase();
          return !idLower.includes("conditional") && !idLower.includes("api");
        });

      // Group by number
      const groups = new Map<number, {
        input?: typeof executionNodes[number];
        unnumbered: typeof executionNodes[number][];
        output?: typeof executionNodes[number];
      }>();

      const leftoverUnnumbered: typeof executionNodes[number][] = [];
      let currentGroupNum: number | null = null;

      for (const node of executionNodes) {
        const num = getNodeNumber(node.id);
        const idLower = node.id.toLowerCase();

        if (num !== null) {
          currentGroupNum = num;
          if (!groups.has(num)) {
            groups.set(num, { unnumbered: [] });
          }
          const group = groups.get(num)!;

          if (idLower.startsWith("input_")) {
            if (group.input) console.warn(`Duplicate input for group ${num}`);
            group.input = node;
          } else if (idLower.startsWith("output_")) {
            if (group.output) console.warn(`Duplicate output for group ${num}`);
            group.output = node;
          }
        } else {
          if (currentGroupNum !== null) {
            groups.get(currentGroupNum)!.unnumbered.push(node);
          } else {
            leftoverUnnumbered.push(node);
          }
        }
      }

      // Build final ordered list
      const orderedNodes: typeof executionNodes[number][] = [];
      const sortedNumbers = [...groups.keys()].sort((a, b) => a - b);

      for (const num of sortedNumbers) {
        const g = groups.get(num)!;
        if (g.input) orderedNodes.push(g.input);
        orderedNodes.push(...g.unnumbered);
        if (g.output) orderedNodes.push(g.output);
      }
      orderedNodes.push(...leftoverUnnumbered);

      // Debug logs
      console.log("Real-time logs from API:", workflowEntry.real_time_logs);
      console.log("Trace info from API:", workflowEntry.trace_info);

      let firstUserQuery = '';
if (orderedNodes.length > 0) {
  const firstNode = orderedNodes[0];
  let firstAgentName: string | undefined;

  // Determine agent name for the first node
  if (isExternal) {
    firstAgentName = firstNode.id;
  } else {
    const task = this.workflowDetails?.flow_data?.tasks?.find(
      (t: any) => t.params.config?.agent_id === firstNode.agent_id
    );
    if (task?.params.config?.agent_name) {
      firstAgentName = task.params.config.agent_name;
    }
  }

  // Retrieve user query for the first agent
  if (firstAgentName && workflowEntry.user_query) {
    firstUserQuery = workflowEntry.user_query[firstAgentName] || '';
  }
}

// Add the first user query to chat messages
if (firstUserQuery) {
  this.chatMessages.push({
    from: 'user',
    text: this.getUserInputForRecentQueries(firstUserQuery)
  });
}

      // Process each node and create chat responses
      for (const node of orderedNodes) {
        let agentName: string;
        let content: string | undefined;
        let originalAgentName: string;

        const task = this.workflowDetails?.flow_data?.tasks?.find(
          (t: any) => t.params.config?.agent_id === node.agent_id
        );

        if (isExternal) {
          agentName = node.id;
          originalAgentName = task?.params.config?.agent_name || node.id;
          content = agentContentMap.get(agentName);
        } else {
          const task = this.workflowDetails?.flow_data?.tasks?.find(
            (t: any) => t.params.config?.agent_id === node.agent_id
          );
          
          if (task?.params.config?.agent_name) {
            originalAgentName = task.params.config?.agent_name;
            //agentName = `agent_${task.name}`;
            agentName = originalAgentName;
            content = agentContentMap.get(agentName);
          }
        }

        if (content) {
          // Check if the content is JSON format
          let isJsonFormat = false;
          try {
            JSON.parse(content);
            isJsonFormat = true;
          } catch (e) {
            isJsonFormat = false;
          }

          let title: string;
          if (isJsonFormat) {
            title = originalAgentName || 'Response';
          } else {
            title = this.extractTitleFromResponse(content, originalAgentName)?.trim();
            if (!title) {
              title = (agentName || '')
                .replace(/^##\s*agent_[^\s]+/i, '')
                .trim()
                || 'Response';
            }
          }

          title = title.charAt(0).toUpperCase() + title.slice(1);
          const formatted = this.formatWorkflowResponse(content);

          // Extract trace and log details from the API response
          let traceDetails = this.extractTraceDetails(workflowEntry.trace_info, node.id);
          let logDetails = this.extractLogDetails(workflowEntry.real_time_logs, node.id);
          
          // If not found by node.id, try by agent_name (for internal workflows)
          if ((!traceDetails || traceDetails.length === 0) && originalAgentName) {
            traceDetails = this.extractTraceDetails(workflowEntry.trace_info, originalAgentName);
          }
          if ((!logDetails || logDetails.length === 0) && originalAgentName) {
            logDetails = this.extractLogDetails(workflowEntry.real_time_logs, originalAgentName);
          }
          
          // If still not found, try by agent_id
          if ((!traceDetails || traceDetails.length === 0) && node.agent_id) {
            traceDetails = this.extractTraceDetailsByAgentId(workflowEntry.trace_info, node.agent_id);
          }
          if ((!logDetails || logDetails.length === 0) && node.agent_id) {
            logDetails = this.extractLogDetailsByAgentId(workflowEntry.real_time_logs, node.agent_id);
          }
          
          // Debug log
          console.log(`Node: ${node.id}, Agent: ${originalAgentName}`);
          console.log(`Trace details:`, traceDetails);
          console.log(`Log details:`, logDetails);
          
          // Extract user_query from workflowEntry.user_query
          let user_query = '';
          if (workflowEntry.user_query) {
            // Use node.id for external workflows to match the keys in user_query
            const queryKey = isExternal ? node.id : originalAgentName;
            user_query = workflowEntry.user_query[queryKey] || '';
            console.log(`Using key "${queryKey}" to fetch user_query for node ${node.id}: "${user_query}"`);
          }
          
          // Create chat messages object with user_query and response
          const chatMessages = [
            { type: 'input', text: user_query || 'No input available' },
            { type: 'output', text: content || 'No output available' }
          ];

          console.log(`Extracted user_query: ${user_query}`);
          console.log(`Content for response: ${content.substring(0, 100)}...`);
          
          this.chatResponses.push({
            title,
            description: '',
            html: formatted.html,
            plain: formatted.plain,
            json: formatted.json,
            serializedBddJson: formatted.serializedBddJson,
            tables: formatted.tables,
            table: formatted.table,
            explanation: content,
            isLoading: false,
            timestamp: workflowEntry.timestamp,
            workflow_id: workflowEntry.workflow_id,
            _id: workflowEntry._id,
            agentKey: `## ${agentName}`,
            // Add trace and log details (empty arrays if no data)
            traceDetails: traceDetails || [],
            logDetails: logDetails || [],
            // Add chat messages for Run Details tab
            chatMessages: chatMessages,
            // Set default active tab to 'trace'
            activeTab: 'trace',
            // Add nodeId for explanation data fetching in non-review mode
            nodeId: node.id,
            // Add agentId and agentName for explanation data fetching
            agentId: node.agent_id,
            agentName: originalAgentName,
            // Add user_query and response fields for Run Details tab
            user_query: user_query,
            response: content
          });
        }
      }

      // Keep original results for left panel / raw view / debugging
      this.workflowResponseResults = results;
      this.eventResponses = results;

      // Optional: call WorkFlowResponseLoadBasedOnNodeId if still needed
      if (results.length > 0 && results[0].response) {
        this.WorkFlowResponseLoadBasedOnNodeId(results[0].response);
      }

      console.log("Final chatResponses:", this.chatResponses);

      if (this.isWorkflowReviewMode) {
        console.log("In review mode, marking explanation data as available");
        this.chatResponses.forEach(response => {
          this.explanationDataRetrieved.add(response.nodeId);
        });
      }

      // Defer title extraction & change detection
      setTimeout(() => {
        if (this.chatResponses.length > 0) {
          this.extractTitleFromResponse(this.chatResponses[0].explanation);
        }
        this.cdRef.detectChanges();
        // Scroll to bottom after content is loaded
        this.scrollToBottom();
      }, 0);

      this._loadingService.hide();
      this.isLoading = false;
    },

    error: (err) => {
      console.error("Failed to load workflow responses", err);
      this.workflowResponseResults = [];
      this.chatResponses = [];
      this.eventResponses = [];
      this._loadingService.hide();
      this.isLoading = false;
      setTimeout(() => this.cdRef.detectChanges(), 0);
    },

    complete: () => {
      this._loadingService.hide();
      this.isLoading = false;
    }
  });
}


private extractTraceDetailsByAgentId(traceInfo: any, agentId: string): any[] {
  if (!traceInfo) return [];
  
  const results: any[] = [];
  
  // Look through all trace entries
  for (const key in traceInfo) {
    const trace = traceInfo[key];
    if (trace.agent_id === agentId) {
      results.push(trace);
    }
  }
  
  return results;
}

private extractLogDetailsByAgentId(logInfo: any, agentId: string): any[] {
  if (!logInfo) return [];
  
  const results: any[] = [];
  
  // Look through all log entries
  for (const key in logInfo) {
    const log = logInfo[key];
    if (log.agent_id === agentId) {
      results.push(log);
    }
  }
  
  return results;
}

private parseAndFilterAgentBlocks(fullText: string): { key: string; value: string }[] {

  try{
  if (!fullText.trim()) return [];

  const blocks: { key: string; value: string }[] = [];
  let currentKey: string | null = null;
  let currentLines: string[] = [];

  const stopMarkers = [
    'conditional_', 'api_','iterative_'
  ];

  const lines = fullText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed) {
      // Save previous agent block
      if (currentKey && currentLines.length > 0) {
        blocks.push({
          key: currentKey,
          value: currentLines.join('\n').trim()
        });
      }
      currentKey = trimmed;
      currentLines = [];
      continue;
    }

    // Stop collecting if we hit a condition / internal marker
    if (currentKey && stopMarkers.some(marker => trimmed.includes(marker) || trimmed.startsWith(marker))) {
      if (currentLines.length > 0) {
        blocks.push({
          key: currentKey,
          value: currentLines.join('\n').trim()
        });
      }
      currentKey = null;
      currentLines = [];
      continue; // skip this line and following until new agent
    }

    // Collect only inside agent block
    if (currentKey) {
      currentLines.push(line);
    }
  }

  // Last block
  if (currentKey && currentLines.length > 0) {
    blocks.push({
      key: currentKey,
      value: currentLines.join('\n').trim()
    });
  }

  return blocks;
  } catch {
   
  }

   try{
 // Assuming your object is stored in a variable called `data`
  const agentContentPairs = Object.entries(fullText)
  .filter(([key]) => key)
  .map(([key, value]) => ({
    key: key, 
    value: value
  }));

  return agentContentPairs;
  }
  catch {
  }

  return [];
}

  fetchWorkflows() {
    this._loadingService.show();

    this._workflowService.getWorkflows().subscribe({
      next: (res) => {
        // Extract the actual array from res.data
        this.workflows = res.data ?? [];
        console.log("workflow details", this.workflows);
        this.cdRef.detectChanges();
        this._loadingService.hide();
      },
      error: (err) => {
        console.error('Error:', err);
        this._loadingService.hide();
      },
    });
  }

  workFlowRun(): void {
    console.log("ischatopened")
    const wfFromState = this._stateService.getWorkflowDetails();
    if (!wfFromState) return;
    console.log("wfFromState", wfFromState)
    if (wfFromState) {
      this.eventTrackingUniqueId = crypto.randomUUID();
      this.isWorkflowrouted = true;
      this.workflowIdFromState = wfFromState.flow_id;
      this.workflowDetails = wfFromState;

      this.isNewChatOpen = true;
      this.showWelcomePanel = false;
      this.chatMessages = [];
      this.chatResponses = [];
      this.eventResponses = [];
    }
    this.cdRef.detectChanges();
  }

  reviewFlowRun(): void {
    console.log("isreviewchatopened")
    const wfFromState = this._stateService.getSelectedWorkflow();
    if (!wfFromState) return;
    console.log("wfFromState", wfFromState)
    if (wfFromState) {
      this.eventTrackingUniqueId = crypto.randomUUID();
      this.isWorkflowrouted = true;
      this.workflowIdFromState = wfFromState.flow_id;
      this.workflowDetails = wfFromState;

      this.isNewChatOpen = true;
      this.showWelcomePanel = false;
      this.chatMessages = [];
      this.chatResponses = [];
      this.eventResponses = [];
    }
    this.cdRef.detectChanges();
  }

  private resetEventTracking(): void {
    this.eventTrackingUniqueId = '';
    this.stopPollingForWorkflowResults();
  }


  handleTryPromptFromRepository(data: any) {
  const { agent, query, shouldAutoExecute = false } = data;   // default false

  console.log('[Try Prompt] Received:', query?.user_query, '| shouldAutoExecute:', shouldAutoExecute);

  if (!query || !agent) return;

  this.resetFeedbackState();
  this.isFromPromptRepository = true;
  this.cameFromPromptRepository = true;
  this.isPromptSaved = false;
  this.isPromptUpdated = false;

  this.isFromPromptRepository = true;       
  this.currentPromptTitle = query.prompt_title || query.title;

  this.isChatOpen = true;
  this.isNewChatOpen = true;
  this.isChatSubmitted = true;
  this.isChatOpenedByAgent = true;
  this.showWelcomePanel = false;
  this.isSidebarExpanded = false;
  this.chatResponses = [];
  this.chatMessages = [];

  const agencyId = query.agency_id || agent.agency_id || '';

  console.log('Extracted agency_id from Prompt Repo:', agencyId);

  const compatibleQuery = {
    ...query,
    master_agent_id: agent.master_agent_id || agent.agent_id,
    master_agent_name: agent.master_agent_name || agent.name,
    agent_id: query.agent_id || agent.agent_id,
    name: query.name || agent.name || agent.master_agent_name,
    user_query: query.user_query ,
    prompt_title: query.prompt_title || query.title,
    agency_id: agencyId,
    event_id: query.event_id || '',
    isSavedToRepo: true,
    map_id: query.map_id || '',
  };
  console.log("compatibleQuery",compatibleQuery)
  
  // Store original prompt data separately for update
  this.originalPromptData = {
    ...compatibleQuery,
    title: this.currentPromptTitle,
    agency_id: agencyId
  };

  this.currentResponseToSave = { ...this.originalPromptData };

  this.selectedAgent = {
    agent_id: compatibleQuery.master_agent_id,
    name: compatibleQuery.master_agent_name,
  };

  const payload = { agent_id: this.selectedAgent.agent_id };

  this._marketService.GetAgentAndOrder2Agents(payload).subscribe({
    next: (res) => {
      this.secondaryAgents = res.data?.order_2_agents || [];
      this.cdRef.detectChanges();

      if (shouldAutoExecute === true) {
        console.log('NEW Prompt → Auto Execute');
        this.isRecentChat = false;

        let targetSubAgent = null;

        if (query.agent_id) {
          targetSubAgent = this.secondaryAgents.find(sub => 
            sub.agent_id === query.agent_id || sub.agent_id === agent.agent_id
          );
        }
          if (targetSubAgent) {
          console.log('Using target sub-agent:', targetSubAgent.name || targetSubAgent.agent_name);
          
          this.handleOption(
            targetSubAgent.agent_name || targetSubAgent.name, 
            targetSubAgent.agent_id
          );
        

        // Auto submit the prompt
        setTimeout(() => {
          this.userQuery1 = compatibleQuery.user_query;
          this.submitQuery('');
        }, 900);
        
        } 
      } else {
        console.log('OLD Prompt → Show History Only (No Execution)');
        this.isRecentChat = true;
        this.isChatSubmitted = true;   // Important

        // Do NOT call submitQuery here
        this.loadRecentData(this.selectedAgent.agent_id);
        this.getRecentchat(compatibleQuery, false);
      }
    },
    error: (err) => {
      console.error('Failed to load sub-agents', err);
      this.isRecentChat = true;
      this.loadRecentData(this.selectedAgent.agent_id);
    }
  });

  this._stateService.clearTryPromptData();
}



  ngOnDestroy(): void {
    this.tryPromptSubscription?.unsubscribe();
    this.stopPollingForWorkflowResults();
    this._stateService.clearWorkflowDetails();
      if (this.explanationDataPollingSubscription) {
    this.explanationDataPollingSubscription.unsubscribe();
  }
  if (this.workflowPollingSubscription) {
    this.workflowPollingSubscription.unsubscribe();
  }
  this.cleanupBootstrapModals();
  }

 cleanupBootstrapModals() {
  try {
    // Remove all open modals
    const modals = document.querySelectorAll('.modal.show');
    modals.forEach(modal => {
      const modalInstance = bootstrap.Modal.getInstance(modal);
      if (modalInstance) modalInstance.hide();
    });

    // Remove lingering backdrops
    const backdrops = document.querySelectorAll('.modal-backdrop');
    backdrops.forEach(backdrop => backdrop.remove());

    // Remove body classes
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('padding-right');
    document.body.style.removeProperty('overflow');
    
  } catch (e) {
    console.warn('Cleanup error:', e);
  }
}

  ngAfterViewInit() {
    // Initialize first tab as active
  }

  ngAfterViewChecked(): void {
    // this.scrollToBottom();
    // this.scrollLoaderSteps();
    this.cdRef.detectChanges();
  }

  onBindAIExplanations(): void {

    this.systemPrompt = "Extract the following content into a JSON key-value structure without changing the structure or wording of any part of the content.\nThe top-level keys should include:\n- test_case_title\n- user_story\n- acceptance_criteria (as a list)\n- test_cases (as a list of objects)\n- summary\n\nInside each item in test_cases, include:\n- test_case_name\n- objective\n- preconditions (as a list)\n- test_steps (as a list)\n- expected_results (as a list, one for each test step)\n\nDo not include markdown, code blocks, or explanations — only return a pure JSON object."
    this.thoughts = [{ "role": "system", "content": "SYSTEM_MESSAGE" }, { "role": "user", "content": "\n        You are an AI assistant tasked with improving a previous response based on provided feedback. Your goal is to carefully analyze the feedback and create an enhanced version of the original output that addresses all points of criticism or suggestions for improvement.\n\n        Here is the previous input:\n        <old_input>\n        Extract the following content into a JSON key-value structure without changing the structure or wording of any part of the content.\n\n        The top-level keys should include:\n        - test_case_title\n        - user_story\n        - acceptance_criteria (as a list)\n        - test_cases (as a list of objects)\n        - summary\n\n        Inside each item in test_cases, include:\n        - test_case_name\n        - objective\n        - preconditions (as a list)\n        - test_steps (as a list)\n        - expected_results (as a list, one for each test step)\n\n        Do not include markdown, code blocks, or explanations \u2014 only return a pure JSON object.\n\n        As a user, I want to receive feedback for each action\nSo that I know if my information and documents are accepted or if I need to make corrections.\n\u2022 Acceptance Criteria:\n\u2022 System displays clear error messages for invalid inputs or missing fields.\n\u2022 System displays success messages for successful uploads and verifications.\n\n\n        </old_input>\n\n        Here is the previous output:\n        <old_output>\n        {\n  \"test_case_title\": \"Receive Feedback for Actions\",\n  \"user_story\": \"As a user, I want to receive feedback for each action So that I know if my information and documents are accepted or if I need to make corrections.\",\n  \"acceptance_criteria\": [\n    \"System displays clear error messages for invalid inputs or missing fields.\",\n    \"System displays success messages for successful uploads and verifications.\"\n  ],\n  \"test_cases\": [\n    {\n      \"test_case_name\": \"Invalid Input Feedback\",\n      \"objective\": \"To verify that the system displays clear error messages for invalid inputs.\",\n      \"preconditions\": [\n        \"User is logged in to the system.\"\n      ],\n      \"test_steps\": [\n        \"Enter invalid data in the required fields.\",\n        \"Submit the form.\"\n      ],\n      \"expected_results\": [\n        \"System displays clear error messages indicating which fields contain invalid inputs.\",\n        \"User is prompted to correct the errors.\"\n      ]\n    },\n    {\n      \"test_case_name\": \"Success Upload Verification\",\n      \"objective\": \"To verify that the system displays success messages for successful uploads and verifications.\",\n      \"preconditions\": [\n        \"User is logged in to the system.\",\n        \"Valid data is entered in the required fields.\"\n      ],\n      \"test_steps\": [\n        \"Enter valid data in the required fields.\",\n        \"Submit the form.\"\n      ],\n      \"expected_results\": [\n        \"System displays a success message confirming the upload and verification.\",\n        \"User is notified that the information and documents have been accepted.\"\n      ]\n    }\n  ],\n  \"summary\": \"This test case suite aims to verify that the system provides clear feedback to users regarding the status of their inputs and documents, whether they are accepted or need corrections.\"\n}\n        </old_output>\n\n        Here is the feedback provided:\n        <feedback>\n        Reflection_Result: \"Pass\"\n\nReflection_Result_Reason: \"The output aligns with the instructions provided in the system prompt.\"\n\n**Explanation:**\n\n1. **Processing the User Story:**\n   - The user story provided was: \"As a user, I want to receive feedback for each action So that I know if my information and documents are accepted or if I need to make corrections.\"\n   - The acceptance criteria were also provided: \n     - System displays clear error messages for invalid inputs or missing fields.\n     - System displays success messages for successful uploads and verifications.\n\n2. **Creating Test Cases:**\n   - The output includes a well-structured test case title, user story, acceptance criteria, and detailed test cases.\n   - Each test case includes:\n     - `test_case_name`\n     - `objective`\n     - `preconditions` (as a list)\n     - `test_steps` (as a list)\n     - `expected_results` (as a list, one for each test step)\n\n3. **Structure and Clarity:**\n   - The test cases are clearly structured and follow the required format.\n   - The summary provides a concise overview of the test case suite.\n\n4. **Alignment with Instructions:**\n   - The output adheres to the instructions provided in the system prompt.\n   - The test cases cover the functionality described in the user story and align with the acceptance criteria.\n\nTherefore, the output meets the expectations and aligns with the instructions and the goal specified in the system prompt.\nBias Report: No opinions detected for bias analysis.\n        </feedback>\n\n        Here is the conversation history for context:\n        \nMessage History:\nuser: Extract the following content into a JSON key-value structure without changing the structure or wording of any part of the content.\n\n        The top-level keys should include:\n        - test_case_title\n        - user_story\n        - acceptance_criteria (as a list)\n        - test_cases (as a list of objects)\n        - summary\n\n        Inside each item in test_cases, include:\n        - test_case_name\n        - objective\n        - preconditions (as a list)\n        - test_steps (as a list)\n        - expected_results (as a list, one for each test step)\n\n        Do not include markdown, code blocks, or explanations \u2014 only return a pure JSON object.\n\n        As a user, I want to receive feedback for each action\nSo that I know if my information and documents are accepted or if I need to make corrections.\n\u2022 Acceptance Criteria:\n\u2022 System displays clear error messages for invalid inputs or missing fields.\n\u2022 System displays success messages for successful uploads and verifications.\n\n\nassistant: {\n  \"test_case_title\": \"Receive Feedback for Actions\",\n  \"user_story\": \"As a user, I want to receive feedback for each action So that I know if my information and documents are accepted or if I need to make corrections.\",\n  \"acceptance_criteria\": [\n    \"System displays clear error messages for invalid inputs or missing fields.\",\n    \"System displays success messages for successful uploads and verifications.\"\n  ],\n  \"test_cases\": [\n    {\n      \"test_case_name\": \"Invalid Input Feedback\",\n      \"objective\": \"To verify that the system displays clear error messages for invalid inputs.\",\n      \"preconditions\": [\n        \"User is logged in to the system.\"\n      ],\n      \"test_steps\": [\n        \"Enter invalid data in the required fields.\",\n        \"Submit the form.\"\n      ],\n      \"expected_results\": [\n        \"System displays clear error messages indicating which fields contain invalid inputs.\",\n        \"User is prompted to correct the errors.\"\n      ]\n    },\n    {\n      \"test_case_name\": \"Success Upload Verification\",\n      \"objective\": \"To verify that the system displays success messages for successful uploads and verifications.\",\n      \"preconditions\": [\n        \"User is logged in to the system.\",\n        \"Valid data is entered in the required fields.\"\n      ],\n      \"test_steps\": [\n        \"Enter valid data in the required fields.\",\n        \"Submit the form.\"\n      ],\n      \"expected_results\": [\n        \"System displays a success message confirming the upload and verification.\",\n        \"User is notified that the information and documents have been accepted.\"\n      ]\n    }\n  ],\n  \"summary\": \"This test case suite aims to verify that the system provides clear feedback to users regarding the status of their inputs and documents, whether they are accepted or need corrections.\"\n}\n\n        Follow these steps to improve the response:\n\n        1. Carefully read and analyze the feedback provided. Pay attention to each point of criticism or suggestion for improvement.\n\n        2. For each point in the feedback:\n        a. Identify the specific issue or area for improvement.\n        b. Consider how to address this issue in your revised response.\n        c. Make note of any changes or additions you plan to make.\n\n        3. Review the previous input and output to ensure you understand the context and original intent of the response.\n\n        4. Begin crafting your improved response:\n        a. Start with the structure and content of the original output.\n        b. Incorporate the changes and improvements you identified in step 2.\n        c. Ensure that each point of feedback is thoroughly addressed.\n        d. Maintain coherence and flow in your revised response.\n\n        5. After incorporating all improvements, review your new response to ensure it:\n        a. Addresses all feedback points.\n        b. Maintains or enhances the quality of the original response.\n        c. Remains relevant to the original input.\n        d. Is clear, concise, and well-structured.\n\n        6. If necessary, make final adjustments to polish your response.\n\n        Provide your final, comprehensive response that addresses all feedback points within <improved_response> tags. Ensure that your improved response is a complete, standalone answer that can be understood without reference to the original output or feedback.\n\n        After your improved response, include a brief summary of the changes you made and how they address the feedback, enclosed in <change_summary> tags." }]
    this.actions = `role: assistant\ncontent:\n<improved_response>\n{\n  "test_case_title": "Receive Feedback for Actions",\n  "user_story": "As a user, I want to receive feedback for each action So that I know if my information and documents are accepted or if I need to make corrections.",\n  "acceptance_criteria": [\n    "System displays clear error messages for invalid inputs or missing fields.",\n    "System displays success messages for successful uploads and verifications."\n  ],\n  "test_cases": [\n    {\n      "test_case_name": "Invalid Input Feedback",\n      "objective": "To verify that the system displays clear error messages for invalid inputs.",\n      "preconditions": [\n        "User is logged in to the system."\n      ],\n      "test_steps": [\n        "Navigate to the upload form.",\n        "Enter invalid data in the required fields.",\n        "Submit the form."\n      ],\n      "expected_results": [\n        "System displays clear error messages indicating which fields contain invalid inputs.",\n        "User is prompted to correct the errors."\n      ]\n    },\n    {\n      "test_case_name": "Success Upload Verification",\n      "objective": "To verify that the system displays success messages for successful uploads and verifications.",\n      "preconditions": [\n        "User is logged in to the system.",\n        "Valid data is entered in the required fields."\n      ],\n      "test_steps": [\n        "Navigate to the upload form.",\n        "Enter valid data in the required fields.",\n        "Submit the form."\n      ],\n      "expected_results": [\n        "System displays a success message confirming the upload and verification.",\n        "User is notified that the information and documents have been accepted."\n      ]\n    }\n  ],\n  "summary": "This test case suite aims to verify that the system provides clear feedback to users regarding the status of their inputs and documents, whether they are accepted or need corrections."\n}\n</improved_response>\n\n<change_summary>\nThe response has been revised to ensure clarity and completeness in the test case steps. Specifically, the steps have been expanded to include navigation to the upload form, which provides a more detailed and logical sequence of actions. This addresses any potential ambiguity in the original test steps and ensures that the test cases are comprehensive and easy to follow. The structure and content remain consistent with the original output, maintaining the quality and relevance of the response.\n</change_summary>`;
    this.refrainPrompt = "User Stories for KYC Plus Application\n1. As a user, I want to log in to the KYC application\nSo that I can securely access my KYC profile and submit my details.\nAcceptance Criteria:\n• Login screen displays fields for Email and password.\n• User can enter valid credentials and click \"Login\".\n• Password input is masked for security.\n• On successful login, user is redirected to the KYC form.\n• On failed login, user receives an error message indicating invalid credentials.\nUser Stories for KYC Plus Application for ‘US’ Region <By Default>\n2. As a user, I want to enter my personal details\nSo that I can provide my full name, date of birth, and address for KYC verification.\nAcceptance Criteria:\n• Form displays fields: Full Name, Date of Birth (with calendar picker), and Address.\n• All fields are mandatory; user cannot proceed without entering these.\n• If any field is omitted, an error or prompt is shown.\n3. As a user, I want to select my state from a predefined list\nSo that my location data is standardized for KYC.\nAcceptance Criteria:\n• State field is a dropdown with all valid state options.\n• State selection is required to proceed.\n4. As a user, I want to enter my ZIP Code and Phone Number\nSo that my contact and location information is complete for verification.\nAcceptance Criteria:\n• ZIP Code and Phone Number fields follow valid formatting (ZIP: e.g., 90210; Phone: e.g., +1 9876543210).\n• Both fields are required.\n5. As a user, I want to enter my Social Security Number and Driving License Number\nSo that my identity can be verified with government-issued IDs.\nAcceptance Criteria:\n• Fields for Social Security Number and Driving License Number are present.\n• Both fields require formatting validation (SSN: 123-45-6789; DLN: e.g., D12345678).\n• Both fields must be filled before submission.\n6. As a user, I want to upload my SSN card and Driving License documents\nSo that the system can verify my identity from uploaded originals.\nAcceptance Criteria:\n• \"Choose File\" buttons are available for both SSN Card and Driving License.\n• Both document uploads are mandatory.\n• System validates file types and size upon upload.\n7. As a user, I want to verify my uploaded SSN and Driving License documents\nSo that I am notified of the validity of my documents before final KYC submission.\nAcceptance Criteria:\n• After upload, user can click \"Verify SSN\" and \"Verify License\".\n• System confirms validity or displays an error if verification fails.\n• User must complete verification for both before proceeding.\n8. As a user, I want to submit my completed KYC form\nSo that my details and documents are sent for final review and verification.\nAcceptance Criteria:\n• \"Submit KYC\" button is enabled only after all required fields are populated, files are uploaded, and documents verified.\n• System performs validation and shows a confirmation message on successful submission.\n• Missing or invalid entries are flagged for correction before submission."

    const formatted = this.thoughts
      .map(entry => `role: ${entry.role}\ncontent:\n${entry.content.trim()}`)
      .join('\n\n');

    this.thoughtsInput = formatted;
    this.cdRef.detectChanges();
  }
  fetchAgenciesWithAgents(): void {
    this._marketService.getAgencyWithAgents().subscribe({
      next: (res) => {
        if (res.success) {
          this.agenciesWithAgents = res.data;
          this.loadAgents();
        }
      },
      error: (err) => console.error('Error:', err)
    });
  }


  loadPopularQueries() {
    this.popularQueriesLoading = true;
    const activePrj = this.loggedUser?.ActiveProject;
    const projectDetails = this.loggedUser?.ProjectDtl || [];

    const mappedProject = projectDetails.find(
      (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
    );

    const mappedTeam = mappedProject?.team_name || '';
    const mappedRole = mappedProject?.role_name?.toLowerCase() || '';
    console.log('Mapped Team:', mappedTeam);
    const payload = { teams: mappedTeam };



    this._homeService.getPopularQueries(payload).subscribe({
      next: (res) => {
        this.recentQueries = res.data;
        console.log('Recent queries loaded:', this.recentQueries);
        this.popularQueriesLoading = false;
        this.cdRef.detectChanges();
      },
      error: () => {
        this.popularQueriesLoading = false;
      }
    });
  }

  loadRecentData_old(masterAgentId?: string): void {
    this.recentData = []; // Reset recent data
    this.recentOGData = [];
    const payload = masterAgentId ? { master_agent_id: masterAgentId } : { fetch_all: true }; // Use a flag for all chats
    this._homeService.getRecentData(payload).subscribe({
      next: (res) => {
        this.recentData = res.data;
        this.recentOGData = res.data;
        console.log("Recent Data:", this.recentData);
      },
      error: (err) => {
        console.error("Error fetching recent data:", err);
      }
    });

    this.recentQueryForSuggestionData = []; // Reset recent data
    this.recentQueryForSuggestionOGData = [];
    const payloadSuggestionQuery = masterAgentId ? { master_agent_id: masterAgentId } : { fetch_all: true }; // Use a flag for all chats
    this._homeService.getRecentDataForSuggestion(payloadSuggestionQuery).subscribe({
      next: (res) => {
        this.recentQueryForSuggestionData = res.data;
        this.recentQueryForSuggestionOGData = res.data;
        console.log("Recent Data for suggestions:", this.recentQueryForSuggestionData);
        this.cdRef.detectChanges();
      },
      error: (err) => {
        console.error("Error fetching recent data for suggestions:", err);
      }
    });

  }

private recentDataSub?: Subscription;
private recentSuggestionSub?: Subscription;

loadRecentData(masterAgentId?: string): void {
    // Cancel previous requests
    this.recentDataSub?.unsubscribe();
    this.recentSuggestionSub?.unsubscribe();

    this.recentData = [];
    this.recentOGData = [];
    this.recentQueryForSuggestionData = [];
    this.recentQueryForSuggestionOGData = [];

    const payload = masterAgentId
      ? { master_agent_id: masterAgentId }
      : { fetch_all: true };

    console.log("Loading recent data with payload:", payload);

    // Main recent data
    this.recentDataSub = this._homeService.getRecentData(payload).subscribe({
      next: (res) => {

        if (this.selectedAgent && this.isChatSubmitted && this.secondryAgentId) {
          this.loadAlreadySelectedAgent(this.secondryAgentId, res.data || []);
        }
        else {
          this.recentData = res.data || [];
          this.recentOGData = [...this.recentData];

          this.recentQueryForSuggestionData = res.data || [];
          this.recentQueryForSuggestionOGData = [...this.recentQueryForSuggestionData];

          console.log(`Recent Suggestion Data loaded (${this.recentQueryForSuggestionData.length} items)`);
          console.log(`Recent Data loaded (${this.recentData.length} items) for masterAgent:`, masterAgentId);
        }

        this.cdRef.detectChanges();
      },
      error: (err) => console.error("Error fetching recent data:", err)
    });

    // Suggestions
    // this.recentSuggestionSub = this._homeService.getRecentDataForSuggestion(payload).subscribe({
    //   next: (res) => {
    //     this.recentQueryForSuggestionData = res.data;
    //     this.recentQueryForSuggestionOGData = res.data;
    //     console.log(`Recent Suggestion Data loaded (${this.recentQueryForSuggestionData.length} items)`);
    //     this.cdRef.detectChanges();
    //   },
    //   error: (err) => console.error("Error fetching recent suggestion data:", err)
    // });
  }

  // Method to handle selection
  selectRecentQuery(query: any, index: number) {
    this.selectedQueries.add(query.user_query);   // Mark as selected

    // Your logic to load/execute the query
    console.log('Selected query:', query.user_query);

    this.getRecentchat(query, true);

    this.cdRef.detectChanges();
  }

  resetSelectedQueries() {
    this.selectedQueries.clear();
  }


fetchExplanationDataWithPolling(nodeId: string, responseIndex: number): void {
  const response = this.chatResponses[responseIndex];
  
  // Check if we already have BOTH logs and traces for this specific response
  if (this.explanationDataRetrieved.has(nodeId) && 
      response.logDetails && response.logDetails.length > 0 && 
      response.traceDetails && response.traceDetails.length > 0) {
    console.log(`Both logs and traces already retrieved for ${nodeId}, skipping polling`);
    return;
  }

  // Show loading state only if this is the first time we're polling
  if (!this.isLoadingExplanationData) {
    this.isLoadingExplanationData = true;
  }
  
  // Start polling for the data
  let pollCount = 0;
  const maxPolls = 60; // Maximum number of polling attempts (5 minutes with 5-second intervals)
  
  const pollForData = () => {
    this._homeService.getWorkflowLogsAndTraces(
      this.workflowIdFromState, 
      this.eventTrackingUniqueId
    ).subscribe({
      next: (apiResponse) => {
        pollCount++;
        
        if (apiResponse && apiResponse.data) {
          const { real_time_logs, trace_info } = apiResponse.data;
          
          // For internal workflows, try to find data by agent_name (primary key in the API response)
          let hasLogs = false;
          let hasTraces = false;
          let logsData = null;
          let tracesData = null;
          
          // Try to match by agent_name first (this is the primary key in the API response)
          if (response.agentName && real_time_logs && real_time_logs[response.agentName]) {
            logsData = real_time_logs[response.agentName];
            hasLogs = true;
            console.log(`Found logs by agent_name: ${response.agentName} for nodeId: ${nodeId}`);
          }
          
          if (response.agentName && trace_info && trace_info[response.agentName]) {
            tracesData = trace_info[response.agentName];
            hasTraces = true;
            console.log(`Found traces by agent_name: ${response.agentName} for nodeId: ${nodeId}`);
          }
          
          // If not found by agent_name, try with agent_id
          if (!hasLogs && !hasTraces && response.agentId) {
            if (real_time_logs) {
              // Look for logs by agent_id
              for (const key in real_time_logs) {
                if (real_time_logs[key].agent_id === response.agentId) {
                  logsData = real_time_logs[key];
                  hasLogs = true;
                  console.log(`Found logs by agent_id: ${response.agentId} for nodeId: ${nodeId}`);
                  break;
                }
              }
            }
            
            if (trace_info) {
              // Look for traces by agent_id
              for (const key in trace_info) {
                if (trace_info[key].agent_id === response.agentId) {
                  tracesData = trace_info[key];
                  hasTraces = true;
                  console.log(`Found traces by agent_id: ${response.agentId} for nodeId: ${nodeId}`);
                  break;
                }
              }
            }
          }
          
          // If still not found, try with nodeId (for external workflows)
          if (!hasLogs && !hasTraces && real_time_logs && real_time_logs[nodeId]) {
            logsData = real_time_logs[nodeId];
            hasLogs = true;
            console.log(`Found logs by nodeId: ${nodeId}`);
          } else if (!hasLogs && !hasTraces && trace_info && trace_info[nodeId]) {
            tracesData = trace_info[nodeId];
            hasTraces = true;
            console.log(`Found traces by nodeId: ${nodeId}`);
          }
          
          // Update with logs if available
          if (hasLogs && logsData) {
            this.chatResponses[responseIndex].logDetails = [logsData];
            console.log(`  - Added logs to response ${responseIndex}`);
          }
          
          // Update with trace details if available
          if (hasTraces && tracesData) {
            this.chatResponses[responseIndex].traceDetails = [tracesData];
            this.chatResponses[responseIndex].chatMessages = tracesData.chat_messages || [];
            console.log(`  - Added trace details to response ${responseIndex}`);
          }
          
          // Check if we now have BOTH logs and traces for this agent
          const hasBothLogsAndTraces = 
            this.chatResponses[responseIndex].logDetails && this.chatResponses[responseIndex].logDetails.length > 0 &&
            this.chatResponses[responseIndex].traceDetails && this.chatResponses[responseIndex].traceDetails.length > 0;
          
          if (hasBothLogsAndTraces) {
            // Data is available for both logs and traces
            console.log("Both logs and traces received for nodeId:", nodeId, "agent:", response.agentName);
            
            // Mark as retrieved for this specific node
            this.explanationDataRetrieved.add(nodeId);
            
            // Check if all agents have BOTH logs and traces before stopping the loading state
            const allAgentsHaveData = this.chatResponses.every(res => 
              this.explanationDataRetrieved.has(res.nodeId) ||
              // Consider it complete if we've tried max times
              pollCount >= maxPolls
            );
            
            if (allAgentsHaveData) {
              this.isLoadingExplanationData = false;
              console.log("All agents have data or max attempts reached, stopping loading state");
            }
            
            // Force change detection to update UI immediately
            this.cdRef.detectChanges();
            return; 
          }
        }
        
        if (pollCount < maxPolls) {
          // Data not ready yet for this node, continue polling
          console.log(`Explanation data not ready for ${nodeId} (${response.agentName}), polling again... (${pollCount}/${maxPolls})`);
        } else {
          // Max polls reached for this specific node
          console.warn(`Max polling attempts reached for ${nodeId} (${response.agentName})`);
          
          // Mark as attempted even if not found
          this.explanationDataRetrieved.add(nodeId);
          
          // Check if all agents have been attempted before stopping the loading state
          const allAgentsAttempted = this.chatResponses.every(res => 
            this.explanationDataRetrieved.has(res.nodeId)
          );
          
          if (allAgentsAttempted) {
            this.isLoadingExplanationData = false;
            console.log("All agents have been attempted, stopping loading state");
          }
          
          this.cdRef.detectChanges();
        }
      },
      error: (err) => {
        console.error(`Error polling for explanation data for ${nodeId} (${response.agentName}):`, err);
        pollCount++;
        
        if (pollCount < maxPolls) {
          // Continue polling on error
          console.log(`Error occurred, polling again... (${pollCount}/${maxPolls})`);
        } else {
          // Max polls reached on error for this specific node
          console.warn(`Max polling attempts reached due to errors for ${nodeId} (${response.agentName})`);
          
          // Mark as attempted even if not found
          this.explanationDataRetrieved.add(nodeId);
          
          // Check if all agents have been attempted before stopping the loading state
          const allAgentsAttempted = this.chatResponses.every(res => 
            this.explanationDataRetrieved.has(res.nodeId)
          );
          
          if (allAgentsAttempted) {
            this.isLoadingExplanationData = false;
            console.log("All agents have been attempted, stopping loading state");
          }
          
          this.cdRef.detectChanges();
        }
      }
    });
  };
  
  // Start polling immediately
  pollForData();
  
  // Create a separate subscription for each node to ensure independent polling
  const subscription = interval(10000).subscribe(() => {
    // Check if we have BOTH logs and traces for this agent
    const hasBothLogsAndTraces = 
      this.chatResponses[responseIndex].logDetails && this.chatResponses[responseIndex].logDetails.length > 0 &&
      this.chatResponses[responseIndex].traceDetails && this.chatResponses[responseIndex].traceDetails.length > 0;
      
    if (!this.explanationDataRetrieved.has(nodeId) && !hasBothLogsAndTraces && pollCount < maxPolls) {
      pollForData();
    } else if (hasBothLogsAndTraces) {
      // This agent has both logs and traces, unsubscribe from polling
      subscription.unsubscribe();
      console.log(`Stopping polling for ${nodeId} (${response.agentName}) - both logs and traces received`);
    } else if (this.explanationDataRetrieved.has(nodeId)) {
      // This agent has been marked as retrieved, unsubscribe from polling
      subscription.unsubscribe();
      console.log(`Stopping polling for ${nodeId} (${response.agentName}) - marked as retrieved`);
    }
  });
}

changeView(view: string): void {
  this.currentView = view;

  if (view === 'explanation') {
    console.log('Switching to explanation view...');

    // === REVIEW MODE ===
    if (this.isWorkflowReviewMode) {
      console.log('Review mode detected: Using pre-loaded logs & traces from DB (no polling)');
      
      this.isLoadingExplanationData = false;
      
      // Mark all as retrieved so UI shows data immediately
      this.chatResponses.forEach(res => {
        if (res.nodeId) {
          this.explanationDataRetrieved.add(res.nodeId);
        }
      });

      this.cdRef.detectChanges();
      return;
    }

    // === LIVE WORKFLOW MODE ===
    console.log('Live workflow mode: Starting polling for explanation data...');

    // Only clear and start polling if we are in a fresh live run
    if (this.workflowIdFromState && this.eventTrackingUniqueId) {
      this.explanationDataRetrieved.clear();
      this.isLoadingExplanationData = true;

      this.chatResponses.forEach((res, index) => {
        if (res.nodeId) {
          console.log(`Starting polling for agent: ${res.agentName || 'N/A'} (nodeId: ${res.nodeId})`);
          this.fetchExplanationDataWithPolling(res.nodeId, index);
        }
      });
    } else {
      console.warn('Live mode but missing workflowId or eventTrackingUniqueId - cannot poll');
      this.isLoadingExplanationData = false;
    }

    this.cdRef.detectChanges();
  }
}

fetchWorkflowLogsAndTraces(): void {
  // Only proceed if we have a workflow ID and event ID
  if (!this.workflowIdFromState || !this.eventTrackingUniqueId) {
    console.warn('Missing workflow ID or event ID for fetching logs and traces');
    return;
  }
  this.isLoadingLogsAndTraces = true;
  this._homeService.getWorkflowLogsAndTraces(
      this.workflowIdFromState, 
      this.eventTrackingUniqueId
    ).subscribe({
      next: (apiResponse) => {
        this.isLoadingLogsAndTraces = false;
        
        if (apiResponse && apiResponse.data) {
          // Process the logs and traces data
          const { real_time_logs, trace_info } = apiResponse.data;
        
          // Get all available keys from both logs and traces
          const availableKeys = [
            ...(real_time_logs ? Object.keys(real_time_logs) : []),
            ...(trace_info ? Object.keys(trace_info) : [])
          ].filter((value, index, self) => self.indexOf(value) === index);

          console.log('Available Keys:', availableKeys);
          console.log('Number of chat responses:', this.chatResponses.length);
          
          // For each response, try to find matching logs and traces
          this.chatResponses.forEach((response, index) => {
            let foundMatch = false;
            
            // First try to match by agent_name (primary key in the API response)
            if (response.agentName && availableKeys.includes(response.agentName)) {
              console.log(`Found direct match for agent_name ${response.agentName} to response ${index}`);
              
              // Update with logs if available
              if (real_time_logs && real_time_logs[response.agentName]) {
                response.logDetails = [real_time_logs[response.agentName]];
                console.log(`  - Added logs to response ${index}`);
              }
              
              // Update with trace details if available
              if (trace_info && trace_info[response.agentName]) {
                response.traceDetails = [trace_info[response.agentName]];
                //response.chatMessages = trace_info[response.agentName].chat_messages || [];
                console.log(`  - Added trace details to response ${index}`);
              }
              
              this.explanationDataRetrieved.add(response.nodeId);
              foundMatch = true;
            }
            
            // If no direct match by agent_name, try to match by agent_id
            if (!foundMatch && response.agentId) {
              for (const key of availableKeys) {
                if (real_time_logs && real_time_logs[key] && real_time_logs[key].agent_id === response.agentId) {
                  console.log(`Found agent_id match for ${response.agentId} to response ${index} via key ${key}`);
                  
                  // Update with logs
                  response.logDetails = [real_time_logs[key]];
                  console.log(`  - Added logs to response ${index}`);
                  foundMatch = true;
                }
                
                if (trace_info && trace_info[key] && trace_info[key].agent_id === response.agentId) {
                  console.log(`Found agent_id match for ${response.agentId} to response ${index} via key ${key}`);
                  
                  // Update with trace details
                  response.traceDetails = [trace_info[key]];
                  //response.chatMessages = trace_info[key].chat_messages || [];
                  console.log(`  - Added trace details to response ${index}`);
                  foundMatch = true;
                }
                
                if (foundMatch) {
                  this.explanationDataRetrieved.add(response.nodeId);
                  break;
                }
              }
            }
            
            // If still no match, try to match by nodeId (for external workflows)
            if (!foundMatch && availableKeys.includes(response.nodeId)) {
              console.log(`Found direct match for nodeId ${response.nodeId} to response ${index}`);
              
              // Update with logs if available
              if (real_time_logs && real_time_logs[response.nodeId]) {
                response.logDetails = [real_time_logs[response.nodeId]];
                console.log(`  - Added logs to response ${index}`);
              }
              
              // Update with trace details if available
              if (trace_info && trace_info[response.nodeId]) {
                response.traceDetails = [trace_info[response.nodeId]];
                // response.chatMessages = trace_info[response.nodeId].chat_messages || [];
                console.log(`  - Added trace details to response ${index}`);
              }
              
              this.explanationDataRetrieved.add(response.nodeId);
              foundMatch = true;
            }
            
            if (!foundMatch) {
              console.warn(`No matching logs or traces found for response ${index} with nodeId: ${response.nodeId}, agentId: ${response.agentId}, agentName: ${response.agentName}`);
              
              // For debugging, let's log what we're looking for vs what's available
              console.log('  Looking for:', {
                nodeId: response.nodeId,
                agentId: response.agentId,
                agentName: response.agentName
              });
              
              console.log('  Available agent_ids in logs:', 
                real_time_logs ? Object.values(real_time_logs).map(log => log.agent_id) : 'None'
              );
              console.log('  Available agent_names in logs:', 
                real_time_logs ? Object.keys(real_time_logs) : 'None'
              );
            }
          });
          
          this.cdRef.detectChanges();
        }
      },
      error: (err) => {
        this.isLoadingLogsAndTraces = false;
        console.error('Error fetching workflow logs and traces:', err);
      }
    });
}

getGroupedLogsByFeature(logs: any[]): any[] {
  const groupedLogs: { [key: string]: any[] } = {};
  
  logs.forEach(log => {
    const feature = log.feature || 'Unknown';
    if (!groupedLogs[feature]) {
      groupedLogs[feature] = [];
    }
    groupedLogs[feature].push(log);
  });
  
  // Convert to array of objects with feature and logs properties
  return Object.keys(groupedLogs).map(feature => ({
    feature,
    logs: groupedLogs[feature]
  }));
}

  onclickexplanation() {
    this.explanationtab = true;
  }


  convertToJson(res: any) {
    try {
      // take events_output from the object
      console.log("be", res.events_output)
      const clean = res.events_output.replace(/```json|```/g, '').trim();
      // const parsed = JSON.parse(clean);
      // return JSON.stringify(parsed, null, 2);
      return clean;
    } catch (e) {
      console.error("JSON parse failed:", e);
      return res.events_output; // fallback
    }
  }
  getParsedData(res: any): any {
    if (!res?.events_output) return null;

    try {
      let cleanString = res.events_output
        .replace(/```json|```/g, '') // Remove code block markers
        .trim();

      // Fix line breaks within strings
      cleanString = cleanString.replace(/("([^"\\]|\\.)*")/g, (match: any) => {
        return match.replace(/\n/g, '\\n');
      }).replace(PSV_REGEX, '')

      return JSON.parse(cleanString);
    } catch (e) {
      console.error("JSON parse failed:", e);
      return this.extractDataFromMalformedJson(res.events_output);
    }
  }

  parseTestCases(res: any): any[] {
    const parsedData = this.getParsedData(res);

    if (!parsedData || !parsedData.test_cases) {
      return [];
    }

    // Add AI accuracy (you can modify this logic as needed)
    return parsedData.test_cases.map((testCase: any, index: number) => {
      return {
        ...testCase,
        accuracy: this.calculateAccuracy(index) // Custom accuracy calculation
      };
    });
  }

  // Optional: Calculate AI accuracy (customize as needed)
  calculateAccuracy(index: number): string {
    // Example logic - replace with your actual accuracy calculation
    const accuracies = ['High', 'Medium', 'High', 'Low', 'Medium'];
    return accuracies[index % accuracies.length] || 'Medium';
  }

  // Fallback extraction method (keep as backup)
  extractDataFromMalformedJson(text: string): any {
    const result: any = { test_cases: [] };

    // Extract test case title
    const titleMatch = text.match(/"test_case_title"\s*:\s*"([^"]*)"/i);
    if (titleMatch) result.test_case_title = titleMatch[1];

    // Extract test cases
    const testCasesMatch = text.match(/"test_cases"\s*:\s*\[([\s\S]*?)\](?=,|\n|\})/i);
    if (testCasesMatch) {
      try {
        const testCasesString = `[${testCasesMatch[1]}]`;
        result.test_cases = JSON.parse(testCasesString.replace(/\n/g, ' '));
      } catch (e) {
        // Manual extraction if JSON parsing fails
        result.test_cases = this.extractTestCasesManually(text);
      }
    }

    return result;
  }

  extractTestCasesManually(text: string): any[] {
    const testCases: any[] = [];
    const testCaseBlocks = text.split('{').filter(block => block.includes('test_case_name'));

    testCaseBlocks.forEach(block => {
      const testCase: any = {};

      // Extract test case name
      const nameMatch = block.match(/"test_case_name"\s*:\s*"([^"]*)"/i);
      if (nameMatch) testCase.test_case_name = nameMatch[1];

      // Extract objective
      const objectiveMatch = block.match(/"objective"\s*:\s*"([^"]*)"/i);
      if (objectiveMatch) testCase.objective = objectiveMatch[1];

      // Extract preconditions
      const preconditionsMatch = block.match(/"preconditions"\s*:\s*\[([^\]]*)\]/i);
      if (preconditionsMatch) {
        testCase.preconditions = preconditionsMatch[1]
          .split(',')
          .map((item: string) => item.replace(/["']/g, '').trim())
          .filter((item: string) => item.length > 0);
      }

      // Extract test steps
      const stepsMatch = block.match(/"test_steps"\s*:\s*\[([^\]]*)\]/i);
      if (stepsMatch) {
        testCase.test_steps = stepsMatch[1]
          .split(',')
          .map((item: string) => item.replace(/["']/g, '').trim())
          .filter((item: string) => item.length > 0);
      }

      // Extract expected results
      const resultsMatch = block.match(/"expected_results"\s*:\s*\[([^\]]*)\]/i);
      if (resultsMatch) {
        testCase.expected_results = resultsMatch[1]
          .split(',')
          .map((item: string) => item.replace(/["']/g, '').trim())
          .filter((item: string) => item.length > 0);
      }

      if (Object.keys(testCase).length > 0) {
        testCases.push(testCase);
      }
    });

    return testCases;
  }
  // Convert to Text format
  convertToText(responses: any[]): string {
    let content = '';

    responses.forEach((res, index) => {
      const data = this.getParsedData(res);
      if (data) {
        content += `=== Test Case Suite ${index + 1} ===\n`;
        content += `Title: ${data.test_case_title || 'N/A'}\n`;
        content += `User Story: ${data.user_story || 'N/A'}\n`;
        content += `Acceptance Criteria:\n`;

        if (data.acceptance_criteria && Array.isArray(data.acceptance_criteria)) {
          data.acceptance_criteria.forEach((criteria: string, i: number) => {
            content += `  ${i + 1}. ${criteria}\n`;
          });
        }

        content += `Test Cases:\n`;
        if (data.test_cases && Array.isArray(data.test_cases)) {
          data.test_cases.forEach((testCase: any, i: number) => {
            content += `\n  ${i + 1}. ${testCase.test_case_name || 'Unnamed Test Case'}\n`;
            content += `     Objective: ${testCase.objective || 'N/A'}\n`;
            content += `     Preconditions: ${testCase.preconditions?.join(', ') || 'N/A'}\n`;
          });
        }

        content += `\nSummary: ${data.summary || 'N/A'}\n`;
        content += '\n'.repeat(2);
      }
    });

    return content;
  }

  openTrendingAgentChat(agent: any): void {
    const payload = { agent_id: agent.agent_id };
    this._homeService.getMasterAgent(payload).subscribe({
      next: (res) => {
        if (res?.success && res.data) {
          const masterAgent = res.data;

          // attach master agent id & subagent info
          agent.master_agent_id = masterAgent.agent_id;
          agent.subagent = res.data.subagent;

          console.log("Master Agent:", masterAgent);
          console.log("Task Agent:", agent);

          // 👉 Pass masterAgent to startTrendingTaskAgent, not the task agent
          this.startTrendingTaskAgent(masterAgent);

          // 👉 But still call handleOption with the clicked subagent
          if (agent.subagent) {
            this.handleOption(agent.subagent.name, agent.subagent.agent_id);
          }
        } else {
          console.warn("Failed to get master agent", res?.message);
        }
      },
      error: (err: any) => {
        console.error("Error fetching master agent:", err);
      }
    });
  }

  startTrendingTaskAgent(masterAgent: any): void {
    console.log("Hi");
    this.isSidebarExpanded = false;
    this.isNewChatOpen = true;

    // Set master agent as the selected agent
    this.selectedAgent = masterAgent;
    console.log("Selected Master Agent:", this.selectedAgent);

    this.isChatSubmitted = true;
    this.showWelcomePanel = true;
    this.latestUserQuery = '';
    this.chatResponses = [];
    this.chatMessages = [];
    this.selectedAgentOption = null;
	this.isSuggestionLoading = false;
    this.resetSelectedQueries();
    this.secondaryAgents = [];
    this.showThinking = false;
    this.isLoading = false;
    this.currentLoaderStep = 0;
    this.isChatOpenedByAgent = true;
  }

  // Convert to CSV format
  convertToCsvevent(responses: any[]): string {
    const csvRows: string[] = [];

    // CSV Header
    const headers = [
      'Suite Title',
      'Test Case Name',
      'Objective',
      'Preconditions',
      'Test Steps',
      'Expected Results',
      'User Story',
      'Acceptance Criteria'
    ];
    csvRows.push(headers.join(','));

    // CSV Data Rows
    responses.forEach(res => {
      const data = this.getParsedData(res);
      if (data && data.test_cases) {
        data.test_cases.forEach((testCase: any) => {
          const row = [
            `"${(data.test_case_title || '').replace(/"/g, '""')}"`,
            `"${(testCase.test_case_name || '').replace(/"/g, '""')}"`,
            `"${(testCase.objective || '').replace(/"/g, '""')}"`,
            `"${(testCase.preconditions?.join('; ') || '').replace(/"/g, '""')}"`,
            `"${(testCase.test_steps?.join('; ') || '').replace(/"/g, '""')}"`,
            `"${(testCase.expected_results?.join('; ') || '').replace(/"/g, '""')}"`,
            `"${(data.user_story || '').replace(/"/g, '""')}"`,
            `"${(data.acceptance_criteria?.join('; ') || '').replace(/"/g, '""')}"`
          ];
          csvRows.push(row.join(','));
        });
      }
    });

    return csvRows.join('\n');
  }

  // Convert to JSON format
  convertToJsonevent(responses: any[]): string {
    const jsonData = responses.map(res => {
      try {
        return this.getParsedData(res);
      } catch (error) {
        return { raw: res.events_output, error: 'Failed to parse' };
      }
    });

    return JSON.stringify(jsonData, null, 2);
  }

  // Download file function
  downloadeventFile(content: string, filename: string, contentType: string): void {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  private formatValue(value: any): string {
    if (Array.isArray(value)) {
      return value
        .map((v, i) => {
          if (typeof v === 'object' && v !== null) {
            return `  - ${JSON.stringify(v, null, 2)}`;
          }
          return `  - ${v}`;
        })
        .join('\n');
    } else if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    }
    return String(value ?? '');
  }

handleDownload(func: "downloadResponses" | "downloadChatResponses", download: boolean) {
  return this[func](download)
}
  
downloadDocx(content?: string | void): void {
    if (!content) return;
    let blobText = content
    const blob = new Blob([blobText], {
      type: 'text/html',
    });
    const file = new File([blob], 'input.html', { type: blob.type });
    const fd = new FormData();
    fd.append('file', file);

    this._homeService.downloadDocx(fd, true).subscribe({
      next: (res) => {
        const blob = res.body as unknown as Blob;
        if (!blob) return;
        let outputFilename =
          res.headers
            .get('content-disposition')
            ?.split(';')
            ?.find((item) => item.includes('filename='))
            ?.trim() || '';
        outputFilename = outputFilename?.split('=')?.[1] || 'default.docx';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = outputFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      error: (e) => {
        console.log('error', e);
      },
    });
  }

downloadResponses(download = true, index = -1): void | string {
  console.log("downloadresponses")
  try {
    let fileExt = '';
    let mimeType = '';

    if (this.currentView === 'text') {
      fileExt = 'txt';
      mimeType = 'text/plain';
    } else if (this.currentView === 'table') {
      fileExt = 'csv';
      mimeType = 'text/csv';
    } else if (this.currentView === 'json') {
      fileExt = 'json';
      mimeType = 'application/json';
    }

    let finalContent = '';
    let responses: any[] = [];
    
    // Get the appropriate responses
    if (index > -1) {
      responses = [this.eventResponses[index]];
    } else {
      // Filter responses based on selected checkboxes
      responses = this.eventResponses.filter((_, i) => this.selectedResponseIndex[i]);
      // If no checkboxes are selected, use all responses
      if (responses.length === 0) {
        responses = this.eventResponses;
      }
    }

    responses.forEach((res, idx) => {
      const parsed = this.getParsedData(res);
      let content = '';

      if (this.currentView === 'json') {
        content = JSON.stringify(res?.serializedBddJson || parsed, null, 2);
      }
      else if (this.currentView === 'table') {
        const rows: string[] = [];

        // Fixed table headers same as HTML
        const columns = [
          '#',
          'Test Case Name',
          'Objective',
          'Preconditions',
          'Test Steps',
          'Expected Results',
          'AI Accuracy'
        ];
        rows.push(columns.map(col => `"${col}"`).join(','));

        // Flatten test cases
        const testCases = this.parseTestCases(res) || [];
        testCases.forEach((testCase, j) => {
          const row = [
            j + 1,
            `"${(testCase.test_case_name ?? '').replace(/"/g, '""')}"`,
            `"${(testCase.objective ?? '').replace(/"/g, '""')}"`,
            `"${(testCase.preconditions ?? []).map((p: any) => `• ${p}`).join('\n').replace(/"/g, '""')}"`,
            `"${(testCase.test_steps ?? []).map((s: any) => `• ${s}`).join('\n').replace(/"/g, '""')}"`,
            `"${(testCase.expected_results ?? []).map((r: any) => `• ${r}`).join('\n').replace(/"/g, '""')}"`,
            `"80%"` // Hardcoded AI Accuracy from your HTML
          ];
          rows.push(row.join(','));
        });

        content = rows.join('\n');
      }
      else if (this.currentView === 'text') {
        // Generate text view content that matches the UI structure
        if (parsed) {
          // Find the original index of this response in the eventResponses array
          const originalIndex = this.eventResponses.indexOf(res);
          
          // Add the main test case title with the correct UC number
          // Trim the title to remove any leading whitespace
          // Changed from \n\n to \n to reduce spacing
          content += `UC-${880 + originalIndex + 1}: ${(parsed.test_case_title || "Test Case").trim()}\n`;
          
          // Add each test case
          if (parsed.test_cases && parsed.test_cases.length > 0) {
            parsed.test_cases.forEach((testCase, j) => {
              // Trim the test case name to remove any leading whitespace
              // Changed from \n\n to \n to reduce spacing
              content += `TC-${j + 1}: ${(testCase.test_case_name || '').trim()}\n`;
              
              // Add objective
              content += `Objective:\n${testCase.objective || ''}\n\n`;
              
              // Add preconditions
              content += `Preconditions:\n`;
              if (testCase.preconditions && testCase.preconditions.length > 0) {
                testCase.preconditions.forEach(pre => {
                  content += `• ${pre}\n`;
                });
              }
              content += '\n';
              
              // Add test steps
              content += `Test Steps:\n`;
              if (testCase.test_steps && testCase.test_steps.length > 0) {
                testCase.test_steps.forEach((step, stepIdx) => {
                  content += `${stepIdx + 1}. ${step}\n`;
                });
              }
              content += '\n';
              
              // Add expected results
              content += `Expected Results:\n`;
              if (testCase.expected_results && testCase.expected_results.length > 0) {
                testCase.expected_results.forEach(result => {
                  content += `• ${result}\n`;
                });
              }
              content += '\n';
              
              // Add AI accuracy
              content += `AI Accuracy:\n• 80%\n\n`;
              
              // Add separator between test cases
              if (j < parsed.test_cases.length - 1) {
                content += '---\n\n';
              }
            });
          }
          
          // Add separator between responses
          if (idx < responses.length - 1) {
            content += '\n---\n\n';
          }
        }
      }
      else {
        // Fallback to original text formatting
        if (parsed) {
          content = Object.entries(parsed)
            .map(([key, value]) => `${key}:\n${this.formatValue(value)}`)
            .join('\n\n');

          if(idx < responses.length - 1)
            content += '\n---\n\n'
        }
      }

      if (content.trim()) {
        finalContent += content;
      }
    });

    if (!finalContent.trim()) {
      alert('No content to download');
      return;
    }

    const filename = `test_cases_${new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '')}.${fileExt}`;

    // Return HTML content when download is false, similar to downloadChatResponses
    if (!download) {
      // Convert the content to HTML format
      // Update the regex to properly capture the entire title line
      let htmlContent = finalContent
        .replace(/\n/g, '<br>')
        .replace(/UC-(\d+): ([^<]+)/g, '<h3>UC-$1: $2</h3>')
        .replace(/TC-(\d+): ([^<]+)/g, '<h4>TC-$1: $2</h4>')
        .replace(/(\w+):/g, '<strong>$1:</strong>');
      
      return htmlContent;
    }

    const blob = new Blob(["\uFEFF" + finalContent], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Download error', err);
    alert('Error generating download');
  }
}

updateTables(tables: MarkdownTable[], index: number) {
  this.chatResponses[index].tables = tables;
}

  // Convert test cases to CSV format
  convertToCsv(testCases: any[]): string {
    const headers = ['Test Case Name', 'Objectives', 'Preconditions', 'Test Steps', 'Expected Results', 'AI Accuracy'];
    const rows = testCases.map(testCase => {
      return [
        `"${testCase.name}"`,
        `"${testCase.objectives}"`,
        `"${testCase.preconditions}"`,
        `"${testCase.steps.join('; ')}"`,
        `"${testCase.results.join('; ')}"`,
        `"${testCase.accuracy}"`
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  // Generic file download function
  downloadFile(content: string, filename: string, contentType: string): void {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  copyResponses(): void {
    try {
      console.log('Current view:', this.currentView);

      if (!this.eventResponses || this.eventResponses.length === 0) {
        this.showCopyTooltipempty();
        return;
      }

      if (this.currentView === 'explanation') {
        navigator.clipboard.writeText('')
          .then(() => this.showCopyTooltipempty())
          .catch(() => this.showCopyTooltipfail());
        return;
      }

      let selector = '';
      if (this.currentView === 'text') {
        selector = '.text-view .accordion-collapse';
      } else if (this.currentView === 'table') {
        selector = '.table-view .accordion-collapse';
      } else if (this.currentView === 'json') {
        selector = '.json-view .accordion-collapse';
      }

      const allContainers = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
      if (!allContainers.length) {
        this.showCopyTooltipempty();
        return;
      }

      let openContainers = allContainers.filter(c => c.classList.contains('show'));
      const containersToCopy = openContainers.length ? openContainers : allContainers;

      let finalContent = '';

      containersToCopy.forEach((container, index) => {
        let content = '';

        if (this.currentView === 'json') {
          content = container.textContent ?? '';

        } else if (this.currentView === 'table') {
          const rows = container.querySelectorAll('tbody tr');
          const formattedCases: string[] = [];

          rows.forEach((tr, rowIndex) => {
            const cells = tr.querySelectorAll('td');
            if (!cells.length) return;

            let caseText = `Test Case ${rowIndex + 1}\n`;
            caseText += `Test Case Name: ${cells[1]?.innerText.trim()}\n`;
            caseText += `Objective: ${cells[2]?.innerText.trim()}\n`;
            caseText += `Preconditions: ${cells[3]?.innerText.trim().replace(/\n/g, ', ')}\n`;
            caseText += `Test Steps: ${cells[4]?.innerText.trim().replace(/\n/g, ', ')}\n`;
            caseText += `Expected Results: ${cells[5]?.innerText.trim().replace(/\n/g, ', ')}\n`;
            caseText += `AI Accuracy: ${cells[6]?.innerText.trim()}\n`;

            formattedCases.push(caseText.trim());
          });

          content = formattedCases.join('\n\n');

        } else {
          content = (container as HTMLElement).innerText ?? '';
        }

        if (content.trim()) {
          const header = container.closest('.accordion-item')?.querySelector('.accordion-button');
          const ucLabel = header ? header.textContent?.trim() : `Response ${index + 1}`;
          finalContent += `\n\n===== ${ucLabel} =====\n\n${content}`;
        }
      });

      if (!finalContent.trim()) {
        this.showCopyTooltipempty();
        return;
      }

      navigator.clipboard.writeText(finalContent)
        .then(() => this.showCopyTooltip())
        .catch(err => {
          console.error('Copy failed:', err);
          this.showCopyTooltipfail();
        });

    } catch (error) {
      console.error('Copy error:', error);
      this.showCopyTooltipfail();
    }
  }

  // Enhanced copy to clipboard with fallback
  copyToClipboard(text: string): void {
    // Fallback for older browsers
    const fallbackCopy = (text: string) => {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        const successful = document.execCommand('copy');
        if (successful) {
          this.showCopyTooltip();
        } else {
          alert('Failed to copy text. Please try again.');
        }
      } catch (err) {
        alert('Failed to copy text: ' + err);
      }

      document.body.removeChild(textArea);
    };

    // Modern clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        this.showCopyTooltip();
      }).catch(err => {
        console.error('Clipboard API failed, using fallback:', err);
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  showCopyTooltip(): void {
    // Create or show tooltip
    let tooltip = document.querySelector('.copy-tooltip') as HTMLElement;

    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'copy-tooltip';
      tooltip.style.position = 'fixed';
      tooltip.style.top = '20px';
      tooltip.style.right = '20px';
      tooltip.style.background = '#fd8814ff';
      tooltip.style.color = 'white';
      tooltip.style.padding = '5px 10px';
      tooltip.style.borderRadius = '2px';
      tooltip.style.zIndex = '10000';
      tooltip.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';

      document.body.appendChild(tooltip);
    }
    tooltip.textContent = '✓ Copied to clipboard!';
    tooltip.style.display = 'block';

    // Hide after 2 seconds
    setTimeout(() => {
      if (tooltip) {
        tooltip.style.display = 'none';
      }
    }, 2000);
  }
  showCopyTooltipempty(): void {
    // Create or show tooltip
    let tooltip = document.querySelector('.copy-tooltip') as HTMLElement;

    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'copy-tooltip';
      tooltip.style.position = 'fixed';
      tooltip.style.top = '20px';
      tooltip.style.right = '20px';
      tooltip.style.background = '#fd8814ff';
      tooltip.style.color = 'white';
      tooltip.style.padding = '5px 10px';
      tooltip.style.borderRadius = '2px';
      tooltip.style.zIndex = '10000';
      tooltip.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';

      document.body.appendChild(tooltip);
    }
    tooltip.textContent = 'No content to copy';
    tooltip.style.display = 'block';

    // Hide after 2 seconds
    setTimeout(() => {
      if (tooltip) {
        tooltip.style.display = 'none';
      }
    }, 2000);
  }
  showCopyTooltipfail(): void {
    // Create or show tooltip
    let tooltip = document.querySelector('.copy-tooltip') as HTMLElement;

    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'copy-tooltip';
      tooltip.style.position = 'fixed';
      tooltip.style.top = '20px';
      tooltip.style.right = '20px';
      tooltip.style.background = '#fd2f14ff';
      tooltip.style.color = 'white';
      tooltip.style.padding = '5px 10px';
      tooltip.style.borderRadius = '2px';
      tooltip.style.zIndex = '10000';
      tooltip.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';

      document.body.appendChild(tooltip);
    }
    tooltip.textContent = 'Failed to copy, Try again!';
    tooltip.style.display = 'block';


    // Hide after 2 seconds
    setTimeout(() => {
      if (tooltip) {
        tooltip.style.display = 'none';
      }
    }, 2000);
  }

  // Copy responses based on current view
  // copyResponses(): void {
  //   let content = '';

  //   if (this.currentView === 'text') {
  //     content = this.eventResponses.join('\n\n');
  //   } else if (this.currentView === 'table') {
  //     const testCases = this.parseTestCases(this.eventResponses[0]);
  //     content = this.convertToCsv(testCases);
  //   } else if (this.currentView === 'json') {
  //     content = this.convertToJson(this.eventResponses);
  //   }

  //   // Copy to clipboard
  //   navigator.clipboard.writeText(content).then(() => {
  //     // Show copied tooltip
  //     const tooltip = document.querySelector('.copy-tooltip') as HTMLElement;
  //     if (tooltip) {
  //       tooltip.style.display = 'inline';
  //       setTimeout(() => {
  //         tooltip.style.display = 'none';
  //       }, 2000);
  //     }
  //   }).catch(err => {
  //     console.error('Failed to copy: ', err);
  //   });
  // }


  gettestcases(taskagentId: any) {
    this.showchatStepsDynamically();
    const params = { agent_id: taskagentId, ischat: true };

    this._commentService.testCaseGenerate(params).subscribe(data => {
      if (data != null || data != undefined) {

        this.getchateventresponse();
        this.isLoading = false;
        this.cdRef.detectChanges();
      }
      else {
        this._loadingService.hide();
      }
    });
  }
  showchatStepsDynamically() {
    this.currentLoaderStep = -1; // Start at -1 to show first step on first increment
    this.isLoading = true;

    this.loaderSteps = [
      { icon: '🪄', title: 'Identifying suitable AI Agent...', desc: '“Matching task with relevant agent.”' },
      { icon: '🌱', title: `Assigning Task Agent: ${this.selectedAgent.agent_name}...`, desc: '“Agent selected for generating context-aware user stories.”' },
      { icon: '🛠️', title: `Initializing ${this.selectedAgent.agent_name} workflow...`, desc: '“Mapping out use cases, validating user intents, applying business logic.”' },
      { icon: '🧾', title: `Generating ${this.selectedAgent.agent_name}...`, desc: '“Formulating structured user stories based on identified KYC scenarios.”' },
      { icon: '✅', title: 'Finalizing output...', desc: '“Preparing to display.”' }
    ];


    const interval = setInterval(() => {
      this.currentLoaderStep++;
      this.scrollToBottom();
      this.cdRef.detectChanges();
    }, 2000); // Show each step every 2 seconds
  }
  getchateventresponse() {

    var params = { agent_id: this.taskagentId, ischat: true };


    this._commentService.gettestCases(params).subscribe(data => {
      if (data && data.data) {
        this.eventResponses = data.data;
        // extend each response with local state fields
        this.eventResponses = this.eventResponses.map(res => ({
          ...res,
          selectedRating: res.rating || 0,
          hoveredRating: res.rating || 0,
          feedbackText: res.feedback || '',
          isPopupVisible: false
        }));

        this.cdRef.detectChanges();
      }
    });
  }
  geteventresponse() {
    var params = { agent_id: this.taskagentId, ischat: false };
    console.log("paaaa", params);

    this._commentService.gettestCases(params).subscribe(data => {
      if (data && data.data) {
        this.eventResponses = data.data;
        this.eventResponses = this.eventResponses.map(res => ({
          ...res,
          selectedRating: res.rating || 0,
          hoveredRating: res.rating || 0,
          feedbackText: res.feedback || '',
          isPopupVisible: false
        }));

        this.cdRef.detectChanges();
      }
    });
  }

  closefeedback() {
    this.isfeedback = false;
  }


  actionRequired(): void {

    console.log('Action required clicked');

    alert('Action required! Please review the test cases and provide feedback.');
  }

  parseEventsOutput(res: any) {
    try {
      const clean = res.events_output.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      console.error("Error parsing events_output:", e);
      return null;
    }
  }

  selectPopularQuery(query: string, event: Event): void {

    // Hide all tooltips via directive
    const tooltips = document.querySelectorAll('.tooltip, [class*="tooltip"], [role="tooltip"]');
    tooltips.forEach(tooltip => {
      tooltip.classList.remove('show', 'active', 'visible');
      (tooltip as HTMLElement).style.display = 'none';
      (tooltip as HTMLElement).style.visibility = 'hidden';
      (tooltip as HTMLElement).style.opacity = '0';
      tooltip.remove();
    });

    // Blur the clicked element to remove focus
    (event.target as HTMLElement).blur();

    // Open chat and set query
    this.isChatOpen = true;
    this.isNewChatOpen = true;
    this.isChatMinimized = false;
    this.isChatSubmitted = false;
    this.userQuery = query;
    this.showSendIcon = true;
    this.chatMessages = [];
    this.chatResponses = [];
    this.selectedAgent = null;
    this.selectedAgentOption = null;
	this.isSuggestionLoading = false;
    this.resetSelectedQueries();
    this.showThinking = false;
    this.isLoading = false;
    this.currentLoaderStep = 0;
    this.isChatOpenedByAgent = false;
    this.showWelcomePanel = false;
    this.cdRef.detectChanges();
    this.scrollToBottom();
  }

  showStepsDynamically() {
    this.currentLoaderStep = -1; // Start at -1 to show first step on first increment
    this.isLoading = true;
    this.showThinking = false;

    // this.loaderSteps = [
    //   { icon: '🪄', title: 'Identifying suitable AI Agent...', desc: '“Matching task with relevant agent.”' },
    //   { icon: '⚙️', title: `Connecting with Master Agent: ${this.selectedAgentOption}...`, desc: `“Engaging expert in ${this.selectedAgentOption}-related tasks.”` },
    //   { icon: '🔗', title: `${this.selectedAgentOption} engaged. Scanning agent pool...`, desc: '“Looking for specialized Task Agent for user story generation.”' },
    //   { icon: '🌱', title: 'Assigning Task Agent: User Story Creator...', desc: '“Agent selected for generating context-aware user stories.”' },
    //   { icon: '🛠️', title: 'Initializing story creation workflow...', desc: '“Mapping out use cases, validating user intents, applying business logic.”' },
    //   { icon: '🧾', title: 'Generating user stories...', desc: '“Formulating structured user stories based on identified KYC scenarios.”' },
    //   { icon: '✅', title: 'Finalizing output...', desc: '“Stories reviewed. Preparing to display.”' }];

    if (this.agentId) {
      this.loaderSteps = [
        { icon: '🪄', title: 'Identifying suitable AI Agent...', desc: '“Matching task with relevant agent.”' },
        { icon: '🌱', title: `Assigning Task Agent: ${this.selectedAgentOption}...`, desc: '“Agent selected for generating context-aware user stories.”' },
        { icon: '🛠️', title: `Initializing ${this.selectedAgentOption} workflow...`, desc: '“Mapping out use cases, validating user intents, applying business logic.”' },
        { icon: '🧾', title: `Generating ${this.selectedAgentOption}...`, desc: '“Formulating structured user stories based on identified KYC scenarios.”' },
        { icon: '✅', title: 'Finalizing output...', desc: '“Preparing to display.”' }
      ];

    }
    else if (this.isWorkflowrouted) {
      // Use workflow name for workflow scenario
      const workflowName = this.workflowDetails?.flow_name;

      this.loaderSteps = [
        { icon: '🪄', title: 'Initializing workflow...', desc: '“Preparing to execute the workflow.”' },
        { icon: '⚙️', title: `Connecting with workflow: ${workflowName}...`, desc: `“Engaging expert in ${workflowName}-related tasks.”` },
        { icon: '🔗', title: `${workflowName} engaged. Scanning workflow pool...`, desc: '“Agent selected for generating context-aware user stories.”' },
        { icon: '🌱', title: 'Preparing workflow steps...', desc: '“Mapping out use cases, validating user intents, applying business logic.”' },
        { icon: '🛠️', title: `Executing ${workflowName}...`, desc: '“Running workflow steps and processing data.”' },
        { icon: '🧾', title: `Generating ${workflowName}...`, desc: '“Formulating structured user stories based on identified KYC scenarios.”' },
        { icon: '✅', title: 'Finalizing output...', desc: '“Preparing to display workflow results.”' }
      ];
    }
    else {
      this.loaderSteps = [
        { icon: '🪄', title: 'Identifying suitable AI Agent...', desc: '“Matching task with relevant agent.”' },
        { icon: '⚙️', title: `Connecting with Master Agent: ${this.selectedAgent?.name}...`, desc: `“Engaging expert in ${this.selectedAgent?.name}-related tasks.”` },
        { icon: '🔗', title: `${this.selectedAgent?.name} engaged. Scanning agent pool...`, desc: '“Looking for specialized Task Agent.”' },
        { icon: '🌱', title: `Assigning Task Agent: ${this.selectedAgentOption}...`, desc: '“Agent selected for generating context-aware user stories.”' },
        { icon: '🛠️', title: `Initializing ${this.selectedAgentOption} workflow...`, desc: '“Mapping out use cases, validating user intents, applying business logic.”' },
        { icon: '🧾', title: `Generating ${this.selectedAgentOption}...`, desc: '“Formulating structured user stories based on identified KYC scenarios.”' },
        { icon: '✅', title: 'Finalizing output...', desc: '“Preparing to display.”' }
      ];
    }
    const interval = setInterval(() => {
      this.currentLoaderStep++;

      // Scroll to the bottom to show the latest step
      this.scrollToBottom();

      // Check if all steps are completed
      if (this.currentLoaderStep >= this.loaderSteps.length - 1) {
        clearInterval(interval);
        setTimeout(() => {
          this.isLoading = false;
          // this.showThinking = true;
          this.cdRef.detectChanges();
        }, 1000); // 1-second delay after last step before showing response
      }
      this.cdRef.detectChanges();
    }, 2000); // Show each step every 2 seconds
  }

  scrollToBottom() {
    setTimeout(() => {
      // Scroll chat messages container
      if (this.mainContainer?.nativeElement) {
        this.mainContainer.nativeElement.scrollTo({
          top: this.mainContainer.nativeElement.scrollHeight,
          behavior: 'auto'
        });
      }
    }, 0);
  }

  scrollLoaderSteps() {
    setTimeout(() => {
      if (this.scrollContainer?.nativeElement) {
        this.scrollContainer.nativeElement.scrollTo({
          top: this.scrollContainer.nativeElement.scrollHeight,
          behavior: 'auto'
        });
      }
    }, 0);
    this.cdRef.detectChanges();
  }

 extractTitleFromResponse(text, agentName?: string) { 
  let title = 'Response';

  if (typeof text !== 'string' || !text) {
    return agentName || title;
  }
  
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) {
    return agentName || title;
  }

  let titleLineIndex = lines.findIndex(item =>
    ['#', 'title:', "**"].some(s => item.toLowerCase().includes(s))
  );

  if (titleLineIndex === -1) {
    titleLineIndex = 0;
  }

  const line = lines[titleLineIndex];

  const parts = line.split(':').filter(Boolean);

  if (parts.length > 1) {
    title = parts[1];
  } else {
    title = parts[0];
  }

  const output = title.replace(/^[#* ]+|[#* ]+$/g, "");

  return output || agentName || title;
}

  extractTitleFromWorkflow(res: any): string {

    const text = res.result || '';

    const markdownTitleMatch = text.match(/^###\s+(.+)$/m);
    if (markdownTitleMatch) {
      return markdownTitleMatch[1].trim();
    }

    const boldTitleMatch = text.match(/\*\*( [^:]+):\s*(.+)\*\*/);
    if (boldTitleMatch) {
      return `${boldTitleMatch[1]}: ${boldTitleMatch[2]}`;
    }

    const simpleTitleMatch = text.match(/^( \d+: .+)$/m);
    if (simpleTitleMatch) {
      return simpleTitleMatch[1].trim();
    }
    return res.title;
  }


  toggleChat(): void {
    this.loadPopularQueries();
    this.isSidebarExpanded = false;
    if (!this.isChatOpen) {
      // Re-opening chat
      this.isChatOpen = true;
      // If chat was minimized, restore last chat window
      if (this.isChatMinimized) {
        this.isNewChatOpen = true;
        this.isChatMinimized = false;
      } else {
        // First time opening - show welcome screen
        this.isNewChatOpen = false;
      }
    } else {
      // Closing chat completely
      this.isChatOpen = false;
      this.isNewChatOpen = false;
      this.isChatMinimized = false;
    }
  }

  openNewChat() {
    console.log('New chat opened');
    this.isNewChatOpen = true;
    this.recentData = []; // Reset recent data
    this.isChatMinimized = false;
    this.isConversationStarted = false;
    this.isChatSubmitted = false;
    this.showWelcomePanel = false;
    this.chatMessages = [];
    this.chatResponses = [];
    this.selectedAgent = null;
    this.selectedAgentOption = null;
	this.isSuggestionLoading = false;
    this.resetSelectedQueries();
    this.showThinking = false;
    this.isLoading = false;
    this.currentLoaderStep = 0;
    this.isChatOpenedByAgent = false;
    this.isChatOpen = false;
    this.showSendIcon = false;
    this.showSendIcon1 = false;
    this.loadRecentData();

  }


  closeNewChat() {
    this.isNewChatOpen = false;
  }

  getAgentTypeLabel(id: string): string {
    const found = this.agentTypes.find(t => t.value === id);
    return found ? found.label : id;
  }

  loadAgents_olf(): void {
    console.log("loadagents_chatbot");
    this._marketService.getAgentDetails().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.allAgents = response.data;

          // Get agent type values for Task Agent and Master Agent
          const taskAgentType = this.agentTypes.find(t => t.label === 'Task Agent')?.value;
          const masterAgentType = this.agentTypes.find(t => t.label === 'Master Agent')?.value;

          const activePrj = this.loggedUser?.ActiveProject;
          console.log('Active Project_chatbot:', activePrj);

          // ✅ Extract mapped team & role from PrjDetails for the active project
          const projectDetails = this.loggedUser?.ProjectDtl || [];
          console.log('User Project Details_chatbot:', projectDetails);

          // ✅ Find project mapping for the active project (case-insensitive)
          const mappedProject = projectDetails.find(
            (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
          );
          console.log('Mapped Project_chatbot:', mappedProject);

          const mappedTeam = mappedProject?.team_name || '';
          const mappedRole = mappedProject?.role_name?.toLowerCase() || '';
          console.log('Mapped Team:', mappedTeam);
          console.log('Mapped Role:', mappedRole);

          if (
            activePrj &&
            activePrj.toLowerCase() !== this.masterDatabase.toLowerCase() &&
            mappedRole !== 'super admin' &&
            mappedRole !== 'admin'
          ) {
            const projects = this._stateService.getProjectManagementData() || [];
            console.log("proj_chatbot", projects);

            const activeProject = projects.find((prj: any) =>
              prj.projectName && prj.projectName.toLowerCase() === activePrj.toLowerCase()
            );
            console.log('Active pppp_chatbot:', activeProject);

            if (mappedTeam) {
              console.log('needagency0_chatbot_get:', this.agenciesWithAgents);

              this.agenciesWithAgents = this.agenciesWithAgents.filter(agency =>
                agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
              );
              console.log('needagency0_chatbot:', this.agenciesWithAgents);

              const agentIds = this.agenciesWithAgents.flatMap(agency =>
                (agency.agents || [])
                  .filter((agent: { status: string }) => agent.status === "active")
                  .map((agent: { agent_id: any }) => agent.agent_id)
              );

              // Filter task agents by IDs
              this.alltaskAgents = (this.allAgents || []).filter(
                (agent: { agent_id: any }) => agentIds.includes(agent.agent_id)
              );
              console.log('needagency0_chatbot_allagent:', this.agenciesWithAgents);

              this.masterAgents = this.alltaskAgents.filter(agent =>
                agent.agent_type_id === masterAgentType &&
                agent.status?.toLowerCase() === 'active'
              );

              console.log('needagency0_chatbot_Master:', this.agenciesWithAgents);

              // Filter trending Task Agents
              this.trendingAgents = this.alltaskAgents.filter(agent =>
                agent.trending && agent.agent_type_id === taskAgentType
              );

              console.log('needagency0_chatbot_trending:', this.agenciesWithAgents);
            }
          }
          else {
            this.masterAgents = this.allAgents.filter(agent =>
              agent.agent_type_id === masterAgentType &&
              agent.status?.toLowerCase() === 'active'
            );

            // Filter trending Task Agents
            this.trendingAgents = this.allAgents.filter(agent =>
              agent.trending && agent.agent_type_id === taskAgentType
            );
          }

          // Filter Master Agents and models
          this.filteredAgents = [...this.allAgents];
          this.totalItems = this.filteredAgents.length;

          const agentModels = Array.from(new Set(
            this.allAgents
              .map(agent => agent.model)
              .filter(model => !!model)
          ));
          this.modelsList = agentModels.map(model => ({ value: model, label: model }));
        }
      },
      error: (err: any) => {
        console.error('Error loading agents:', err);
      }
    });
  }


  // loadAgents(): void {
    // console.log("loadagents_chatbot");
    // this._marketService.getAgentDetails().subscribe({
      // next: (response) => {
        // if (response.Success && response.Agents) {
          // this.allAgents = response.Agents;

          // // Get agent type values for Task Agent and Master Agent
          // const taskAgentType = this.agentTypes.find(t => t.label === 'Task Agent')?.value;
          // const masterAgentType = this.agentTypes.find(t => t.label === 'Master Agent')?.value;

          // const activePrj = this.loggedUser?.ActiveProject;
          // console.log('Active Project_chatbot:', activePrj);

          // // ✅ Extract mapped team & role from PrjDetails for the active project
          // const projectDetails = this.loggedUser?.ProjectDtl || [];
          // console.log('User Project Details_chatbot:', projectDetails);

          // let mappedProject: any = null; // Use `any` or a proper type, not `any[]`
          // var mappedTeam = "";
          // var mappedRole = "";
          // const projectManagementDetailsOrg = this._stateService.getProjectManagementData() || [];


          // if (this.loggedUser?.Role === "Super Admin") {
            // mappedProject = projectManagementDetailsOrg.find(
              // (p: any) => p.projectName?.toLowerCase() === activePrj?.toLowerCase()
            // );

            // mappedTeam = mappedProject?.teams[0].teamName || '';
            // mappedRole = mappedProject?.teams[0].roles[0].role?.toLowerCase() || '';

          // } else {
            // // Assuming `projectDetails` is defined elsewhere in your component
            // mappedProject = projectDetails.find(
              // (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
            // );

            // mappedTeam = mappedProject?.team_name || '';
            // mappedRole = mappedProject?.role_name?.toLowerCase() || '';
          // }

          // console.log('Mapped Project_chatbot:', mappedProject);

          // console.log('Mapped Team:', mappedTeam);
          // console.log('Mapped Role:', mappedRole);

          // if (
            // activePrj &&
            // activePrj.toLowerCase() !== this.masterDatabase.toLowerCase() &&
            // mappedRole !== 'super admin' &&
            // mappedRole !== 'admin'
          // ) {
            // const projects = this._stateService.getProjectManagementData() || [];
            // console.log("proj_chatbot", projects);

            // const activeProject = projects.find((prj: any) =>
              // prj.projectName && prj.projectName.toLowerCase() === activePrj.toLowerCase()
            // );
            // console.log('Active pppp_chatbot:', activeProject);

            // if (mappedTeam) {
              // console.log('needagency0_chatbot_get:', this.agenciesWithAgents);

              // this.agenciesWithAgents = this.agenciesWithAgents.filter(agency =>
                // agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
              // );
              // console.log('needagency0_chatbot:', this.agenciesWithAgents);

              // const agentIds = this.agenciesWithAgents.flatMap(agency =>
                // (agency.agents || [])
                  // .filter((agent: { status: string }) => agent.status === "active")
                  // .map((agent: { agent_id: any }) => agent.agent_id)
              // );

              // // Filter task agents by IDs
              // this.alltaskAgents = (this.allAgents || []).filter(
                // (agent: { agent_id: any }) => agentIds.includes(agent.agent_id)
              // );
              // console.log('needagency0_chatbot_allagent:', this.agenciesWithAgents);

              // this.masterAgents = this.alltaskAgents.filter(agent =>
                // agent.agent_type_id === masterAgentType &&
                // agent.status?.toLowerCase() === 'active'
              // );

              // console.log('needagency0_chatbot_Master:', this.agenciesWithAgents);

              // // Filter trending Task Agents
              // this.trendingAgents = this.alltaskAgents.filter(agent =>
                // agent.trending && agent.agent_type_id === taskAgentType
              // );

              // console.log('needagency0_chatbot_trending:', this.agenciesWithAgents);
            // }
          // }
          // else {

            // if (this.loggedUser?.Role === "Super Admin" && activePrj.toLowerCase() !== this.masterDatabase.toLowerCase()) {
              // const projects = this._stateService.getProjectManagementData() || [];

              // const activeProject = projects.find((prj: any) =>
                // prj.projectName && prj.projectName.toLowerCase() === activePrj.toLowerCase()
              // );

              // if (mappedTeam) {

                // if (mappedProject && Array.isArray(mappedProject.teams)) {
                  // // Step 2: Extract all team names from the teams array
                  // const mappedTeamNames = mappedProject.teams.map((team: any) =>
                    // team.teamName?.toLowerCase().trim()
                  // );

                  // // Step 3: Filter agencies whose assigned_to matches ANY of these team names
                  // this.agenciesWithAgents = this.agenciesWithAgents.filter(agency =>
                    // mappedTeamNames.includes(agency.assigned_to?.toLowerCase().trim())
                  // );
                // }

                // // this.agenciesWithAgents = this.agenciesWithAgents.filter(agency =>
                // //   agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
                // // );

                // const agentIds = this.agenciesWithAgents.flatMap(agency =>
                  // (agency.agents || [])
                    // .filter((agent: { status: string }) => agent.status === "active")
                    // .map((agent: { agent_id: any }) => agent.agent_id)
                // );

                // // Filter task agents by IDs
                // this.alltaskAgents = (this.allAgents || []).filter(
                  // (agent: { agent_id: any }) => agentIds.includes(agent.agent_id)
                // );

                // this.masterAgents = this.alltaskAgents.filter(agent =>
                  // agent.agent_type_id === masterAgentType &&
                  // agent.status?.toLowerCase() === 'active'
                // );

                // // Filter trending Task Agents
                // this.trendingAgents = this.alltaskAgents.filter(agent =>
                  // agent.trending && agent.agent_type_id === taskAgentType
                // );

              // }
            // }
            // else {
              // this.masterAgents = this.allAgents.filter(agent =>
                // agent.agent_type_id === masterAgentType &&
                // agent.status?.toLowerCase() === 'active'
              // );
            // }
            // // Filter trending Task Agents
            // this.trendingAgents = this.allAgents.filter(agent =>
              // agent.trending && agent.agent_type_id === taskAgentType
            // );
          // }

          // // Filter Master Agents and models
          // this.filteredAgents = [...this.allAgents];
          // this.totalItems = this.filteredAgents.length;

          // const agentModels = Array.from(new Set(
            // this.allAgents
              // .map(agent => agent.model)
              // .filter(model => !!model)
          // ));
          // this.modelsList = agentModels.map(model => ({ value: model, label: model }));
        // }
      // },
      // error: (err: any) => {
        // console.error('Error loading agents:', err);
      // }
    // });
  // }
  
    loadAgents(): void {
    console.log("loadagents_chatbot");
    this._marketService.getAgentDetails().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.allAgents = response.data;

          // Get agent type values for Task Agent and Master Agent
          const taskAgentType = this.agentTypes.find(t => t.label === 'Task Agent')?.value;
          const masterAgentType = this.agentTypes.find(t => t.label === 'Master Agent')?.value;

          const activePrj = this.loggedUser?.ActiveProject;
          console.log('Active Project_chatbot:', activePrj);

          // ✅ Extract mapped team & role from PrjDetails for the active project
          const projectDetails = this.loggedUser?.ProjectDtl || [];
          console.log('User Project Details_chatbot:', projectDetails);

          let mappedProject: any = null; // Use `any` or a proper type, not `any[]`
          var mappedTeam = "";
          var mappedRole = "";
          const projectManagementDetailsOrg = this._stateService.getProjectManagementData() || [];


          if (this.loggedUser?.Role === "Super Admin") {
            mappedProject = projectManagementDetailsOrg.find(
              (p: any) => p.projectName?.toLowerCase() === activePrj?.toLowerCase()
            );

            mappedTeam = mappedProject?.teams[0].teamName || '';
            mappedRole = mappedProject?.teams[0].roles[0].role?.toLowerCase() || '';

          } else {
            // Assuming `projectDetails` is defined elsewhere in your component
            mappedProject = projectDetails.find(
              (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
            );

            mappedTeam = mappedProject?.team_name || '';
            mappedRole = mappedProject?.role_name?.toLowerCase() || '';
          }

          console.log('Mapped Project_chatbot:', mappedProject);

          console.log('Mapped Team:', mappedTeam);
          console.log('Mapped Role:', mappedRole);

          if (
            activePrj &&
            activePrj.toLowerCase() !== this.masterDatabase.toLowerCase() &&
            mappedRole !== 'super admin' &&
            mappedRole !== 'admin'
          ) {
            const projects = this._stateService.getProjectManagementData() || [];
            console.log("proj_chatbot", projects);

            const activeProject = projects.find((prj: any) =>
              prj.projectName && prj.projectName.toLowerCase() === activePrj.toLowerCase()
            );
            console.log('Active pppp_chatbot:', activeProject);

            if (mappedTeam) {
              console.log('needagency0_chatbot_get:', this.agenciesWithAgents);

              this.agenciesWithAgents = this.agenciesWithAgents.filter(agency =>
                agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
              );
              console.log('needagency0_chatbot:', this.agenciesWithAgents);

              const agentIds = this.agenciesWithAgents.flatMap(agency =>
                (agency.agents || [])
                  .filter((agent: { status: string }) => agent.status === "active")
                  .map((agent: { agent_id: any }) => agent.agent_id)
              );

              // Filter task agents by IDs
              this.alltaskAgents = (this.allAgents || []).filter(
                (agent: { agent_id: any }) => agentIds.includes(agent.agent_id)
              );
              console.log('needagency0_chatbot_allagent:', this.agenciesWithAgents);

              this.masterAgents = this.alltaskAgents.filter(agent =>
                agent.agent_type_id === masterAgentType &&
                agent.status?.toLowerCase() === 'active'
              );

              console.log('needagency0_chatbot_Master:', this.agenciesWithAgents);

              // Filter trending Task Agents
              this.trendingAgents = this.alltaskAgents.filter(agent =>
                agent.trending && agent.agent_type_id === taskAgentType
              );

              console.log('needagency0_chatbot_trending:', this.agenciesWithAgents);
            }
          }
          else {

            if (this.loggedUser?.Role === "Super Admin" && activePrj.toLowerCase() !== this.masterDatabase.toLowerCase()) {
              const projects = this._stateService.getProjectManagementData() || [];

              const activeProject = projects.find((prj: any) =>
                prj.projectName && prj.projectName.toLowerCase() === activePrj.toLowerCase()
              );

              if (mappedTeam) {

                if (mappedProject && Array.isArray(mappedProject.teams)) {
                  // Step 2: Extract all team names from the teams array
                  const mappedTeamNames = mappedProject.teams.map((team: any) =>
                    team.teamName?.toLowerCase().trim()
                  );

                  // Step 3: Filter agencies whose assigned_to matches ANY of these team names
                  this.agenciesWithAgents = this.agenciesWithAgents.filter(agency =>
                    mappedTeamNames.includes(agency.assigned_to?.toLowerCase().trim())
                  );
                }

                // this.agenciesWithAgents = this.agenciesWithAgents.filter(agency =>
                //   agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
                // );

                const agentIds = this.agenciesWithAgents.flatMap(agency =>
                  (agency.agents || [])
                    .filter((agent: { status: string }) => agent.status === "active")
                    .map((agent: { agent_id: any }) => agent.agent_id)
                );

                // Filter task agents by IDs
                this.alltaskAgents = (this.allAgents || []).filter(
                  (agent: { agent_id: any }) => agentIds.includes(agent.agent_id)
                );

                this.masterAgents = this.alltaskAgents.filter(agent =>
                  agent.agent_type_id === masterAgentType &&
                  agent.status?.toLowerCase() === 'active'
                );

                // Filter trending Task Agents
                this.trendingAgents = this.alltaskAgents.filter(agent =>
                  agent.trending && agent.agent_type_id === taskAgentType
                );

              }
            }
            else {
              this.masterAgents = this.allAgents.filter(agent =>
                agent.agent_type_id === masterAgentType &&
                agent.status?.toLowerCase() === 'active'
              );
            }
            // Filter trending Task Agents
            this.trendingAgents = this.allAgents.filter(agent =>
              agent.trending && agent.agent_type_id === taskAgentType
            );
          }

          // Filter Master Agents and models
          this.filteredAgents = [...this.allAgents];
          this.totalItems = this.filteredAgents.length;

          const agentModels = Array.from(new Set(
            this.allAgents
              .map(agent => agent.model)
              .filter(model => !!model)
          ));
          this.modelsList = agentModels.map(model => ({ value: model, label: model }));
        }
      },
      error: (err: any) => {
        console.error('Error loading agents:', err);
      }
    });
  }
 

  loadDropdowns(): void {
    console.log("hi")
    this._marketService.getAllDropdowns().subscribe({
      next: (res) => {
        if (res.data) {
          this.agentTypes = res.data.agent_types;
          this.cdRef.detectChanges();
        }
      },
      error: (err) => {
        console.error('Failed to load dropdowns:', err);
      }
    });
  }

  toggleShowAll() {
    this.showAll = !this.showAll;
  }

  getAgentIcon(agentType: string): string {
    const iconMap: { [key: string]: string } = {
      'Requirement Twin': 'assets/img/agency-icon.png',
      'Designer Twin': 'assets/img/dt.png',
      'Coding Twin': 'assets/img/ct.png',
      'Quality Twin': 'assets/img/qt.png',
      'Release Twin': 'assets/img/rt.png',
      'SRE Twin': 'assets/img/st.png',
      'DevOps Twin': 'assets/img/devopst.png',
      'IT Ops Twin': 'assets/img/itops.png',
      'QE Twin': 'assets/img/QE_Twin.png'
    };

    return iconMap[agentType] || 'assets/img/default.png';
  }

  onInputChange(): void {
    this.showSendIcon = this.userQuery.trim().length > 0;
  }

    onInputChange1(): void {
    console.log("checking input change");
    this.showSendIcon1 = this.userQuery1.trim().length > 0;
    if (this.userQuery1?.trim()) {
    this.isFromPromptRepository = false;
    this.resetFeedbackState();   // Reset when user starts typing new query
  }
  }

  startPollingForWorkflowResults(loaderIdx: number): void {
    console.log("Starting polling for workflow results with loaderIdx:", loaderIdx);
    if (this.workflowPollingSubscription) {
      this.workflowPollingSubscription.unsubscribe();
    }

    // Set global loading state to true
    this.isWorkflowLoading = true;
    this.firstResponseLoaded = false;
    // Reset processed results to avoid duplicates
    this.processedResultIds = new Set();
    // Reset expected count
    this.expectedResultCount = 0;
    // Reset completion flag
    this.workflowCompleted = false;
    // Reset consecutive empty responses counter
    this.emptyResponseCount = 0;
    // Reset initial results processed flag
    this.initialResultsProcessed = false;

    // Start polling after a short delay to allow backend to process
    setTimeout(() => {
      this.workflowPollingSubscription = interval(5000).subscribe(() => {
        console.log("Polling interval triggered, event ID:", this.eventTrackingUniqueId);
        this.getWorkflowResults(loaderIdx);
      });
    }, 2000); // 2 second delay before starting polling
  }

  getWorkflowResults(loaderIdx: number): void {
    console.log("Getting workflow results...");
    const params = { event_id: this.eventTrackingUniqueId };

    this._homeService.getWorkflowEventResponse(params).subscribe({
      next: ({ data }) => {
        console.log("event response:", data);

        if (data && Array.isArray(data) && data.length > 0) {
          this.emptyResponseCount = 0;

          // Flatten all results from all documents
          const allResults: any[] = [];
          data.forEach((doc: any) => {
            if (doc.response && Array.isArray(doc.response.results)) {
              allResults.push(...doc.response.results);
            }
          });

          if (allResults.length === 0) {
            this.emptyResponseCount++;
            if (this.emptyResponseCount >= 56) {
              this.stopPollingForWorkflowResults();
              this.handleWorkflowError(loaderIdx, { error: "No valid results found" });
            }
            return;
          }

          // Process each individual result
          allResults.forEach((result: any) => {
            const resultId = result._id || result.key || `result-${Math.random()}`;
            if (this.processedResultIds.has(resultId)) return;
            this.processedResultIds.add(resultId);

            const mappedResult = {
              result: result.response || result.result || "",
              issue_key: result.key || "Unknown Issue",
              explanation: result.explanation || 'No explanation provided',
              thinking: result.thinking || 'No thinking trace'
            };

            this.processIndividualWorkflowResult(mappedResult, loaderIdx, false);
          });

          // Stop if workflow is marked complete
          const isComplete = data.some((doc: any) =>
            doc.status === 'completed' ||
            doc.workflowCompleted === true ||
            doc.allResultsReceived === true
          );

          if (isComplete || this.processedResultIds.size >= this.expectedResultCount) {
            console.log("Workflow completed or all results processed");
            this.stopPollingForWorkflowResults();
          }

        } else {
          this.emptyResponseCount++;
          if (this.emptyResponseCount >= 56) {
            this.stopPollingForWorkflowResults();
            this.handleWorkflowError(loaderIdx, { error: "No response after multiple attempts" });
          }
        }
      },
      error: (err) => {
        console.error('Error polling for workflow results:', err);
        this.stopPollingForWorkflowResults();
        this.handleWorkflowError(loaderIdx, err);
      }
    });
  }
  
toggleWorkflowThinkingItem(i: number) {
    if (this.workflowThinkingLogs && this.workflowThinkingLogs[i]) {
        this.workflowThinkingLogs[i].expanded = !this.workflowThinkingLogs[i].expanded;
        this.cdRef.detectChanges();
    }
}

// Update the toggleWorkflowThinkingCollapse method
toggleWorkflowThinkingCollapse() {
    this.isWorkflowThinkingCollapsed = !this.isWorkflowThinkingCollapsed;
    this.cdRef.detectChanges();
}

processLogData(logData: any, agentName?: string): void {
  console.log('🔄 Processing log data:', logData);
  
  this.hasWorkflowLogs = true;
  const logEntry = this.createLogStep(logData, agentName);
  this.logsDuringWorkflowLoading.push(logEntry);
  
  // Update thinking logs immediately
  this.workflowThinkingLogs = this.logsDuringWorkflowLoading.map(log => ({
    title: log.title,
    content: this.createLogDetails(log.originalData || log),
    expanded: false
  }));
  
  // IMPORTANT: Force showThinking to true when we have logs
  this.showThinking = true;
  
  console.log('💭 Updated workflowThinkingLogs:', this.workflowThinkingLogs);
  console.log('👁️ showThinking flag:', this.showThinking);
  console.log('📝 logsDuringWorkflowLoading:', this.logsDuringWorkflowLoading);
  
  // Force change detection
  this.cdRef.detectChanges();
}

createWorkflowLogStep(logData: any, agentName?: string): any {
  const timestamp = new Date().toLocaleTimeString();
  let title = 'Processing';
  let desc = '';
  let icon = '⚙️';
  
  // Extract event_type from the log data
  if (logData.event_type) {
    title = logData.event_type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    
    // Set appropriate icon based on event type
    if (logData.event_type.includes('start')) {
      icon = '🚀';
    } else if (logData.event_type.includes('complete')) {
      icon = '✅';
    } else if (logData.event_type.includes('error')) {
      icon = '❌';
    } else if (logData.event_type.includes('llm')) {
      icon = '🤖';
    } else if (logData.event_type.includes('tool')) {
      icon = '🔧';
    }
  }
  
  // Extract status or message for description
  if (logData.status) {
    desc = `Status: ${logData.status}`;
  } else if (logData.message) {
    desc = logData.message;
  }
  
  // Add agent name to title if available
  if (agentName) {
    title = `${agentName}: ${title}`;
  }
  
  return {
    title,
    desc,
    icon,
    timestamp,
    originalData: logData
  };
}

prepareWorkflowThinkingLogs(): void {
    console.log('🔄 Preparing workflow thinking logs...');
    
    // Get the execution order of nodes
    const executionOrderNodes = this.getExecutionOrderNodes();
    
    // Create a map of agent IDs to their execution order
    const agentExecutionOrder: { [agentId: string]: number } = {};
    executionOrderNodes.forEach((node, index) => {
        agentExecutionOrder[node.agent_id] = index;
    });
    
    // Create a map of agent IDs to agent names
    const agentIdToName: { [agentId: string]: string } = {};
    this.workflowDetails?.flow_data?.tasks?.forEach((task: any) => {
        if (task.params.config?.agent_id && task.params.config?.agent_name) {
            agentIdToName[task.params.config.agent_id] = task.params.config.agent_name;
        }
    });

    // Group logs by agent name (keep original logic)
    const logsByAgent: { [agentName: string]: any[] } = {};
    
    this.logsDuringWorkflowLoading.forEach(log => {
        const agentName = log.agentName;
        if (!logsByAgent[agentName]) {
            logsByAgent[agentName] = [];
        }
        logsByAgent[agentName].push(log);
    });
    
    // Convert to the format expected by the template, sorted by execution order
    const agentNames = Object.keys(logsByAgent);
    
    // Sort agents by their execution order
    agentNames.sort((a, b) => {
        // Find the agent ID for each agent name
        const agentIdA = Object.keys(agentIdToName).find(id => agentIdToName[id] === a) || a;
        const agentIdB = Object.keys(agentIdToName).find(id => agentIdToName[id] === b) || b;
        
        const orderA = agentExecutionOrder[agentIdA] !== undefined ? agentExecutionOrder[agentIdA] : 999;
        const orderB = agentExecutionOrder[agentIdB] !== undefined ? agentExecutionOrder[agentIdB] : 999;
        return orderA - orderB;
    });
    
    this.workflowThinkingLogs = agentNames.map(originalAgentName => {
        const agentLogs = logsByAgent[originalAgentName];
        
        // Extract the proper agent name from the log titles
        let displayAgentName = originalAgentName;
        
        // Look for "Agent Process End" log to extract the name
        const endLog = agentLogs.find(log => 
            log.title && log.title.includes('Agent Process End')
        );
        
        if (endLog) {
            const match = endLog.title.match(/Agent Process End in (.+)/);
            if (match && match[1]) {
                displayAgentName = match[1].trim();
            }
        } else {
            // Fallback: look for "Agent Process Start" log
            const startLog = agentLogs.find(log => 
                log.title && log.title.includes('Agent Process Start')
            );
            if (startLog) {
                const match = startLog.title.match(/Agent Process Start in (.+)/);
                if (match && match[1]) {
                    displayAgentName = match[1].trim();
                }
            }
        }
        
        // Create log entries for this agent
        const logEntries = agentLogs.map(log => ({
            title: log.title,
            content: this.createLogDetails(log.originalData || log),
            expanded: false
        }));
        
        return {
            agentName: displayAgentName, // Use the name extracted from the log
            logs: logEntries,
            expanded: false // Agent section starts collapsed
        };
    });
    
    // Set flags to show accordion instead of buffering
    this.isWorkflowThinkingLoading = false;
    this.workflowAllLogsLoaded = true;
    this.isWorkflowThinkingCollapsed = false;
    
    console.log(' Workflow thinking logs prepared:', this.workflowThinkingLogs);
    console.log(' Flags - Loading:', this.isWorkflowThinkingLoading, 'AllLoaded:', this.workflowAllLogsLoaded);
    this.cdRef.detectChanges();
}

  toggleAgentSection(agentIndex: number): void {
    event.stopPropagation();
    
    if (this.workflowThinkingLogs[agentIndex]) {
        this.workflowThinkingLogs[agentIndex].expanded = !this.workflowThinkingLogs[agentIndex].expanded;
        this.cdRef.detectChanges();
    }
}

  toggleLogItem(agentIndex: number, logIndex: number): void {
    event.stopPropagation();
    
    if (this.workflowThinkingLogs[agentIndex] && this.workflowThinkingLogs[agentIndex].logs[logIndex]) {
        this.workflowThinkingLogs[agentIndex].logs[logIndex].expanded = !this.workflowThinkingLogs[agentIndex].logs[logIndex].expanded;
        this.cdRef.detectChanges();
    }
}

  scrollToLatestLog(): void {
    if (this.isWorkflowrouted && this.mainContainer) {
        setTimeout(() => {
            // Target the steps-scroll-area container instead of chat-container
            const stepsContainer = this.mainContainer.nativeElement.querySelector('.steps-scroll-area');
            if (stepsContainer) {
                stepsContainer.scrollTo({
                    top: stepsContainer.scrollHeight,
                    behavior: 'smooth'
                });
            }
        }, 100); 
    }
}

    runWorkflowWithQuery_old(workflow_id: string, query: string): void {
    if (!this.eventTrackingUniqueId) {
      this.eventTrackingUniqueId = crypto.randomUUID();
    }

    const payload = {
      workflow_id,
      query,
      event_id: this.eventTrackingUniqueId
    };

    this.startLoading();
    this.IsWorkFlowLoad = true;
    this.LoadWorkflowDetails();

    const details = this.workflowDetails;
    const isExternal = details.IsExternal ?? false;

    // Prepare placeholder response row
    const loaderIdx = "";

    let socket: Socket | null = null;

    const nodeStartTimes: Record<string, number> = {};
    const elapsedTimeIntervals: Record<string, any> = {};

    // Only agent nodes get status tracking
    const nodeStatus: Record<string, { status: string; progress?: number; elapsedTime?: number }> = {};
    this.nodes.forEach(node => {
      // @ts-expect-error
      if (node?.agent_id?.trim()) {
        nodeStatus[node.id] = { status: 'Not Started' };
      }
    });
    this.nodeStatus = nodeStatus;

    let executableNodes = this.nodes.filter(n => n?.agent_id?.trim());
    let currentStepIndex = 0;
    let externalWorkflowCompleted = false;
    let internalWorkflowCompleted = false;

    const markNodeAsRunning = (nodeId: string) => {
      if (this.nodeStatus[nodeId]?.status === 'Running') return;

      nodeStartTimes[nodeId] = Date.now();

      this.ngZone.run(() => {
        this.nodeStatus[nodeId] = {
          status: 'Running',
          progress: 0,
          elapsedTime: 0
        };

        // @ts-expect-error
        const node = this.nodes.find(n => n.id === nodeId);
        
          // @ts-expect-error
        if(!isExternal){
          if (node?.agent_id) {
           this.jobMap.set(node.agent_id, { status: 'Running' });
          }
        }
        else{
          this.jobMap.set(node.id, { status: 'Running' });
        }

        this.updateCounts();
        this.cdRef.detectChanges();
      });

      elapsedTimeIntervals[nodeId] = setInterval(() => {
        if (this.nodeStatus[nodeId]?.status !== 'Running') return;

        const elapsedMs = Date.now() - nodeStartTimes[nodeId];
        const elapsedSec = Math.floor(elapsedMs / 1000);

        const ASSUMED_MAX = 15000;
        let progress = Math.min(100, Math.round((elapsedMs / ASSUMED_MAX) * 100));
        if (elapsedMs > ASSUMED_MAX - 100) progress = 99;

        this.ngZone.run(() => {
          this.nodeStatus = {
            ...this.nodeStatus,
            [nodeId]: {
              ...this.nodeStatus[nodeId],
              elapsedTime: elapsedSec,
              progress
            }
          };
          this.cdRef.detectChanges();
        });
      }, 120);
    };

    const finalizeNode = (nodeId: string) => {
      if (this.nodeStatus[nodeId]?.status !== 'Running') return;

      if (elapsedTimeIntervals[nodeId]) {
        clearInterval(elapsedTimeIntervals[nodeId]);
        delete elapsedTimeIntervals[nodeId];
      }

      const elapsedSec = Math.floor((Date.now() - nodeStartTimes[nodeId]) / 1000);

      this.ngZone.run(() => {
        this.nodeStatus[nodeId] = {
          status: 'Completed',
          progress: 100,
          elapsedTime: elapsedSec
        };

        this.agentDurations.push(elapsedSec);
        this.avgDuration = this.agentDurations.reduce((a, b) => a + b, 0) / this.agentDurations.length || 0;

        this.updateCounts();
        this.cdRef.detectChanges();
      });
    };

    const startNextAgent = () => {
      if (externalWorkflowCompleted || internalWorkflowCompleted) {
        
        if(isExternal){
          console.log('External workflow marked as completed');
        }
        else{
         console.log('All expected agents completed (non-external flow)');
        }

        if (socket) {
          socket.disconnect();
          socket = null;
        }

   
           this.ngZone.run(() => {

          function getSuffixNumber(id: string): number | null {
            const match = id.match(/_(\d+)$/i);
            return match ? Number(match[1]) : null;
          }

          const allNodes = this.getExecutionOrderNodes()
            .filter(node => {
              if (!node?.id) return false;
              const idLower = node.id.toLowerCase();
              return !idLower.includes("conditional") && !idLower.includes("api");
            });

          // ── Grouping ────────────────────────────────────────────────────────────
          const groups = new Map<number, {
            input?: typeof allNodes[number];
            unnumbered: typeof allNodes[number][];
            output?: typeof allNodes[number];
          }>();

          const leftoverUnnumbered: typeof allNodes[number][] = [];

          let lastSeenNumber: number | null = null;

          for (const node of allNodes) {
            const num = getSuffixNumber(node.id);
            const idLower = node.id.toLowerCase();

            if (num !== null) {
              // Numbered node → potential new group
              lastSeenNumber = num;

              if (!groups.has(num)) {
                groups.set(num, { unnumbered: [] });
              }
              const group = groups.get(num)!;

              if (idLower.startsWith("input_")) {
                if (group.input) {
                  console.warn(`Multiple inputs found for group ${num}`);
                }
                group.input = node;
              } else if (idLower.startsWith("output_")) {
                if (group.output) {
                  console.warn(`Multiple outputs found for group ${num}`);
                }
                group.output = node;
              }
              // → other numbered nodes are intentionally ignored
            }
            else {
              // Unnumbered node
              if (lastSeenNumber !== null) {
                // Attach to the most recently seen numbered group
                groups.get(lastSeenNumber)!.unnumbered.push(node);
              } else {
                // Before any numbered node appeared
                leftoverUnnumbered.push(node);
              }
            }
          }

          // ── Build final execution order ────────────────────────────────────────
          const orderedNodes: typeof allNodes[number][] = [];

          const sortedNumbers = [...groups.keys()].sort((a, b) => a - b);

          for (const num of sortedNumbers) {
            const group = groups.get(num)!;

            // 1. Input (if exists)
            if (group.input) {
              orderedNodes.push(group.input);
            }

            // 2. Unnumbered nodes attached to this group
            if (group.unnumbered.length > 0) {
              orderedNodes.push(...group.unnumbered);
            }

            // 3. Output (if exists)
            if (group.output) {
              orderedNodes.push(group.output);
            }
          }

          // Any unnumbered nodes that appeared before the first numbered group
          // (usually go at the end, but you can move them to the beginning if preferred)
          orderedNodes.push(...leftoverUnnumbered);

            // Now process in the desired order
            for (const node of orderedNodes) {
				
				if (!isExternal && (!node.agent_response || node.agent_response.length === 0)) {
                  continue;
                }
              this.workflowfinalResponse(node, this.chatResponses.length, isExternal);
            }
          this.activeTab = 'output';
          this.isWorkEnd = false;
          this.isActive = !this.isActive;
          this.cdRef.detectChanges();
        });
        return;
      }

      const currentNode = executableNodes[currentStepIndex];

      if (!isExternal) {
        // Normal flow: optimistic start
        console.log(`▶ Starting agent (optimistic) → ${currentNode.agent_id}`);
      } else {
        // External flow: wait for real 'started' event
        console.log(`▶ Waiting for 'started' → expecting agent: ${currentNode.agent_id} / node ${currentNode.id}`);
        // DO NOT increment index here — wait for real start
      }
    };

    this._homeService.runWorkflow(payload).subscribe({
      next: (res: any) => {
        console.log('Workflow accepted by backend', res);

        socket = io(this.baseURL, {
          path: this.websocketPath,
          transports: ['polling', 'websocket']
        });

        socket.on('connect', () => {
          console.log('Socket connected');
          startNextAgent(); // for non-external → starts first agent immediately
        });

        socket.onAny((eventName, data) => {
          console.log(`ws ← ${eventName}`, data);

          // External workflow final completion marker
          if (isExternal && data.agent_name === "Workflow" && data?.status?.toLowerCase() === 'completed') {
            externalWorkflowCompleted = true;
            startNextAgent(); // will trigger final response path
            return;
          }
          
          // Internal workflow final completion marker
          if (!isExternal && data.agent_name === "CustomWorkflow" && data?.status?.toLowerCase() === 'completed') {
            internalWorkflowCompleted = true;
            startNextAgent(); // will trigger final response path
            return;
          }

          const agentIdentifier = isExternal ? data.agent_name : data?.agent_id;
          if (!agentIdentifier) return;

          const node = executableNodes.find(n =>
            isExternal ? n.id === agentIdentifier : n.agent_id === agentIdentifier
          );

          if (!node) return;

          const nodeId = node.id;

          // ─── External flow: wait for real "started" ───
          if (data?.status?.toLowerCase() === 'started') {
            markNodeAsRunning(nodeId);
            console.log(`→ Real start confirmed for ${agentIdentifier}`);

            // Now we can move to next expected agent
            currentStepIndex++;
            startNextAgent();
            return;
          }

          // Completion (both flows)
          if (
            data?.status?.toLowerCase() === 'completed' ||
            data?.status?.toLowerCase() === 'done' ||
            data?.agent_response
          ) {
            finalizeNode(nodeId);

            this.ngZone.run(() => {
              this.updateNodeInArray(nodeId, { agent_response: data }, isExternal);
              this.jobMap.set(agentIdentifier, data);
              this.updateCounts();
              this.cdRef.detectChanges();
            });

            console.log(`✓ Completed: ${agentIdentifier}`);

            // External → next is triggered only on next 'started'
          }
        });

        socket.on('disconnect', () => {
          console.log('Socket disconnected');
          Object.values(elapsedTimeIntervals).forEach(clearInterval);
        });
      },
      error: err => {
        this.handleWorkflowError(loaderIdx, err);
      }
    });
}

    runWorkflowWithQuery(workflow_id: string, query: string): void {
    if (!this.eventTrackingUniqueId) {
      this.eventTrackingUniqueId = crypto.randomUUID();
    }

    this.isWorkflowReviewMode = false;
    this.chatResponses = [];
    this.explanationDataRetrieved.clear();
    this.isLoadingExplanationData = false;
    this.workflowIdFromState = workflow_id;
    this.eventTrackingUniqueId = crypto.randomUUID();
  
    // Reset logs at the start
    this.logsDuringWorkflowLoading = [];
    this.hasWorkflowLogs = false;
    this.workflowThinkingLogs = [];
    this.workflowAllLogsLoaded = false;
    this.isWorkflowThinkingLoading = false; // Start with false
    this.isWorkflowThinkingCollapsed = false;
    this.showThinking = false;
    this.workflowCompleted = false;

    this.isWorkflowThinkingLoading = true;
    this.isWorkflowThinkingCollapsed = false;
    this.showThinking = true;
    this.workflowCompleted = false;

    const payload = {
      workflow_id,
      query,
      event_id: this.eventTrackingUniqueId
    };

    this.startLoading();
    this.IsWorkFlowLoad = true;
    this.LoadWorkflowDetails();

    const details = this.workflowDetails;
    const isExternal = details.IsExternal ?? false;

    // Prepare placeholder response row
    const loaderIdx = "";

    let socket: Socket | null = null;

    const nodeStartTimes: Record<string, number> = {};
    const elapsedTimeIntervals: Record<string, any> = {};

    // Only agent nodes get status tracking
    const nodeStatus: Record<string, { status: string; progress?: number; elapsedTime?: number }> = {};
    this.nodes.forEach(node => {
      // @ts-expect-error
      if (node?.agent_id?.trim()) {
        nodeStatus[node.id] = { status: 'Not Started' };
      }
    });
    this.nodeStatus = nodeStatus;

    let executableNodes = this.nodes.filter(n => n?.agent_id?.trim());
    let currentStepIndex = 0;
    let externalWorkflowCompleted = false;
    let internalWorkflowCompleted = false;

    const markNodeAsRunning = (nodeId: string) => {
      if (this.nodeStatus[nodeId]?.status === 'Running') return;

      nodeStartTimes[nodeId] = Date.now();

      this.ngZone.run(() => {
        this.nodeStatus[nodeId] = {
          status: 'Running',
          progress: 0,
          elapsedTime: 0
        };

        // @ts-expect-error
        const node = this.nodes.find(n => n.id === nodeId);
        
          // @ts-expect-error
        if(!isExternal){
          if (node?.agent_id) {
           this.jobMap.set(node.agent_id, { status: 'Running' });
          }
        }
        else{
          this.jobMap.set(node.id, { status: 'Running' });
        }

        this.updateCounts();
        this.cdRef.detectChanges();
      });

      elapsedTimeIntervals[nodeId] = setInterval(() => {
        if (this.nodeStatus[nodeId]?.status !== 'Running') return;

        const elapsedMs = Date.now() - nodeStartTimes[nodeId];
        const elapsedSec = Math.floor(elapsedMs / 1000);

        const ASSUMED_MAX = 15000;
        let progress = Math.min(100, Math.round((elapsedMs / ASSUMED_MAX) * 100));
        if (elapsedMs > ASSUMED_MAX - 100) progress = 99;

        this.ngZone.run(() => {
          this.nodeStatus = {
            ...this.nodeStatus,
            [nodeId]: {
              ...this.nodeStatus[nodeId],
              elapsedTime: elapsedSec,
              progress
            }
          };
          this.cdRef.detectChanges();
        });
      }, 120);
    };

    const finalizeNode = (nodeId: string) => {
      if (this.nodeStatus[nodeId]?.status !== 'Running') return;

      if (elapsedTimeIntervals[nodeId]) {
        clearInterval(elapsedTimeIntervals[nodeId]);
        delete elapsedTimeIntervals[nodeId];
      }

      const elapsedSec = Math.floor((Date.now() - nodeStartTimes[nodeId]) / 1000);

      this.ngZone.run(() => {
        this.nodeStatus[nodeId] = {
          status: 'Completed',
          progress: 100,
          elapsedTime: elapsedSec
        };

        this.agentDurations.push(elapsedSec);
        this.avgDuration = this.agentDurations.reduce((a, b) => a + b, 0) / this.agentDurations.length || 0;

        this.updateCounts();
        this.cdRef.detectChanges();
      });
    };

    const startNextAgent = () => {
      if (externalWorkflowCompleted || internalWorkflowCompleted) {
        
        if(isExternal){
          console.log('External workflow marked as completed');
        }
        else{
         console.log('All expected agents completed (non-external flow)');
        }

        if (socket) {
          socket.disconnect();
          socket = null;
        }

   
           this.ngZone.run(() => {

          function getSuffixNumber(id: string): number | null {
            const match = id.match(/_(\d+)$/i);
            return match ? Number(match[1]) : null;
          }

          const allNodes = this.getExecutionOrderNodes()
            .filter(node => {
              if (!node?.id) return false;
              const idLower = node.id.toLowerCase();
              return !idLower.includes("conditional") && !idLower.includes("api");
            });

          // ── Grouping ────────────────────────────────────────────────────────────
          const groups = new Map<number, {
            input?: typeof allNodes[number];
            unnumbered: typeof allNodes[number][];
            output?: typeof allNodes[number];
          }>();

          const leftoverUnnumbered: typeof allNodes[number][] = [];

          let lastSeenNumber: number | null = null;

          for (const node of allNodes) {
            const num = getSuffixNumber(node.id);
            const idLower = node.id.toLowerCase();

            if (num !== null) {
              // Numbered node → potential new group
              lastSeenNumber = num;

              if (!groups.has(num)) {
                groups.set(num, { unnumbered: [] });
              }
              const group = groups.get(num)!;

              if (idLower.startsWith("input_")) {
                if (group.input) {
                  console.warn(`Multiple inputs found for group ${num}`);
                }
                group.input = node;
              } else if (idLower.startsWith("output_")) {
                if (group.output) {
                  console.warn(`Multiple outputs found for group ${num}`);
                }
                group.output = node;
              }
              // → other numbered nodes are intentionally ignored
            }
            else {
              // Unnumbered node
              if (lastSeenNumber !== null) {
                // Attach to the most recently seen numbered group
                groups.get(lastSeenNumber)!.unnumbered.push(node);
              } else {
                // Before any numbered node appeared
                leftoverUnnumbered.push(node);
              }
            }
          }

          // ── Build final execution order ────────────────────────────────────────
          const orderedNodes: typeof allNodes[number][] = [];

          const sortedNumbers = [...groups.keys()].sort((a, b) => a - b);

          for (const num of sortedNumbers) {
            const group = groups.get(num)!;

            // 1. Input (if exists)
            if (group.input) {
              orderedNodes.push(group.input);
            }

            // 2. Unnumbered nodes attached to this group
            if (group.unnumbered.length > 0) {
              orderedNodes.push(...group.unnumbered);
            }

            // 3. Output (if exists)
            if (group.output) {
              orderedNodes.push(group.output);
            }
          }

          // Any unnumbered nodes that appeared before the first numbered group
          // (usually go at the end, but you can move them to the beginning if preferred)
          orderedNodes.push(...leftoverUnnumbered);

            // Now process in the desired order
            for (const node of orderedNodes) {
				
				if (!isExternal && (!node.agent_response || node.agent_response.length === 0)) {
                  continue;
                }
				
               const inputsArray = Array.isArray(this.agent_inputs) ? this.agent_inputs : Object.entries(this.agent_inputs || {}).map(([key, value]) => ({ key, value }));

              const matchedInput = inputsArray.find((input: any) => input.key === node.id);

              const agent_input_desc = matchedInput?.value || ''; 

              console.log(`Key: ${node.id}, Value: ${agent_input_desc}`);

            this.workflowfinalResponse(node,agent_input_desc, this.chatResponses.length, isExternal);
            }
          this.activeTab = 'output';
          this.isWorkEnd = false;
          this.isActive = !this.isActive;
          this.cdRef.detectChanges();
        });
        return;
      }

      const currentNode = executableNodes[currentStepIndex];

      if (!isExternal) {
        // Normal flow: optimistic start
        console.log(`▶ Starting agent (optimistic) → ${currentNode.agent_id}`);
      } else {
        // External flow: wait for real 'started' event
        console.log(`▶ Waiting for 'started' → expecting agent: ${currentNode.agent_id} / node ${currentNode.id}`);
        // DO NOT increment index here — wait for real start
      }
    };

    this._homeService.runWorkflow(payload).subscribe({
      next: (res: any) => {
        console.log('Workflow accepted by backend', res);

        socket = io(this.baseURL, {
          path: this.websocketPath,
          transports: ['polling', 'websocket']
        });

        socket.on('connect', () => {
          console.log('Socket connected');
          startNextAgent(); // for non-external → starts first agent immediately
        });

socket.onAny((eventName, data) => {
    console.log(`Socket event received: ${eventName}`, data);
    
    // Capture log data - check for both 'log' property and nested log structure
    if (data.log && typeof data.log === 'object') {
        console.log('Log data detected:', data.log);
        
        // SET FLAGS IMMEDIATELY WHEN FIRST LOG ARRIVES
        if (!this.hasWorkflowLogs) {
            this.hasWorkflowLogs = true;
            this.isWorkflowThinkingLoading = true;
            this.showThinking = true;
            console.log(' First log arrived - setting loading flags');
        }
        
        // Create log entry with agent name
        const logEntry = this.createLogStep(data.log, data.agent_name);
        this.logsDuringWorkflowLoading.push(logEntry);
        this.cdRef.detectChanges();
        this.scrollToLatestLog();
    }
    
    // Also check for real_time_logs
    if (data.real_time_logs) {
        console.log('Real-time logs detected:', data.real_time_logs);
        
        // SET FLAGS IMMEDIATELY WHEN FIRST LOG ARRIVES
        if (!this.hasWorkflowLogs) {
            this.hasWorkflowLogs = true;
            this.isWorkflowThinkingLoading = true;
            this.showThinking = true;
            console.log('First real-time log arrived - setting loading flags');
        }
        
        // Process real_time_logs
        if (Array.isArray(data.real_time_logs)) {
            data.real_time_logs.forEach(log => {
                const logEntry = this.createLogStep(log, data.agent_name);
                this.logsDuringWorkflowLoading.push(logEntry);
            });
        }
        this.cdRef.detectChanges();
        this.scrollToLatestLog();
    }
        // Handle workflow completion
        if (isExternal && data.agent_name === "Workflow" && data?.status?.toLowerCase() === 'completed') {
            externalWorkflowCompleted = true;
            this.workflowCompleted = true;
            
            // Now that workflow is complete, prepare thinking logs
            this.prepareWorkflowThinkingLogs();
            startNextAgent();
            return;
        }
        
        // Handle internal workflow completion
        if (!isExternal && data.agent_name === "CustomWorkflow" && data?.status?.toLowerCase() === 'completed') {
            internalWorkflowCompleted = true;
            this.workflowCompleted = true;
            
            // Now that workflow is complete, prepare thinking logs
            this.prepareWorkflowThinkingLogs();
            startNextAgent();
            return;
        }
          const agentIdentifier = isExternal ? data.agent_name : data?.agent_id;
          if (!agentIdentifier) return;

          const node = executableNodes.find(n =>
            isExternal ? n.id === agentIdentifier : n.agent_id === agentIdentifier
          );

          if (!node) return;

          const nodeId = node.id;

          // ─── External flow: wait for real "started" ───
          if (data?.status?.toLowerCase() === 'started') {
            markNodeAsRunning(nodeId);
            console.log(`→ Real start confirmed for ${agentIdentifier}`);

            // Now we can move to next expected agent
            currentStepIndex++;
            startNextAgent();
            return;
          }

          // Completion (both flows)
          if (
            data?.status?.toLowerCase() === 'completed' ||
            data?.status?.toLowerCase() === 'done' ||
            data?.agent_response
          ) {
			this.agent_inputs = data.agent_inputs;
            finalizeNode(nodeId);

            this.ngZone.run(() => {
              this.updateNodeInArray(nodeId, { agent_response: data }, isExternal);
              this.jobMap.set(agentIdentifier, data);
              this.updateCounts();
              this.cdRef.detectChanges();
            });

            console.log(`✓ Completed: ${agentIdentifier}`);

            // External → next is triggered only on next 'started'
          }
        });

        socket.on('disconnect', () => {
          console.log('Socket disconnected');
          Object.values(elapsedTimeIntervals).forEach(clearInterval);
        });
      },
      error: err => {
        this.handleWorkflowError(loaderIdx, err);
      }
    });
}


  workflowfinalResponse_old(res: any, loaderIdx: number, IsExternal: boolean): void {
  console.log("RUN WORKFLOW RES:", res);

  let responseResults = IsExternal ? res.agent_response : res.agent_response.response;

  // Process initial results if available
  if (res && res.agent_response && (IsExternal ? res.agent_response?.length > 0 : res.agent_response?.response?.length > 0)) {
    console.log("Processing initial results:", IsExternal ? res.agent_response : res.agent_response?.response);

    // Set expected count
    this.expectedResultCount = IsExternal ? res.agent_response.length : res.agent_response.response.length;
    console.log("Expected result count:", this.expectedResultCount);

    // Process each result
    const mappedResult = {
      result: responseResults || "",
      issue_key: responseResults.issue_key || responseResults.key || `Event ${this.eventTrackingUniqueId}`,
      explanation: responseResults.explanation || 'No data available',
      thinking: responseResults.thinking || 'No data available',
      nodeId: res.id // Use the actual node ID from the workflow
    };

    console.log("Mapped result with nodeId:", mappedResult.nodeId);

    // Process this individual result
    this.processIndividualWorkflowResult(mappedResult, loaderIdx, true);
    // Mark initial results as processed
    this.initialResultsProcessed = true;

    // Check if we've already received all results
    if (this.processedResultIds.size >= this.expectedResultCount) {
      console.log("All results already received, stopping polling");
    }
  }

  // Handle case where response is successful but empty
  if (res && !responseResults && !res.error) {
    console.log("Empty response received, stopping polling");
    this.handleWorkflowError(loaderIdx, { error: "No results returned from workflow" });
  }
}

workflowfinalResponse(res: any,agent_input_desc: string, loaderIdx: number, IsExternal: boolean): void {
  console.log("RUN WORKFLOW RES:", res);

  let responseResults = IsExternal ? res.agent_response : res.agent_response.prompt_output;

  // Process initial results if available
  if (res && res.agent_response && (IsExternal ? res.agent_response?.length > 0 : res.agent_response?.prompt_output?.length > 0)) {
    console.log("Processing initial results:", IsExternal ? res.agent_response : res.agent_response?.prompt_output);

    // Set expected count
    this.expectedResultCount = IsExternal ? res.agent_response.length : res.agent_response.prompt_output.length;
    console.log("Expected result count:", this.expectedResultCount);

    // Process each result
    const mappedResult = {
      result: responseResults || "",
      issue_key: responseResults.issue_key || responseResults.key || `Event ${this.eventTrackingUniqueId}`,
      explanation: responseResults.explanation || 'No data available',
      thinking: responseResults.thinking || 'No data available',
      nodeId: res.id, // Use the actual node ID from the workflow
      agent_id: res.agent_id, // Add agent_id
      agent_name: res.agent_name, // Add agent_name
      agent_response: res.agent_response, // Pass the full agent_response object
      agent_input_desc: agent_input_desc // Pass the agent input description
    };

    console.log("Mapped result with nodeId:", mappedResult.nodeId, "agent_id:", mappedResult.agent_id, "agent_name:", mappedResult.agent_name);

    // Process this individual result
    this.processIndividualWorkflowResult(mappedResult, loaderIdx, true);
    // Mark initial results as processed
    this.initialResultsProcessed = true;

    // Check if we've already received all results
    if (this.processedResultIds.size >= this.expectedResultCount) {
      console.log("All results already received, stopping polling");
    }
  }

  // Handle case where response is successful but empty
  if (res && !responseResults && !res.error) {
    console.log("Empty response received, stopping polling");
    this.handleWorkflowError(loaderIdx, { error: "No results returned from workflow" });
  }
}
  private updateNodeInArray(nodeId: string, updates: any,IsExternal:boolean): void {
    const nodeIndex = this.nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex >= 0) {
      this.nodes[nodeIndex] = {
        ...this.nodes[nodeIndex],
          // @ts-expect-error agent_response missing type definition
        agent_response: IsExternal ? updates.agent_response.agent_response : updates.agent_response,
        elapsedTime: updates.elapsedTime
      };
    }
  }

  private updateNodeInArrayWFReview(nodeId: string, updates: any,IsExternal:boolean): void {
    const nodeIndex = this.nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex >= 0) {
      this.nodes[nodeIndex] = {
        ...this.nodes[nodeIndex],
          // @ts-expect-error agent_response missing type definition
        agent_response: updates.agent_response,
        elapsedTime: updates.elapsedTime
      };
    }
  }
 

  private updateCounts() {
    let running = 0;
    let completed = 0;
    let failed = 0;

	console.log("C-Start",this.jobMap);

    this.jobMap.forEach(job => {
      const status = job.status?.toLowerCase();
      if (status === 'running') running++;
      else if (status === 'completed') completed++;
      else if (status === 'failed') failed++;
    });
	console.log("C-End",this.jobMap);

    this.runningCount = running;
    this.completedCount = completed;
    this.failedCount = failed;
    this.cdRef.detectChanges();
	console.log("RunningCount",this.runningCount);
	console.log("CompletedCount",this.completedCount);
	console.log("FailedCount",this.failedCount);
	
  }

  stopPollingForWorkflowResults(): void {
    if (this.workflowPollingSubscription) {
      this.workflowPollingSubscription.unsubscribe();
      this.workflowPollingSubscription = null;
    }
    // Set global loading state to false when polling stops
    this.isWorkflowLoading = false;
  }

  handleWorkflowError(loaderIdx: number, err: any): void {
    this.stopPollingForWorkflowResults(); // This will set isWorkflowLoading to false
    this.stopLoading(() => {
      this.chatResponses[loaderIdx] = {
        html: '<div class="chat-line error">Workflow failed.</div>',
        plain: 'Workflow failed.',
        json: { error: true, message: err?.error?.message },
        table: { headers: [], rows: [] },
        title: 'Error',
        explanation: err?.error?.message || 'Workflow failed',
        thinking: 'No data available'
      };
      this.showThinking = true;
      this.scrollToBottom();
      this.cdRef.detectChanges();
    });
  }

processIndividualWorkflowResult_old(result: any, loaderIdx: number, isWorflowRun: boolean): void {
  console.log("Processing individual workflow result:", result);
  if (!this.firstResponseLoaded) {
    this.firstResponseLoaded = true;
  }
  
  const fmt = this.formatWorkflowResponse(result.result || "");

  let issueKey = this.extractTitleFromResponse(result.result || "");
  let issueKeyDtls = !isWorflowRun ? result.issue_key || `Event ${this.eventTrackingUniqueId}` : issueKey;
  
  let nodeId = null;
  let agentId = null;
  let agentName = null;
  
  // Extract user_query and response from agent_response
  let user_query = '';
  let response = '';
  
  if (result.agent_response) {
    if (Array.isArray(result.agent_response)) {
      // Handle array response
      const firstElement = result.agent_response[0];
      user_query = firstElement ? (typeof firstElement.user_query === 'object' 
        ? JSON.stringify(firstElement.user_query, null, 2) 
        : firstElement.user_query) : '';
      response = firstElement ? firstElement.response : '';
    } else {
      // Handle object response
      user_query = result.agent_response.user_query ? (typeof result.agent_response.user_query === 'object' 
        ? JSON.stringify(result.agent_response.user_query, null, 2) 
        : result.agent_response.user_query) : '';
      response = result.agent_response.response || '';
    }
  }
  
  if (isWorflowRun) {
    nodeId = result.nodeId || result.key || result.issue_key;
    
    // For internal workflows, extract agent_id and agent_name from the agent_response
    if (result.agent_response && typeof result.agent_response === 'object') {
      agentId = result.agent_response.agent_id;
      agentName = result.agent_response.agent_name;
      console.log("Extracted agent data:", agentId, agentName);
    }
    
    // If still null, try to extract from the original result object
    if (!agentId && !agentName) {
      agentId = result.agent_id;
      agentName = result.agent_name;
      console.log("Extracted agent data from result:", agentId, agentName);
    }
    
    console.log("Using nodeId from workflow node:", nodeId);
    console.log("Agent ID:", agentId, "Agent Name:", agentName);
  } else {
    // For regular chat, create a hash from the content
    if (result.result && typeof result.result === 'string') {
      nodeId = 'node_' + this.hashCode(result.result.substring(0, 50));
    }
  }
  
  // Create a response object with enhanced fields
  const responseObj = {
    title: issueKeyDtls,
    html: fmt.html,
    plain: fmt.plain,
    json: fmt.json,
    table: fmt.table,
    explanation: result.explanation || 'No data available',
    thinking: result.thinking || 'No data available',
    traceDetails: null, 
    logDetails: [], 
    chatMessages: [], 
    showChatMessages: false,
    showChatMessagesTab: false,
    activeTab: 'trace', 
    nodeId: nodeId, 
    agentId: agentId, // Add agentId for internal workflows
    agentName: agentName, // Add agentName for internal workflows
    content: result.result, 
    isLoading: false,
    user_query: user_query, 
    response: response     
  };

  // Update the UI
  this.stopLoading(() => {
    console.log("Adding new response with nodeId:", nodeId, "agentId:", agentId, "agentName:", agentName);
    this.chatResponses.push(responseObj);
    this.showThinking = true;
    this.scrollToBottom();
    this.cdRef.detectChanges();
  });
}

processIndividualWorkflowResult(result: any, loaderIdx: number, isWorflowRun: boolean): void {
  console.log("Processing individual workflow result:", result);
  if (!this.firstResponseLoaded) {
    this.firstResponseLoaded = true;
  }
  
  // Normalize the result - handle different data formats
  let content = '';
  
  if (result.result) {
    content = result.result;
  } else if (result.response) {
    content = result.response;
  } else if (result.agent_response) {
    // Handle when agent_response is an object with response property
    if (typeof result.agent_response === 'object') {
      content = result.agent_response.response || JSON.stringify(result.agent_response, null, 2);
    } else {
      content = result.agent_response;
    }
  } else if (result.content) {
    content = result.content;
  } else {
    content = JSON.stringify(result, null, 2);
  }
  
  const fmt = this.formatWorkflowResponse(content);

  let issueKey = this.extractTitleFromResponse(content);
  let issueKeyDtls = !isWorflowRun ? result.issue_key || `Event ${this.eventTrackingUniqueId}` : issueKey;
  
  let nodeId = null;
  let agentId = null;
  let agentName = null;
  
  // Extract user_query and response from agent_response
  let user_query = '';
  let responseContent = '';
  
  if (result.agent_response) {
    if (typeof result.agent_response === 'object') {
      // Handle object response
      user_query = result.agent_response.user_query ? 
        (typeof result.agent_response.user_query === 'object' 
          ? JSON.stringify(result.agent_response.user_query, null, 2) 
          : result.agent_response.user_query) : '';
		  if(user_query==''){
		user_query = result.agent_input_desc;
		  }
      responseContent = result.agent_response.response || '';
    } else {
		user_query = result.agent_input_desc;
      responseContent = result.agent_response;
    }
  } else if (result.user_query) {
    user_query = typeof result.user_query === 'object' 
      ? JSON.stringify(result.user_query, null, 2) 
      : result.user_query;
	    if(user_query==''){
		user_query = result.agent_input_desc;
		  }
  }
  
  if (isWorflowRun) {
    nodeId = result.nodeId || result.key || result.issue_key;
    
    // For internal workflows, extract agent_id and agent_name from the agent_response
    if (result.agent_response && typeof result.agent_response === 'object') {
      agentId = result.agent_response.agent_id;
      agentName = result.agent_response.agent_name;
      console.log("Extracted agent data:", agentId, agentName);
    }
    
    // If still null, try to extract from the original result object
    if (!agentId && !agentName) {
      agentId = result.agent_id;
      agentName = result.agent_name;
      console.log("Extracted agent data from result:", agentId, agentName);
    }
    
    console.log("Using nodeId from workflow node:", nodeId);
    console.log("Agent ID:", agentId, "Agent Name:", agentName);
  } else {
    // For regular chat, create a hash from the content
    if (content && typeof content === 'string') {
      nodeId = 'node_' + this.hashCode(content.substring(0, 50));
    }
  }
  
  const responseObj = {
    title: issueKeyDtls,
    html: fmt.html,
    plain: fmt.plain,
    json: fmt.json,
    table: fmt.table, 
    tables: fmt.tables,
    explanation: content || 'No data available',
    thinking: result.thinking || 'No data available',
    traceDetails: null, 
    logDetails: [], 
    chatMessages: [], 
    showChatMessages: false,
    showChatMessagesTab: false,
    activeTab: 'trace', 
    nodeId: nodeId, 
    agentId: agentId,
    agentName: agentName,
    content: content, 
    isLoading: false,
    user_query: user_query, 
    response: responseContent,
    serializedBddJson: fmt.serializedBddJson     
  };

  // Debug: Log the table data
  console.log("Table data being set:", fmt.table);
  console.log("Table headers:", fmt.table?.headers);
  console.log("Table rows:", fmt.table?.rows);

  // Update the UI
  this.stopLoading(() => {
    console.log("Adding new response with nodeId:", nodeId, "agentId:", agentId, "agentName:", agentName);
    this.chatResponses.push(responseObj);
    this.showThinking = true;
    this.scrollToBottom();
    this.cdRef.detectChanges();
  });
}


  wrapResult(result: string): string {
    // Default fallback title
    let issueKey = 'Workflow Result';

    if (result) {
      const lines = result.split('\n');
      let title = 'Untitled';

      // 1. Look for Markdown headings: #, ##, ###
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('# ')) {
          title = trimmed.substring(2).trim();
          break;
        } else if (trimmed.startsWith('## ')) {
          title = trimmed.substring(3).trim();
          break;
        } else if (trimmed.startsWith('### ')) {
          title = trimmed.substring(4).trim();
          break;
        }
      }

      // 2. If no heading found, use first non-empty line (max 50 chars)
      if (title === 'Untitled') {
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            title = trimmed.substring(0, 50);
            break;
          }
        }
      }

      // 3. Only override issueKey if we found something meaningful
      if (title !== 'Untitled' && title.trim()) {
        issueKey = title.trim();
      }
    }

    return issueKey;
  }
  
  refreshRecentData() {
  if (this.selectedAgent && this.isChatSubmitted) {
    console.log('Loading recent data for agent:', this.selectedAgent.agent_id);
    this.loadRecentData(this.selectedAgent.agent_id);
  } else {
    console.log('Loading all recent data');
    this.loadRecentData();
  }
}

getRecentchat(agent: any, IsSuggestionQuery: boolean) {
    console.log('getRecentchat called with:', {
    master_agent_id: agent.master_agent_id,
    master_agent_name: agent.master_agent_name,
    agent_id: agent.agent_id,
    name: agent.name
  });

  console.log("test",agent)

  // Try to find Master Agent first
  let mainAgent = this.masterAgents.find(ma =>
    ma.agent_id === agent.master_agent_id ||
    ma.name?.trim().toLowerCase() === (agent.master_agent_name || '').trim().toLowerCase()
  );

  // If Master Agent not found, fallback to Task Agent
  if (!mainAgent) {
    mainAgent = this.masterAgents.find(ma =>
      ma.agent_id === agent.agent_id ||
      ma.name?.trim().toLowerCase() === (agent.name || '').trim().toLowerCase()
    );
  }

  // Ultimate fallback
  if (!mainAgent) {
    console.warn('No agent found in masterAgents. Using payload as fallback.');
    mainAgent = {
      agent_id: agent.master_agent_id || agent.agent_id,
      name: agent.master_agent_name || agent.name,
      master_agent_id: agent.master_agent_id,
      master_agent_name: agent.master_agent_name
    };
  }

  console.log('Using Main Agent:', mainAgent.name);


    if (!IsSuggestionQuery) {
      // Initialize the chat with the main agent (similar to startAgentChat)
      this.isSidebarExpanded = false;
      this.isNewChatOpen = true;
      this.selectedAgent = mainAgent;
      this.isChatSubmitted = true;
      this.showWelcomePanel = true;
      this.latestUserQuery = '';

      this.chatResponses = [];
      this.chatMessages = [];

      this.selectedAgentOption = null;
      this.secondaryAgents = [];
      this.isSuggestionLoading = false;
      this.resetSelectedQueries();
      this.showThinking = false;
      this.isLoading = false;
      this.currentLoaderStep = 0;
      this.isChatOpenedByAgent = true;
      this.resetFeedbackState();
    }
    // Fetch secondary agents for the main agent
    const payload = { agent_id: mainAgent.agent_id };
    this._marketService.GetAgentAndOrder2Agents(payload).subscribe({
      next: (res) => {
        if (res?.success) {
          this.secondaryAgents = res.data.order_2_agents || [];

          if (!IsSuggestionQuery) {
            // Load recent data for this specific master agent
            this.loadRecentData(mainAgent.agent_id);
          }


          this.cdRef.detectChanges();

          // Now set up the specific agent option from the recent chat
          this.setupRecentChatQuery(agent, IsSuggestionQuery);
        } else {


          // Still try to load recent data even if secondary agents fail
          if (!IsSuggestionQuery) {
            this.loadRecentData(mainAgent.agent_id);
          }

          this.setupRecentChatQuery(agent, IsSuggestionQuery);
        }
      },
      error: (err) => {
        const error = getApiError(err)
        if (error) {
          console.warn('API did not return expected structure', error);
        } else {
          console.error('Failed to fetch agent details:', err);
        }

        // Still try to load recent data even if API fails
        if (!IsSuggestionQuery) {
          this.loadRecentData(mainAgent.agent_id);
        }

        this.setupRecentChatQuery(agent, IsSuggestionQuery);
      }
    });
  }

getPromptOutput(agent: {
   name: string, 
   agent_id: string, 
   user_query: string, 
   prompt_output: string |  Record<'response', string>
}) {
  
  if (!agent?.prompt_output)  return 'no content';

  if (typeof agent.prompt_output === 'string') 
    return agent.prompt_output;
    
  if(agent.prompt_output?.response && typeof agent.prompt_output.response === 'string') 
      return agent.prompt_output.response;
    
   return 'Unable to display response';
}

 setupRecentChatQuery(agent: {
    name: string,
    agent_id: string,
    user_query: string,
    prompt_output: string | Record<'response', string>
    trace_info?: any,
    agent_traces?: any[],
    real_time_logs?: any[]
  }, IsSuggestionQuery: boolean) {
    // Set the selected agent option
    this.isRecentChat = true;
    this.selectedAgentOption = agent.name;
    this.secondryAgentId = agent.agent_id;
    this.showAgentPrompt = true;


    // ==================== IMPROVED AGENCY ID RESOLUTION ====================
  let resolvedAgencyId = agent.agency_id || '';

  console.log("Resolving agency_id for agent:", agent.agent_id, "| master_agent_id:", agent.master_agent_id);

  if (!resolvedAgencyId && this.agenciesWithAgents?.length > 0) {
    const searchIds = [
      agent.agent_id,
      agent.master_agent_id,
      agent.agent_id || agent.master_agent_id
    ].filter(Boolean);

    console.log("Searching with IDs:", searchIds);

    const foundAgency = this.agenciesWithAgents.find((agency: any) =>
      agency.agents?.some((a: any) => 
        searchIds.includes(a.agent_id) || 
        searchIds.includes(a.master_agent_id)
      )
    );

    if (foundAgency) {
      resolvedAgencyId = foundAgency.agency_id || foundAgency._id || '';
      console.log(`Successfully resolved agency_id: ${resolvedAgencyId} for agent ${agent.name}`);
    } else {
      console.warn(`Could not resolve agency_id for agent. Searched IDs:`, searchIds);
      // Fallback: Try partial name match
      const fallbackAgency = this.agenciesWithAgents.find((agency: any) =>
        agency.agents?.some((a: any) => 
          a.name?.toLowerCase() === agent.name?.toLowerCase() ||
          a.name?.toLowerCase() === agent.master_agent_name?.toLowerCase()
        )
      );
      if (fallbackAgency) {
        resolvedAgencyId = fallbackAgency.agency_id;
        console.log(`Fallback resolution successful: ${resolvedAgencyId}`);
      }
    }
  }

    if (!IsSuggestionQuery) {
      // Clear previous chat state
      this.chatMessages = [];
      this.chatResponses = [];
    }

    // Rebuild chat messages
    if (!IsSuggestionQuery) {
      this.chatMessages.push({ from: 'user', text: agent.name });

      this.chatMessages.push({
        from: 'agent',
        text: `Great! To generate ${agent.name}, I'll need your input. Please share them with me.`
      });
    }
      this.chatMessages.push({ from: 'user', text: agent.user_query });

      // === HANDLE PROMPT_OUTPUT ===
      let promptOutput = this.getPromptOutput(agent);
      try {
        const checkJson = JSON.parse(promptOutput) as string | { response: string };
        if (typeof checkJson === 'object') promptOutput = checkJson.response || '';
      } catch (e) {
        console.log('not json content');
      }

      // Process escaped newlines
      let processedText = promptOutput
        .replace(/\\\\/g, '\\')
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\r\n|\r/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      // =================================================================
      // CRITICAL: AGGRESSIVELY CLEAN PSV BLOCK BEFORE RENDERING
      // =================================================================
      const cleanedText = processedText
        .replace(/```psv[\s\S]*?```/gi, '')
        .replace(/```\s*psv[\s\S]*?```/gi, '')
        .replace(/\n\s*\n\s*\n\s*\n/g, '\n\n')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();

      // Use cleaned text for markdown rendering

      const textForMarkdown = repairTableStructure(cleanedText);

      // 1. Try to extract standard markdown tables
      let markdownTables = extractMarkdownTables(textForMarkdown);
      let finalTables = markdownTables;

      // 2. Fallback: Use formatResponse for structured content (including PSV table)
      let finalFormatted = this.formatResponse(processedText); // Pass original for better table detection
      if (finalTables.length === 0 && finalFormatted.table.headers.length > 0) {
        console.log('DEBUG (Recent Chat): Using table from formatResponse');
        finalTables = [finalFormatted.table];
      }

      const json = finalFormatted.json || {};

      // BDD JSON handling
      let serializedBddJson = parseSerializedBddJson(textForMarkdown || '');
      const bddJson = extractJsonFromMarkdown(textForMarkdown);

      if (bddJson) {
        finalTables = transformBddJsonToMarkdownTables(normalizeBddJSON(bddJson));
      } else if (serializedBddJson) {
        finalTables = transformBddJsonToMarkdownTables(serializedBddJson);
      }

      // Initialize trace details, logs, etc. (keeping your existing logic)
      let traceDetails: any = null;
      if (agent.trace_info) {
        traceDetails = [{
          trace_id: agent.trace_info.trace_id,
          details: {
            trace_id: agent.trace_info.trace_id,
            spans: agent.trace_info.spans || []
          }
        }];
      }
      if (traceDetails && traceDetails.length > 0) {
        const inputMessage = agent.user_query || '';
        const outputMessage = this.getPromptOutput(agent) || '';
        traceDetails[0].details.spans.forEach((span: any) => {
          span.chat_messages = {
            input_message: inputMessage,
            output_message: outputMessage
          };
        });
      }

      let agentTraces: any = agent.agent_traces || null;
      let logDetails: any = agent.real_time_logs || null;

      let thinkingLogs: any[] = [];
      if (agent.real_time_logs && agent.real_time_logs.length > 0) {
        thinkingLogs = agent.real_time_logs.map((log: any) => {
          const logEntry = this.createLogStep(log);
          return {
            title: logEntry.title,
            content: this.createLogDetails(log.originalData || log),
            expanded: false
          };
        });
      }

      // Add the formatted response to chatResponses
      this.chatResponses.push({
        isResponseFullyLoaded: true,
        isLoading: false,
        user_query: agent.user_query || this.latestUserQuery || '',
        title: this.isFromPromptRepository && this.currentPromptTitle 
         ? this.currentPromptTitle 
         : (agent.prompt_title || this.currentPromptTitle || this.extractTitleFromResponse(cleanedText)) ,
        event_id: agent.event_id || '',
        map_id: agent.map_id || '',
        agency_id: resolvedAgencyId,
        isSavedToRepo: !!agent.isSavedToRepo,
        html: this.md.render(textForMarkdown),        // ← PSV Block Removed
        plain: cleanedText,                      // ← Cleaned text
        json: json,
        serializedBddJson: bddJson || serializedBddJson,
        tables: finalTables,
        table: finalTables.length > 0 ? finalTables[0] : { headers: [], rows: [] },
        explanation: cleanedText,
        thinking: '',
        traceDetails: traceDetails,
        agentTraces: agentTraces,
        logDetails: logDetails,
        thinkingLogs: thinkingLogs,
        showChatMessages: true,
        showChatMessagesTab: false,
        activeTab: 'trace'
      });

      console.log("✅ Final HTML sent to UI (first 300 chars):",
        this.md.render(textForMarkdown).substring(0, 300) + "...");

      // === LOAD EXISTING FEEDBACK IF PRESENT ===
      if (agent.feedback_rating || agent.feedback_comments) {
        this.isFeedbackSubmitted = true;
        this.submittedRating = agent.feedback_rating || 0;
        this.submittedFeedbackText = agent.feedback_comments || '';
        this.selectedRating = this.submittedRating;
        this.feedbackText = this.submittedFeedbackText;
      } else {
        this.isFeedbackSubmitted = false;
        this.submittedRating = 0;
        this.submittedFeedbackText = '';
      }
      debugger;
      // Final UI updates
      this.showThinking = thinkingLogs.length > 0;
      this.scrollToBottom();
      this.cdRef.detectChanges();
    }

filterEmptyEntries(entries: KeyValue<string, any>[]): KeyValue<string, any>[] {
  return entries.filter(entry => 
    entry.value !== null && 
    entry.value !== undefined && 
    entry.value !== ''
  );
}


formatKey(key: string): string {
  if (!key) return '';
  
  // Convert snake_case or camelCase to Title Case
  return key
    .replace(/_/g, ' ')                    // Replace underscores with spaces
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // Add space before capital letters in camelCase
    .replace(/\b\w/g, char => char.toUpperCase()); // Capitalize first letter of each word
}

toggleChatMessages(res: any): void {
  res.showChatMessages = !res.showChatMessages;
  if (!res.showChatMessages && res.activeTab === 'chat') {
    res.activeTab = 'trace';
  }
  // If showing chat messages, switch to chat tab
  if (res.showChatMessages) {
    res.activeTab = 'chat';
  } 
  this.cdRef.detectChanges();
}

getFirstChatWfMessage(res: any, type: string) {
  if (type === 'input') {
     return this.getUserInputForRecentQueries(res.user_query) || '';
  } else if (type === 'output') {
    return res.content || res.response ||'';
  }
  return '';
}

getFirstChatMessage(res: any, type: 'input' | 'output'): string {
  if (!res.traceDetails || !Array.isArray(res.traceDetails)) {
    return type === 'input' ? 'No input message available' : 'No output message available';
  }

  // Iterate through all traces
  for (const trace of res.traceDetails) {
    // Handle both direct trace object and trace with details property
    const spans = trace.spans || (trace.details && trace.details.spans) || [];
    
    // Iterate through all spans in the trace
    for (const span of spans) {
      if (!span.chat_messages) continue;
      
      // Check for the requested message type
      if (type === 'input' && span.chat_messages.input_message) {
        let userquery = span?.chat_messages?.input_message;
        return this.getUserInput(userquery);
      } else if (type === 'output' && span.chat_messages.output_message) {
        return span.chat_messages.output_message;
      }
    }
  }
  
  // Return default message if no chat message found
  return type === 'input' ? 'No input message available' : 'No output message available';
}

  getUserInput(rawMessage: any): string {

    // Return early if there's no message
    if (!rawMessage || typeof rawMessage !== 'string') {
      return rawMessage;
    }

    // First, try splitting by double newline (\n\n)
    let messageParts = rawMessage.split('\n\n');

    if (messageParts.length > 1) {
      // Return the second part, trimmed of extra whitespace
      return messageParts[1].trim();
    }

    // If neither delimiter is found, return the original message
    return rawMessage;
  }

  getUserInputForRecentQueries(rawMessage: string): string {

    // First, try splitting by double newline (\n\n)
    let messageParts = rawMessage.split('\n\n');

    if (messageParts.length > 1) {
      // Return the second part, trimmed of extra whitespace
      return messageParts[1].trim();
    }

    //If neither delimiter is found, return the original message
    return rawMessage;
  }

getGroupedLogs(logs: any[]): any[] {
  if (!logs || logs.length === 0) return [];
  
  // Group logs by feature
  const grouped: { [key: string]: any[] } = {};
  
  logs.forEach(log => {
    const feature = log.feature || 'unknown';
    if (!grouped[feature]) {
      grouped[feature] = [];
    }
    grouped[feature].push(log);
  });
  
  // Convert to array format
  return Object.keys(grouped).map(feature => ({
    feature,
    logs: grouped[feature]
  }));
}

getLogFeatureIcon(feature: string): string {
  const logFeatureLabelIconMapping: Record<string, [string, string]> = {
    __start__: ['Start', 'fa-play'],
    llm_generation: ['Llm Generation', 'fa-hexagon-nodes'],
    __end__: ['End', 'fa-stop'],
    rag_retrieval: ['RAG Retrieval', 'fa-search'],
    embed_documents: ['Embed Documents', 'fa-file-code'],
    kb_documents_retrieved: ['KB Documents Retrieved', 'fa-database'],
    retrieved_documents: ['Retrieved Documents', 'fa-file-alt'],
    agent_process_start: ['Agent Process Start', 'fa-play-circle'],
    agent_process_end: ['Agent Process End', 'fa-stop-circle'],
    knowledge_base: ['Knowledge Base', 'fa-database'],
  };
  
  return logFeatureLabelIconMapping[feature]?.[1] || 'fa-info-circle';
}

getLogFeatureLabel(feature: string): string {
  const logFeatureLabelIconMapping: Record<string, [string, string]> = {
    __start__: ['Start', 'fa-play'],
    llm_generation: ['Llm Generation', 'fa-hexagon-nodes'],
    __end__: ['End', 'fa-stop'],
    rag_retrieval: ['RAG Retrieval', 'fa-search'],
    embed_documents: ['Embed Documents', 'fa-file-code'],
    kb_documents_retrieved: ['KB Documents Retrieved', 'fa-database'],
    retrieved_documents: ['Retrieved Documents', 'fa-file-alt'],
    agent_process_start: ['Agent Process Start', 'fa-play-circle'],
    agent_process_end: ['Agent Process End', 'fa-stop-circle'],
    knowledge_base: ['Knowledge Base', 'fa-database'],
  };
  
  return logFeatureLabelIconMapping[feature]?.[0] || this.formatKey(feature);
}

formatData(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}


expandedData: { [key: string]: boolean } = {};

toggleExpandedData(index: number, key: string): void {
  const dataKey = `${index}_${key}`;
  this.expandedData[dataKey] = !this.expandedData[dataKey];
}

isDataExpanded(index: number, key: string): boolean {
  const dataKey = `${index}_${key}`;
  return this.expandedData[dataKey] || false;
}


isComplexObject(value: any): boolean {
  return value !== null && (typeof value === 'object' || Array.isArray(value));
}

flattenObject(obj: any, parentKey: string = ''): Array<{ fullKey: string; key: string; value: any }> {
  const result: Array<{ fullKey: string; key: string; value: any }> = [];
  
  if (obj === null || typeof obj !== 'object') {
    return result;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const key = parentKey ? `${parentKey}[${index}]` : `[${index}]`;
      if (typeof item === 'object' && item !== null) {
        result.push(...this.flattenObject(item, key));
      } else {
        result.push({ fullKey: key, key: `[${index}]`, value: item });
      }
    });
  } else {
    // Handle objects
    Object.keys(obj).forEach(key => {
      const value = obj[key];
      const fullKey = parentKey ? `${parentKey}.${key}` : key;
      
      if (typeof value === 'object' && value !== null) {
        result.push(...this.flattenObject(value, fullKey));
      } else {
        result.push({ fullKey: fullKey, key: key, value: value });
      }
    });
  }
  
  return result;
}

submitQuery(agentId: string) {

  if (this.isWorkflowrouted) {
    if (agentId !== "import_workflow") {
      const query = this.userQuery1?.trim();
      if (!query) return;
    } else {
      this.isActive = !this.isActive;
    }
    let userquery = this.userQuery1?.trim();
	
	 if(userquery == undefined || userquery == null || userquery == ''){
        const details = this.workflowDetails;
        userquery = details.flow_data.tasks[0].params.user_message.value;
      }
	
    this.latestUserQuery = userquery;
    this.chatMessages.push({ from: 'user', text: userquery });
    this.userQuery1 = '';
    this.showSendIcon1 = false;
    this.IsWorkFlowLoad = true;
    this.closeDetailsPanel();
    this.jobMap.clear();
    this.runningCount = 0;
    this.completedCount = 0;
    this.failedCount = 0;
    this.agentDurations = [];
    this.avgDuration = 0;
    this.activeTab = 'workflow';
    this.chatResponses = [];
    this.isWorkEnd = true;
    this.cdRef.detectChanges();
    this.runWorkflowWithQuery(this.workflowIdFromState!, userquery);
    return;
  }

  // ================================================
  // SESSION ID MANAGEMENT - ONLY NECESSARY CHANGE
  // ================================================
  let sessionId: string;
  const eventId = this.generateUUID();
  let mapId: string;
  if (this.isFromPromptRepository && 
      (this.currentResponseToSave?.map_id || this.originalPromptData?.map_id)) {
    
    mapId = this.currentResponseToSave?.map_id || this.originalPromptData?.map_id;
    console.log('Reusing map_id from Prompt Repository:', mapId);
  } else {
    mapId = this.generateUUID();   // Only generate new for fresh chats
  }

  // Determine current agent ID
  const currentAgentId = this.isChatSubmitted
    ? (this.secondryAgentId || this.selectedAgent?.agent_id || '')
    : (this.selectedAgent?.agent_id || this.secondryAgentId || '');

  // If first message OR agent changed → create NEW session_id
  if (!this.isChatSubmitted || this.lastUsedAgentId !== currentAgentId) {
    this.resetChatSession();                    // Reset before creating new session
    sessionId = this.generateUUID();
    this.currentSessionId = sessionId;
    this.lastUsedAgentId = currentAgentId;
    console.log(`🆕 New session_id created for agent ${currentAgentId}: ${sessionId}`);
  } 
  // Same agent → reuse session_id
  else {
    sessionId = this.currentSessionId!;
    console.log(`♻️ Reusing session_id for agent ${currentAgentId}: ${sessionId}`);
  }
  // ================================================

  // ────────────────────────────────────────────────
  // IMPORTANT: Reset thinking UI when starting a NEW query
  // ────────────────────────────────────────────────
  this.showThinking = false;                    
  this.isThinkingCollapsed = true;              
  this.hasRealLogs = false;                     

  // Reset state for new query
  this.isRecentChat = false;
  this.resetFeedbackState();
  this.isProcessingCompleted = false;
  this.completionMessageReceived = false;

  // Clear previous logs and reset flag
  this.logsDuringLoading = [];
  this.isThinkingCollapsed = false;             

  const isSecondary = this.isChatSubmitted;
  const query = isSecondary ? this.userQuery1.trim() : this.userQuery.trim();
  if (!query) return;

  const isFromPromptRepo = this.isFromPromptRepository;

  const payload: any = {
    userQuery: query,
    agent_id: isSecondary ? this.secondryAgentId || '' : '',
    user_id: this.loggedUser.Email,
    master_agent_id: isSecondary
      ? this.selectedAgent?.agent_id || ''
      : this.secondryAgentId || '',
    session_id: sessionId,
    event_id: eventId,
    map_id: mapId,
    prompt_title:this.currentPromptTitle || query.prompt_title||'',
    isSavedToRepo: isFromPromptRepo === true        
  };
  console.log("Payload for chatbotAgent with session_id:", payload);

  this.showWelcomePanel = false;
  this.latestUserQuery = query;
  this.chatMessages.push({ from: 'user', text: query });
  this.isChatSubmitted = true;
  this.isConversationStarted = true;

  if (isSecondary) {
    this.userQuery1 = '';
    this.showSendIcon1 = false;
  } else {
    this.userQuery = '';
    this.showSendIcon = false;
  }

  this.isLoading = true;
  this.cdRef.detectChanges();

  const streamIndex = this.chatResponses.push({
    isLoading: true,
    title: 'Generating...',
    html: `<div class="d-flex justify-content-center p-3"><img src="assets/loader.gif" alt="Loading..." style="height:60px;" /></div>`,
    plain: '',
    json: {},
    table: { headers: [], rows: [] },
    explanation: '',
    thinking: '',
    traceDetails: null,
    logDetails: [],
    showChatMessages: false,
    showChatMessagesTab: false,
    activeTab: 'trace', 
    isLoadingExplanation: true,
    explanationDataLoaded: false
  }) - 1;

  const unifiedResponse = this._homeService.chatbotAgentUnified(payload);

  // Handle trace details
  let traceDetails: any = null;
  let traceDetailsSubscription = unifiedResponse.traceDetails.subscribe({
    next: (chunk) => {
      if (chunk.type === 'trace_details') {
      traceDetails = chunk.data;
      this.chatResponses[streamIndex].traceDetails = traceDetails;
      this.chatResponses[streamIndex].isLoadingExplanation = false;
      this.chatResponses[streamIndex].explanationDataLoaded = true;
      this.cdRef.detectChanges();
    }
    },
    error: (err) => console.error('❌ Error in trace details:', err)
  });

  // Handle log details
  let logDetails: any[] = [];
  let logDetailsSubscription = unifiedResponse.logDetails.subscribe({
  next: (chunk) => {
    if (this.isProcessingCompleted) return;
    if (this.isCompletionMessage(chunk)) {
      console.log('Metrics completed — showing thinking with logs');
      this.isLoading = false;
      this.isProcessingCompleted = true;
      const logsHtml = this.createLogsHtml(this.logsDuringLoading);
      if (this.chatResponses[streamIndex]) {
        this.chatResponses[streamIndex].thinkingLogs = this.logsDuringLoading.map(log => ({
          title: log.title,
          content: this.createLogDetails(log.originalData || log),
          expanded: false
        }));
      }
      // ✅ IMMEDIATELY FORMAT THE RESPONSE WHEN showThinking BECOMES TRUE
      this.formatAndSetResponse(streamIndex, accumulatedText);
      this.showThinking = true;
      this.cdRef.detectChanges();
      return;
    }
    if (chunk.type === 'log') {
      logDetails.push(chunk.data);
      if (!this.hasRealLogs) this.hasRealLogs = true;
      const logEntry = this.createLogStep(chunk.data);
      this.logsDuringLoading.push(logEntry);
      this.cdRef.detectChanges();
      this.scrollToBottom();
    }
  },
  error: (err) => {
    console.error(' Error in log details:', err);
    if (!this.isProcessingCompleted) this.stopProcessingAndShowResults();
  }
});
  // Handle stream content
  let processingComplete = false;
  let accumulatedText = '';
  let finalExplanation = 'No data available';
  let finalThinking = 'No data available';
  let IsStreamCompleteOrError=false;

  let streamSubscription = unifiedResponse.stream.subscribe({
    next: (chunk) => {
      if (this.isProcessingCompleted) return;
      //  FIX: Parse string chunks (handling "data: {...}" format)
      let parsedChunk = chunk;
      if (typeof chunk === 'string') {
        try {
          let cleanChunk = chunk.replace(/^data:\s*/, '');
          if (cleanChunk.startsWith('{') && cleanChunk.endsWith('}')) {
            parsedChunk = JSON.parse(cleanChunk);
          }
        } catch (e) {
          // Not JSON, treat as text
        }
      }
      // FIX: Check completion for both parsed object and raw chunk
      if (this.isCompletionMessage(parsedChunk) || this.isCompletionMessage(chunk)) {
        console.log(' Received completion message from stream, stopping immediately');
        this.stopProcessingAndShowResults();
        return;
      }
      if (chunk === 'end') {
        console.log("'end' chunk received - finalizing stream");
		 if (!IsStreamCompleteOrError) {
            // this.loadRecentData();
            this.refreshRecentData();
          }
        return;
      } else if (typeof chunk === 'string') {
        const processedChunk = chunk.replace(/\\"/g, '"').replace(/\\t/g, ' ');
        accumulatedText += processedChunk;
        const displayText = accumulatedText.replace(/\\n/g, '\n');
  
  
  const cleanedDisplay = displayText
    .replace(/```psv[\s\S]*?```/gi, '')
    .replace(/```\s*psv[\s\S]*?```/gi, '')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
        this.chatResponses[streamIndex] = {
          ...this.chatResponses[streamIndex],
          isLoading: false,
          event_id: eventId,
          map_id: mapId,
         plain: cleanedDisplay,
          html: `<pre style="white-space: pre-wrap;">${cleanedDisplay}</pre>`,
        //   title: this.isFromPromptRepository && this.currentPromptTitle 
        //  ? this.currentPromptTitle 
        //  : (this.extractTitleFromResponse(cleanedDisplay) || 'Response'),
          title:this.extractTitleFromResponse(cleanedDisplay) ,
          json: {},
          table: { headers: [], rows: [] },
          explanation: cleanedDisplay,
          thinking: finalThinking,
          traceDetails: traceDetails,
          logDetails: logDetails,
          showChatMessages: false,
          showChatMessagesTab: false,
          activeTab: 'trace',
          isLoadingExplanation: this.chatResponses[streamIndex].isLoadingExplanation,
          explanationDataLoaded: this.chatResponses[streamIndex].explanationDataLoaded,
        };
        this.cdRef.detectChanges();
      }
    },
    error: (err) => {
      console.error('❌ Streaming error:', err);
      if (!this.isProcessingCompleted) this.stopProcessingAndShowResults();

      this.chatResponses[streamIndex] = {
        html: '<div class="chat-line error">Failed to generate response.</div>',
        plain: 'Failed to generate response.',
        json: { error: true, message: 'Failed to generate response.' },
        table: { headers: [], rows: [] },
        title: 'Error',
        explanation: 'Failed to generate response',
        thinking: 'Failed to generate response',
        isLoading: false,
        traceDetails: null,
        logDetails: [],
        showChatMessages: false,
        showChatMessagesTab: false,
        activeTab: 'trace',
        isLoadingExplanation: false,
        explanationDataLoaded: true
      };
      this.showThinking = true;
	     if (!IsStreamCompleteOrError) {
          //this.loadRecentData();
          this.refreshRecentData();
        }
	  IsStreamError=true;
      this.cdRef.detectChanges();
    },
    complete: () => {
      // Fallback: if stream ends without explicit completion message
      if (!this.isProcessingCompleted) {
        this.stopProcessingAndShowResults();
        // IMMEDIATELY FORMAT THE RESPONSE (no delay)
        this.formatAndSetResponse(streamIndex, accumulatedText);
      }
      setTimeout(() => {
        if (traceDetailsSubscription) traceDetailsSubscription.unsubscribe();
        if (logDetailsSubscription) logDetailsSubscription.unsubscribe();
        if (streamSubscription) streamSubscription.unsubscribe();
      }, 1000);
	  
	  if (!IsStreamCompleteOrError) {
          //this.loadRecentData();
          this.refreshRecentData();
        }
    }
  });
}

  // Use a getter for better Angular performance
  get isWorkflowDisabled(): boolean {
    let details = this.workflowDetails;
    let userMessage = details?.flow_data?.tasks?.[0]?.params?.user_message?.value;

    // If user_message is missing, disable the button (return true)
    if (!userMessage) {
      return true;
    }

    // Otherwise, fall back to the standard isWorkEnd state
    return this.isWorkEnd;
  }

loadAlreadySelectedAgent(agentId: string, recentData: any[]) {
    console.log('Stream completed');
    console.log('Agent_ID for recent data loading:', agentId);
    console.log('Selected Agent for recent data loading:', this.selectedAgent);


    if (recentData && recentData.length > 0) {
      this.recentData = recentData || [];
      this.recentOGData = [...this.recentData];

      this.recentQueryForSuggestionData = recentData || [];
      this.recentQueryForSuggestionOGData = [...this.recentQueryForSuggestionData];
      this.cdRef.detectChanges();
    }
    else {
      console.log('Recent data available for filtering:', recentData);
      this.recentData = this.recentOGData;
      this.recentQueryForSuggestionData = this.recentQueryForSuggestionOGData;
      this.cdRef.detectChanges();
    }
    this.recentData = this.recentData.filter(agent =>
      agent.master_agent_id === this.selectedAgent.agent_id && agent.agent_id === agentId
    );

    this.recentQueryForSuggestionData = this.recentQueryForSuggestionData.filter(agent =>
      agent.master_agent_id === this.selectedAgent.agent_id && agent.agent_id === agentId
    ).slice(0, 5);
  }

formatAndSetResponse(streamIndex: number, accumulatedText: string) {
  let processedText = accumulatedText.replace(/\\n/g, '\n');
  const accumulatedTextTrimmed = processedText.trim();

  // ===PSV CLEANING ===
  const cleanedText = accumulatedTextTrimmed
    .replace(/```psv[\s\S]*?```/gi, '')
    .replace(/```\s*psv[\s\S]*?```/gi, '')
    .replace(/\n\s*\n\s*\n\s*\n/g, '\n\n')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();

  let textForMarkdown = repairTableStructure(cleanedText);

  let markdownTables = extractMarkdownTables(textForMarkdown);
  let finalTables = markdownTables;
  let finalJson = tablesToCsvJson(finalTables);
 
  if (finalTables.length === 0) {
    const formattedData = this.formatResponse(accumulatedTextTrimmed);
    if (formattedData.table.headers.length > 0) {
      finalTables = [formattedData.table];
      finalJson = formattedData.json;
    }
  }

  let serializedBddJson = parseSerializedBddJson(processedText || '');
  const bddJson = extractJsonFromMarkdown(processedText);

  if (bddJson) {
    finalTables = transformBddJsonToMarkdownTables(normalizeBddJSON(bddJson));
  } else if (serializedBddJson) {
    finalTables = transformBddJsonToMarkdownTables(serializedBddJson);
  }

  // UPDATE RESPONSE
  this.chatResponses[streamIndex].html = this.md.render(textForMarkdown);
  this.chatResponses[streamIndex].plain = cleanedText;
  this.chatResponses[streamIndex].table = finalTables.length > 0 ? finalTables[0] : { headers: [], rows: [] };
  this.chatResponses[streamIndex].tables = finalTables;
  this.chatResponses[streamIndex].json = finalJson;
  this.chatResponses[streamIndex].serializedBddJson = bddJson || serializedBddJson;
  this.chatResponses[streamIndex].isResponseFullyLoaded = true;
  this.chatResponses[streamIndex].isLoading = false;
  this.chatResponses[streamIndex].explanation = cleanedText;
  this.chatResponses[streamIndex].showThinking = true;

  this.cdRef.detectChanges();
}

private generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

resetChatSession(): void {
  this.currentSessionId = null;
  this.lastUsedAgentId = '';
  console.log('🔄 Chat session has been reset for new agent/conversation');
}

toggleThinkingItem(i: number) {
    event.stopPropagation();
    
    // Check if we're in workflow mode
    if (this.isWorkflowrouted && this.workflowThinkingLogs) {
        // Handle workflow thinking logs
        if (this.workflowThinkingLogs[i]) {
            this.workflowThinkingLogs[i].expanded = !this.workflowThinkingLogs[i].expanded;
            
            this.cdRef.detectChanges();
            
            if (this.workflowThinkingLogs[i].expanded) {
                // Use requestAnimationFrame for smoother scrolling
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        const thinkingElement = document.getElementById('workflowCollapseExample');
                        const thinkingItem = thinkingElement?.querySelector(`.thinking-item:nth-child(${i + 1})`);
                        if (thinkingItem) {
                            // Get the position of the thinking element
                            const elementRect = thinkingItem.getBoundingClientRect();
                            const containerRect = thinkingElement.getBoundingClientRect();
                            
                            // Calculate scroll position
                            const scrollTop = thinkingElement.scrollTop;
                            const targetScrollTop = scrollTop + (elementRect.top - containerRect.top) - 50;
                            
                            // Scroll to the target position
                            thinkingElement.scrollTo({
                                top: targetScrollTop,
                                behavior: 'smooth'
                            });
                        }
                    }, 50);
                });
            }
        }
    } else {
        const logs = this.chatResponses[this.chatResponses.length - 1]?.thinkingLogs;
        if (logs && logs[i]) {
            logs[i].expanded = !logs[i].expanded;
            
            this.cdRef.detectChanges();
            
            if (logs[i].expanded) {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        const collapseElement = document.getElementById('collapseExample');
                        const thinkingItem = collapseElement?.querySelector(`.thinking-item:nth-child(${i + 1})`);
                        if (thinkingItem) {
                            const elementRect = thinkingItem.getBoundingClientRect();
                            const containerRect = collapseElement.getBoundingClientRect();
                            
                            const scrollTop = collapseElement.scrollTop;
                            const targetScrollTop = scrollTop + (elementRect.top - containerRect.top) - 50;
                            
                            collapseElement.scrollTo({
                                top: targetScrollTop,
                                behavior: 'smooth'
                            });
                        }
                    }, 50);
                });
            }
        }
    }
}

stopProcessingAndShowResults() {
  this.isProcessingCompleted = true;
  this.isLoading = false;
  
  const currentIndex = this.chatResponses.length - 1;
  if (currentIndex >= 0) {
    // Ensure thinking logs are set if not already present
    if (!this.chatResponses[currentIndex].thinkingLogs || 
        this.chatResponses[currentIndex].thinkingLogs.length === 0) {
      this.chatResponses[currentIndex].thinkingLogs = this.logsDuringLoading.map(log => ({
        title: log.title,
        content: this.createLogDetails(log.originalData || log),
        expanded: false
      }));
    }

    // Ensure trace data is reflected in the current response
    if (this.chatResponses[currentIndex].traceDetails) {
      this.chatResponses[currentIndex].traceDetails = this.chatResponses[currentIndex].traceDetails;
      this.chatResponses[currentIndex].isLoadingExplanation = false; // Stop loading
      this.chatResponses[currentIndex].explanationDataLoaded = true;  // Data loaded
    }

    // Ensure log data is reflected in the current response
    if (this.chatResponses[currentIndex].logDetails) {
      this.chatResponses[currentIndex].logDetails = this.chatResponses[currentIndex].logDetails;
    }
  }

  this.cdRef.detectChanges();
}

isCompletionMessage(data: any): boolean {
  return (
    data?.type === 'msg' &&
    data?.data?.message?.toLowerCase()?.includes('completed')
  );
}

createLogStep(logData: any, agentName?: string): any {
  // Extract relevant information from the log data
  const eventType = logData.event_type || 'system_event';
  const feature = logData.feature || 'system';
  const status = logData.status || 'processing';
  const logAgentName = agentName || logData.agent_name || '';
  
  // Create a step-like structure
  return {
    timestamp: new Date().toLocaleTimeString(),
    icon: this.getStepIcon(eventType, status),
    title: this.createSimpleLogTitle(logData), 
    desc: this.getStepDescription(eventType, status, logData),
    message: this.formatLogData(logData),
    type: logData.level || logData.type || 'info',
    source: logAgentName,
    agentName: logAgentName, // Keep this for backward compatibility
    originalData: logData
  };
}

getStepIcon(eventType: string, status: string): string {
  const eventTypeLower = eventType.toLowerCase();
  const statusLower = status.toLowerCase();
  
  // Error states
  if (statusLower === 'error' || statusLower === 'failed') {
    return '❌';
  }
  
  // Success states
  if (statusLower === 'success' || statusLower === 'completed') {
    return '✅';
  }
  
  // Specific event types
  if (eventTypeLower === 'agent_process_start') {
    return '🚀';
  } else if (eventTypeLower === 'llm_generation') {
    return '🧠';
  } else if (eventTypeLower === 'kb_documents_retrieved') {
    return '📚';
  } else if (eventTypeLower === 'agent_process_complete') {
    return '🎉';
  }
  
  // Default processing icon
  return '⚙️';
}

getStepTitle(eventType: string, feature: string, logData: any): string {
  const eventTypeLower = eventType.toLowerCase();
  const formattedEventType = this.formatFieldName(eventType);
  
  if (eventTypeLower === 'agent_process_start') {
    return `Starting ${feature || 'process'}`;
  } else if (eventTypeLower === 'llm_generation') {
    return `Generating response using ${logData.model || 'AI model'}`;
  } else if (eventTypeLower === 'kb_documents_retrieved') {
    const docCount = Array.isArray(logData.documents) ? logData.documents.length : 0;
    return `Retrieved ${docCount} documents`;
  } else if (eventTypeLower === 'agent_process_complete') {
    return `Completed ${feature || 'process'}`;
  } else if (eventTypeLower === 'agent_process_error') {
    return `Error in ${feature || 'process'}`;
  }
  
  return formattedEventType;
}

getStepDescription(eventType: string, status: string, logData: any): string {
  const statusLower = status.toLowerCase();
  const eventTypeLower = eventType.toLowerCase();

  // 1. Handle Error Status
  if (statusLower === 'error' || statusLower === 'failed') {
    return logData.message || 'An error occurred during processing';
  }

  // 2. Handle Specific Event Types
  if (eventTypeLower === 'agent_process_start') {
    return `Starting process for ${logData.agent_name}`;
  } 
  
  if (eventTypeLower === 'llm_generation') {
    // Show model info if available
    if (logData.model) {
      return `Using model: ${logData.model}`;
    }
    return 'Generating response...';
  } 
  
  if (eventTypeLower === 'kb_documents_retrieved') {
    // Show document count if available
    if (logData.documents && Array.isArray(logData.documents)) {
      return `Found ${logData.documents.length} relevant documents`;
    }
    return 'Retrieving knowledge base documents...';
  } 
  
  if (eventTypeLower === 'agent_process_complete') {
    return `Process finished with status: ${status}`;
  }

  // 3. Handle Query Presence
  if (logData.query) {
    return `Processing query: "${logData.query}"`;
  }
  
  // 4. Fallback to message if present
  if (logData.message && logData.message.trim()) {
    return logData.message;
  }

  // 5. Final Fallback
  return 'Processing request';
}

formatLogData(logData: any): string {
  if (!logData || typeof logData !== 'object') {
    return String(logData || '');
  }
  
  // Create a formatted representation
  const formattedParts: string[] = [];
  
  // Add event type if present
  if (logData.event_type) {
    const formattedEventType = this.formatFieldName(logData.event_type);
    formattedParts.push(`<strong>${formattedEventType}</strong>`);
  }
  
  // Add feature if present
  if (logData.feature && logData.feature !== '__start__') {
    formattedParts.push(`<span class="text-primary">${logData.feature}</span>`);
  }
  
  // Add agent name if present
  if (logData.agent_name) {
    formattedParts.push(`<span class="text-info">by ${logData.agent_name}</span>`);
  }
  
  // Add model/provider for LLM generation
  if (logData.event_type === 'llm_generation' && logData.model) {
    formattedParts.push(`using <span class="text-warning">${logData.model}</span>`);
    if (logData.provider) {
      formattedParts.push(`(${logData.provider})`);
    }
  }
  
  // Add document count for knowledge base events
  if (logData.event_type === 'kb_documents_retrieved' && logData.documents) {
    const docCount = Array.isArray(logData.documents) ? logData.documents.length : 0;
    formattedParts.push(`<span class="text-success">${docCount} documents</span>`);
  }
  
  // Add query for knowledge base events
  if (logData.query) {
    formattedParts.push(`for: <em>"${logData.query}"</em>`);
  }
  
  // Add status with appropriate styling
  if (logData.status) {
    const statusClass = this.getStatusClass(logData.status);
    formattedParts.push(`<span class="${statusClass}">${logData.status}</span>`);
  }
  
  // Add message if present and not empty
  if (logData.message && logData.message.trim()) {
    formattedParts.push(`: ${logData.message}`);
  }
  
  // If we have no formatted parts, create a simple representation
  if (formattedParts.length === 0) {
    // Create a simple key-value representation
    const entries = Object.entries(logData)
      .filter(([key, value]) => value !== null && value !== undefined && value !== '')
      .slice(0, 3); // Limit to first 3 entries to avoid clutter
    
    if (entries.length > 0) {
      entries.forEach(([key, value]) => {
        const formattedKey = this.formatFieldName(key);
        const formattedValue = typeof value === 'object' ? 
          (Array.isArray(value) ? `${value.length} items` : 'object') : 
          String(value);
        formattedParts.push(`${formattedKey}: ${formattedValue}`);
      });
    } else {
      return 'System event';
    }
  }
  
  return formattedParts.join(' ');
}

formatFieldName(fieldName: string): string {
  if (!fieldName) return '';
  
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

getStatusClass(status: string): string {
  if (!status) return '';
  
  const statusLower = status.toLowerCase();
  if (statusLower === 'success' || statusLower === 'completed') {
    return 'text-success';
  } else if (statusLower === 'error' || statusLower === 'failed') {
    return 'text-danger';
  } else if (statusLower === 'warning' || statusLower === 'in_progress') {
    return 'text-warning';
  } else {
    return 'text-secondary';
  }
}

filterLogFields(logData: any): any {
  if (!logData || typeof logData !== 'object') {
    return logData;
  }
  
  // Create a copy to avoid modifying the original
  const filtered = { ...logData };
  
  // List of ID and timestamp fields to remove
  const fieldsToRemove = [
    'log_id',
    'run_id',
    'session_id',
    'timestamp',
    'trace_id'
  ];
  
  // Remove the ID and timestamp fields
  fieldsToRemove.forEach(field => {
    delete filtered[field];
  });
  
  return filtered;
}

createLogsHtml(logs: Array<any>): string {
  if (!logs || logs.length === 0) {
    return 'No process logs available.';
  }
  
  let html = '<div class="log-summary">';
  
  logs.forEach((log, index) => {
    const logData = log.originalData || log;
    
    // Create a title in the format "feature in agent_name"
    const title = this.createSimpleLogTitle(logData);
    
    // Create only the required fields for expanded view
    const detailsHtml = this.createSimpleLogDetails(logData);
    
    html += `<div class="log-entry">
      <details class="log-accordion mb-2 border rounded shadow-sm" id="log-accordion-${index}">
        <summary class="d-flex justify-content-between align-items-center px-3 py-2 bg-light cursor-pointer">
          <div class="d-flex align-items-center">
            <span class="log-icon me-2">${log.icon}</span>
            <strong class="me-2">${title}</strong>
            <span class="text-muted small">${log.timestamp}</span>
          </div>
          <i class="fa-solid fa-chevron-down transition-transform"></i>
        </summary>
        <div class="p-3 bg-white">
          ${detailsHtml}
        </div>
      </details>
    </div>`;
  });
  
  html += '</div>';
  
  return html;
}

createSimpleLogTitle(logData: any): string {
  const eventType = logData.event_type;
  const agentName = logData.agent_name;

  // 1. Format the event_type (e.g., "llm_generation" -> "Llm Generation")
  // If event_type is missing, this will return an empty string
  let title = this.formatFieldName(eventType || '');

  // 2. Append agent_name if it exists
  if (agentName && title) {
    return `${title} in ${agentName}`;
  }

  // 3. Return just the event_type title (or empty string if no event_type)
  return title;
}

createSimpleLogDetails(logData: any): string {
  if (!logData || typeof logData !== 'object') {
    return '<p class="text-muted">No details available</p>';
  }
  
  let html = '<div class="log-details-simple">';
  
  // Only show these three specific fields
  const fieldsToShow = [
    { key: 'event_type', label: 'Event Type' },
    { key: 'status', label: 'Status' },
    { key: 'timestamp', label: 'Timestamp' }
  ];
  
  fieldsToShow.forEach(field => {
    if (logData[field.key] !== undefined && logData[field.key] !== null && logData[field.key] !== '') {
      let value = logData[field.key];
      let valueClass = '';
      
      // Add styling for status
      if (field.key === 'status') {
        valueClass = this.getStatusClass(logData[field.key]);
      } else if (field.key === 'event_type') {
        valueClass = 'text-primary';
      } else if (field.key === 'timestamp') {
        valueClass = 'text-muted';
      }
      
      // Format the value
      let formattedValue: string;
      if (typeof value === 'object') {
        formattedValue = `<pre class="mb-0 mt-1 p-2 bg-light rounded small">${JSON.stringify(value, null, 2)}</pre>`;
      } else {
        formattedValue = String(value);
      }
      
      html += `
        <div class="log-field-simple mb-2">
          <div class="log-field-label-simple text-muted small">${field.label}:</div>
          <div class="log-field-value-simple ${valueClass}">${formattedValue}</div>
        </div>
      `;
    }
  });
  
  html += '</div>';
  return html;
}

createLogDetails(logData: any): string {
  if (!logData || typeof logData !== 'object') {
    return '<p class="text-muted">No details available</p>';
  }
  
  let html = '<div class="log-details">';
  
  // Only show these specific fields
  const fieldsToShow = [
    { key: 'event_type', label: 'Event Type' },
    { key: 'feature', label: 'Feature' },
    { key: 'status', label: 'Status' },
    { key: 'timestamp', label: 'Timestamp' }
  ];
  
  fieldsToShow.forEach(field => {
    if (logData[field.key] !== undefined && logData[field.key] !== null && logData[field.key] !== '') {
      let value = logData[field.key];
      
      // Format value (inline)
      let formattedValue: string;
      if (typeof value === 'object') {
         formattedValue = JSON.stringify(value);
      } else {
         formattedValue = String(value);
      }

      // Generate inline HTML: Label: Value
      // Removed valueClass to remove color
      html += `
        <div class="mb-1">
          <span class="text-muted small me-2">${field.label}:</span>
          <span class="small">${formattedValue}</span>
        </div>
      `;
    }
  });
  
  html += '</div>';
  return html;
}

getLevelClass(level: string): string {
  if (!level) return '';
  
  const levelLower = level.toLowerCase();
  switch(levelLower) {
    case 'error': return 'text-danger';
    case 'warning': return 'text-warning';
    case 'info': return 'text-info';
    case 'debug': return 'text-secondary';
    case 'critical': return 'text-danger';
    default: return 'text-muted';
  }
}

getLogIcon(log: any): string {
  const type = log.type?.toLowerCase();
  
  // Check for specific event types first
  if (log.message?.includes('agent_process_start')) {
    return 'fa-play-circle text-primary';
  } else if (log.message?.includes('agent_process_complete')) {
    return 'fa-check-circle text-success';
  } else if (log.message?.includes('agent_process_error')) {
    return 'fa-exclamation-circle text-danger';
  } else if (log.message?.includes('llm_generation')) {
    return 'fa-magic text-info';
  } else if (log.message?.includes('knowledge_base_search')) {
    return 'fa-search text-primary';
  } else if (log.message?.includes('knowledge_base_results')) {
    return 'fa-database text-success';
  }
  
  // Fall back to log type
  switch(type) {
    case 'error': return 'fa-exclamation-circle text-danger';
    case 'warning': return 'fa-exclamation-triangle text-warning';
    case 'success': return 'fa-check-circle text-success';
    case 'info': return 'fa-info-circle text-info';
    case 'debug': return 'fa-bug text-secondary';
    default: return 'fa-info-circle text-info';
  }
}

toggleThinkingVisibility() {
    // Check if we're in workflow mode
    if (this.isWorkflowrouted) {
        // Handle workflow thinking collapse
        this.isWorkflowThinkingCollapsed = !this.isWorkflowThinkingCollapsed;
        
        // Force change detection to ensure the UI updates immediately
        this.cdRef.detectChanges();
    } else {
        // Handle chatbot thinking collapse (original logic)
        this.isThinkingCollapsed = !this.isThinkingCollapsed;
        this.cdRef.detectChanges();
    }
}

  resetFeedbackState() {
  this.isPopupVisible = false;
  this.isFeedbackSubmitted = false;
  this.isPromptSaved = false;
  this.isPromptUpdated = false;
  this.selectedRating = 0;
  this.feedbackText = '';
  this.hoveredRating = 0;
  this.submittedRating = 0;
  this.submittedFeedbackText = '';
  this.cdRef.detectChanges();
}


    routeAndSubmitQuery() {
  const query = this.isChatSubmitted ? this.userQuery1.trim() : this.userQuery.trim();
  if (!query) return;

  this.showThinking = false;
  this.logsDuringLoading = [];
  this.isThinkingCollapsed = true;
  this.hasRealLogs = false;
  this.isProcessingCompleted = false;
  this.completionMessageReceived = false;

  // Reset state for new query
  this.isRecentChat = false;
  this.resetFeedbackState();
  this.isProcessingCompleted = false;
  this.completionMessageReceived = false;

  // Clear previous logs and reset flag
  this.logsDuringLoading = [];
  this.isThinkingCollapsed = false;             // Allow expanding new logs

  this.startLoading();
  const activePrj = this.loggedUser?.ActiveProject;
  const projectDetails = this.loggedUser?.ProjectDtl || [];

  const mappedProject = projectDetails.find(
    (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
  );

  const mappedTeam = mappedProject?.team_name || '';
  const mappedRole = mappedProject?.role_name?.toLowerCase() || '';
  console.log('Mapped Team:', mappedTeam);
  const payload = { userQuery: query, teams: mappedTeam };

  // Add a placeholder response for the routing process
  const streamIndex = this.chatResponses.push({
    isLoading: true,
    title: 'Finding the right agent...',
    html: `<div class="d-flex justify-content-center p-3"><img src="assets/loader.gif" alt="Loading..." style="height:60px;" /></div>`,
    plain: '',
    json: {},
    table: { headers: [], rows: [] },
    explanation: '',
    thinking: '',
    traceDetails: null,
    logDetails: [],
    showChatMessages: false,
    showChatMessagesTab: false,
    activeTab: 'trace'
  }) - 1;

  this._homeService.routeChat(payload).subscribe({
    next: (routeRes: any) => {
      console.log("Route Response:", routeRes);

      // If failed or no subagent
      if (!routeRes?.success || !routeRes?.data?.agent || !routeRes?.data?.agent?.subagent) {
        this.stopLoading(() => {
          // Create a log entry for the routing failure
          const routingFailureLog = {
            title: 'Agent Routing',
            content: this.createLogDetails({
              status: 'Failed',
              message: routeRes?.message || 'No suitable agent found',
              query: query,
              team: mappedTeam
            }),
            expanded: true
          };

          // Prepare logs HTML
          const logsHtml = this.createLogsHtml([routingFailureLog]);
          
          // Update the chat response with error information and thinking
          this.chatResponses[streamIndex] = {
            isLoading: false,
            title: 'Error',
            html: '<div class="chat-line error">No suitable agent found.</div>',
            plain: 'No suitable agent found.',
            json: { error: true, message: 'No suitable agent found' },
            table: { headers: [], rows: [] },
            explanation: routeRes?.message || 'No suitable agent found.',
            thinking: logsHtml,
            thinkingLogs: [routingFailureLog],
            traceDetails: null,
            logDetails: [],
            showChatMessages: false,
            showChatMessagesTab: false,
            activeTab: 'trace'
          };

          // Show thinking section with routing logs
          this.showThinking = true;
          this.scrollToBottom();
          this.loadRecentData();
          console.log("this.loadRecentData()");
          this.cdRef.detectChanges();
          
          // Show toast popup
          this.showToast('error', routeRes?.message || 'Please refine your query.');
        });
        return;
      }

      // Safe to use subagent now
      // Update the routing response to show success
      const routingSuccessLog = {
        title: 'Agent Routing',
        content: this.createLogDetails({
          status: 'Success',
          agent: routeRes.data.agent.subagent.name,
          query: query,
          team: mappedTeam
        }),
        expanded: true
      };

      // Prepare logs HTML
      const logsHtml = this.createLogsHtml([routingSuccessLog]);
      
      // Update the chat response with routing success information
      this.chatResponses[streamIndex] = {
        isLoading: false,
        title: 'Agent Found',
        html: `<div class="chat-line success">Found suitable agent: ${routeRes.data.agent.subagent.name}</div>`,
        plain: `Found suitable agent: ${routeRes.data.agent.subagent.name}`,
        json: { success: true, agent: routeRes.data.agent.subagent.name },
        table: { headers: [], rows: [] },
        explanation: `Successfully routed to agent: ${routeRes.data.agent.subagent.name}`,
        thinking: logsHtml,
        thinkingLogs: [routingSuccessLog],
        traceDetails: null,
        logDetails: [],
        showChatMessages: false,
        showChatMessagesTab: false,
        activeTab: 'trace'
      };
      this.isResponseFullyLoaded = true;
      this.showThinking = true;
      this.scrollToBottom();
      this.cdRef.detectChanges();
      
      // Continue with the actual query submission
      this.startAgentChat1(routeRes.data.agent, query);
      this.submitQuery(routeRes.data.agent.subagent.name);
      this.isRecentChat = false;
      this.isFeedbackSubmitted = false;
    },

    error: (err) => {
      console.error("Route API Error:", err);
      
      // Create a log entry for the routing error
      const routingErrorLog = {
        title: 'Agent Routing',
        content: this.createLogDetails({
          status: 'Error',
          message: 'Something went wrong while routing your query',
          query: query,
          team: mappedTeam,
          error: err
        }),
        expanded: true
      };

      // Prepare logs HTML
      const logsHtml = this.createLogsHtml([routingErrorLog]);
      
      this.stopLoading(() => {
        // Update the chat response with error information and thinking
        this.chatResponses[streamIndex] = {
          isLoading: false,
          title: 'Error',
          html: '<div class="chat-line error">Something went wrong while processing your query.</div>',
          plain: 'Something went wrong while processing your query.',
          json: { error: true, message: 'Something went wrong' },
          table: { headers: [], rows: [] },
          explanation: 'Something went wrong while processing your query.',
          thinking: logsHtml,
          thinkingLogs: [routingErrorLog],
          traceDetails: null,
          logDetails: [],
          showChatMessages: false,
          showChatMessagesTab: false,
          activeTab: 'trace'
        };

        // Show thinking section with routing error logs
        this.showThinking = true;
        this.scrollToBottom();
        this.cdRef.detectChanges();
        
        this.showToast('error', 'Something went wrong while processing your query.');
      });
    }
  });
}

  showToast(type: 'success' | 'error', message: string) {
    // Set the message
    this.toastMessage = message || (type === 'success' 
      ? 'Operation completed successfully' 
      : 'Something went wrong');

    this.cdRef.detectChanges();

    // Small delay + direct DOM fallback
    setTimeout(() => {
      const toastId = type === 'success' ? 'successToast' : 'errorToast';
      const toastElement = document.getElementById(toastId);

      if (toastElement) {
        // Direct DOM update as safety net
        const toastBody = toastElement.querySelector('.toast-body');
        if (toastBody) {
          toastBody.textContent = this.toastMessage;
        }

        // Show Bootstrap toast
        const bsToast = new bootstrap.Toast(toastElement, {
          delay: type === 'success' ? 4000 : 6000,
          autohide: true
        });
        bsToast.show();
      } else {
        console.warn(`Toast element #${toastId} not found!`);
      }
    }, 30);
  }

  stopLoading(callback?: () => void): void {
    // Wait until the last step is displayed
    setTimeout(() => {
      this.isLoading = false;
      this.cdRef.detectChanges();
      if (callback) callback();
    }, 800); // small delay after final step
  }

  cleanAndFormatResponse(text: string) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const formattedLines: string[] = [];
    const plainLines: string[] = [];
    const jsonObj: any = {};
    let currentKey: string | null = null;
    lines.forEach(line => {
      // remove **, bullets, and leading numbering like "1. "
      let plain = line.replace(/\*\*/g, '').replace(/^[-•]\s*/, '').replace(/^\d+\.\s*/, '');
      // Headings like "Title:", "Test Case ID:" etc.
      const headingMatch = plain.match(/^([\w\s()/-]+):\s*(.*)$/);
      if (headingMatch) {
        const key = headingMatch[1].trim();
        const value = headingMatch[2].trim();
        currentKey = key;
        jsonObj[key] = value || [];
        formattedLines.push(`<div class="chat-line subtitle"><strong>${key}:</strong> ${value}</div>`);
        plainLines.push(`${key}: ${value}`);
        return;
      }
      // Plain text under current key
      if (currentKey) {
        if (!Array.isArray(jsonObj[currentKey])) {
          jsonObj[currentKey] = jsonObj[currentKey] ? [jsonObj[currentKey]] : [];
        }
        jsonObj[currentKey].push(plain);
        formattedLines.push(`<div class="chat-line">${plain}</div>`);
        plainLines.push(plain);
      }
    });
    // Flatten JSON: single-item arrays become strings
    const finalJson: any = {};
    Object.keys(jsonObj).forEach(k => {
      if (Array.isArray(jsonObj[k]) && jsonObj[k].length === 1) finalJson[k] = jsonObj[k][0];
      else finalJson[k] = jsonObj[k];
    });
    return {
      html: formattedLines.join(''),
      plain: plainLines.join('\n'),
      json: finalJson
    };
  }

  cleanTableValue(value: any): string[] {
    if (!value) return [];
    let arr = Array.isArray(value) ? value : [value];
    return arr.map(v =>
      v
        .toString()
        .replace(/^[-•]\s*/, '')  // remove bullets
        .replace(/^\d+\.\s*/, '') // remove numbering
        .replace(/\*\*/g, '')     // remove bold markers
        .trim()
    );
  }

  cleanTextValue(value: string): string {
    return value
      .replace(/\*\*/g, '')        // remove bold markers
      .replace(/^[-*]\s*/, '• ')  // dashes/asterisks/bullets → bullet
      .trim();
  }

  cleanJsonValue(value: string): string {
    return value
      .replace(/\\"/g, '"')
      .replace(/\*\*/g, '')        // remove bold markers
      .replace(/^\d+\.\s*/, '')    // remove numbering
      .replace(/^[-*•]\s*/, '')    // remove bullets/dashes
      .replace(/^\/(.*)\/$/, '$1')
      .trim();
  }

formatResponse(text: string): {
  plain: string;
  html: string;
  table: { headers: string[], rows: Record<string, string | string[]>[] };
  json: any;
  explanation?: string;
} {
  if (!text) {
    return {
      plain: '',
      html: '<div>No response</div>',
      table: { headers: [], rows: [] },
      json: {},
      explanation: ''
    };
  }

  // Clean escaped characters
  const cleanText = (str: string): string => {
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\')
      .replace(/\\+/g, '')
      .trim();
  };

  // Clean markdown patterns from text for display purposes
  const cleanMarkdownForDisplay = (str: string): string => {
    if (!str) return '';
    return str
      .replace(/^#{1,6}\s+/g, '') // Remove markdown headers (# ## ### etc.)
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold markdown (**text**)
      .replace(/\*(.*?)\*/g, '$1') // Remove italic markdown (*text*)
      .replace(/`(.*?)`/g, '$1') // Remove inline code markdown (`code`)
      .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove markdown links, keep text
      .replace(/\n/g, ' ') // Replace newlines with spaces for display
      .trim();
  };

  // Clean markdown patterns but preserve newlines for table content
  const cleanMarkdownForTable = (str: string): string => {
    if (!str) return '';
    return str
      .replace(/^#{1,6}\s+/g, '') // Remove markdown headers (# ## ### etc.)
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold markdown (**text**)
      .replace(/\*(.*?)\*/g, '$1') // Remove italic markdown (*text*)
      .replace(/`(.*?)`/g, '$1') // Remove inline code markdown (`code`)
      .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove markdown links, keep text
      // Note: We DON'T replace newlines here - we want to preserve them
      .trim();
  };

  // Function to process JSON data with newlines replaced by spaces
  const processForJson = (data: any): any => {
    if (typeof data === 'string') {
      return cleanMarkdownForDisplay(data);
    } else if (Array.isArray(data)) {
      return data.map(item => processForJson(item));
    } else if (typeof data === 'object' && data !== null) {
      const result: any = {};
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          result[key] = processForJson(data[key]);
        }
      }
      return result;
    }
    return data;
  };

  // New function to transform hierarchy into a more appropriate JSON structure
  const transformHierarchyToJson = (hierarchy: any[]): any => {
    if (!hierarchy || hierarchy.length === 0) return {};
    
    const result: any = {};
    
    // Check if we have a single H1 with H2 children (original case)
    if (hierarchy.length === 1 && hierarchy[0].children && hierarchy[0].children.length > 0) {
      const h1Node = hierarchy[0];
      const h1Key = cleanMarkdownForTable(h1Node.text);
      result[h1Key] = {};
      
      // Process H2 sections
      h1Node.children.forEach((h2Node: any) => {
        const h2Key = cleanMarkdownForTable(h2Node.text);
        
        // If this H2 has children (H3s), create a nested structure
        if (h2Node.children && h2Node.children.length > 0) {
          result[h1Key][h2Key] = {};
          
          // Process H3 sections
          h2Node.children.forEach((h3Node: any) => {
            const h3Key = cleanMarkdownForTable(h3Node.text);
            result[h1Key][h2Key][h3Key] = cleanMarkdownForTable(h3Node.content);
          });
        } 
        // If no H3s, just add the content directly
        else {
          result[h1Key][h2Key] = cleanMarkdownForTable(h2Node.content);
        }
      });
    } 
    // Handle multiple sections at the same level (user's case)
    else {
      // Process each top-level section
      hierarchy.forEach((section: any) => {
        const sectionKey = cleanMarkdownForTable(section.text);
        
        // If this section has children, create a nested structure
        if (section.children && section.children.length > 0) {
          result[sectionKey] = {};
          
          // Add the main content if it exists
          if (section.content) {
            result[sectionKey]["Content"] = cleanMarkdownForTable(section.content);
          }
          
          // Process child sections
          section.children.forEach((child: any) => {
            const childKey = cleanMarkdownForTable(child.text);
            
            // If this child has its own children, create a deeper nested structure
            if (child.children && child.children.length > 0) {
              result[sectionKey][childKey] = {};
              
              child.children.forEach((grandchild: any) => {
                const grandchildKey = cleanMarkdownForTable(grandchild.text);
                result[sectionKey][childKey][grandchildKey] = cleanMarkdownForTable(grandchild.content);
              });
            } 
            // If no grandchildren, just add the content directly
            else {
              result[sectionKey][childKey] = cleanMarkdownForTable(child.content);
            }
          });
        } 
        // If no children, just add the content directly
        else {
          result[sectionKey] = cleanMarkdownForTable(section.content);
        }
      });
    }
    
    return result;
  };

  // Enhanced markdown to HTML converter
  const convertMarkdownToHtml = (str: string): string => {
    if (!str) return '';
    
    // === REMOVE PSV BLOCK BEFORE ANY PROCESSING ===
    let cleanedStr = str
      .replace(/```psv[\s\S]*?```/gi, '')
      .replace(/<pre><code class="language-psv"[\s\S]*?<\/code><\/pre>/gi, '')
      .replace(/<pre><code[\s\S]*?psv[\s\S]*?<\/code><\/pre>/gi, '')
      .replace(/\n\s*\n\s*\n\s*\n/g, '\n\n')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    // First escape HTML to prevent XSS
    let html = cleanedStr
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    
    // Convert markdown headers to HTML headers
    html = html.replace(/^#{1,6}\s+(.+)$/gm, (match, content) => {
      const level = match.match(/^#+/)[0].length;
      return `<h${level} style="margin-top: 16px; margin-bottom: 8px; color: #333;">${content.replace(/^#{1,6}\s+/, '')}</h${level}>`;
    });
    
    // Convert bold markdown (**text**) to HTML <strong>
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Convert italic markdown (*text*) to HTML <em>
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Convert inline code markdown (`code`) to HTML <code>
    html = html.replace(/`(.*?)`/g, '<code style="background-color: #f4f4f4; padding: 2px 4px; border-radius: 3px;">$1</code>');
    
    // Convert markdown links to HTML links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #0066cc;">$1</a>');
    
    // Convert markdown tables to HTML tables
    const lines = html.split('\n');
    let inTable = false;
    let tableHtml = '';
    let headerProcessed = false;
    let resultHtml = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.includes('|') && !line.match(/^#{1,6}\s/)) {
        const cells = line.split('|').map(cell => cell.trim()).filter(cell => cell);
        
        if (cells.every(cell => /^[\s\-\|:]+$/.test(cell))) {
          headerProcessed = true;
          continue;
        }
        
        if (!inTable) {
          inTable = true;
          tableHtml = '<table style="border-collapse: collapse; width: 100%; margin: 16px 0;">';
          tableHtml += '<thead><tr style="background-color: #f2f2f2;">';
          cells.forEach(cell => {
            tableHtml += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left; font-weight: bold;">${cell}</th>`;
          });
          tableHtml += '</tr></thead><tbody>';
        } else {
          tableHtml += '<tr>';
          cells.forEach(cell => {
            tableHtml += `<td style="border: 1px solid #ddd; padding: 8px;">${cell}</td>`;
          });
          tableHtml += '</tr>';
        }
      } else {
        if (inTable) {
          tableHtml += '</tbody></table>';
          resultHtml += tableHtml;
          tableHtml = '';
          inTable = false;
          headerProcessed = false;
        }
        resultHtml += line + '<br>';
      }
    }
    
    if (inTable) {
      tableHtml += '</tbody></table>';
      resultHtml += tableHtml;
    }
    
    html = resultHtml;
    
    // Convert markdown lists to HTML lists
    const listLines = html.split('<br>');
    let listStack: string[] = [];
    let listResult: string[] = [];
    
    for (const line of listLines) {
      const trimmed = line.trim();
      const listMatch = trimmed.match(/^(\s*)[-*+]\s+(.+)$/);
      const orderedListMatch = trimmed.match(/^(\s*)\d+\.\s+(.+)$/);
      
      if (listMatch || orderedListMatch) {
        const indent = listMatch ? listMatch[1] : orderedListMatch[1];
        const content = listMatch ? listMatch[2] : orderedListMatch[2];
        const indentLevel = Math.floor(indent.length / 2);
        const listType = listMatch ? 'ul' : 'ol';
        
        while (listStack.length > indentLevel) {
          const closingTag = listStack.pop();
          listResult.push(`</${closingTag}>`);
        }
        
        while (listStack.length < indentLevel) {
          listStack.push(listType);
          listResult.push(`<${listType} style="margin-left: 20px; margin-top: 8px;">`);
        }
        
        listResult.push(`<li style="margin-bottom: 4px;">${content}</li>`);
      } else {
        while (listStack.length > 0) {
          const closingTag = listStack.pop();
          listResult.push(`</${closingTag}>`);
        }
        listResult.push(line);
      }
    }
    
    while (listStack.length > 0) {
      const closingTag = listStack.pop();
      listResult.push(`</${closingTag}>`);
    }
    
    html = listResult.join('<br>');
    html = html.replace(/<br><br>/g, '<br>');
    
    return html;
  };

  text = cleanText(text);
  const originalText = text;
  const originalLines = text.split('\n');

  const escapeHtml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // === PSV Block Detection & Special Handling (Improved) ===
  // Catches: ```psv, ```psv testcases, ```psv anything, etc.
  const psvTables = extractPsvTables(text)
  if(psvTables?.length) {
    return {
        plain: text,
        html: this.md.render(text),
        table: { headers: psvTables[0].headers, rows: psvTables[0].rows },
        tables: psvTables,
        json: tablesToCsvJson(psvTables),
        explanation: text
      };
  }

  const psvBlockMatch = text.match(/```psv[\s\S]*?```/i);
  if (psvBlockMatch) {
    const psvContent = psvBlockMatch[0]; // Full matched block including ```psv
    const psvInnerContent = psvBlockMatch[0].replace(/```psv/i, '').replace(/```$/, '').trim();

    const psvLines = psvInnerContent.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));

    if (psvLines.length >= 2) {
      const parsePSVRow = (line: string) => line.split('|').map(cell => cell.trim()).filter(Boolean);

      let headers = parsePSVRow(psvLines[0]);
      const dataRows = psvLines.slice(1).map(parsePSVRow).filter(row => row.length > 0);

      if (headers.length === 0 && dataRows.length > 0) {
        headers = dataRows[0];
      }

      const tableRows = dataRows.map(row => {
        const obj: Record<string, string> = {};
        headers.forEach((header, i) => {
          obj[header] = row[i] || '';
        });
        return obj;
      });

      // Strong cleaning for all views
      const cleanedText = originalText
        .replace(/```psv[\s\S]*?```/gi, '')           // Main removal
        .replace(/\n\s*\n\s*\n\s*\n/g, '\n\n')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();

      const htmlTable = `
        <div style="overflow-x:auto; margin:16px 0;">
          <table style="border-collapse: collapse; width:100%; font-size:14px; border:1px solid #ddd;">
            <thead>
              <tr style="background:#e9e9e9;">
                ${headers.map(h => `<th style="border:1px solid #ddd; padding:12px; text-align:left; font-weight:bold;">${escapeHtml(h)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${tableRows.map(row => `
                <tr>
                  ${headers.map(h => `
                    <td style="border:1px solid #ddd; padding:10px; white-space:pre-wrap; vertical-align:top;">
                      ${escapeHtml(row[h] || '')}
                    </td>
                  `).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;

      return {
        plain: cleanedText,
        html: `<div style="padding: 16px; background: #f8f8f8; border: 1px solid #eee; border-radius: 8px; font-size: 14px;">${convertMarkdownToHtml(cleanedText)}</div>`,
        table: { headers, rows: tableRows },
        json: processForJson(tableRows.length === 1 ? tableRows[0] : tableRows),
        explanation: cleanedText
      };
    }
  }

  // === Test Case Format Detection ===
// Check if the text follows the test case format with H2 sections and H3 subsections
const hasH2Sections = originalLines.some(l => /^##[^#]/.test(l));
const hasH3Subsections = originalLines.some(l => /^###/.test(l));
const hasTestCaseHeaders = originalLines.some(l => /^##\s+(Test Case|Scenario|Test)\s+\d+:/.test(l));

if (hasH2Sections && hasH3Subsections && hasTestCaseHeaders) {
  // Extract the common prefix from test case headers
  const testCaseHeaders = originalLines
    .filter(l => /^##\s+(Test Case|Scenario|Test)\s+\d+:/.test(l))
    .map(l => l.trim().match(/^##\s+(Test Case|Scenario|Test)\s+\d+:\s*(.*)$/));
  
  // Extract the prefix pattern (e.g., "Test Case", "Scenario", "Test")
  const prefixPattern = testCaseHeaders.length > 0 
    ? testCaseHeaders[0][0].match(/^##\s+(Test Case|Scenario|Test)/)[1] 
    : 'Test Case';
  
  // Parse test cases
  const testCases: Record<string, Record<string, string>>[] = [];
  let currentTestCase: Record<string, string> = {};
  let currentSection = '';
  let currentContent = '';
  
  for (const line of originalLines) {
    const trimmed = line.trim();
    
    // Check for new test case - make the pattern more flexible
    const testCaseMatch = trimmed.match(new RegExp(`^##\\s+${prefixPattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s+\\d+:\\s*(.*)$`));
    if (testCaseMatch) {
      // Save the previous test case if it exists
      if (Object.keys(currentTestCase).length > 0) {
        testCases.push(currentTestCase);
      }
      
      // Start a new test case
      currentTestCase = {
        [prefixPattern]: testCaseMatch[1]
      };
      currentSection = '';
      currentContent = '';
      continue;
    }
    
    // Check for new section within a test case
    const sectionMatch = trimmed.match(/^###\s*(.*?):?\s*$/);
    if (sectionMatch) {
      // Save the previous section if it exists
      if (currentSection && currentContent) {
        currentTestCase[currentSection] = currentContent.trim();
      }
      
      // Start a new section
      currentSection = sectionMatch[1];
      currentContent = '';
      continue;
    }
    
    // Skip separator lines
    if (trimmed === '---') {
      continue;
    }
    
    // Add content to the current section
    if (currentSection && trimmed) {
      currentContent += (currentContent ? '\n' : '') + trimmed;
    }
  }
  
  // Save the last section and test case
  if (currentSection && currentContent) {
    currentTestCase[currentSection] = currentContent.trim();
  }
  if (Object.keys(currentTestCase).length > 0) {
    testCases.push(currentTestCase);
  }
  
  // Get all unique section names to use as headers
  const allSections = new Set<string>();
  testCases.forEach(testCase => {
    Object.keys(testCase).forEach(key => {
      if (key !== prefixPattern) {
        allSections.add(key);
      }
    });
  });
  
  const headers = [prefixPattern, ...Array.from(allSections)];
  
  // Create the HTML table
  let html = '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;border:1px solid #ddd;font-size:14px">';
  
  // Header row
  html += '<tr style="background:#e9e9e9;">';
  headers.forEach(header => {
    html += `<th style="border:1px solid #ddd;padding:12px;text-align:left;font-weight:bold;">${escapeHtml(header)}</th>`;
  });
  html += '</tr>';
  
  // Data rows
  testCases.forEach(testCase => {
    html += '<tr>';
    headers.forEach(header => {
      html += '<td style="border:1px solid #ddd;padding:10px;vertical-align:top;white-space:pre-wrap;">';
      
      if (header === prefixPattern) {
        html += escapeHtml(testCase[prefixPattern] || '');
      } else {
        html += escapeHtml(testCase[header] || '');
      }
      
      html += '</td>';
    });
    html += '</tr>';
  });
  
  html += '</table></div>';
  
  // Create table data structure
  const tableRows = testCases.map(testCase => {
    const row: Record<string, string> = {};
    headers.forEach(header => {
      row[header] = testCase[header] || '';
    });
    return row;
  });
  
  // Create JSON structure
  const jsonOutput = testCases;
  
  return {
    plain: originalText,
    html: html,
    table: { headers, rows: tableRows },
    json: processForJson(jsonOutput),
    explanation: originalText
  };
}

  // === Enhanced Multi-Space Separated Table Detection ===
  // Check if the first line has multiple spaces separating what looks like headers
  const firstLine = originalLines[0];
  if (firstLine && !firstLine.includes('\t') && firstLine.match(/\s{3,}/)) {
    // Split by multiple spaces (3 or more)
    const rawHeaders = firstLine.split(/\s{3,}/).map(h => h.trim());
    
    // Check if we have repeated headers (like "TestcaseID:" appearing multiple times)
    const headerCounts: Record<string, number> = {};
    rawHeaders.forEach(header => {
      headerCounts[header] = (headerCounts[header] || 0) + 1;
    });
    
    // If we have repeated headers, we need to handle this specially
    const hasRepeatedHeaders = Object.values(headerCounts).some(count => count > 1);
    
    if (hasRepeatedHeaders && originalLines.length > 1) {
      // Get the unique headers
      const uniqueHeaders = Object.keys(headerCounts);
      const numColumns = uniqueHeaders.length;
      
      // Initialize content for each column
      const columnContents: string[][] = Array(numColumns).fill(null).map(() => []);
      
      // Process the rest of the lines
      for (let i = 1; i < originalLines.length; i++) {
        const line = originalLines[i];
        if (!line.trim()) continue;
        
        // Split by multiple spaces
        const cells = line.split(/\s{3,}/).map(cell => cell.trim());
        
        // Group cells by header type
        let columnIndex = 0;
        let currentColumnContent = '';
        
        for (let j = 0; j < cells.length; j++) {
          const cell = cells[j];
          currentColumnContent += (currentColumnContent ? ' ' : '') + cell;
          
          // Check if we've completed a full set of headers
          if ((j + 1) % rawHeaders.length === 0 || j === cells.length - 1) {
            if (columnIndex < numColumns) {
              columnContents[columnIndex].push(currentColumnContent);
              columnIndex++;
              currentColumnContent = '';
            }
          }
        }
      }
      
      // Create a cleaner JSON structure
      const jsonObject: any = {};
      
      uniqueHeaders.forEach((header, index) => {
        const content = columnContents[index].join('\n');
        jsonObject[header] = content;
      });
      
      // Create the HTML table
      let html = '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;border:1px solid #ddd;font-size:14px">';
      
      // Header row
      html += '<tr style="background:#e9e9e9;">';
      uniqueHeaders.forEach(header => {
        html += `<th style="border:1px solid #ddd;padding:12px;text-align:left;font-weight:bold;min-width:300px;">${escapeHtml(header)}</th>`;
      });
      html += '</tr>';
      
      // Content row
      html += '<tr>';
      uniqueHeaders.forEach(header => {
        html += '<td style="border:1px solid #ddd;padding:10px;vertical-align:top;white-space:pre-wrap;">';
        html += escapeHtml(jsonObject[header]);
        html += '</td>';
      });
      html += '</tr>';
      
      html += '</table></div>';
      
      // Create table data structure
      const tableRows = [{}];
      uniqueHeaders.forEach(header => {
        tableRows[0][header] = jsonObject[header];
      });
      
      return {
        plain: originalText,
        html: html,
        table: { headers: uniqueHeaders, rows: tableRows },
        json: processForJson(jsonObject),
        explanation: originalText
      };
    } else {
      // Original logic for non-repeated headers
      const headers = rawHeaders;
      const numColumns = headers.length;
      
      // Initialize content for each column
      const columnContents: string[][] = Array(numColumns).fill(null).map(() => []);
      
      // Process the rest of the lines
      for (let i = 1; i < originalLines.length; i++) {
        const line = originalLines[i];
        if (!line.trim()) continue;
        
        // Split by multiple spaces and ensure we have the right number of columns
        const cells = line.split(/\s{3,}/);
        
        // If we don't have enough cells, pad with empty strings
        while (cells.length < numColumns) {
          cells.push('');
        }
        
        // Add content to each column
        for (let j = 0; j < numColumns; j++) {
          if (cells[j] && cells[j].trim()) {
            columnContents[j].push(cells[j]);
          }
        }
      }
      
      // Create a cleaner JSON structure
      const jsonObject: any = {};
      
      headers.forEach((header, index) => {
        const content = columnContents[index].join('\n');
        jsonObject[header] = content;
      });
      
      // Create the HTML table
      let html = '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;border:1px solid #ddd;font-size:14px">';
      
      // Header row
      html += '<tr style="background:#e9e9e9;">';
      headers.forEach(header => {
        html += `<th style="border:1px solid #ddd;padding:12px;text-align:left;font-weight:bold;min-width:300px;">${escapeHtml(header)}</th>`;
      });
      html += '</tr>';
      
      // Content row
      html += '<tr>';
      headers.forEach(header => {
        html += '<td style="border:1px solid #ddd;padding:10px;vertical-align:top;white-space:pre-wrap;">';
        html += escapeHtml(jsonObject[header]);
        html += '</td>';
      });
      html += '</tr>';
      
      html += '</table></div>';
      
      // Create table data structure
      const tableRows = [{}];
      headers.forEach(header => {
        tableRows[0][header] = jsonObject[header];
      });
      
      return {
        plain: originalText,
        html: html,
        table: { headers, rows: tableRows },
        json: processForJson(jsonObject),
        explanation: originalText
      };
    }
  }

  // === Hierarchical Nested Table Parser ===
const hasHeaders = originalLines.some(l => /^#{1,6}\s+/.test(l));

if (hasHeaders) {
  // Function to build hierarchical structure
  const buildHierarchy = (lines: string[]): any => {
    const result = [];
    const stack = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '---') continue;
      
      // Check for header
      const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        const level = headerMatch[1].length;
        const text = headerMatch[2].trim();
        
        // Create new node
        const node = {
          level,
          text,
          content: '',
          children: []
        };
        
        // Find the right parent in the stack
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }
        
        // Add to parent or root
        if (stack.length === 0) {
          result.push(node);
        } else {
          stack[stack.length - 1].children.push(node);
        }
        
        // Add to stack
        stack.push(node);
      } 
      // It's content, add to current node
      else if (stack.length > 0) {
        stack[stack.length - 1].content += 
          (stack[stack.length - 1].content ? '\n' : '') + trimmed;
      }
    }
    
    return result;
  };
  
  // Build the hierarchy
  const hierarchy = buildHierarchy(originalLines);
  
  // Check if we have multiple H1 sections with H2 children (test cases)
  const isTestCasesFormat = 
    hierarchy.length >= 2 && 
    hierarchy.every(n => n.level === 1 && n.children && n.children.length >= 1);
  
  // More flexible condition to handle various header structures
  const hasValidTableStructure = 
    // Case 1: 1 H1 with multiple H2s (original case)
    (hierarchy.length === 1 && hierarchy[0].children && hierarchy[0].children.length >= 2) ||
    // Case 2: Multiple H1s at root level (test cases)
    isTestCasesFormat ||
    // Case 3: Multiple H2s at root level
    (hierarchy.length >= 2 && hierarchy.every(n => n.level === 2)) ||
    // Case 4: Multiple H3s at root level
    (hierarchy.length >= 2 && hierarchy.every(n => n.level === 3)) ||
    // Case 5: Any level with multiple siblings at the same level
    (hierarchy.length >= 2 && hierarchy.every(n => n.level === hierarchy[0].level));
  
  if (hasValidTableStructure) {
    // Determine the sections to use as columns
    let sections: any[] = [];
    
    if (hierarchy.length === 1 && hierarchy[0].children && hierarchy[0].children.length >= 2) {
      // Case 1: Use H2 sections under H1
      sections = hierarchy[0].children;
    } else if (isTestCasesFormat) {
      // Case 2: Use H1 sections (test cases)
      sections = hierarchy;
    } else {
      // Cases 3, 4, 5: Use root level sections
      sections = hierarchy;
    }
    
    // Function to generate nested table HTML for a section
    const generateNestedTableForSection = (section: any): string => {
      const subSections = section.children || [];
      
      let tableHtml = '<table style="border-collapse:collapse;width:100%;border:1px solid #ddd;">';
      
      // Add description first if it exists
      if (section.content) {
        tableHtml += '<tr>';
        tableHtml += '<td colspan="' + (subSections.length || 1) + '" style="border:1px solid #ddd;padding:8px;background:#f9f9f9;white-space:pre-wrap;">';
        tableHtml += escapeHtml(section.content);
        tableHtml += '</td>';
        tableHtml += '</tr>';
      }
      
      // If we have subsections, create a nested table
      if (subSections.length > 0) {
        // Header row for nested table with actual section names as headers
        tableHtml += '<tr style="background:#e8e8e8;">';
        subSections.forEach(subSection => {
          tableHtml += `<th style="border:1px solid #ddd;padding:8px;text-align:left;font-weight:bold;font-size:13px;">${escapeHtml(subSection.text)}</th>`;
        });
        tableHtml += '</tr>';
        
        // Content row - each sub-section's content in its own column
        tableHtml += '<tr>';
        subSections.forEach(subSection => {
          tableHtml += `<td style="border:1px solid #ddd;padding:8px;vertical-align:top;white-space:pre-wrap;">${escapeHtml(subSection.content)}</td>`;
        });
        tableHtml += '</tr>';
        
        // If sub-sections have their own children, add them as additional rows
        const maxChildren = Math.max(...subSections.map((s: any) => s.children ? s.children.length : 0));
        if (maxChildren > 0) {
          for (let i = 0; i < maxChildren; i++) {
            tableHtml += '<tr>';
            subSections.forEach(subSection => {
              tableHtml += '<td style="border:1px solid #ddd;padding:8px;vertical-align:top;white-space:pre-wrap;">';
              if (subSection.children && subSection.children[i]) {
                tableHtml += `<div style="font-weight:bold;margin-bottom:5px;">${escapeHtml(subSection.children[i].text)}</div>`;
                tableHtml += escapeHtml(subSection.children[i].content);
              }
              tableHtml += '</td>';
            });
            tableHtml += '</tr>';
          }
        }
      }
      
      tableHtml += '</table>';
      return tableHtml;
    };
    
    // Generate the main HTML table with nested tables
    let html = '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;border:1px solid #ddd;font-size:14px">';
    
    // Header row with sections
    html += '<tr style="background:#e9e9e9;">';
    sections.forEach(section => {
      html += `<th style="border:1px solid #ddd;padding:12px;text-align:left;font-weight:bold;min-width:300px;">${escapeHtml(section.text)}</th>`;
    });
    html += '</tr>';
    
    // Content row with nested tables in each cell
    html += '<tr>';
    sections.forEach(section => {
      html += '<td style="border:1px solid #ddd;padding:5px;vertical-align:top;">';
      html += generateNestedTableForSection(section);
      html += '</td>';
    });
    html += '</tr>';
    
    html += '</table></div>';
    
    // Create table data structure with HTML nested tables in cells
    const tableHeaders = sections.map(s => s.text);
    const tableRows = [{}];
    
    // For each section, create an HTML string containing the nested table
    sections.forEach(section => {
      const subSections = section.children || [];
      
      // Create HTML for the nested table that will be rendered
      let nestedTableHtml = '<table class="table table-sm" style="font-size:12px;">';
      
      // Add description if it exists
      if (section.content) {
        nestedTableHtml += '<tr><td colspan="' + (subSections.length || 1) + '" style="background:#f8f9fa;">';
        nestedTableHtml += escapeHtml(section.content).replace(/\n/g, '<br>');
        nestedTableHtml += '</td></tr>';
      }
      
      // Add headers with actual section names
      if (subSections.length > 0) {
        nestedTableHtml += '<tr>';
        subSections.forEach(child => {
          nestedTableHtml += `<th style="width:40%;">${escapeHtml(child.text)}</th>`;
        });
        nestedTableHtml += '</tr>';
        
        // Add content row
        nestedTableHtml += '<tr>';
        subSections.forEach(child => {
          nestedTableHtml += `<td style="white-space:pre-wrap;">${escapeHtml(child.content)}</td>`;
        });
        nestedTableHtml += '</tr>';
        
        // If sub-sections have their own children, add them as additional rows
        const maxChildren = Math.max(...subSections.map((s: any) => s.children ? s.children.length : 0));
        if (maxChildren > 0) {
          for (let i = 0; i < maxChildren; i++) {
            nestedTableHtml += '<tr>';
            subSections.forEach(subSection => {
              nestedTableHtml += '<td style="white-space:pre-wrap;">';
              if (subSection.children && subSection.children[i]) {
                nestedTableHtml += `<div style="font-weight:bold;margin-bottom:5px;">${escapeHtml(subSection.children[i].text)}</div>`;
                nestedTableHtml += escapeHtml(subSection.children[i].content);
              }
              nestedTableHtml += '</td>';
            });
            nestedTableHtml += '</tr>';
          }
        }
      }
      
      nestedTableHtml += '</table>';
      
      // Store the HTML string in the table cell
      tableRows[0][section.text] = nestedTableHtml;
    });
    
    // Transform the hierarchy into a more appropriate JSON structure
    const jsonStructure = transformHierarchyToJson(hierarchy);
    
    return {
      plain: originalText,
      html: html,
      table: { headers: tableHeaders, rows: tableRows },
      json: processForJson(jsonStructure),
      explanation: originalText
    };
  }
}
    
  // If not a hierarchical structure, try other table formats
  // === Tab-Separated Epic Table Detection ===
  // Check if the first line has tabs and looks like epic headers
  const firstLineForTabs = originalLines[0];
  if (firstLineForTabs && firstLineForTabs.includes('\t')) {
    // Parse the first line as headers
    const headers = firstLineForTabs.split('\t').map(h => h.trim());
    const numColumns = headers.length;
    
    // Initialize content for each column
    const columnContents: string[][] = Array(numColumns).fill(null).map(() => []);
    
    // Process the rest of the lines
    for (let i = 1; i < originalLines.length; i++) {
      const line = originalLines[i];
      if (!line.trim()) continue;
      
      // Split by tabs and ensure we have the right number of columns
      const cells = line.split('\t');
      
      // If we don't have enough cells, pad with empty strings
      while (cells.length < numColumns) {
        cells.push('');
      }
      
      // Add content to each column
      for (let j = 0; j < numColumns; j++) {
        if (cells[j] && cells[j].trim()) {
          columnContents[j].push(cells[j]);
        }
      }
    }
    
    // Process each column to extract hierarchical structure
    const processedColumns = columnContents.map(content => {
      const result: any = {
        description: '',
        subItems: {}
      };
      
      let currentSubItem = '';
      let currentContent = '';
      
      for (const line of content) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // Check if this line is a sub-item header (H2)
        const h2Match = trimmed.match(/^##\s+(.+)$/);
        if (h2Match) {
          // Save the previous sub-item if we were in one
          if (currentSubItem && currentContent) {
            result.subItems[currentSubItem] = currentContent;
          }
          
          // Start a new sub-item
          currentSubItem = h2Match[1];
          currentContent = '';
          continue;
        }
        
        // Regular content line
        if (currentSubItem) {
          // Add to the current sub-item content
          currentContent += (currentContent ? '\n' : '') + trimmed;
        } else {
          // Add to the description
          result.description += (result.description ? '\n' : '') + trimmed;
        }
      }
      
      // Don't forget the last sub-item
      if (currentSubItem && currentContent) {
        result.subItems[currentSubItem] = currentContent;
      }
      
      return result;
    });
    
    // Create the hierarchical data structure
    const hierarchicalData: any = {};
    headers.forEach((header, index) => {
      hierarchicalData[header] = processedColumns[index];
    });
    
    // Generate HTML table with nested content for each top-level item
    let html = '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;border:1px solid #ddd;font-size:14px">';
    
    // Header row with top-level items
    html += '<tr style="background:#e9e9e9;">';
    headers.forEach(header => {
      html += `<th style="border:1px solid #ddd;padding:12px;text-align:left;font-weight:bold;min-width:300px;">${escapeHtml(header)}</th>`;
    });
    html += '</tr>';
    
    // Content row with nested content in each cell
    html += '<tr>';
    headers.forEach(header => {
      html += '<td style="border:1px solid #ddd;padding:5px;vertical-align:top;">';
      
      // Add top-level description
      if (hierarchicalData[header].description) {
        html += `<div style="margin-bottom:10px;font-style:italic;">${escapeHtml(hierarchicalData[header].description)}</div>`;
      }
      
      // Add sub-items for this top-level item
      const subItems = hierarchicalData[header].subItems || {};
      Object.entries(subItems).forEach(([subItemName, subItemContent]) => {
        html += '<div style="margin-bottom:15px;">';
        html += `<div style="font-weight:bold;margin-bottom:5px;background:#f0f0f0;padding:5px;border-radius:4px;">${escapeHtml(subItemName)}</div>`;
        
        // Check if the sub-item content has nested structure (e.g., lists)
        const contentLines = (subItemContent as string).split('\n');
        let hasNestedStructure = false;
        
        // Check for list items or other nested structures
        for (const line of contentLines) {
          if (line.trim().match(/^[-*+]\s+/) || line.trim().match(/^\d+\.\s+/)) {
            hasNestedStructure = true;
            break;
          }
        }
        
        if (hasNestedStructure) {
          // Format as a list
          html += '<ul style="margin:0;padding-left:20px;">';
          let currentList = [];
          let inList = false;
          
          for (const line of contentLines) {
            const trimmedLine = line.trim();
            
            if (trimmedLine.match(/^[-*+]\s+/)) {
              if (inList && currentList.length > 0) {
                currentList.forEach(item => {
                  html += `<li style="margin-bottom:5px;">${escapeHtml(item)}</li>`;
                });
                currentList = [];
              }
              inList = true;
              currentList.push(trimmedLine.replace(/^[-*+]\s+/, ''));
            } else if (trimmedLine.match(/^\d+\.\s+/)) {
              if (inList && currentList.length > 0) {
                currentList.forEach(item => {
                  html += `<li style="margin-bottom:5px;">${escapeHtml(item)}</li>`;
                });
                currentList = [];
              }
              inList = true;
              currentList.push(trimmedLine.replace(/^\d+\.\s+/, ''));
            } else if (inList) {
              if (currentList.length > 0) {
                currentList[currentList.length - 1] += ' ' + trimmedLine;
              }
            } else {
              if (inList && currentList.length > 0) {
                currentList.forEach(item => {
                  html += `<li style="margin-bottom:5px;">${escapeHtml(item)}</li>`;
                });
                currentList = [];
                inList = false;
              }
              html += `<div style="margin-bottom:5px;">${escapeHtml(trimmedLine)}</div>`;
            }
          }
          
          if (inList && currentList.length > 0) {
            currentList.forEach(item => {
              html += `<li style="margin-bottom:5px;">${escapeHtml(item)}</li>`;
            });
          }
          
          html += '</ul>';
        } else {
          // Format as regular text with preserved newlines
          html += `<div style="white-space:pre-wrap;">${escapeHtml(subItemContent as string)}</div>`;
        }
        
        html += '</div>';
      });
      
      html += '</td>';
    });
    html += '</tr>';
    
    html += '</table></div>';
    
    // Create table data structure with nested HTML tables
    const tableRows = [{}];
    
    headers.forEach(header => {
      // Create a nested HTML table for this column
      let nestedHtml = '<table style="border-collapse:collapse;width:100%;border:1px solid #ddd;font-size:13px;">';
      
      // Add top-level description
      if (hierarchicalData[header].description) {
        nestedHtml += '<tr>';
        nestedHtml += '<td style="border:1px solid #ddd;padding:8px;background:#f9f9f9;font-style:italic;">';
        nestedHtml += escapeHtml(hierarchicalData[header].description);
        nestedHtml += '</td>';
        nestedHtml += '</tr>';
      }
      
      // Add sub-items
      const subItems = hierarchicalData[header].subItems || {};
      Object.entries(subItems).forEach(([subItemName, subItemContent]) => {
        nestedHtml += '<tr>';
        nestedHtml += '<td style="border:1px solid #ddd;padding:8px;">';
        
        // Add sub-item header
        nestedHtml += `<div style="font-weight:bold;margin-bottom:5px;background:#f0f0f0;padding:5px;border-radius:4px;">${escapeHtml(subItemName)}</div>`;
        
        // Add sub-item content
        nestedHtml += `<div style="white-space:pre-wrap;">${escapeHtml(subItemContent as string)}</div>`;
        
        nestedHtml += '</td>';
        nestedHtml += '</tr>';
      });
      
      nestedHtml += '</table>';
      
      tableRows[0][header] = nestedHtml;
    });
    
    return {
      plain: originalText,
      html: html,
      table: { headers, rows: tableRows },
      json: processForJson(hierarchicalData),
      explanation: originalText
    };
  }

  // === User Story Format Detection ===
  const hasUserStoryFormat = originalLines.some(l => /^#{1,3}\s+(User|Feature|Epic|Story)/i.test(l));
  
  if (hasUserStoryFormat) {
    const jsonObject: Record<string, string> = {};
    let parentHeader = '';
    let parentValue = '';
    let parentLevel = 0;
    let currentHeader = '';
    let currentValue = '';
    let currentLevel = 0;
    
    for (const line of originalLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Check if this line is a header
      const headerMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (headerMatch) {
        const headerLevel = headerMatch[1].length;
        const headerText = headerMatch[2];
        
        // If this is a top-level header (User Story, Epic, etc.)
        if (/^(User|Feature|Epic|Story)/i.test(headerText)) {
          // Save the previous nested header and value if they exist
          if (currentHeader && currentValue) {
            parentValue += (parentValue ? '\n' : '') + currentHeader + '\n' + currentValue;
          }
          
          // Save the previous parent header and value if they exist
          if (parentHeader && parentValue) {
            jsonObject[cleanMarkdownForTable(parentHeader)] = cleanMarkdownForTable(parentValue);
          }
          
          // Start a new parent header
          parentHeader = headerMatch[0];
          parentValue = '';
          parentLevel = headerLevel;
          currentHeader = '';
          currentValue = '';
          currentLevel = 0;
        } 
        // If this is a nested header (Acceptance Criteria, Definition of Done, etc.)
        else if (parentHeader) {
          // Save the current nested header and value if they exist
          if (currentHeader && currentValue) {
            parentValue += (parentValue ? '\n' : '') + currentHeader + '\n' + currentValue;
          }
          
          // Start a new nested header
          currentHeader = headerMatch[0];
          currentValue = '';
          currentLevel = headerLevel;
        }
        continue;
      }
      
      // If it's not a header, add to the current value
      if (currentHeader) {
        currentValue += (currentValue ? '\n' : '') + trimmed;
      } else if (parentHeader) {
        parentValue += (parentValue ? '\n' : '') + trimmed;
      }
    }
    
    // Don't forget the last nested header and value
    if (currentHeader && currentValue) {
      parentValue += (parentValue ? '\n' : '') + currentHeader + '\n' + currentValue;
    }
    
    // Don't forget the last parent header and value
    if (parentHeader && parentValue) {
      jsonObject[cleanMarkdownForTable(parentHeader)] = cleanMarkdownForTable(parentValue);
    }
    
    // Create the HTML table
    const headers = Object.keys(jsonObject);
    const htmlTable = `
      <div style="overflow-x:auto; margin: 16px 0;">
        <table style="border-collapse: collapse; width:100%; font-size:14px; border:1px solid #ddd;">
          <thead>
            <tr style="background:#f8f8f8;">
              ${headers.map(h => `<th style="border:1px solid #ddd; padding:10px; text-align:left; font-weight:bold;">${escapeHtml(h)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              ${headers.map(h => {
                const val = jsonObject[h];
                // Preserve newlines in table cells by using white-space: pre-wrap
                return `<td style="border:1px solid #ddd; padding:10px; white-space:pre-wrap; vertical-align:top;">${escapeHtml(val)}</td>`;
              }).join('')}
            </tr>
          </tbody>
        </table>
      </div>`;
    
    return {
      plain: originalText,
      html: htmlTable,
      table: { headers, rows: [jsonObject] },
      json: processForJson(jsonObject), // Process for JSON view with spaces instead of newlines
      explanation: originalText
    };
  }

  // === 1. Pipe Table Detection ===
  const hasPipeLines = originalLines.some(line => (line.trim().match(/\|/g) || []).length >= 2);
  if (hasPipeLines) {
    let tableHeaders: string[] = [];
    let tableRows: string[][] = [];
    let foundHeader = false;
    for (const line of originalLines) {
      if (!line.includes('|')) continue;
      let cells = line.split('|').map(cell => cell.trim());
      if (cells[0] === '') cells.shift();
      if (cells[cells.length - 1] === '') cells.pop();
      const isSeparator = cells.every(cell => /^[\s:-]*$/.test(cell));
      if (isSeparator) continue;
      if (!foundHeader && cells.length > 0) {
        tableHeaders = cells;
        foundHeader = true;
      } else if (foundHeader && cells.length === tableHeaders.length) {
        tableRows.push(cells);
      }
    }
    if (tableHeaders.length > 1 && tableRows.length > 0) {
      const jsonRows = tableRows.map(row => {
        const obj: Record<string, string> = {};
        tableHeaders.forEach((header, i) => {
          // Use cleanMarkdownForTable to preserve newlines in values
          obj[header] = cleanMarkdownForTable(row[i] || '');
        });
        return obj;
      });
      
      // Filter out headers with empty content while preserving order
      const usefulHeaders = tableHeaders.filter(header =>
        jsonRows.some(row => {
          const val = row[header]?.trim();
          return val && val.length > 0 && val !== '---' && val !== '-';
        })
      );
      
      const finalRows = jsonRows.map(row => {
        const filtered: Record<string, string> = {};
        usefulHeaders.forEach(h => {
          // Use cleanMarkdownForTable to ensure no markdown patterns remain but preserve newlines
          filtered[h] = cleanMarkdownForTable(row[h] || '');
        });
        return filtered;
      });
      
      // For single row tables, return a simple object
      const jsonOutput = finalRows.length === 1 ? finalRows[0] : finalRows;
      
      const plainMarkdown = originalText;
      const htmlRaw = `<div style="padding: 16px; background: #f8f8f8; border: 1px solid #eee; border-radius: 8px; font-size: 14px;">${convertMarkdownToHtml(plainMarkdown)}</div>`;
      return {
        plain: plainMarkdown,
        html: htmlRaw,
        table: { headers: usefulHeaders, rows: finalRows },
        json: processForJson(jsonOutput), // Process for JSON view with spaces instead of newlines
        explanation: originalText
      };
    }
  }

  // === Tab/Space aligned Test Case Table Detection ===
  const nonEmptyLines = originalLines.filter(l => l.trim());
  const looksLikeTabTestCases =
    nonEmptyLines.length > 3 &&
    /\s*/i.test(nonEmptyLines[0]) &&
    (nonEmptyLines[0].includes('\t') || nonEmptyLines[0].match(/\s{2,}/));

  if (looksLikeTabTestCases) {
    const headers: string[] = [];
    const rawRows: string[][] = [];
    let inHeader = true;

    for (const line of originalLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let cells: string[];
      if (line.includes('\t')) {
        cells = line.split('\t').map(c => c.trim());
      } else {
        cells = line.split(/\s{2,}/).map(c => c.trim());
      }

      while (cells.length > 0 && !cells[0]) cells.shift();
      while (cells.length > 0 && !cells[cells.length - 1]) cells.pop();

      if (cells.length < 3) continue;

      if (inHeader) {
        // Skip adding first cell if it looks like a document title
        let potentialHeaders = cells;
        headers.push(...potentialHeaders.filter(h => h && h.trim()));
        inHeader = false;
        continue;
      }

      // Data row
      if (cells.length >= headers.length - 1) { // be flexible
        while (cells.length < headers.length) cells.push('');
        rawRows.push(cells);
      }
    }

    if (headers.length >= 4 && rawRows.length > 0) {
      const tableRows = rawRows.map(cells => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = (cells[i] || '').trim();
        });
        return obj;
      });

      // Extra filter: remove any header that is still empty in all rows while preserving order
      const usefulHeaders = headers.filter(header =>
        tableRows.some(row => {
          const val = row[header]?.trim();
          return val && val.length > 0 && val !== '---' && val !== '-';
        })
      );

      const finalRows = tableRows.map(row => {
        const filtered: Record<string, string> = {};
        usefulHeaders.forEach(h => {
          // Use cleanMarkdownForTable to ensure no markdown patterns remain but preserve newlines
          filtered[h] = cleanMarkdownForTable(row[h] || '');
        });
        return filtered;
      });

      // For single row tables, return a simple object
      const jsonOutput = finalRows.length === 1 ? finalRows[0] : finalRows;

      // Nice HTML table with numbered list for Steps
      const htmlTable = `
        <div style="overflow-x:auto; margin: 16px 0;">
          <table style="border-collapse: collapse; width:100%; font-size:14px; border:1px solid #ddd;">
            <thead>
              <tr style="background:#f8f8f8;">
                ${usefulHeaders.map(h => `<th style="border:1px solid #ddd; padding:10px; text-align:left; font-weight:bold;">${escapeHtml(h)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${finalRows.map(row => `
                <tr>
                  ${usefulHeaders.map(h => {
                    let val = row[h];
                    if (h.toLowerCase().includes('steps') && /^\d+\./m.test(val)) {
                      const items = val
                        .split('\n')
                        .map(l => l.trim())
                        .filter(Boolean)
                        .map(l => escapeHtml(l.replace(/^\d+[.)]\s*/, '')));
                      return `<td style="border:1px solid #ddd; padding:10px; white-space:pre-wrap; vertical-align:top;">
                        <ol style="margin:0; padding-left:24px; line-height:1.6;">${items.map(i => `<li>${i}</li>`).join('')}</ol>
                      </td>`;
                    }
                    // Preserve newlines in table cells by using white-space: pre-wrap
                    return `<td style="border:1px solid #ddd; padding:10px; white-space:pre-wrap; vertical-align:top;">${escapeHtml(val)}</td>`;
                  }).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>`;

      return {
        plain: originalText,
        html: htmlTable,
        table: { headers: usefulHeaders, rows: finalRows },
        json: processForJson(jsonOutput), // Process for JSON view with spaces instead of newlines
        explanation: originalText
      };
    }
  }

  // === Section-Based Key-Value Table (## sections + **Key:**) ===
  const h2Sections = originalLines.filter(l => /^##[^#]/.test(l));
  const hasKeyEndingInColon = originalLines.some(l => !l.startsWith('#') && /^\*\*[^:]+\*\*:/.test(l));

  if (h2Sections.length >= 1 && hasKeyEndingInColon) {
    const rows: Record<string, string>[] = [];
    const headersList: string[] = []; // Using array instead of Set to preserve order
    let currentRow: Record<string, string> = {};

    for (const line of originalLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/^##[^#]/.test(trimmed)) {
        if (Object.keys(currentRow).length > 0 && Object.values(currentRow).some(v => v.trim())) {
          rows.push({ ...currentRow });
        }
        currentRow = {};
        continue;
      }

      const kvMatch = trimmed.match(/^\*\*([^:]+)\*\*:\s*(.*)$/);
      if (kvMatch) {
        const key = kvMatch[1].trim();
        // Use cleanMarkdownForTable to preserve newlines in values
        let value = cleanMarkdownForTable(kvMatch[2].trim());
        
        // Add to headers list only if not already present
        if (!headersList.includes(key)) {
          headersList.push(key);
        }
        
        currentRow[key] = value;
        continue;
      }

      const lastKey = Object.keys(currentRow).pop();
      if (lastKey && trimmed && !trimmed.startsWith('**') && !trimmed.startsWith('#')) {
        currentRow[lastKey] = (currentRow[lastKey] || '').trimEnd() + '\n' + trimmed;
      }
    }

    if (Object.keys(currentRow).length > 0 && Object.values(currentRow).some(v => v.trim())) {
      rows.push({ ...currentRow });
    }

    // Filter out headers with empty content while preserving order
    const usefulHeaders = headersList.filter(header =>
      rows.some(row => {
        const val = row[header]?.trim();
        return val && val.length > 0 && val !== '---' && val !== '-';
      })
    );
    
    const finalRows = rows.map(row => {
      const obj: Record<string, string> = {};
      usefulHeaders.forEach(h => {
        // Use cleanMarkdownForTable to ensure no markdown patterns remain but preserve newlines
        obj[h] = cleanMarkdownForTable(row[h] || '');
      });
      return obj;
    });

    // For single row tables, return a simple object
    const jsonOutput = finalRows.length === 1 ? finalRows[0] : finalRows;

    return {
      plain: originalText,
      html: `<div style="padding: 16px; background: #f8f8f8; border: 1px solid #eee; border-radius: 8px; font-size: 14px;">${convertMarkdownToHtml(originalText)}</div>`,
      table: { headers: usefulHeaders, rows: finalRows },
      json: processForJson(jsonOutput), // Process for JSON view with spaces instead of newlines
      explanation: originalText
    };
  }

  const h3Sections = originalLines.filter(l => /^###/.test(l));
  if (h3Sections.length >= 3) { // Require at least 3 sections to consider this a test case
    const rows: Record<string, string>[] = [];
    const headersList: string[] = [];
    let currentRow: Record<string, string> = {};
    let currentHeader: string = '';
    let currentValue: string = '';

    for (const line of originalLines) {
      const trimmed = line.trim();
      
      // Check for a new section header
      const headerMatch = trimmed.match(/^###\s*(.*?):?\s*$/);
      if (headerMatch) {
        // Save the previous section if it exists
        if (currentHeader && currentValue) {
          if (!headersList.includes(currentHeader)) {
            headersList.push(currentHeader);
          }
          currentRow[currentHeader] = cleanMarkdownForTable(currentValue);
        }
        
        // Start a new section
        currentHeader = headerMatch[1].trim();
        currentValue = '';
        continue;
      }
      
      // Add content to the current section
      if (currentHeader) {
        currentValue += (currentValue ? '\n' : '') + trimmed;
      }
    }
    
    // Don't forget the last section
    if (currentHeader && currentValue) {
      if (!headersList.includes(currentHeader)) {
        headersList.push(currentHeader);
      }
      currentRow[currentHeader] = cleanMarkdownForTable(currentValue);
    }
    
    // Only proceed if we have meaningful data
    if (headersList.length >= 3 && Object.keys(currentRow).length > 0) {
      rows.push(currentRow);
      
      const finalRows = rows.map(row => {
        const obj: Record<string, string> = {};
        headersList.forEach(h => {
          obj[h] = cleanMarkdownForTable(row[h] || '');
        });
        return obj;
      });
      
      // For single row tables, return a simple object
      const jsonOutput = finalRows.length === 1 ? finalRows[0] : finalRows;
      
      return {
        plain: originalText,
        html: `<div style="padding: 16px; background: #f8f8f8; border: 1px solid #eee; border-radius: 8px; font-size: 14px;">${convertMarkdownToHtml(originalText)}</div>`,
        table: { headers: headersList, rows: finalRows },
        json: processForJson(jsonOutput), // Process for JSON view with spaces instead of newlines
        explanation: originalText
      };
    }
  }

  // === Robust Test Case Parser ===
  if (h2Sections.length >= 1) {
    const rows: Record<string, string>[] = [];
    const headersList: string[] = []; // Using array instead of Set to preserve order
    let currentRow: Record<string, string> = {};
    let lastKey: string | null = null;

    for (const line of originalLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/^##\s*/.test(trimmed)) {
        if (Object.keys(currentRow).length > 0 && Object.values(currentRow).some(v => v.trim())) {
          rows.push({ ...currentRow });
        }
        currentRow = {};
        lastKey = null;
        continue;
      }

      const kvMatch = trimmed.match(/^(?:\*\*)?\s*([^:*]+?)\s*(?:\*\*)?\s*[:：]\s*(.*)$/i);
      if (kvMatch) {
        let key = kvMatch[1].trim().replace(/\*\*/g, '');
        // Use cleanMarkdownForTable to preserve newlines in values
        let value = cleanMarkdownForTable(kvMatch[2].trim().replace(/^\*\*|\*\*$/g, ''));
        
        // Add to headers list only if not already present
        if (!headersList.includes(key)) {
          headersList.push(key);
        }
        
        currentRow[key] = value;
        lastKey = key;
        continue;
      }

      if (lastKey && trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('**')) {
        currentRow[lastKey] = (currentRow[lastKey] || '').trimEnd() + '\n' + trimmed;
      }
    }

    if (Object.keys(currentRow).length > 0 && Object.values(currentRow).some(v => v.trim())) {
      rows.push({ ...currentRow });
    }

    // Filter out headers with empty content while preserving order
    const usefulHeaders = headersList.filter(header =>
      rows.some(row => {
        const val = row[header]?.trim();
        return val && val.length > 0 && val !== '---' && val !== '-';
      })
    );
    
    const finalRows = rows.map(row => {
      const obj: Record<string, string> = {};
      usefulHeaders.forEach(h => {
        // Use cleanMarkdownForTable to ensure no markdown patterns remain but preserve newlines
        obj[h] = cleanMarkdownForTable(row[h] || '');
      });
      return obj;
    });

    // For single row tables, return a simple object
    const jsonOutput = finalRows.length === 1 ? finalRows[0] : finalRows;

    if (finalRows.length > 0 && usefulHeaders.length >= 4) {
      return {
        plain: originalText,
        html: `<div style="padding: 16px; background: #f8f8f8; border: 1px solid #eee; border-radius: 8px; font-size: 14px;">${convertMarkdownToHtml(originalText)}</div>`,
        table: { headers: usefulHeaders, rows: finalRows },
        json: processForJson(jsonOutput), // Process for JSON view with spaces instead of newlines
        explanation: originalText
      };
    }
  }

  const colonHeaders = [];
  const colonValues = [];
  let currentHeader = '';
  let currentValue = '';
  let isCollectingValue = false;
  
  // Split the text into lines and process
  const lines = originalText.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Check if this line ends with a colon and could be a header
    if (line.endsWith(':') && !line.startsWith('#')) {
      // Save the previous header-value pair if we have one
      if (currentHeader && currentValue) {
        colonHeaders.push(currentHeader);
        colonValues.push(currentValue);
      }
      
      // Start a new header
      currentHeader = line.slice(0, -1); // Remove the trailing colon
      currentValue = '';
      isCollectingValue = true;
      continue;
    }
    
    // If we're collecting a value and this line has content, add it
    if (isCollectingValue && line) {
      // Check if the next line is also a potential header
      const nextLine = i < lines.length - 1 ? lines[i + 1].trim() : '';
      const isNextLineHeader = nextLine.endsWith(':') && !nextLine.startsWith('#');
      
      // If this is the last line before a new header, add it without a newline
      if (isNextLineHeader) {
        currentValue += (currentValue ? ' ' : '') + line;
      } else {
        // Otherwise, add it with a newline
        currentValue += (currentValue ? '\n' : '') + line;
      }
    }
  }
  
  // Don't forget the last header-value pair
  if (currentHeader && currentValue) {
    colonHeaders.push(currentHeader);
    colonValues.push(currentValue);
  }
  
  // If we found at least one header-value pair, create a table
  if (colonHeaders.length > 0) {
    // Create the table row object
    const tableRow: Record<string, string> = {};
    colonHeaders.forEach((header, index) => {
      tableRow[header] = colonValues[index];
    });
    
    // Create the HTML table
    let htmlTable = '<div style="overflow-x:auto; margin: 16px 0;">';
    htmlTable += '<table style="border-collapse: collapse; width:100%; font-size:14px; border:1px solid #ddd;">';
    
    // Header row
    htmlTable += '<tr style="background:#f8f8f8;">';
    colonHeaders.forEach(header => {
      htmlTable += `<th style="border:1px solid #ddd; padding:10px; text-align:left; font-weight:bold;">${escapeHtml(header)}</th>`;
    });
    htmlTable += '</tr>';
    
    // Content row
    htmlTable += '<tr>';
    colonValues.forEach(value => {
      // Preserve newlines in table cells by using white-space: pre-wrap
      htmlTable += `<td style="border:1px solid #ddd; padding:10px; white-space:pre-wrap; vertical-align:top;">${escapeHtml(value)}</td>`;
    });
    htmlTable += '</tr>';
    
    htmlTable += '</table></div>';
    
    // Create the JSON object
    const jsonObject: Record<string, string> = {};
    colonHeaders.forEach((header, index) => {
      jsonObject[header] = colonValues[index];
    });
    
    return {
      plain: originalText,
      html: htmlTable,
      table: { headers: colonHeaders, rows: [tableRow] },
      json: processForJson(jsonObject),
      explanation: originalText
    };
  }

  // === Default: Plain text ===
  return {
    plain: originalText,
    html: `<div style="padding: 16px; background: #f8f8f8; border: 1px solid #eee; border-radius: 8px; font-size: 14px;">${convertMarkdownToHtml(originalText)}</div>`,
    table: { headers: [], rows: [] },
    json: {},
    explanation: originalText
  };
}
 
formatWorkflowResponse(text) {
    let stringToProcess = '';
  if (typeof text === 'string') {
    stringToProcess = text;
  } else if (typeof text === 'object' && text !== null) {
    const stringValues = Object.values(text).filter(
      (value) => typeof value === 'string'
    );
    stringToProcess = stringValues.join('\n\n'); 
  }

  const textForMarkdown = repairTableStructure(stringToProcess);
  let markdownTables = extractMarkdownTables(textForMarkdown);
  let finalTables = markdownTables;
  let finalJson = tablesToCsvJson(finalTables);

  // If no markdown tables found, try to create one from the text
  if (finalTables.length === 0) {
    console.log('DEBUG: No markdown tables found in workflow response. Attempting to parse as structured text...');
    
    // Use the formatResponse function to parse key-value pairs or other structures
    const formattedData = this.formatResponse(stringToProcess);
    
    console.log('DEBUG: Output from formatResponse for workflow:', formattedData.table);
    console.log('DEBUG: JSON output from formatResponse for workflow:', formattedData.json);
    
    // If formatResponse successfully created a table, use it
    if (formattedData.table.headers.length > 0) {
      console.log('DEBUG: Using table generated by formatResponse for workflow.');
      finalTables = [formattedData.table];
      finalJson = formattedData.json;
    } else {
      console.log('DEBUG: formatResponse could not create a table for workflow response either.');
    }
  }

  let serializedBddJson = parseSerializedBddJson(stringToProcess || '');
  const bddJson = extractJsonFromMarkdown(stringToProcess);

  if (bddJson) {
    finalTables = transformBddJsonToMarkdownTables(normalizeBddJSON(bddJson))
    finalJson = tablesToCsvJson(finalTables);
  } else if (serializedBddJson) {
    finalTables = transformBddJsonToMarkdownTables(serializedBddJson)
    finalJson = tablesToCsvJson(finalTables);
  }

  return {
    plain: stringToProcess,
    html: this.md.render(textForMarkdown),
    table: finalTables.length > 0 ? finalTables[0] : { headers: [], rows: [] },
    tables: finalTables,
    json: finalJson,
    serializedBddJson: bddJson || serializedBddJson,
    explanation: stringToProcess
  };
}


  getJsonKeys(json: any): string[] {
    return Object.keys(json);
  }

  asArray(value: any): any[] {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value]; // wrap string or number in array
  }

  isArray(value: any): boolean {
    return Array.isArray(value);
  }

  isObject(value: any): boolean {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  closeChat(): void {

     if (this.cameFromPromptRepository) {
    console.log('Returning to Prompt Repository...');

    this.isFromPromptRepository = false;
    this.cameFromPromptRepository = false;   

    this._router.navigate(['/marketplace/promptrepository']).then(() => {
      window.location.reload();
      console.log('Successfully navigated back to Prompt Repository');
    });

    return;
  }

  
    const tooltips = document.querySelectorAll('.tooltip, [class*="tooltip"], [role="tooltip"]');
    tooltips.forEach(tooltip => {
      tooltip.classList.remove('show', 'active', 'visible');
      (tooltip as HTMLElement).style.display = 'none';
      (tooltip as HTMLElement).style.visibility = 'hidden';
      (tooltip as HTMLElement).style.opacity = '0';
      tooltip.remove();
    });

    if (this.isChatSubmitted) {
      // Reset to new chat state but keep chat open
      this.isChatSubmitted = false;
      this.isagentrouted = false;
      this.isWorkflowrouted = false;
      this.isWorkflowrouted1 = false;
      this.isConversationStarted = false;
      this.userQuery = '';
      this.userQuery1 = '';
      this.chatMessages = [];
      this.chatResponses = [];
	  this.loadRecentData();
      this.selectedAgent = null;
      this.selectedAgentOption = null;
	  this.isSuggestionLoading = false;
	  this.secondryAgentId = '';
    this.resetSelectedQueries();
      this.showThinking = false;
      this.isLoading = false;
      this.currentLoaderStep = 0;
      this.isChatOpenedByAgent = false;
      this.isChatMinimized = false;

      // Clear state services but don't navigate
      this._stateService.setSelectedAgency(null);
      this._stateService.setSelectedWorkflow(null);
      this._stateService.setWorkflowDetails(null);
      this._stateService.clearWorkflowDetails();

      // Keep chat open in new state
      this.isNewChatOpen = true;
      return; // Skip the complete close logic
    }

    // If we're in initial state (isNewChatOpen), close completely
    this.isChatOpen = false;
    this.isNewChatOpen = false;
    this.isChatSubmitted = false;
    this.isConversationStarted = false;
    this.userQuery = '';
    this.userQuery1 = '';
    this.chatMessages = [];
    this.chatResponses = [];
	this.loadRecentData();
    this.selectedAgent = null;
    this.selectedAgentOption = null;
	this.isSuggestionLoading = false;
    this.resetSelectedQueries();
    this.showThinking = false;
    this.isLoading = false;
    this.currentLoaderStep = 0;
    this.isChatOpenedByAgent = false;
    this.isChatMinimized = false;
    this._stateService.setSelectedAgency(null);
    this._stateService.setSelectedWorkflow(null);
    this._stateService.setWorkflowDetails(null);
    this._stateService.clearWorkflowDetails();

    if (this.agentId) {
      this.routefromagent = false;
      this.isagentrouted = false;
      this.explanationtab = false;
      // this._router.navigate(['/commandcenterdashboard']);
      // window.location.href = '/commandcenterdashboard';
      // window.location.href = config.refUrl;
      this._router.navigate(['/commandcenterdashboard'], { queryParams: { tab: 'task' } }).then(() => {
        window.location.reload();
      });
    }
    this._stateService.setSelectedWorkflow(null);
    this._stateService.setWorkflowDetails(null);
    this._stateService.clearWorkflowDetails();
    if (this.workflowIdFromState) {  // ← FIXED
      this.routefromagent = false;
      this.isWorkflowrouted = false;
      this.isWorkflowrouted1 = false;
      this.isWorkflowReviewMode = false;
      this.explanationtab = false;
      this.workflowIdFromState = null;
      this.workflowDetails = null; this._router.navigate(['/commandcenterdashboard'], { queryParams: { tab: 'workflow' } }).then(() => {
        window.location.reload();
      });
    }
   
  }


  toggleMinimizeChat(): void {
    this.isChatMinimized = !this.isChatMinimized;
  }
  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
  }

    downloadChatResponses(download = true, index = -1): void | string {
    console.log("downloadChatResponses")
    if (!this.chatResponses || this.chatResponses.length === 0) return;

    let responses = this.chatResponses.filter((_, index) => this.selectedResponseIndex[index]);
    if(!responses.length) responses = this.chatResponses;

    if (this.currentView === 'table') {
      // Export as CSV
      let csvContent = '';
      responses.forEach(res => {
        
        if (this.renderTables(res)) {
          csvContent += jsonToCsv(res?.serializedBddJson ? tablesToCsvJson(res?.tables ||[]) : res.json)
          csvContent += '\n';
        } else {
          const headers = res.table.headers;
          if (headers.length) {
            csvContent += headers.join(',') + '\n';
            res.table.rows.forEach((row: any) => {
              const rowData = headers.map((h: string) => {
                const vals = this.cleanTableValue(row[h]);
                const val = vals.join('; ');
                return `"${val.replace(/"/g, '""')}"`; // escape quotes
              });
              csvContent += rowData.join(',') + '\n';
            });
            csvContent += '\n';
          }
      }
      });
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
      FileSaver.saveAs(blob, `chatbot_responses_table_${new Date().getTime()}.csv`);
    }
    else if (this.currentView === 'json') {
      // Export as JSON file
      const allJson = responses.map(res => res?.serializedBddJson || res.json);
      const blob = new Blob(
        [JSON.stringify(allJson, null, 2)],
        { type: 'application/json;charset=utf-8' }
      );
      FileSaver.saveAs(blob, `chatbot_responses_${new Date().getTime()}.json`);
    }
    else {
      // Export as TXT
      let content = '';
      responses.forEach(res => {
        if (this.currentView === 'text') {
          let text = res.plain.replace(PSV_REGEX, '')
          if (res.title && text && !text.includes(res.title)) text = res.title + "\n\n" + text
          content += text + '\n\n';

        if(index < responses.length -1)
          content += '\n---\n\n'
        }
      });

      if (!download) return responses.map(item => item.html).join("<br/><br />");

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      FileSaver.saveAs(blob, `chatbot_responses_text_${new Date().getTime()}.txt`);
    }

    this.selectedResponseIndex = {}
  }
  copyChatResponses(): void {
    console.log('Copy button clicked');
    console.log('Current state - isWorkflowrouted:', this.isWorkflowrouted);
    console.log('Current state - isWorkflowrouted1:', this.isWorkflowrouted1);
    console.log('Current view:', this.currentView);

    let responses: any[] = [];

    // Determine which response array to use based on current state
    if (this.isWorkflowrouted) {
      responses = this.chatResponses; // Using chatResponses for isWorkflowrouted
      console.log('Using chatResponses, length:', responses.length);
    } else if (this.isWorkflowrouted1) {
      responses = this.chatResponses; // Using chatResponses for isWorkflowrouted1
      console.log('Using chatResponses, length:', responses.length);
    } else {
      responses = this.chatResponses;
      console.log('Using default chatResponses, length:', responses.length);
    }

    if (Object.keys(this.selectedResponseIndex).length) { 
      let filteredResponses = responses.filter((_, index) => this.selectedResponseIndex[index]);
      responses = filteredResponses.length ? filteredResponses: responses;
    }

    if (!responses || responses.length === 0) {
      console.warn('No responses to copy');
      return;
    }
    let content = '';

    // Generate content based on current view
    responses.forEach(res => {
      if (this.currentView === 'text') {
        content += res.plain.replace(PSV_REGEX, '') + '\n\n';
      } else if (this.currentView === 'table') {
        const headers = res.table.headers;
        if (headers.length) {
          content += headers.join('\t') + '\n';
          res.table.rows.forEach((row: any) => {
            const rowData = headers.map((h: string) => this.cleanTableValue(row[h]).join('; '));
            content += rowData.join('\t') + '\n';
          });
          content += '\n';
        }
      } else if (this.currentView === 'json') {
        content += JSON.stringify(res.json, null, 2) + '\n\n';
      }
    });

    console.log('Content to copy length:', content.length);

    // Copy to clipboard
    if (content.trim()) {
      navigator.clipboard.writeText(content)
        .then(() => {
          console.log('Content copied to clipboard successfully');
          this.showTooltip();
        })
        .catch(err => {
          console.error('Clipboard copy failed:', err);

        });
    } else {
      console.warn('No content to copy');
    }
  }
  showTooltip() {
    if (!this.copyTooltip) return;
    const tooltipEl = this.copyTooltip.nativeElement as HTMLElement;
    tooltipEl.classList.add('show');
    setTimeout(() => {
      tooltipEl.classList.remove('show');
    }, 2000);
  }

  toggleSidebar() {
    this.isSidebarExpanded = !this.isSidebarExpanded;
	this.loadRecentData();
  }
  toggleSidebarPin() {
    this.isSidebarPinned = !this.isSidebarPinned;
    this.isSidebarExpanded = this.isSidebarPinned; // if pinned, keep expanded
  }
  startLoading() {
    this.isLoading = true;
    // this.showStepsDynamically();
    this.showThinking = false;
    this.currentLoaderStep = -1;
  }

  startAgentChat(agent: any): void {
    console.log("Hi");
    this.isSidebarExpanded = false;
    this.isNewChatOpen = true;
    this.selectedAgent = agent;
    console.log("agent-id", this.selectedAgent)
    this.isChatSubmitted = true;
    this.showWelcomePanel = true;
    this.latestUserQuery = '';
    this.chatResponses = [];
    this.chatMessages = [];
    this.selectedAgentOption = null;
	this.isSuggestionLoading = false;
    this.resetSelectedQueries();
    this.secondaryAgents = [];
    this.showThinking = false;
    this.isLoading = false;
    this.currentLoaderStep = 0;
    this.isChatOpenedByAgent = true;
	this.resetFeedbackState();
	this.isRecentChat = false;


    const payload = { agent_id: agent.agent_id };

    this._marketService.GetAgentAndOrder2Agents(payload).subscribe({
      next: (res) => {
          // this.selectedAgent = res.main_agent;
          this.secondaryAgents = res.data.order_2_agents || [];
          this.cdRef.detectChanges();
          console.log("order2agents:", this.secondaryAgents)
          this.loadRecentData(agent.agent_id); // Load recent data for the selected agent
      },
      error: (err) => {
        const error = getApiError(err) 
        if(error) {
          console.warn('API did not return expected structure', error);
          return;
        }
        console.error('Failed to fetch agent details:', err);
      }
    });
  }

  startAgentChat1(agent: any, query: any): void {
    // Hide all tooltips via directive
    const tooltips = document.querySelectorAll('.tooltip, [class*="tooltip"], [role="tooltip"]');
    tooltips.forEach(tooltip => {
      tooltip.classList.remove('show', 'active', 'visible');
      (tooltip as HTMLElement).style.display = 'none';
      (tooltip as HTMLElement).style.visibility = 'hidden';
      (tooltip as HTMLElement).style.opacity = '0';
      tooltip.remove();
    });
    this.isRecentChat = false;
    this.isNewChatOpen = true;
    this.selectedAgent = agent;
    console.log("agent-id", this.selectedAgent)
    this.isChatSubmitted = true;
    this.showWelcomePanel = true;
    this.latestUserQuery = '';
    this.chatResponses = [];
    this.chatMessages = [];
    this.selectedAgentOption = null;
	this.isSuggestionLoading = false;
	this.secondryAgentId = '';
    this.resetSelectedQueries();
    this.secondaryAgents = [];
    this.showThinking = false;
    this.isLoading = false;
    this.currentLoaderStep = 0;
    this.isChatOpenedByAgent = true;
    

    const payload = { agent_id: agent.agent_id };

    this._marketService.GetAgentAndOrder2Agents(payload).subscribe({
      next: (res) => {
          // this.selectedAgent = res.main_agent;
          this.secondaryAgents = res.data.order_2_agents || [];
          this.cdRef.detectChanges();
          console.log("order2agents:", this.secondaryAgents)
          this.loadRecentData(agent.agent_id);
      },
      error: (err) => {
        const error = getApiError(err)
        if(error) {
          console.warn('API did not return expected structure', error);
          return
        }
        console.error('Failed to fetch agent details:', err);
      }
    });
    this.userQuery1 = query;
    this.onInputChange1();
    this.handleOption(agent.subagent.name, agent.subagent.agent_id);
  }

    handleOption(agentName: string, agentId: string) {
    console.log("Selected option:", agentName, agentId);
 
    // Reset session when user selects a new secondary agent
    this.resetChatSession();
	
	this.isSuggestionLoading = true;
	this.resetSelectedQueries();
 
    this.chatMessages = []; 
    this.chatResponses = []; 
    this.selectedAgentOption = agentName;
    this.chatMessages.push({ from: 'user', text: agentName });
    this.chatMessages.push({
      from: 'agent',
      text: `Great! To generate ${agentName}, I'll need your input. Please share them with me.`
    });
 
    this.secondryAgentId = agentId;
    this.showAgentPrompt = true;
    this.showThinking = false;
    this.logsDuringLoading = [];
    this.isThinkingCollapsed = true;
    this.hasRealLogs = false;
    this.isProcessingCompleted = false;
    this.completionMessageReceived = false;
    this.selectedResponseIndex = {};
	
    if (this.selectedAgent) {
      this.loadAlreadySelectedAgent(this.secondryAgentId,[]);
    }
	
    this.cdRef.detectChanges();
}

// Method to control visibility of Recent Queries section
  shouldShowRecentQueries(): boolean {
    return !!this.selectedAgentOption && this.isSuggestionLoading === true;
  }

  isGreatMessage(text: string): boolean {
    return text.startsWith('Great! To generate');
  }

  onMouseEnter(): void {
    if (!this.isSidebarPinned) {
      this.isSidebarExpanded = true;
      this.cdRef.detectChanges();
    }
  }

  onMouseLeave(): void {
    if (!this.isSidebarPinned) {
      this.isSidebarExpanded = false;
      this.cdRef.detectChanges();
    }
  }


  sendMessageToAgent(message: string): void {
    this.latestUserQuery = message;
    this.submitQuery(this.secondryAgentId);
  }

  isCodeBlock(res: string): boolean {
    return this.gherkinKeywords.some(keyword => res.includes(keyword));
  }

  formatGherkinCode(res: string): string {
    const escapedKeywords = this.gherkinKeywords
      .map(k => k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')) // escape special characters
      .join('|');

    const keywordRegex = new RegExp(`\\b(${escapedKeywords})\\b`, 'g');
    return res.replace(keywordRegex, '<span class="keyword-code-block">$1</span>');
  }

  minimizeChat(): void {
    this.isChatInProgressBeforeMinimize = this.isChatSubmitted;
    this.isNewChatOpenBeforeMinimize = this.isNewChatOpen;
    this.isChatMinimized = true;
    this.isChatOpen = false;
    this.isNewChatOpen = false;
  }

  restoreChat(): void {
    this.isChatMinimized = false;
    this.isChatOpen = true;
    if (this.isChatInProgressBeforeMinimize) {
      this.isNewChatOpen = true;
      this.isChatSubmitted = true;  // Resume existing conversation
    } else {
      this.isNewChatOpen = false;   // Go to initial welcome chat screen
    }
  }

  startNewChat(): void {
    // Reset all chat-related states
    this.resetEventTracking();
	this.isRecentChat = false;
    this.isFeedbackSubmitted = false;
    this.chatMessages = [];
    this.chatResponses = [];
    this.userQuery = '';
    this.userQuery1 = '';
    this.isChatSubmitted = false;
    this.showAgentPrompt = false;
    this.showThinking = false;
    this.isLoading = false;
    this.currentLoaderStep = 0;
    this.selectedAgent = null;
    this.selectedAgentOption = null;
    this.secondaryAgents = [];
	this.isSuggestionLoading = false;
    this.resetSelectedQueries();
    this.isChatOpenedByAgent = false;
    this.showWelcomePanel = false;
    this.secondryAgentId = '';
    this.recentData = [];
    // Open the initial chat page
    this.isChatOpen = true;
    this.isNewChatOpen = true;
    this.isChatMinimized = false;
    this.cdRef.detectChanges();
    this.scrollToBottom();
	this.loadRecentData();
  }

getRepositoryButtonText(): string {
  const lastRes = this.chatResponses[this.chatResponses.length - 1];
  
  // Priority for Recent Query Review
  if (this.isRecentChat && lastRes) {
    const isSaved = lastRes.isSavedToRepo === true ;

    return isSaved 
      ? 'Update in Prompt Repository' 
      : 'Save Prompt to Repository';
  }

  // Fallback for Try Prompt from Repository flow
  if (this.isFromPromptRepository && !this.isPromptUpdated) {
    return 'Update in Prompt Repository';
  }

  // Default behavior
  return this.isPromptSaved 
    ? 'Saved to Prompt Repository' 
    : 'Save Prompt to Repository';
}

canSaveOrUpdateToRepo(): boolean {
  const buttonText = this.getRepositoryButtonText();

  // If it's an Update action
  if (buttonText.includes('Update')) {
    return this.isPrivilegeEditPromptRepo;
  }

  // If it's a Save action
  return this.isPrivilegeAddPromptRepo;
}



saveOrUpdatePromptToRepository(i: number) {
  const res = this.chatResponses[i];
  if (!res) return;

  this.currentResponseToSave = res;
  this.repoTitle = res.title || this.latestUserQuery || 'Prompt from Chat';
  this.isEditingTitle = false;
  this.saveToRepoModalVisible = true;
}


directSaveToRepository() {
  if (!this.currentResponseToSave) return;

  const title = this.repoTitle.trim() || 'Untitled Prompt';
  const promptText = this.currentResponseToSave.plain || 
                     this.currentResponseToSave.explanation || 
                     this.currentResponseToSave.html || '';

  if (this.isFromPromptRepository) {
    this.updatePromptInRepository(title, promptText);
  } else {
    this.savePromptToRepository(title, promptText);
  }

  this.closeSaveToRepoModal();
}

private updatePromptInRepository(title: string, promptText: string) {
  if (!title || !promptText) {
    this.showToast('error', 'Missing content to update');
    return;
  }

  // Strong fallback chain
  let agencyId = this.currentResponseToSave?.agency_id || 
                 this.originalPromptData?.agency_id || '';

  if (!agencyId && this.isFromPromptRepository) {
    const tryData = this._stateService.getTryPromptData();
    agencyId = tryData?.query?.agency_id || tryData?.agency_id || '';
  }

  const eventId = this.currentResponseToSave?.event_id || 
                  this.originalPromptData?.event_id || '';
  const mapId = this.currentResponseToSave?.map_id || 
                  this.originalPromptData?.map_id || '';

  const payload = {
    agency_id: agencyId,
    agent_id: this.secondryAgentId || this.selectedAgent?.agent_id || '',
    prompt_title: title,
    user_query: this.currentResponseToSave?.user_query || 
                this.latestUserQuery || '',
    prompt_output: promptText,
    event_id: eventId,
    map_id: mapId
  };

  console.log("📤 FINAL Update Prompt Payload:", payload);

  this._loadingService.show();

  this.promptRepoService.UpdatePrompt(payload).subscribe({
    next: (response) => {
      this._loadingService.hide();
      if (response?.success) {
        this.showToast('success', 'Prompt updated successfully in Repository');
        this.isPromptSaved = true;
      } else {
        this.showToast('error', 'Failed to update prompt: ' + (response?.message || ''));
      }
    },
    error: (err) => {
      this._loadingService.hide();
      console.error('Update error:', err);
      this.showToast('error', 'Error updating prompt');
    }
  });
}

saveWithCustomTitle() {
  if (!this.repoTitle?.trim()) {
    this.showToast('error','Please enter a title');
    return;
  }
  this.directSaveToRepository();
}

closeSaveToRepoModal() {
  this.saveToRepoModalVisible = false;
  this.isEditingTitle = false;
  this.currentResponseToSave = null;
}

  fetchAgenciesInRepo() {
    this._loadingService.show();
    this.promptRepoService.getAgencyWithAgentsEnhanced().subscribe(
      (response) => {
        this.apiData = response.data;
        this._loadingService.hide();
        console.log('API Response:', this.apiData);
        // Trigger change detection
        this.cdr.detectChanges();
      },
      (error) => {
        console.error('Error fetching agencies:', error);
        this._loadingService.hide();
        this.cdr.detectChanges();
      }
    );
  }
  
 savePromptToRepository(title: string, promptText: string) {
  if (!title || !promptText) {
    this.showToast('error', 'Missing content to save');
    return;
  }

  const currentRes = this.currentResponseToSave || 
                     this.chatResponses[this.chatResponses.length - 1];

  if (!currentRes) {
    this.showToast('error', 'No response data found');
    return;
  }

  let userQuery = this.latestUserQuery?.trim() || currentRes.user_query || '';

 // ==================== IMPROVED AGENCY ID HANDLING ====================
  let agencyId = currentRes.agency_id || 
                 this.originalPromptData?.agency_id || '';

  if (!agencyId) {
    // Priority 1: Master agent from selectedAgent (most reliable for current context)
    const masterAgentId = this.selectedAgent?.agent_id || 
                         currentRes.master_agent_id || 
                         this.taskagentId;

    if (masterAgentId) {
      // Check in agentDetails (which comes from state service)
      if (this.agentDetails?.length) {
        const masterAgent = this.agentDetails.find((a: any) => 
          a.agent_id === masterAgentId || a.master_agent_id === masterAgentId
        );
        if (masterAgent?.agency_id) {
          agencyId = masterAgent.agency_id;
          console.log('✅ Agency resolved from master agentDetails:', agencyId);
        }
      }

      // Fallback 2: agenciesWithAgents
      if (!agencyId && this.agenciesWithAgents?.length) {
        const foundAgency = this.agenciesWithAgents.find(agency => 
          agency.agents?.some((a: any) => 
            a.agent_id === masterAgentId || 
            a.master_agent_id === masterAgentId
          )
        );
        if (foundAgency) {
          agencyId = foundAgency.agency_id;
          console.log('✅ Agency resolved from agenciesWithAgents:', agencyId);
        }
      }
    }

    // Fallback 3: Try sub-agent lookup (rarely needed)
    if (!agencyId) {
      const subAgentId = this.secondryAgentId || currentRes.agent_id;
      if (subAgentId && this.agenciesWithAgents?.length) {
        const foundAgency = this.agenciesWithAgents.find(agency =>
          agency.agents?.some((a: any) => a.agent_id === subAgentId)
        );
        if (foundAgency) agencyId = foundAgency.agency_id;
      }
    }
  }
  // ==================== MAP ID HANDLING ====================
  let mapId = currentRes.map_id || this.originalPromptData?.map_id || '';

  if (!mapId) {
    mapId = this.generateUUID();   // Generate new map_id for old data
    console.log(`Generated new map_id for old query: ${mapId}`);
  }

  const payload = {
    agency_id: agencyId,
    agent_id: this.secondryAgentId || this.selectedAgent?.agent_id || currentRes.agent_id || '',
    prompt_title: title,
    user_query: userQuery,
    prompt_output: promptText,
    event_id: currentRes.event_id || '',
    map_id: mapId
  };

  console.log("Final Save Payload (Recent/Old Chat):", payload);

  this._loadingService.show();

  this.promptRepoService.savePrompt(payload).subscribe({
    next: (response) => {
      this._loadingService.hide();
      if (response?.success) {
        this.showToast('success', 'Prompt saved to Repository successfully');
        this.isPromptSaved = true;

        // Mark as saved in UI
        if (currentRes) currentRes.isSavedToRepo = true;
        this.cdRef.detectChanges();
      } else {
        this.showToast('error', 'Failed to save to repository');
      }
    },
    error: (err) => {
      this._loadingService.hide();
      console.error('Save error:', err);
      this.showToast('error', 'Error saving to repository');
    }
  });
}


  // Called when a star in the bar or popup is clicked
    openFeedbackPopup(rating: number): void {
    if (this.isRecentChat || this.isFeedbackSubmitted) {
    this.isPopupVisible = true;
    return;
  }
    this.selectedRating = rating;
    this.hoveredRating = rating; 
    this.isPopupVisible = true;
  }
    openSubmittedFeedbackPopup(): void {
  this.isPopupVisible = true;
}
 

  // Called when the close button in popup is clicked
  closeFeedbackPopup(): void {
    this.isPopupVisible = false;
  }
  // Optional: called when the submit button is clicked


  submitFeedback1(): void {
    // Here you can add logic to send the feedback to a service or API
    console.log('Submitted Rating:', this.selectedRating);
    console.log('Submitted Feedback:', this.feedbackText);

    var param = {
      agent_id: this.secondryAgentId,
      rating: this.selectedRating,
      feedback: this.feedbackText,
      user_id: this.loggedUser.Email
    }
    this._loadingService.show();

    this._homeService.updateFeedBackDetails(param).subscribe(data => {

      if (data && data.success) {
        this._loadingService.hide();
        this.selectedRating = this.selectedRating;
        this.feedbackText = this.feedbackText
        this.cdRef.detectChanges();
      }
      else {
        this._loadingService.hide();
      }
    });

    // Clear and close popup after submit
	
    this.closeFeedbackPopup();
	this.refreshRecentData();
  }


    submitFeedback(i: number): void {
    const res = this.eventResponses[i];
    const param = {
      agent_id: this.taskagentId,
      rating: res.selectedRating,
      feedback: res.feedbackText,
      unique_id: res.event_unique_id,
      event_id: res.event_id,
      user_id: this.loggedUser.Email
    };

    this._loadingService.show();
    this._homeService.updatereviewFeedBackDetails(param).subscribe({
      next: () => {
      this._loadingService.hide();
        res.feedbackSubmitted = true;
        
        console.log('Feedback submitted for story index:', i);
    }
    });

    res.isPopupVisible = false;
  }
  openFeedbackPopup1(i: number, rating: number): void {
    const res = this.eventResponses[i];
    res.selectedRating = rating;
    res.hoveredRating = rating;
    res.isPopupVisible = true;
  }

  closeFeedbackPopup1(i: number): void {
    this.eventResponses[i].isPopupVisible = false;
  }
  // Optional: For handling star hover in the bar or popup
  onStarHover(rating: number): void {
    this.hoveredRating = rating;
  }

  onStarLeave(): void {
    this.hoveredRating = this.selectedRating;
  }

  startrouteAgent(agent: any, agent_name: any): void {
    // Hide all tooltips via directive
    const tooltips = document.querySelectorAll('.tooltip, [class*="tooltip"], [role="tooltip"]');
    tooltips.forEach(tooltip => {
      tooltip.classList.remove('show', 'active', 'visible');
      (tooltip as HTMLElement).style.display = 'none';
      (tooltip as HTMLElement).style.visibility = 'hidden';
      (tooltip as HTMLElement).style.opacity = '0';
      tooltip.remove();
    });

    this.isNewChatOpen = true;
    //this.selectedAgent = agent;
    console.log("agent-id", this.selectedAgent)
    this.isChatSubmitted = true;
    this.showWelcomePanel = true;
    this.latestUserQuery = '';
    this.chatResponses = [];
    this.chatMessages = [];
    this.selectedAgentOption = null;
    this.secondaryAgents = [];
	this.isSuggestionLoading = false;
    this.resetSelectedQueries();
    this.showThinking = false;
    this.isLoading = false;
    this.currentLoaderStep = 0;
    this.isChatOpenedByAgent = true;


    this.handleagentOption(agent, agent_name);
  }
  handleagentOption(agentId: string, agentName: string) {
    console.log("Selected option111:", agentName, agentId);
    this.chatMessages = []; // Clear previous messages
    this.chatResponses = []; // Clear previous responses
    this.selectedAgentOption = agentName;
    this.chatMessages.push({ from: 'user', text: agentName });
    this.secondryAgentId = agentId;
    this.showAgentPrompt = true; // Show the agent prompt
    this.selectedResponseIndex = {}
    this.cdRef.detectChanges();
    
  }

  //#region WORKFLOW METHODS

  LoadWorkflowDetails() {

    this.workflowBondingDetails = this.workflowDetails;
    console.log('workflowDetails:', this.workflowDetails);

        if (!this.workflowDetails || typeof this.workflowDetails !== 'object')
          return;
    
        const details = this.workflowDetails;
    
        const IsExternal = details.IsExternal || false;
        // this.isWorkFlowExternal= IsExternal;
    
        // === 2. Rebuild NODES ===
        let positions: any = {};
      
        positions = IsExternal ? this.normalizeNodePositions(details.flow_data?.flow_data?.node_positions) : details.flow_data?.flow_data?.node_positions || {};

        const rawPositions = positions;
        const tasks = details.flow_data?.tasks || [];
    
        const nodes: DynamicNode[] = [];
        const nodesFormState: any = {};
        const validNodeIds: string[] = [];
		const processedNodeIds = new Set<string>(); // Track processed IDs to prevent duplicates
    
        for (const task of tasks) {
          let type: string;
		let nodeId = "";
      if(IsExternal)
      {
        const funcLower = task.function.toLowerCase();

        if (funcLower.includes("lyzr_agent")) {
          type = "agent";
        } else if (funcLower.includes("api_call") || funcLower.includes("api")) {
          type = "api";
        } else if (
          funcLower.includes("gpt_conditional") ||
          funcLower.includes("conditional") ||
          funcLower.includes("condition")
        ) {
          type = "condition";
        } else if (funcLower.includes("gpt") || funcLower.includes("llm") || funcLower.includes("prompt")) {
          type = "llm";  // or "gpt", "prompt" — whatever key your typeMapping uses
        } else {
          // or: continue;
        }
        nodeId = task.name
    }
    else{
      let nameParts = task.name.split('-');
      if (nameParts.length < 2) nameParts = task.name.split('_');

       type = nameParts[0] as IReferenceData['type'];
       nodeId = nameParts.slice(1).join('-');
    }
          if (type === "conditional") type = "condition";
    
		// === PREVENT DUPLICATES ===
      if (processedNodeIds.has(nodeId)) {
        console.warn(`Duplicate node detected and skipped: ${nodeId}`);
        continue; // Skip this duplicate
      }
	
          const config = this.typeMapping[type];
          if (!config) continue;
    
	 // Mark as processed
      processedNodeIds.add(nodeId);
	
          const nodeData: IDragComponentConfig = {
            id: nodeId,
            label: config.label,
            icon: config.icon,
            type,
          };
    
          nodesFormState[nodeId] = this.mapTaskToFormData(task, nodeId, type);
          validNodeIds.push(nodeId);
    
          // Use saved position if valid, otherwise we'll layout later
          const savedPos = rawPositions[nodeId];
          const position =
            savedPos &&
              typeof savedPos.x === 'number' &&
              typeof savedPos.y === 'number'
              ? savedPos
              : null;
    
          nodes.push({
            id: nodeId,
            agent_id: IsExternal? type ==="condition"? nodeId: task.params.config.agent_id : task.params.config?.agent_id || null,
            Condition_false: task.params.config?.false_cond_ids?.[0] || '',
            agent_response: [],
            elapsedTime: 0,
            point: signal(position || { x: 0, y: 0 }), // temporary
            type: 'html-template',
            data: signal(nodeData),
          });
        }
    
        // === 3. AUTO-LAYOUT if positions are missing or broken ===
        const needsLayout = nodes.some((n) => !n.point() || n.point().x === 0);
    
        if (needsLayout && nodes.length > 0) {
          console.log('Applying auto-layout (horizontal, 250px spacing)');
          const startX = 100;
          const y = 150;
          const spacing = 250;
    
          nodes.forEach((node, index) => {
            node.point.set({ x: startX + index * spacing, y });
          });
        }
    
        this.nodes = nodes;
        this.nodesFormState = nodesFormState;
    
        // === 4. Rebuild EDGES – NEW + OLD + FALLBACK ===
        let edges: any[] = [];
    
        // Priority 1: Top-level edges (new workflow)
        const topLevelEdges = Array.isArray(details.edges) ? details.edges : [];
        if (topLevelEdges.length > 0) {
          edges = topLevelEdges.map((e: any, idx: number) => {
            const source = IsExternal ? e.source : this.getNodeID(e.source);
            const target = IsExternal ? e.target : this.getNodeID(e.target);
    
            console.log('Top-level edge:', { source, target });
            console.log('Edge ID:', e.id || `${source}->${target}-${Date.now()}-${idx}`, 'Type:', e.type || 'template');
    
            return {
              id: e.id || `${source}->${target}-${Date.now()}-${idx}`, // unique!
              source,
              target,
              type: e.type || 'template',
               edgeLabels: e.edgeLabels || {
            center: {
              type: 'html-template',
            },
          }    
 
            };
          });
          console.log('Loaded top-level edges:', edges.length);
        }
        // Priority 2: Nested flow_data.edges
        else {
          const nestedEdges = Array.isArray(details.flow_data?.edges)
            ? details.flow_data.edges
            : [];
          if (nestedEdges.length > 0) {
            edges = nestedEdges.map((e: any, idx: number) => {
              const source = IsExternal ? e.source : this.getNodeID(e.source);
              const target = IsExternal ? e.target : this.getNodeID(e.target);
    
              console.log('Top-level edge:', { source, target });
              console.log('Edge ID:', e.id || `${source}->${target}-${Date.now()}-${idx}`, 'Type:', e.type || 'template');
    
              return {
                id: e.id || `${source}->${target}-${Date.now()}-${idx}`,
                source,
                target,
                type: e.type || 'template',
                 edgeLabels: e.edgeLabels || {
            center: {
              type: 'html-template',
            },
          }    
 
              };
            });
          }
          // Priority 3: Generate sequential
          else if (tasks.length > 1) {
            console.log('Generating sequential edges');
            edges = tasks.slice(0, -1).map((task: { name: any }, i: number) => {
              const source = task.name;
              const target = tasks[i + 1].name;
              return {
                id: `${source}->${target}-${Date.now()}-${i}`,
                source,
                target,
                type: 'template',
              };
            });
          }
        }
    
        // === 5. Force React Flow to render edges ===
        this.edges = []; // clear
        this.cdRef.detectChanges(); // force digest
        this.edges = edges; // reassign
        this.cdRef.detectChanges();

    console.log('Final edges assigned:', this.edges.length);
    console.table(
      this.edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))
    );

    // === 5. Final UI updates ===
    this.selectedNode = undefined;
    this.cdRef.detectChanges();
  }

 normalizeNodePositions(nodePositions, padding = 50) {
  if (!nodePositions || Object.keys(nodePositions).length === 0) return {};
  
  // Find extreme coordinates to calculate required shift
  const allX = Object.values(nodePositions).map(n => n.x);
  const allY = Object.values(nodePositions).map(n => n.y);
  const minX = Math.min(...allX);
  const minY = Math.min(...allY);
  
  // Calculate single offset to bring entire graph into visible area
  const offsetX = -minX + padding;
  const offsetY = -minY + padding;
  
  // Generate new positions with consistent transformation
  const normalized = {};
  for (const [id, pos] of Object.entries(nodePositions)) {
    normalized[id] = {
      x: Math.round((pos.x + offsetX) / 20) * 20, // Snap to 20px grid
      y: Math.round((pos.y + offsetY) / 20) * 20
    };
  }
  return normalized;
}

onNodeClick(node: any) {
    this.selectedNodeData = null;
    const status = this.nodeStatus[node.id]?.status;
    if (status === 'Completed') {
      const nodeData = this.nodes.find(n => n.id === node.id);
      this.selectedNodeData = nodeData; // Show popup
    if(this.selectedNodeData?.id.toLowerCase().includes('condition') || this.selectedNodeData?.id.toLowerCase().includes('conditional') ){
      this.useIcon = true;
		}
		else
		{
		  this.useIcon = false;
		}
      this.cdRef.detectChanges();
    } else {
      const nodeData = this.nodes.find(n => n.id === node.id);

      // @ts-expect-error Condition_false missing type definition
      if (nodeData?.Condition_false) {
        this.selectedNodeData = {
          agent_response: {
            agent_name: this.conditionExecutionDetails.agent_name,
            status: this.conditionExecutionDetails.status
          },
          elapsedTime: 0,
        };
        this.cdRef.detectChanges();
      }
      else {
        this.selectedNodeData = null;
        this.cdRef.detectChanges();
      }
    }
  }
  
  getAgentDisplayName(): string {

    const details = this.workflowDetails;
    
    const IsExternal = details.IsExternal || false;

    const response = IsExternal ? this.selectedNodeData : this.selectedNodeData?.agent_response;

    if (!response) return 'Agent';


   if(IsExternal){
    if(this.selectedNodeData?.id.toLowerCase().includes('condition') || this.selectedNodeData?.id.toLowerCase().includes('conditional') ){
      return 'Condition';
    }
	else if(this.selectedNodeData?.id.toLowerCase().includes('api')){
      return 'Api';
    }
    else{

      let agent_name= details.flow_data?.tasks?.find((t: any) => t.name === this.selectedNodeData?.id)?.params?.config?.agent_name;
      if(agent_name) return agent_name;
      return 'Agent';
    }
    }
	
	 if(!IsExternal){
      let agentName = details.flow_data?.tasks?.find((task: Task) => task.name.replace(/^agent-/, "") === this.selectedNodeData?.id)?.params?.config?.agent_name;
      if(agentName) return agentName;
      return 'Agent';
    }



    if (typeof response === 'string') {
      return response; // or truncate it, e.g., response.substring(0, 50) + '...'
    }

    if (typeof response === 'object' && response.agent_name) {
      return response.agent_name;
    }

    return 'Agent';
  }

  renderTables(res: any) {
    return res.html && (res.html.includes('<table') || res.plain.match(/step\$\d+/g)?.length || res.plain?.match(PSV_REGEX)?.length)
  }

 get formattedResponse(): string {
    if (!this.selectedNodeData?.id) return ''; 

    // Find the node
    const node = this.nodes.find(n => n.id === this.selectedNodeData.id);
    if (!node) return '';

    const details = this.workflowDetails;
    const IsExternal = details.IsExternal || false;

    // Get raw response — handle both external and internal agent shapes
    // @ts-expect-error agent_response missing type definition
	const raw = IsExternal ? node?.agent_response : node?.agent_response?.prompt_output?? node?.agent_response;
    if (!raw) return 'No response available.';

   // ────────────────────────────────────────────────
  // Helper: is this likely an API-related node?
  // ────────────────────────────────────────────────
  const isApiNode = 
    typeof node.id === 'string' && 
    node.id.toLowerCase().includes('api');

  // ────────────────────────────────────────────────
  // Extract files array – support both shapes
  // ────────────────────────────────────────────────
  let filesArray: any[] | null = null;

  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && 'content' in raw[0]) {
    filesArray = raw;
  } else if (
    typeof raw === 'object' &&
    raw !== null &&
    'files' in raw &&
    Array.isArray(raw.files) &&
    raw.files.length > 0 &&
    typeof raw.files[0] === 'object' &&
    'content' in raw.files[0]
  ) {
    filesArray = raw.files;
  }

  // ────────────────────────────────────────────────
  // Decide to treat as API/files response
  // Prefer node.id check + structure (more reliable in mixed workflows)
  // ────────────────────────────────────────────────
  const isApiFilesResponse = (isApiNode || filesArray !== null) && filesArray !== null;

  if (isApiFilesResponse) {
    const files = filesArray!; // non-null asserted

    let html = '<div class="api-files-result">';

    html += `<p><strong>Files</strong> <small>(Array of ${files.length} ${isApiNode ? 'from API node' : 'items'})</small></p>`;
    html += '<ol style="margin-left: 1.5rem; padding-left: 1rem;">';

    files.forEach((file: any, idx: number) => {
      const content = String(file.content || '').trim();
      const preview = content.length > 240 
        ? content.substring(0, 240) + '…' 
        : content;

      const firstLine = content.split('\n')[0]?.trim() || `File ${idx + 1}`;
      const fileType = 
        file.conversion_metadata?.file_info?.original_type 
        ?? file.conversion_metadata?.mime_type 
        ?? 'application/octet-stream';

      const typeShort = fileType.split('/').pop() || 'file';

      html += '<li style="margin: 1rem 0; padding: 0.6rem; border-left: 3px solid #1976d2;">';
      html += `<div><strong style="font-size: 1.05em;">${this.escapeHtml(firstLine)}</strong>`;
      html += ` <span style="color:#555; font-size:0.9em;">(${typeShort})</span></div>`;

      html += '<details style="margin-top: 0.5rem;">';
      html += `<summary style="cursor: pointer; color: #1976d2;">Preview content (${preview.length} chars)</summary>`;
      html += `<pre style="margin-top: 0.6rem; background:#f5f8fa; padding: 0.9rem; border-radius:6px; white-space:pre-wrap; max-height:280px; overflow-y:auto; font-size:0.93em; border:1px solid #e0e0e0;">`;
      html += this.escapeHtml(preview);
      html += '</pre>';
      html += '</details>';

      html += '</li>';
    });

    html += '</ol>';
    html += '</div>';

    return html;
  }

    const rawString = Array.isArray(raw) ? raw.join('\n') : String(raw);

    // ────────────────────────────────────────────────
    // Check if this is a conditional MH6-style agent node
    // Adjust these property checks to match your actual conditional node shape
    // ────────────────────────────────────────────────
    const isConditionalAgent =
      node.type === 'conditional' ||                    // or whatever your node.type is
      node?.agent_response?.branch !== undefined ||     // has branch field
      rawString.includes('branch:') && rawString.includes('condition:');

    if (isConditionalAgent) {
      // Try to parse structured fields if they exist as object
      // (preferred if your conditional agents already return structured data)
      const agentData = node?.agent_response || {};

      const branch        = agentData.branch        ?? this.extractValue(rawString, 'branch:');
      const condition     = agentData.condition     ?? this.extractValue(rawString, 'condition:');
      const conditionResult = agentData.condition_result ?? this.extractValue(rawString, 'condition_result:');
      const userMessage   = agentData.user_message   ?? this.extractValue(rawString, 'user_message:') 
                                                    ?? this.extractValue(rawString, 'user_story:');

      // Build nice formatted output for conditional nodes
      let html = '<div class="conditional-agent-result">';

      html += `<p><strong>Branch:</strong> <code>${this.escapeHtml(branch || '—')}</code></p>`;
      html += `<p><strong>Condition:</strong> <code>${this.escapeHtml(condition || '—')}</code></p>`;
      html += `<p><strong>Condition Result:</strong> <code style="color: ${conditionResult ? '#2e7d32' : '#d32f2f'}">${conditionResult}</code></p>`;
      
      // if (userMessage) {
        // html += '<p><strong>User message / story:</strong></p>';
        // html += `<blockquote>${this.formatMarkdownToHtml(userMessage)}</blockquote>`;
      // }

      html += '</div>';

      return html;
    }

    // ── Normal flow for non-conditional agents ──
    const fmt = this.formatWorkflowResponse(rawString);
    return fmt.html;
  }

// ────────────────────────────────────────────────
// Small helpers (add these to your class/component)
// ────────────────────────────────────────────────

private extractValue(text: string, key: string): string {
  const regex = new RegExp(`${key}\\s*["']?([^"'\n]+)["']?`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

private escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ✅ BETTER: Precompute status checks (avoids method calls in template)
get isStarted(): boolean {

  const details = this.workflowDetails;
    
    const IsExternal = details.IsExternal || false;

    return IsExternal ? this.selectedNodeData?.status === 'Started' : this.selectedNodeData?.agent_response?.status === 'Started';
  }
 
  get isCompleted(): boolean {

  const details = this.workflowDetails;
    
    const IsExternal = details.IsExternal || false;

    return IsExternal ? this.selectedNodeData?.status === 'Completed' : this.selectedNodeData?.agent_response?.status === 'Completed';
  }

  get isRunning(): boolean {

  const details = this.workflowDetails;
    
    const IsExternal = details.IsExternal || false;

    return IsExternal ? this.selectedNodeData?.status === 'Running' : this.selectedNodeData?.agent_response?.status === 'Running';
  }

  formatMarkdownToHtml(rawString: string): string {
    if (!rawString) return '';

    return rawString
      // 1. Block-level elements (must run BEFORE newline conversion)

      // Headings: #, ##, ### → h1, h2, h3
      .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>')
      .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
      .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
      .replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
      .replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>')
      .replace(/^######\s+(.*)$/gm, '<h6>$1</h6>')

      // Horizontal rule: ---, ***, ___ on its own line
      .replace(/^([-*_])\1{2,}\s*$/gm, '<hr>')

      // 2. Inline formatting

      // Bold: **text** or __text__
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.*?)__/g, '<strong>$1</strong>')

      // Italic: *text* or _text_
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/_(.*?)_/g, '<em>$1</em>')

      // 3. Line breaks and lists (run AFTER block elements, BEFORE final newline cleanup)

      // Convert newlines to <br> temporarily to help with list detection
      .replace(/\r\n|\r|\n/g, '<br>')

      // Bullet points: - item, * item, + item → • item
      .replace(/^<br>([-*+])\s+(.*?)(<br>|$)/gm, '<br>• $2$3')
      .replace(/^([-*+])\s+(.*?)(<br>|$)/gm, '• $2$3')

      // Optional: Numbered lists (1. item → 1. item, without change, or style as needed)
      // You can skip this if not needed

      // 4. Final cleanup (optional)

      // If you want to avoid double <br> at the end
      .replace(/(<br>)+$/, '<br>');
  }

  closeDetailsPanel() {
    this.selectedNodeData = null;
  }

  private mapTaskToFormData(
    task: IFlowTask,
    nodeId: string,
    type: IReferenceData['type']
  ): TWorkflowFormData {
    const base = {
      id: nodeId,
      type,
      agent: '', // will be filled below
      agentDetails: undefined,
      api_url: '',
      loop_condition: '',
      input: '',
    };

    if (type === 'agent') {
      const config = task.params.config;
      console.log('Mapping task to agent form data:', task, config);
      return {
        ...base,
        input: task.user_input || '',
        agent: config.agent_id || '',
        agentDetails: {
          name: config.agent_name || '',
          agent_owner: config.user_id || '',
          _id: '',
          agent_id: config.agent_id,
          agent_prompt: '',
          agent_type_id: '',
          agent_type_name: '',
          api_agent_id: config?.api_agent_id || '',
          agent_session_id: config?.session_id || '',
          user_id: config?.user_id || '',
          agent_api_key: config?.api_key || '',
          agent_api_url: config?.api_url || '',
          description: '',
          feedback: '',
          foundation_ethic_ai: undefined,
          foundation_guardrails_ai: undefined,
          foundation_resp_ai: undefined,
          isDeleted: false,
          knowledge_store_id: '',
          mcp_connector_id: '',
          mcp_connector_name: '',
          model: undefined,
          model_name: '',
          prompt_template: '',
          rating: 0,
          ref_output: '',
          role_id: '',
          role_name: '',
          run_count: 0,
          run_status: '',
          scheduleFrequency: '',
          schedulerTime: undefined,
          status: '',
          trending: false,
          updated_by: '',
          updated_ts: '',
        },
      };
    }

    if (type === 'api') {
      const config = task.params.config;
      return {
        ...base,
        api_url: config.api_url || '',
      };
    }

    if (type === 'iterative') {
      return {
        ...base,
        loop_condition: task.function || '',
      };
    }

    if (type === 'condition') {
      return {
        ...base,
        condition: task.user_input || '',
        true_cond_ids: task.params.config.true_cond_ids || [],
        false_cond_ids: task.params.config.false_cond_ids || [],
      };
    }

    return base as any; // fallback
  }
  private getNodeID_old(name: string) {
    // do not modify uuid
    if (
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
        name
      )
    )
      return name;

    let nameParts = name.split('-');
    if (nameParts.length < 2) nameParts = name.split('_');

    return nameParts.slice(1).join('-');
  }
  
    private getNodeID(name: string) {
    // do not modify uuid
    if (
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
        name
      )
    )
      return name;

    let nameParts = name.split('-');

    if (!this.dragComponents.some((item) => nameParts[0].startsWith(item.type)))
      return name;

    if (nameParts.length < 2) nameParts = name.split('_');

    return nameParts.slice(1).join('-');
  }
  

  toggleCard(cardType: TCard) {
    this.cardState[cardType].open = !this.cardState[cardType].open;
  }

  createNode({ event, data }: DndDropEvent) {
    if (!data?.type) return;

    const spaces = this.vflow().documentPointToFlowPoint(
      {
        x: event.x,
        y: event.y,
      },
      { spaces: true }
    );
    const [point] = spaces;

    const height =
      this.vflowContainer.nativeElement.getBoundingClientRect().height;
    point.y = Math.ceil(height / 2) - 30;

    // Create a unique ID for this new node, ignoring the drag component's id
    const uniqueId = crypto.randomUUID();
    const newNode: DynamicNode = {
      id: uniqueId,
      // @ts-expect-error agent_id missing in type definition
      agent_id: '',
      Condition_false: '',
      agent_response: [],
      elapsedTime: 0,
      point: signal(point),
      type: 'html-template',
      data: signal({
        ...data,
        id: uniqueId, // Assign this unique id to data as well
      }),
    };

    this.nodes = [...this.nodes, newNode];

    this.nodesFormState[newNode.id] = {
      id: newNode.id,
      type: data.type,
    } as TWorkflowFormData;

    if (data.type === 'condition') {
      this.nodesFormState[newNode.id] = {
        ...this.nodesFormState[newNode.id],
        condition: '',
        true_cond_ids: [],
        false_cond_ids: [],
      };
    }
  }

  private isConditionNode(nodeId: string) {
    const node = this.nodes.find(
      (item) => item.id === nodeId
    ) as HtmlTemplateDynamicNode<IDragComponentConfig>;
    if (node?.data?.().type === 'condition') return node;
    return false;
  }

  createEdge(event: Connection) {
    console.log('Trying to create edge:', event);
    this.edges = [
      ...this.edges,
      {
        id: `${event.source}->${event.target}${event.sourceHandle || ''}${event.targetHandle || ''
          }`,
        source: event.source,
        target: event.target,
        sourceHandle: event.sourceHandle,
        targetHandle: event.targetHandle,
        type: 'template',
        edgeLabels: {
          center: {
            type: 'html-template',
          },
        },
      },
    ];

    const conditionNode = this.isConditionNode(event.source);
    if (conditionNode) {
      (
        this.nodesFormState[conditionNode.id] as IConditionFormData
      ).false_cond_ids.push(event.target);
    }

    console.log('Edges after creation:', this.edges);
  }

  toggleCondition(event: MouseEvent, edge: Edge) {
    event.stopPropagation();
    const formState = this.nodesFormState[edge.source] as IConditionFormData;

    if (formState.true_cond_ids.includes(edge.target)) {
      formState.true_cond_ids = formState.true_cond_ids.filter(
        (item) => item !== edge.target
      );
      formState.false_cond_ids.push(edge.target);
      return;
    }

    formState.false_cond_ids = formState.false_cond_ids.filter(
      (item) => item !== edge.target
    );
    formState.true_cond_ids.push(edge.target);
  }

  onZoomIn() {
    const viewport = this.vflow().viewport();
    const maxZoom = this.vflow().maxZoom || 10;
    this.vflow().zoomTo(Math.min(maxZoom, viewport.zoom + this.zoomStep));
  }

  onZoomOut() {
    const viewport = this.vflow().viewport();
    const minZoom = this.vflow().minZoom || 0;
    this.vflow().zoomTo(Math.max(minZoom, viewport.zoom - this.zoomStep));
  }

  onZoomReset() {
    const el = this.vflowContainer.nativeElement;
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  onNodesChange(e: NodeChange[]) {
    const node = e[0];

    if (node.type !== 'select') return;

    if (node.selected) {
      if (this.selectedNode?.id === node.id) return;

      this.selectedNode = this.nodes.find(
        (item) => item.id === node.id
      ) as HtmlTemplateDynamicNode<IDragComponentConfig>;

      return;
    }
  }

  onNodeReset(deleteNode?: boolean) {
    if (this.selectedNode && deleteNode) this.deleteNode(this.selectedNode.id);
    this.selectedNode = undefined;
  }

  onNodeSelect(nodeId: string) {
    this.selectedNode = undefined;

    const n = this.nodes.find(
      (item) => item.id === nodeId
    ) as HtmlTemplateDynamicNode<IDragComponentConfig>;

    if (n) this.selectedNode = n;
  }

  handleNodeClick(event: MouseEvent) {
    const workflowNodeElement = (event.target as HTMLElement).closest(
      '.workflow-node'
    );

    if (workflowNodeElement) {
      const nodeId = workflowNodeElement.getAttribute('id');

      const n = this.nodes.find(
        (item) => item.id === nodeId
      ) as HtmlTemplateDynamicNode<IDragComponentConfig>;

      if (n) this.selectedNode = n;
      return;
    }

    this.selectedNode = undefined;
  }

  /** --------------------------------------------------------------
   *  deleteNode – removes a node + ALL connected edges (in/out)
   *  -------------------------------------------------------------- */
  deleteNode(nodeId: string, e?: MouseEvent): void {
    e?.stopPropagation();

    const prevNode = this.getPreviousNode(
      nodeId,
      this.nodes as HtmlTemplateDynamicNode<IDragComponentConfig>[]
    );

    if (prevNode?.data?.()?.type === 'condition') {
      const formState = this.nodesFormState[prevNode.id] as IConditionFormData;

      if (formState.true_cond_ids.includes(nodeId)) {
        formState.true_cond_ids = formState.true_cond_ids.filter(
          (item) => item !== nodeId
        );
      } else if (formState.false_cond_ids.includes(nodeId)) {
        formState.false_cond_ids = formState.false_cond_ids.filter(
          (item) => item !== nodeId
        );
      }
    }

    // 1. Remove from canvas nodes
    this.nodes = this.nodes.filter((n) => n.id !== nodeId);

    // 2. Remove ALL connected edges
    this.edges = this.edges.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId
    );

    // 3. CRITICAL: Remove from form state (this is what was missing!)
    delete this.nodesFormState[nodeId];

    // 4. Fix drag UI
    const el = document.getElementById(nodeId);
    if (el) el.style.pointerEvents = 'unset';

    // 5. Deselect
    if (this.selectedNode?.id === nodeId) {
      this.selectedNode = undefined;
    }
  }

  onNodeFormSubmission(data: TWorkflowFormData) {
    this.nodesFormState[data.id] = data;
    this.selectedNode = undefined;
  }

  private getConnectedNodes(
    nodeId: string,
    sourceTargetMap: Record<string, string[]>,
    value: string[] = []
  ): string[] {
    const nextNodeIds = sourceTargetMap[nodeId];
    if (this.nodesFormState[nodeId]?.type === 'condition') {
      const conditionFormState = this.nodesFormState[
        nodeId
      ] as IConditionFormData;

      const ids = [
        ...value,
        ...conditionFormState.true_cond_ids
          .map((id) => this.getConnectedNodes(id, sourceTargetMap, [id]))
          .flat(),
        ...conditionFormState.false_cond_ids
          .map((id) => this.getConnectedNodes(id, sourceTargetMap, [id]))
          .flat(),
      ];

      return ids;
    }

    if (nextNodeIds?.length) {
      const ids = [
        ...value,
        ...nextNodeIds
          .map((id) => this.getConnectedNodes(id, sourceTargetMap, [id]))
          .flat(),
      ];

      return ids;
    }

    return value;
  }

  private sortNodesForm() {
    const sourceTargetMap: Record<string, string[]> = {};
    this.edges.forEach((edge) => {
      if (sourceTargetMap[edge.source])
        sourceTargetMap[edge.source].push(edge.target);
      else sourceTargetMap[edge.source] = [edge.target];
    });
    const targets = Object.values(sourceTargetMap).flat();

    // 1. find the first node ( decided based on edge ) nodeId should not be target of any edge
    const firstNode = this.nodes.find((node) => !targets.includes(node.id));

    if (!firstNode) return [];

    let tempNodeId = firstNode.id;

    const newNodeArray: string[] = [
      tempNodeId,
      ...this.getConnectedNodes(tempNodeId, sourceTargetMap),
    ];

    return newNodeArray.map((item) => ({
      call_next:
        sourceTargetMap[item]?.map(
          (id) => `${this.nodesFormState[id]?.type}-${id}`
        ) || [],
      ...this.nodesFormState[item],
    }));
  }

  private getPreviousNode(
    target: string,
    nodes: HtmlTemplateDynamicNode<IDragComponentConfig>[],
    type?: IReferenceData['type']
  ): HtmlTemplateDynamicNode<IDragComponentConfig> | null {
    const edge = this.edges.find((item) => item.target === target);
    const edgeNode = nodes.find((item) => item.id === edge?.source);

    if (!type) return edgeNode || null;

    if (edgeNode && edgeNode.data?.().type === type) return edgeNode;

    if (edge?.source) return this.getPreviousNode(edge.source, nodes, type);
    return null;
  }

  get connectedAgent() {
    const selectedNode = this.selectedNode;

    if (
      !this.nodes.length ||
      !selectedNode ||
      selectedNode.data?.()?.type !== 'api'
    )
      return null;
    const nodes = this.nodes as HtmlTemplateDynamicNode<IDragComponentConfig>[];

    return this.getPreviousNode(selectedNode.id, nodes, 'agent');
  }

  deleteEdge(edge: Edge): void {
    this.edges = this.edges.filter((item) => item.id !== edge.id);
  }
  //#endregion

//#region
 // Start dragging
  startResizing(event: MouseEvent): void {
    this.isResizing = true;
    this.startX = event.pageX;
    this.startWidth = this.sidebarWidth;

    document.documentElement.style.cursor = 'col-resize';
  }

  // Mouse move - resize
  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (!this.isResizing) return;

    const diff = event.pageX - this.startX;
    let newWidth = this.startWidth + diff;

    // Set limits
    newWidth = Math.max(200, Math.min(newWidth, 1200));

    this.sidebarWidth = newWidth;
	    // Auto adjust messages when resizing
    requestAnimationFrame(() => this.updateMessageToggles());

  }

  // Stop dragging
  @HostListener('document:mouseup')
  onMouseUp(): void {
    if (this.isResizing) {
      this.isResizing = false;
      document.documentElement.style.cursor = 'default';
	     // Auto adjust messages when resizing
      setTimeout(() => this.updateMessageToggles());
    }
  }
  
    // In your chat component
  isMultiLine(text: string): boolean {
    return text.split('\n').length > 1 || text.length > 20; // Adjust threshold as needed
  }

  // Keep this for button visibility
  updateMessageToggles() {
    setTimeout(() => {
      this.chatMessages.forEach((msg, i) => {
        if (msg.from === 'user') {
          // You can keep showToggle logic if needed
          msg.showToggle = true; // temporarily force true to test
        }
      });
    }, 100);
  }

  toggleMessage(index: number) {
    if (this.expandedIndexes.has(index)) {
      this.expandedIndexes.delete(index);
    } else {
      this.expandedIndexes.add(index);
    }
  }
//#endregion
}
