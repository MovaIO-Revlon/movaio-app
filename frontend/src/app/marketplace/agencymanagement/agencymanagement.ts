import {
  AfterViewInit,
  Component,
  ElementRef,
  OnInit,
  QueryList,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Header } from '../../header/header';
import { RouterModule, Router } from '@angular/router';
import { ChangeDetectorRef } from '@angular/core';
import { SemarketplaceService } from '../../services/semarketplace.service';
import { NgxSpinnerComponent, NgxSpinnerService } from 'ngx-spinner';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  NgModel,
  ReactiveFormsModule,
} from '@angular/forms';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { Chart } from 'chart.js';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { catchError, EMPTY, tap } from 'rxjs';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { secommendcenter } from '../../services/secommedcenter.service';
import { RolePrivilegeMappingService } from '../../services/role-privilege-mapping.service';
import { HomeService } from '../../services/home.service';
import { environment as config } from '../../../environments/environment';
import { getApiError } from '../../utils';

declare var $: any;
declare var bootstrap: any;
type TCard = 'basicDetails' | 'nodes' | 'agentComposition';

@Component({
  selector: 'app-agencymanagement',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    DragDropModule,
    ReactiveFormsModule,
    TooltipDirective,
  ],
  templateUrl: './agencymanagement.html',
  styleUrl: './agencymanagement.css',
})
export class AgencyManagement implements OnInit, AfterViewInit {
  @ViewChild('loadalert') loadalert?: ElementRef;
  @ViewChild('confirmationModal') confirmationModal?: ElementRef;
  @ViewChild('loadagencyPopup') loadagencyPopup?: ElementRef;

  @ViewChild('zoomContainer') zoomContainerRef!: ElementRef<HTMLDivElement>;

  @ViewChild('agencyName') agencyNameField!: NgModel;
  @ViewChild('agencyType') agencyTypeField!: NgModel;
  @ViewChild('team') teamField!: NgModel;
  @ViewChild('description') descriptionField!: NgModel;

  agencyCountsList = [
    { key: 'total_agencies', label: 'Total Agencies', count: 0, active: true },
    {
      key: 'trending_agencies',
      label: 'Trending Agencies',
      count: 0,
      active: false,
    },
  ];
  
   cardState: { [key in TCard]: { open: boolean } } = {
    basicDetails: { open: true },
    nodes: { open: true },
    agentComposition: { open: true },
  };
  
  UserManagementData: any[] = [];

  AgncyPopupTitle = 'Create New Agency';
  agencies: any[] = [];
  agents: any[] = [];
  agency: any = null;
  selectedAgency: any = null;
  totalAgencies: number = 0;
  trendingAgenciesCount: number = 0;
  trendingAgencies: any[] = [];
  isAgencyManage: boolean = true;
  TeamManagementData: any[] = [];
  selectedFile: File | null = null;
  toastType: 'success' | 'error' | '' = '';
  toastMessage: string = '';
  allAgents: any[] = [];
  allagencytype: any[] = [];
  agencyTypes: string[] = [];
  typeNames: string[] = [];
  compositionAgents: any[] = [];
  searchTerm: string = '';
  agencySearchTerm: string = '';
  filteredAgenciesWithAgents: any[] = [];
  loadAgenciesWithAgentsdropdown: any[] = [];
  agenciesWithAgents: any[] = [];
  lineCoordinates: any[] = [];
  trendingStats: any;
  isSideCollapsed = true;
  isRightCollapsed = true;
  agencyStats: any = {
    totalAgencies: 0,
    totalAgents: 0,
    activeAgencies: 0,
    inactiveAgencies: 0,
  };

  agencyNode = {
    nodeId: 'node1',
    x: 100,
    y: 30,
    width: 200,
    height: 80,
  };

  agencyViewNode = {
    nodeId: 'agencyNode',
    x: 300,
    y: 20,
    width: 80,
    height: 80,
  };

  agencyOnNode: any = null;
  zoomScale = 1;
  donutChartInitialized: boolean = false;
  agencyDonutChart?: Chart<'doughnut', number[], unknown> = undefined;
  agencyChartLabels: string[] = [];
  agencyChartData: number[] = [];
  agencyLegendData: Array<{ label: string; count: number; color: string }> = [];
  masterSelected: boolean = false;
  othersSelected: boolean = true;

  formData: any = {
    agency_name: '',
    agency_type: '',
    agency_desc: '',
    avatar: '',
    provider_id: '12345', // Static or fetch from auth/session
    provider_name: 'Example Provider',
    team: '',
  };

  filterOptions = {
    totalAgencies: {
      agencyNames: [] as string[],
      descriptions: [] as string[],
      teamNames: [] as string[],
      agentTypes: [] as string[],
    },
    trendingAgencies: {
      agencyNames: [] as string[],
      descriptions: [] as string[],
      teamNames: [] as string[],
      agentTypes: [] as string[],
    },
  };

  selectedAgent: any = null;

  agentCounter = 1; // To generate node ids like node2, node3...

  showModal: boolean = false;
  Usermessage: string = '';
  popupTitle: string = '';
  message = '';

  loggedUser: any;
  TeamName: any;

  filterForm!: FormGroup;
  allAgencies: any[] = [];
  uniqueAgencyDescs: string[] = [];
  teamManagementData: any[] = [];
  filteredSelectedAgents: any[] = [];
  filteredAgents: any[] = [];
  IsAgencyEditClose: boolean = false;
  isAgentCompositionValid: boolean = false;
  isDuplicateAgency: boolean = false;

  fileError: string | null = null;
  agentToDelete: any = null;

  isPrivilegeView: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeRefresh: boolean = false;
  isPrivilegeExecute: boolean = false;

  masterDatabase = config.masterDatabase;
  activeTeamFilter: string | null = null;
  originalAgenciesList: any[] = [];
  agenciesByTeam: Record<string, number> = {};
  agentMapping: Record<string, number> = {};
  totalAgentsMapped: number = 0;
  agentChartLabels: string[] = [];
  agentChartData: number[] = [];
  agentLegendData: { label: string; count: number; color: string }[] = [];
  agentStats: { totalAgents: number } = { totalAgents: 0 };
  activeAgentFilter: string | null = null;
  @ViewChild('donutCanvas') donutCanvas!: ElementRef;
  @ViewChild('agentDonutCanvas') agentDonutCanvas!: ElementRef;
  agencyNameChartLabels: string[] = [];
  agencyNameChartData: number[] = [];
  agencyNameLegendData: { label: string; count: number; color: string }[] = [];
  agencyNameStats: { totalAgents: number } = { totalAgents: 0 };
  activeAgencyNameFilter: string | null = null; 
  agencyNameDonutChartInstance: any; 

  constructor(
    private http: HttpClient,
    private _router: Router,
    private cdr: ChangeDetectorRef,
    private fb: FormBuilder,
    private _loadinService: NgxSpinnerService,
    private _apiService: SemarketplaceService,
    private _stateService: AIInfuseStateService,
    private _rolePrivilegeService: RolePrivilegeMappingService,
    private _homeService: HomeService
  ) {}

chartsInitialized: boolean = false;
pendingChartUpdate: boolean = false;

// Modify ngAfterViewInit to not initialize charts immediately
ngAfterViewInit(): void {
  // Don't initialize charts here, wait for data
  const toggleBtn = document.querySelector('.toggleAgencyBtn');
  const sidebar = document.querySelector('.sidebarAgency');
  sidebar?.classList.add('expanded');
  toggleBtn?.addEventListener('click', () => {
    sidebar?.classList.toggle('expanded');
    // Force chart resize after sidebar toggle
    setTimeout(() => {
      this.resizeCharts();
    }, 300);
  });
}

// Add a method to resize charts
resizeCharts(): void {
  if (this.agencyDonutChart) {
    this.agencyDonutChart.resize();
  }
  if (this.agencyNameDonutChartInstance) {
    this.agencyNameDonutChartInstance.resize();
  }
}

// Modify initializeCharts to handle empty data and set a flag
initializeCharts(): void {
  // If canvas elements are not available, mark for pending update
  if (!this.donutCanvas || !this.agentDonutCanvas) {
    this.pendingChartUpdate = true;
    return;
  }

  // --- Initialize "By Teams" Chart ---
  if (this.donutCanvas) {
    // Destroy existing chart if it exists
    if (this.agencyDonutChart) {
      this.agencyDonutChart.destroy();
    }
    
    const ctx = this.donutCanvas.nativeElement.getContext('2d');
    if (ctx) {
      // Process data for "By Teams" chart
      const teamCounts: Record<string, number> = {};
      this.filteredAgenciesWithAgents.forEach((agency: any) => {
        if (agency.assigned_to) {
          const team = agency.assigned_to;
          teamCounts[team] = (teamCounts[team] || 0) + 1;
        }
      });

      this.agencyChartLabels = Object.keys(teamCounts);
      this.agencyChartData = Object.values(teamCounts).map((v: any) => Number(v) || 0);
      this.agencyStats.totalAgencies = this.filteredAgenciesWithAgents.length;

      const colors = ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#fb8c00', '#f57c00'];
      this.agencyLegendData = this.agencyChartLabels.map((label, idx) => ({
        label,
        count: this.agencyChartData[idx] || 0,
        color: colors[idx % colors.length],
      }));

      // Create chart with processed data
      this.agencyDonutChart = new Chart(ctx, {
        type: 'doughnut',
        data: { 
          labels: this.agencyChartLabels, 
          datasets: [{ 
            data: this.agencyChartData, 
            backgroundColor: this.agencyLegendData.map(item => item.color), 
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
            tooltip: {
              callbacks: {
                label: (context) => {
                  const label = context.label || '';
                  const value = context.parsed || 0;
                  return `${label}: ${value}`;
                }
              }
            }
          },
          animation: {
            animateScale: true,
            animateRotate: true
          }
        },
      });
    }
  }
  
  // --- Initialize "By Agency Name" Chart ---
  if (this.agentDonutCanvas) {
    // Destroy existing chart if it exists
    if (this.agencyNameDonutChartInstance) {
      this.agencyNameDonutChartInstance.destroy();
    }
    
    const ctx = this.agentDonutCanvas.nativeElement.getContext('2d');
    if (ctx) {
      // Process data for "By Agency Name" chart
      const agentCounts: Record<string, number> = {};
      
      this.filteredAgenciesWithAgents.forEach((agency: any) => {
        if (agency.agency_name && this.agentMapping[agency.agency_name]) {
          const agentName = agency.agency_name;
          agentCounts[agentName] = (agentCounts[agentName] || 0) + this.agentMapping[agentName];
        }
      });

      this.agencyNameChartLabels = Object.keys(agentCounts);
      this.agencyNameChartData = Object.values(agentCounts).map((v: any) => Number(v) || 0);
      this.agencyNameStats.totalAgents = this.agencyNameChartData.reduce((sum, count) => sum + count, 0);

      const colors = ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#fb8c00', '#f57c00'];
      this.agencyNameLegendData = this.agencyNameChartLabels.map((label, idx) => ({
        label,
        count: this.agencyNameChartData[idx] || 0,
        color: colors[idx % colors.length],
      }));

      // Create chart with processed data
      this.agencyNameDonutChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: { 
          labels: this.agencyNameChartLabels, 
          datasets: [{ 
            data: this.agencyNameChartData, 
            backgroundColor: this.agencyNameLegendData.map(item => item.color), 
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
            tooltip: {
              callbacks: {
                label: (context) => {
                  const label = context.label || '';
                  const value = context.parsed || 0;
                  return `${label}: ${value}`;
                }
              }
            }
          },
          animation: {
            animateScale: true,
            animateRotate: true
          }
        },
      });
    }
  }
  
  this.chartsInitialized = true;
  this.pendingChartUpdate = false;
}

  ngOnInit(): void {
    this.loggedUser = this._stateService.getLoginDetails();
    this.TeamName = this.loggedUser?.Team;

    this.fetchAgenciesWithAgents();
    this.fetchAgencyStatistics();

    this._loadinService.hide();
    this.initFilterForm();

    this.teamManagementData = this._stateService.getTeamManagementData();

    document.addEventListener('fullscreenchange', () => {
      this.cdr.detectChanges();
    });

    this._homeService.getUserDetails().subscribe(({ data }) => {
      if (data) {
        this.UserManagementData = data.UserManagement.map((user) => {
          const prjDetails = user.PrjDetails || [];
          return {
            ...user,
            ProjectNames: prjDetails.map(
              (p: any) => p.prj_name || p.projectName || ''
            ),
            TeamNames: prjDetails.map(
              (p: any) => p.team_name || p.teamName || ''
            ),
            TeamIds: prjDetails.map((p: any) => p.team_id || p.TeamId || ''),
            RoleNames: prjDetails.map(
              (p: any) => p.role_name || p.roleName || ''
            ),
          };
        });
      }
      console.log('UserManagementData:', this.UserManagementData);

      // ✅ Load privileges from API
      this.loadPrivileges();
    });
  }

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
          this.cdr.detectChanges();
        }
      }
    });
  }
  // loadPrivileges() {
  //   this._rolePrivilegeService.getPermissions().subscribe({
  //     next: (res) => {
  //       console.log('Privileges API Response:', res.data);
  //       if (res?.data?.length) {
  //         this.mapPrivileges(res.data); // send data to mapping
  //       } else {
  //         console.warn('No privileges returned from API');
  //       }
  //     },
  //     error: (err) => console.error('Error fetching privileges:', err),
  //   });
  // }

  // mapPrivileges(allPrivileges: any) {
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
  //   const roleId = String(loggedUser?.ProjectDtl?.[0]?.RoleId || '0'); // fallback to default

  //   console.log('--- Logged User Details ---', {
  //     projectId,
  //     teamId,
  //     roleId,
  //     roleName,
  //   });
  //   console.log('Privileges from API:', allPrivileges);

  //   // Reset privileges
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
  //     this.cdr.detectChanges();
  //     return;
  //   }

  //   // Match privilege based on ProjectId, TeamId, RoleId
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
  //     const pagePerms = privMap.permissions['Agency Management'] || {};
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
  //     this.isPrivilegeView = true; // fallback view-only
  //   }

  //   this.cdr.detectChanges();
  // }


  // rolePrivilegMappingEmit(allPrivileges: any) {
  //   const roles = this._stateService.getRoleManagementData() || [];
  //   const loggedUser = this._stateService.getLoginDetails();
  //   const roleName = loggedUser?.Role?.toLowerCase() || '';
  //   const activeProject = loggedUser?.ActiveProject?.toLowerCase() || '';

  //   // reset
  //   this.isPrivilegeView = false;
  //   this.isPrivilegeEdit = false;
  //   this.isPrivilegeDelete = false;

  //   //  compare lowercase consistently
  //   if (roleName === 'super admin') {
  //     if (activeProject === 'master') {
  //       this.isPrivilegeView = true;
  //       this.isPrivilegeEdit = true;
  //       this.isPrivilegeDelete = true;
  //     } else {
  //       this.isPrivilegeView = true;
  //       this.isPrivilegeEdit = false;
  //       this.isPrivilegeDelete = false;
  //     }
  //     this.cdr.detectChanges();
  //     return;
  //   }

  //   const role = roles.find((r: { RoleName: string }) => r.RoleName.toLowerCase() === roleName);
  //   if (!role) return;

  //   const rolePrivilegeList = allPrivileges || [];
  //   const privMap = rolePrivilegeList.find((rp: { RoleId: any }) => rp.RoleId === role.RoleId.toString());

  //   if (privMap && privMap.permissions) {
  //     const pageKey = 'Agency Management';
  //     const pagePerms = privMap.permissions[pageKey];
  //     if (pagePerms) {
  //       this.isPrivilegeView = !!pagePerms.view;
  //       this.isPrivilegeEdit = !!pagePerms.edit || !!pagePerms["insert / edit"];
  //       this.isPrivilegeDelete = !!pagePerms.delete;
  //     }
  //   }

  //   this.cdr.detectChanges();
  // }

  initFilterForm(): void {
    this.filterForm = this.fb.group({
      // agency_name: [''],
      // agency_desc: ['']
      team_name: [''],
      agent_type: [''],
    });
  }

applyFilters(): void {
  const teamFilter = this.filterForm.get('team_name')?.value?.toLowerCase() || '';
  const agentTypeFilter = this.filterForm.get('agent_type')?.value?.toLowerCase() || '';

  // Start with the full list
  let sourceList: any[] = [...this.agenciesWithAgents];
  
  // First apply any active tab filter
  const selectedTab = this.agencyCountsList.find((item) => item.active);
  if (selectedTab?.key === 'trending_agencies') {
    sourceList = sourceList.filter((agency: any) => agency.trending_agency) || [];
  }
  
  // Apply dropdown filters
  sourceList = sourceList.filter((agency: any) => {
    const matchesTeam = !teamFilter || agency.assigned_to?.toLowerCase().includes(teamFilter);
    const matchesAgentType = !agentTypeFilter ||
      agency.agents?.some((agent: any) =>
        agent.agent_type_name?.toLowerCase().includes(agentTypeFilter)
      );
    return matchesTeam && matchesAgentType;
  });

  // Then apply any team or agency name filters
  if (this.activeTeamFilter) {
    sourceList = sourceList.filter((agency: any) =>
      agency.assigned_to?.toLowerCase().trim() === this.activeTeamFilter?.toLowerCase().trim()
    );
  }
  else if (this.activeAgencyNameFilter) {
    const cleanFilterName = this.activeAgencyNameFilter.toString().toLowerCase().trim();
    sourceList = sourceList.filter((agency: any) =>
      agency.agency_name?.toString().toLowerCase().trim() === cleanFilterName
    );
  }

  // Finally apply the search term if it exists
  if (this.agencySearchTerm) {
    const searchTerm = this.agencySearchTerm.toLowerCase().trim();
    sourceList = sourceList.filter((agency: any) =>
      agency.agency_name?.toLowerCase().includes(searchTerm) ||
      (agency.agency_desc && agency.agency_desc.toLowerCase().includes(searchTerm))
    );
  }

  this.filteredAgenciesWithAgents = sourceList;

  // Remove these lines - don't update tab counts when filtering
  // this.agencyCountsList[0].count = this.filteredAgenciesWithAgents.length;
  // this.agencyCountsList[1].count = this.filteredAgenciesWithAgents.filter(
  //   (agency) => agency.trending_agency
  // ).length;

  this.updateChartWithFilteredData(); 
  this.updateAgencyChartFromFilteredList(); 
  this.cdr.detectChanges();

  // Close the modal
  const modalElement = document.getElementById('filter');
  if (modalElement) {
    const modal = bootstrap.Modal.getInstance(modalElement);
    if (modal) {
      modal.hide();
    }
  }
}


clearSearchTerm(): void {
  this.agencySearchTerm = '';
  this.applyFilters(); // Reapply any existing dropdown filters
  this.cdr.detectChanges();
}

clearFilters(): void {
  this.filterForm.setValue({
    team_name: '',
    agent_type: '',
  });


  // Apply any existing search term
  this.filterAgenciesBySearchTerm();
  this.cdr.detectChanges();

  // Close the modal
  const modalElement = document.getElementById('filt');
  if (modalElement) {
    const modalInstance = bootstrap.Modal.getInstance(modalElement);
    if (modalInstance) {
      modalInstance.hide();
    }
  }
}

  NewAgency(): void {
    this.AgncyPopupTitle = 'Create New Agency';
    this.compositionAgents = [];
    this.isAgencyManage = false;
    this.IsAgencyEditClose = false;
    this.loadAgents();
    this.loadAgencytype();
    this.isFormValid();
    this.fileError = null;
	this.resetCardState();
    this.cdr.detectChanges();
  }

refreshChartsAfterOperation(): void {
  // Fetch updated data
  this.fetchAgencyStatistics();
  this.fetchAgenciesWithAgents();
}

// Modify updateChartWithFilteredData to handle uninitialized charts
updateChartWithFilteredData(): void {
  if (!this.chartsInitialized) {
    this.pendingChartUpdate = true;
    return;
  }

  const teamCounts: Record<string, number> = {};
  this.filteredAgenciesWithAgents.forEach((agency: any) => {
    if (agency.assigned_to) {
      const team = agency.assigned_to;
      teamCounts[team] = (teamCounts[team] || 0) + 1;
    }
  });

  this.agencyChartLabels = Object.keys(teamCounts);
  this.agencyChartData = Object.values(teamCounts).map((v: any) => Number(v) || 0);
  this.agencyStats.totalAgencies = this.filteredAgenciesWithAgents.length;

  const colors = ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#fb8c00', '#f57c00'];
  this.agencyLegendData = this.agencyChartLabels.map((label, idx) => ({
    label,
    count: this.agencyChartData[idx] || 0,
    color: colors[idx % colors.length],
  }));

  if (this.agencyDonutChart) {
    this.agencyDonutChart.data.labels = this.agencyChartLabels;
    this.agencyDonutChart.data.datasets[0].data = this.agencyChartData;
    const bgColors = this.agencyChartLabels.map((_, i) => colors[i % colors.length]);
    this.agencyDonutChart.data.datasets[0].backgroundColor = bgColors;
    this.agencyDonutChart.update();
  }
}

 toggleTeamFilter(teamLabel: string): void {
  // Clear other filters when a team filter is clicked
  this.activeAgentFilter = null;

  if (this.activeTeamFilter === teamLabel) {
    this.activeTeamFilter = null;
    this.filteredAgenciesWithAgents = [...this.agenciesWithAgents];
  } else {
    this.activeTeamFilter = teamLabel;
    this.applyTeamFilter();
  }

  if (this.agencySearchTerm) {
    this.filterAgenciesBySearchTerm();
  } else {
    // If no search term, update BOTH charts now.
    this.updateChartWithFilteredData(); 
    this.updateAgencyChartFromFilteredList();
  }

  this.cdr.detectChanges();
}

applyTeamFilter(): void {
  if (!this.activeTeamFilter) {
    this.filteredAgenciesWithAgents = [...this.agenciesWithAgents];
    return;
  }
  
  this.filteredAgenciesWithAgents = this.agenciesWithAgents.filter((agency: any) => 
    agency.assigned_to?.toLowerCase() === this.activeTeamFilter?.toLowerCase()
  );
}

updateAgencyChartFromFilteredList(): void {
  if (!this.chartsInitialized) {
    this.pendingChartUpdate = true;
    return;
  }

  const agentCounts: Record<string, number> = {};
  
  this.filteredAgenciesWithAgents.forEach((agency: any) => {
    if (agency.agency_name && this.agentMapping[agency.agency_name]) {
      const agentName = agency.agency_name;
      agentCounts[agentName] = (agentCounts[agentName] || 0) + this.agentMapping[agentName];
    }
  });

  this.agencyNameChartLabels = Object.keys(agentCounts);
  this.agencyNameChartData = Object.values(agentCounts).map((v: any) => Number(v) || 0);
  this.agencyNameStats.totalAgents = this.agencyNameChartData.reduce((sum, count) => sum + count, 0);

  const colors = ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#fb8c00', '#f57c00'];
  this.agencyNameLegendData = this.agencyNameChartLabels.map((label, idx) => ({
    label,
    count: this.agencyNameChartData[idx] || 0,
    color: colors[idx % colors.length],
  }));

  if (this.agencyNameDonutChartInstance) {
    this.agencyNameDonutChartInstance.data.labels = this.agencyNameChartLabels;
    this.agencyNameDonutChartInstance.data.datasets[0].data = this.agencyNameChartData;
    this.agencyNameDonutChartInstance.data.datasets[0].backgroundColor = this.agencyNameLegendData.map(item => item.color);
    this.agencyNameDonutChartInstance.update();
  }
}

// Add a method to check for pending updates after initialization
checkPendingUpdates(): void {
  if (this.pendingChartUpdate) {
    this.updateChartWithFilteredData();
    this.updateAgencyChartFromFilteredList();
  }
}

ngOnDestroy(): void {
  if (this.agencyDonutChart) {
    this.agencyDonutChart.destroy();
    this.agencyDonutChart = undefined;
  }
  if (this.agencyNameDonutChartInstance) {
    this.agencyNameDonutChartInstance.destroy();
    this.agencyNameDonutChartInstance = undefined;
  }
}

filterAgenciesBySearchTerm(): void {
  // Start with the full list
  let sourceList: any[] = [...this.agenciesWithAgents];
  
  // First apply any active tab filter
  const selectedTab = this.agencyCountsList.find((item) => item.active);
  if (selectedTab?.key === 'trending_agencies') {
    sourceList = sourceList.filter((agency: any) => agency.trending_agency) || [];
  }
  
  // Then apply any dropdown filters
  const teamFilter = this.filterForm.get('team_name')?.value?.toLowerCase() || '';
  const agentTypeFilter = this.filterForm.get('agent_type')?.value?.toLowerCase() || '';
  
  if (teamFilter) {
    sourceList = sourceList.filter((agency: any) => 
      agency.assigned_to?.toLowerCase().includes(teamFilter)
    );
  }
  
  if (agentTypeFilter) {
    sourceList = sourceList.filter((agency: any) =>
      agency.agents?.some((agent: any) =>
        agent.agent_type_name?.toLowerCase().includes(agentTypeFilter)
      )
    );
  }
  
  // Then apply any team or agency name filters
  if (this.activeTeamFilter) {
    sourceList = sourceList.filter((agency: any) =>
      agency.assigned_to?.toLowerCase().trim() === this.activeTeamFilter?.toLowerCase().trim()
    );
  }
  else if (this.activeAgencyNameFilter) {
    const cleanFilterName = this.activeAgencyNameFilter.toString().toLowerCase().trim();
    sourceList = sourceList.filter((agency: any) =>
      agency.agency_name?.toString().toLowerCase().trim() === cleanFilterName
    );
  }

  // Finally apply the search term if it exists
  if (this.agencySearchTerm) {
    const searchTerm = this.agencySearchTerm.toLowerCase().trim();
    sourceList = sourceList.filter((agency: any) =>
      agency.agency_name?.toLowerCase().includes(searchTerm) ||
      (agency.agency_desc && agency.agency_desc.toLowerCase().includes(searchTerm))
    );
  }

  this.filteredAgenciesWithAgents = sourceList;
  this.updateChartWithFilteredData();
  this.updateAgencyChartFromFilteredList();
  this.cdr.detectChanges();
}


  fetchAgenciesWithAgentsold(): void {
    this._apiService.getAgencyWithAgents().subscribe({
      next: (res) => {
        if (res.success) {
          this.agenciesWithAgents = res.data;
          this.filteredAgenciesWithAgents = [...this.agenciesWithAgents];
          this.loadAgenciesWithAgentsdropdown = [...this.agenciesWithAgents];

          // Ensure ratings exist for all agencies
          this.agenciesWithAgents.forEach((agency) => {
            agency.rating = agency.rating || '4.5'; // Fallback to 4.5 if no rating
          });

          // Update counts and other data
          this.agencyCountsList[0].count = res?.data?.length;
          this.agencyCountsList[1].count =
            res?.data?.filter((agency: any) => agency.trending_agency).length ||
            0;

          // this.updateFilterOptions(res.Agency);
          this.updateAgencyTab();
          this.cdr.detectChanges();
        }
      },
      error: (err) => console.error('Error:', err),
    });
  }

  fetchAgenciesWithAgents(): void {
  this._apiService.getAgencyWithAgents().subscribe({
    next: (res) => {
      if (res.success) {
        this.agenciesWithAgents = res.data || [];

        // Fetch project list from state
        const activePrj = this.loggedUser?.ActiveProject;
        console.log('Active Project:', activePrj);

        // Extract mapped team & role from PrjDetails for the active project
        const projectDetails = this.loggedUser?.ProjectDtl || [];
        console.log('User Project Details:', projectDetails);

        // Find project mapping for the active project (case-insensitive)
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
          const projects = this._stateService.getProjectManagementData() || [];
          console.log('proj', projects);
          const activeProject = projects.find(
            (prj: any) =>
              prj.projectName &&
              prj.projectName.toLowerCase() === activePrj.toLowerCase()
          );
          console.log('Active pppp:', activeProject);

          if (mappedTeam) {
            console.log('needagency0:', this.agenciesWithAgents);
            this.agenciesWithAgents = this.agenciesWithAgents.filter(
              (agency) =>
                agency.assigned_to.toLowerCase() === mappedTeam.toLowerCase()
            );

            console.log('needagency:', this.agenciesWithAgents);
          }
        } else {
          this.agenciesWithAgents = res.data;
        }

        this.filteredAgenciesWithAgents = [...this.agenciesWithAgents];
        this.loadAgenciesWithAgentsdropdown = [...this.agenciesWithAgents];

        // Ensure ratings exist for all agencies
        this.agenciesWithAgents.forEach((agency) => {
          agency.rating = agency.rating || '4.5'; // Fallback to 4.5 if no rating
        });

        // Update counts and other data
        this.agencyCountsList[0].count = this.agenciesWithAgents?.length;
        this.agencyCountsList[1].count =
          this.agenciesWithAgents?.filter(
            (agency: any) => agency.trending_agency
          ).length || 0;
        
        // Initialize charts after data is loaded
        setTimeout(() => {
          this.initializeCharts();
          this.cdr.detectChanges();
        }, 100);
        
        this.updateAgencyTab();
        this.cdr.detectChanges();
      }
    },
    error: (err) => console.error('Error:', err),
  });
}

  fetchUpdatedAgenciesWithAgents() {
    return this._apiService.getAgencyWithAgents().pipe(
      tap((res) => {
        if (res.success) {
          this.agenciesWithAgents = res.data;
          this.filteredAgenciesWithAgents = [...this.agenciesWithAgents];
          this.loadAgenciesWithAgentsdropdown = [...this.agenciesWithAgents];

          // Ensure ratings exist for all agencies
          this.agenciesWithAgents.forEach((agency) => {
            agency.rating = agency.rating || '4.5'; // Fallback to 4.5 if no rating
          });

          // Update counts and other data
          this.agencyCountsList[0].count = res?.data?.length;
          this.agencyCountsList[1].count =
            res?.data?.filter((agency: any) => agency.trending_agency).length ||
            0;
          // this.updateFilterOptions(res.Agency);
          this.updateAgencyTab();
          this.cdr.detectChanges();
        }
      }),
      catchError((err) => {
        //console.error('Error:', err);
        // Optionally rethrow or return an empty observable
        return EMPTY;
      })
    );
  }

  getAgencyWithAgents(agencyId: string): void {
    this._apiService.getAgencyWithAgentsById(agencyId).subscribe({
      next: (res) => {
        if (res.Success && res.Agency) {
          this.selectedAgency = res.Agency;
          this.selectedAgency.rating = this.selectedAgency.rating || '4.5'; // Fallback
          this.selectedAgency.agents = res.Agency.agents || [];
          this.filteredAgents = this.selectedAgency.agents;
          const grouped = this.getAgentsGroupedByType(
            this.selectedAgency.agents
          );
          this.typeNames = Object.keys(grouped);
        }
      },
      error: (err) => console.error('Error:', err),
    });
  }

  onSearchAgencyAgent(): void {
    this.cdr.detectChanges();
  }

  setActiveAgencyTab(index: number): void {
    this.agencyCountsList.forEach((item, i) => (item.active = i === index));
    this.updateAgencyTab();
  }

updateAgencyTab(): void {
  this.activeTeamFilter = null;
  this.activeAgencyNameFilter = null;
  this.agencySearchTerm = '';

  const selected = this.agencyCountsList.find((item) => item.active);
  if (selected?.key === 'trending_agencies') {
    this.filteredAgenciesWithAgents = this.agenciesWithAgents.filter((agency: any) => agency.trending_agency) || [];
  } else {
    this.filteredAgenciesWithAgents = [...this.agenciesWithAgents];
  }

  this.updateChartWithFilteredData();
  this.updateAgencyNameChartWithFilteredData();
  this.cdr.detectChanges();
}

  loadFilterDropdown(agency: any): void {
    this.filterOptions.totalAgencies.teamNames = [
      ...new Set(
        agency
          .map((a: any) => a.assigned_to)
          .filter((team: any): team is string => typeof team === 'string')
      ),
    ] as string[];

    this.filterOptions.totalAgencies.agentTypes = [
      ...new Set(
        agency
          .flatMap(
            (a: any) =>
              a.agents?.map((agent: any) => agent.agent_type_name) || []
          )
          .filter((type: any): type is string => typeof type === 'string')
      ),
    ] as string[];

    this.filterOptions.trendingAgencies.teamNames = [
      ...new Set(
        agency
          .filter((a: any) => a.trending_agency)
          .map((a: any) => a.assigned_to)
          .filter((team: any): team is string => typeof team === 'string')
      ),
    ] as string[];

    this.filterOptions.trendingAgencies.agentTypes = [
      ...new Set(
        agency
          .filter((a: any) => a.trending_agency)
          .flatMap(
            (a: any) =>
              a.agents?.map((agent: any) => agent.agent_type_name) || []
          )
          .filter((type: any): type is string => typeof type === 'string')
      ),
    ] as string[];
  }

  fetchTrendingAgencyStats(): void {
    this._apiService.getTrendingAgencyStats().subscribe({
      next: ({ data }) => {
        this.trendingStats = data;

        // Update trending agencies count
        if (data.trending_agencies !== undefined) {
          this.agencyCountsList[1].count = data.trending_agencies;
        }

        if (data.agencies) {
          this.filterOptions.trendingAgencies.teamNames = [
            ...new Set(
              data.agencies
                .map((a: any) => a.assigned_to)
                .filter((team: any): team is string => typeof team === 'string')
            ),
          ] as string[];

          this.filterOptions.trendingAgencies.agentTypes = [
            ...new Set(
              data.agencies
                .flatMap(
                  (a: any) =>
                    a.agents?.map((agent: any) => agent.agent_type_name) || []
                )
                .filter((type: any): type is string => typeof type === 'string')
            ),
          ] as string[];
        }

        this.updateAgencyTab();
      },
      error: (err) => console.error('Error:', err),
    });
  }
  updateFilterOptions(agencies: any[]): void {
    this.filterOptions.totalAgencies.teamNames = [
      ...new Set(
        agencies
          .map((a: any) => a.assigned_to)
          .filter((team: any): team is string => typeof team === 'string')
      ),
    ] as string[];

    this.filterOptions.totalAgencies.agentTypes = [
      ...new Set(
        agencies
          .flatMap(
            (a: any) =>
              a.agents?.map((agent: any) => agent.agent_type_name) || []
          )
          .filter((type: any): type is string => typeof type === 'string')
      ),
    ] as string[];

    this.filterOptions.trendingAgencies.teamNames = [
      ...new Set(
        agencies
          .filter((a: any) => a.trending_agency)
          .map((a: any) => a.assigned_to)
          .filter((team: any): team is string => typeof team === 'string')
      ),
    ] as string[];

    this.filterOptions.trendingAgencies.agentTypes = [
      ...new Set(
        agencies
          .filter((a: any) => a.trending_agency)
          .flatMap(
            (a: any) =>
              a.agents?.map((agent: any) => agent.agent_type_name) || []
          )
          .filter((type: any): type is string => typeof type === 'string')
      ),
    ] as string[];
  }

  getCurrentTeamNames(): string[] {
    const selected = this.agencyCountsList.find((item) => item.active);

    this.filterOptions.totalAgencies.teamNames = [
      ...new Set(
        this.loadAgenciesWithAgentsdropdown
          .map((a: any) => a.assigned_to)
          .filter((team: any): team is string => typeof team === 'string')
      ),
    ] as string[];

    return selected?.key === 'trending_agencies'
      ? this.filterOptions.trendingAgencies.teamNames
      : this.filterOptions.totalAgencies.teamNames;
  }

  getCurrentAgentTypes(): string[] {
    const selected = this.agencyCountsList.find((item) => item.active);

    this.filterOptions.totalAgencies.agentTypes = [
      ...new Set(
        this.loadAgenciesWithAgentsdropdown
          .flatMap(
            (a: any) =>
              a.agents?.map((agent: any) => agent.agent_type_name) || []
          )
          .filter((type: any): type is string => typeof type === 'string')
      ),
    ] as string[];

    return selected?.key === 'trending_agencies'
      ? this.filterOptions.trendingAgencies.agentTypes
      : this.filterOptions.totalAgencies.agentTypes;
  }

  // loadFilterDropdown(agency: any): void {

  //   this.filterOptions.totalAgencies.agencyNames = [
  //     ...new Set(
  //       agency
  //         .map((a: any) => a.agency_name)
  //         .filter((name: any): name is string => typeof name === 'string')
  //     )
  //   ] as string[];

  //   this.filterOptions.totalAgencies.descriptions = [
  //     ...new Set(
  //       agency
  //         .map((a: any) => a.agency_desc)
  //         .filter((desc: any): desc is string => typeof desc === 'string')
  //     )
  //   ] as string[];

  //   this.filterOptions.trendingAgencies.agencyNames = [
  //     ...new Set(
  //       agency
  //         .map((a: any) => a.agency_name)
  //         .filter((name: any): name is string => typeof name === 'string')
  //     )
  //   ] as string[];

  //   this.filterOptions.trendingAgencies.descriptions = [
  //     ...new Set(
  //       agency
  //         .map((a: any) => a.agency_desc)
  //         .filter((desc: any): desc is string => typeof desc === 'string')
  //     )
  //   ] as string[];

  // }

  // fetchTrendingAgencyStats(): void {
  //   this._apiService.getTrendingAgencyStats().subscribe({
  //     next: (res) => {
  //       this.trendingStats = res;

  //       // Update trending agencies count
  //       if (res.trending_agencies !== undefined) {
  //         this.agencyCountsList[1].count = res.trending_agencies;
  //       }

  //       if (res.agencies) {
  //         this.filterOptions.trendingAgencies.agencyNames = [
  //           ...new Set(
  //             res.agencies
  //               .map((a: any) => a.agency_name)
  //               .filter((name: any): name is string => typeof name === 'string')
  //           )
  //         ] as string[];

  //         this.filterOptions.trendingAgencies.descriptions = [
  //           ...new Set(
  //             res.agencies
  //               .map((a: any) => a.agency_desc)
  //               .filter((desc: any): desc is string => typeof desc === 'string')
  //           )
  //         ] as string[];
  //       }

  //       this.updateAgencyTab();
  //     },
  //     error: (err) => console.error('Error:', err)
  //   });
  // }

  getCurrentAgencyNames(): string[] {
    const selected = this.agencyCountsList.find((item) => item.active);

    this.filterOptions.totalAgencies.agencyNames = [
      ...new Set(
        this.loadAgenciesWithAgentsdropdown
          .map((a: any) => a.agency_name)
          .filter((name: any): name is string => typeof name === 'string')
      ),
    ] as string[];

    return selected?.key === 'trending_agencies'
      ? this.filterOptions.trendingAgencies.agencyNames
      : this.filterOptions.totalAgencies.agencyNames;
  }

  getCurrentDescriptions(): string[] {
    const selected = this.agencyCountsList.find((item) => item.active);

    this.filterOptions.totalAgencies.descriptions = [
      ...new Set(
        this.loadAgenciesWithAgentsdropdown
          .map((a: any) => a.agency_desc)
          .filter((desc: any): desc is string => typeof desc === 'string')
      ),
    ] as string[];
    return selected?.key === 'trending_agencies'
      ? this.filterOptions.trendingAgencies.descriptions
      : this.filterOptions.totalAgencies.descriptions;
  }

  //New Agency

  loadAgents(): void {
    this._apiService.getAgentDetails().subscribe({
      next: (response) => {
        if (response && response.data) {
          this.allAgents = response.data; // Initialize filtered agents
          this.filteredAgents = [...this.allAgents];
          // this.agencyTypes = [...new Set(this.allAgents.map(agent => agent.agent_typename))];
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        //console.error('Error loading agents:', err);
      },
    });
  }

  loadAgencytype(): void {
    this._apiService.getAgencytype().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.allagencytype = response.data; // Initialize filtered agents
          this.cdr.detectChanges();
        }
      },
      error: (err) => {
        //console.error('Error loading agencytype:', err);
      },
    });
  }

  filteredAgentsDetail(): any[] {
    // Show all agents if no search term
    if (!this.searchTerm.trim()) {
      this.filteredAgents = [...this.allAgents];
      return this.filteredAgents;
    }

    this.filteredAgents = this.allAgents.filter((agent) =>
      agent.name.toLowerCase().includes(this.searchTerm.toLowerCase())
    );

    // Filter agents by name (case-insensitive)
    return this.filteredAgents;
  }

  onFileChange(event: any) {
    const file = event.target.files[0];
    this.fileError = null; // Reset previous error
    if (file) {
      const allowedTypes = ['image/png', 'image/jpeg', 'image/svg+xml'];
      if (!allowedTypes.includes(file.type)) {
        this.fileError = 'Only PNG, JPG, and SVG images are allowed.';
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          this.formData.avatar = reader.result?.toString() || '';
          this.cdr.detectChanges(); // Trigger change detection
        };
        reader.readAsDataURL(file);
      }
    } else {
      this.formData.avatar = ''; // Clear avatar if no file is selected
    }
    this.cdr.detectChanges(); // Trigger change detection to update button state
  }
  // Called when user inputs/selects agency name
  onAgencyNameChange() {
    if (this.formData.agency_name?.trim()) {
      // Reset agents and agentCounter
      this.compositionAgents = [];
      this.agentCounter = 0;
      // Set agency node at fixed position top center
      this.agencyOnNode = {
        nodeId: 'agency-root',
        x: 150,
        y: 30,
        width: 200,
        height: 80,
        name: this.formData.agency_name,
      };

      this.isDuplicateAgency = this.filteredAgenciesWithAgents.some(
        (existing) =>
          existing.agency_name.toLowerCase() ===
          this.formData.agency_name?.trim().toLowerCase()
      );

      this.cdr.detectChanges();
    } else {
      this.agencyOnNode = null;
      this.compositionAgents = [];
      this.agentCounter = 0;
      this.cdr.detectChanges();
    }
  }

  isFormValid(): boolean {
    const agencyNameValid =
      this.agencyNameField?.disabled || this.agencyNameField?.valid;
    const valid =
      !!agencyNameValid &&
      // !!this.agencyTypeField?.valid &&
      !!this.teamField?.valid &&
      !!this.descriptionField?.valid &&
      this.isAgentCompositionValid === true &&
      this.fileError === null;
    return valid;
  }

  get masterAgents() {
    return this.filteredAgents.filter((agent) => {
      const isMaster = agent.agent_type_id === 'MASTER';
      const isAlreadyLinked = this.filteredAgenciesWithAgents.some(
        (existingAgent) =>
          existingAgent.agents.some(
            (existingAgentDetails: { agent_id: any }) =>
              existingAgentDetails.agent_id === agent.agent_id
          )
      );
      return isMaster && !isAlreadyLinked;
    });
  }

  get otherAgents() {
    return this.filteredAgents.filter((a) => a.agent_type_id !== 'MASTER' 
    && !this.compositionAgents.some((comp) => comp.agent_id === a.agent_id)
    && (!a.Approval_Status || a.Approval_Status === 'Approved'));
  }

  isDeleteDisabled(agent: any): boolean {

    const isMaster = agent.agent_type_id === 'MASTER';
    const isPrimaryMaster = agent.order_number === 1;

    let linkedCount = this.masterAgents.length;

    return isMaster && isPrimaryMaster && linkedCount == 0;
  }


  // Called when an agent is selected (from your filteredAgents UI)
  addToComposition(agent: AgentOn) {
    // Avoid duplicates by agent_id
    if (this.compositionAgents.some((a) => a.agent_id === agent.agent_id))
      return;

    // Assign unique nodeId and fixed size for UI layout
    agent.nodeId = 'node' + ++this.agentCounter;
    agent.width = 200;
    agent.height = 80;

    let x: number;
    let y: number;
    let parentNodeId: string;

    if (!this.agencyOnNode) {
      this.agencyOnNode = this.compositionAgents[0];
    }

    if (!this.agencyOnNode) {
      //console.log('Agency not set! Please type/select an agency first.');
      return;
    }

    if (agent.agent_type_id === 'MASTER') {
      // Place MASTER agents horizontally under the agency
      const lv1Count = this.compositionAgents.filter(
        (a) => a.agent_type_id === 'MASTER'
      ).length;

      // Set spacing and dimensions
      const spacing = 40;
      const nodeWidth = agent.width || 200; // Fallback if not defined

      // Compute x and y
      x = this.agencyOnNode.x + lv1Count * (nodeWidth + spacing);
      y = this.agencyOnNode.y + (this.agencyOnNode.height || 80) + 60;

      parentNodeId = this.agencyOnNode.nodeId;

      this.masterSelected = true;
      this.othersSelected = false;
    } else {
      // For non-MASTER agents, find their MASTER parent by parent_agent_id field
      const lv1Agents = this.compositionAgents.filter(
        (a) => a.agent_type_id === 'MASTER'
      );
      let parent = lv1Agents.find((a) => a.agent_id === agent.parent_agent_id);

      if (!parent) {
        // Fallback: attach to last MASTER agent if present
        parent = lv1Agents.length ? lv1Agents[lv1Agents.length - 1] : null;
      }

      if (parent) {
        // Place children horizontally below their MASTER parent
        const siblingsCount = this.compositionAgents.filter(
          (a) => a.parentId === parent.nodeId
        ).length;
        x = parent.x! + siblingsCount * (agent.width + 80);
        y = parent.y! + parent.height! + 80;
        parentNodeId = parent.nodeId!;
      } else {
        // NO MASTER parent: place multiple agents side-by-side directly under agency

        // Count how many agents already attached directly to agency (without master)
        const directChildren = this.compositionAgents.filter(
          (a) => a.parentId === this.agencyOnNode.nodeId
        );
        const siblingIndex = directChildren.length;

        const horizontalSpacing = (agent.width || 200) + 40;
        const verticalSpacing = 60;
        x = this.agencyOnNode.x + siblingIndex * horizontalSpacing;
        y =
          this.agencyOnNode.y +
          (this.agencyOnNode.height || 80) +
          verticalSpacing;
        parentNodeId = this.agencyOnNode.nodeId;
      }
    }

    const newAgent: AgentOn = {
      ...agent,
      x,
      y,
      parentId: parentNodeId,
    };

    // Add to composition
    this.compositionAgents.push(newAgent);

    const hasMaster = this.compositionAgents.some(
      (a) => a.agent_type_id === 'MASTER'
    );
    const hasTask = this.compositionAgents.some(
      (a) => a.agent_type_id !== 'MASTER'
    );
    this.isAgentCompositionValid = hasMaster && hasTask;

    this.isFormValid();
    this.cdr.detectChanges();

    // After DOM update, calculate line coordinates
    setTimeout(() => this.updateLines(), 10);
  }

  // Calculate connection lines between each agent and its parent node
  updateLines() {
    if (!this.agencyOnNode) return;

    const containerEl = document.querySelector(
      '.composition-container'
    ) as HTMLElement;
    if (!containerEl) {
      //console.warn('Container element .composition-container not found!');
      return;
    }

    this.compositionAgents.forEach((agent) => {
      if (!agent.parentId) return;

      const parentEl = document.getElementById(agent.parentId);
      const agentEl = document.getElementById(agent.nodeId);

      if (parentEl && agentEl) {
        const cRect = containerEl.getBoundingClientRect();
        const pRect = parentEl.getBoundingClientRect();
        const nRect = agentEl.getBoundingClientRect();

        // Positions for line endpoints — bottom center of parent to top center of child
        agent.x1 = pRect.left + pRect.width / 2 - cRect.left;
        agent.y1 = pRect.top + pRect.height - cRect.top + 5; // offset for circle placement
        agent.x2 = nRect.left + nRect.width / 2 - cRect.left;
        agent.y2 = nRect.top - cRect.top - 5; // offset for circle placement
      }
    });

    this.cdr.detectChanges();
  }

  deleteAgent(agent: any) {
    // Prevent deletion of agency node
    if (agent.agent_type_id === 'AGENCY') {
      return;
    }

    // Remove agent from composition list
    this.compositionAgents = this.compositionAgents.filter(
      (a) => a.nodeId !== agent.nodeId
    );

    // Optional: Also reset masterSelected flag if a MASTER agent is deleted
    if (agent.agent_type_id === 'MASTER') {
      this.masterSelected = false;
      this.othersSelected = false;
    }
    const hasMaster = this.compositionAgents.some(
      (a) => a.agent_type_id === 'MASTER'
    );
    const hasTask = this.compositionAgents.some(
      (a) => a.agent_type_id !== 'MASTER'
    );
    this.isAgentCompositionValid = hasMaster && hasTask;

    if (!hasMaster) {
      this.othersSelected = true;
    }
    //console.log("IsValid", this.isAgentCompositionValid);
    this.cdr.detectChanges();

    this.isFormValid();

    this.cdr.detectChanges();
  }

  setSelectedAgent(agent: any) {
    this.selectedAgent = agent;
  }
  // Get Center of Parent Node
  getParentCenterX(parentId: string): number {
    const el = document.getElementById(parentId);
    return el ? el.offsetLeft + el.offsetWidth / 2 : 0;
  }

  getParentCenterY(parentId: string): number {
    const el = document.getElementById(parentId);
    return el ? el.offsetTop + el.offsetHeight : 0;
  }

  // Get Center of Current Node
  getCenterX(nodeId: string): number {
    const el = document.getElementById(nodeId);
    return el ? el.offsetLeft + el.offsetWidth / 2 : 0;
  }

  getCenterY(nodeId: string): number {
    const el = document.getElementById(nodeId);
    return el ? el.offsetTop : 0;
  }

  drop(event: CdkDragDrop<string[]>) {
    moveItemInArray(
      this.compositionAgents,
      event.previousIndex,
      event.currentIndex
    );
  }

  submitAgencyForm() {
    if (!this.formData.agency_name || this.compositionAgents.length === 0) {
      return;
    }

	const agentsPayload = this.compositionAgents.filter((agent) => agent.agent_id!=undefined && agent.agent_id !="").map((agent) => {
      const typeName = agent.agent_type_name?.trim().toLowerCase();

      return {
        agent_id: agent.agent_id,
        agent_name: agent.name,
        order_number: typeName === 'master agent' ? 1 : 2,
      };
    });

    const payload = {
      agency_name: this.formData.agency_name,
      //agency_type: this.formData.agency_type,
      agency_desc: this.formData.agency_desc,
      avatar: this.formData.avatar,
      provider_id: this.formData.provider_id,
      provider_name: this.formData.provider_name,
      agents: agentsPayload,
      team: this.formData.team,
    };
    //console.log('Payload:', payload);

    this._apiService.onboardAgencyWithAgents(payload).subscribe({
      next: (res) => {
        this.fetchAgenciesWithAgents();

        this.showToast('success', res?.message);

        this.masterSelected = false;
        this.othersSelected = true;
        this.cdr.detectChanges();
        this.resetForm();

        this.fetchUpdatedAgenciesWithAgents().subscribe(() => {
          this.clearAgencyForm();
        });
      },
      error: (err) => {
        //console.error(err);
        const error = getApiError(err);
        const errorMessage = error?.message || 'Failed to onboard agency.';
        this.showToast('error', errorMessage);
        this.cdr.detectChanges();
      },
    });
  }

  clearAgencyForm() {
    if (!this.isAgencyManage && this.IsAgencyEditClose) {
      this.performReset();

      var editAgency = this.filteredAgenciesWithAgents.find(
        (f) => f.agency_id === this.selectedAgency.agency_id
      );

      this.openAgencyModal(editAgency);
      this.IsAgencyEditClose = false;
      this.isAgencyManage = true;
	  this.resetZoom('popup');
    } else {
      this.performReset();
      this.isAgencyManage = true;
      this.masterSelected = false;
      this.othersSelected = true;
      this.fetchAgenciesWithAgents();
      // this.setActiveAgencyTab(0);
    }
    this.cdr.detectChanges();
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

  resetFormOld() {
    this.formData = {
      agency_name: '',
      agency_type: '',
      agency_desc: '',
      avatar: '',
      provider_id: '12345',
      provider_name: 'Example Provider',
    };
    this.agencyOnNode = null;
    this.compositionAgents = [];
    this.cdr.detectChanges();

    // Optional: Reset file input (if needed)
    const fileInput =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput) {
      fileInput.value = '';
    }
  }

  resetForm() {
    if (!this.isFormValid()) {
      this.agencyNameField.control.markAsTouched();
      this.agencyTypeField.control.markAsTouched();
      this.teamField.control.markAsTouched();
      this.descriptionField.control.markAsTouched();
      return;
    }
    this.performReset();
  }

  performReset() {
    // Clear model
    this.formData = {
      agency_name: '',
      agency_type: null, // temporary null
      team: null, // temporary null
      agency_desc: '',
      avatar: '',
      provider_id: '12345',
      provider_name: 'Example Provider',
    };

    this.agencyOnNode = null;
    this.compositionAgents = [];
    this.isAgentCompositionValid = false;

    // Reset input states
    this.agencyNameField?.reset();
    this.agencyTypeField?.reset();
    this.teamField?.reset();
    this.descriptionField?.reset();

    // Optional: Reset file input
    const fileInput =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput) {
      fileInput.value = '';
    }

    // ✅ Delay final reset to force select UI refresh
    setTimeout(() => {
      this.formData.agency_type = '';
      this.formData.team = '';
      this.cdr.detectChanges(); // manually re-render UI
    });
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

fetchAgencyStatistics(): void {
  this._apiService.getAgencyStatistics().subscribe({
    next: (res) => {
      if (res.success && res.data) {
        const statsData = res.data as any;

        this.agenciesByTeam = statsData.agencies_by_team || {};
        this.agentMapping = statsData.agent_mapping || {};
        this.totalAgencies = statsData.total_agencies || 0;
        this.totalAgentsMapped = statsData.total_agents_mapped || 0;

        // Update charts after stats are loaded
        if (this.chartsInitialized) {
          this.updateTeamChartFromStats();
          this.updateAgencyNameChartWithFilteredData();
        } else {
          // If charts aren't initialized yet, mark for pending update
          this.pendingChartUpdate = true;
        }
      }
    },
    error: (err) => console.error('Error fetching agency statistics:', err),
  });
}


updateTeamChartFromStats(): void {
  const teamCounts = this.agenciesByTeam; // This will now work
  this.agencyChartLabels = Object.keys(teamCounts);
  this.agencyChartData = Object.values(teamCounts).map(v => Number(v) || 0);
  // We still use the filtered list's length for the center count to keep it dynamic
  this.agencyStats.totalAgencies = this.filteredAgenciesWithAgents.length;

  const colors = ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#fb8c00', '#f57c00'];
  this.agencyLegendData = this.agencyChartLabels.map((label, idx) => ({
    label,
    count: this.agencyChartData[idx] || 0,
    color: colors[idx % colors.length],
  }));

  if (this.agencyDonutChart) {
    this.agencyDonutChart.data.labels = this.agencyChartLabels;
    this.agencyDonutChart.data.datasets[0].data = this.agencyChartData;
    this.agencyDonutChart.data.datasets[0].backgroundColor = this.agencyChartLabels.map((_, i) => colors[i % colors.length]);
    this.agencyDonutChart.update();
  }
}


updateAgencyNameChartWithFilteredData(): void {
  const colors = ['#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726', '#ff9800', '#fb8c00', '#f57c00'];

  if (this.activeAgencyNameFilter) {
    this.agencyNameChartLabels = [this.activeAgencyNameFilter];
    
    const count = this.agentMapping[this.activeAgencyNameFilter] || 0;
    this.agencyNameChartData = [count];
    
    this.agencyNameStats.totalAgents = count;
    
    this.agencyNameLegendData = [{
      label: this.activeAgencyNameFilter,
      count: count,
      color: colors[0]
    }];
  } else {
    this.agencyNameChartLabels = Object.keys(this.agentMapping);
    this.agencyNameChartData = Object.values(this.agentMapping).map(v => Number(v) || 0);
    this.agencyNameStats.totalAgents = this.totalAgentsMapped;
    
    this.agencyNameLegendData = this.agencyNameChartLabels.map((label, idx) => ({
      label,
      count: this.agencyNameChartData[idx] || 0,
      color: colors[idx % colors.length],
    }));
  }

  if (this.agencyNameDonutChartInstance) {
    this.agencyNameDonutChartInstance.data.labels = this.agencyNameChartLabels;
    this.agencyNameDonutChartInstance.data.datasets[0].data = this.agencyNameChartData;
    this.agencyNameDonutChartInstance.data.datasets[0].backgroundColor = this.agencyNameLegendData.map(item => item.color);
    this.agencyNameDonutChartInstance.update();
  }
}
toggleAgencyNameFilter(agencyName: string): void {
  this.activeTeamFilter = null;

  if (this.activeAgencyNameFilter === agencyName) {
    this.activeAgencyNameFilter = null;
    this.filteredAgenciesWithAgents = [...this.agenciesWithAgents];
  } else {
    this.activeAgencyNameFilter = agencyName;
    this.applyAgencyNameFilter();
  }

  if (this.agencySearchTerm) {
    this.filterAgenciesBySearchTerm();
  } else {
    this.updateChartWithFilteredData(); 
    this.updateAgencyNameChartWithFilteredData();
  }

  this.cdr.detectChanges();
}
applyAgencyNameFilter(): void { 
  if (!this.activeAgencyNameFilter) {
    this.filteredAgenciesWithAgents = [...this.agenciesWithAgents];
    return;
  }

  this.filteredAgenciesWithAgents = this.agenciesWithAgents.filter((agency: any) =>
    agency.agency_name?.toString().toLowerCase().trim() === this.activeAgencyNameFilter?.toString().toLowerCase().trim()
  );
}
  openModal(messageId: string, Usermessage: string) {
    this.showModal = true;
    this.Usermessage = Usermessage;
    this.cdr.detectChanges();
    if (this.loadalert && this.loadalert.nativeElement) {
      const modalElement1 = this.loadalert.nativeElement;
      $(modalElement1).modal('hide');
    }
  }
  closeModal() {
    this.showModal = false;
    this.message = '';
  }

  closealert(): void {
    this.showModal = false;
    this.message = '';
    this.popupTitle = '';

    setTimeout(() => {
      if (this.loadagencyPopup && this.loadagencyPopup.nativeElement) {
        const modalElement = this.loadagencyPopup.nativeElement;
        $(modalElement).modal('hide');
      }
    }, 1000);

    if (this.loadalert && this.loadalert.nativeElement) {
      const modalElement1 = this.loadalert.nativeElement;
      $(modalElement1).modal('hide');
    }
  }

  openAgencyModalOld(agency: any): void {
    const nodeWidth = 80; // or whatever width your node element is
    const nodeHeight = 80; // adjust based on your actual node height

    this.selectedAgency = agency;
    this.compositionAgents = [];
    this.agentCounter = 0;

    if (agency?.agents?.length) {
      for (const agent of agency.agents) {
        //this.addToCompositionView(agent);
      }

      this.compositionAgents = this.compositionAgents.map((agent) => ({
        ...agent,
        x1: this.agencyNode.x + nodeWidth / 2,
        y1: this.agencyNode.y + nodeHeight / 2,
        x2: agent.x + nodeWidth / 2,
        y2: agent.y + nodeHeight / 2,
      }));
    }

    const modal = new bootstrap.Modal(document.getElementById('agency-pop')!);
    modal.show();
    this.cdr.detectChanges();
  }

  openAgencyModalNew(agency: any): void {
    this.selectedAgency = agency;
    this.compositionAgents = [];
    this.agentCounter = 0;

    // Add the parent node (agencyViewNode) into compositionAgents
    this.compositionAgents.push({
      nodeId: this.agencyViewNode.nodeId, // must match the id used in template
      x: this.agencyViewNode.x,
      y: this.agencyViewNode.y,
      width: this.agencyViewNode.width,
      height: this.agencyViewNode.height,
      parentId: undefined, // root has no parent
      name: this.selectedAgency?.agency_name || '',
      role_name: '',
    });

    const agents: Agent[] = agency?.agents ?? [];

    // Separate agents by order_number to represent hierarchy levels
    const agentsLv1 = agents.filter((a) => a.order_number === 1);
    const agentsLv2 = agents.filter((a) => a.order_number === 2);

    const level1Nodes: Agent[] = [];

    if (agentsLv1.length > 0) {
      // Step 1: Layout first-level agents horizontally under the parent node
      for (let i = 0; i < agentsLv1.length; i++) {
        const agent = agentsLv1[i];
        const x = this.agencyViewNode.x + i * 240; // spacing horizontally
        const y = this.agencyViewNode.y + this.agencyViewNode.height + 50; // vertical offset below parent
        const nodeId = 'node' + ++this.agentCounter;

        const newAgent = {
          ...agent,
          nodeId,
          parentId: this.agencyViewNode.nodeId, // parent is root node
          x,
          y,
          width: 200,
          height: 80,
        };

        this.compositionAgents.push(newAgent);
        level1Nodes.push(newAgent);
      }

      // Step 2: Group second-level agents by their parent (level 1 nodes)
      const groupedLv2 = new Map<string, Agent[]>();

      agentsLv2.forEach((agent, index) => {
        const parentIndex = index % level1Nodes.length;
        const parent = level1Nodes[parentIndex];
        if (!groupedLv2.has(parent.nodeId!)) {
          groupedLv2.set(parent.nodeId!, []);
        }
        groupedLv2.get(parent.nodeId!)!.push(agent);
      });

      // Step 3: Layout second-level agents under their respective parents
      groupedLv2.forEach((children, parentNodeId) => {
        const parent = this.compositionAgents.find(
          (a) => a.nodeId === parentNodeId
        );
        if (!parent || parent.x === undefined || parent.y === undefined) return;

        const totalWidth = children.length * 220; // spacing for children
        const startX = parent.x - totalWidth / 2 + 110; // center children under parent

        children.forEach((child, i) => {
          const x = startX + i * 220;
          const y = parent.y! + parent.height! + 50;
          const nodeId = 'node' + ++this.agentCounter;

          this.compositionAgents.push({
            ...child,
            nodeId,
            parentId: parent.nodeId,
            x,
            y,
            width: 200,
            height: 80,
          });
        });
      });
    } else {
      // No first-level agents, map all second-level agents directly under the parent node
      const totalWidth = agentsLv2.length * 220;
      const startX = this.agencyViewNode.x - totalWidth / 2 + 110;
      const y = this.agencyViewNode.y + this.agencyViewNode.height + 50;

      agentsLv2.forEach((agent, index) => {
        const x = startX + index * 220;
        const nodeId = 'node' + ++this.agentCounter;

        this.compositionAgents.push({
          ...agent,
          nodeId,
          parentId: this.agencyViewNode.nodeId,
          x,
          y,
          width: 200,
          height: 80,
        });
      });
    }

    // Step 4: Wait for DOM to render nodes, then calculate SVG connection line coordinates
    setTimeout(() => {
      const containerEl = document.querySelector(
        '.agent-composition'
      ) as HTMLElement;
      if (!containerEl) {
        //console.warn('Container element .agent-composition not found');
        return;
      }

      this.compositionAgents.forEach((agent) => {
        if (!agent.parentId) return; // skip root node (no parent to connect to)

        const parentEl = document.getElementById(agent.parentId);
        const childEl = document.getElementById(agent.nodeId);

        if (parentEl && childEl) {
          const containerRect = containerEl.getBoundingClientRect();
          const parentRect = parentEl.getBoundingClientRect();
          const childRect = childEl.getBoundingClientRect();

          agent.x1 =
            parentRect.left + parentRect.width / 2 - containerRect.left;
          agent.y1 = parentRect.top + parentRect.height - containerRect.top;
          agent.x2 = childRect.left + childRect.width / 2 - containerRect.left;
          agent.y2 = childRect.top - containerRect.top;
        }
      });

      // Trigger Angular to update template including SVG lines
      this.cdr.detectChanges();
    }, 300); // Adjust delay as needed depending on rendering speed

    //console.log('Composition Agents:', this.compositionAgents);

    // Step 5: Show the modal (Bootstrap Modal assumed)
    const modal = new bootstrap.Modal(document.getElementById('agency-pop')!);
    modal.show();

    this.cdr.detectChanges();
  }

  openAgencyModal(agency: any): void {
	this.resetZoom('popup');
    this.selectedAgency = agency;
    this.compositionAgents = [];
    this.agentCounter = 0;

    const NODE_WIDTH = 200;
    const NODE_HEIGHT = 80;
    const H_GAP = 40;      // space between sibling nodes
    const V_GAP = 70;      // space between levels
    const SAFE_LEFT = 20;  // prevent negative x

    this.compositionAgents.push({
      nodeId: this.agencyViewNode.nodeId,
      x: Math.max(SAFE_LEFT, this.agencyViewNode.x),
      y: this.agencyViewNode.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      parentId: undefined,
      name: this.selectedAgency?.agency_name || '',
      role_name: '',
    });

    const agents: Agent[] = agency?.agents ?? [];
    const agentsLv1 = agents.filter((a) => a.order_number === 1);
    const agentsLv2 = agents.filter((a) => a.order_number === 2);

    const rootNode = this.compositionAgents[0];
    const level1Nodes: any[] = [];

    if (agentsLv1.length > 0) {
      const level1TotalWidth =
        agentsLv1.length * NODE_WIDTH + (agentsLv1.length - 1) * H_GAP;

      const level1StartX = Math.max(
        SAFE_LEFT,
        rootNode.x + rootNode.width / 2 - level1TotalWidth / 2
      );

      for (let i = 0; i < agentsLv1.length; i++) {
        const agent = agentsLv1[i];
        const x = level1StartX + i * (NODE_WIDTH + H_GAP);
        const y = rootNode.y + NODE_HEIGHT + V_GAP;
        const nodeId = 'node' + ++this.agentCounter;

        const newAgent = {
          ...agent,
          nodeId,
          parentId: rootNode.nodeId,
          x,
          y,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        };

        this.compositionAgents.push(newAgent);
        level1Nodes.push(newAgent);
      }

      const groupedLv2 = new Map<string, Agent[]>();

      agentsLv2.forEach((agent, index) => {
        const parentIndex = index % level1Nodes.length;
        const parent = level1Nodes[parentIndex];

        if (!groupedLv2.has(parent.nodeId)) {
          groupedLv2.set(parent.nodeId, []);
        }

        groupedLv2.get(parent.nodeId)!.push(agent);
      });

      groupedLv2.forEach((children, parentNodeId) => {
        const parent = this.compositionAgents.find(a => a.nodeId === parentNodeId);
        if (!parent) return;

        const childrenTotalWidth =
          children.length * NODE_WIDTH + (children.length - 1) * H_GAP;

        let startX = parent.x + parent.width / 2 - childrenTotalWidth / 2;

        // force positive x
        startX = Math.max(SAFE_LEFT, startX);

        children.forEach((child, i) => {
          const x = startX + i * (NODE_WIDTH + H_GAP);
          const y = parent.y + NODE_HEIGHT + V_GAP;
          const nodeId = 'node' + ++this.agentCounter;

          this.compositionAgents.push({
            ...child,
            nodeId,
            parentId: parent.nodeId,
            x,
            y,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
          });
        });
      });
    } else {
      const totalWidth =
        agentsLv2.length * NODE_WIDTH + (agentsLv2.length - 1) * H_GAP;

      const startX = Math.max(
        SAFE_LEFT,
        rootNode.x + rootNode.width / 2 - totalWidth / 2
      );

      const y = rootNode.y + NODE_HEIGHT + V_GAP;

      agentsLv2.forEach((agent, index) => {
        const x = startX + index * (NODE_WIDTH + H_GAP);
        const nodeId = 'node' + ++this.agentCounter;

        this.compositionAgents.push({
          ...agent,
          nodeId,
          parentId: rootNode.nodeId,
          x,
          y,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        });
      });
    }

  setTimeout(() => {
    this.updateConnectionLines();
  }, 200);
  
  const modal = new bootstrap.Modal(document.getElementById('agency-pop')!);
    modal.show();
    this.cdr.detectChanges();
  }

updateConnectionLines(): void {
  const containerEl = document.querySelector('.agent-composition') as HTMLElement;
    if (!containerEl) return;

    this.compositionAgents.forEach((agent) => {
      if (!agent.parentId) return;

      const parentEl = document.getElementById(agent.parentId);
      const childEl = document.getElementById(agent.nodeId);

      if (!parentEl || !childEl) return;

      const containerRect = containerEl.getBoundingClientRect();
      const parentRect = parentEl.getBoundingClientRect();
      const childRect = childEl.getBoundingClientRect();

      agent.x1 = parentRect.left + parentRect.width / 2 - containerRect.left;
      agent.y1 = parentRect.top + parentRect.height - containerRect.top;
      agent.x2 = childRect.left + childRect.width / 2 - containerRect.left;
      agent.y2 = childRect.top - containerRect.top;
    });

    this.cdr.detectChanges();
}

  getAgentTypeGroups(): string[] {
    if (!this.selectedAgency?.agents) return [];
    return Object.keys(this.getAgentsGroupedByType(this.selectedAgency.agents));
  }
  getAgentsGroupedByType(agents: any[]): { [key: string]: any[] } {
    const grouped: { [key: string]: any[] } = {};
    for (const agent of agents) {
      const type = agent.agent_type_name || 'Unknown';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(agent);
    }
    return grouped;
  }

  toggleFullscreen() {
    const elem = this.zoomContainerRef.nativeElement;
    if (!document.fullscreenElement) {
      elem.requestFullscreen().then(() => {
        this.cdr.detectChanges();
      });
    } else {
      document.exitFullscreen().then(() => {
        this.cdr.detectChanges();
      });
    }
  }  
  
	zoomIn(via:string): void {
	  this.zoomScale = Math.min(this.zoomScale + 0.1, 2);
	  this.applyZoom(via);
	}

	zoomOut(via:string): void {
	  this.zoomScale = Math.max(this.zoomScale - 0.1, 0.1);
	  this.applyZoom(via);
	}

	applyZoom(via:string): void {
	  let composition: HTMLElement | null = null;

	  if (via === 'page') {
		composition = document.querySelector('.composition-container') as HTMLElement;
	  } else if (via === 'popup') {
		composition = document.querySelector('.agent-composition-wrapper') as HTMLElement;
	  }

	  if (!composition) return;

	  composition.style.transform = `scale(${this.zoomScale})`;
	  composition.style.transformOrigin = 'top left';
	}
	
  resetZoom(via: string): void {
    this.zoomScale = 1;

    let composition: HTMLElement | null = null;

    if (via === 'page') {
      composition = document.querySelector('.composition-container') as HTMLElement;
    } else if (via === 'popup') {
      composition = document.querySelector('.agent-composition-wrapper') as HTMLElement;
    }

    if (!composition) return;

    composition.style.transform = 'scale(1)';
    composition.style.transformOrigin = 'top left';
    this.cdr.detectChanges();
  }
	

  deleteAngencyDetail(): void {
    var agencyId = this.selectedAgency.agency_id;
    var agencyName = this.selectedAgency.agency_name;
    this._apiService.deleteAgencyDetails(agencyId).subscribe({
      next: (res: any) => {
        const success = res?.success ?? res?.Success ?? false;
        const message = res?.message ?? res?.Message ?? `Agency ${agencyName} details deleted successfully`;

        if (success) {
          if (this.loadalert && this.loadalert.nativeElement) {
            const modalElement = this.loadalert.nativeElement;
            $(modalElement).modal('show');
          }
          this.popupTitle = 'Agency Delete!';
          this.openModal('exampleModalLabel1', message);
        } else {
          this.showToast('error', message || 'Failed to delete agency.');
        }
        this.cdr.detectChanges(); // manually trigger change detection
        this.fetchAgenciesWithAgents();
      },
      error: (err: any) => {
        //console.error(err);
        const errorMessage = err?.error?.Message || 'Failed to delete agency.';
        this.showToast('error', errorMessage);
        this.cdr.detectChanges();
      },
    });
  }

  editAngencyDetail(): void {
	this.resetCardState();
    this.loadAgents();
    this.loadAgencytype();
    this.isAgencyManage = false;
    this.IsAgencyEditClose = true;
    this.AgncyPopupTitle = 'Edit Agency';
    var val = this.selectedAgency;

    this.formData = {
      agency_name: val.agency_name,
      agency_type: val.agency_type,
      agency_desc: val.agency_desc,
      avatar: val.avatar,
      provider_id: val.provider_id,
      provider_name: val.provider_name,
      team: val.assigned_to,
    };

    const hasMaster = this.compositionAgents.some(
      (a) => a.agent_type_id === 'MASTER'
    );
    const hasTask = this.compositionAgents.some(
      (a) => a.agent_type_id !== 'MASTER'
    );
    this.isAgentCompositionValid = hasMaster && hasTask;

    if (hasMaster) {
      this.masterSelected = true;
      this.othersSelected = false;
    }
    this.cdr.detectChanges();

    // If these are simple variables containing the values (string, etc.)
    this.isFormValid();

    this.closeAgnecyViewPopup();
	this.resetZoom('page');
    this.cdr.detectChanges();
  }

  closeAgnecyViewPopup(): void {
    if (!this.IsAgencyEditClose) {
      this.clearAgencyForm();
      this.AgncyPopupTitle = 'Onboard New Agency';
    }
    if (this.loadagencyPopup && this.loadagencyPopup.nativeElement) {
      const modalElement = this.loadagencyPopup.nativeElement;
      $(modalElement).modal('hide');
    }
  }

  getNodeStyleOld(agent: any): { [key: string]: string } {
    const baseWidth = 200;
    const baseHeight = 80;

    const nameLength = agent.name?.length || 0;
    const roleLength = agent.role_name?.length || 0;

    // Adjust width/height if content is long
    const width =
      nameLength > 18 || roleLength > 20 ? baseWidth + 50 : baseWidth;
    const height =
      nameLength > 18 || roleLength > 20 ? baseHeight + 20 : baseHeight;

    return {
      position: 'absolute',
      width: `${width}px`,
      height: `${height}px`,
    };
  }
  
   getNodeStyle(agent: any): { [key: string]: string } {
    return {
      position: 'absolute',
      width: `${agent.width || 200}px`,
      height: `${agent.height || 80}px`
    };
  }

  toggleCard(cardType: TCard) {
    this.cardState[cardType].open = !this.cardState[cardType].open;
  }
  
  getDefaultCardState(): { [key in TCard]: { open: boolean } } {
  return {
    basicDetails: { open: true },
    nodes: { open: true },
    agentComposition: { open: true },
  };
}

  resetCardState() {
    this.cardState = this.getDefaultCardState();
  }

  confirmDeleteAgency(agency: any): void {
    this.agentToDelete = agency; // store selected agency
    const modalElement = document.getElementById('deleteConfirmModal');
    if (modalElement) {
      // show modal using Bootstrap
      (window as any).$(modalElement).modal('show');
    }
  }

  deleteAgencyConfirmed(): void {
    if (!this.agentToDelete) return;
    const agencyId = this.agentToDelete.agency_id;
    const agencyName = this.agentToDelete.agency_name;

    this._apiService.deleteAgencyDetails(agencyId).subscribe({
      next: (res: any) => {
        
		 // Hide confirmation modal
        const confirmModal = document.getElementById('deleteConfirmModal');
        if (confirmModal) {
          (window as any).$(confirmModal).modal('hide');
        }

        const success = res?.success ?? res?.Success ?? false;
        const message = res?.message ?? res?.Message ?? `Agency ${agencyName} details deleted successfully`;

        if (!success) {
          this.showToast('error', message || 'Failed to delete agency.');
        } else {
          if (this.loadalert && this.loadalert.nativeElement) {
            const modalElement = this.loadalert.nativeElement;
            (window as any).$(modalElement).modal('show');
          }

          this.popupTitle = 'Agency Delete!';
          this.openModal('exampleModalLabel1', message);
        }
		
        this.cdr.detectChanges();
        this.fetchAgenciesWithAgents();
      },
      error: (err: any) => {
        const errorMessage = err?.error?.Message || 'Failed to delete agency.';
        this.showToast('error', errorMessage);
        this.cdr.detectChanges();
      },
    });
  }
}
interface Agent {
  id: string;
  name: string;
  role_name: string;
  order_number: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  nodeId?: string;
  parentId?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

interface AgentOn {
  agent_id: string;
  name: string;
  role_name?: string;
  order_number: number; // hierarchy level: 1 or 2
  parent_agent_id?: string; // optionally links second-level agents to first level
  isPremium?: boolean;
  agent_type_id?: string;
  // UI properties added dynamically:
  nodeId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parentId?: string;
  x1?: number; // connection line start x
  y1?: number; // connection line start y
  x2?: number; // connection line end x
  y2?: number; // connection line end y
}
