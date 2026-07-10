import {
  Component,
  ChangeDetectorRef,
  AfterViewInit,
  ViewChild,
  ElementRef,
  AfterViewChecked,
    HostListener
} from '@angular/core';
import { NgxSpinnerService } from 'ngx-spinner';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HomeService } from '../../services/home.service';
import { LoginService } from '../../services/login.service';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { Header } from '../../header/header';
import { DomSanitizer } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { SemarketplaceService } from '../../services/semarketplace.service';
import { Chatbot } from '../../chatbot/chatbot';
import { Chart } from 'chart.js';
import { TimeAgoPipe } from '../../timeago/time-ago-pipe';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { secommendcenter } from '../../services/secommedcenter.service';
import { filter } from 'rxjs/operators';
//import ForceGraph3D from 'force-graph';
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import * as d3 from 'd3-force';
import { NgMultiSelectDropDownModule } from 'ng-multiselect-dropdown';
import { environment as config,environment} from '../../../environments/environment';
import { IWorkflow, WorkflowDetail } from '../../types';
import { WorkflowService } from '../../services/workflow.service';
import { Insights } from '../insights/insights';

import { getApiError } from '../../utils';
import { Trends } from "../trends/trends";
import { AgentEval } from '../agent-eval/agent-eval';

declare var $: any;
declare var bootstrap: any;

@Component({
  selector: 'app-commendcentermain',
  imports: [CommonModule, Header, FormsModule, RouterModule, Chatbot, TimeAgoPipe, TooltipDirective, NgMultiSelectDropDownModule, Insights, Trends,AgentEval],
  templateUrl: './commendcentermain.html',
  styleUrl: './commendcentermain.css',
})
export class CommendCenterMain implements AfterViewInit {
  @ViewChild('kgPopup') kgPopup!: ElementRef;
  @ViewChild('graphContainer') graphContainer!: ElementRef;
  @ViewChild('filt') filterModalRef!: ElementRef;
  @ViewChild('zoomControls') zoomControls!: ElementRef<HTMLDivElement>;

  newChatbot = true;
  selectedRagId: string = '';
  captcha: boolean = false;
  showTestCases: boolean = false;
  UserName: string = '';
  loadTabMenu = [
     { label: 'Agent Eval', key: 'agent-eval', imgurl: 'assets/img/agent-eval.png', active: true },
    {
      label: 'Task',
      key: 'task',
      imgurl: 'assets/img/Tasks-icon.svg',
      active: true,
    },
    {
      label: 'Insights',
      key: 'insights',
      imgurl: 'assets/img/Insights-icon.svg',
      active: false,
    },
    {
      label: 'Trends',
      key: 'trends',
      imgurl: 'assets/img/Trends-icon.svg',
      active: false,
    },
    {
      label: 'Knowledge Graph',
      key: 'knowledge-graph',
      imgurl: 'assets/img/knowledgeGraph.png',
      active: false,
    },
    {
      label: 'Workflow',
      key: 'workflow',
      imgurl: 'assets/img/Tasks-icon.svg',
      active: false,
    },
  ];

  allAgencyList: any[] = [];
  filteredAgencies: any[] = [];
  agencySearch: string = '';
  activeTabIndex: number = 0;
  chartsInitialized = false;
  selectedAgency1: any = null;
  workflowId: any = null;
  workflowId2: any = null;
  selectedAgency2: any = null;
  selectedWorkflow: any = null;
  graphData: { nodes: any[]; relationships: any[] } = {
    nodes: [],
    relationships: [],
  };

  background: string = 'white';
  nodeTypeFilter: string = '';
  linkTypeFilter: string = '';
  selectedNodeTypes: string[] = [];
  selectedLinkTypes: string[] = [];

  nodeTypes: string[] = [];
  linkTypes: string[] = [];
  filteredGraphData: { nodes: any[]; relationships: any[] } = {
    nodes: [],
    relationships: [],
  };
  linkTypesAll: string[] = [];
  graphInstance: any;
  knowledgeGraphList: any[] = [];
  isNight: boolean = true;
  zoomStep = 1.2;

  multiSelectSettings = {
    singleSelection: false,
    idField: 'id',
    textField: 'name',
    selectAllText: 'Select All',
    unSelectAllText: 'Unselect All',
    itemsShowLimit: 2,
    allowSearchFilter: true,
  };

  agentStats = {
    totalAgents: 24,
    activeAgents: 18,
    usageScore: 87,
    workflowsExecuted: 156,
    agentsByAgency: [
      { agency: 'coding', count: 8, workflows: 45 },
      { agency: 'quality engineering', count: 6, workflows: 32 },
      { agency: 'DevOps', count: 4, workflows: 28 },
      { agency: 'requirements', count: 3, workflows: 25 },
      { agency: 'SRE', count: 3, workflows: 26 },
    ],
  };
  selectedConfidenceStatus: string = '';
  statusOptions: string[] = [];
  selectedDateRange: string = '';
  dateRangeOptions = [
    { label: 'All Dates', value: '' },
    { label: 'Today', value: 'today' },
    { label: 'Last 7 Days', value: 'weekly' },
    { label: 'Last 30 Days', value: 'monthly' },
  ];
  fromDate: string = '';
  toDate: string = '';
  insightAgents: any[] = [];
  filteredInsightAgents: any[] = [];
  insightSearch: string = '';
  insightStatus: string = '';
  insightDateRange: string = '';
  masterDatabase = config.masterDatabase;
  alltaskAgents: any[] = [];
  agenciesWithAgents: any[] = [];
  loggedUser: any;
  items: IWorkflow[] = [];
  // workflows: IWorkflow[] = [];
  // filteredWorkflows: IWorkflow[] = [];
  workflowSearch: string = '';
  workflowStatus: string = '';
  workflowDateRange: string = '';
  workflows: WorkflowDetail[] = [];
  filteredWorkflows: WorkflowDetail[] = [];
  workflowConfidenceStatus: string = '';
  workflowConfidenceOptions: string[] = [];
  selectedWorkflowId: string | null = null;
  NoDataAvailable: string = '';
  isPrivilegeViewTask: boolean = false;
  isPrivilegeEditTask: boolean = false;
  isPrivilegeDeleteTask: boolean = false;
  isPrivilegeRefreshTask: boolean = false;
  isPrivilegeExecuteTask: boolean = false;

  isPrivilegeViewWorkflow: boolean = false;
  isPrivilegeEditWorkflow: boolean = false;
  isPrivilegeDeleteWorkflow: boolean = false;
  isPrivilegeRefreshWorkflow: boolean = false;
  isPrivilegeExecuteWorkflow: boolean = false;

  searchKgTerm: string = '';
  searchDebounceTimer: any = null;
  private isDragging = false;
  private currentX = 16;
  private currentY = 0;
  private initialX = 0;
  private initialY = 0;

  constructor(
    private _loadingService: NgxSpinnerService,
    private _router: Router,
    private _stateService: AIInfuseStateService,
    private _homeService: HomeService,
    private _loginservice: LoginService,
    private _seservice: SemarketplaceService,
    private changeDetectorRef: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
    private _secommendservice: secommendcenter,
    private _workflowService: WorkflowService,
    private _activatedRoute: ActivatedRoute
  ) {}

  ngOnDestroy() {
    document.removeEventListener('fullscreenchange', this.onFullScreenChange);
    this._stateService.clearWorkflowDetails();
  }
  ngAfterViewInit() {
    const filterBtn = document.getElementById('filterButton');
    const modal = document.getElementById('filt');
    if (modal && filterBtn) {
      modal.addEventListener('shown.bs.modal', () => {
        filterBtn.classList.add('active');
      });
      modal.addEventListener('hidden.bs.modal', () => {
        filterBtn.classList.remove('active');
      });
    }
	
	this.currentY = window.innerHeight * 0.7; // approx 70%
    this.updatePosition();

    this.overrideSceneNavInfoStyles();

    const redirectTab = this._activatedRoute.snapshot.queryParamMap.get('tab');
    if (redirectTab) {
      this.loadTabMenu.forEach((item, index) => {
        item.active = item.key === redirectTab;
        if (item.active) {
          this.activeTabIndex = index;
        }
      });
    }
  }

  ngOnInit(): void {
    this.loggedUser = this._stateService.getLoginDetails();
    this.loadPrivileges();
    this.fetchAgenciesWithAgents();

    var UserDetails = this._stateService.getLoginDetails();
    var Name = UserDetails?.UserName?.split(' ') || '';
    this.UserName = Name[0] || 'User';

    this.selectedAgency1 = null;
    this.selectedAgency2 = null;
    this.workflowId = null;
    this.workflowId2 = null;
    this._stateService.setSelectedAgency(null);
    this._stateService.setIsReviewCase(false);
    this._stateService.clearWorkflowDetails();
    this._stateService.setWorkflowRouted(false);
    this._stateService.setSelectedWorkflow(null);
    this._stateService.setWorkflowDetails(null);
    this.changeDetectorRef.detectChanges();

    this.getInsightAgentsData();
    this.fetchWorkflows().then(() => {
      this.getWorkflowDetails();
    });

    this.loadWorkflowStatuses();
  }

  loadPrivileges() {
    this._stateService.getPrivilegesByPage('Task').subscribe({
      next: (loaded_privileges:any) => {
        console.log('Loaded privileges for Task by page: ', loaded_privileges);
        if (loaded_privileges) {
          this.isPrivilegeViewTask = loaded_privileges?.view || false;
          this.isPrivilegeEditTask = loaded_privileges?.['insert / edit'] || loaded_privileges?.edit || false;
          this.isPrivilegeDeleteTask = loaded_privileges?.delete || false;
          this.isPrivilegeRefreshTask = loaded_privileges?.refresh || false;
          this.isPrivilegeExecuteTask = loaded_privileges?.execute || false;
          this.changeDetectorRef.detectChanges();
        }
      }
    });

    this._stateService.getPrivilegesByPage('Workflow').subscribe({
      next: (loaded_privileges:any) => {
        console.log('Loaded privileges for Workflow by page: ', loaded_privileges);
        if (loaded_privileges) {
          this.isPrivilegeViewWorkflow = loaded_privileges?.view || false;
          this.isPrivilegeEditWorkflow = loaded_privileges?.['insert / edit'] || loaded_privileges?.edit || false;
          this.isPrivilegeDeleteWorkflow = loaded_privileges?.delete || false;
          this.isPrivilegeRefreshWorkflow = loaded_privileges?.refresh || false;
          this.isPrivilegeExecuteWorkflow = loaded_privileges?.execute || false;
          this.changeDetectorRef.detectChanges();
        }
      }
    });
  }

  initialRoute(): void {
    this._router.navigate(['commandcenter/testcase']);
  }

  loadAgency(agentId: string): void {
    console.log('Selected Agency ID:', agentId);
    this.selectedAgency1 = agentId;
    this._stateService.setIsReviewCase(false);
    this._stateService.setSelectedAgency(agentId);
  }

  loadWorkflow(wf: IWorkflow): void {
    console.log('Selected workflowid:', wf);
    this.workflowId = wf.flow_id;
    this.selectedWorkflow = wf;
    console.log('this.selectedWorkflow', this.selectedWorkflow);
    // this._stateService.setSelectedWorkflow(wf);
    this._stateService.setWorkflowDetails(wf);
    this._stateService.setWorkflowRouted(true);
  }

  //   openWorkflowDetail(wf: IWorkflow): void {
  //   // Example: store the selected workflow and navigate
  //   this._stateService.setWorkflowAgent(wf.id);
  //   this._router.navigate(['commandcenter/workflow', wf.id]);
  // }

  filterWorkflows() {
    let filtered = [...this.workflows];

    // Search
    if (this.workflowSearch?.trim()) {
      const term = this.workflowSearch.toLowerCase();
      filtered = filtered.filter(
        (wf) =>
          wf.flow_name?.toLowerCase().includes(term) ||
          wf.agency_name?.toLowerCase().includes(term) ||
          wf.description?.toLowerCase().includes(term)
      );
    }

    // Status filter
    if (this.workflowStatus && this.workflowStatus !== '') {
      filtered = filtered.filter((wf) => wf.status === this.workflowStatus);
    }

    // Confidence Status filter (NEW)
    if (this.workflowConfidenceStatus && this.workflowConfidenceStatus !== '') {
      filtered = filtered.filter(
        (wf) => wf.confidence_status === this.workflowConfidenceStatus
      );
    }

    // Date range
    if (this.workflowDateRange && this.workflowDateRange !== '') {
      const days = parseInt(this.workflowDateRange, 10);
      if (!isNaN(days)) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        filtered = filtered.filter((wf) => {
          const updated = new Date(wf.updated_ts);
          return updated >= cutoff;
        });
      }
    }

    this.filteredWorkflows = filtered;
    console.log('filtered', this.filteredWorkflows);
    this.changeDetectorRef.detectChanges();
  }

  getWorkflowDetails(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._loadingService.show();
      this._homeService.getworkflowdetails().subscribe({
        next: (response) => {
          const res = response.data;
          console.log('Workflow Details Response:', res);

          if (res && res.length > 0) {
            // Build lookup map: flow_id → detail
            const detailMap = new Map<string, WorkflowDetail>();
            res.forEach((d) => {
              if (d.flow_id) detailMap.set(d.flow_id, d);
            });

            // FILTER + MERGE: Only keep workflows that exist in details
            const validWorkflows: WorkflowDetail[] = this.workflows
              .map((wf) => {
                const detail = detailMap.get(wf.flow_id);
                if (!detail) {
                  console.warn(
                    `Skipping unmapped workflow: ${wf.flow_name} (${wf.flow_id})`
                  );
                  return null;
                }

                return {
                  ...wf,
                  _id: detail._id || '',
                  agency_id: detail.agency_id,
                  mapping_id: detail.mapping_id,
                  order_number: detail.order_number,
                  run_status: detail.run_status,
                  assigned_to: detail.assigned_to || wf.assigned_to,
                  agency_name: detail.agency_name || wf.agency_name,
                  confidence_status:
                    detail.confidence_status || wf.confidence_status,
                  confidence_perc: detail.confidence_perc || wf.confidence_perc,
                  created_ts: detail.created_ts || wf.created_ts,
                  updated_ts: detail.updated_ts || wf.updated_ts,
                  description: detail.description || wf.description,
                  status: wf.status,
				  IsExternal: wf.IsExternal || false
                };
              })
              .filter((wf): wf is WorkflowDetail => wf !== null); // Remove nulls

            const loggedUser = this._stateService.getLoginDetails();
            console.log('loggedUser', loggedUser);

            const activeProject = loggedUser?.ActiveProject || '';
            console.log('activeProject', activeProject);

            const projectDetails = loggedUser?.ProjectDtl || [];
            console.log('projectDetails', projectDetails);

            const mappedProject = projectDetails.find(
              (p: any) =>
                p.prj_name?.toLowerCase() === activeProject?.toLowerCase()
            );
            console.log('mappedProject', mappedProject);

            const mappedTeam = mappedProject?.team_name || '';
            console.log('mappedTeam', mappedTeam);

            const mappedRole = mappedProject?.role_name?.toLowerCase() || '';
            console.log('mappedRole', mappedRole);

            // Apply filtering logic
            let filteredWorkflow = [...validWorkflows];

            // Apply project/team filtering if user is not super admin or admin
            if (
              activeProject &&
              activeProject.toLowerCase() !==
                config.masterDatabase.toLowerCase() &&
              mappedRole !== 'super admin' &&
              mappedRole !== 'admin'
            ) {
              if (mappedTeam) {
                filteredWorkflow = filteredWorkflow.filter((workflow) => {
                const teamValue =
                  typeof workflow.team === 'string'
                    ? workflow.team
                    : workflow.team?.["assigned_to"];

                return teamValue?.toLowerCase() === mappedTeam.toLowerCase();
              });
                this.filteredWorkflows = filteredWorkflow;
                this.workflows = filteredWorkflow;
              } else {
                this.filteredWorkflows = validWorkflows;
                this.workflows = validWorkflows;
              }
              // Filter by mapped team
            } else {
              this.filteredWorkflows = validWorkflows;
              this.workflows = validWorkflows;
            }

            console.log('Final filtered + merged workflows:', this.workflows);
            console.log(
              'Final filtered + merged workflows:',
              this.filteredWorkflows
            );
            this.filterWorkflows();

            this.changeDetectorRef.detectChanges();
          } else {
            // No mapped workflows
            this.workflows = [];
            this.filteredWorkflows = [];
          }

          this._loadingService.hide();
          resolve();
        },
        error: (err: any) => {
          console.error('Error fetching workflow details:', err);
          this._loadingService.hide();
          reject(err);
        },
      });
    });
  }

  getConfidenceNumber(perc: string): number {
    if (!perc) return 0;
    return parseInt(perc.replace('%', '').trim(), 10) || 0;
  }

  fetchWorkflows(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._loadingService.show();
      this._workflowService.getWorkflows().subscribe({
        next: (res) => {
          console.log('API Response:', res);

          // Map the API response to our WorkflowDetail interface
          this.workflows = (res.data ?? []).map((wf: any) => ({
            _id: wf._id || '',
            agency_id: wf.agency_id || '',
            agency_name: wf.agency_name || '',
            assigned_to: wf.assigned_to || '',
            avatar: wf.avatar || '',
            confidence_perc: wf.confidence_perc || '0%',
            confidence_status: wf.confidence_status || '',
            created_ts: wf.created_ts || wf.created_at || '',
            description: wf.description || wf.flow_description || '',
            flow_id: String(wf.flow_id || '').trim(),
            flow_name: wf.flow_name || '',
            mapping_id: wf.mapping_id || '',
            order_number: wf.order_number || 0,
            run_status: wf.run_status || '',
            status: wf.status,
            updated_ts: wf.updated_ts || wf.updated_at || '',
            api_key: wf.api_key,
            flow_data: wf.flow_data,
            edges: wf.edges,
            tasks: wf.tasks,
            default_inputs: wf.default_inputs,
            node_positions: wf.node_positions,
            last_completed_ts: wf.last_completed_ts,
            workflow_response: wf.workflow_response,
            team: wf.team || '',
			IsExternal: wf.IsExternal || false,
          }));

          console.log('Mapped Workflows:', this.workflows);
          const loggedUser = this._stateService.getLoginDetails();
          console.log('loggedUser', loggedUser);
          // Get user details for filtering
          const activeProject = loggedUser?.ActiveProject || '';
          console.log('activeProject', activeProject);
          const projectDetails = loggedUser?.ProjectDtl || [];
          console.log('projectDetails', projectDetails);
          const mappedProject = projectDetails.find(
            (p: any) =>
              p.prj_name?.toLowerCase() === activeProject?.toLowerCase()
          );
          console.log('mappedProject', mappedProject);
          const mappedTeam = mappedProject?.team_name || '';
          console.log('mappedTeam', mappedTeam);
          const mappedRole = mappedProject?.role_name?.toLowerCase() || '';
          console.log('mappedRole', mappedRole);
          let filteredWorkflows = [...this.workflows];

          // Apply project/team filtering if user is not super admin or admin
          if (
            activeProject &&
            activeProject.toLowerCase() !==
              config.masterDatabase.toLowerCase() &&
            mappedRole !== 'super admin' &&
            mappedRole !== 'admin'
          ) {
            // Filter by mapped team
               // Filter by mapped team
          filteredWorkflows = filteredWorkflows.filter((workflow) => {
            const teamValue =
              typeof workflow.team === 'string'
                ? workflow.team
                : workflow.team?.["assigned_to"];

            return teamValue?.toLowerCase() === mappedTeam.toLowerCase();
          });
          }

          this.filteredWorkflows = filteredWorkflows;
          console.log('Filtered Workflows:', this.filteredWorkflows);
          this.changeDetectorRef.detectChanges();
          this._loadingService.hide();
          resolve();
        },
        error: (err) => {
          console.error('Error:', err);
          this._loadingService.hide();
          reject(err);
        },
      });
    });
  }

  OpenGeneratedCaseDetails(agentId: any): void {
    if (agentId?.run_status !== 'completed') {
      return; // Do nothing if the agent is not completed
    }
    this.selectedAgency2 = agentId;
    this._stateService.setIsReviewCase(true);
    this._stateService.setSelectedAgency(agentId);
  }
  loadWorkflowStatuses() {
    this._loadingService.show();

    this._homeService.getWorkflowResponse("0",false).subscribe({
      next: (res: any) => {
        console.log('Workflow API Response:', res.data);

        // Check if the response is an array and handle accordingly
        const responses: any[] = Array.isArray(res.data)
          ? res.data
          : [res.data];

        responses.forEach((response) => {
          const apiWorkflowId = String(response.workflow_id || '').trim();
          const apiStatus = response.status || 'pending';

          console.log('API workflow_id:', apiWorkflowId);
          console.log('API status:', apiStatus);

          if (apiWorkflowId) {
            // UPDATE THE CORRECT WORKFLOW
            this.workflows = this.workflows.map((wf) => {
              const wfId = String(wf.flow_id || '').trim();

              if (wfId === apiWorkflowId) {
                console.log(
                  `MATCHED! Updating ${wf.flow_name} → status: ${apiStatus}`
                );
                return {
                  ...wf,
                  status: apiStatus,
                  run_status: apiStatus,
                  workflow_response: response.response || null,
                  last_completed_ts: response.timestamp || null,
                };
              }
              return wf;
            });
          }
        });

        // Update filtered list
        this.filteredWorkflows = [...this.workflows];
        this.filterWorkflows();

        this.changeDetectorRef.detectChanges();
        this._loadingService.hide();
      },
      error: (err) => {
        console.error('Error:', err);
        this._loadingService.hide();
      },
    });
  }
  //  OpenGeneratedWorkflowDetails(wf: any): void {
  //   console.log("status",wf.status)
  //   if (wf.status !== 'completed') {
  //     return; // Prevent review
  //   }
  //   this.workflowId2 = wf.flow_id;
  //   this.selectedWorkflow = wf;
  //   this._stateService.setSelectedWorkflow(wf);
  //   this._stateService.setWorkflowRouted(true);
  // }

  OpenGeneratedWorkflowDetails(wf: any): void {
    if (wf.status == undefined) {
      console.log('Workflow not completed yet:', wf.status);
      return;
    }

    this.selectedWorkflowId = wf.flow_id;
    this.selectedWorkflow = wf;
    this._stateService.setSelectedWorkflow(wf);
    this._stateService.setWorkflowRouted(true);

    console.log('Opening details for workflow ID:', this.selectedWorkflowId);
  }
  fetchAgenciesWithAgents(): void {
    this._loadingService.show();
    this._seservice.getAgencyWithAgents().subscribe({
      next: (res) => {
        if (res.success) {
          // this.agenciesWithAgents = res.Agency;
          this.agenciesWithAgents = res.data || [];
          this.changeDetectorRef.detectChanges();
          this.getAllAgencies();
          this.getKnowledgeGraphDropdownDetails();
        }
      },
      error: (err) => console.error('Error:', err),
    });
  }
  filterAgenciesBySearch(): void {
    const searchTerm = this.agencySearch?.trim().toLowerCase() || '';
    const selectedStatus = this.selectedConfidenceStatus || '';
    const selectedDateRange = this.selectedDateRange || '';

    const today = new Date();
    let fromDate: Date | null = null;

    if (selectedDateRange === 'today') {
      fromDate = new Date(today);
      fromDate.setHours(0, 0, 0, 0);
    } else if (selectedDateRange === 'weekly') {
      fromDate = new Date(today);
      fromDate.setDate(today.getDate() - 7);
    } else if (selectedDateRange === 'monthly') {
      fromDate = new Date(today);
      fromDate.setDate(today.getDate() - 30);
    }
    const activePrj = this.loggedUser?.ActiveProject;
    console.log('Active Project:', activePrj);

    // ✅ Extract mapped team & role from PrjDetails for the active project
    const projectDetails = this.loggedUser?.ProjectDtl || [];
    console.log('User Project Details:', projectDetails);

    // ✅ Find project mapping for the active project (case-insensitive)
    const mappedProject = projectDetails.find(
      (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
    );
    console.log('Mapped Project:', mappedProject);

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
      const projectsData = this._stateService.getProjectManagementData() || [];
      console.log('proj', projectsData);

      if (mappedTeam) {
        console.log('needagency0:', this.agenciesWithAgents);
        this.agenciesWithAgents = this.agenciesWithAgents.filter(
          (agency) =>
            agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
        );
        console.log('needagency1:', this.agenciesWithAgents);

        const agentIds = this.agenciesWithAgents.flatMap((agency) =>
          (agency.agents || [])
            .filter((agent: { status: string }) => agent.status === 'active')
            .map((agent: { agent_id: any }) => agent.agent_id)
        );
        console.log('agentid', agentIds);

        this.alltaskAgents = (this.allAgencyList || []).filter(
          (agent: { agent_id: any }) => agentIds.includes(agent.agent_id)
        );
        console.log('agenttask', this.alltaskAgents);

        // this.filteredAgencies = this.alltaskAgents.filter(
        // (agent: any) => agent.run_status === 'completed'
        // );
        // console.log('agentfilter', this.filteredAgencies);
      } else {
        // fallback if no teams
        this.filteredAgencies = this.allAgencyList.filter(
          (agent: any) => agent.run_status === 'completed'
        );
      }
      this.filteredAgencies = this.alltaskAgents.filter((agency) => {
        // ✅ Text search
        const nameMatch =
          agency.agent_name?.toLowerCase().includes(searchTerm) ||
          agency.description?.toLowerCase().includes(searchTerm);

        // ✅ Date filter
        let dateMatch = true;
        if (fromDate) {
          if (agency.last_completed_ts) {
            const completedDate = new Date(
              Date.parse(agency.last_completed_ts)
            );
            dateMatch =
              !isNaN(completedDate.getTime()) && completedDate >= fromDate;
          } else {
            dateMatch = false;
          }
        }

        // ✅ Status / Run status filter
        if (selectedStatus === 'Active agents') {
          // Show ALL agents
          return nameMatch && dateMatch;
        } else if (selectedStatus) {
          // Specific status + only completed
          return (
            nameMatch &&
            dateMatch &&
            agency.run_status === 'completed' &&
            agency.confidence_status === selectedStatus
          );
        } else {
          // All Status (empty) → only completed
          return nameMatch && dateMatch && agency.run_status === 'completed';
        }
      });
    } else {
      // Admin / Super Admin / Master DB fallback
      this.filteredAgencies = this.allAgencyList.filter(
        (agent: any) => agent.run_status === 'completed'
      );
      this.filteredAgencies = this.allAgencyList.filter((agency) => {
        // ✅ Text search
        const nameMatch =
          agency.agent_name?.toLowerCase().includes(searchTerm) ||
          agency.description?.toLowerCase().includes(searchTerm);

        // ✅ Date filter
        let dateMatch = true;
        if (fromDate) {
          if (agency.last_completed_ts) {
            const completedDate = new Date(
              Date.parse(agency.last_completed_ts)
            );
            dateMatch =
              !isNaN(completedDate.getTime()) && completedDate >= fromDate;
          } else {
            dateMatch = false;
          }
        }

        // ✅ Status / Run status filter
        if (selectedStatus === 'Active agents') {
          // Show ALL agents
          return nameMatch && dateMatch;
        } else if (selectedStatus) {
          // Specific status + only completed
          return (
            nameMatch &&
            dateMatch &&
            agency.run_status === 'completed' &&
            agency.confidence_status === selectedStatus
          );
        } else {
          // All Status (empty) → only completed
          return nameMatch && dateMatch && agency.run_status === 'completed';
        }
      });
    }

    this.changeDetectorRef.detectChanges();
  }

  // filterAgenciesBySearch(): void {
  // const searchTerm = this.agencySearch?.trim().toLowerCase() || '';
  // const selectedStatus = this.selectedConfidenceStatus || '';
  // const selectedDateRange = this.selectedDateRange || '';

  // const today = new Date();
  // let fromDate: Date | null = null;

  // if (selectedDateRange === 'today') {
  // fromDate = new Date(today);
  // fromDate.setHours(0, 0, 0, 0);
  // } else if (selectedDateRange === 'weekly') {
  // fromDate = new Date(today);
  // fromDate.setDate(today.getDate() - 7);
  // } else if (selectedDateRange === 'monthly') {
  // fromDate = new Date(today);
  // fromDate.setDate(today.getDate() - 30);
  // }

  // this.filteredAgencies = this.allAgencyList.filter((agency) => {
  // // ✅ Text search
  // const nameMatch =
  // agency.agent_name?.toLowerCase().includes(searchTerm) ||
  // agency.description?.toLowerCase().includes(searchTerm);

  // // ✅ Date filter
  // let dateMatch = true;
  // if (fromDate) {
  // if (agency.last_completed_ts) {
  // const completedDate = new Date(Date.parse(agency.last_completed_ts));
  // dateMatch =
  // !isNaN(completedDate.getTime()) && completedDate >= fromDate;
  // } else {
  // dateMatch = false;
  // }
  // }

  // // ✅ Status / Run status filter
  // if (selectedStatus === 'Active agents') {
  // // Show ALL agents
  // return nameMatch && dateMatch;
  // } else if (selectedStatus) {
  // // Specific status + only completed
  // return (
  // nameMatch &&
  // dateMatch &&
  // agency.run_status === 'completed' &&
  // agency.confidence_status === selectedStatus
  // );
  // } else {
  // // All Status (empty) → only completed
  // return (
  // nameMatch &&
  // dateMatch &&
  // agency.run_status === 'completed'
  // );
  // }
  // });

  // this.changeDetectorRef.detectChanges();
  // }

  isActiveRoute(route: string): boolean {
    // Check if the current route matches the provided route
    return this._router.url === route;
  }

  home_link(): void {
    // Navigate to the home page
    this._router.navigate(['/home']);
  }

  getConfidenceLevel(value: number): string {
    if (value >= 90) return 'high';
    if (value >= 60) return 'low';
    return 'medium';
  }

  setActiveCountTab(index: number) {
    this.activeTabIndex = index;

    this.loadTabMenu.forEach((item, i) => {
      item.active = i === index;
    });

    this._router
      .navigate([], {
        queryParams: { tab: this.loadTabMenu[index].key },
        queryParamsHandling: 'merge',
      })
      .then(() => {
        this._loadingService.hide();
      });

    // If Knowledge Graph tab is clicked directly (index 3)
    if (index === 3) {
      this.loadKnowledgeGraphDirectly(); // Load directly in the tab content
    }

    this.changeDetectorRef.detectChanges();
  }

  // getAllAgencies(): void {
  //   // this._loadingService.show();
  //   this._seservice.getAllAgencies().subscribe(
  //     (data: any) => {
  //       if (data.Success) {
  //         this.allAgencyList = data.agents;

  //         console.log("log", this.loggedUser)
  //         const activePrj = this.loggedUser?.ActiveProject;
  //         console.log('Active Project:', activePrj);

  //         // ✅ Extract mapped team & role from PrjDetails for the active project
  //         const projectDetails = this.loggedUser?.ProjectDtl || [];
  //         console.log('User Project Details:', projectDetails);

  //         // ✅ Find project mapping for the active project (case-insensitive)
  //         const mappedProject = projectDetails.find(
  //           (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
  //         );
  //         console.log('Mapped Project:', mappedProject);

  //         const mappedTeam = mappedProject?.team_name || '';
  //         const mappedRole = mappedProject?.role_name?.toLowerCase() || '';
  //         console.log('Mapped Team:', mappedTeam);
  //         console.log('Mapped Role:', mappedRole);

  //         if (
  //           activePrj &&
  //           activePrj.toLowerCase() !== this.masterDatabase.toLowerCase() &&
  //           mappedRole !== 'super admin' &&
  //           mappedRole !== 'admin'
  //         ) {
  //           const projectsData = this._stateService.getProjectManagementData() || [];
  //           console.log('proj', projectsData);

  //           if (mappedTeam) {
  //             console.log('needagency0:', this.agenciesWithAgents);
  //             this.agenciesWithAgents = this.agenciesWithAgents.filter(
  //               (agency) =>
  //                 agency.assigned_to.toLowerCase() ===
  //                 mappedTeam.toLowerCase()
  //             );
  //             console.log('needagency1:', this.agenciesWithAgents);

  //             const agentIds = this.agenciesWithAgents.flatMap((agency) =>
  //               (agency.agents || [])
  //                 .filter((agent: { status: string }) => agent.status === 'active')
  //                 .map((agent: { agent_id: any }) => agent.agent_id)
  //             );
  //             console.log('agentid', agentIds);

  //             this.alltaskAgents = (this.allAgencyList || []).filter(
  //               (agent: { agent_id: any }) => agentIds.includes(agent.agent_id)
  //             );
  //             console.log('agenttask', this.alltaskAgents);

  //             this.filteredAgencies = this.alltaskAgents.filter(
  //               (agent: any) => agent.run_status === 'completed'
  //             );
  //             console.log('agentfilter', this.filteredAgencies);
  //           } else {
  //             // fallback if no teams
  //             this.filteredAgencies = this.allAgencyList.filter(
  //               (agent: any) => agent.run_status === 'completed'
  //             );
  //           }
  //         } else {
  //           // Admin / Super Admin / Master DB fallback
  //           this.filteredAgencies = this.allAgencyList.filter(
  //             (agent: any) => agent.run_status === 'completed'
  //           );
  //         }

  //         // ✅ Extract unique confidence statuses (after filtering)
  //         const statuses = new Set<string>();
  //         this.allAgencyList.forEach((agent: any) => {
  //           if (agent.confidence_status && agent.confidence_status !== 'yet to start') {
  //             statuses.add(agent.confidence_status);
  //           }
  //         });
  //         this.statusOptions = Array.from(statuses);

  //         this._stateService.setAgentwithAgencyDetails(this.filteredAgencies);
  //         this.changeDetectorRef.detectChanges();
  //         this._loadingService.hide();
  //       } else {
  //         console.log('No agencies found');
  //         this._loadingService.hide();
  //       }
  //     },
  //     (error) => {
  //       console.log('Error fetching agencies:', error);
  //       this._loadingService.hide();
  //     }
  //   );
  // }

  getAllAgencies(): void {
    // this._loadingService.show();
    this._seservice.getAllAgencies().subscribe({
      next: (res) => {
        if (res.success) {
          this.allAgencyList = res.data;

          console.log('log', this.loggedUser);
          const activePrj = this.loggedUser?.ActiveProject;
          console.log('Active Project:', activePrj);

          // ✅ Extract mapped team & role from PrjDetails for the active project
          const projectDetails = this.loggedUser?.ProjectDtl || [];
          console.log('User Project Details:', projectDetails);

          // ✅ Find project mapping for the active project (case-insensitive)
          const mappedProject = projectDetails.find(
            (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
          );
          console.log('Mapped Project:', mappedProject);

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
            const projectsData =
              this._stateService.getProjectManagementData() || [];
            console.log('proj', projectsData);

            if (mappedTeam) {
              console.log('needagency0:', this.agenciesWithAgents);
              this.agenciesWithAgents = this.agenciesWithAgents.filter(
                (agency) =>
                  agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
              );
              console.log('needagency1:', this.agenciesWithAgents);

              const agentIds = this.agenciesWithAgents.flatMap((agency) =>
                (agency.agents || [])
                  .filter(
                    (agent: { status: string }) => agent.status === 'active'
                  )
                  .map((agent: { agent_id: any }) => agent.agent_id)
              );
              console.log('agentid', agentIds);

              this.alltaskAgents = (this.allAgencyList || []).filter(
                (agent: { agent_id: any }) => agentIds.includes(agent.agent_id)
              );
              console.log('agenttask', this.alltaskAgents);

              this.filteredAgencies = this.alltaskAgents.filter(
                (agent: any) => agent.run_status === 'completed'
              );
              console.log('agentfilter', this.filteredAgencies);
            } else {
              // fallback if no teams
              this.filteredAgencies = this.allAgencyList.filter(
                (agent: any) => agent.run_status === 'completed'
              );
            }
          } else {
            // Admin / Super Admin / Master DB fallback
            this.filteredAgencies = this.allAgencyList.filter(
              (agent: any) => agent.run_status === 'completed'
            );
          }

          // ✅ Extract unique confidence statuses (after filtering)
          const statuses = new Set<string>();
          this.allAgencyList.forEach((agent: any) => {
            if (
              agent.confidence_status &&
              agent.confidence_status !== 'yet to start'
            ) {
              statuses.add(agent.confidence_status);
            }
          });
          this.statusOptions = Array.from(statuses);

          this._stateService.setAgentwithAgencyDetails(this.filteredAgencies);
          this.changeDetectorRef.detectChanges();
          //this._loadingService.hide();
        }
      },
      error: (error) => {
        console.log('Error fetching agencies:', error);
        this._loadingService.hide();
      },
    });
  }

  getKnowledgeGraphDropdownDetailsOld(): void {
    this._loadingService.show();
    this._secommendservice.getKnowledgeGraphDropdownDetails().subscribe(
      (data) => {
        if (data.success) {
          this.knowledgeGraphList = data.data;
          this.changeDetectorRef.detectChanges();
          this._loadingService.hide();
        }
      },
      (err) => {
        const error = getApiError(err);
        if (error) {
          console.log('No knowledge Graph data found');
          return;
        }
        console.log('Error fetching knowledge Graph Details:', error);
      }
    );
  }

  getKnowledgeGraphDropdownDetails_old(): void {
    this._loadingService.show();
    this._secommendservice.getKnowledgeGraphDropdownDetails().subscribe(
      (data) => {
        if (data.success) {
          // Fetch project list from state
          const activePrj = this.loggedUser?.ActiveProject;

          // ✅ Extract mapped team & role from PrjDetails for the active project
          const projectDetails = this.loggedUser?.ProjectDtl || [];

          // ✅ Find project mapping for the active project (case-insensitive)
          const mappedProject = projectDetails.find(
            (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
          );

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
            const projects =
              this._stateService.getProjectManagementData() || [];
            const activeProject = projects.find(
              (prj: any) =>
                prj.projectName &&
                prj.projectName.toLowerCase() === activePrj.toLowerCase()
            );

            if (mappedTeam) {
              this.agenciesWithAgents = this.agenciesWithAgents.filter(
                (agency) =>
                  agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
              );

              // Step 1: Get all active agents’ knowledge_store_ids
              const kg_store_ids = this.agenciesWithAgents.flatMap((agency) =>
                (agency.agents || [])
                  .filter(
                    (agent: { status: string }) => agent.status === 'active'
                  )
                  .map(
                    (agent: { knowledge_store_id: any }) =>
                      agent.knowledge_store_id
                  )
              );

              // Step 2: Filter the KnowledgeGraphData by those IDs
              const filteredKnowledgeGraphData = (
                (data.data || []) as any[]
              ).filter((item: { rag_id: any }) => kg_store_ids.includes(item.rag_id));

              // Step 3: Set the filtered data
              this.knowledgeGraphList = filteredKnowledgeGraphData;
            } else {
              this.knowledgeGraphList = data.data || [];
            }
          } else {
            this.knowledgeGraphList = data.data;
          }

          this.changeDetectorRef.detectChanges();
          this._loadingService.hide();
        } else {
          console.log('No knowledge Graph data found');
        }
      },
      (error) => {
        console.log('Error fetching knowledge Graph Details:', error);
      }
    );
  }

  // getKnowledgeGraphDropdownDetails(): void {
  // //this._loadingService.show();
  // this._secommendservice.getKnowledgeGraphDropdownDetails().subscribe((data: any) => {
  // if (data.Success) {

  // // Fetch project list from state
  // const activePrj = this.loggedUser?.ActiveProject;

  // // ✅ Extract mapped team & role from PrjDetails for the active project
  // const projectDetails = this.loggedUser?.ProjectDtl || [];

  // // ✅ Find project mapping for the active project (case-insensitive)
  // const mappedProject = projectDetails.find(
  // (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
  // );

  // const mappedTeam = mappedProject?.team_name || '';
  // const mappedRole = mappedProject?.role_name?.toLowerCase() || '';
  // console.log('Mapped Team:', mappedTeam);
  // console.log('Mapped Role:', mappedRole);
  // if (
  // activePrj &&
  // activePrj.toLowerCase() !== this.masterDatabase.toLowerCase() &&
  // mappedRole !== 'super admin' &&
  // mappedRole !== 'admin'
  // ) {
  // const projects = this._stateService.getProjectManagementData() || [];
  // const activeProject = projects.find((prj: any) =>
  // prj.projectName && prj.projectName.toLowerCase() === activePrj.toLowerCase()
  // );

  // console.log('Active Project Data:', activeProject);

  // if (mappedTeam) {

  // console.log('mappedTeam:', mappedTeam);

  // this.agenciesWithAgents = this.agenciesWithAgents.filter(agency =>
  // agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
  // );

  // console.log('agenciesWithAgents:', this.agenciesWithAgents);

  // // Step 1: Get all active agents’ knowledge_store_ids
  // const kg_store_ids = this.agenciesWithAgents.flatMap(agency =>
  // (agency.agents || [])
  // .filter((agent: { status: string; }) => agent.status === "active")
  // .map((agent: { knowledge_store_id: any; }) => agent.knowledge_store_id)
  // );
  // console.log('kg_store_ids:', kg_store_ids);

  // // Step 2: Filter the KnowledgeGraphData by those IDs
  // const filteredKnowledgeGraphData = (data.data || []).filter((item: { _id: any; }) =>
  // kg_store_ids.includes(item._id)
  // );
  // console.log('filteredKnowledgeGraphData:', filteredKnowledgeGraphData);

  // // Step 3: Set the filtered data
  // this.knowledgeGraphList = filteredKnowledgeGraphData;
  // }
  // else {
  // this.knowledgeGraphList = data.data || [];
  // }
  // }
  // else {
  // this.knowledgeGraphList = data.data;

  // }

  // this.changeDetectorRef.detectChanges();
  // this._loadingService.hide();
  // } else {
  // console.log("No knowledge Graph data found");
  // }
  // }, error => {
  // console.log("Error fetching knowledge Graph Details:", error);
  // });
  // }

  getKnowledgeGraphDropdownDetails(): void {
    //this._loadingService.show();
    this._secommendservice.getKnowledgeGraphDropdownDetails().subscribe(
      (data) => {
        if (data.success) {
          const kgDropdownOptions = (data.data || [])
          .filter((item: any) => {
            const provider = item.vector_store_provider ?? item.config?.vector_store_provider ?? '';

            console.log("kg data:", provider)
            return environment.rag.isKnowledgeGraph(provider);
          });
 
          console.log(`Loaded ${kgDropdownOptions.length} Knowledge Graph options`);

          // Fetch project list from state
          const activePrj = this.loggedUser?.ActiveProject;

          // ✅ Extract mapped team & role from PrjDetails for the active project
          const projectDetails = this.loggedUser?.ProjectDtl || [];

          // ✅ Find project mapping for the active project (case-insensitive)
          const mappedProject = projectDetails.find(
            (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
          );

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
            const projects =
              this._stateService.getProjectManagementData() || [];
            const activeProject = projects.find(
              (prj: any) =>
                prj.projectName &&
                prj.projectName.toLowerCase() === activePrj.toLowerCase()
            );

            console.log('Active Project Data:', activeProject);

            if (mappedTeam) {
              console.log('mappedTeam:', mappedTeam);

              this.agenciesWithAgents = this.agenciesWithAgents.filter(
                (agency) =>
                  agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
              );

              console.log('agenciesWithAgents:', this.agenciesWithAgents);

              // Step 1: Get all active agents’ knowledge_store_ids
              const kg_store_ids = this.agenciesWithAgents.flatMap((agency) =>
                (agency.agents || [])
                  .filter(
                    (agent: { status: string }) => agent.status === 'active'
                  )
                  .map(
                    (agent: { knowledge_store_id: any }) =>
                      agent.knowledge_store_id
                  )
              );
              console.log('kg_store_ids:', kg_store_ids);

              // Step 2: Filter the KnowledgeGraphData by those IDs
              // Step 2: Filter the KnowledgeGraphData by those IDs
              // const filteredKnowledgeGraphData = (data.data || []).filter((item: { _id: any;collection_Name:string }) =>
              // kg_store_ids.includes(item._id) && item.collection_Name.trim() !== ''
              // );
              const filteredKnowledgeGraphData = (
                (kgDropdownOptions || []) as any[]
              ).filter((item: { rag_id: any }) => kg_store_ids.includes(item.rag_id));

              console.log(
                'filteredKnowledgeGraphData:',
                filteredKnowledgeGraphData
              );

              // Step 3: Set the filtered data
              this.knowledgeGraphList = filteredKnowledgeGraphData;
            } else {
              this.knowledgeGraphList =
                (kgDropdownOptions as any[] || []).filter(
                  (gph: { collection_name: string }) =>
                    gph.collection_name && gph.collection_name.trim() !== ''
                ) || [];
            }
          } else {
            this.knowledgeGraphList = (kgDropdownOptions as any[]).filter(
              (gph: { collection_name: string }) =>
                gph.collection_name && gph.collection_name.trim() !== ''
            );
          }

          this.changeDetectorRef.detectChanges();
          this._loadingService.hide();
        } else {
          console.log('No knowledge Graph data found');
        }
      },
      (error) => {
        console.log('Error fetching knowledge Graph Details:', error);
      }
    );
  }

  getPrimaryActionLabel(
    team: string,
    agentname: string,
    runStatus?: string
  ): string {
    if (runStatus !== 'completed') {
      return 'Take Action';
    }

    switch (team) {
      case 'QA Team':
        return 'Review generated tests';

      case 'Development Team':
        return 'Review code snippets';

      case 'DevOps Team':
        return 'Review pipelines';

      case 'My Team':
        return 'Review suggestions';

      default:
        switch (agentname) {
          case 'Epic Feature Generator':
            return 'Review Epic & Features';

          case 'User Story Generator':
            return 'Review User Stories';

          case 'Requirements Validation':
            return 'Review Gaps';

          default:
            return 'Review details';
        }
    }
  }

  doLogOut(): void {
    this._stateService.clearLoginDetails();
    this._stateService.clearLoginOTPDetails();
    this._stateService.clearLogoutOTPDetails();
    this._loginservice.getReCaptchaConfig().subscribe((res) => {
      this.captcha = res.data.OTPRecaptcha;
      this._stateService.setLogoutOTPDetails(this.captcha);
      this._router.navigate(['/']);
    });
  }


  generateReport(): void {
    // Your logic here
    console.log('Generating report...');
  }

  getInsightAgentsData(): void {
    this._secommendservice.GetInsightAgents().subscribe({
      next: (response) => {
        this.insightAgents = response.data || [];
        this.filteredInsightAgents = [...this.insightAgents];
      },
      error: (err) => {
        console.error('Error fetching insight agents:', err);
      },
    });
  }

  filterInsightAgents(): void {
    const searchTerm = this.insightSearch?.trim().toLowerCase() || '';
    const selectedStatus = this.insightStatus || '';
    const selectedDateRange = this.insightDateRange || '';

    const today = new Date();
    let fromDate: Date | null = null;

    if (selectedDateRange === 'today') {
      fromDate = new Date(today);
      fromDate.setHours(0, 0, 0, 0);
    } else if (selectedDateRange === 'weekly') {
      fromDate = new Date(today);
      fromDate.setDate(today.getDate() - 7);
    } else if (selectedDateRange === 'monthly') {
      fromDate = new Date(today);
      fromDate.setDate(today.getDate() - 30);
    }

    this.filteredInsightAgents = this.insightAgents.filter((agent) => {
      const nameMatch =
        agent.agent_name?.toLowerCase().includes(searchTerm) ||
        agent.event_desc?.toLowerCase().includes(searchTerm) ||
        agent.event_name?.toLowerCase().includes(searchTerm) ||
        agent.event_output?.toLowerCase().includes(searchTerm);

      const statusMatch =
        !selectedStatus ||
        agent.event_status?.toLowerCase().trim() ===
          selectedStatus.toLowerCase().trim();

      let dateMatch = true;
      if (fromDate) {
        const createdDate = new Date(Date.parse(agent.created_ts));
        dateMatch = !isNaN(createdDate.getTime()) && createdDate >= fromDate;
      }

      return nameMatch && statusMatch && dateMatch;
    });
  }

  // Remove duplicate relationships by source, target, and type
  removeDuplicateLinks(relationships: any[]) {
    const seen = new Set<string>();
    return relationships.filter((r) => {
      const key = `${r.from}|${r.to}|${r.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Called when Background dropdown changes
  onBackgroundChange() {
    // Re-render or update visualization with current this.background
    if (
      this.selectedNodeTypes.length != 0 ||
      this.selectedLinkTypes.length != 0
    ) {
      this.filterForceGraph();
    } else {
      this.renderForceGraph();
    }
    this.overrideSceneNavInfoStyles();
    this.changeDetectorRef.detectChanges();
  }
  renderForceGraph(): void {
    const bgColor = this.background === 'white' ? '#ffffff' : '#000000';

    // Remove duplicate relationships
    const uniqueRelationships = this.removeDuplicateLinks(
      this.graphData.relationships
    );

    this.nodeTypes = Array.from(
      new Set(this.graphData.nodes.map((n) => n.type))
    ).sort();
    this.linkTypes = Array.from(
      new Set(uniqueRelationships.map((r) => r.type))
    ).sort();
    this.changeDetectorRef.detectChanges();

    const data = {
      nodes: this.graphData.nodes.map((n: any) => ({
        id: n.id,
        label: n.type,
        text: n.text,
      })),
      links: uniqueRelationships.map((r: any) => ({
        source: r.from,
        target: r.to,
        label: r.type,
      })),
    };

    // Track connected nodes
    const connectedNodeIds = new Set(
      data.links.flatMap((l: any) => [l.source, l.target])
    );

    // Count and index links per pair for curvature
    const linkCounts: { [key: string]: number } = {};
    (data.links as CustomLink[]).forEach((link) => {
      const key =
        link.source < link.target
          ? `${link.source}|${link.target}`
          : `${link.target}|${link.source}`;
      linkCounts[key] = (linkCounts[key] || 0) + 1;
    });
    const pairLinkIndices: { [key: string]: number } = {};
    (data.links as CustomLink[]).forEach((link) => {
      const key =
        link.source < link.target
          ? `${link.source}|${link.target}`
          : `${link.target}|${link.source}`;
      if (pairLinkIndices[key] === undefined) pairLinkIndices[key] = 0;
      link.pairIndex = pairLinkIndices[key]++;
      link.totalCount = linkCounts[key];
    });

    const container = this.graphContainer.nativeElement;

    const Graph = new ForceGraph3D(container)
      .graphData(data)
      .nodeColor((node: any) =>
        this.getNodeColor(node, connectedNodeIds, this.background)
      )
      .linkColor((link: any) => this.getLinkColor(link, this.background))
      .linkWidth(4) // or higher value for even thicker lines
      .backgroundColor(bgColor)
      .linkLabel((link: any) => link.label)
      .linkDirectionalArrowLength(8)
      .linkDirectionalArrowRelPos(1)
      .width(container.offsetWidth)
      .height(container.offsetHeight)
      .d3Force('charge', d3.forceManyBody().strength(-600))
      .d3Force('link', d3.forceLink().distance(350))
      .cooldownTicks(300)
      .linkCurvature((link: any) => {
        if (link.totalCount < 2) return 0;
        const mid = (link.totalCount - 1) / 2;
        return (link.pairIndex - mid) * 0.15;
      });

    Graph.nodeThreeObject((node: any) => {
      const group = new THREE.Group();
      const nodeColor = this.getNodeColor(
        node,
        connectedNodeIds,
        this.background
      );

      // Node sphere
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(8, 16, 16),
        new THREE.MeshLambertMaterial({ color: nodeColor })
      );

      // Text label
      const text = `${node.text} (${node.label})`;
      const fontSize = 14;
      const fontSpec = `${fontSize}px Sans-Serif`;

      const dpr = window.devicePixelRatio || 1;
      const padding = 16;

      // Measure text width
      const tmpCanvas = document.createElement('canvas');
      const tmpCtx = tmpCanvas.getContext('2d')!;
      tmpCtx.font = fontSpec;
      const textWidth = tmpCtx.measureText(text).width;

      const logicalWidth = textWidth + padding * 2;
      const logicalHeight = fontSize + padding;
      const canvasWidth = Math.ceil(logicalWidth * dpr);
      const canvasHeight = Math.ceil(logicalHeight * dpr);

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      ctx.font = fontSpec;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      // No fillRect = no background!
      ctx.fillStyle = this.background === 'black' ? '#fff' : '#000';
      ctx.fillText(text, padding, logicalHeight / 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;

      const spriteScaleDivisor = 1.0;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, transparent: true })
      );
      sprite.scale.set(
        logicalWidth / spriteScaleDivisor,
        logicalHeight / spriteScaleDivisor,
        1
      );
      sprite.position.set(0, logicalHeight / (2 * spriteScaleDivisor), 0);

      group.add(sphere);
      group.add(sprite);

      return group;
    });

    this.graphInstance = Graph;

    // After graph is rendered, apply canvas and container height fixes
    setTimeout(() => {
      // Adjust the scene container height
      const sceneCont = document.querySelector(
        '.scene-container'
      ) as HTMLElement | null;
      if (sceneCont) {
        sceneCont.style.height = '560px';
      }

      // Adjust the canvas height inside the container
      const canvas = sceneCont?.querySelector(
        'canvas'
      ) as HTMLCanvasElement | null;
      if (canvas) {
        canvas.style.height = '560px'; // CSS height
        canvas.height = 560; // Canvas actual height
      }

      // Also adjust the ForceGraph instance size if needed
      if (this.graphInstance) {
        this.graphInstance.height(sceneCont ? sceneCont.offsetHeight : 500);
        this.graphInstance.width(
          sceneCont ? sceneCont.offsetWidth : container.offsetWidth
        );
      }
    }, 0);
  }

  onRagIdChange(): void {
    this.selectedNodeTypes = [];
    this.selectedLinkTypes = [];
	this.searchKgTerm = '';
    this.changeDetectorRef.detectChanges();
    // Always clear the graph container first
    if (this.graphContainer?.nativeElement) {
      this.graphContainer.nativeElement.innerHTML = '';
    }

    if (this.selectedRagId) {
      this.loadKnowledgeGraphWithRagId(this.selectedRagId);
    } else {
      // Clear the graph data if no RAG ID is selected
      this.NoDataAvailable = '';
      this.graphData = { nodes: [], relationships: [] };
      this.background = 'white';
      this.isNight = this.background === 'white' ? true : false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // loadKnowledgeGraphWithRagId(ragId: string): void {
  // this._secommendservice.GetGraphData({ rag_id: ragId })
  // .subscribe({
  // next: (res) => {
  // console.log("Knowledge Graph API response:", res);
  // const graph = res.graph_data;

  // if (!graph || graph.nodes === undefined || graph.edges === undefined) {
  // console.error("Invalid graph data:", graph);
  // return;
  // }
  // this.NoDataAvailable="";

  // this.graphData = {
  // nodes: (graph.nodes || []).map((n: any) => ({
  // id: n.id,
  // text: n.text,
  // type: n.type
  // })),
  // relationships: (graph.edges || []).map((e: any) => ({
  // from: e.source,
  // to: e.target,
  // type: e.type
  // }))
  // };
  // // Force change detection first
  // this.changeDetectorRef.detectChanges();
  // // Then render the graph after a brief delay to ensure DOM is updated
  // setTimeout(() => {
  // if (this.graphContainer?.nativeElement) {
  // this.graphContainer.nativeElement.innerHTML = '';
  // this.renderForceGraph();
  // // Listen to fullscreen changes to resize graph accordingly
  // document.addEventListener('fullscreenchange', this.onFullScreenChange);
  // this.overrideSceneNavInfoStyles();
  // this.changeDetectorRef.detectChanges();
  // }
  // }, 100);
  // },
  // error: (err) => {
  // //console.error('Error Get the KnowledgeGraph:', err);
  // var kg_name = this.knowledgeGraphList.find(kg => kg._id === ragId)?.collection_name;
  // this.NoDataAvailable = kg_name +" graph has no preview";
  // this.changeDetectorRef.detectChanges();
  // this._loadingService.hide();
  // }
  // });
  // }

  loadKnowledgeGraphWithRagId(ragId: string): void {
    this._secommendservice.GetGraphData({ rag_id: ragId }).subscribe({
      next: (res) => {
        console.log('Knowledge Graph API response:', res);
        const graph = res.data;

        if (!graph || graph.nodes === undefined || graph.edges === undefined) {
          console.error('Invalid graph data:', graph);
          return;
        }
        this.NoDataAvailable = '';

        this.graphData = {
          nodes: (graph.nodes || []).map((n: any) => ({
            id: n.id,
            text: n.text,
            type: n.type,
          })),
          relationships: (graph.edges || []).map((e: any) => ({
            from: e.source,
            to: e.target,
            type: e.type,
          })),
        };
        // Force change detection first
        this.changeDetectorRef.detectChanges();
        // Then render the graph after a brief delay to ensure DOM is updated
        setTimeout(() => {
          if (this.graphContainer?.nativeElement) {
            this.graphContainer.nativeElement.innerHTML = '';
            this.renderForceGraph();
            // Listen to fullscreen changes to resize graph accordingly
            document.addEventListener(
              'fullscreenchange',
              this.onFullScreenChange
            );
            this.overrideSceneNavInfoStyles();
            this.changeDetectorRef.detectChanges();
          }
        }, 100);
      },
      error: (err) => {
        //console.error('Error Get the KnowledgeGraph:', err);
        this.graphData = { nodes: [], relationships: [] };
        var kg_name = this.knowledgeGraphList.find(
          (kg) => kg.rag_id === ragId
        )?.collection_name;
        this.NoDataAvailable = kg_name + ' graph has no preview';
        this.changeDetectorRef.detectChanges();
        this._loadingService.hide();
      },
    });
  }

  loadKnowledgeGraphDirectly(): void {
    // Don't load any data by default - just clear the graph
    this.graphData = { nodes: [], relationships: [] };
    if (this.graphContainer?.nativeElement) {
      this.graphContainer.nativeElement.innerHTML = '';
    }
    // Reset selected RAG ID
    this.selectedRagId = '';
  }

  applyFilters(): void {
    let filteredNodes = this.graphData.nodes;
    let filteredLinks = this.graphData.relationships;
    this.linkTypesAll = this.removeDuplicateLinks(this.graphData.relationships);

    // 1. Filter nodes by Node Type (if selected)
    if (this.selectedNodeTypes && this.selectedNodeTypes.length > 0) {
      filteredNodes = filteredNodes.filter((node) =>
        this.selectedNodeTypes.includes(node.type)
      );
    }

    // 2. Adjust Link Types dropdown options based on selections
    if (
      (!this.selectedNodeTypes || this.selectedNodeTypes.length === 0) &&
      (!this.selectedLinkTypes || this.selectedLinkTypes.length === 0)
    ) {
      // No selection: reset all link types options and clear selected links
      this.linkTypes = [...this.linkTypesAll];
      this.selectedLinkTypes = [];
    } else if (this.selectedNodeTypes && this.selectedNodeTypes.length > 0) {
      // Nodes selected: filter links related to nodes and restrict linkTypes dropdown accordingly
      const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
      filteredLinks = filteredLinks.filter(
        (link) => filteredNodeIds.has(link.from) || filteredNodeIds.has(link.to)
      );

      const linkTypesMapped = Array.from(
        new Set(filteredLinks.map((link) => link.type))
      );
      this.linkTypes = this.linkTypesAll.filter((lt) =>
        linkTypesMapped.includes(lt)
      );
      // Do NOT overwrite selectedLinkTypes here - preserve user selection
    } else {
      // Link types selected but no nodes: show all link types options without filtering
      this.linkTypes = [...this.linkTypesAll];
      // Keep selectedLinkTypes as is
    }

    // 3. Filter links by selectedLinkTypes if any selected
    if (this.selectedLinkTypes && this.selectedLinkTypes.length > 0) {
      filteredLinks = filteredLinks.filter((link) =>
        this.selectedLinkTypes.includes(link.type)
      );
    }

    // 4. Compute connected node IDs from filtered links
    const connectedNodeIds = new Set(
      filteredLinks.flatMap((l) => [l.from, l.to])
    );

    // 5. Include all nodes connected by filtered links or selected by node type (even if isolated)
    filteredNodes = this.graphData.nodes.filter(
      (n) =>
        connectedNodeIds.has(n.id) ||
        (this.selectedNodeTypes &&
          this.selectedNodeTypes.includes(n.type) &&
          !connectedNodeIds.has(n.id))
    );

    // 6. Remove duplicate links
    filteredLinks = this.removeDuplicateLinks(filteredLinks);

    // 7. Update filtered graph data
    this.filteredGraphData = {
      nodes: filteredNodes,
      relationships: filteredLinks,
    };

    this.filterForceGraph();
    this.overrideSceneNavInfoStyles();
    this.changeDetectorRef.detectChanges();
  }

  onSearchInput(event: any): void {

    this.searchKgTerm = event.target.value;
    // Optional: Add debounce for better performance
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    this.searchDebounceTimer = setTimeout(() => {
      this.applySearchFilters();
    }, 300); // 300ms debounce
  }

  applySearchFilters(): void {
    const searchTerm = this.searchKgTerm?.trim().toLowerCase();

    let filteredNodes = this.graphData.nodes;
    let filteredLinks = this.graphData.relationships;

    this.linkTypesAll = this.removeDuplicateLinks(this.graphData.relationships);

    // ====================== 1. INITIAL FILTER: Search + Node Type ======================
    filteredNodes = this.graphData.nodes.filter((node) => {
      const matchesSearch = !searchTerm ||
        (node.text?.toLowerCase().includes(searchTerm) ||
          node.type?.toLowerCase().includes(searchTerm));

      const matchesNodeType = !this.selectedNodeTypes?.length ||
        this.selectedNodeTypes.includes(node.type);

      return matchesSearch && matchesNodeType;
    });

    // ====================== NEW: FALLBACK - Search in Links if no nodes found ======================
    if (filteredNodes.length === 0 && searchTerm) {
      // Search in link types or any link properties
      filteredLinks = this.graphData.relationships.filter((link) => {
        return (
          link.type?.toLowerCase().includes(searchTerm)
        );
      });

      // Get all nodes connected to these matching links
      const connectedNodeIds = new Set(
        filteredLinks.flatMap(l => [l.from, l.to])
      );

      filteredNodes = this.graphData.nodes.filter(node =>
        connectedNodeIds.has(node.id)
      );
    }
    // ====================================================================================

    // ====================== 2. FILTER LINKS BASED ON FILTERED NODES ======================
    const filteredNodeIds = new Set(filteredNodes.map(n => n.id));

    filteredLinks = this.graphData.relationships.filter((link) =>
      filteredNodeIds.has(link.from) || filteredNodeIds.has(link.to)
    );

    // ====================== 3. Apply Link Type Filter ======================
    if (this.selectedLinkTypes && this.selectedLinkTypes.length > 0) {
      filteredLinks = filteredLinks.filter((link) =>
        this.selectedLinkTypes.includes(link.type)
      );
    }

    // ====================== 4. Update Link Types Dropdown ======================
    if (this.selectedNodeTypes?.length > 0 || searchTerm) {
      const availableLinkTypes = Array.from(new Set(filteredLinks.map(l => l.type)));
      this.linkTypes = this.linkTypesAll.filter(lt => availableLinkTypes.includes(lt));
    } else {
      this.linkTypes = [...this.linkTypesAll];
      this.selectedLinkTypes = [];
    }

    // ====================== 5. Final Connected Nodes ======================
    const finalConnectedIds = new Set(filteredLinks.flatMap(l => [l.from, l.to]));

    filteredNodes = this.graphData.nodes.filter((node) => {
      const isConnected = finalConnectedIds.has(node.id);
      const matchesNodeType = this.selectedNodeTypes?.includes(node.type) || false;
      const matchesSearch = !searchTerm ||
        (node.text?.toLowerCase().includes(searchTerm) ||
          node.type?.toLowerCase().includes(searchTerm));

      return isConnected || (matchesNodeType && matchesSearch);
    });

    // ====================== 6. Final Cleanup ======================
    filteredLinks = this.removeDuplicateLinks(filteredLinks);

    this.filteredGraphData = {
      nodes: filteredNodes,
      relationships: filteredLinks,
    };

    this.filterForceGraph();
    this.overrideSceneNavInfoStyles();
    this.changeDetectorRef.detectChanges();
  }
 
 filterForceGraph(): void {
    const bgColor = this.background === 'white' ? '#ffffff' : '#000000';

    // Remove duplicate relationships
    const uniqueRelationships = this.removeDuplicateLinks(
      this.filteredGraphData.relationships
    );

    this.nodeTypes = Array.from(
      new Set(this.filteredGraphData.nodes.map((n) => n.type))
    ).sort();
    this.linkTypes = Array.from(
      new Set(uniqueRelationships.map((r) => r.type))
    ).sort();
    this.changeDetectorRef.detectChanges();

    const data = {
      nodes: this.filteredGraphData.nodes.map((n: any) => ({
        id: n.id,
        label: n.type,
        text: n.text,
      })),
      links: uniqueRelationships.map((r: any) => ({
        source: r.from,
        target: r.to,
        label: r.type,
      })),
    };

    // Track connected nodes
    const connectedNodeIds = new Set(
      data.links.flatMap((l: any) => [l.source, l.target])
    );

    // Count and index links per pair for curvature
    const linkCounts: { [key: string]: number } = {};
    (data.links as CustomLink[]).forEach((link) => {
      const key =
        link.source < link.target
          ? `${link.source}|${link.target}`
          : `${link.target}|${link.source}`;
      linkCounts[key] = (linkCounts[key] || 0) + 1;
    });
    const pairLinkIndices: { [key: string]: number } = {};
    (data.links as CustomLink[]).forEach((link) => {
      const key =
        link.source < link.target
          ? `${link.source}|${link.target}`
          : `${link.target}|${link.source}`;
      if (pairLinkIndices[key] === undefined) pairLinkIndices[key] = 0;
      link.pairIndex = pairLinkIndices[key]++;
      link.totalCount = linkCounts[key];
    });

    const container = this.graphContainer.nativeElement;

    const Graph = new ForceGraph3D(container)
      .graphData(data)
      .nodeColor((node: any) =>
        this.getNodeColor(node, connectedNodeIds, this.background)
      )
      .linkColor((link: any) => this.getLinkColor(link, this.background))
      .linkWidth(4) // or higher value for even thicker lines
      .backgroundColor(bgColor)
      .linkLabel((link: any) => link.label)
      .linkDirectionalArrowLength(8)
      .linkDirectionalArrowRelPos(1)
      .width(container.offsetWidth)
      .height(container.offsetHeight)
      .d3Force('charge', d3.forceManyBody().strength(-600))
      .d3Force('link', d3.forceLink().distance(350))
      .cooldownTicks(300)
      .linkCurvature((link: any) => {
        if (link.totalCount < 2) return 0;
        const mid = (link.totalCount - 1) / 2;
        return (link.pairIndex - mid) * 0.15;
      });

    Graph.nodeThreeObject((node: any) => {
      const group = new THREE.Group();
      const nodeColor = this.getNodeColor(
        node,
        connectedNodeIds,
        this.background
      );

      // Node sphere
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(8, 16, 16),
        new THREE.MeshLambertMaterial({ color: nodeColor })
      );

      // Text label
      const text = `${node.text} (${node.label})`;
      const fontSize = 14;
      const fontSpec = `${fontSize}px Sans-Serif`;

      const dpr = window.devicePixelRatio || 1;
      const padding = 16;

      // Measure text width
      const tmpCanvas = document.createElement('canvas');
      const tmpCtx = tmpCanvas.getContext('2d')!;
      tmpCtx.font = fontSpec;
      const textWidth = tmpCtx.measureText(text).width;

      const logicalWidth = textWidth + padding * 2;
      const logicalHeight = fontSize + padding;
      const canvasWidth = Math.ceil(logicalWidth * dpr);
      const canvasHeight = Math.ceil(logicalHeight * dpr);

      const canvas = document.createElement('canvas');
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      ctx.font = fontSpec;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      // No fillRect = no background!
      ctx.fillStyle = this.background === 'black' ? '#fff' : '#000';
      ctx.fillText(text, padding, logicalHeight / 2);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.needsUpdate = true;

      const spriteScaleDivisor = 1.0;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: texture, transparent: true })
      );
      sprite.scale.set(
        logicalWidth / spriteScaleDivisor,
        logicalHeight / spriteScaleDivisor,
        1
      );
      sprite.position.set(0, logicalHeight / (2 * spriteScaleDivisor), 0);

      group.add(sphere);
      group.add(sprite);

      return group;
    });
    this.graphInstance = Graph;

    // After graph is rendered, apply canvas and container height fixes
    setTimeout(() => {
      // Adjust the scene container height
      const sceneCont = document.querySelector(
        '.scene-container'
      ) as HTMLElement | null;
      if (sceneCont) {
        sceneCont.style.height = '560px';
      }

      // Adjust the canvas height inside the container
      const canvas = sceneCont?.querySelector(
        'canvas'
      ) as HTMLCanvasElement | null;
      if (canvas) {
        canvas.style.height = '560px'; // CSS height
        canvas.height = 560; // Canvas actual height
      }

      // Also adjust the ForceGraph instance size if needed
      if (this.graphInstance) {
        this.graphInstance.height(sceneCont ? sceneCont.offsetHeight : 500);
        this.graphInstance.width(
          sceneCont ? sceneCont.offsetWidth : container.offsetWidth
        );
      }
    }, 0);
  }

  getNodeColor(
    node: any,
    connectedNodeIds: Set<string>,
    background: string
  ): string {
    // Color mappings for dark theme
    const LABEL_COLOR_MAP_DARK: Record<string, string> = {
      Document: '#1f78b4',
      Chunk: '#33a02c',
      Entity: '#e31a1c',
      Community: '#ff7f00',
      Concept: '#6a3d9a',
      Date: '#b15928',
      Resource: '#a6cee3',
      Person: '#b2df8a',
      Application: '#fb9a99',
      DocumentSection: '#fdbf6f',
      Organization: '#cab2d6',
      Region: '#ffff99',
      Process: '#1f78b4',
      Requirement: '#33a02c',
      Epic: '#e31a1c',
      Feature: '#ff7f00',
      UserStory: '#6a3d9a',
      TestCase: '#b15928',
      Defect: '#a6cee3',
      Project: '#b2df8a',
      Field: '#ff9900',
      Form: '#fdbf6f',
      Status: '#fb9a99',
      Category: '#cab2d6',
      Version: '#ffff99',
      Objective: '#1f78b4',
      Priority: '#33a02c',
      Severity: '#e31a1c',
      Test_Case: '#ff7f00',
      User_Story: '#6a3d9a',
      Credential: '#b15928',
      Module: '#a6cee3',
      Technology: '#b2df8a',
      Framework: '#fdbf6f',
      ConfigurationSetting: '#fb9a99',
      Namespace: '#cab2d6',
      Controller: '#ffff99',
      ReturnType: '#1f78b4',
      Model: '#19b800',
      ValidationState: '#cab6e7',
      FileField: '#6b31c4',
      Method: '#f5c41c',
      Variable: '#f0e442',
      FeedbackMessage: '#99e6ee',
      ServiceContainer: '#66c2a5',
      Service: '#fc8d62',
      Configuration: '#8da0cb',
      Middleware: '#e78ac3',
      Action: '#a6d854',
      Parameter: '#ffd92f',
      Location: '#7c7cff',
      Property_Value: '#b3b3b3',
      Property_Value_ImplicitUsings: '#fccde5',
      Class: '#d9d9d9',
      Limit: '#bc80bd',
      ViewData: '#ccebc5',
      SecurityFeature: '#ffed6f',
      List: '#82caff',
      Movie: '#8dd3c7',
      EntityCategory: '#ffffb3',
      Issue_Type: '#bebada',
      Placeholder: '#fb8072',
      Workflow_Step: '#80b1d3',
      Feedback: '#fdb462',
      URL: '#b15928',
      Browser: '#d9d9d9',
      UI_Element: '#bc80bd',
      Functionality: '#ccebc5',
      Output: '#ffed6f',
      Platform: '#ffb6b9',
      Screen_Mode: '#8dd3c7',
      Entity_Identifier: '#ffffb3',
      Content: '#bebada',
      User: '#fb8072',
      Metric: '#80b1d3',
      Verification_Step: '#fdb462',
      TestPlan: '#b15928',
      Portal: '#d9d9d9',
      AccessLevel: '#bc80bd',
      BRD: '#ccebc5',
      ScopeItem: '#ffed6f',
      OutOfScopeItem: '#ffb6b9',
      default: '#999999',
    };

    // Color mappings for light theme
    const LABEL_COLOR_MAP_LIGHT: Record<string, string> = {
      Document: '#084081',
      Chunk: '#1a9850',
      Entity: '#d73027',
      Community: '#fdae61',
      Concept: '#6e016b',
      Date: '#8c510a',
      Resource: '#67a9cf',
      Person: '#a6dba0',
      Application: '#ef8a62',
      DocumentSection: '#fee08b',
      Organization: '#9e0168',
      Region: '#d9ef8b',
      Process: '#084081',
      Requirement: '#1a9850',
      Epic: '#d73027',
      Feature: '#fdae61',
      UserStory: '#6e016b',
      TestCase: '#8c510a',
      Defect: '#67a9cf',
      Project: '#a6dba0',
      Field: '#ff9900',
      Form: '#fee08b',
      Status: '#ef8a62',
      Category: '#9e0168',
      Version: '#d9ef8b',
      Objective: '#084081',
      Priority: '#1a9850',
      Severity: '#d73027',
      Test_Case: '#fdae61',
      User_Story: '#6e016b',
      Credential: '#8c510a',
      Module: '#67a9cf',
      Technology: '#a6dba0',
      Framework: '#fee08b',
      ConfigurationSetting: '#ef8a62',
      Namespace: '#9e0168',
      Controller: '#d9ef8b',
      ReturnType: '#084081',
      Model: '#228B22',
      ValidationState: '#554470',
      FileField: '#6b31c4',
      Method: '#997700',
      Variable: '#e6da9c',
      FeedbackMessage: '#329a9d',
      ServiceContainer: '#66c2a5',
      Service: '#fc8d62',
      Configuration: '#8da0cb',
      Middleware: '#e78ac3',
      Action: '#a6d854',
      Parameter: '#ffd92f',
      Location: '#1a237e',
      Property_Value: '#b3b3b3',
      Property_Value_ImplicitUsings: '#fccde5',
      Class: '#d9d9d9',
      Limit: '#bc80bd',
      ViewData: '#ccebc5',
      SecurityFeature: '#ffed6f',
      List: '#0b5394',
      Movie: '#8dd3c7',
      EntityCategory: '#ffffb3',
      Issue_Type: '#bebada',
      Placeholder: '#fb8072',
      Workflow_Step: '#80b1d3',
      Feedback: '#fdb462',
      URL: '#b15928',
      Browser: '#d9d9d9',
      UI_Element: '#bc80bd',
      Functionality: '#ccebc5',
      Output: '#ffed6f',
      Platform: '#ffb6b9',
      Screen_Mode: '#8dd3c7',
      Entity_Identifier: '#ffffb3',
      Content: '#bebada',
      User: '#fb8072',
      Metric: '#80b1d3',
      Verification_Step: '#fdb462',
      TestPlan: '#b15928',
      Portal: '#d9d9d9',
      AccessLevel: '#bc80bd',
      BRD: '#ccebc5',
      ScopeItem: '#ffed6f',
      OutOfScopeItem: '#ffb6b9',
      default: '#666666',
    };

    // If the node is isolated (not connected), color red
    if (!connectedNodeIds.has(node.id)) {
      return 'red';
    }

    // Pick palette based on background theme
    const palette =
      background === 'white' ? LABEL_COLOR_MAP_LIGHT : LABEL_COLOR_MAP_DARK;

    // Return color for node label, falling back to default
    return palette[node.label] || palette['default'];
  }

  getLinkColor(link: any, background: string): string {
    if (background === 'white') {
      switch (link.label) {
        case 'Document Information':
          return 'darkorange';
        case 'Initial Date':
          return 'navy';
        case 'Last Revision':
          return 'purple';
        case 'Reviewed By':
          return 'darkred';
        case 'Prepared By':
          return 'darkgreen';
        case 'Version':
          return 'goldenrod';
        default:
          return '#222'; // Strong dark gray for white bg
      }
    } else {
      // Highlighted blue for all or most links, inspired by border in your image
      const highlightBlue = '#FFD700';
      switch (link.label) {
        case 'Document Information':
        case 'Initial Date':
        case 'Last Revision':
        case 'Reviewed By':
        case 'Prepared By':
        case 'Version':
          return highlightBlue; // All mapped as highlight blue
        default:
          return highlightBlue; // All others, too
      }
    }
  }

  OnSelectAllTypes(val: boolean): void {
    if (val) {
      this.selectedNodeTypes = [...this.nodeTypes];
      this.selectedLinkTypes = [...this.linkTypes];
    } else {
      this.selectedLinkTypes = [...this.linkTypes];
    }
    this.renderForceGraph();
  }

  onDeselectAllTypes(val: boolean): void {
    if (val) {
      this.selectedNodeTypes = [];
      this.selectedLinkTypes = [];
    } else {
      this.selectedNodeTypes = [];
      this.selectedLinkTypes = [];
    }
    this.renderForceGraph();
  }

overrideSceneNavInfoStyles() {
    const sceneNav = document.querySelector('.scene-nav-info') as HTMLElement | null;

    if (sceneNav) {
      Object.assign(sceneNav.style, {
        position: 'fixed',
        left: '38px',
        bottom: '20px',
        right: 'auto',
        width: 'auto',
        textAlign: 'left',
        color: this.background === 'black' ? '#fff' : '#000',
        background: 'transparent',        // ← Kept original
        opacity: '1',
        fontSize: '14px',
        fontFamily: 'sans-serif',
        borderRadius: '6px',
        fontWeight: '600',
        padding: '10px 18px',
        zIndex: '1000',
        pointerEvents: 'auto',            // ← Important for dragging
        userSelect: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
        cursor: 'move'                    // ← Added for better UX
      });

      sceneNav.textContent =
        'Left-click: rotate, Mouse-wheel/middle-click: zoom, Right-click: pan, Click: esc for exit full screen';

      this.makeElementDraggable(sceneNav);
    }
  }

  private makeElementDraggable(element: HTMLElement): void {
    // Prevent multiple listeners
    if ((element as any)._isDraggable) return;
    (element as any)._isDraggable = true;

    let isDragging = false;
    let currentX = 0;
    let currentY = 0;
    let initialX = 0;
    let initialY = 0;

    const startDrag = (e: MouseEvent | TouchEvent) => {
      isDragging = true;

      // Get current position
      const rect = element.getBoundingClientRect();
      currentX = rect.left;
      currentY = rect.top;

      const clientX = e instanceof MouseEvent ? e.clientX : (e as TouchEvent).touches[0].clientX;
      const clientY = e instanceof MouseEvent ? e.clientY : (e as TouchEvent).touches[0].clientY;

      initialX = clientX - currentX;
      initialY = clientY - currentY;

      element.style.transition = 'none';
      element.style.bottom = 'auto';   // Switch from bottom to top positioning
      element.style.left = `${currentX}px`;
      element.style.top = `${currentY}px`;

      e.preventDefault();
    };

    const onDrag = (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;

      const clientX = e instanceof MouseEvent ? e.clientX : (e as TouchEvent).touches[0].clientX;
      const clientY = e instanceof MouseEvent ? e.clientY : (e as TouchEvent).touches[0].clientY;

      currentX = clientX - initialX;
      currentY = clientY - initialY;

      element.style.left = `${currentX}px`;
      element.style.top = `${currentY}px`;
    };

    const stopDrag = () => {
      isDragging = false;
    };

    // Add listeners
    element.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);

    element.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('touchmove', onDrag, { passive: false });
    document.addEventListener('touchend', stopDrag);
  }

  onFullScreenChange = () => {
    const el = this.graphContainer.nativeElement;
    if (this.graphInstance) {
      if (document.fullscreenElement === el) {
        this.graphInstance.width(window.innerWidth).height(window.innerHeight);
      } else {
        this.graphInstance.width(el.offsetWidth).height(el.offsetHeight);
      }
    }
  };

  toggleDayNight(): void {
    this.isNight = !this.isNight;
    this.changeDetectorRef.detectChanges();
    this.background = this.isNight === true ? 'white' : 'black';
    this.onBackgroundChange();
  }

  clearFilters(): void {
    this.selectedNodeTypes = [];
    this.selectedLinkTypes = [];

    if (this.searchKgTerm) {
      this.searchDebounceTimer = setTimeout(() => {
        this.applySearchFilters();
      }, 300); // 300ms debounce
    }
    else {
      this.renderForceGraph();
    }
    this.changeDetectorRef.detectChanges();
  }

  // Replace zoom handlers:
  zoomIn() {
    if (this.graphInstance) {
      const camera = this.graphInstance.camera();
      camera.position.z /= this.zoomStep;
      this.graphInstance.controls().update();
    }
  }
  zoomOut() {
    if (this.graphInstance) {
      const camera = this.graphInstance.camera();
      camera.position.z *= this.zoomStep;
      this.graphInstance.controls().update();
    }
  }
  toggleFullScreen() {
    const el = this.graphContainer.nativeElement;
    if (el) {
      if (!document.fullscreenElement) {
        el.requestFullscreen().then(() => {
          this.graphInstance.width(el.offsetWidth).height(el.offsetHeight);
          this.graphInstance.refresh();
        });
      } else {
        document.exitFullscreen().then(() => {
          this.graphInstance.width(el.offsetWidth).height(el.offsetHeight);
          this.graphInstance.refresh();
        });
      }
    }
  }
  
  
  startDragging(event: MouseEvent | TouchEvent): void {
    this.isDragging = true;

    const clientX = event instanceof MouseEvent ? event.clientX : (event as TouchEvent).touches[0].clientX;
    const clientY = event instanceof MouseEvent ? event.clientY : (event as TouchEvent).touches[0].clientY;

    this.initialX = clientX - this.currentX;
    this.initialY = clientY - this.currentY;

    event.preventDefault();
  }

  @HostListener('document:mousemove', ['$event'])
  @HostListener('document:touchmove', ['$event'])
  onMove(event: MouseEvent | TouchEvent): void {
    if (!this.isDragging) return;

    const clientX = event instanceof MouseEvent ? event.clientX : (event as TouchEvent).touches[0].clientX;
    const clientY = event instanceof MouseEvent ? event.clientY : (event as TouchEvent).touches[0].clientY;

    this.currentX = clientX - this.initialX;
    this.currentY = clientY - this.initialY;

    this.updatePosition();
  }

  @HostListener('document:mouseup')
  @HostListener('document:touchend')
  endDragging(): void {
    this.isDragging = false;
  }

  private updatePosition(): void {
    if (this.zoomControls) {
      const element = this.zoomControls.nativeElement;
      element.style.left = `${this.currentX}px`;
      element.style.top = `${this.currentY}px`;
    }
  }

  // Optional: Prevent dragging when clicking buttons
  preventDrag(event: Event): void {
    event.stopPropagation();
  }
  
}

// 1. Add at the TOP of your component file:
interface CustomLink {
  source: string;
  target: string;
  label?: string;
  totalCount: number;
  pairIndex: number;
}
