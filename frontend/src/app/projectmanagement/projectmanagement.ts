import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgxSpinnerService } from 'ngx-spinner';
import { HomeService } from '../services/home.service';
import { ChangeDetectorRef } from '@angular/core';
import { finalize, forkJoin } from 'rxjs';
import { Header } from '../header/header';
import { TooltipDirective } from '../custom-tooltip/tooltip.directive';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { environment as config } from '../../environments/environment';
import { Router } from '@angular/router';
import { ACCESS_TOKEN_KEY, getCookie, V } from '../utils';
import { FormError } from "../components/form-error/form-error";
import { IProject, IProjectDetails } from '../types';
import { HostListener } from '@angular/core';
import { ExternalAppServices } from '../services/external-app.services';
import { setToken } from '../services/auth.interceptor';

declare var bootstrap: any;

@Component({
  selector: 'app-projectmanagement',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    Header,
    TooltipDirective,
  ],
  templateUrl: './projectmanagement.html',
  styleUrls: ['./projectmanagement.css'],
})
export class Projectmanagement implements OnInit {
  @ViewChild('successToast') successToast?: ElementRef;
  @ViewChild('errorToast') errorToast?: ElementRef;

  // Projects & search
  projects: any[] = [];
  filteredProjects: any[] = [];
  searchQuery: string = '';
  toastMessage: string = '';
  // Modal flags
  showCreateModal: boolean = false;
  showEditModal: boolean = false;

  // Selected project for edit
  selectedProject: any = null;

  showLoader: boolean = false;

  // Form & stepper
  currentStep: number = 1;
  projectForm: FormGroup;

  addedTeams: any[] = [];
  selectedTeam: string = '';
  selectedRoles: string[] = [];
  selectedProjectId: string = '';
  projectToDelete: any = null;
  // Updated to store full objects instead of just names
  availableTeams: any[] = [];
  availableRoles: any[] = [];

  // ADD THESE VALIDATION PROPERTIES
  teamSelectionInvalid: boolean = false;
  teamsValidationShown: boolean = false;
  // ADD DUPLICATE VALIDATION PROPERTIES (Create mode only)
  isProjectNameDuplicate: boolean = false;
  duplicateCheckInProgress: boolean = false;
  isProjectDbNameDuplicate: boolean = false;
  showDeleteConfirmModal: boolean = false;
  // Filter properties
  showFilters: boolean = false;
  selectedFilterTeam: string = '';
  selectedFilterRole: string = '';
  isFilterApplied: boolean = false;
  subscrpionTitle: string = 'My Subscription'; //'Project Management';
  loggedUser: any;
  roleDetail: string = '';
  activeProject: string = '';
  UserName: string = '';
  userSubscriptionDetails: any[] = [];
  masterDatabase: string = config.masterDatabase;
  masterprojectName = config.masterprojectName;
  masterdatabaseName = config.masterdatabaseName;
  masterProjectDisplayName: string = config.masterProjectDisplayName;
  UserManagementData: any[] = [];
  refreshingProjectNames = new Set<string>();
  isPrivilegeView: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeRefresh: boolean = false;
  isPrivilegeExecute: boolean = false;
  showApiKey: { [key: string]: boolean } = {};
  availableExtApps: any[] = [];
  selectedExtApp: string = '';
  showCredentialPopup: string | null = null;
  credentialsEnabled: boolean = true;
  credentialPopupPosition: 'above' | 'below' = 'above';
  credentialPopupAlign: 'right' | 'left' | 'center' = 'right';
  showMappedUsersConfirmModal: boolean = false;
  mappedUsersForConfirm: any[] = [];
  mappedUsersConfirmAction: 'update' | 'delete' = 'update';
  pendingUpdateProjectData: any = null;
  currentUserTeam: string = '';
  currentUserRole: string = '';

  constructor(
    private fb: FormBuilder,
    private _homeService: HomeService,
    private _loadingService: NgxSpinnerService,
    private _router: Router,
    private cdr: ChangeDetectorRef,
    private _stateService: AIInfuseStateService,
    private externalAppService: ExternalAppServices
  ) {
    this.projectForm = this.fb.group({
      projectName: ['', Validators.required],
      description: ['', Validators.required],
      dateCreated: [''],
      dateUpdated: [''],
      app_url: ['', V.string("Application URL").url().build()],
      project_db_name: [
        '',
        [
          Validators.required,
          (control: any) =>
            /^[a-zA-Z0-9_]+$/.test(control.value)
              ? null
              : { invalidDbName: true },
        ],
      ],
    });
  }

  ngOnInit(): void {
    this.GetUserDetails();
    this.loggedUser = this._stateService.getLoginDetails();
    var Name = this.loggedUser?.UserName?.split(' ') || '';
    this.UserName = Name[0] || 'User';

    const userRoleDtls = this.loggedUser.ProjectDtl?.find((p: any) =>
      p.prj_name?.trim().toLowerCase() === this.loggedUser.ActiveProject?.trim().toLowerCase()
    )?.role_name || "Super Admin";

    this.roleDetail = userRoleDtls;
    this.activeProject = this.loggedUser.ActiveProject || this.masterProjectDisplayName;
    this.userSubscriptionDetails = this.loggedUser.ProjectDtl;
    const activeProjectDetails = this.loggedUser.ProjectDtl?.find((p: any) =>
      p.prj_name?.trim().toLowerCase() === this.loggedUser.ActiveProject?.trim().toLowerCase()
    );
    this.currentUserTeam = activeProjectDetails?.team_name || '';
    this.currentUserRole = activeProjectDetails?.role_name || '';

    this.loadProjects();
    this.loadTeamsAndRoles();
    this.loadExternalApps();
    this.loadPrivileges();
  }

getExtAppName(app: any): string {
    if (!app) return '';
    // Prioritize 'name' since that's what the API returns
    return app.name || app.Name || app.app_name || app.AppName || 
           app.external_app_name || app.application_name || 'Unknown App';
}

getExtAppId(app: any): string {
    if (!app) return '';
    return app.application_id || app.ApplicationId || app.app_id || 
           app.AppId || app._id || app.id || '';
}

  getProjectExtApp(project: any): any {
    if (!project.teams) return null;
    for (const team of project.teams) {
      if (team.externalApp) return team.externalApp;
    }
    return null;
  }

  toggleProjectCredentials(project: any, event: Event): void {
    event.stopPropagation();
    const extApp = this.getProjectExtApp(project);
    if (!extApp) return;

    extApp.credentialsEnabled = !extApp.credentialsEnabled;
    
    const projectData = {
      teams: project.teams
    };
    
    this._homeService.updateProject(project._id, projectData).subscribe({
      next: () => {
        this.showToast('success', extApp.credentialsEnabled ? 'Credentials enabled successfully' : 'Credentials disabled successfully');
      },
      error: (error) => {
        this.showToast('error', 'Failed to update credentials toggle');
        extApp.credentialsEnabled = !extApp.credentialsEnabled;
        this.cdr.detectChanges();
      }
    });
  }

  loadExternalApps(): void {
    this.externalAppService.getExternalApplications().subscribe({
      next: (response) => {
        if (response?.success && response?.data) {
          this.availableExtApps = response.data;
          console.log('Loaded external apps:', this.availableExtApps);
        }
      },
      error: (error) => {
        console.error('Error loading external apps:', error);
        this.availableExtApps = [];
      }
    });
  }

  getSelectedExtAppDetails(): any {
    if (!this.selectedExtApp) return null;
    return this.availableExtApps.find(app => this.getExtAppId(app) === this.selectedExtApp);
  }

  getExtAppTooltipText(): string {
  const app = this.getSelectedExtAppDetails();
  if (!app) return '';

  const lines: string[] = [];

  if (app.application_type) {
    lines.push(`App Type: ${app.application_type}`);
  }
  if (app.auth_method) {
    lines.push(`Authorization method: ${app.auth_method}`);
  }
  if (app.allowed_apis?.length) {
    lines.push(`Allowed API Categories: ${app.allowed_apis.join(', ')}`);
  }
  if (app.application_url) {
    lines.push(`App URL: ${app.application_url}`);
  }
  if (app.description) {
    lines.push(`Description: ${app.description}`);
  }

  return lines.join('\n') || 'No additional details';
}

  onExtAppChange(): void {
  this.credentialsEnabled = !!this.selectedExtApp; // true when an app is selected
}

  loadPrivileges() {
    this._stateService.getPrivilegesByPage('Subscription').subscribe({
      next: (loaded_privileges: any) => {
        console.log('Loaded privileges for Project Management by page: ', loaded_privileges);
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

  GetUserDetails(): void {
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
            RoleNames: prjDetails.map(
              (p: any) => p.role_name || p.roleName || ''
            ),
          };
        });
        this.cdr.detectChanges();
      } else {
      }
    });
  }

  showToast(type: 'success' | 'error', message: string): void {
    this.toastMessage = message;
    const toastId = type === 'success' ? '#successToast' : '#errorToast';
    const toastEl = document.querySelector(toastId);
    if (toastEl) {
      const toast = new bootstrap.Toast(toastEl);
      toast.show();
    }
    this.cdr.detectChanges();
  }

  getFullDescription(project: any): string {
    const description = project.project_desc || project.description;
    return description || 'No description available';
  }

  getTruncatedDescription(project: any): string {
    const description = project.project_desc || project.description;

    if (!description) {
      return 'No description available';
    }

    const maxLength = 120;
    if (description.length <= maxLength) {
      return description;
    }

    return description.substring(0, maxLength) + '...';
  }

  shouldShowTooltip(project: any): boolean {
    const description = project.project_desc || project.description;
    return (
      !!description &&
      description.trim() !== '' &&
      description.trim() !== 'No description available'
    );
  }

  checkProjectNameDuplicate(): void {
    const projectName = this.projectForm.get('projectName')?.value?.trim();

    if (!projectName) {
      this.isProjectNameDuplicate = false;
      return;
    }

    // Only check duplicates in create mode
    if (!this.showCreateModal) {
      this.isProjectNameDuplicate = false;
      return;
    }

    this.duplicateCheckInProgress = true;

    // Check if project name already exists
    const isDuplicate = this.projects.some(
      (project) =>
        project.projectName.toLowerCase() === projectName.toLowerCase()
    );

    this.isProjectNameDuplicate = isDuplicate;
    this.duplicateCheckInProgress = false;
    this.cdr.detectChanges();
  }

  checkProjectDbNameDuplicate(): void {
    const dbName = this.projectForm.get('project_db_name')?.value?.trim();

    if (!dbName) {
      this.isProjectDbNameDuplicate = false;
      return;
    }

    // Only check duplicates in create mode
    if (!this.showCreateModal) {
      this.isProjectDbNameDuplicate = false;
      return;
    }

    // Check if database name already exists
    const isDuplicate = this.projects.some((project) => {
      const projectDbName = project.database_name || project.project_db_name;
      return projectDbName?.toLowerCase() === dbName.toLowerCase();
    });

    this.isProjectDbNameDuplicate = isDuplicate;
    this.cdr.detectChanges();
  }

  // ------------------ Load Teams and Roles ------------------
  loadTeamsAndRoles(): void {
    forkJoin({
      teams: this._homeService.getAllTeams(),
      roles: this._homeService.getAllRoles(),
    }).subscribe({
      next: (response) => {
        // Handle teams response
        let fetchedTeams: any[] = [];
        let fetchedRoles: any[] = [];

        if (response.teams?.success) {
          fetchedTeams = response.teams.data || [];
        }
        if (response.roles?.data) {
          fetchedRoles = response.roles.data || [];
        }

        const currentRole = this.roleDetail?.trim().toLowerCase();
        const isAdmin = currentRole === 'super admin' || currentRole === 'admin';

        if (isAdmin) {
          // Load all for Admin
          console.log('neoAdmin user - loading all teams and roles');
          this.availableTeams = fetchedTeams;
          this.availableRoles = fetchedRoles;
        } else {
          console.log('Current user team:', this.currentUserTeam);
          console.log('Current user role:', this.currentUserRole);
          console.log('fetchedTeams:', fetchedTeams);
          console.log('fetchedRoles:', fetchedRoles);
          // Filter using the class variables we saved in ngOnInit
          this.availableTeams = fetchedTeams.filter((team: any) => 
            team.TeamName?.trim().toLowerCase() === this.currentUserTeam.trim().toLowerCase()
          );

          this.availableRoles = fetchedRoles.filter((role: any) => 
            role.RoleName?.trim().toLowerCase() === this.currentUserRole.trim().toLowerCase()
          );
        }

        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading teams and roles:', error);
        this.availableTeams = [];
        this.availableRoles = [];
      },
    });
  }

  // ------------------ Dashboard ------------------
  loadProjects_old(): void {
    this._homeService.getAllProjects().subscribe({
      next: (response) => {
        // Process projects to ensure consistent field names
        const allProjects = (response.data || []).map((p: any) => ({
          ...p,
          // Ensure we have both field names for frontend consistency
          description: p.project_desc || p.description || '',
          project_db_name: p.database_name || p.project_db_name || '',
          usersCount: p.UserCount || 0,
        }));

        //this.projects = this.filterOutMasterProjects(allProjects);
        this.filteredProjects = allProjects;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading projects:', error);
      },
    });
  }

  loadProjects_new(): void {
    this._homeService.getAllProjects().subscribe({
      next: (response) => {
        const allProjects = (response.data || []).map((p: any) => ({
          ...p,
          description: p.project_desc || p.description || '',
          project_db_name: p.database_name || p.project_db_name || '',
          usersCount: p.UserCount || 0,
        }));

        // Determine active status for each project
        const enrichedProjects = allProjects.map((project: any) => {
          let active = false;

          if (this.isSuperAdminMaster()) {
            active = true; // Super admin: all active
          } else {
            // Non-superadmin: active only if projectName exists in prjDetails
            active =
              this.userSubscriptionDetails?.some(
                (detail: any) => detail.prj_name === project.projectName
              ) ?? false;
          }

          return { ...project, active };
        });
        if (this.roleDetail?.trim() !== 'Super Admin') {
          this.projects = this.filterOutMasterProjects(enrichedProjects);
        } else {
          this.projects = enrichedProjects;
        }

        this.filteredProjects = this.projects;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading projects:', error);
      },
    });
  }


  loadProjects(): void {
    this._homeService.getAllProjects().subscribe({
      next: (response) => {
        const allProjects = (response.data || []).map((p: any) => ({
          ...p,
          description: p.project_desc || p.description || '',
          project_db_name: p.database_name || p.project_db_name || '',
          usersCount: p.UserCount || 0,
        }));
        console.log('All loaded projects:', allProjects);

        let IsMatestProject = this.loggedUser.ProjectDtl?.map((p: any) => p.prj_name?.trim().toLowerCase() == this.masterDatabase.trim().toLowerCase()) || [];

        console.log('Is user subscribed to master database project?', IsMatestProject);

        // Determine active status for each project
        const enrichedProjects = allProjects.map((project: any) => {
          let active = false;
          let greendot_active = false;

          console.log('userSubscriptionDetails', this.userSubscriptionDetails)
          greendot_active =
            this.userSubscriptionDetails?.some(
              (detail: any) => detail.prj_name === project.projectName
            ) ?? false;
          if (this.isSuperAdminMaster()) {
            active = true; // Super admin: all active
          } else {
            // Non-superadmin: active only if projectName exists in prjDetails
            active =
              this.userSubscriptionDetails?.some(
                (detail: any) => detail.prj_name === project.projectName
              ) ?? false;
          }

          return { ...project, active, greendot_active };
        });

        console.log('Enriched projects with active status:', enrichedProjects);
        if (this.roleDetail?.trim() !== 'Super Admin') {

          if (IsMatestProject.length > 0) {
            this.projects = enrichedProjects;
          }
          else {

            this.projects = this.filterOutMasterProjects(enrichedProjects);
          }
        }
        else {
          this.projects = enrichedProjects;
        }

        this.filteredProjects = this.projects;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading projects:', error);
      },
    });
  }

  private filterOutMasterProjects(projects: any[]): any[] {
    // Define master projects that should be hidden
    const MASTER_PROJECTS = {
      projectNames: this.masterprojectName,
      databaseNames: this.masterdatabaseName
    };

    return projects.filter((project) => {
      const projectName = project.projectName?.toLowerCase().trim();
      const databaseName = (project.database_name || project.project_db_name)
        ?.toLowerCase()
        .trim();

      // Check if this is a master project that should be hidden
      const isMasterProject =
        MASTER_PROJECTS.projectNames.some(
          (name) => projectName === name.toLowerCase()
        ) ||
        MASTER_PROJECTS.databaseNames.some(
          (dbName) => databaseName === dbName.toLowerCase()
        );

      // Return false for master projects (filter them out), true for regular projects
      return !isMasterProject;
    });
  }

  toggleFilters(): void {
    this.showFilters = !this.showFilters;

    // Only load teams/roles if showing filters and they're not loaded
    if (
      this.showFilters &&
      (this.availableTeams.length === 0 || this.availableRoles.length === 0)
    ) {
      this.loadTeamsAndRoles();
    }
  }

  onFilterChange(): void {
    // Do nothing here - filters only apply when "Apply Filters" is clicked
    console.log('Filter selection changed');
  }

  clearFilters(): void {
    this.selectedFilterTeam = '';
    this.selectedFilterRole = '';
    this.isFilterApplied = false;
    this.filteredProjects = this.projects;
  }

  onSearch(query: string): void {
    this.searchQuery = query;

    let baseProjects = this.projects; // Use the already filtered projects

    // If filters are applied, search within the filtered results
    if (this.isFilterApplied) {
      baseProjects = this.filteredProjects;
    }

    if (!query) {
      this.filteredProjects = baseProjects;
    } else {
      this.filteredProjects = baseProjects.filter(
        (project) =>
          project.projectName.toLowerCase().includes(query.toLowerCase()) ||
          (project.projectId && project.projectId.toString().includes(query)) ||
          (project.description &&
            project.description.toLowerCase().includes(query.toLowerCase()))
      );
    }
  }

  applyFilters(): void {
    console.log(
      'Apply Filters clicked - Team:',
      this.selectedFilterTeam,
      'Role:',
      this.selectedFilterRole
    );

    // If no filters are selected, show all projects (already filtered)
    if (!this.selectedFilterTeam && !this.selectedFilterRole) {
      this.filteredProjects = this.projects;
      this.isFilterApplied = false;
      console.log('No filters selected, showing all projects');
      return;
    }

    this.isFilterApplied = true;

    this.filteredProjects = this.projects.filter((project) => {
      // Use this.projects (already filtered)
      const teams = project.teams || [];
      console.log('Checking project:', project.projectName, 'Teams:', teams);

      // Case 1: Only Team selected
      if (this.selectedFilterTeam && !this.selectedFilterRole) {
        const hasTeam = teams.some((team: any) => {
          const teamName = this.getTeamName(team);
          console.log(
            'Team filter - Project team:',
            teamName,
            'Looking for:',
            this.selectedFilterTeam
          );
          return teamName === this.selectedFilterTeam;
        });
        console.log('Team only filter result:', hasTeam);
        return hasTeam;
      }

      // Case 2: Only Role selected
      if (!this.selectedFilterTeam && this.selectedFilterRole) {
        const hasRole = teams.some((team: any) => {
          const roles = team.roles || [];
          const roleFound = roles.some((role: any) => {
            const roleName = this.getRoleName(role);
            console.log(
              'Role filter - Project role:',
              roleName,
              'Looking for:',
              this.selectedFilterRole
            );
            return roleName === this.selectedFilterRole;
          });
          return roleFound;
        });
        console.log('Role only filter result:', hasRole);
        return hasRole;
      }

      // Case 3: Both Team and Role selected
      if (this.selectedFilterTeam && this.selectedFilterRole) {
        const hasTeamWithRole = teams.some((team: any) => {
          const teamName = this.getTeamName(team);
          const roles = team.roles || [];

          // Check if this team matches AND has the selected role
          const teamMatches = teamName === this.selectedFilterTeam;
          const roleMatches = roles.some((role: any) => {
            const roleName = this.getRoleName(role);
            return roleName === this.selectedFilterRole;
          });

          console.log(
            'Both filters - Team:',
            teamName,
            'Matches:',
            teamMatches,
            'Role found:',
            roleMatches
          );
          return teamMatches && roleMatches;
        });
        console.log('Both filters result:', hasTeamWithRole);
        return hasTeamWithRole;
      }

      return true;
    });

    console.log('Final filtered projects count:', this.filteredProjects.length);
    console.log(
      'Filtered projects:',
      this.filteredProjects.map((p) => p.projectName)
    );
  }

  // ------------------ Modal Handling ------------------
  openCreateModal(): void {
    this.resetForm();
    this.showCreateModal = true;
    // Reset validation flags when opening modal
    this.teamSelectionInvalid = false;
    this.teamsValidationShown = false;

    // Ensure teams and roles are loaded
    if (this.availableTeams.length === 0 || this.availableRoles.length === 0) {
      this.loadTeamsAndRoles();
    }

    // Ensure external apps are loaded
    if (this.availableExtApps.length === 0) {
      this.loadExternalApps();
    }
  }

  openEditModal(project: any): void {
  this.selectedProject = project;
  this.selectedProjectId = project._id;
  this.showEditModal = true;
  this.currentStep = 1;

  this.projectForm.patchValue({
    projectName: project.projectName || '',
    description: project.project_desc || project.description || '',
    dateCreated: project.dateCreated || '',
    dateUpdated: project.dateUpdated || '',
    app_url: project.app_url || '',
    project_db_name: project.database_name || project.project_db_name || '',
  });

  // Build map of external apps for name/url lookup only
  const extAppsMap = new Map<string, any>();
  (project.external_apps || []).forEach((app: any) => {
    const id = app.application_id || app.app_id || '';
    if (id) extAppsMap.set(id, app);
  });

  this.addedTeams = (project.teams || []).map((team: any) => {
    let externalApp = null;

    // Only use what is explicitly stored on the team
    if (team.externalApp) {
      const appId = team.externalApp.application_id || team.externalApp.app_id || '';
      const fromProject = appId ? extAppsMap.get(appId) : null;

      externalApp = {
        application_id: appId,
        app_name:
          team.externalApp.app_name ||
          fromProject?.application_name ||
          fromProject?.name ||
          'External App',
        application_url: team.externalApp.application_url || fromProject?.application_url || '',
        auth_method: team.externalApp.auth_method || fromProject?.auth_method || '',
        application_type: team.externalApp.application_type || fromProject?.application_type || '',
        credentialsEnabled: team.externalApp.credentialsEnabled !== false,
      };
    }
    // No automatic fallback – leave externalApp as null if the team doesn't have one

    return {
      teamName: team.teamName || team.TeamName || '',
      roles: (team.roles || []).map((r: any) => ({
        role: typeof r === 'string' ? r : r.role || r.roleName || r.RoleName || '',
      })),
      externalApp,
    };
  });

  this.selectedTeam = '';
  this.selectedRoles = [];
  this.selectedExtApp = '';
  this.credentialsEnabled = true;
  this.teamSelectionInvalid = false;
  this.teamsValidationShown = false;

  this.cdr.detectChanges();
}

  // Helper method to check if a project is a master project
  private isMasterProject(project: any): boolean {
    const MASTER_PROJECTS = {
      projectNames: this.masterprojectName,
      databaseNames: this.masterdatabaseName
    };

    const projectName = project.projectName?.toLowerCase().trim();
    const databaseName = (project.database_name || project.project_db_name)
      ?.toLowerCase()
      .trim();

    return (
      MASTER_PROJECTS.projectNames.some(
        (name) => projectName === name.toLowerCase()
      ) ||
      MASTER_PROJECTS.databaseNames.some(
        (dbName) => databaseName === dbName.toLowerCase()
      )
    );
  }

  isMasterSubscription(projectName: string): boolean {
    const MASTER_PROJECTS = {
      projectNames: [this.masterDatabase],
    };

    const projName = projectName?.toLowerCase().trim();

    return MASTER_PROJECTS.projectNames.some(
      (name) => projName === name.toLowerCase()
    );
  }

  closeModal(): void {
    this.showCreateModal = false;
    this.showEditModal = false;
    this.selectedProject = null;
    this.resetForm();
    this.loadProjects();
    this.closeBootstrapModal('createProjectModal');
    this.closeBootstrapModal('editProjectModal');
  }

  // ------------------ Form & Stepper ------------------
  nextStep(): void {
    if (this.currentStep === 1 && this.projectForm.valid) {
      this.currentStep = 2;
      // Reset validation flags when moving to step 2
      this.teamSelectionInvalid = false;
      this.teamsValidationShown = false;
    }
  }

  previousStep(): void {
    if (this.currentStep === 2) {
      this.currentStep = 1;
    }
  }

  resetForm(): void {
    this.projectForm.reset();
    this.currentStep = 1;
    this.addedTeams = [];
    this.selectedTeam = '';
    this.selectedRoles = [];
    this.selectedProjectId = '';
    // Reset validation flags
    this.teamSelectionInvalid = false;
    this.teamsValidationShown = false;
    // Reset duplicate flags
    this.isProjectNameDuplicate = false;
    this.isProjectDbNameDuplicate = false;
    this.duplicateCheckInProgress = false;
    // Reset external app fields
    this.selectedExtApp = '';
    this.credentialsEnabled = false;
    // Reset credential popup
    this.showCredentialPopup = null;
  }

  // ------------------ Team & Roles ------------------
  addTeamAndRoles(): void {
    if (!this.selectedTeam || this.selectedTeam === '') {
        this.teamSelectionInvalid = true;
        return;
    }

    if (this.selectedRoles.length === 0) {
        this.teamSelectionInvalid = true;
        return;
    }

    this.teamSelectionInvalid = false;

    if (this.selectedTeam && this.selectedRoles.length > 0) {
      let externalApp = null;
      if (this.selectedExtApp) {
        const selectedApp = this.availableExtApps.find(
            app => this.getExtAppId(app) === this.selectedExtApp
        );
        
        console.log('>>> addTeamAndRoles - selectedExtApp:', this.selectedExtApp);
        console.log('>>> addTeamAndRoles - found selectedApp:', selectedApp);
        
        externalApp = {
          application_id: this.selectedExtApp,  // Use application_id (matches backend)
          app_name: this.getExtAppName(selectedApp),
          application_url: selectedApp?.application_url || '',
          auth_method: selectedApp?.auth_method || '',
          application_type: selectedApp?.application_type || '',
          credentialsEnabled: this.credentialsEnabled,
          credentials: null 
        };
        
        console.log('>>> addTeamAndRoles - built externalApp:', externalApp);
      }

      const team = {
        teamName: this.selectedTeam,
        roles: this.selectedRoles.map((role) => ({ role })),
        externalApp: externalApp
      };

      const existingTeamIndex = this.addedTeams.findIndex(
        (t) => t.teamName === team.teamName
      );
      if (existingTeamIndex > -1) {
        this.addedTeams[existingTeamIndex].roles = [
          ...this.addedTeams[existingTeamIndex].roles,
          ...team.roles,
        ];
        this.addedTeams[existingTeamIndex].roles = this.addedTeams[
          existingTeamIndex
        ].roles.filter(
          (role: any, index: number, self: any[]) =>
            index === self.findIndex((r: any) => r.role === role.role)
        );
        if (externalApp) {
          this.addedTeams[existingTeamIndex].externalApp = externalApp;
        }
      } else {
        this.addedTeams.push(team);
      }

      console.log('>>> addedTeams after add:', JSON.stringify(this.addedTeams, null, 2));

      this.selectedTeam = '';
      this.selectedRoles = [];
      this.selectedExtApp = '';
      this.credentialsEnabled = false;
    }
}

  removeTeam(index: number): void {
    this.addedTeams.splice(index, 1);
  }

  editTeam(index: number): void {
  const team = this.addedTeams[index];
  this.selectedTeam = team.teamName;
  this.selectedRoles = team.roles.map((r: any) => r.role);

  if (team.externalApp) {
    this.selectedExtApp = team.externalApp.application_id || team.externalApp.app_id || '';
    this.credentialsEnabled = team.externalApp.credentialsEnabled !== false; // default ON
  } else {
    this.selectedExtApp = '';
    this.credentialsEnabled = false;
  }

  this.addedTeams.splice(index, 1);
}

  onRoleSelectionChange(role: string, event: any): void {
    if (event.target.checked) {
      this.selectedRoles.push(role);
    } else {
      const index = this.selectedRoles.indexOf(role);
      if (index > -1) this.selectedRoles.splice(index, 1);
    }
    // Reset validation when user interacts with roles
    this.teamSelectionInvalid = false;
  }

  getRolesText(team: any): string {
    return team.roles.map((r: any) => r.role).join(', ');
  }

  // Helper method to get team name for display
  getTeamName(team: any): string {
    if (typeof team === 'string') return team;
    return team?.TeamName || team?.teamName || 'Unknown Team';
  }

  getRoleName(role: any): string {
    if (!role) return 'Unknown Role';
    if (typeof role === 'string') return role;

    // Handle both types of role objects
    if (role.role) {
      return role.role; // For project team roles
    }
    if (role.RoleName) {
      return role.RoleName; // For available roles from API
    }

    return role.roleName || role.name || role.Name || 'Unknown Role';
  }

  // ------------------ CRUD Operations ------------------
  saveProject(): void {
    this.checkProjectNameDuplicate();
    this.checkProjectDbNameDuplicate();

    if (this.isProjectNameDuplicate || this.isProjectDbNameDuplicate) {
      return;
    }

    if (this.addedTeams.length === 0) {
      this.teamsValidationShown = true;
      return;
    }

    if (this.projectForm.valid && this.addedTeams.length > 0) {
      // Extract external apps from teams
      const externalApps = this.addedTeams
        .filter(team => team.externalApp)
        .map(team => {
          const extAppId = team.externalApp.application_id || team.externalApp.app_id;
          const appDetails = this.availableExtApps.find(
              app => this.getExtAppId(app) === extAppId
          );
          return {
            application_id: extAppId,
            allowed_apis: appDetails?.allowed_apis || [],
            credentialsEnabled: team.externalApp.credentialsEnabled !== false,
          };
        });

      console.log('>>> saveProject - externalApps:', JSON.stringify(externalApps, null, 2));

      const cleanTeams = this.addedTeams.map((team) => {
  if (!team.externalApp) {
    const { externalApp, ...rest } = team;
    return rest;
  }
  return {
    teamName: team.teamName,
    roles: team.roles,
    // keep the mapping so Edit can restore the correct app + toggle
    externalApp: {
      application_id: team.externalApp.application_id || team.externalApp.app_id,
      app_name: team.externalApp.app_name,
      credentialsEnabled: team.externalApp.credentialsEnabled !== false,
    },
  };
});

      const projectData: any = {
        projectName: this.projectForm.value.projectName,
        project_desc: this.projectForm.value.description,
        app_url: this.projectForm.value.app_url,
        description: this.projectForm.value.description,
        project_db_name: this.projectForm.value.project_db_name,
        database_name: this.projectForm.value.project_db_name,
        teams: cleanTeams,
      };

      if (externalApps.length > 0) {
        projectData.external_apps = externalApps;
      }

      console.log('>>> FINAL PAYLOAD:', JSON.stringify(projectData, null, 2));

      this._homeService.addProjectDetails(projectData).subscribe({
        next: () => {
          this.showToast('success', 'AI Solution created successfully');
          this.closeModal();
          this.loadProjects();
        },
        error: (error) => {
          let errorMessage = error.error?.message || 'Failed to create AI Solution';
          console.error('Error creating AI Solution:', error);
          this.showToast('error', errorMessage);
        },
      });
    }
}

updateProject(): void {
  const projectId = this.selectedProject?._id || this.selectedProjectId;

  if (!projectId) {
    console.error('No AI Solution ID found for update');
    return;
  }

  if (this.projectForm.invalid) {
    Object.keys(this.projectForm.controls).forEach((key) => {
      this.projectForm.get(key)?.markAsTouched();
    });
    return;
  }

  // ---- Detect teams / roles that are being removed ----
  const originalTeams = this.selectedProject?.teams || [];
  const newTeamNames = new Set(
    this.addedTeams.map((t) => (t.teamName || '').toLowerCase())
  );

  const teamsBeingRemoved = originalTeams
    .filter(
      (t: any) =>
        !newTeamNames.has((t.teamName || t.TeamName || '').toLowerCase())
    )
    .map((t: any) => t.teamName || t.TeamName);

  const rolesBeingRemoved: { team: string; role: string }[] = [];

  originalTeams.forEach((origTeam: any) => {
    const newTeam = this.addedTeams.find(
      (t) =>
        (t.teamName || '').toLowerCase() ===
        (origTeam.teamName || origTeam.TeamName || '').toLowerCase()
    );

    if (!newTeam) return;

    const newRoles = new Set(
      (newTeam.roles || []).map((r: any) => (r.role || '').toLowerCase())
    );

    (origTeam.roles || []).forEach((r: any) => {
      const roleName = r.role || r.roleName || r.RoleName || '';
      if (!newRoles.has(roleName.toLowerCase())) {
        rolesBeingRemoved.push({
          team: origTeam.teamName || origTeam.TeamName,
          role: roleName,
        });
      }
    });
  });

  // ---- Build the payload first ----
  const externalApps = this.addedTeams
    .filter((team) => team.externalApp)
    .map((team) => {
      const extAppId =
        team.externalApp.application_id || team.externalApp.app_id;
      const appDetails = this.availableExtApps.find(
        (app) => this.getExtAppId(app) === extAppId
      );
      return {
        application_id: extAppId,
        allowed_apis: appDetails?.allowed_apis || [],
        credentialsEnabled: team.externalApp.credentialsEnabled !== false,
      };
    });

  const cleanTeams = this.addedTeams.map((team) => {
    if (!team.externalApp) {
      const { externalApp, ...rest } = team;
      return rest;
    }
    return {
      teamName: team.teamName,
      roles: team.roles,
      externalApp: {
        application_id:
          team.externalApp.application_id || team.externalApp.app_id,
        app_name: team.externalApp.app_name,
        credentialsEnabled: team.externalApp.credentialsEnabled !== false,
      },
    };
  });

  const projectData: any = {
    projectName: this.projectForm.value.projectName,
    project_desc: this.projectForm.value.description,
    description: this.projectForm.value.description,
    app_url: this.projectForm.value.app_url,
    project_db_name: this.projectForm.value.project_db_name,
    database_name: this.projectForm.value.project_db_name,
    teams: cleanTeams,
  };

  if (externalApps.length > 0) {
    projectData.external_apps = externalApps;
  }

  // ---- Check mapped users ----
  const mappedUsers = this.getUsersMappedToProject(
    this.selectedProject,
    teamsBeingRemoved,
    rolesBeingRemoved
  );

  if (mappedUsers.length > 0) {
    // Show the nice modal instead of alert
    this.mappedUsersForConfirm = mappedUsers;
    this.mappedUsersConfirmAction = 'update';
    this.pendingUpdateProjectData = { projectId, projectData };
    this.showMappedUsersConfirmModal = true;
    this.cdr.detectChanges();

    // Open Bootstrap modal
    setTimeout(() => {
      const modalEl = document.getElementById('mappedUsersConfirmModal');
      if (modalEl) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
      }
    }, 50);
    return;
  }

  // No mapped users → proceed immediately
  this.executeUpdate(projectId, projectData);
}

/** Actual API call (shared by normal flow + confirm) */
private executeUpdate(projectId: string, projectData: any): void {
  console.log('>>> UPDATE FINAL PAYLOAD:', JSON.stringify(projectData, null, 2));

  this._homeService.updateProject(projectId, projectData).subscribe({
    next: (response) => {
      console.log('Update successful:', response.data);
      this.showToast('success', 'AI Solution updated successfully');
      this.closeBootstrapModal('editProjectModal');
      this.closeMappedUsersConfirmModal();
      this.resetForm();
      this.loadProjects();
    },
    error: (error) => {
      let errorMessage =
        error.error?.message || 'Failed to update AI Solution';
      console.error('Error updating AI Solution:', error);
      this.showToast('error', errorMessage);
      this.closeMappedUsersConfirmModal();
    },
  });
}
 
getVisibleCredentials(project: any): any[] {
  if (!project?.external_apps?.length) return [];

  // User's team for this project
  const userSub = (this.userSubscriptionDetails || []).find(
    (s: any) =>
      (s.prj_name || '').toLowerCase() === (project.projectName || '').toLowerCase()
  );
  if (!userSub) return [];

  const userTeam = (userSub.team_name || '').toLowerCase();

  // application_ids mapped to the user's team on this project
  const teamAppIds = new Set(
    (project.teams || [])
      .filter(
        (t: any) =>
          (t.teamName || '').toLowerCase() === userTeam && t.externalApp
      )
      .map((t: any) => t.externalApp.application_id || t.externalApp.app_id)
      .filter(Boolean)
  );

  if (teamAppIds.size === 0) return [];

  return project.external_apps.filter((app: any) =>
    teamAppIds.has(app.application_id || app.app_id)
  );
}

hasCredentials(project: any): boolean {
  if (!project?.external_apps?.length) return false;

  // Must have at least one API key
  const hasApiKey = project.external_apps.some((app: any) => !!app.api_key);
  if (!hasApiKey) return false;

  // If any team has an externalApp with credentialsEnabled === false → hide icon
  const isDisabled = project.teams?.some(
    (t: any) => t.externalApp && t.externalApp.credentialsEnabled === false
  );

  return !isDisabled;
}

toggleCredentialPopup(projectName: string, event?: Event): void {
  if (event) {
    event.stopPropagation();
  }
  
  if (this.showCredentialPopup === projectName) {
    this.showCredentialPopup = null;
    return;
  }
  
  this.showCredentialPopup = projectName;
  
  // Wait for DOM to update, then calculate position
  setTimeout(() => {
    this.calculatePopupPosition();
  }, 10);
}

// Add this new method to calculate popup position
calculatePopupPosition(): void {
  const popupElement = document.querySelector('.credential-popup') as HTMLElement;
  const triggerElement = document.querySelector('.cred-info-btn') as HTMLElement;
  
  if (!popupElement || !triggerElement) {
    this.credentialPopupPosition = 'above';
    this.credentialPopupAlign = 'right';
    this.cdr.detectChanges();
    return;
  }
  
  const triggerRect = triggerElement.getBoundingClientRect();
  const popupRect = popupElement.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  
  // Calculate available space above and below the trigger
  const spaceAbove = triggerRect.top;
  const spaceBelow = viewportHeight - triggerRect.bottom;
  
  // Calculate required space for popup (with some padding)
  const popupHeight = popupRect.height || 250; // fallback height
  const requiredSpace = popupHeight + 20; // 20px for margin
  
  // Determine vertical position
  if (spaceAbove >= requiredSpace) {
    // Enough space above - show popup above
    this.credentialPopupPosition = 'above';
  } else if (spaceBelow >= requiredSpace) {
    // Enough space below - show popup below
    this.credentialPopupPosition = 'below';
  } else if (spaceBelow > spaceAbove) {
    // Not enough space either way, but more space below
    this.credentialPopupPosition = 'below';
  } else {
    // Default to above even if it might overflow slightly
    this.credentialPopupPosition = 'above';
  }
  
  // Calculate horizontal alignment
  const popupWidth = popupRect.width || 381; // fallback width
  const triggerCenterX = triggerRect.left + (triggerRect.width / 2);
  
  // Check if popup would overflow right edge
  const spaceOnRight = viewportWidth - triggerRect.right;
  const spaceOnLeft = triggerRect.left;
  
  if (spaceOnRight >= popupWidth) {
    // Fits on the right (default)
    this.credentialPopupAlign = 'right';
  } else if (spaceOnLeft >= popupWidth) {
    // Fits on the left
    this.credentialPopupAlign = 'left';
  } else if (triggerCenterX >= popupWidth / 2 && 
             (viewportWidth - triggerCenterX) >= popupWidth / 2) {
    // Can center it
    this.credentialPopupAlign = 'center';
  } else if (spaceOnRight > spaceOnLeft) {
    // More space on right, align right but might need to shrink
    this.credentialPopupAlign = 'right';
  } else {
    // More space on left
    this.credentialPopupAlign = 'left';
  }
  
  this.cdr.detectChanges();
  
  // Recalculate after position change to handle edge cases
  setTimeout(() => {
    this.adjustPopupPositionIfNeeded(popupElement);
  }, 50);
}

// Add this method to fine-tune position after initial render
private adjustPopupPositionIfNeeded(popupElement: HTMLElement): void {
  if (!popupElement) return;
  
  const rect = popupElement.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  
  // If still overflowing vertically, add max-height and scroll
  if (rect.top < 0 || rect.bottom > viewportHeight) {
    const availableHeight = viewportHeight - 40; // 20px padding top and bottom
    const maxScrollHeight = Math.min(availableHeight, 400); // cap at 400px
    
    if (rect.height > maxScrollHeight) {
      popupElement.style.maxHeight = `${maxScrollHeight}px`;
      popupElement.style.overflowY = 'auto';
      
      // Adjust position to stay within viewport
      if (rect.top < 0) {
        popupElement.style.top = '20px';
        popupElement.style.bottom = 'auto';
      } else if (rect.bottom > viewportHeight) {
        popupElement.style.bottom = '20px';
        popupElement.style.top = 'auto';
      }
    }
  }
  
  // If overflowing horizontally, adjust
  if (rect.left < 0) {
    popupElement.style.left = '10px';
    popupElement.style.right = 'auto';
  } else if (rect.right > viewportWidth) {
    popupElement.style.right = '10px';
    popupElement.style.left = 'auto';
  }
}

// Update the onDocumentClick to also close popup
@HostListener('document:click', ['$event'])
onDocumentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  if (this.showCredentialPopup &&
      !target.closest('.cred-info-icon') &&
      !target.closest('.credential-popup')) {
    this.showCredentialPopup = null;
  }
}

// Add window resize listener to recalculate position
@HostListener('window:resize')
onWindowResize(): void {
  if (this.showCredentialPopup) {
    this.calculatePopupPosition();
  }
}
  closeCredentialPopup(): void {
    this.showCredentialPopup = null;
    this.showApiKey = {}; 
  }

copyAppCredentials(app: any, project: any, event: Event): void {
  event.stopPropagation();
  event.preventDefault();

  let textToCopy = `External App: ${app.application_name || 'External App'}\n`;

  if (app.endpoint_urls) {
    textToCopy += `Endpoint URLs: ${app.endpoint_urls}\n`;
  }

  textToCopy += `Subscription ID: ${app.subscription_id || project.projectId || ''}\n`;

  if (app.application_id) {
    textToCopy += `Application ID: ${app.application_id}\n`;
  }

  // Always include User ID (app value or logged-in user)
  const userId = app.user_id || this.getLoggedUserId();
  if (userId && userId !== '—') {
    textToCopy += `User ID: ${userId}\n`;
  }

  // Always include Role ID (app value or logged-in user for this project)
  const roleId = app.role_id || this.getLoggedRoleId(project);
  if (roleId && roleId !== '—') {
    textToCopy += `Role ID: ${roleId}\n`;
  }

  if (app.api_key) {
    textToCopy += `API Key: ${app.api_key}\n`;
  }

  this.copyToClipboard(textToCopy.trim(), event);
}

copyToClipboard(text: string, event: Event): void {
  event.stopPropagation();
  event.preventDefault();

  if (!text) {
    console.log('error', 'Nothing to copy');
    return;
  }

  const button = event.currentTarget as HTMLElement;
  const originalHTML = button?.innerHTML;

  const showSuccess = () => {
    if (button) {
      button.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
      setTimeout(() => {
        button.classList.remove('copied');
        if (originalHTML) button.innerHTML = originalHTML;
      }, 2000);
    }
    console.log('success', 'Credentials copied to clipboard');
  };

  const showError = () => {
    console.log('error', 'Failed to copy to clipboard');
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(showSuccess)
      .catch((err) => {
        console.error('Clipboard API failed:', err);
        this.fallbackCopy(text, event, showSuccess, showError);
      });
  } else {
    this.fallbackCopy(text, event, showSuccess, showError);
  }
}

fallbackCopy(
  text: string,
  event: Event,
  onSuccess: () => void,
  onError: () => void
): void {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  textArea.setAttribute('readonly', '');
  document.body.appendChild(textArea);

  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  try {
    const successful = document.execCommand('copy');
    if (successful) {
      onSuccess();
    } else {
      onError();
    }
  } catch (err) {
    console.error('Fallback copy failed:', err);
    onError();
  } finally {
    document.body.removeChild(textArea);
  }
}

copyAllCredentials(project: any, event: Event): void {
  event.stopPropagation();
  event.preventDefault();

  let textToCopy = '';

  if (project.external_apps?.length) {
    project.external_apps.forEach((app: any, index: number) => {
      if (index > 0) textToCopy += '\n-------------------\n';

      textToCopy += `External App: ${app.application_name || 'External App'}\n`;

      if (app.endpoint_urls) {
        textToCopy += `Endpoint URLs: ${app.endpoint_urls}\n`;
      }

      textToCopy += `Subscription ID: ${app.subscription_id || project.projectId || ''}\n`;

      if (app.application_id) {
        textToCopy += `Application ID: ${app.application_id}\n`;
      }

      // Always include User ID
      const userId = app.user_id || this.getLoggedUserId();
      if (userId && userId !== '—') {
        textToCopy += `User ID: ${userId}\n`;
      }

      // Always include Role ID
      const roleId = app.role_id || this.getLoggedRoleId(project);
      if (roleId && roleId !== '—') {
        textToCopy += `Role ID: ${roleId}\n`;
      }

      if (app.api_key) {
        textToCopy += `API Key: ${app.api_key}\n`;
      }
    });
  }

  if (textToCopy.trim()) {
    this.copyToClipboard(textToCopy.trim(), event);
  } else {
    this.showToast('error', 'No credentials available to copy');
  }
}

  closeBootstrapModal(modalId: string): void {
    const modalElement = document.getElementById(modalId);
    if (modalElement) {
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) {
        modal.hide();
      } else {
        const newModal = new bootstrap.Modal(modalElement);
        newModal.hide();
      }
    }
  }

  deleteProject(projectId?: string): void {
    const id = projectId || this.selectedProject?._id || this.selectedProjectId;
    const project = projectId
      ? this.projects.find((p) => p._id === projectId)
      : this.selectedProject;

    if (project) {
      this.confirmDeleteProject(project);
    }
  }

  confirmDeleteProject(project: any): void {
    this.projectToDelete = project;
    this.showDeleteConfirmModal = true;
  }

  closeDeleteConfirmModal(): void {
    this.showDeleteConfirmModal = false;
    this.projectToDelete = null;
  }

  deleteProjectConfirmed(): void {
    const projectId = this.projectToDelete?._id;

    if (projectId) {
      this._homeService.deleteProject(projectId).subscribe({
        next: () => {
          this.showToast('success', 'AI Solution deleted successfully');
          this.closeDeleteConfirmModal();
          this.closeModal(); 
          this.loadProjects();
        },
        error: (error) => {
          console.error('Error deleting AI Solution:', error);
          this.showToast('error', 'Failed to delete AI Solution');
          this.closeDeleteConfirmModal();
        },
      });
    }
  }

  openModal(title: string, message: string): void {
    this.showToast('success', message);
  }

  validateForm(): boolean {
    if (this.projectForm.invalid) {
      // Mark all fields as touched to show validation errors
      Object.keys(this.projectForm.controls).forEach((key) => {
        const control = this.projectForm.get(key);
        if (control) {
          control.markAsTouched();
        }
      });
      return false;
    }
    return true;
  }

    switchProject(prjName: string) {
    if (!prjName) return;

    this._loadingService.show();
    const params = { prj_name: prjName };

    this._homeService.switchProject(params).subscribe({
      next: (res) => {
        this._loadingService.hide();

        setToken({ accessToken: res.data.Token, refreshToken: res.data.RefreshToken })

        if (res?.success) {
          this.activeProject = prjName;

          const userDetails = this.UserManagementData.find(
            (user) => user.Email === this.loggedUser.Email
          );
          if (userDetails && userDetails.PrjDetails) {
            const projectDetails = userDetails.PrjDetails.find(
              (p: any) => p.prj_name === prjName || p.projectName === prjName
            );
            this.roleDetail =
              projectDetails?.role_name ||
              projectDetails?.roleName ||
              this.loggedUser.Role;
          } else {
            this.roleDetail = this.loggedUser.Role;
          }

          this.loggedUser.ActiveProject = prjName;
          this.loggedUser.Role = this.roleDetail;

          this._stateService.setLoginDetails(this.loggedUser);

          if (this._router.url === '/commandcenterdashboard') {
            // Reload component without full page reload
            this._router
              .navigateByUrl('/', { skipLocationChange: true })
              .then(() => {
                this._router.navigate(['/commandcenterdashboard']);
              });
          } else {
            // Navigate normally
            this._router.navigate(['/commandcenterdashboard']);
          }

          this.cdr.detectChanges();

          console.log('Project switched:', prjName);
        } else {
          this.activeProject = prjName;
          const userDetails = this.UserManagementData.find(
            (user) => user.Email === this.loggedUser.Email
          );
          console.log('User details for role lookup:', userDetails);
          if (userDetails && userDetails.PrjDetails) {
            const projectDetails = userDetails.PrjDetails.find(
              (p: any) => p.prj_name === prjName || p.projectName === prjName
            );
            this.roleDetail =
              projectDetails?.role_name ||
              projectDetails?.roleName ||
              this.loggedUser.Role;
          } else {
            this.roleDetail = this.loggedUser.Role;
          }

          this.loggedUser.ActiveProject = prjName;

          this._stateService.setLoginDetails(this.loggedUser);

          if (this._router.url === '/commandcenterdashboard') {
            // Reload component without full page reload
            this._router
              .navigateByUrl('/', { skipLocationChange: true })
              .then(() => {
                this._router.navigate(['/commandcenterdashboard']);
              });
          } else {
            // Navigate normally
            this._router.navigate(['/commandcenterdashboard']);
          }

          this.cdr.detectChanges();

          console.log('Project switched:', prjName);
        }
      },
      error: (err) => {
        this._loadingService.hide();
        console.error('Error switching project:', err);
      },
    });
  }
  
  isSuperAdminMaster(): boolean {
    return (
      this.roleDetail?.trim() === 'Super Admin' &&
      this.activeProject?.trim().toLowerCase() ===
        this.masterDatabase.trim().toLowerCase()
    );
  }

  // Tooltip text based on projectName
  getProjectTooltip(projectName: string): string {
    return projectName === this.masterDatabase
      ? 'Master AI Solution'
      : projectName;
  }

  // Display name based on projectName
  getProjectDisplayName(projectName: string): string {
    return projectName === this.masterDatabase
      ? "Master AI Solution"
      : projectName;
  }

  onRefresh(project: any): void {
    const name = project.projectName;

    if (!this.isMasterSubscription(name)) {

      if (this.refreshingProjectNames.has(name)) return;

      this.refreshingProjectNames.add(name);
      this.cdr.detectChanges();

      const params = {
        teams: project.teams,
        user_type: project.database_name
      };

      this._homeService
        .refreshsubScriptionDetails(params)
        .pipe(
          finalize(() => {
            this.refreshingProjectNames.delete(name);
            this.cdr.detectChanges();
          })
        )
        .subscribe({
          next: (response) => {
            this.loadProjects();
            this.showToast('success', response.message || 'AI Solution details refreshed successfully');
          },
          error: (error) => {
            this.showToast('error', 'Failed to refresh AI Solution details');
          },
        });
    }
  }

  isAssignedSubscription(project: IProject) {
    const teamsAndRolesMapping = new Map(project.teams.map(item => [
      item.teamName.toLowerCase(),
      new Set(item.roles.map(item => item.role.toLowerCase()))
    ]))

    const subscriptionDetails: IProjectDetails[] = this.userSubscriptionDetails || [];

    return subscriptionDetails.some(sub =>
      sub.prj_name.toLowerCase() === project.projectName.toLowerCase() &&
      teamsAndRolesMapping.get(sub.team_name.toLowerCase())?.has(sub.role_name.toLowerCase())
    )
  }

  
  launchApp(url: string) {
    if(!url) return;
  
    const token = getCookie(ACCESS_TOKEN_KEY);

    if (!token) return;

    const redirectUri = new URL(url);

    redirectUri.searchParams.append('token', token);

    window.open(redirectUri, '_blank');
  }
  
getProjectLaunchUrl(project: any): string {
  if (!project?.external_apps?.length) return '';

  // 1. Prefer URL already stored on the project
  const storedUrl = project.external_apps[0].application_url;
  if (storedUrl && storedUrl.trim() !== '') {
    return storedUrl.trim();
  }

  // 2. Fallback: look up the URL from availableExtApps using application_id
  const appId = project.external_apps[0].application_id || project.external_apps[0].app_id;
  if (appId) {
    const matchedApp = this.availableExtApps.find(
      (app) => this.getExtAppId(app) === appId
    );
    const url = matchedApp?.application_url;
    if (url && url.trim() !== '') {
      return url.trim();
    }
  }

  return '';
}

    toggleTeamCredentials(index: number, event: Event): void {
    event.stopPropagation();
    if (this.addedTeams[index]?.externalApp) {
      this.addedTeams[index].externalApp.credentialsEnabled = !this.addedTeams[index].externalApp.credentialsEnabled;
      this.cdr.detectChanges();
    }
  }

  maskApiKey(key: string): string {
  if (!key) return '';
  return '•'.repeat(25);
}

toggleApiKeyVisibility(appId: string): void {
  this.showApiKey[appId] = !this.showApiKey[appId];
  this.cdr.detectChanges();
}

getLoggedUserId(): string {
  if (!this.loggedUser) return '—';
  return (
    this.loggedUser.user_id ||
    this.loggedUser.UserId ||
    this.loggedUser._id ||
    this.loggedUser.id ||
    this.loggedUser.Email ||
    '—'
  );
}

getLoggedRoleId(project: any): string {
  if (!this.loggedUser || !project) return '—';

  const projectDetail = this.loggedUser.ProjectDtl?.find(
    (p: any) =>
      (p.prj_name || p.projectName || '').toLowerCase() ===
      (project.projectName || '').toLowerCase()
  );

  if (projectDetail) {
    return (
      projectDetail.role_id ||
      projectDetail.RoleId ||
      projectDetail.roleId ||
      projectDetail.role_name ||  
      this.roleDetail ||
      '—'
    );
  }

  // Final fallback
  return this.roleDetail || '—';
}

getUsersMappedToProject(
  project: any,
  teamsBeingRemoved: string[] = [],
  rolesBeingRemoved: { team: string; role: string }[] = []
): any[] {
  if (!project?.projectName || !this.UserManagementData?.length) {
    return [];
  }

  const projectNameLower = (project.projectName || '').toLowerCase().trim();

  return this.UserManagementData.filter((user: any) => {
    const prjDetails = user.PrjDetails || [];
    return prjDetails.some((pd: any) => {
      const pdName = (pd.prj_name || pd.projectName || '').toLowerCase().trim();
      if (pdName !== projectNameLower) return false;

      if (teamsBeingRemoved.length === 0 && rolesBeingRemoved.length === 0) {
        return true;
      }

      const teamName = (pd.team_name || pd.teamName || '').toLowerCase().trim();
      const roleName = (pd.role_name || pd.roleName || '').toLowerCase().trim();

      if (teamsBeingRemoved.some(t => t.toLowerCase() === teamName)) {
        return true;
      }

      return rolesBeingRemoved.some(
        r =>
          r.team.toLowerCase() === teamName &&
          r.role.toLowerCase() === roleName
      );
    });
  });
}

closeMappedUsersConfirmModal(): void {
  this.showMappedUsersConfirmModal = false;
  this.mappedUsersForConfirm = [];
  this.pendingUpdateProjectData = null;

  const modalEl = document.getElementById('mappedUsersConfirmModal');
  if (modalEl) {
    const modal = bootstrap.Modal.getInstance(modalEl);
    if (modal) {
      modal.hide();
    }
  }
  this.cdr.detectChanges();
}

confirmMappedUsersAction(): void {
  if (this.mappedUsersConfirmAction === 'update' && this.pendingUpdateProjectData) {
    const { projectId, projectData } = this.pendingUpdateProjectData;
    this.executeUpdate(projectId, projectData);
  } else if (this.mappedUsersConfirmAction === 'delete' && this.projectToDelete) {
    this.deleteProjectConfirmed();
  }
  this.closeMappedUsersConfirmModal();
}
}