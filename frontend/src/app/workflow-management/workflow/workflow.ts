import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
  FormsModule,
  FormControl,
} from '@angular/forms';
import { NgxSpinnerService } from 'ngx-spinner';
import { WorkflowService } from '../../services/workflow.service';
import { IWorkflow } from '../../types';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormError } from '../../components/form-error/form-error';
import { Toast } from '../../components/toast/toast';
import { ToastService } from '../../services/toast.service';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { TOption, Select } from '../../components/select/select';
import { environment as config } from '../../../environments/environment';
import { RolePrivilegeMappingService } from '../../services/role-privilege-mapping.service';
import { Chart } from 'chart.js';
import { forkJoin } from 'rxjs';

interface IImortWorkflowForm {
  apiKey: FormControl<string>;
  workflowId: FormControl<string>;
}

interface IFilterForm {
  agency: FormControl<string>;
  team: FormControl<string>;
}

declare var bootstrap: any;
declare var $: any;

@Component({
  selector: 'app-workflow',
  imports: [
    ReactiveFormsModule,
    RouterModule,
    CommonModule,
    FormsModule,
    FormError,
    Toast,
    Select,
  ],
  templateUrl: './workflow.html',
  styleUrl: './workflow.css',
})
export class Workflow implements AfterViewInit {
  private loadingService = inject(NgxSpinnerService);
  private formBuilder = inject(FormBuilder);
  private workflowService = inject(WorkflowService);
  toast = inject(ToastService);

  importWorkflowForm: FormGroup<IImortWorkflowForm>;
  filterForm: FormGroup;
  agencyOptions: TOption[] = [];
  teamsOptions: TOption[] = [];
  @ViewChild('importWorkflow') importWorkflowModal!: ElementRef;

  // importModalInstance?: Modal;

  @ViewChild('workflowfilter')
  workflowfilterModal!: ElementRef<HTMLDivElement>;
  // workflowfilterModalInstance?: Modal;

  items = signal<IWorkflow[]>([]);
  filteredItems = signal<IWorkflow[]>([]);
  filterAgency?: string;
  filterTeam?: string;
  isSubmitted = signal(false);
  searchTerm: string = '';
  isRefreshing: boolean = false;
  refreshingWorkflowId: string | null = null;
  isRefresh: boolean = false;
  isPrivilegeView: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeRefresh: boolean = false;
  isPrivilegeExecute: boolean = false;
  masterDatabase = config.masterDatabase;
  workflowToDelete:any = null;
  deleteModal: any;
  activeTabKey: string = 'all_workflows';
  tabFilterValues: { [key: string]: any } = {
    all_workflows: null,
    external_workflows: null,
    internal_workflows: null,
  };
  tabSearchTerms: { [key: string]: string } = {
    all_workflows: '',
    external_workflows: '',
    internal_workflows: '',
  };
  workflowCountsList = [
    { key: 'all_workflows', label: 'All Workflows', count: 0, active: true },
    { key: 'external_workflows', label: 'Base Workflows', count: 0, active: false },
    { key: 'internal_workflows', label: 'Advanced Workflows', count: 0, active: false },
  ];
  agencyLegendData: any[] = [];
  workflowTypeData: any[] = [];
  totalWorkflowsInAgencyChart: number = 0;
  agencyChart: Chart | null = null;
  workflowTypeChart: Chart | null = null;
  isSideCollapsed = true;
  isRightCollapsed = false;
  workflowStatistics: any = null;
  statisticsLoaded = false;
  activeFilters: {workflowType?: string;agency?: string;} = {};
  @ViewChild('agencyCanvas') agencyCanvas!: ElementRef;
  @ViewChild('workflowTypeCanvas') workflowTypeCanvas!: ElementRef;
  chartsInitialized = false;
  tabIndex: number = 0;

  constructor(
    private cdRef: ChangeDetectorRef,
    private _rolePrivilegeService: RolePrivilegeMappingService,
    private _stateService: AIInfuseStateService
  ) {
    this.importWorkflowForm = this.formBuilder.group<IImortWorkflowForm>({
      apiKey: this.formBuilder.control('', {
        nonNullable: true,
        validators: Validators.required,
      }),
      workflowId: this.formBuilder.control('', {
        nonNullable: true,
        validators: Validators.required,
      }),
    });

    this.filterForm = this.formBuilder.group<IFilterForm>({
      agency: this.formBuilder.control('', {
        nonNullable: true,
      }),
      team: this.formBuilder.control('', {
        nonNullable: true,
      }),
    });
  }

  ngOnInit() {
    this.fetchWorkflows();
      this.loadPrivileges();
    //Subscribe to privilege updates
    // this._rolePrivilegeService.privilegeData$.subscribe((allPrivileges) => {
    //   this.rolePrivilegMapping(allPrivileges);
    // });
  }

ngAfterViewInit(): void {
  this.deleteModal = new bootstrap.Modal(
    document.getElementById('deleteConfirmModalWF')
  );
    this.initializeCharts();
    this.cdRef.detectChanges();
}

    //#region Privilege Management
  loadPrivileges() {
    this._stateService.getPrivilegesByPage('Workflow Management').subscribe({
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

  //  rolePrivilegMapping(allPrivileges: any) {
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
  //   this.isPrivilegeRefresh=false;

  //   // Super Admin special case
  //   if (roleName.toLowerCase() === 'super admin'.toLowerCase()) {
  //     const activeProject = loggedUser?.ActiveProject?.toLowerCase() || '';
  //     if (activeProject === this.masterDatabase.toLowerCase()) {
  //       this.isPrivilegeView = true;
  //       this.isPrivilegeEdit = true;
  //       this.isPrivilegeDelete = true;
  //       this.isPrivilegeRefresh=true;
  //     } else {
  //       this.isPrivilegeView = true;
  //       this.isPrivilegeEdit = false;
  //       this.isPrivilegeDelete = false;
  //       this.isPrivilegeRefresh=false;
  //     }

  //     this.importWorkflowForm[
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
  //     const pagePerms = privMap.permissions['Workflow Management'] || {};
  //     this.isPrivilegeView = !!pagePerms.view;
  //     this.isPrivilegeEdit = !!pagePerms['insert / edit'] || !!pagePerms.edit;
  //     this.isPrivilegeDelete = !!pagePerms.delete;
  //     this.isPrivilegeRefresh= !!pagePerms.refresh;
  //     console.log('Mapped Permissions =>', {
  //       View: this.isPrivilegeView,
  //       Edit: this.isPrivilegeEdit,
  //       Delete: this.isPrivilegeDelete,
  //       Refresh: this.isPrivilegeRefresh,
  //     });
  //   } else {
  //     console.warn(
  //       `Privileges not found for ProjectId: ${projectId}, TeamId: ${teamId}, RoleId: ${roleId}`
  //     );
  //     this.isPrivilegeView = true;
  //   }

  //   this.importWorkflowForm[
  //     this.isPrivilegeView && !this.isPrivilegeEdit ? 'disable' : 'enable'
  //   ]({ emitEvent: false });
  //   this.cdRef.detectChanges();
  // }
  //#endregion

  ngOnDestroy() {
    this.workflowfilterModal?.nativeElement?.removeEventListener(
      'hidden.bs.modal',
      this.closeImportWorkflowModal
    );
  }


Onrefresh(event: MouseEvent, item: IWorkflow) {
  // Prevent the click event from bubbling up to the parent element
  event.stopPropagation();
  
  console.log('Refreshing workflow:', item.flow_id);
  console.log('Full item object:', item);
  console.log('Refreshing agency:', item.agency_name);

  if (!this.isPrivilegeRefresh) {
    return;
  }
  
  this.refreshingWorkflowId = item.flow_id;
  this.isRefreshing = true;
  
  this.workflowService.importWorkflow({
    api_key: item.api_key || '', 
    workflow_id: item.flow_id,
    agency_name: item.agency_name || '', // Add agency name to payload
    isRefresh: true, 
  }).subscribe({
    next: (res: any) => {
      console.log('Refresh response:', res);
      
      this.isRefreshing = false;
      this.refreshingWorkflowId = null;
      
      if (res.success) {
        // Simply refetch all workflows to ensure we have the latest data
        this.fetchWorkflows();
        this.toast.showToast('success', 'Workflow refreshed successfully');
      } else {
        console.log('Refresh failed:', res);
        this.toast.showToast('error', res?.message || res?.error || 'Failed to refresh workflow');
      }
    },
    error: (err) => {
      console.error('Refresh error:', err);
      
      this.isRefreshing = false;
      this.refreshingWorkflowId = null;
      
      // Better error handling to get the actual error message
      let errorMessage = 'Something went wrong while refreshing';
      if (err?.error?.error) {
        errorMessage = err.error.error;
      } else if (err?.error?.message) {
        errorMessage = err.error.message;
      } else if (err?.message) {
        errorMessage = err.message;
      }
      
      this.toast.showToast('error', errorMessage);
    },
  });
}

private updateWorkflowInList(workflowId: string, updatedData: any) {
  const currentItems = this.items();
  const updatedItems = currentItems.map(item => {
    if (item.flow_id === workflowId) {
      // Create a new object with updated data, preserving name and description
      return {
        ...item,
        ...updatedData,
        flow_name: item.flow_name,
        flow_description: item.flow_description, 
      };
    }
    return item;
  });
  
  this.items.set(updatedItems);
  this.filteredItems.set([...updatedItems]);
}

  get isMasterSubscription(): boolean {
    const projectName = this._stateService.getLoginDetails()?.ActiveProject;

    return (
      config.masterDatabase?.trim().toLowerCase() ===
      projectName?.trim().toLowerCase()
    );
  }

  openImportWorkflowModal() {
    const modal = new bootstrap.Modal(
      document.getElementById('import-workflow-modal')!
    );
    modal.show();
  }
  closeImportWorkflowModal() {
    this.importWorkflowForm?.reset();

    // Get the modal element
    const modalElement = document.getElementById('import-workflow-modal');

    if (modalElement) {
      // Use the native Bootstrap modal API
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) {
        modal.hide();
      } else {
        // If modal instance doesn't exist, create it and hide
        const newModal = new bootstrap.Modal(modalElement);
        newModal.hide();
      }
    }
  }
  openWorkflowFilterModal() {
    this.filterForm.patchValue({
      agency: this.filterAgency,
      team: this.filterTeam,
    });
    new bootstrap.Modal(document.getElementById('workflowfilter')!).show();
  }
  clearWorkflowFilterModal() {
    const el = document.getElementById('workflowfilter');
    bootstrap.Modal.getInstance(el)?.hide();
    this.filterForm.reset();
    this.filterAgency = undefined;
    this.filterTeam = undefined;
    this.applySearch();
  }

  onImportWorkflowFormSubmit() {
    this.isSubmitted.update(() => true);
    if (this.importWorkflowForm.invalid) return;

    this.loadingService.show();
    this.workflowService
      .importWorkflow({
        api_key: this.importWorkflowForm.value.apiKey || '',
        workflow_id: this.importWorkflowForm.value.workflowId || '',
        isRefresh: false,
      })
      .subscribe({
        next: (res: any) => {
          this.loadingService.hide();
          this.fetchWorkflows();
          this.toast.showToast(
            'success',
            res?.message || res?.error || 'Workflow imported successfully'
          );
          this.closeImportWorkflowModal();
        },
        error: (err) => {
          this.toast.showToast(
            'error',
            err?.error?.error || 'Workflow already exists'
          );
          this.closeImportWorkflowModal();
          this.loadingService.hide();
        },
      });
  }

processStatisticsData(): void {
  if (!this.workflowStatistics) return;
  
  // Update tab counts
  this.workflowCountsList[0].count = this.workflowStatistics.total_workflows || 0;
  this.workflowCountsList[1].count = this.workflowStatistics.workflow_type_count?.External || 0;
  this.workflowCountsList[2].count = this.workflowStatistics.workflow_type_count?.Custom || 0;
  
  // Define the same color scheme for both charts
  const colors = [
    '#ffe0b2',
    '#ffcc80',
    '#ffb74d',
    '#ffa726',
    '#ff9800',
    '#fb8c00',
    '#f57c00',
  ];
  
  // Process agency data
  const agencyData = this.workflowStatistics.workflows_per_agency || {};
  this.agencyLegendData = Object.keys(agencyData).map((agency, index) => ({
    label: agency,
    count: agencyData[agency],
    color: colors[index % colors.length]
  }));
  
  // Process workflow type data with the same color scheme
  this.workflowTypeData = [
    { label: 'Base Workflow', count: this.workflowStatistics.workflow_type_count?.External || 0, color: colors[0] },
    { label: 'Advanced Workflow', count: this.workflowStatistics.workflow_type_count?.Custom || 0, color: colors[1] }
  ];
  
  this.totalWorkflowsInAgencyChart = this.workflowStatistics.total_workflows || 0;
  
  // Update charts if they're already initialized
  if (this.chartsInitialized) {
    this.updateCharts();
  }
}

fetchWorkflows() {
  this.loadingService.show();
  
  // Fetch both workflows and statistics in parallel
  forkJoin({
    workflows: this.workflowService.getWorkflows(),
    statistics: this.workflowService.getWorkflowStatistics()
  }).subscribe({
    next: (results) => {
      // Handle workflows data
      if (!results.workflows.success) return;

      let workflows = results.workflows.data || [];
      
      const loggedUser = this._stateService.getLoginDetails();
      const activeProject = loggedUser?.ActiveProject || '';
      const projectDetails = loggedUser?.ProjectDtl || [];
      const mappedProject = projectDetails.find(
        (p: any) => p.prj_name?.toLowerCase() === activeProject?.toLowerCase()
      );
      const mappedTeam = mappedProject?.team_name || '';
      const mappedRole = mappedProject?.role_name?.toLowerCase() || '';

      // Apply project/team filtering if user is not super admin or admin
      if (
        activeProject &&
        activeProject.toLowerCase() !== config.masterDatabase.toLowerCase() &&
        mappedRole !== 'super admin' &&
        mappedRole !== 'admin'
      ) {
        if (mappedTeam) {
          workflows = workflows.filter((workflow) => {
                const teamValue =
                  typeof workflow.team === 'string'
                    ? workflow.team
                    : workflow.team?.["assigned_to"];
 
                return teamValue?.toLowerCase() === mappedTeam.toLowerCase();
              });
        }
      }

      this.items.set(workflows);
      this.filteredItems.set([...workflows]);
      
      // Handle statistics data
      this.workflowStatistics = results.statistics.data || results.statistics;
      this.statisticsLoaded = true;
      
      // Update workflow counts for tabs
      this.updateWorkflowCounts(workflows);
      
      // Process statistics data
      this.processStatisticsData();
      
      this.loadingService.hide();

      // Prepare agency and team options
      const tempTeamOptions: string[] = [];
      const tempAgencyOptions: string[] = [];

      workflows.forEach((workflow) => {
        if (workflow.team && !tempTeamOptions.includes(workflow.team)) {
          tempTeamOptions.push(workflow.team);
        }
        if (
          workflow.agency_name &&
          !tempAgencyOptions.includes(workflow.agency_name)
        ) {
          tempAgencyOptions.push(workflow.agency_name);
        }
      });

      this.agencyOptions = tempAgencyOptions
        .map((label) => ({
          label,
          value: label,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));

	  this.teamsOptions = tempTeamOptions
        .map((item) => {
          const label =
            typeof item === 'string' ? item :
            Array.isArray(item)      ? (item[0] as string ?? '') :
            item && typeof item === 'object' && 'assigned_to' in item
                                    ? (item as any).assigned_to ?? ''
                                    : '';

		return { label, value: label };
	  })
	  .filter(option => option.label !== '')           // optional: remove empty/bad entries
	  .sort((a, b) => a.label.localeCompare(b.label));
			 
		if (!this.chartsInitialized) {
          this.initializeCharts();
        } else {
          this.updateCharts();
        }
		
		this.setActiveCountTab(this.tabIndex);
		
        this.cdRef.detectChanges();
    },
    error: (err) => {
      console.error('Error fetching workflows:', err);
      this.loadingService.hide();
    },
  });
}

createOrUpdateWorkflowTypeChart(): void {
  if (this.workflowTypeChart) {
    this.workflowTypeChart.destroy();
    this.workflowTypeChart = null;
  }
  
  setTimeout(() => {
    const canvas = this.workflowTypeCanvas?.nativeElement;
    if (!canvas || !this.workflowTypeData.length) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set canvas dimensions explicitly
    canvas.width = 150;
    canvas.height = 150;
    
    const labels = this.workflowTypeData.map((item) => item.label);
    const data = this.workflowTypeData.map((item) => item.count);
    const backgroundColors = this.workflowTypeData.map((item) => item.color);
    
    this.workflowTypeChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: backgroundColors,
          borderColor: '#fff',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: { 
            enabled: true,
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.raw || 0;
                const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                const percentage = Math.round((value as number / total) * 100);
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          },
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const type = labels[index];
            
            if (this.activeFilters.workflowType === type) {
              delete this.activeFilters.workflowType;
            } else {
              this.activeFilters.workflowType = type;
              delete this.activeFilters.agency;
            }
            
            this.applyChartFilters();
          }
        }
      },
    });

    this.cdRef.detectChanges();
  }, 300);
}

createOrUpdateAgencyChart(): void {
  if (this.agencyChart) {
    this.agencyChart.destroy();
    this.agencyChart = null;
  }
  
  setTimeout(() => {
    const canvas = this.agencyCanvas?.nativeElement;
    if (!canvas || !this.agencyLegendData.length) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set canvas dimensions explicitly
    canvas.width = 150;
    canvas.height = 150;
    
    const labels = this.agencyLegendData.map((item) => item.label);
    const data = this.agencyLegendData.map((item) => item.count);
    const backgroundColors = this.agencyLegendData.map((item) => item.color);
    
    this.agencyChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: backgroundColors,
          borderColor: '#fff',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: { 
            enabled: true,
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.raw || 0;
                const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                const percentage = Math.round((value as number / total) * 100);
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          },
        },
        onClick: (event, elements) => {
          if (elements.length > 0) {
            const index = elements[0].index;
            const agency = labels[index];
            
            if (this.activeFilters.agency === agency) {
              delete this.activeFilters.agency;
            } else {
              this.activeFilters.agency = agency;
              delete this.activeFilters.workflowType;
            }
            
            this.applyChartFilters();
          }
        }
      },
    });

    this.cdRef.detectChanges();
  }, 300);
}

updateCharts(): void {
  if (!this.chartsInitialized) return;
  
  // Update workflow type chart
  if (this.workflowTypeChart && this.workflowTypeData.length) {
    this.workflowTypeChart.data.labels = this.workflowTypeData.map(item => item.label);
    this.workflowTypeChart.data.datasets[0].data = this.workflowTypeData.map(item => item.count);
    this.workflowTypeChart.data.datasets[0].backgroundColor = this.workflowTypeData.map(item => item.color);
    this.workflowTypeChart.update();
  }
  
  // Update agency chart
  if (this.agencyChart && this.agencyLegendData.length) {
    this.agencyChart.data.labels = this.agencyLegendData.map(item => item.label);
    this.agencyChart.data.datasets[0].data = this.agencyLegendData.map(item => item.count);
    this.agencyChart.data.datasets[0].backgroundColor = this.agencyLegendData.map(item => item.color);
    this.agencyChart.update();
  }
}

initializeCharts(): void {
  if (this.chartsInitialized) return;
  
  // Initialize Agency Chart
  const agencyCtx = this.agencyCanvas?.nativeElement?.getContext('2d');
  if (agencyCtx && this.agencyLegendData.length) {
    this.agencyChart = new Chart(agencyCtx, {
      type: 'doughnut',
      data: {
        labels: this.agencyLegendData.map(item => item.label),
        datasets: [{
          data: this.agencyLegendData.map(item => item.count),
          backgroundColor: this.agencyLegendData.map(item => item.color),
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.raw || 0;
                const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                const percentage = Math.round((value as number / total) * 100);
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }
  
  // Initialize Workflow Type Chart
  const workflowTypeCtx = this.workflowTypeCanvas?.nativeElement?.getContext('2d');
  if (workflowTypeCtx && this.workflowTypeData.length) {
    this.workflowTypeChart = new Chart(workflowTypeCtx, {
      type: 'doughnut',
      data: {
        labels: this.workflowTypeData.map(item => item.label),
        datasets: [{
          data: this.workflowTypeData.map(item => item.count),
          backgroundColor: this.workflowTypeData.map(item => item.color),
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const label = context.label || '';
                const value = context.raw || 0;
                const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                const percentage = Math.round((value as number / total) * 100);
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }
  
  this.chartsInitialized = true;
}

createChartsFromStatistics(): void {
  this.createOrUpdateAgencyChart();
  this.createOrUpdateWorkflowTypeChart();
}

toggleSidePanel(panel: 'left' | 'right') {
    if (panel === 'left') {
      this.isSideCollapsed = !this.isSideCollapsed;
      
      // Recreate charts when panel is expanded to ensure they render properly
      if (!this.isSideCollapsed && this.statisticsLoaded) {
          this.createChartsFromStatistics();
      }
    } else {
      this.isRightCollapsed = !this.isRightCollapsed;
      if (!this.isRightCollapsed) {
        this.isSideCollapsed = true;
      }
    }
    
    this.cdRef.detectChanges();
  }

applyChartFilters(): void {
  let filtered = [...this.items()];
  
  // Apply workflow type filter if set
  if (this.activeFilters.workflowType) {
    filtered = filtered.filter(workflow => {
      if (this.activeFilters.workflowType === 'External') {
        return workflow.IsExternal === true;
      } else if (this.activeFilters.workflowType === 'Custom') {
        return workflow.IsExternal === false;
      }
      return true;
    });
  }
  
  // Apply agency filter if set
  if (this.activeFilters.agency) {
    filtered = filtered.filter(workflow => 
      workflow.agency_name === this.activeFilters.agency
    );
  }
  
  // Apply search term if exists
  if (this.searchTerm) {
    const query = this.searchTerm.trim().toLowerCase();
    filtered = filtered.filter(workflow => 
      workflow.flow_name?.toLowerCase().includes(query)
    );
  }
  
  // Apply form filters if they exist
  if (this.filterAgency) {
    filtered = filtered.filter(workflow => 
      workflow.agency_name === this.filterAgency
    );
  }
  
  if (this.filterTeam) {
    filtered = filtered.filter(workflow => 
      workflow.team === this.filterTeam
    );
  }
  
  // Update the filtered items
  this.filteredItems.set(filtered);
  
  // Update charts with filtered data
  this.updateChartDataWithFilters(filtered);
  
  this.cdRef.detectChanges();
}

updateChartDataWithFilters(filteredWorkflows: IWorkflow[]): void {
  // Prepare agency data from filtered workflows
  const agencyCounts: { [key: string]: number } = {};
  filteredWorkflows.forEach(workflow => {
    if (workflow.agency_name) {
      agencyCounts[workflow.agency_name] = (agencyCounts[workflow.agency_name] || 0) + 1;
    }
  });
  
  const colors = [
    '#ffe0b2',
    '#ffcc80',
    '#ffb74d',
    '#ffa726',
    '#ff9800',
    '#fb8c00',
    '#f57c00',
  ];
  let colorIndex = 0;
  
  // Update agency legend data
  this.agencyLegendData = Object.keys(agencyCounts).map(agency => ({
    label: agency,
    count: agencyCounts[agency],
    color: colors[colorIndex++ % colors.length]
  }));
  
  // Update workflow type data
  const externalCount = filteredWorkflows.filter(w => w.IsExternal).length;
  const internalCount = filteredWorkflows.filter(w => !w.IsExternal).length;
  
  this.workflowTypeData = [
    { label: 'Base Workflow', count: externalCount, color: colors[0] },
    { label: 'Advanced Workflow', count: internalCount, color: colors[1] }
  ];
  
  this.totalWorkflowsInAgencyChart = filteredWorkflows.length;
  
  // Update charts if they're initialized
  if (this.chartsInitialized) {
    this.updateCharts();
  }
}

updateWorkflowCounts(workflows: IWorkflow[]) {
  const allCount = workflows.length;
  const externalCount = workflows.filter(w => w.IsExternal).length;
  const internalCount = workflows.filter(w => !w.IsExternal).length;
  
  this.workflowCountsList[0].count = allCount;
  this.workflowCountsList[1].count = externalCount;
  this.workflowCountsList[2].count = internalCount;
}

  onApplyFilter() {
    if (this.filterForm.invalid) return;

    this.filterAgency = this.filterForm.value.agency;
    this.filterTeam = this.filterForm.value.team;
    this.applySearch();
    const el = document.getElementById('workflowfilter');
    bootstrap.Modal.getInstance(el)?.hide();
  }

  editWorkFlow(item: IWorkflow) {
  this._stateService.setWorkFlowDetails(item);
  
  // Tell detail page what mode to use
  this._stateService.setWorkflowMode(
    this.isPrivilegeEdit ? 'edit' : 'view'
  );

  this.cdRef.detectChanges();
}
 
   confirmWorkflowDelete(item: IWorkflow): void {
    this.workflowToDelete = item;
    this.cdRef.detectChanges();
    this.deleteModal.show();
  }

  deleteWorkflow(item: IWorkflow) {
    this.loadingService.show();
    this.workflowService.deleteWorkflow(item.flow_id).subscribe({
      next: () => {
        this.loadingService.hide();
        this.deleteModal.hide();
        this.fetchWorkflows();
        this.toast.showToast('success', 'Workflow deleted successfully');
      },
      error: (err) => {
        this.toast.showToast(
          'error',
          err?.error?.error || 'Something went wrong'
        );
        this.loadingService.hide();
        this.deleteModal.hide();
      },
    });
  }

 
  //#region Search Functionality

setActiveCountTab(index: number): void {
	
  this.tabIndex = index;
	
  if (this.activeTabKey) {
    this.tabFilterValues[this.activeTabKey] = this.filterForm.value;
    this.tabSearchTerms[this.activeTabKey] = this.searchTerm;
  }
  
  this.workflowCountsList.forEach((item, i) => (item.active = i === index));
  this.activeTabKey = this.workflowCountsList[index].key;
  
  // Filter workflows based on the active tab
  let filteredWorkflows = [...this.items()];
  
  switch (this.activeTabKey) {
    case 'external_workflows':
      filteredWorkflows = filteredWorkflows.filter(w => w.IsExternal);
      break;
    case 'internal_workflows':
      filteredWorkflows = filteredWorkflows.filter(w => !w.IsExternal);
      break;
    default:
      // All workflows, no additional filtering needed
      break;
  }
  
  const savedValues = this.tabFilterValues[this.activeTabKey];
  if (savedValues) {
    this.filterForm.patchValue(savedValues);
    const filtered = filteredWorkflows.filter((workflow) => {
      return (
        (!savedValues.agency || workflow.agency_name === savedValues.agency) &&
        (!savedValues.team || workflow.team === savedValues.team)
      );
    });
    this.filteredItems.set(filtered);
  } else {
    this.filterForm.reset({
      agency: '',
      team: '',
    });
    this.filteredItems.set([...filteredWorkflows]);
  }
  
  this.searchTerm = this.tabSearchTerms[this.activeTabKey] || '';
  if (this.searchTerm) {
    this.applySearch();
  }
  
  // Update charts with the filtered data for the active tab
  this.updateChartDataWithFilters(filteredWorkflows);
}

// Update applySearch method to work with tabs and update charts
applySearch(): void {
  const query = this.searchTerm.trim().toLowerCase();
  let allItems = [...this.items()];
  
  // First apply tab filter
  switch (this.activeTabKey) {
    case 'external_workflows':
      allItems = allItems.filter(w => w.IsExternal);
      break;
    case 'internal_workflows':
      allItems = allItems.filter(w => !w.IsExternal);
      break;
    default:
      // All workflows, no additional filtering needed
      break;
  }
  
  if (query || this.filterAgency || this.filterTeam) {
    const filtered = allItems.filter((item) => {
      let flag = true;
      if (flag && query) flag = item.flow_name?.toLowerCase().includes(query);
      if (flag && this.filterAgency)
        flag = item.agency_name === this.filterAgency;
      if (flag && this.filterTeam) flag = item.team === this.filterTeam;

      return flag;
    });
    this.filteredItems.set(filtered);
    
    // Update charts with the filtered data
    this.updateChartDataWithFilters(filtered);
  } else {
    // When search is cleared, restore filtered items based on active tab
    this.filteredItems.set([...allItems]);
    
    // Update charts with the current filtered data
    this.updateChartDataWithFilters(allItems);
  }
}

toggleWorkflowTypeFilter(type: string): void {
  if (this.activeFilters.workflowType === type) {
    delete this.activeFilters.workflowType;
  } else {
    this.activeFilters.workflowType = type;
    delete this.activeFilters.agency;
  }
  this.applyChartFilters();
}

toggleAgencyFilter(agency: string): void {
  if (this.activeFilters.agency === agency) {
    delete this.activeFilters.agency;
  } else {
    this.activeFilters.agency = agency;
    delete this.activeFilters.workflowType;
  }
  this.applyChartFilters();
}
  //#endregion
}