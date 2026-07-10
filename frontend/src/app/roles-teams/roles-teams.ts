import {
  ChangeDetectorRef,
  Component,
  inject,
  OnInit,
  signal,
  WritableSignal,
} from '@angular/core';
import { Header } from '../header/header';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { NgxSpinnerService } from 'ngx-spinner';
import { DatePipe } from '@angular/common';
import { debounceWatch, getApiError } from '../utils';
import { IRole, ITeam, IUpdateRoleRequest, IUpdateTeamRequest } from '../types';
import { FormError } from '../components/form-error/form-error';
import { RolesTeamsService } from '../services/roles-teams.service';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { ToastService } from '../services/toast.service';
import { Toast } from '../components/toast/toast';

declare var bootstrap: any;
interface PaginatedState<T> {
  searchTerm: WritableSignal<string>;
  data: T[];
  paginatedData: T[];
  filteredData: T[];
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

type TABS = 'roles' | 'teams';

const initialState = {
  searchTerm: '',
  data: [],
  paginatedData: [],
  filteredData: [],
  page: 1,
  pageSize: 10,
  totalRecords: 0,
  totalPages: 0,
  startIndex: 0,
  endIndex: 0,
};

@Component({
  selector: 'app-roles-teams',
  imports: [
    Header,
    FormsModule,
    DatePipe,
    ReactiveFormsModule,
    FormError,
    Toast,
  ],
  templateUrl: './roles-teams.html',
  styleUrl: './roles-teams.css',
})
export class RolesTeams implements OnInit {
  private loadingService = inject(NgxSpinnerService);
  private rolesTeamsService = inject(RolesTeamsService);
  private state = inject(AIInfuseStateService);
  private cdr = inject(ChangeDetectorRef);
  private formBuilder = inject(FormBuilder);

  toast = inject(ToastService);
  activeTab: TABS = 'roles';

  roles: PaginatedState<IRole> = {
    ...initialState,
    searchTerm: signal(''),
  };
  teams: PaginatedState<ITeam> = {
    ...initialState,
    searchTerm: signal(''),
  };
  pageSizeOptions = [10, 20, 30, 40, 50];

  roleForm!: FormGroup;
  selectedRole?: IRole = undefined;

  teamForm!: FormGroup;
  selectedTeam?: ITeam = undefined;

  constructor() {
    debounceWatch(this.roles.searchTerm, () => {
      this.filterData('roles');
    });
    debounceWatch(this.teams.searchTerm, () => {
      this.filterData('teams');
    });
  }

  private validateDuplicateRole(
    control: AbstractControl,
  ): ValidationErrors | null {
    if (!control.value) return null;

    if (
      this.selectedRole &&
      this.selectedRole.RoleName.toLowerCase() === control.value.toLowerCase()
    )
      return null;

    const item = this.roles.data.find(
      (item) => item.RoleName.toLowerCase() === control.value.toLowerCase(),
    );
    return item ? { duplicate: true } : null;
  }

  private validateDuplicateTeam(
    control: AbstractControl,
  ): ValidationErrors | null {
    if (!control.value) return null;

    if (
      this.selectedTeam &&
      this.selectedTeam.TeamName.toLowerCase() === control.value.toLowerCase()
    )
      return null;

    const item = this.teams.data.find(
      (item) => item.TeamName.toLowerCase() === control.value.toLowerCase(),
    );
    return item ? { duplicate: true } : null;
  }

  ngOnInit(): void {
    this.fetchRoles();
    this.fetchTeams();
    this.roleForm = this.formBuilder.group({
      roleName: this.formBuilder.control('', {
        nonNullable: true,
        validators: [
          Validators.required,
          this.validateDuplicateRole.bind(this),
        ],
      }),
    });
    this.teamForm = this.formBuilder.group({
      teamName: this.formBuilder.control('', {
        nonNullable: true,
        validators: [
          Validators.required,
          this.validateDuplicateTeam.bind(this),
        ],
      }),
    });
  }

  setActiveTab(tab: TABS) {
    this.activeTab = tab;
  }

  //  filter and pagination
  paginate(key: TABS): void {
    this[key].startIndex = (this[key].page - 1) * this[key].pageSize;
    this[key].endIndex = Math.min(
      +this[key].startIndex + +this[key].pageSize,
      this[key].filteredData.length,
    );
    this[key].paginatedData = this[key].filteredData.slice(
      this[key].startIndex,
      this[key].endIndex,
    );
    this.cdr.detectChanges();
  }

  filterData(key: TABS): void {
    if (!this[key].searchTerm()) {
      this[key].filteredData = [...this[key].data] as IRole[] | ITeam[];
    } else {
      this[key].page = 1;
      this[key].filteredData = this[key].data.filter((item) => {
        if (key === 'roles' && 'RoleName' in item) {
          return item.RoleName.toLowerCase().includes(
            this[key].searchTerm().toLowerCase(),
          );
        }

        if (key === 'teams' && 'TeamName' in item) {
          return item.TeamName.toLowerCase().includes(
            this[key].searchTerm().toLowerCase(),
          );
        }

        return false;
      }) as IRole[] | ITeam[];
    }

    this[key].totalRecords = this[key].filteredData.length;
    this[key].totalPages =
      Math.ceil(this[key].totalRecords / this[key].pageSize) || 1;
    this[key].page = 1;
    this.paginate(key);
  }

  prevPage(key: TABS) {
    if (this[key].page > 1) {
      this[key].page--;
      this.paginate(key);
    }
  }

  nextPage(key: TABS) {
    if (this[key].page < this[key].totalPages) {
      this[key].page++;
      this.paginate(key);
    }
  }

  goToPage(page: number, key: TABS) {
    if (page >= 1 && page <= this[key].totalPages) {
      this[key].page = page;
      this.paginate(key);
    }
  }

  fetchRoles(): void {
    this.loadingService.show();

    this.rolesTeamsService.fetchRoles().subscribe({
      next: (response) => {
        if (response?.success) {
          this.roles.data =
            response.data?.sort((a, b) => a.RoleId - b.RoleId) || [];
        } else {
          this.roles.data = [];
          console.error('Failed to load roles:', response?.message);
        }

        this.filterData('roles');
        this.loadingService.hide();
      },
      error: (error) => {
        console.error('Error loading teams and roles:', error);
        this.loadingService.hide();
        this.roles.data = [];
      },
    });
  }

  fetchTeams(): void {
    this.loadingService.show();

    this.rolesTeamsService.fetchTeams().subscribe({
      next: (response) => {
        if (response?.success) {
          this.teams.data =
            response.data?.sort((a, b) => a.TeamId - b.TeamId) || [];
        } else {
          this.teams.data = [];
          console.error('Failed to load teams:', response?.message);
        }

        this.filterData('teams');
        this.loadingService.hide();
      },
      error: (error) => {
        console.error('Error loading teams and roles:', error);
        this.loadingService.hide();
        this.teams.data = [];
      },
    });
  }

  // roles
  closeRoleForm() {
    this.roleForm.reset({ roleName: '' });
    this.selectedRole = undefined;
  }

  updateRole(payload: IUpdateRoleRequest) {
    this.loadingService.show();
    this.rolesTeamsService.updateRole(payload).subscribe({
      next: (res) => {
        if (!res?.success) {
          this.toast.showToast('error', res?.message || 'Something went wrong');
        }
        this.loadingService.hide();
        this.fetchRoles();
        bootstrap.Modal.getInstance(
          document.getElementById('roles-modal'),
        )?.hide();

        this.closeRoleForm();
        this.toast.showToast('success', 'Role updated successfully');
      },
      error: (err) => {
        const error = getApiError(err.error);
        this.toast.showToast('error', error?.message || 'Something went wrong');
        bootstrap.Modal.getInstance(
          document.getElementById('roles-modal'),
        )?.hide();
        this.loadingService.hide();
      },
    });
  }

  createRole() {
    if (this.roleForm.invalid) return;

    if (this.selectedRole) {
      this.updateRole({
        role_id: this.selectedRole.RoleId,
        RoleName: this.roleForm.value.roleName,
        IsActive: this.selectedRole.IsActive,
      });
      return;
    }

    this.loadingService.show();

    this.rolesTeamsService
      .createRole({
        Created_By: this.state.getLoginDetails().Role,
        IsActive: true,
        RoleName: this.roleForm.value.roleName,
      })
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.showToast(
              'error',
              res?.message || 'Something went wrong',
            );
          }
          this.loadingService.hide();
          this.fetchRoles();
          bootstrap.Modal.getInstance(
            document.getElementById('roles-modal'),
          )?.hide();

          this.closeRoleForm();
          this.toast.showToast('success', 'Roles created successfully');
        },
        error: (err) => {
          this.toast.showToast(
            'error',
            err?.error?.error || 'Something went wrong',
          );
          bootstrap.Modal.getInstance(
            document.getElementById('roles-modal'),
          )?.hide();
          this.loadingService.hide();
        },
      });
  }

  editRole(role: IRole) {
    this.selectedRole = role;
    this.roleForm.patchValue({ roleName: role.RoleName });
    const instance = new bootstrap.Modal(
      document.getElementById('roles-modal'),
    );
    instance.show();
  }

  deleteRole(role: IRole) {
    this.loadingService.show();
    this.rolesTeamsService.deleteRole(role.RoleId).subscribe({
      next: (res) => {
        if (!res?.success) {
          this.toast.showToast('error', res?.message || 'Something went wrong');
        }
        this.loadingService.hide();
        this.fetchRoles();
        bootstrap.Modal.getInstance(
          document.getElementById('roles-modal'),
        )?.hide();

        this.closeRoleForm();
        this.toast.showToast('success', 'Role deleted successfully');
      },
      error: (err) => {
        this.toast.showToast(
          'error',
          err?.error?.error || 'Something went wrong',
        );
        bootstrap.Modal.getInstance(
          document.getElementById('roles-modal'),
        )?.hide();
        this.loadingService.hide();
      },
    });
  }

  // teams
  closeTeamsForm() {
    this.teamForm.reset({ teamName: '' });
    this.selectedTeam = undefined;
  }

  updateTeam(payload: IUpdateTeamRequest) {
    this.loadingService.show();
    this.rolesTeamsService.updateTeam(payload).subscribe({
      next: (res) => {
        if (!res?.success) {
          this.toast.showToast('error', res?.message || 'Something went wrong');
        }
        this.loadingService.hide();
        this.fetchTeams();
        bootstrap.Modal.getInstance(
          document.getElementById('teams-modal'),
        )?.hide();

        this.closeTeamsForm();
        this.toast.showToast('success', 'Team updated successfully');
      },
      error: (err) => {
        this.toast.showToast(
          'error',
          err?.error?.error || 'Something went wrong',
        );
        bootstrap.Modal.getInstance(
          document.getElementById('teams-modal'),
        )?.hide();
        this.loadingService.hide();
      },
    });
  }

  createTeam() {
    if (this.teamForm.invalid) return;

    if (this.selectedTeam) {
      this.updateTeam({
        team_id: this.selectedTeam.TeamId,
        TeamName: this.teamForm.value.teamName,
        IsActive: this.selectedTeam.IsActive,
      });
      return;
    }

    this.loadingService.show();
    this.rolesTeamsService
      .createTeam({
        TeamName: this.teamForm.value.teamName,
        Created_By: this.state.getLoginDetails().Role,
        IsActive: true,
      })
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.showToast(
              'error',
              res?.message || 'Something went wrong',
            );
          }
          this.loadingService.hide();
          this.fetchTeams();
          bootstrap.Modal.getInstance(
            document.getElementById('teams-modal'),
          )?.hide();

          this.closeTeamsForm();
          this.toast.showToast('success', 'Teams created successfully');
        },
        error: (err) => {
          this.toast.showToast(
            'error',
            err?.error?.error || 'Something went wrong',
          );
          bootstrap.Modal.getInstance(
            document.getElementById('teams-modal'),
          )?.hide();
          this.loadingService.hide();
        },
      });
  }

  editTeam(team: ITeam) {
    this.selectedTeam = team;
    this.teamForm.patchValue({ teamName: team.TeamName });
    const instance = new bootstrap.Modal(
      document.getElementById('teams-modal'),
    );
    instance.show();
  }

  deleteTeam(team: ITeam) {
    this.loadingService.show();
    this.rolesTeamsService.deleteTeam(team.TeamId).subscribe({
      next: (res) => {
        if (!res?.success) {
          this.toast.showToast('error', res?.message || 'Something went wrong');
        }
        this.loadingService.hide();
        this.fetchTeams();
        bootstrap.Modal.getInstance(
          document.getElementById('teams-modal'),
        )?.hide();

        this.closeTeamsForm();
        this.toast.showToast('success', 'Team deleted successfully');
      },
      error: (err) => {
        this.toast.showToast(
          'error',
          err?.error?.error || 'Something went wrong',
        );
        bootstrap.Modal.getInstance(
          document.getElementById('teams-modal'),
        )?.hide();
        this.loadingService.hide();
      },
    });
  }
}
