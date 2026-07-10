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
import { finalize,forkJoin } from 'rxjs';
import { Header } from '../header/header';
import { TooltipDirective } from '../custom-tooltip/tooltip.directive';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { environment as config } from '../../environments/environment';
import { Router } from '@angular/router';
import { V } from '../utils';
import { FormError } from "../components/form-error/form-error";
import { IProject, IProjectDetails } from '../types';

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
    FormError,
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
  masterDatabase:string = config.masterDatabase;
  masterprojectName = config.masterprojectName;
  masterdatabaseName = config.masterdatabaseName;
  masterProjectDisplayName:string = config.masterProjectDisplayName;
  UserManagementData: any[] = [];
  refreshingProjectNames = new Set<string>();
  isPrivilegeView: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeRefresh: boolean = false;
  isPrivilegeExecute: boolean = false;

  constructor(
    private fb: FormBuilder,
    private _homeService: HomeService,
    private _loadingService: NgxSpinnerService,
    private _router: Router,
    private cdr: ChangeDetectorRef,
    private _stateService: AIInfuseStateService
  ) {
    this.projectForm = this.fb.group({
      projectName: ['', Validators.required],
      description: ['', Validators.required],
      dateCreated: [''],
      dateUpdated: [''],
      app_url: ['', V.string("Application URL").url().build()],
      // project_db_name: ['', Validators.required]
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
    p.prj_name?.trim().toLowerCase() === this.loggedUser.ActiveProject?.trim().toLowerCase())?.role_name || "Super Admin";

    this.roleDetail = userRoleDtls;
    this.activeProject = this.loggedUser.ActiveProject || this.masterProjectDisplayName;
    this.userSubscriptionDetails = this.loggedUser.ProjectDtl;

    this.loadProjects();
    this.loadTeamsAndRoles(); // Load teams and roles on component initialization
    this.loadPrivileges();
  }

  loadPrivileges() {
    this._stateService.getPrivilegesByPage('Subscription').subscribe({
      next: (loaded_privileges:any) => {
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

  /// Get full description for tooltip
  getFullDescription(project: any): string {
    const description = project.project_desc || project.description;
    return description || 'No description available';
  }

  // Get truncated description for display
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

  // Check if tooltip should be shown
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
    // REMOVED: this._loadingService.show();

    forkJoin({
      teams: this._homeService.getAllTeams(),
      roles: this._homeService.getAllRoles(),
    }).subscribe({
      next: (response) => {
        // Handle teams response
        if (response.teams?.success) {
          this.availableTeams = response.teams.data || [];
        }
        // Handle roles response
        if (response.roles?.data) {
          this.availableRoles = response.roles.data || [];
        }

        console.log('Loaded teams:', this.availableTeams);
        console.log('Loaded roles:', this.availableRoles);

        // REMOVED: this._loadingService.hide();
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading teams and roles:', error);
        // REMOVED: this._loadingService.hide();
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

        // Filter out master database projects
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

          console.log('userSubscriptionDetails',this.userSubscriptionDetails)
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

          return { ...project, active , greendot_active};
        });

        console.log('Enriched projects with active status:', enrichedProjects);
        if (this.roleDetail?.trim() !== 'Super Admin') {

          if(IsMatestProject.length > 0){
            this.projects = enrichedProjects;
          }
          else{

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
  }

  openEditModal(project: any): void {
    // Check if this is a master project before opening edit modal
    if (this.isMasterProject(project)) {
      this.showToast('error', 'Cannot edit master database AI Solution.');
      return;
    }

    this.selectedProject = project;
    this.selectedProjectId = project._id;

    // Use backend field names directly
    const description = project.project_desc || project.description || '';
    const databaseName = project.database_name || ''; // Backend uses database_name

    this.projectForm.patchValue({
      projectName: project.projectName,
      description: description,
      dateCreated: project.dateCreated,
      dateUpdated: project.dateUpdated,
      app_url: project.app_url,
      project_db_name: databaseName, // Map backend's database_name to frontend's project_db_name
    });

    // Properly initialize addedTeams with existing teams
    this.addedTeams = (project.teams || []).map((t: any) => ({
      teamName: t.teamName || t.TeamName,
      roles: t.roles || t.Roles || [],
    }));

    this.showEditModal = true;
    this.currentStep = 1; // Reset to step 1 when opening edit modal

    // Ensure teams and roles are loaded
    if (this.availableTeams.length === 0 || this.availableRoles.length === 0) {
      this.loadTeamsAndRoles();
    }
  }

  // Helper method to check if a project is a master project
  private isMasterProject(project: any): boolean {
    const MASTER_PROJECTS = {
      projectNames: this.masterprojectName,
      databaseNames:this.masterdatabaseName
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
  }

  // ------------------ Team & Roles ------------------
  addTeamAndRoles(): void {
    // Validate team and roles before adding
    if (!this.selectedTeam || this.selectedTeam === '') {
      this.teamSelectionInvalid = true;
      return;
    }

    if (this.selectedRoles.length === 0) {
      this.teamSelectionInvalid = true;
      return;
    }

    // Reset validation if everything is valid
    this.teamSelectionInvalid = false;

    if (this.selectedTeam && this.selectedRoles.length > 0) {
      const team = {
        teamName: this.selectedTeam,
        roles: this.selectedRoles.map((role) => ({ role })),
      };

      // Check if team already exists
      const existingTeamIndex = this.addedTeams.findIndex(
        (t) => t.teamName === team.teamName
      );
      if (existingTeamIndex > -1) {
        // Update existing team's roles
        this.addedTeams[existingTeamIndex].roles = [
          ...this.addedTeams[existingTeamIndex].roles,
          ...team.roles,
        ];
        // Remove duplicate roles
        this.addedTeams[existingTeamIndex].roles = this.addedTeams[
          existingTeamIndex
        ].roles.filter(
          (role: any, index: number, self: any[]) =>
            index === self.findIndex((r: any) => r.role === role.role)
        );
      } else {
        // Add new team
        this.addedTeams.push(team);
      }

      this.selectedTeam = '';
      this.selectedRoles = [];
    }
  }

  removeTeam(index: number): void {
    this.addedTeams.splice(index, 1);
  }

  editTeam(index: number): void {
    const team = this.addedTeams[index];
    this.selectedTeam = team.teamName;
    this.selectedRoles = team.roles.map((r: any) => r.role);
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
    // Check for duplicate names before saving
    this.checkProjectNameDuplicate();
    this.checkProjectDbNameDuplicate(); // Add this line

    if (this.isProjectNameDuplicate || this.isProjectDbNameDuplicate) {
      // Update this condition
      return;
    }

    // Show validation for teams if none are added
    if (this.addedTeams.length === 0) {
      this.teamsValidationShown = true;
      return;
    }

    if (this.projectForm.valid && this.addedTeams.length > 0) {
      // Prepare data in backend expected format
      const projectData = {
        projectName: this.projectForm.value.projectName,
        project_desc: this.projectForm.value.description,
        app_url: this.projectForm.value.app_url,
        description: this.projectForm.value.description,
        project_db_name: this.projectForm.value.project_db_name,
        database_name: this.projectForm.value.project_db_name,
        teams: this.addedTeams,
      };

      console.log('Creating AI Solution with data:', projectData);

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

    const projectData = {
      projectName: this.projectForm.value.projectName,
      project_desc: this.projectForm.value.description,
      description: this.projectForm.value.description,
      app_url: this.projectForm.value.app_url,
      project_db_name: this.projectForm.value.project_db_name,
      database_name: this.projectForm.value.project_db_name,
      teams:
        this.addedTeams.length > 0
          ? this.addedTeams
          : this.selectedProject?.teams || [],
    };

    console.log('Updating AI Solution with data:', projectData);
    console.log('Project ID:', projectId);

    this._homeService.updateProject(projectId, projectData).subscribe({
      next: (response) => {
        console.log('Update successful:', response.data);
        this.showToast('success', 'AI Solution updated successfully');

        // Close the Bootstrap modal
        this.closeBootstrapModal('editProjectModal');

        // Reset form and load projects
        this.resetForm();
        this.loadProjects();
      },
      error: (error) => {
          let errorMessage = error.error?.message || 'Failed to update AI Solution';
          console.error('Error creating AI Solution:', error);
          this.showToast('error', errorMessage);
      },
    });
  }

  closeBootstrapModal(modalId: string): void {
    const modalElement = document.getElementById(modalId);
    if (modalElement) {
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) {
        modal.hide();
      } else {
        // If no instance exists, create one and hide it
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
          this.closeModal(); // Also close edit modal if open
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

  isAssignedSubscription(project: IProject ) {
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
  
}
