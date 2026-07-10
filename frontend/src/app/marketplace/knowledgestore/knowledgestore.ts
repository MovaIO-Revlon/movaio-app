import {
  Component,
  OnInit,
  AfterViewInit,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { NgxSpinnerService } from 'ngx-spinner';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
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
  FormControl,
} from '@angular/forms';
import { ChangeDetectorRef } from '@angular/core';
import { SemarketplaceService } from '../../services/semarketplace.service';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { HomeService } from '../../services/home.service';
import { HttpClient } from '@angular/common/http';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { RolePrivilegeMappingService } from '../../services/role-privilege-mapping.service';
import { environment as config } from '../../../environments/environment';
import { secommendcenter } from '../../services/secommedcenter.service';
import { Chart } from 'chart.js';
declare var $: any;
declare var bootstrap: any;

@Component({
  selector: 'app-knowledgestore',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, TooltipDirective],
  templateUrl: './knowledgestore.html',
  styleUrl: './knowledgestore.css',
})
export class Knowledgestore implements AfterViewInit, OnInit {
  constructor(
    private _loadingService: NgxSpinnerService,
    private _router: Router,
    private _marketService: SemarketplaceService,
    private fb: FormBuilder,
    private cdRef: ChangeDetectorRef,
    private _homeService: HomeService,
    private http: HttpClient,
    private _stateService: AIInfuseStateService,
    private _secommendservice: secommendcenter,
    private _rolePrivilegeService: RolePrivilegeMappingService,
    private _apiService: SemarketplaceService
  ) {
    this.kgForm = this.fb.group({
      kgName: [{ value: '', disabled: this.isViewMode }, Validators.required],
      kgId: [{ value: '', disabled: this.isViewMode }, Validators.required],
      effectiveDate: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      description: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      outputStore: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      inputSourceType: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      outputSourceType: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      numberOfChunks: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      chunkType: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
    });

    this.filterkgForm = new FormGroup({
      collection_id: new FormControl([]),
      desc_id: new FormControl([]),
      vector_store_id: new FormControl([]),
      effective_date: new FormControl(''),
    });
  }

  @ViewChild('onboardknowledgestore') onboardknowledgestoreModal!: ElementRef;
  @ViewChild('filt') filterModalRef!: ElementRef;

  kgForm!: FormGroup;
  filterkgForm!: FormGroup;
  loggedUser: any;
  role: any;
  isPrivilegeView: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeRefresh: boolean = false;
  isPrivilegeExecute: boolean = false;
  knowledeGraphCountsList = [
    {
      label: 'All Knowledge Graphs',
      key: 'total_knowlegeGraph',
      count: 0,
      active: true,
    },
  ];
  isEditMode: boolean = false;
  searchTerm: string = '';
  KnowledgeStoreData: any[] = [];
  filteredkwStore: any[] = [];
  KnowledgeGraphName: any[] = [];
  KnowledgeDescription: any[] = [];
  KnowledgeVectorStoreName: any[] = [];
  paginatedkwStore: any[] = [];
  agenciesWithAgents: any[] = [];
  toastMessage: string = '';
  masterDatabase = config.masterDatabase;

  isViewMode = true;

  currentStep: number = 1;
  totalSteps: number = 4;
  totalItems = 24;
  itemsPerPage = 6;
  currentPage = 1;
  pageSizeOptions = [6, 12, 24];
  addedFiles: Array<{ name: string; extension: string }> = [];
  addedOutputStores: Array<{ name: string }> = [];

  collectionDisplay: string[] = [];
  collectionAddedCount: number = 0;
  descDisplay: string[] = [];
  descAddedCount: number = 0;
  vectorDisplay: string[] = [];
  vectorAddedCount: number = 0;
  isSideCollapsed = true;
  isRightCollapsed = true;
  kgStats: any = {
    totalAgencies: 0
  };

  donutChartInitialized: boolean = false;
  agencyDonutChart?: Chart<'doughnut', number[], unknown> = undefined;
  agencyChartLabels: string[] = [];
  agencyChartData: number[] = [];
  agencyLegendData: Array<{ label: string; count: number; color: string }> = [];
  isAgencyManage: boolean = true;

  // Controls max shown, can be dynamically calculated by width if needed
  readonly maxDisplay = 2;
  showDescription = false;
  showVectorStore = false;
  baseDisplay: string[] = [];
  baseAddedCount: number = 0;
  KnowledgeBaseName: any[] = [];
  knowledgeGraphList: any[] = [];
  knowledgeBaseList: any[] = [];
  selectedItem: any = null;
  knowledgeNameLabel = 'KG Name';
  knowledgeIdLabel = 'KG ID';
  knowledgeIPSourceLabel= 'KG I/P Sources';
  knowledgeName= 'Knowledge Graph';
  kgorKbName= 'KG';
  agentChartInitialized: boolean = false;
  agentDonutChart?: Chart<'doughnut', number[], unknown> = undefined;
  agentChartLabels: string[] = [];
  agentChartData: number[] = [];
  agentLegendData: Array<{ label: string; count: number; color: string }> = [];
  agentStats: any = {
    totalAgentsByStore: 0
  };
  kbKgStats: any = {
  filteredTotal: 0
  };
  allAgentsByStore: Record<string, string[]> = {};
  currentFilterType: string = '';
  currentFilterValue: string = '';
  

  //#region Angular Lifecycle Hooks
  ngOnInit(): void {
    this.loggedUser = this._stateService.getLoginDetails();
    this.fetchAgenciesWithAgents();
    this.fetchAgencyStatistics();

    this.kgForm = this.fb.group({
      kgName: [{ value: '', disabled: this.isViewMode }, Validators.required],
      kgId: [{ value: '', disabled: this.isViewMode }, Validators.required],
      effectiveDate: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      description: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      outputStore: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      inputSourceType: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      outputSourceType: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      numberOfChunks: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
      chunkType: [
        { value: '', disabled: this.isViewMode },
        Validators.required,
      ],
    });

    this.filterkgForm = new FormGroup({
      collection_id: new FormControl([]),
      desc_id: new FormControl([]),
      vector_store_id: new FormControl([]),
      effective_date: new FormControl(''),
      knowledge_base_id: new FormControl([])
    });
    // Update displays on value changes
    this.filterkgForm.valueChanges.subscribe(() => this.updateDisplays());
    this.updateDisplays();

    this.loadPrivileges();
    //Subscribe to privilege updates
    // this._rolePrivilegeService.privilegeData$.subscribe((allPrivileges) => {
    //   this.rolePrivilegMapping(allPrivileges);
    // });
  }

  ngOnDestroy(): void {}

  ngAfterViewInit(): void {
  this.loggedUser = this._stateService.getLoginDetails();
  this.role = this.loggedUser?.Role || '';
  setTimeout(() => {
    this.initChart();
    this.initAgentChart();
  }, 0);
  const toggleBtn = document.querySelector('.toggleKgBtn');
  const sidebar = document.querySelector('.sidebarKg');
  sidebar?.classList.add('expanded');
  toggleBtn?.addEventListener('click', () => {
    sidebar?.classList.toggle('expanded');
  });
}
  //#endregion

  //#region Privilege Management

  loadPrivileges() {
    this._stateService.getPrivilegesByPage('Agency Management').subscribe({
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
  }
  // loadPrivileges() {
  //   this._rolePrivilegeService.getPermissions().subscribe({
  //     next: (res) => {
  //       console.log('API Response:', res.data);
  //       if (res?.data?.length) {
  //         // Push data to mapping
  //         this.rolePrivilegMapping(res.data);
  //       } else {
  //         console.warn('No privileges returned from API');
  //       }
  //     },
  //     error: (err) => console.error('Error fetching privileges:', err),
  //   });
  // }

  // rolePrivilegMapping(allPrivileges: any) {
  //   const loggedUser = this._stateService.getLoginDetails();
  //       const userRoleDtls = loggedUser.ProjectDtl?.find((p: any) => 
  //   p.prj_name?.trim().toLowerCase() === loggedUser.ActiveProject?.trim().toLowerCase())?.role_name || "Super Admin";

  //   const roleName = userRoleDtls;
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
  //   if (roleName.toLowerCase() === 'super admin'.toLowerCase()) {
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

  //     this.kgForm[
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

  //   this.kgForm[
  //     this.isPrivilegeView && !this.isPrivilegeEdit ? 'disable' : 'enable'
  //   ]({ emitEvent: false });
  //   this.cdRef.detectChanges();
  // }
  //#endregion

  //#region Set Active Tab
  setActiveCountTab(index: number): void {
  this.filteredkwStore = [...this.KnowledgeStoreData];
  this.clearFilters();
}
  //#endregion

  //#region Get Knowledge Store List

  isKnowledgeGraph(item: any): boolean {
    const provider = item.vector_store_provider ?? item.config?.vector_store_provider ?? '';

    return config.rag.isKnowledgeGraph(provider);
  }

  getKnowledgeGraphDropdownDetails(): void {
  this._secommendservice.getKnowledgeGraphDropdownDetails().subscribe(
    (data) => {
      if (data.success) {
        // Filter for knowledge graph items
        const kgDropdownOptions = (data.data || [])
          .filter((item: any) => { // Use 'any' here to prevent type errors
            const provider = item.vector_store_provider ?? item.config?.vector_store_provider ?? '';

            return config.rag.isKnowledgeGraph(provider);
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
          if (mappedTeam) {
            console.log('mappedTeam:', mappedTeam);

            this.agenciesWithAgents = this.agenciesWithAgents.filter(
              (agency) =>
                agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
            );

            // Get all active agents' knowledge_store_ids
            const kg_store_ids = this.agenciesWithAgents.flatMap((agency) =>
              (agency.agents || [])
                .filter((agent: { status: string }) => agent.status === 'active')
                .map((agent: { knowledge_store_id: any }) => agent.knowledge_store_id)
            );
            console.log('kg_store_ids:', kg_store_ids);

            // FIX 1: Add 'as any' to the array being filtered
            this.knowledgeGraphList = (kgDropdownOptions as any[]).filter((item: any) =>
              kg_store_ids.includes(item._id)
            );
          } else {
            // FIX 2: Add 'as any' to the array being filtered and simplify the return
            this.knowledgeGraphList = (kgDropdownOptions as any[]).filter((gph: any) =>
              gph.collection_name && gph.collection_name.trim() !== ''
            );
          }
        } else {
          // FIX 3: Add 'as any' to the array being filtered and simplify the return
          this.knowledgeGraphList = (kgDropdownOptions as any[]).filter((gph: any) =>
            gph.collection_name && gph.collection_name.trim() !== ''
          );
        }

        // Update knowledge graph dropdown options
        this.KnowledgeGraphName = this.knowledgeGraphList.map((kg) => ({
          key: kg.collection_name,
          value: kg._id,
        }));

        // Update knowledge base dropdown options (all data minus knowledge graph)
        // FIX 4: Also add 'as any' here for consistency
        this.knowledgeBaseList = (data.data as any[]).filter((item: any) => {
          const provider = item.vector_store_provider ?? '';
          return !config.rag.isKnowledgeGraph(provider);
        });

        this.KnowledgeBaseName = this.knowledgeBaseList.map((kb) => ({
          key: kb.collection_name,
          value: kb._id,
        }));

        this.updateDisplays();
        this.cdRef.detectChanges();
      } else {
        console.log('No knowledge Graph data found');
      }
    },
    (error) => {
      console.log('Error fetching knowledge Graph Details:', error);
    }
  );
}

  toggleSidePanel(panel: 'left' | 'right') {
    if (panel === 'left') {
      this.isSideCollapsed = !this.isSideCollapsed;
      if (!this.isSideCollapsed) {
        this.isRightCollapsed = true;
        // this.updateRoleChart(this.allAgents);
      }
    } else {
      this.isRightCollapsed = !this.isRightCollapsed;
      if (!this.isRightCollapsed) {
        this.isSideCollapsed = true;
      }
    }
    console.log('Left Panel Collapsed:', this.isSideCollapsed);
  }

  initAgentChart(): void {
    if (this.agentChartInitialized) return;
    const canvas = document.getElementById('agentDonutChart') as HTMLCanvasElement;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    if (this.agentDonutChart) {
      try { this.agentDonutChart.destroy(); } catch (e) { }
    }

    const labels = this.agentChartLabels.length ? this.agentChartLabels : [];
    const dataValues = this.agentChartData.length ? this.agentChartData : [];
    const defaultColors = ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#fb8c00', '#f57c00'];
    const bgColors = labels.map((_, i) => defaultColors[i % defaultColors.length]);

    this.agentDonutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data: dataValues,
            backgroundColor: bgColors,
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
      },
    });
    this.agentChartInitialized = true;
  }

  initChart(): void {
      if (this.donutChartInitialized) return;
      const canvas = document.getElementById('donutChart') as HTMLCanvasElement;
      const ctx = canvas?.getContext('2d');
      if (!ctx) return;

      if (this.agencyDonutChart) {
        try { this.agencyDonutChart.destroy(); } catch (e) { /* ignore */ }
      }

      const labels = this.agencyChartLabels.length ? this.agencyChartLabels : [
        'LEO Application',
        'CX',
        'Finance Project',
        'KYC Application',
        'HR Project',
        'SDLC AI',
      ];
      const dataValues = this.agencyChartData.length ? this.agencyChartData : [1, 2, 1, 1, 1, 2];
      const defaultColors = ['#ffe0b2',
          '#ffcc80',
          '#ffb74d',
          '#ffa726',
          '#ff9800',
          '#fb8c00',
          '#f57c00'];
      const bgColors = labels.map((_, i) => defaultColors[i % defaultColors.length]);

      this.agencyDonutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [
            {
              data: dataValues,
              backgroundColor: bgColors,
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
        },
      });
      this.donutChartInitialized = true;
    }

  filterDataFromChartClick(chartType: string, clickedLabel: string): void {
  if (!this.KnowledgeStoreData || this.KnowledgeStoreData.length === 0) {
    return; // No data to filter
  }

  // Check if the same filter is being applied again
  if (this.currentFilterType === chartType && this.currentFilterValue === clickedLabel) {
    // Reset the filter
    this.currentFilterType = '';
    this.currentFilterValue = '';
    this.filteredkwStore = [...this.KnowledgeStoreData];
    this.updatePagination();
    this.updateKbKgChartFromFilteredData();
    this.updateAgentChartFromFilteredData();
    this.cdRef.detectChanges();
    return;
  }

  // Set the current filter state
  this.currentFilterType = chartType;
  this.currentFilterValue = clickedLabel;

  switch (chartType) {
    case 'kbkg':
      if (clickedLabel === 'Knowledge Base') {
        this.filteredkwStore = this.KnowledgeStoreData.filter(item => !this.isKnowledgeGraph(item));
      } else if (clickedLabel === 'Knowledge Graph') {
        this.filteredkwStore = this.KnowledgeStoreData.filter(item => this.isKnowledgeGraph(item));
      }
      break;

    case 'agent':
      // Create a mapping from collection names to IDs
      const nameToIdMap = new Map<string, string>();
      this.KnowledgeStoreData.forEach(item => {
        if (item.collection_name) {
          nameToIdMap.set(item.collection_name, item._id);
        }
      });
      
      // Get the store names for the clicked agent
      const agentStoreNames = this.allAgentsByStore[clickedLabel] || [];
      
      // Convert store names to IDs
      const agentStoreIds = agentStoreNames.map(name => nameToIdMap.get(name)).filter(id => id !== undefined);
      
      // Filter by IDs instead of names
      this.filteredkwStore = this.KnowledgeStoreData.filter(store => 
        agentStoreIds.includes(store._id)
      );
      break;

    default:
      return;
  }
  this.updatePagination();
  this.updateKbKgChartFromFilteredData();
  this.updateAgentChartFromFilteredData();
  this.cdRef.detectChanges();
}
  updateKbKgChartFromFilteredData(): void {
  if (!this.agencyDonutChart) return; 

  const currentData = [...this.filteredkwStore];
  const kbCount = currentData.filter(item => !this.isKnowledgeGraph(item)).length;
  const kgCount = currentData.filter(item => this.isKnowledgeGraph(item)).length;
  
  const tempLabels: string[] = [];
  const tempData: number[] = [];
  const tempLegend: Array<{ label: string; count: number; color: string }> = [];
  const colors = ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#fb8c00', '#f57c00'];

  if (kbCount > 0) {
    tempLabels.push('Knowledge Base');
    tempData.push(kbCount);
    tempLegend.push({ label: 'Knowledge Base', count: kbCount, color: colors[0] });
  }

  if (kgCount > 0) {
    tempLabels.push('Knowledge Graph');
    tempData.push(kgCount);
    tempLegend.push({ label: 'Knowledge Graph', count: kgCount, color: colors[1] });
  }
  this.agencyChartLabels = tempLabels;
  this.agencyChartData = tempData;
  this.agencyLegendData = tempLegend;
  this.kbKgStats.filteredTotal = kbCount + kgCount;

  if (this.agencyDonutChart) {
    this.agencyDonutChart.data.labels = tempLabels;
    this.agencyDonutChart.data.datasets[0].data = tempData;
    this.agencyDonutChart.update('none');
  }
  
  this.cdRef.detectChanges();
}

  updateAgentChart(): void {
  const agentData = this.allAgentsByStore;

  // The labels are the agent names
  this.agentChartLabels = Object.keys(agentData);
  
  // The data is the COUNT of knowledge stores for each agent
  this.agentChartData = Object.values(agentData).map(stores => stores.length);

  // The total is the number of unique agents
  this.agentStats.totalAgentsByStore = this.agentChartLabels.length;

  const colors = ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#fb8c00', '#f57c00'];
  this.agentLegendData = this.agentChartLabels.map((label, idx) => ({
    label,
    count: this.agentChartData[idx] || 0,
    color: colors[idx % colors.length],
  }));
}

 updateAgentChartFromFilteredData(): void {
  // Get the IDs of the currently visible knowledge stores
  const filteredStoreIds = new Set(this.filteredkwStore.map(store => store._id));
  
  // Create a name to ID mapping
  const nameToIdMap = new Map<string, string>();
  this.KnowledgeStoreData.forEach(item => {
    if (item.collection_name) {
      nameToIdMap.set(item.collection_name, item._id);
    }
  });

  // Determine which agents should be visible based on the filtered stores
  const visibleAgents: { [agentName: string]: number } = {};
  for (const agentName in this.allAgentsByStore) {
    const agentStoreNames = this.allAgentsByStore[agentName];
    // Convert names to IDs
    const agentStoreIds = agentStoreNames.map(name => nameToIdMap.get(name)).filter(id => id !== undefined);
    
    // Check if this agent has ANY store in the filtered list
    const hasVisibleStore = agentStoreIds.some(storeId => filteredStoreIds.has(storeId));
    
    if (hasVisibleStore) {
      // If so, add them to our visible list with their TOTAL store count
      visibleAgents[agentName] = agentStoreIds.length;
    }
  }

  // Update the chart data from the filtered agent map
  this.agentChartLabels = Object.keys(visibleAgents);
  this.agentChartData = Object.values(visibleAgents);
  this.agentStats.totalAgentsByStore = this.agentChartLabels.length;

  const colors = ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#fb8c00', '#f57c00'];
  this.agentLegendData = this.agentChartLabels.map((label, idx) => ({
    label,
    count: this.agentChartData[idx] || 0,
    color: colors[idx % colors.length],
  }));

  if (this.agentDonutChart) {
    this.agentDonutChart.data.labels = this.agentChartLabels;
    this.agentDonutChart.data.datasets[0].data = this.agentChartData;
    this.agentDonutChart.update('none');
  }
  
  this.cdRef.detectChanges();
}

  fetchAgencyStatistics(): void {
    this._apiService.getKGStatistics().subscribe({
      next: (res) => {
        if (res && (res as any).success) {
          const data = (res as any).data || {};
          const byTeam: Record<string, number> = data.knowledge_graph_base_count || {};
          this.agencyChartLabels = Object.keys(byTeam);
          this.agencyChartData = Object.values(byTeam).map((v: any) => Number(v) || 0);
          this.kbKgStats.filteredTotal = this.agencyChartData.reduce((sum, count) => sum + count, 0);

          const colors = ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#fb8c00', '#f57c00'];
          this.agencyLegendData = this.agencyChartLabels.map((label, idx) => ({
            label,
            count: this.agencyChartData[idx] || 0,
            color: colors[idx % colors.length],
          }));
          this.allAgentsByStore = data.agents_by_knowledge_store || {};
          this.updateAgentChart();
          this.donutChartInitialized = false;
          this.agentChartInitialized = false;
          setTimeout(() => {
            this.initChart();
            this.initAgentChart();
          }, 0);
          
          this.cdRef.detectChanges();
        }
      },
      error: (err) => console.error('Error fetching KG store statistics', err),
    });
  }

  getKnowledgeStoreDetails(): void {
    this._loadingService.show();
    this._marketService.getKnowledgeStoreDetails().subscribe({
      next: (response) => {
        if (response.success) {
          this.KnowledgeStoreData = response.data || [];
          this.getKnowledgeGraphDropdownDetails();
          
          this.knowledeGraphCountsList = this.knowledeGraphCountsList.map(
            (item) => ({
              ...item,
              count: this.KnowledgeStoreData.length || 0,
            })
          );
          this.filteredkwStore = [...this.KnowledgeStoreData];
          this.totalItems = this.filteredkwStore.length;
          this.updatePagination();
          this._loadingService.hide();
        }
      },
      error: (err) => {
        this._loadingService.hide();
        console.error('Error fetching knowledge store details:', err);
      },
    });
  }

  updateTabCounts(): void {
  const totalCount = this.KnowledgeStoreData.length;
  const knowledgeGraphCount = this.KnowledgeStoreData.filter(item => 
    item.type === 'knowledge_graph' || item.collection_name?.includes('KG-')
  ).length;
  const knowledgeBaseCount = this.KnowledgeStoreData.filter(item => 
    item.type === 'knowledge_base' || item.collection_name?.includes('KB-')
  ).length;
  
  this.knowledeGraphCountsList[0].count = totalCount;
  this.knowledeGraphCountsList[1].count = knowledgeGraphCount;
  this.knowledeGraphCountsList[2].count = knowledgeBaseCount;
  
  this.cdRef.detectChanges();
}

  getKnowledgeStoreCounts(): void {
    this._loadingService.show();
    this._marketService.getKnowledgeStoreCounts().subscribe({
      next: (response) => {
        if (response.success) {
          this.knowledeGraphCountsList = this.knowledeGraphCountsList.map(
            (item) => ({
              ...item,
              count: response.data[item.key as keyof typeof response.data] || 0,
            })
          );
          this.cdRef.detectChanges();
        }
      },
      error: (err) => {
        this._loadingService.hide();
        console.error('Error fetching agent counts:', err);
      },
    });
  }

  getKnowledgeStoreDocDetails(ragId: string): void {
    this._marketService.getKnowledgeStoreDocDetails(ragId).subscribe({
      next: (response) => {
        if (response.success) {
          this.addedFiles = response.data.map((item: any) => {
            const fileName = item.name || item.source_key || '';   // use .name preferably
            const extension = fileName.split('.').pop()?.toLowerCase() || '';
            return { name: fileName,extension: extension };
          });
          this.cdRef.detectChanges();
        }
      },
      error: (err) => {
        this._loadingService.hide();
        console.error('Error fetching knowledgegraph Input file details:', err);
      },
    });
  }

  fetchAgenciesWithAgents(): void {
    this._loadingService.show();
    this._marketService.getAgencyWithAgents().subscribe({
      next: (res) => {
        if (res.success) {
          this.agenciesWithAgents = res.data;
          // this.getKnowledgeStoreCounts();
          this.getKnowledgeStoreDetails();
          this._loadingService.hide();
        }
      },
      error: (err) => console.error('Error:', err),
    });
  }
  //#endregion

  //#region Apply / Clear Filters

  applyFilters(): void {
  this.filteredkwStore = this.KnowledgeStoreData;
  const { collection_id, desc_id, vector_store_id, knowledge_base_id } = this.filterkgForm.value;

  // Reset the chart filter state when applying other filters
  this.currentFilterType = '';
  this.currentFilterValue = '';

  if (Array.isArray(collection_id) && collection_id.length > 0) {
    this.filteredkwStore = this.filteredkwStore.filter((kg) =>
      collection_id.includes(kg._id)
    );
  }
  if (Array.isArray(knowledge_base_id) && knowledge_base_id.length > 0) {
    this.filteredkwStore = this.filteredkwStore.filter(kg => 
      knowledge_base_id.includes(kg._id)
    );
  }
  if (Array.isArray(desc_id) && desc_id.length > 0) {
    this.filteredkwStore = this.filteredkwStore.filter((kg) =>
      desc_id.includes(kg._id)
    );
  }
  if (Array.isArray(vector_store_id) && vector_store_id.length > 0) {
    this.filteredkwStore = this.filteredkwStore.filter((kg) =>
      vector_store_id.includes(kg._id)
    );
  }
  if (this.filterkgForm.value.effective_date) {
    const selectedDate = new Date(this.filterkgForm.value.effective_date);
    this.filteredkwStore = this.filteredkwStore.filter((kg) => {
      const kgDate = new Date(kg.created_at);
      return kgDate.toDateString() === selectedDate.toDateString();
    });
  }

  // Update pagination
  this.totalItems = this.filteredkwStore.length;
  this.updatePagination();
  this.updateAgentChartFromFilteredData();
  this.updateKbKgChartFromFilteredData(); 
  this.cdRef.detectChanges();
  $('#filt').modal('hide');
}

  toggleSelection(controlName: string, value: any) {
    const selected = this.filterkgForm.value[controlName] || [];
    if (selected.includes(value)) {
      this.filterkgForm.patchValue({
        [controlName]: selected.filter((v: any) => v !== value),
      });
    } else {
      this.filterkgForm.patchValue({
        [controlName]: [...selected, value],
      });
    }
  }

  updateDisplays() {
    this.updateDisplayFor(
      'collection_id',
      this.KnowledgeGraphName,
      'collectionDisplay',
      'collectionAddedCount'
    );
     this.updateDisplayFor(
    'knowledge_base_id',
    this.KnowledgeBaseName,
    'baseDisplay',
    'baseAddedCount'
  );
    this.updateDisplayFor(
      'desc_id',
      this.KnowledgeDescription,
      'descDisplay',
      'descAddedCount'
    );
    this.updateDisplayFor(
      'vector_store_id',
      this.KnowledgeVectorStoreName,
      'vectorDisplay',
      'vectorAddedCount'
    );
  }

  updateDisplayFor(
    formKey: string,
    options: any[],
    displayKey: string,
    countKey: string
  ) {
    const selected = this.filterkgForm.value[formKey] || [];
    const names = selected
      .map((v: any) => options.find((opt) => opt.value === v)?.key)
      .filter(Boolean);
    (this as any)[displayKey] = names.slice(0, this.maxDisplay);
    (this as any)[countKey] =
      names.length - this.maxDisplay > 0 ? names.length - this.maxDisplay : 0;
  }

  isAnyFilterSelected(): boolean {
  const { collection_id, desc_id, vector_store_id, knowledge_base_id } = this.filterkgForm.value;
  return (
    (collection_id && collection_id.length > 0) ||
    (desc_id && desc_id.length > 0) ||
    (vector_store_id && vector_store_id.length > 0) ||
    (knowledge_base_id && knowledge_base_id.length > 0) ||
    !!this.filterkgForm.value.effective_date
  );
}

clearFilters(): void {
  this.filterkgForm.reset({
    collection_id: [],
    desc_id: [],
    vector_store_id: [],
    knowledge_base_id: [],
  });
  this.filteredkwStore = this.KnowledgeStoreData;
  
  // Reset the chart filter state
  this.currentFilterType = '';
  this.currentFilterValue = '';
  
  // Update pagination
  this.totalItems = this.filteredkwStore.length;
  this.updatePagination();
  this.updateAgentChartFromFilteredData();
  this.updateKbKgChartFromFilteredData(); 
  //this.fetchAgencyStatistics();
  
  this.cdRef.detectChanges();
  $('#filt').modal('hide');
}

  //#endregion

  //#region Step Control validation
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
  // ------------------ Form & Stepper ------------------
  nextStep(): void {
    if (this.currentStep === 1) {
      this.currentStep = 2;
    } else if (this.currentStep === 2) {
      this.currentStep = 3;
    } else if (this.currentStep === 3) {
      this.currentStep = 4;
    }
  }

  previousStep(): void {
    if (this.currentStep === 2) {
      this.currentStep = 1;
    } else if (this.currentStep === 3) {
      this.currentStep = 2;
    } else if (this.currentStep === 4) {
      this.currentStep = 3;
    }
  }

  closeModal(): void {
    this.currentStep = 1;
    this.kgForm.reset();
  }

  // Handle new file uploads
  onFilesAdded(event: any) {
    const files: FileList = event.target.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const extension = file.name.split('.').pop()?.toLowerCase() || '';
      // Avoid duplicates
      if (!this.addedFiles.some((f) => f.name === file.name)) {
        this.addedFiles.push({ name: file.name, extension });
      }
    }
    // Allow re-select same file
    event.target.value = '';
  }

  // Remove a selected file
  removeFile(fileToRemove: { name: string; extension: string }) {
    this.addedFiles = this.addedFiles.filter((file) => file !== fileToRemove);
  }

  addOutputStore() {
    const vectorStoreName = this.kgForm.get('outputStore')?.value?.trim();
    if (
      vectorStoreName &&
      !this.addedOutputStores.some((store) => store.name === vectorStoreName)
    ) {
      this.addedOutputStores.push({ name: vectorStoreName });
      this.kgForm.get('outputStore')?.setValue('');
    }
  }

  removeOutputStore(storeToRemove: { name: string }) {
    this.addedOutputStores = this.addedOutputStores.filter(
      (store) => store !== storeToRemove
    );
  }
  //#endregion

  //#region Pagination Controls
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
    this.totalItems = this.filteredkwStore.length;
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
    this.paginatedkwStore = this.filteredkwStore.slice(startIndex, endIndex);
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
  //#endregion

  //#region Search Functionality

  applySearch(): void {
  const query = this.searchTerm.trim().toLowerCase();
  console.log('Search query:', query);
  console.log('Original data length:', this.KnowledgeStoreData.length);

  // Reset the chart filter state when searching
  this.currentFilterType = '';
  this.currentFilterValue = '';

  if (query && query.length > 0) {
    this.filteredkwStore = this.KnowledgeStoreData.filter((kg) => {
      // Check collection_name (primary name field)
      const nameMatch = kg.collection_name && kg.collection_name.toLowerCase().includes(query);
      
      // Check _id for ID-based search
      const idMatch = kg._id && kg._id.toString().toLowerCase().includes(query);
      
      // Check description
      const descMatch = kg.description && kg.description.toLowerCase().includes(query);
      
      // Also check if there's a name field in config (for nested data)
      const configNameMatch = kg.config?.collection_name && 
        kg.config.collection_name.toLowerCase().includes(query);
      
      // Check if it's a KG/KB type match
      const typeMatch = query.includes('knowledge') && 
        ((query.includes('graph') && this.isKnowledgeGraph(kg)) || 
         (query.includes('base') && !this.isKnowledgeGraph(kg)));

      return nameMatch || idMatch || descMatch || configNameMatch || typeMatch;
    });
    console.log('Filtered data length:', this.filteredkwStore.length);
  } else {
    this.filteredkwStore = [...this.KnowledgeStoreData];
  }
  
  // Update pagination
  this.totalItems = this.filteredkwStore.length;
  this.updatePagination();
  this.updateAgentChartFromFilteredData();
  this.updateKbKgChartFromFilteredData(); 
  this.cdRef.detectChanges();
}
  //#endregion

  getModalTitle(): string {
  if (!this.selectedItem) return 'View Knowledge Store';
  
  if (this.isKnowledgeGraph(this.selectedItem)) {
    return 'View Knowledge Graph';
  } else {
    return 'View Knowledge Base';
  }
}

// Add a method to get the image path
getModalImagePath(): string {
  if (!this.selectedItem) return 'assets/img/knowledge_store_img.png';
  
  if (this.isKnowledgeGraph(this.selectedItem)) {
    return 'assets/img/knowledge_graph_img.png';
  } else {
    return 'assets/img/knowledge_base_img.png';
  }
}

getModalImageBackground(): string {
  if (!this.selectedItem) return '#f6f3fa';
  
  if (this.isKnowledgeGraph(this.selectedItem)) {
    return '#FFA242'; // Light orange
  } else {
    return '#F17A92'; // Light pink
  }
}

  //#region Modal & Toggle switch Controls
  openKGModal(kgData: any): void {
    this.isViewMode = true;
    this.selectedItem = kgData;

   let isKagorKb = this.isKnowledgeGraph(kgData);

    if (!isKagorKb) {
      this.knowledgeNameLabel = 'KB Name';
      this.knowledgeIdLabel = 'KB ID';
      this.knowledgeIPSourceLabel = 'KB I/P Sources';
      this.knowledgeName= 'Knowledge Base';
      this.kgorKbName= 'KB';
      this.cdRef.detectChanges();
    }

    if (kgData?.rag_id|| kgData?.config?.rag_id ) {
      this._loadingService.show();
      this.getKnowledgeStoreDocDetails(kgData?.rag_id || kgData?.config?.rag_id);
      this._loadingService.hide();
    }

    this.addedOutputStores = kgData?.vector_store_provider||kgData?.config?.vector_store_provider
      ? [{ name: kgData.vector_store_provider||kgData?.config?.vector_store_provider }]
      : [];

    this.kgForm.setValue({
      kgName: kgData?.collection_name ||kgData?.config?.collection_name || '',
      kgId: kgData?._id || kgData?.config?._id ||'',
      effectiveDate: this.formatDate(kgData?.created_at || kgData?.config?.created_at ||''),
      description: kgData?.description || kgData?.config?.description|| '',
      outputStore: kgData?.vector_store_provider || kgData?.config?.vector_store_provider|| '',
      inputSourceType: 'Files',
      outputSourceType: 'Vector Store',
      numberOfChunks: '10',
      chunkType: 'basic',
    });

    this.cdRef.detectChanges();
    $(this.onboardknowledgestoreModal.nativeElement).modal('show');
  }

  toggleMode() {
    this.isViewMode = !this.isViewMode;
    if (this.isViewMode) {
      this.kgForm.disable();
    } else {
      this.kgForm.enable();
    }
  }
  //#endregion

  //#region common helpers
  formatDate(dateStr: string): string {
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return '';
    const day = ('0' + dateObj.getDate()).slice(-2);
    const month = ('0' + (dateObj.getMonth() + 1)).slice(-2);
    const year = dateObj.getFullYear();
    return `${day}/${month}/${year}`;
  }
  //#endregion
}
