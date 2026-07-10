import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnInit,
  ViewChild,
} from '@angular/core';
import { RolePrivilegeMappingService } from '../services/role-privilege-mapping.service';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { NgxSpinnerService } from 'ngx-spinner';
import { HomeService } from '../services/home.service';
import { getApiError } from '../utils';

declare var $: any;

@Component({
  selector: 'app-role-privilege-mapping',
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    CommonModule,
    RouterModule,
  ],
  templateUrl: './role-privilege-mapping.html',
  styleUrl: './role-privilege-mapping.css',
})
export class RolePrivilegeMapping implements OnInit, AfterViewInit {
  @ViewChild('loadalert') loadalert?: ElementRef;

  roles: any[] = []; // Stores list of roles fetched from backend
  selectedRole: any = ''; // Holds currently selected role (default to empty)
  allPermissions: any[] = []; // Holds all roles’ permissions
  permissions: any = {}; // Stores permission mapping for selected role
  titlecase: string = 'Role Mapping';

  // Hardcoded list of pages and actions for the permission table
  pages : any[] = [];
  actions: string[] = ['view','add / create','insert / edit', 'delete','refresh','execute'];
  hasPermissionSelected: boolean = false;

  // Group pages by module
  groupedPages: any[] = [];

  Usermessage: string = '';
  popupTitle: string = 'Update Role Privilege!';
  showModal: boolean = false;
  message: string = '';
  isAdmin: boolean = false; // Flag to indicate if Admin role is selected

  projects: any[] = [];
  teams: any[] = [];
  selectedProject: any = '';
  selectedTeam: any = '';
  filteredTeams: any[] = [];
  filteredRoles: any[] = [];
  selectedProjectId: string | number = '';
  selectedTeamId: string | number = '';
  selectedRoleId: string | number = '';

  selectedAction: string = '';

  constructor(
    private _loadingService: NgxSpinnerService,
    private _homeService: HomeService,
    private _rolePrivilegeService: RolePrivilegeMappingService,
    private _stateService: AIInfuseStateService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    // Initialize grouped pages

    this.getAllPages();

    

    // Initialize permissions with all checkboxes set to false
    this.permissions = this.initEmptyPermissions();

    // Fetch user details to populate dropdowns
    this.GetUserDetails();

    this.cdr.detectChanges();
  }

  ngAfterViewInit() {
    const modalEl = document.getElementById('rolePrivilegeModal');
    if (modalEl) {
      modalEl.addEventListener('shown.bs.modal', () => {
        this.loadRoles();
        this.cdr.detectChanges();
      });

      modalEl.addEventListener('hidden.bs.modal', () => {
        this.resetModal();
        this.cdr.detectChanges();
      });
    }
  }

  getAllPages() {
    this._rolePrivilegeService.getAllPages().subscribe({
      next: (res) => {
        this.pages = res.data || [];
        const map = new Map();
          for (const p of this.pages) {
            if (!map.has(p.module)) {
              map.set(p.module, []);
            }
            map.get(p.module).push(p);
          }
          this.groupedPages = Array.from(map, ([module, pages]) => ({
            module,
            pages,
          }));
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error fetching pages:', err);
        this.pages = [];
      }
    });
  }

  resetModal() {
    // Reset all dropdowns and IDs to default
    this.selectedProject = '';
    this.selectedProjectId = '';
    this.selectedTeam = '';
    this.selectedTeamId = '';
    this.selectedRole = '';
    this.selectedRoleId = '';

    // Reset permissions to empty state
    this.permissions = this.initEmptyPermissions();
    this.hasPermissionSelected = false;

    // Reset filtered teams and roles
    this.filteredTeams = [];
    this.filteredRoles = [];

    this.cdr.detectChanges();
  }

  loadRoles() {
    // Load roles from state service or fetch from backend
    this.roles = this._stateService.getRoleManagementData() || [];
    this.projects = this._stateService.getProjectManagementData() || [];
    if (!this.roles?.length || !this.projects?.length) {
      this.GetUserDetails();
    }
    this.cdr.detectChanges();
  }

  // GetUserDetails(): void {
  // this._loadingService.show();
  // this._homeService.getUserDetails().subscribe((data: any) => {
  // if (data) {
  // this.projects = data.ProjectManagement || [];
  // this.teams = data.TeamManagement || [];
  // this.roles = data.RoleManagement || [];

  // // Do not preselect project; keep dropdowns at default
  // this.filterTeamsByProject(); // Initialize filtered teams
  // this.permissions = this.initEmptyPermissions(); // Ensure table shows with empty checkboxes
  // this._loadingService.hide();
  // this.cdr.detectChanges();
  // } else {
  // this._loadingService.hide();
  // }
  // });
  // }

  GetUserDetails(): void {
    this.projects = this._stateService.getProjectManagementData() || [];
    this.teams = this._stateService.getTeamManagementData() || [];
    this.roles = this._stateService.getRoleManagementData() || [];

    // Do not preselect project; keep dropdowns at default
    this.filterTeamsByProject(); // Initialize filtered teams
    this.permissions = this.initEmptyPermissions(); // Ensure table shows with empty checkboxes
    this._loadingService.hide();
    this.cdr.detectChanges();
  }

  onRoleChange() {
    if (this.selectedRole && this.selectedTeam && this.selectedProject) {
      // this.isAdmin = this.selectedRole.role === 'Super Admin';
      // if (this.isAdmin) {
      //   this.checkAllPermissions();
      // } else {
        // Fetch and patch permissions for the selected project, team, and role
        this.loadPermissionsForRole();
      // }
    } else {
      // If no valid selections, show table with empty checkboxes
      this.permissions = this.initEmptyPermissions();
      this.hasPermissionSelected = false;
    }
    this.cdr.detectChanges();
  }

  // isPageEditable(page: string, action: string): boolean {
  //   if (this.isAdmin) {
  //     return false;
  //   }
  //   if (
  //     action === 'view' &&
  //     (page === 'Agent Management' || page === 'Agency Management')
  //   ) {
  //     return false;
  //   }
  //   return true;
  // }

  isPageEditable(page: any, action: string): boolean {
    if (page.privileges.includes(action)) {
      return true;
    }
    return false; // Default to disabled if no specific privilege is set
  }

  checkAllPermissions() {
    for (let page of this.pages) {
      if (!this.permissions[page.page]) {
        this.permissions[page.page] = {};
      }
      for (let action of this.actions) {
        this.permissions[page.page][action] = true ;
      }
    }
    this.hasPermissionSelected = true;
    this.cdr.detectChanges();
  }

  loadPermissionsForRole() {
    this._loadingService.show();
    console.log('Loading permissions for role change:', {
      project: this.selectedProject,
      team: this.selectedTeam,
      role: this.selectedRole,
    });
    if (this.selectedProject && this.selectedTeam && this.selectedRole) {
      let request_json={
        "ProjectId": this.selectedProject.projectId,
        "TeamId": this.selectedTeam.teamName,
        "RoleId": this.selectedRole.role
      }
      this._rolePrivilegeService.getPermissionsForRole(request_json).subscribe({
        next: (res:any) => {
          this.allPermissions = res.data?.permissions || [];
          console.log('Fetched Permissions from API:', res.data);
          this._stateService.setRolePrivilegeData(this.allPermissions);
          this._rolePrivilegeService.setPrivileges(this.allPermissions);
          // Patch permissions if valid selections exist

          this.permissions = res.data?.permissions || this.initEmptyPermissions();
          this.cdr.detectChanges();
            // this.setPermissionsForRole(
            //   this.allPermissions
            // );

          this._loadingService.hide();
        },
        error: (err) => {
          console.error('Error loading permissions:', err);
          this.permissions = this.initEmptyPermissions();
          this.hasPermissionSelected = false;
          this._loadingService.hide();
        },
      });
    } else {
      // If no valid selections, show table with empty checkboxes
      this.Usermessage = 'Please select AI Solution, Team, and Role to view permissions.';
      this.permissions = this.initEmptyPermissions();
      this.hasPermissionSelected = false;
      this._loadingService.hide();
    }
  }

  // setPermissionsForRole(project: any, team: any, role: any) {
  //   const projectId = project?.ProjectId || project?.projectId || project;
  //   const teamId = team?.TeamId || team?.teamId || team;
  //   const roleId = role?.RoleId || role?.roleId || role;

  //   const rolePermission = this.allPermissions.find(
  //     (r) =>
  //       String(r.ProjectId) === String(projectId) &&
  //       String(r.TeamId) === String(teamId) &&
  //       String(r.RoleId) === String(roleId)
  //   );

  //   console.log('Matched Permission Entry:', rolePermission);

  //   if (rolePermission && rolePermission.permissions) {
  //     this.permissions = {};
  //     for (let page of this.pages) {
  //       this.permissions[page.page] = {};
  //       for (let action of this.actions) {
  //         const normalizedKey = Object.keys(
  //           rolePermission.permissions[page.page] || {}
  //         ).find(
  //           (k) =>
  //             k.replace(/\s+/g, '').toLowerCase() ===
  //             action.replace(/\s+/g, '').toLowerCase()
  //         );
  //         this.permissions[page.page][action] =
  //           rolePermission.permissions[page.page]?.[normalizedKey ?? action] ??
  //           false;
  //       }
  //     }
  //     this.hasPermissionSelected = Object.values(this.permissions).some(
  //       (p: any) =>
  //         Object.values(p as Record<string, boolean>).some((val) => val)
  //     );
  //   } else {
  //     // If no permissions exist for the combination, initialize with empty checkboxes
  //     this.permissions = this.initEmptyPermissions();
  //     this.hasPermissionSelected = false;
  //   }

  //   // Ensure Agent Management and Agency Management have view permission set to true
  //   if (this.permissions['Agent Management']) {
  //     this.permissions['Agent Management']['view'] = true;
  //   }
  //   if (this.permissions['Agency Management']) {
  //     this.permissions['Agency Management']['view'] = true;
  //   }

  //   this.cdr.detectChanges();
  // }

  //not in use 
    setPermissionsForRole(all_permissions: any) {
    
    let new_permissions:any[] = [
      { 
        module: 'Command Center', 
        page: 'Command Center',
        privileges:{
          'view': true,
          } 
      },
      { 
        module: 'Command Center', 
        page: 'Chatbot',
        privileges: {
          'view': true,
          'execute': true
        }
      },
      { 
        module: 'Market Place', 
        page: 'Agent Management',
        privileges: {
          'view': true,
          'insert / edit': false,
          'delete': true,
        }
      },
      { 
        module: 'Market Place', 
        page: 'Agency Management',
        privileges: {
          'view': true,
          'insert / edit': true,
          'delete': true,
        } 
      }
    ]
    for (let page of new_permissions) {
      for (let action of this.actions) {
        if (action in page.privileges) {
          this.permissions[page.page][action] = page.privileges[action];
        } else {
          this.permissions[page.page][action] = false;
        }
      }
    }

    this.cdr.detectChanges();
  }

  initEmptyPermissions() {
    const empty: any = {};
    for (let page of this.pages) {
      empty[page.page] = {};
      for (let action of this.actions) {
          empty[page.page][action] = false;
      }
    }
    return empty;
  }

  togglePermission(page: string, action: string) {
    if (!this.permissions) {
      this.permissions = {};
    }
    if (!this.permissions[page]) {
      this.permissions[page] = {};
    }
    if (this.permissions[page][action] === undefined) {
      this.permissions[page][action] = false;
    }
    this.permissions[page][action] = !this.permissions[page][action];

    this.hasPermissionSelected = Object.values(this.permissions).some(
      (p: any) => Object.values(p as Record<string, boolean>).some((val) => val)
    );
    this.cdr.detectChanges();
  }

  savePrivilegeDetails() {
    this._loadingService.show();

    if (!this.selectedProject || !this.selectedTeam || !this.selectedRole) {
      this.openModal(
        'exampleModalLabel1',
        'Please select AI Solution, Team, and Role before saving.'
      );
      this._loadingService.hide();
      return;
    }

    const projectId =
      this.selectedProject?.projectId ||
      this.selectedProject?.ProjectId ||
      this.selectedProject;
    const teamId =
      this.selectedTeam?.teamId ||
      this.selectedTeam?.TeamId ||
      this.selectedTeam;
    const roleId =
      this.selectedRole?.roleId ||
      this.selectedRole?.RoleId ||
      this.selectedRole;

    console.log('Updating Permissions with:', { projectId, teamId, roleId });

    let request_json={
      "ProjectId": projectId,
      "TeamId": teamId.teamName ? teamId.teamName : '',
      "RoleId": roleId.role ? roleId.role : '',
      "permissions": this.permissions
    }

    this._rolePrivilegeService
      .updatePermissions(request_json)
      .subscribe({
        next: () => {
          this.loadPermissionsForRole();
          this.loadRoles();
          this.openModal(
            'exampleModalLabel1',
            'Permissions updated successfully!'
          );
          this.selectedAction = '';
        },
        error: (err) => {
          console.error('Error updating permissions:', err);
          const error = getApiError(err);
          if (error) {
            this.openModal(
              'exampleModalLabel1',
              'Failed to update permissions.'
            );
            return;
          }
          this.openModal('exampleModalLabel1', 'Failed to update permissions.');
        },
        complete: () => {
          this._loadingService.hide();
          this.cdr.detectChanges();
        },
      });
  }

  openModal(messageId: string, Usermessage: string) {
    this.showModal = true;
    this.Usermessage = Usermessage;
    if (this.loadalert && this.loadalert.nativeElement) {
      const modalElement1 = this.loadalert.nativeElement;
      $(modalElement1).modal('show');
    }
  }

  closeModal() {
    this.showModal = false;
    this.message = '';
  }

  closealert(): void {
    this.resetModal();
    this.showModal = false;
    this.message = '';
    this.popupTitle = '';
    if (this.loadalert && this.loadalert.nativeElement) {
      const modalElement1 = this.loadalert.nativeElement;
      $(modalElement1).modal('hide');
    }
  }

  onProjectChange(): void {
    if (this.selectedProject) {
      const projectObj = this.projects.find(
        (p) =>
          p.projectName === this.selectedProject?.projectName ||
          p.projectName === this.selectedProject
      );
      if (projectObj) {
        this.selectedProject = projectObj;
        this.selectedProjectId =
          projectObj.ProjectId || projectObj.projectId || projectObj.project_id;
        this.teams = projectObj.teams || [];
        this.filteredTeams = this.teams;
        this.selectedTeam = '';
        this.selectedTeamId = '';
        this.roles = [];
        this.selectedRole = '';
        this.selectedRoleId = '';
        this.permissions = this.initEmptyPermissions();
        this.hasPermissionSelected = false;
        if (this.teams.length > 0) {
          this.onTeamChange();
        }
      } else {
        this.teams = [];
        this.filteredTeams = [];
        this.selectedTeam = '';
        this.selectedTeamId = '';
        this.roles = [];
        this.selectedRole = '';
        this.selectedRoleId = '';
        this.permissions = this.initEmptyPermissions();
        this.hasPermissionSelected = false;
      }
    } else {
      this.teams = [];
      this.filteredTeams = [];
      this.selectedTeam = '';
      this.selectedTeamId = '';
      this.roles = [];
      this.selectedRole = '';
      this.selectedRoleId = '';
      this.permissions = this.initEmptyPermissions();
      this.hasPermissionSelected = false;
    }
    this.cdr.detectChanges();
  }

  onTeamChange(): void {
    if (this.selectedTeam) {
      const teamObj = this.teams.find(
        (t) =>
          t.teamName === this.selectedTeam?.teamName ||
          t.teamName === this.selectedTeam
      );
      if (teamObj) {
        this.selectedTeam = teamObj;
        this.selectedTeamId =
          teamObj.TeamId || teamObj.teamId || teamObj.team_id;
        this.roles = teamObj.roles || [];
        this.filteredRoles = this.roles;
        this.selectedRole = '';
        this.selectedRoleId = '';
        this.permissions = this.initEmptyPermissions();
        this.hasPermissionSelected = false;
        if (this.roles.length > 0) {
          this.onRoleChange();
        }
      } else {
        this.roles = [];
        this.filteredRoles = [];
        this.selectedRole = '';
        this.selectedRoleId = '';
        this.permissions = this.initEmptyPermissions();
        this.hasPermissionSelected = false;
      }
    } else {
      this.roles = [];
      this.filteredRoles = [];
      this.selectedRole = '';
      this.selectedRoleId = '';
      this.permissions = this.initEmptyPermissions();
      this.hasPermissionSelected = false;
    }
    this.cdr.detectChanges();
  }

  filterTeamsByProject(): void {
    if (this.selectedProject && this.selectedProjectId) {
      this.filteredTeams = this.teams.filter(
        (t) =>
          t.ProjectId === this.selectedProjectId ||
          t.projectId === this.selectedProjectId ||
          t.project_id === this.selectedProjectId
      );
    } else {
      this.filteredTeams = [];
    }
    this.cdr.detectChanges();
  }

  filterRolesByTeam(): void {
    if (this.selectedTeam) {
      const teamObj = this.filteredTeams.find(
        (t) =>
          t.TeamName === this.selectedTeam ||
          t.teamName === this.selectedTeam ||
          t.team_name === this.selectedTeam
      );
      if (teamObj) {
        const teamId = teamObj.TeamId || teamObj.teamId || teamObj.team_id;
        this.filteredRoles = this.roles.filter(
          (r) =>
            r.TeamId === teamId || r.teamId === teamId || r.team_id === teamId
        );
      } else {
        this.filteredRoles = [];
      }
    } else {
      this.filteredRoles = [];
    }
  }

  selectPrivilegesBasedOnAction(): void {
    if (this.selectedAction === 'view') {
      for (let page of this.pages) {
        for (let action of this.actions) {
          if (action === 'view' && page.privileges.includes('view')) {
            this.permissions[page.page][action] = true;
          } else {
            this.permissions[page.page][action] = false;
          } 
        }
      }
      this.hasPermissionSelected = true;
      this.cdr.detectChanges();
    } else if (this.selectedAction === 'all') {
      for (let page of this.pages) {
        for (let action of this.actions) {
          console.log('permissionssss',this.permissions)
          if (page.privileges.includes(action)) {
            this.permissions[page.page][action] = true;
          } else {
            this.permissions[page.page][action] = false;
          }
        }
      }
      this.hasPermissionSelected = true;
      this.cdr.detectChanges();
    } else if (this.selectedAction === 'reset') {
      this.permissions = this.initEmptyPermissions();
      this.hasPermissionSelected = false;
      this.cdr.detectChanges();
    } else {
      // For any other action, do not change permissions
    }
    
    this.cdr.detectChanges();
  }

  isModuleFullySelected(group: any): boolean {
    for (let page of group.pages) {
      for (let priv of page.privileges) {
        if (!this.permissions[page.page]?.[priv]) {
          return false;
        }
      }
    }
    return true;
  }

  toggleModulePermissions(group: any): void {
    const fullySelected = this.isModuleFullySelected(group);
    for (let page of group.pages) {
      for (let action of this.actions) {
        if (page.privileges.includes(action)) {
          this.permissions[page.page][action] = !fullySelected;
        } else {
          this.permissions[page.page][action] = false;
        }
      }
    }
    this.hasPermissionSelected = Object.values(this.permissions).some(
      (p: any) => Object.values(p as Record<string, boolean>).some((val) => val)
    );
    this.cdr.detectChanges();
  }
}
