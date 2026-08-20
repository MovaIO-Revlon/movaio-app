import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnInit,
  ViewChild,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { NgxSpinnerService } from 'ngx-spinner';
import { CommonModule, DatePipe } from '@angular/common';
import { HomeService } from '../services/home.service';
import { Router, RouterModule } from '@angular/router';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
// import config from '../../assets/config/config.json';
import { NgxPaginationModule } from 'ngx-pagination';
import { environment as config } from '../../environments/environment';
import { RolePrivilegeMappingService } from '../services/role-privilege-mapping.service';
import { RolePrivilegeMapping } from '../role-privilege-mapping/role-privilege-mapping';
import { getApiError } from '../utils';
import { Popover } from '../components/popover/popover';
import { logout } from '../services/auth.interceptor';

declare var $: any;
declare var bootstrap: any;

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    NgxPaginationModule,
    RouterModule,
    RolePrivilegeMapping,
    Popover
  ],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header implements OnInit, AfterViewInit {
  myForm: FormGroup | undefined;
  onboardForm!: FormGroup;
  changePasswordForm!: FormGroup;
  passwordChangeForm!: FormGroup;
  OnboardProjectMaster!: FormGroup;

  @ViewChild('onBoardUser') onBoardUser?: ElementRef;
  @ViewChild('loadalert') loadalert?: ElementRef;
  @ViewChild('confirmationModal') confirmationModal?: ElementRef;
  @ViewChild('changePasswordModal') changePasswordModal?: ElementRef;
  @ViewChild('fileInput') fileInput!: ElementRef;
  @ViewChild('editProfileModal') editProfileModal!: ElementRef;

  UserManagementGridData: any[] = [];
  UserManagementGridDataORG: any[] = [];
  RoleManagementData: any[] = [];
  TeamManagementData: any[] = [];
  ProjectManagementData: any[] = [];
  TeamManagementDtls: string[] = [];
  loggedUser: any;
  userName: any;
  userRole: any;
  roleId: any;
  roleDetail: string = '';
  emailID: any;
  avatarPath: string = '';
  showModal: boolean = false;
  Usermessage: string = '';
  UserheaderCaption: string = 'Onboard User';
  buttonCaption: string = 'Onboard User';
  IsUserEdit: boolean = false;
  popupTitle: string = '';
  ConfirmationValue: string = '';
  employeeId: any;
  employeeName: string = '';
  baseHomeURLOld: string = '';
  baseHomeURL = `${window.location.origin}/commandcenterdashboard`;
  createdDate: any;
  isPasswordVisible: boolean = false;
  IsValue: boolean = false;
  currentPassword: string = '';
  newPassword: string = '';
  confirmPassword: string = '';
  EmailId: string = '';
  showdanger: string = '';
  passwordMismatch: boolean = false;
  passwordSameError: boolean = false;
  message = '';
  passwordError = '';
  popupClose: boolean = false;
  HoursSpentDtls: string = '';
  isEmpCaptionVisible: boolean = true;
  isMultipleOnboardVisible: boolean = false;
  selectedFile: File | undefined;
  selectedFileName: string = '';
  fileValidationMessage = '';
  isFileSelected = false;
  uploadText: string = '';
  isShowUploadText: boolean = false;
  uploadTextColor: string = '';
  searchUserDtls: string = '';
  selectedUser: any[] = [];
  SelectedCoeEmpId: string = '';
  IsUserTaskDelete: boolean = false;
  IsPopupAddNew: boolean = true;
  minDateOffsetMonthsOrDate = config.minDateOffsetMonthsOrDate;
  IsminDateMonth = config.isMinDateMonth;
  totalItemsUM: number = 0;
  totalRecordsUM: number = 0;
  currentPageUM = 1;
  itemsPerPageUM = 5;
  showUDTab = true;
  showUOTab = false;
  isPasswordEditable: boolean = false;
  isEditProfile: boolean = false;
  showFileInput = true;
  avatarUploading = false;
  oldPasswordFromUser = '';
  passwordCheckTimeout: any;
  fileError: string | null = null;
  appName: string = '';
  roleData: any[] = [];
  userRoles: string[] = [];
  domainId: string | null = null;
  roleDetails: string[] = [];
  LogoPath: string = '';
  selectedTeams: number[] = [];
  selectedRoles: number[] = [];
  multiSelectSettings = {
    singleSelection: false,
    idField: 'id',
    textField: 'name',
    selectAllText: 'Select All',
    unSelectAllText: 'Unselect All',
    itemsShowLimit: 2,
    allowSearchFilter: true,
  };
  selectedTeamsdtls: any[] = [];
  selectedProject: any = null;
  ProjectsData: any[] = [];
  selectedTeam: any = null;
  selectedRole: any = null;
  selectedMappings: {
    projectName: string;
    projectId?: string; // optional if not always set
    teamName: string;
    teamId?: string;
    roleName: string;
    roleId?: string;
  }[] = [];

  selectedProjectId: number | null = null;
  teamRolesMap: { [teamName: string]: string[] } = {};
  editingMappingIndex: number | null = null;
  DashboardURL = config.refUrl;
  cdr: any;
  activeProject: string = '';
  projectTitle = config.masterProjectDisplayName;
  masterDatabase = config.masterDatabase
  domainName = config.domainName;
  isNewPort: boolean = config.IsNewPort;
  all_privileges: any = {}
  isPrivilegeViewLogs: boolean = false;
  isPrivilegeEditLogs: boolean = false;
  isPrivilegeDeleteLogs: boolean = false;
  isPrivilegeRefreshLogs: boolean = false;
  isPrivilegeExecuteLogs: boolean = false;
  showNotifications = false;
  notificationRequestsCount: number = 0;
  notificationActivitiesCount: number = 0;
  notifications: any[] = [];

  constructor(
    private _loadingService: NgxSpinnerService,
    private _homeService: HomeService,
    private _stateService: AIInfuseStateService,
    private fb: FormBuilder,
    private datePipe: DatePipe,
    private _router: Router,
    private changeDetectorRef: ChangeDetectorRef,
    private _role: RolePrivilegeMappingService
  ) {
    this.onboardForm = this.fb.group({
      firstName: [
        '',
        [
          Validators.required,
          Validators.pattern('^[A-Za-z ]+$'),
          Validators.maxLength(25),
        ],
      ],
      lastName: [
        '',
        [
          Validators.required,
          Validators.pattern('^[A-Za-z ]+$'),
          Validators.maxLength(25),
        ],
      ],
      emailId: [
        '',
        [
          Validators.required,
          Validators.email,
          Validators.maxLength(75),
          this.combinedEmailValidator(),
        ],
      ],
      password: [
        '',
        [Validators.minLength(8), this.passwordValidator.bind(this)],
      ],
      project: [''],
      team: [''],
      role: [''],
      avatar: ['', []],
    });
  }

  isActiveRoute(route: string): boolean {
    return this._router.url === route;
  }

  isActiveRoutePrefix(routePrefix: string): boolean {
    return this._router.url.startsWith(routePrefix);
  }

  toggleNotifications(event: Event): void {
    event.stopPropagation();
    this.showNotifications = !this.showNotifications;
  }

  closeNotifications(): void {
    this.showNotifications = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    const dropdown = document.querySelector('.notifications-panel');
    const trigger = target.closest('.notification-trigger');

    if (dropdown && !dropdown.contains(target) && !trigger) {
      this.showNotifications = false;
    }
  }

  home_link(): void {
    this._router.navigate(['/home']);
  }

  marketplace_link(): void {
    this._router.navigate(['/marketplace/agentmanagement']);
  }

  initialRoute(): void {
    this._router.navigate(['commandcenterdashboard']);
  }

  ngOnInit(): void {
    this.changePasswordForm = this.fb.group(
      {
        currentPassword: ['', Validators.required],
        newPassword: ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', Validators.required],
      },
      { validator: this.passwordMatchValidator }
    );

    this.loggedUser = this._stateService.getLoginDetails();
    this.userName = this.loggedUser.UserName;
    this.emailID = this.loggedUser.Email;
    this.employeeId = this.loggedUser.EmployeeId;
    const userRoleDtls = this.loggedUser.ProjectDtl?.find((p: any) => 
    p.prj_name?.trim().toLowerCase() === this.loggedUser.ActiveProject?.trim().toLowerCase())?.role_name || "Super Admin";

    this.roleDetail = userRoleDtls;
    this.avatarPath = this.loggedUser.Avatar;
    if (
      this.loggedUser.ActiveProject?.trim().toLowerCase() ===
      this.masterDatabase.trim().toLowerCase()
    ) {
      this.projectTitle = '';
    } else {
      this.projectTitle = this.loggedUser.ActiveProject;
    }

    this.activeProject = this.loggedUser.ActiveProject;
    this.GetUserDetails();
    this.loadAllRolePrivileges(); // calling method to set all role privileges into shared service such that it can be utilised across everycomponent
    this.loadPrivileges()  // calling this method to load privileges of current component
    this.loadNotifications();
    this.changeDetectorRef.detectChanges();
    this._loadingService.hide();

    this.onboardForm.valueChanges.subscribe(() => {
      this.changeDetectorRef.detectChanges();
    });

    if (this.isEditProfile) {
      this.oldPasswordFromUser = this.loggedUser.Password || '';
    }

    this.onboardForm.get('password')?.valueChanges.subscribe((newPwd) => {
      if (newPwd && newPwd.trim() === this.oldPasswordFromUser) {
        this.openModal(
          'exampleModalLabel1',
          'New password cannot be the same as the old password'
        );
      }
    });

    this.onboardForm.get('project')?.valueChanges.subscribe((projectId) => {
      if (projectId) {
        this.onboardForm.get('team')?.enable();
      } else {
        this.onboardForm.get('team')?.disable();
        this.onboardForm.get('role')?.disable();
      }
    });

    this.onboardForm.get('team')?.valueChanges.subscribe((teamId) => {
      if (teamId) {
        this.onboardForm.get('role')?.enable();
      } else {
        this.onboardForm.get('role')?.disable();
      }
    });
  }

  getAppNameForUser(
    roles: string[],
    domainId: string | null,
    data: any[]
  ): string {
    for (const role of roles) {
      const match = data.find(
        (d) =>
          d.RoleName === role &&
          (domainId ? String(d.DomainId) === domainId : true)
      );
      if (match) return match.AppName ?? 'Default App';
    }
    return 'Default App';
  }

  getAppLogoForUser(
    roles: string[],
    domainId: string | null,
    data: any[]
  ): string {
    for (const role of roles) {
      const match = data.find(
        (d) =>
          d.RoleName === role &&
          (domainId ? String(d.DomainId) === domainId : true)
      );
      if (match) return match.AppLogo ?? 'assets/img/default-logo.png';
    }
    return 'assets/img/default-logo.png';
  }

  GetUserDetails(): void {
    this._loadingService.show();
    this._homeService.getUserDetails().subscribe(({ data }) => {
      if (data) {
        this.UserManagementGridData = data.UserManagement.map((user) => {
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
        console.log('data', this.UserManagementGridData);
        this.UserManagementGridDataORG = data.UserManagement;
        this.RoleManagementData = data.RoleManagement;
        this.TeamManagementData = data.TeamManagement;
        this.ProjectManagementData = data.ProjectManagement;
        this.ProjectsData = data.MappedProject;
        this._stateService.setUserManagementData(this.UserManagementGridData);
        this._stateService.setTeamManagementData(this.TeamManagementData);
        this._stateService.setRoleManagementData(this.RoleManagementData);

        this._stateService.setProjectManagementData(this.ProjectManagementData);
        this._stateService.setProjectsData(this.ProjectsData);
        console.log('Project Management Data:', this.ProjectManagementData);
        this.totalRecordsUM = this.UserManagementGridData.length;
        this.totalItemsUM = this.UserManagementGridData.length;
        // Set roleDetail based on active project
        if (this.loggedUser.ActiveProject) {
          const userDetails = this.UserManagementGridData.find(
            (user) => user.Email === this.loggedUser.Email
          );
          console.log('User Details:', userDetails);
          if (userDetails && userDetails.PrjDetails) {
            const projectDetails = userDetails.PrjDetails.find(
              (p: any) =>
                p.prj_name === this.loggedUser.ActiveProject ||
                p.projectName === this.loggedUser.ActiveProject
            );
            this.roleDetail =
              projectDetails?.role_name ||
              projectDetails?.roleName ||
              'Super Admin'
          } else {
            this.roleDetail = this.loggedUser.Role || 'Super Admin';
          }
        } else {
          this.roleDetail = this.loggedUser.Role || 'Super Admin';
        }

        this._loadingService.hide();
        this.changeDetectorRef.detectChanges();
      } else {
        this._loadingService.hide();
      }
    });
  }

  loadAllRolePrivileges(): void {
    this._homeService.getAllRolePrivileges().subscribe({
      next: (response:any) => {
        if (response.data) {
          // Process the data as needed
          //console.log('All Role Privileges:', response.data);
          this._stateService.setAllRolePrivileges(response.data);
        } else {
          console.warn('No role privileges data received');
        }
      },
    });
  }

  // method to load privileges for the Logs page and set the component variables accordingly , this method is use across everypage for getting specific pages privilges
  loadPrivileges() {
    this._stateService.getPrivilegesByPage('Logs').subscribe({
      next: (loaded_privileges:any) => {
        //console.log('Loaded privileges for logs by page: ', loaded_privileges);
        if (loaded_privileges) {
          this.isPrivilegeViewLogs = loaded_privileges?.view || false;
          this.isPrivilegeEditLogs = loaded_privileges?.['insert / edit'] || loaded_privileges?.edit || false;
          this.isPrivilegeDeleteLogs = loaded_privileges?.delete || false;
          this.isPrivilegeRefreshLogs = loaded_privileges?.refresh || false;
          this.isPrivilegeExecuteLogs = loaded_privileges?.execute || false;
          this.changeDetectorRef.detectChanges();
        }
      }
    });
  }

  combinedEmailValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const email = control.value;
      if (!email) {
        return null; // No need to validate if email is null or empty
      }

      // Check for duplicate email
      const duplicate = this.UserManagementGridData.some(
        (user) => user.Email && user.Email.toLowerCase() === email.toLowerCase()
      );

      // Check if email domain is not '@domain.com' and contains invalid characters
      const invalidDomain = !email.endsWith(this.domainName);
      const invalidmail = /[^a-zA-Z0-9@.]/.test(email);

      // Return validation errors if any
      if (duplicate && invalidDomain && invalidmail) {
        return { duplicateEmail: true, InvalidEmail: true, invalidmail: true };
      } else if (duplicate) {
        return { duplicateEmail: true };
      } else if (invalidDomain) {
        return { InvalidEmail: true };
      } else if (invalidmail) {
        return { invalidmail: true };
      }
      return null;
    };
  }

  filterUserManagement(): void {
    if (this.searchUserDtls) {
      this.UserManagementGridData = this.UserManagementGridDataORG.filter(
        (item) =>
          item.FirstName.toLowerCase().includes(
            this.searchUserDtls.toLowerCase()
          ) ||
          item.LastName.toLowerCase().includes(
            this.searchUserDtls.toLowerCase()
          ) ||
          item.Email.toLowerCase().includes(this.searchUserDtls.toLowerCase())
      );
    } else {
      this.UserManagementGridData = [...this.UserManagementGridDataORG];
    }
    this.totalRecordsUM = this.UserManagementGridData
      ? this.UserManagementGridData.length
      : 0;
    this.currentPageUM = 1;
    this.itemsPerPageUM = 5;
  }

  emailDomainValidator(control: FormControl) {
    const email = control.value;

    if (email && !email.endsWith(this.domainName)) {
      return { InvalidEmail: true };
    }
    return null;
  }
  selectValidator(control: FormControl): { [key: string]: boolean } | null {
    return control.value === '0' ? { invalidSelection: true } : null;
  }

  passwordMatchValidator(
    control: AbstractControl
  ): { [key: string]: any } | null {
    const newPassword = control.get('newPassword');
    const confirmPassword = control.get('confirmPassword');

    if (newPassword?.value !== confirmPassword?.value) {
      return { passwordMismatch: true };
    }

    return null;
  }

  onEmpCaptionCheckboxChange() {
    this.isEmpCaptionVisible = true;
    this.isMultipleOnboardVisible = false;
  }

  onMultipleOnboardCheckboxChange() {
    this.isEmpCaptionVisible = false;
    this.isMultipleOnboardVisible = true;
  }

  selectFile(): void {
    const fileInput = document.getElementById('selectedFile');
    if (fileInput) {
      fileInput.click();
    }
  }

  PopupClose(): void {
    this.passwordError = '';
    this.changePasswordForm?.reset();
    this.changePasswordForm?.get('newPassword')?.setValue('');
    this.changePasswordForm?.get('confirmPassword')?.setValue('');
    this.passwordMismatch = false;
    this.passwordSameError = false;
    if (this.changePasswordModal && this.changePasswordModal.nativeElement) {
      const modalElement = this.changePasswordModal.nativeElement;
      $(modalElement).modal('hide');
    }
  }
  checkCurrentPassword(type: any) {
    const currentPassword =
      type == 'New'
        ? this.changePasswordForm?.get('currentPassword')?.value
        : this.changePasswordForm?.get('newPassword')?.value;
    const UserEmailId = this.EmailId;

    var params = {
      currentPwd: currentPassword,
      newPwd: 'Test',
      EmailID: this.emailID,
    };

    this._loadingService.show();
    this._homeService.checkCurrentPassword(params).subscribe((data) => {
      if (data != null || data != undefined) {
        if (data.success) {
          this._loadingService.hide();
          if (type !== 'New') {
            this.passwordSameError = true; // Optional: Set any flags for UI
          } else {
            this.passwordSameError = false;
            this.passwordError = ''; // Clear the error message
            this.changePasswordForm.get('newPassword')?.setErrors(null); // Clear the error
          }
        } else {
          this._loadingService.hide();
          if (type === 'New') {
            this.passwordError = 'Invalid current password'; // Show the error message
          } else {
            this.passwordSameError = false; // Optional: Set any flags for UI
          }
        }
      } else {
        this._loadingService.hide();
      }
    });
  }

  // Method to check the validity of password strength indicators
  isPasswordValid(indicator: string): boolean {
    const password = this.changePasswordForm?.get('newPassword')?.value;

    switch (indicator) {
      case 'character':
        return password.length >= 8;
      case 'uppercase':
        return /[A-Z]/.test(password);
      case 'lowercase':
        return /[a-z]/.test(password);
      case 'number':
        return /\d/.test(password);
      case 'specialchar':
        return /[!@#$%^&*()_+{}\[\]:;<>,.?~\\\/\-=`|"'`]/.test(password);
      default:
        return false;
    }
  }

  changePassword(): void {
    if (this.changePasswordForm?.valid) {
      var currentPwd = this.changePasswordForm.value.currentPassword;

      var Params = {
        currentPwd: this.changePasswordForm.value.currentPassword,
        newPwd: this.changePasswordForm.value.newPassword,
        EmailID: this.emailID,
      };

      this._loadingService.show();

      this._homeService.changePassword(Params).subscribe((data) => {
        if (data != null || data != undefined) {
          if (data.success) {
            this._loadingService.hide();
            this.popupClose = true;
            if (
              this.changePasswordModal &&
              this.changePasswordModal.nativeElement
            ) {
              const modalElement = this.changePasswordModal.nativeElement;
              $(modalElement).modal('hide');
            }
            if (this.loadalert && this.loadalert.nativeElement) {
              const modalElement = this.loadalert.nativeElement;
              $(modalElement).modal('show');
            }
            this.popupTitle = '<b>Change Password!</b>';
            this.openModal('exampleModalLabel1', data.message);
            this.changeDetectorRef.detectChanges(); // manually trigger change detection
          } else {
            this._loadingService.hide();
            this.passwordError = data.message;
          }
        } else {
          this._loadingService.hide();
        }
      });
      this._loadingService.hide();
    }
  }

  duplicateEmailValidator() {
    const UMEmailId = this.onboardForm.get('emailId')?.value;

    const isDuplicate = this.checkIfNameExists(UMEmailId);

    if (isDuplicate) {
      // this.onboardForm.get('emailId')?.setErrors({ duplicateUserName: true });
      // this.changeDetectorRef.detectChanges();
    }
  }

  checkIfNameExists(UMEmailId: string): boolean {
    var UserM = this._stateService.getUserManagementData();

    return UserM.some(
      (item: { Email: string }) =>
        item.Email.toLowerCase() === UMEmailId.toLowerCase()
    );
  }

  isEmailIdInvalid() {
    const emailControl = this.onboardForm.get('emailId');
    return emailControl?.touched && emailControl.invalid;
  }

  togglePasswordVisibility(): void {
    this.isPasswordVisible = !this.isPasswordVisible;
  }

  togglePasswordField(checkbox: HTMLInputElement): void {
    this.isPasswordEditable = checkbox.checked;

    const passwordControl = this.onboardForm.get('password');
    if (this.isPasswordEditable) {
      passwordControl?.enable();
    } else {
      passwordControl?.setValue(''); // Clear the field
      passwordControl?.disable();
    }
  }

  formatDate(date: Date | null): string {
    if (!date) {
      return ''; // Handle null or undefined case
    }
    return this.datePipe.transform(date, 'd-MMM-yyyy') || '';
  }

  formatTimeValue(timeValue: string): string {
    if (!timeValue) return '04:00'; // default value
    const [hours, minutes] = timeValue.split('.');
    return `${hours}:${minutes}`; // ensure only hours and minutes are returned
  }

  OnboardPopupClose(): void {
    this.isEditProfile = false;
    this.onboardForm.reset();
    this.fileInput.nativeElement.value = '';
    this.currentPageUM = 1;
    this.tabChange(true);
    this.switchToProfileTab(false);
    this.searchUserDtls = '';
    this.filterUserManagement();
    this.changeDetectorRef.detectChanges();
  }

  OnboardPopupClear(): void {
    this.onboardForm.reset();
  }

  resetForm() {
    this.onboardForm.reset({
      firstName: '',
      lastName: '',
      emailId: '',
      password: '',
      role: '',
      team: '',
      avatar: '',
      project: '',
    });
    this.selectedRoles = [];
    this.selectedTeams = [];
    this.selectedMappings = [];
    this.editingMappingIndex = null; // Reset editing index
    if (this.fileInput && this.fileInput.nativeElement) {
      this.fileInput.nativeElement.value = '';
    }
  }

  WelcomeEmailTrigger(EmailId: any): void {
    this._loadingService.show();
    this._homeService.sentMailUserManagement(EmailId).subscribe((data) => {
      if (data != null || data != undefined) {
        this._loadingService.hide();
        if (this.loadalert && this.loadalert.nativeElement) {
          const modalElement = this.loadalert.nativeElement;
          $(modalElement).modal('show');
        }
        this.popupTitle = 'Mail Triggered!';
        this.openModal(
          'exampleModalLabel1',
          'Welcome mail has been sent to the user.'
        );
        this.changeDetectorRef.detectChanges(); // manually trigger change detection
      } else {
        this._loadingService.hide();
      }
    });
  }

  get totalPagesUM(): number {
    return Math.ceil(this.totalRecordsUM / this.itemsPerPageUM) || 1;
  }

  get startItemUM(): number {
    return (this.currentPageUM - 1) * this.itemsPerPageUM + 1;
  }

  get endItemUM(): number {
    return Math.min(
      this.currentPageUM * this.itemsPerPageUM,
      this.totalRecordsUM
    );
  }

  calculateStartEndUserM(): string {
    const startItem = (this.currentPageUM - 1) * this.itemsPerPageUM + 1;
    const endItem = Math.min(
      this.currentPageUM * this.itemsPerPageUM,
      this.totalRecordsUM
    );
    return `${startItem} to ${endItem}`;
  }

  goToPageUM(page: number): void {
    if (page < 1 || page > this.totalPagesUM) return;
    this.currentPageUM = page;
    this.loadUserManagementPage();
  }

  changePageSizeUM(size: number): void {
    this.itemsPerPageUM = Number(size);
    this.currentPageUM = 1;
    this.loadUserManagementPage();
  }

  loadUserManagementPage(): void {
    const startIndex = (this.currentPageUM - 1) * this.itemsPerPageUM;
    const endIndex = startIndex + this.itemsPerPageUM;
    this.UserManagementGridData = this.UserManagementGridDataORG.slice(
      startIndex,
      endIndex
    );
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
    this.showModal = false;
    this.message = '';
    this.popupTitle = '';
    if (this.loadalert && this.loadalert.nativeElement) {
      const modalElement1 = this.loadalert.nativeElement;
      $(modalElement1).modal('hide');
    }
  }

  formatDatecheck(date: Date): string {
    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2); // Months are zero indexed
    const day = ('0' + date.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
  }

  formatDatecheckEdit(dateString: string): string {
    if (!dateString) {
      throw new Error('Date string is empty or null.');
    }
    const date = new Date(dateString); // Parse ISO 8601 format string into a Date object

    // Check if the parsed date is valid
    if (!(date instanceof Date && !isNaN(date.getTime()))) {
      throw new Error('Invalid date string format.');
    }

    const year = date.getFullYear();
    const month = ('0' + (date.getMonth() + 1)).slice(-2); // Months are zero indexed
    const day = ('0' + date.getDate()).slice(-2);
    return `${year}-${month}-${day}`;
  }

  ngAfterViewInit(): void {
    //this._router.navigate(['commandcenterdashboard']);
    this.changeDetectorRef.detectChanges();
  }

  refreshData() {
    this._loadingService.hide();
    this.changeDetectorRef.detectChanges();
    if (this.isEditProfile) {
      this.resetEditProfileForm();
      this.closeEditProfileModal();
    }
  }

  updateUserData(updatedEmail: string, data: any, updateAvatar: boolean = false) {
    if (
      updatedEmail &&
      updatedEmail.toLowerCase() === this.emailID.toLowerCase()
    ) {
      this.roleDetail = data?.RoleName ?? this.roleDetail;
      if (updateAvatar && data) {
        this.avatarPath = data;
      }
      else{
        this.avatarPath = data?.Avatar ?? this.avatarPath;
      }
      
      this.loggedUser.Avatar = this.avatarPath;
      this.loggedUser.Role = this.roleDetail;
      if (data?.PrjDetails)
      this.loggedUser.ProjectDtl = data.PrjDetails;
      this._stateService.setLoginDetails(this.loggedUser);
    }
  }

  onSubmit(): void {
    if (this.isEditProfile) {
      const password = this.onboardForm.get('password')?.value;
      const avatar = this.onboardForm.get('avatar')?.value;
      if (
        (!password || password.trim() === '') &&
        (!avatar || avatar.trim() === '')
      ) {
        this.openModal(
          'exampleModalLabel1',
          'Please provide a password or avatar to update the profile.'
        );
        return;
      }

      this._loadingService.show();
      const currentDate = new Date();
      const formData = this.onboardForm.getRawValue();

      const params = {
        Email: formData.emailId || this.emailID,
        Password: formData.password || null,
        Avatar: formData.avatar || '',
        ModifiedBy: this.emailID,
        ModifiedDate: currentDate,
      };

      this._homeService.UpdateUser(params).subscribe({
        next: ({ data }) => {
          this.popupTitle = 'Edit Profile!';

          this.openModal('exampleModalLabel1', 'Profile updated successfully');

          this.updateUserData(formData.emailId, data, true);

          this.GetUserDetails();
          this.closeModal();

          this.resetEditProfileForm();
          this.closeEditProfileModal();
        },
        error: (err) => {
          this._loadingService.hide();
          const error = getApiError(err);
          let msg =
            error?.message || 'An error occurred while updating the profile.';
          this.popupTitle = 'Action Failed';
          if (msg === 'New password cannot be the same as the old password') {
            this.onboardForm.get('password')?.setErrors({ sameAsOld: true });
          }
          this.openModal('exampleModalLabel1', msg);
          this.refreshData();
        },
      });
      return;
    }

    // Onboarding or editing user logic
    const formData = this.onboardForm.getRawValue();
    const UserName = formData.firstName + ' ' + formData.lastName;

    const PrjDetails = this.selectedMappings.map((m) => ({
      project_name: m.projectName,
      project_id: m.projectId,
      team_name: m.teamName,
      team_id: m.teamId,
      role_name: m.roleName,
      role_id: m.roleId,
    }));

    // Validate required fields
    const isBasicValid =
      formData.firstName?.trim() &&
      formData.lastName?.trim() &&
      formData.emailId?.trim();
    const isMappingValid = PrjDetails.length > 0;
    const isFormValid = this.IsUserEdit
      ? isBasicValid && isMappingValid
      : this.onboardForm.valid && isMappingValid;

    if (isFormValid) {
      this._loadingService.show();

      const activeProjectName =
        PrjDetails.length > 0 ? PrjDetails[0].project_name : null;
      const currentDate = new Date();
      const params = {
        FirstName: formData.firstName,
        LastName: formData.lastName,
        Email: formData.emailId,
        PrjDetails: PrjDetails,
        RoleId: PrjDetails.length > 0 ? PrjDetails[0].role_id : null,
        TeamId: PrjDetails.length > 0 ? PrjDetails[0].team_id : null,
        ActiveProject: activeProjectName,
        Salt: 'Test',
        CreatedBy: this.emailID,
        CreatedDate: currentDate,
        IsEdit: this.IsUserEdit,
      };

      console.log('Onboard payload:', JSON.stringify(params, null, 2));

      this._homeService.onboardUser(params).subscribe({
        next: ({ data }) => {
          this.popupTitle = 'User Onboarded!';
          if (this.IsUserEdit) this.popupTitle = 'Edit User!';

          this.openModal(
            'exampleModalLabel1',
            `User: ${UserName} details ${
              this.IsUserEdit ? 'updated' : 'added'
            } successfully`
          );

          this.updateUserData(formData.emailId, data,false);

          this.GetUserDetails();
          this.closeModal();
          this.OnboardPopupClose();
        },
        error: (err) => {
          this._loadingService.hide();
          const error = getApiError(err);
          this.openModal(
            'exampleModalLabel1',
            error?.message || 'An error occurred while saving user details.'
          );
          this.refreshData();
        },
      });
    } else {
      this._loadingService.hide();
      const errorMessage = !isBasicValid
        ? 'First Name, Last Name, and Email are required.'
        : !isMappingValid
        ? 'Please add at least one project, team, and role mapping.'
        : 'Please fill out all required fields correctly.';
      this.openModal('exampleModalLabel1', errorMessage);
    }
  }

  tabChange(IsUserEdit: boolean) {
    if (IsUserEdit) {
      this.UserheaderCaption = 'Onboard User';
      this.buttonCaption = this.UserheaderCaption;
      this.IsUserEdit = false;
      this.editingMappingIndex = null; // Reset editing index
      const emailCtrl = this.onboardForm.get('emailId');
      emailCtrl?.enable();
      emailCtrl?.setValidators([
        Validators.required,
        Validators.email,
        Validators.maxLength(75),
        this.combinedEmailValidator(),
      ]);
      emailCtrl?.updateValueAndValidity();
    }
    Object.keys(this.onboardForm.controls).forEach((control) => {
      this.onboardForm.controls[control].enable();
    });
    this.resetForm();
  }

  switchToProfileTab(isHomeTab: boolean): void {
    const tabId = isHomeTab ? '#home-tab' : '#profile-tab';
    const tabTrigger = document.querySelector(tabId);
    if (tabTrigger) {
      const tabInstance = bootstrap.Tab.getOrCreateInstance(tabTrigger);
      tabInstance.show();
    }
  }
  editUser(user: any): void {
    this.UserheaderCaption = 'Edit User';
    this.buttonCaption = 'Update User';
    this.IsUserEdit = true;

    // Clear previous mapping selections
    this.selectedMappings = [];
    this.editingMappingIndex = null;

    console.log('Editing user:', user);

    // Patch basic user fields
    this.onboardForm.patchValue({
      firstName: user.FirstName,
      lastName: user.LastName,
      emailId: user.Email,
      avatar: user.Avatar || '',
    });

    // Populate mappings with correct teamId and roleId
    if (user.PrjDetails && user.PrjDetails.length > 0) {
      user.PrjDetails.forEach((prj: any) => {
        this.selectedMappings.push({
          projectName: prj.prj_name || prj.projectName,
          projectId: prj.project_id || prj.projectId,
          teamName: prj.team_name || prj.teamName,
          teamId: prj.team_id || prj.teamId,
          roleName: prj.role_name || prj.roleName,
          roleId: prj.role_id || prj.roleId,
        });
      });
    }

    console.log('Selected mappings after population:', this.selectedMappings);

    // Disable non-editable basic fields
    ['firstName', 'lastName', 'emailId', 'team', 'role'].forEach((control) => {
      this.onboardForm.controls[control].disable();
    });

    // Enable other controls
    Object.keys(this.onboardForm.controls).forEach((control) => {
      if (
        !['firstName', 'lastName', 'emailId', 'team', 'role'].includes(control)
      ) {
        this.onboardForm.controls[control].enable();
      }
    });

    const emailCtrl = this.onboardForm.get('emailId');
    if (emailCtrl) {
      emailCtrl.clearValidators();
      emailCtrl.updateValueAndValidity();
    }

    this.changeDetectorRef.detectChanges();
    this.switchToProfileTab(false);
  }

  inActiveUser(EmailId: any, Status: boolean) {
    this._loadingService.show();
    var LogginUser = this.emailID;

    var params = {
      EmailId: EmailId,
      Status: Status,
      LogginUser: LogginUser,
    };

    this._homeService.userActiveOrInActive(params).subscribe(({ data }) => {
      if (data != null || data != undefined) {
        this.UserManagementGridData = data.UserManagement;
        //Grid Details
        this.totalRecordsUM =
          this.UserManagementGridData != null
            ? this.UserManagementGridData.length
            : 0;
        this.totalItemsUM =
          this.UserManagementGridData != null
            ? this.UserManagementGridData.length
            : 0;
        this.currentPageUM = this.currentPageUM; // You might want to keep track of currentPage1 properly in your application

        this._loadingService.hide();
        if (this.loadalert && this.loadalert.nativeElement) {
          const modalElement = this.loadalert.nativeElement;
          $(modalElement).modal('show');
        }
        if (!Status) {
          this.popupTitle = 'User Actiavate!';
          this.openModal(
            'exampleModalLabel1',
            'User : ' + EmailId + ' activated successfully.'
          );
        } else {
          this.popupTitle = 'User DeActivate!';
          this.openModal(
            'exampleModalLabel1',
            'User : ' + EmailId + ' deactivated successfully.'
          );
        }
        this.changeDetectorRef.detectChanges();
      } else {
        this._loadingService.hide();
      }
    });
  }

  deleteUser(mailId: string): void {
    this._loadingService.show();
    var LogginUser = this.emailID;

    var params = {
      EmailId: mailId,
      LogginUser: LogginUser,
    };

    this._homeService.deleteUserDetails(params).subscribe(({ data }) => {
      if (data != null || data != undefined) {
        this.UserManagementGridData = data.UserManagement;
        this.UserManagementGridDataORG = [...this.UserManagementGridData];
        //Grid Details
        this.totalRecordsUM =
          this.UserManagementGridData != null
            ? this.UserManagementGridData.length
            : 0;
        this.totalItemsUM =
          this.UserManagementGridData != null
            ? this.UserManagementGridData.length
            : 0;
        this.currentPageUM = this.currentPageUM; // You might want to keep track of currentPage1 properly in your application

        this._loadingService.hide();
        if (this.loadalert && this.loadalert.nativeElement) {
          const modalElement = this.loadalert.nativeElement;
          $(modalElement).modal('show');
        }
        this.popupTitle = 'User Detail Deleted!';
        this.openModal(
          'exampleModalLabel1',
          'User : ' + mailId + ' deleted successfully.'
        );

        this.changeDetectorRef.detectChanges();
      } else {
        this._loadingService.hide();
      }
    });
  }

  onImageChange(event: any) {
    const file = event.target.files[0];
    this.fileError = null;
    if (file) {
      const allowedTypes = ['image/png', 'image/jpeg', 'image/svg+xml'];
      if (!allowedTypes.includes(file.type)) {
        this.fileError = 'Only PNG, JPG, and SVG images are allowed.';
        return;
      }
      this.avatarUploading = true;
      const formData = new FormData();
      formData.append('file', file);
      this._homeService.uploadImage(formData).subscribe({
        next: ({ data: response }) => {
          if (response && response.filePath) {
            this.onboardForm.patchValue({ avatar: response.dataUrl });
            const passwordControl = this.onboardForm.get('password');
            if (passwordControl) {
              passwordControl.updateValueAndValidity();
              passwordControl.markAsDirty();
              passwordControl.markAsTouched();
            }
            this.avatarUploading = false;
            this.changeDetectorRef.detectChanges();
          }
        },
        error: (err) => {
          console.error('Upload failed:', err);
          this.avatarUploading = false;
        },
      });
    } else {
      this.onboardForm.patchValue({ avatar: '' });
    }
  }

  subscriptionsLink(): void {
    this._router.navigate(['/managesubscription']);
  }

  center_link(): void {
    this._router.navigate(['/commandcenterdashboard']);
  }

  onUserCheckboxChange(tab: string) {
    this.resetUserAllTabs();
    if (tab === 'UD') {
      this.showUDTab = true;
    } else if (tab === 'UO') {
      this.showUOTab = true;
    } else {
    }
  }

  resetUserAllTabs() {
    this.showUDTab = false;
    this.showUOTab = false;
  }

  UserOnboard(): void {
    this.GetUserDetails();
    this.tabChange(true);
    this.switchToProfileTab(true);
  }

  OnboardExcelData(): void {}

  showChangePasswordModal() {
    $('#change-password').modal('show');
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.passwordMismatch = false;
    this.passwordSameError = false;
    this.changePasswordForm?.get('newPassword')?.setValue('');
    this.changePasswordForm?.get('confirmPassword')?.setValue('');
  }

  CoePopupClose(): void {
    this.SelectedCoeEmpId = '';
    this.selectedUser = [];
  }

  async doLogOut(): Promise<void> {
    logout(this._router)
    this.changeDetectorRef.detectChanges();
  }

  editProfile(): void {
    this.isEditProfile = true;
    this.IsUserEdit = true;
    this.UserheaderCaption = 'Edit Profile';
    this.buttonCaption = 'Update Profile';
    this.onboardForm.patchValue({
      firstName: this.loggedUser.FirstName || '',
      lastName: this.loggedUser.LastName || '',
      emailId: this.emailID,
      password: '',
      avatar: '',
    });
    Object.keys(this.onboardForm.controls).forEach((control) => {
      if (control !== 'password' && control !== 'avatar') {
        this.onboardForm.controls[control].disable();
      } else {
        this.onboardForm.controls[control].enable();
      }
    });
    this.changeDetectorRef.detectChanges();
    this.openEditProfileModal();
  }

  openEditProfileModal() {
    this.fileError = null;
    const modal = new bootstrap.Modal(this.editProfileModal.nativeElement);
    modal.show();
  }

  closeEditProfileModal() {
    this.resetEditProfileForm();
    const modal = bootstrap.Modal.getInstance(
      this.editProfileModal.nativeElement
    );
    if (modal) {
      modal.hide();
    }
  }

  isAddMappingEnabled(): boolean {
    const project = this.onboardForm.get('project')?.value;
    const team = this.onboardForm.get('team')?.value;
    const role = this.onboardForm.get('role')?.value;
    return !!(project && team && role);
  }

  get isSaveEnabled(): boolean {
    if (this.isEditProfile) {
      const passwordCtrl = this.onboardForm.get('password');
      const password = passwordCtrl?.value?.trim();
      const avatar = this.onboardForm.get('avatar')?.value?.trim();

      const passwordNonEmpty = !!password;
      const avatarNonEmpty = !!avatar;
      // Disable if both empty
      if (!passwordNonEmpty && !avatarNonEmpty) {
        return false;
      }
      // Disable if avatar has an error
      if (this.fileError) {
        return false;
      }
      // Disable if password is non-empty but invalid
      if (passwordNonEmpty && !passwordCtrl?.valid) {
        return false;
      }
      // Enable only if all conditions pass
      return true;
    }

    if (this.isAddMappingEnabled()) {
      console.log('Submit disabled: Pending mapping selection');
      return false;
    }

    if (this.IsUserEdit) {
      const hasMappings = this.selectedMappings.length > 0;
      const firstName = this.onboardForm.get('firstName')?.value?.trim();
      const lastName = this.onboardForm.get('lastName')?.value?.trim();
      const emailId = this.onboardForm.get('emailId')?.value?.trim();
      const basicValid = !!firstName && !!lastName && !!emailId;
      const result = basicValid && hasMappings;
      return result;
    } else {
      const basicValid =
        (this.onboardForm.get('firstName')?.valid ?? false) &&
        (this.onboardForm.get('lastName')?.valid ?? false) &&
        (this.onboardForm.get('emailId')?.valid ?? false);
      const hasMappings = this.selectedMappings.length > 0;
      const result = basicValid && hasMappings;
      return result;
    }
  }

  resetEditProfileForm(): void {
    this.showFileInput = false;
    this.fileError = null;
    setTimeout(() => {
      this.showFileInput = true;
    }, 0);
    this.onboardForm.reset();
    this.onboardForm.patchValue({
      firstName: this.loggedUser.FirstName || '',
      lastName: this.loggedUser.LastName || '',
      emailId: this.emailID,
      password: '',
      avatar: '',
    });
    Object.keys(this.onboardForm.controls).forEach((control) => {
      this.onboardForm.controls[control].enable();
    });
    this.isEditProfile = false;
    this.IsUserEdit = false;
    this.changeDetectorRef.detectChanges();
  }

  validatePassword(): void {
    if (!this.isEditProfile) return; // Only check in edit profile mode

    const passwordCtrl = this.onboardForm.get('password');
    const password = passwordCtrl?.value?.trim();

    if (!password) {
      passwordCtrl?.setErrors(null);
      return;
    }

    this._homeService
      .checkPassword({
        Email: this.emailID,
        Password: password,
      })
      .subscribe({
        next: (res: any) => {
          // Keep other validators intact
          const existingErrors = passwordCtrl?.errors || {};
          delete existingErrors['sameAsOld'];
          if (Object.keys(existingErrors).length === 0) {
            passwordCtrl?.setErrors(null);
          } else {
            passwordCtrl?.setErrors(existingErrors);
          }
        },
        error: (err) => {
          const error = getApiError(err);
          if (error?.message?.includes('same as old')) {
            passwordCtrl?.setErrors({ sameAsOld: true });
          }
          console.error('Password validation failed:', error || err);
        },
      });
  }
  passwordValidator(control: AbstractControl): ValidationErrors | null {
    const value = control.value;
    if (!value) return null;

    const invalidCharsPattern = /[^A-Za-z\d@$!%*?&#]/;

    if (invalidCharsPattern.test(value)) {
      return { invalidChars: true };
    }
    // 2. Check the normal password rules
    const strongPattern =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
    if (!strongPattern.test(value)) {
      return { pattern: true };
    }

    return null; // valid
  }

  openRolePrivilegeModal() {
    const modalEl = document.getElementById('rolePrivilegeModal');
    const modal = new bootstrap.Modal(modalEl);
    modalEl?.addEventListener('shown.bs.modal', () => {});
    modal.show();
  }

  onProjectChange(event: Event) {
    const projectName = (event.target as HTMLSelectElement).value;
    this.selectedProject =
      this.ProjectManagementData.find((p) => p.projectName === projectName) ||
      null;
    this.TeamManagementData = [];
    this.RoleManagementData = [];
    this.onboardForm.patchValue({ team: '', role: '' });

    if (projectName && this.selectedProject) {
      this._loadingService.show();
      // Use ProjectsData to populate TeamManagementData
      const projectData = this.ProjectManagementData.find(
        (p) => p.projectName === projectName
      );
      if (projectData && projectData.teams) {
        this.TeamManagementData = projectData.teams.map((t: any) => ({
          TeamName: t.teamName,
          TeamId: t.teamId ?? null,
          roles: t.roles.map((r: any) => ({
            roleName: r.role,
            roleId: r.roleId ?? null,
          })),
        }));
        console.log(
          'Mapped Teams from ProjectsData:',
          JSON.stringify(this.TeamManagementData, null, 2)
        );
        this.onboardForm.get('team')?.enable();
        this._loadingService.hide();
        this.changeDetectorRef.detectChanges();
      } else {
        this.loadTeamsForProject(projectName).subscribe({
          next: (res: any) => {
            this._loadingService.hide();
            console.log('Raw Teams Response:', JSON.stringify(res, null, 2));
            if (res.Success && res.Teams) {
              this.TeamManagementData = res.Teams.map((t: any) => ({
                TeamName: t.teamName || t.name,
                TeamId: t.teamId ?? null,
                roles: t.roles.map((r: any) =>
                  typeof r === 'string'
                    ? { roleName: r, roleId: null }
                    : { roleName: r.role, roleId: r.roleId ?? null }
                ),
              }));
              console.log(
                'Mapped Teams from API:',
                JSON.stringify(this.TeamManagementData, null, 2)
              );
              this.onboardForm.get('team')?.enable();
              this.changeDetectorRef.detectChanges();
            } else {
              this.openModal(
                'exampleModalLabel1',
                res.Message || 'No teams available for this project.'
              );
            }
          },
          error: (err) => {
            this._loadingService.hide();
            console.error('Error fetching teams:', err);
            this.openModal(
              'exampleModalLabel1',
              'Failed to load teams for the selected project.'
            );
          },
        });
      }
    } else {
      this.onboardForm.get('team')?.disable();
      this.onboardForm.get('role')?.disable();
      this._loadingService.hide();
    }
  }
  onTeamChange() {
    const selectedTeam = this.onboardForm.get('team')?.value;
    const teamName = selectedTeam?.TeamName;
    const projectName = this.selectedProject?.projectName;

    if (!projectName || !teamName || !selectedTeam?.roles) {
      console.warn('Missing projectName, teamName, or roles:', {
        projectName,
        teamName,
        roles: selectedTeam?.roles,
      });
      this.RoleManagementData = [];
      this.onboardForm.get('role')?.setValue('');
      this.onboardForm.get('role')?.disable();
      this.changeDetectorRef.markForCheck();
      return;
    }

    // Map roles to RoleManagementData
    this.RoleManagementData = selectedTeam.roles.map((r: any) => ({
      RoleId: r.roleId ?? null,
      RoleName: r.roleName,
    }));

    console.log(
      'Mapped Roles:',
      JSON.stringify(this.RoleManagementData, null, 2)
    );
    this.onboardForm.get('role')?.setValue('');
    this.onboardForm.get('role')?.enable();
    this.changeDetectorRef.markForCheck();
  }
  addMapping() {
    const projectName = this.onboardForm.get('project')?.value;
    const selectedTeam = this.onboardForm.get('team')?.value;
    const selectedRole = this.onboardForm.get('role')?.value;

    if (!projectName || !selectedTeam || !selectedRole) {
      this.openModal(
        'exampleModalLabel1',
        'Please select a project, team, and role before adding.'
      );
      return;
    }

    const newMapping = {
      projectName,
      projectId: this.selectedProject?.projectId ?? null,
      teamName: selectedTeam.TeamName,
      teamId: selectedTeam.TeamId ?? null,
      roleName: selectedRole.RoleName,
      roleId: selectedRole.RoleId ?? null,
    };

    const exists = this.selectedMappings.some(
      (m) =>
        m.projectName === newMapping.projectName &&
        m.teamName === newMapping.teamName &&
        m.roleName === newMapping.roleName
    );

    if (exists) {
      this.openModal(
        'exampleModalLabel1',
        'This project, team, and role combination is already added.'
      );
      return;
    }

    console.log('Adding mapping:', JSON.stringify(newMapping, null, 2));
    this.selectedMappings.push(newMapping);

    // Reset dropdowns
    this.onboardForm.patchValue({ project: '', team: '', role: '' });
    this.selectedProject = null;
    this.TeamManagementData = [];
    this.RoleManagementData = [];
    this.onboardForm.get('team')?.disable();
    this.onboardForm.get('role')?.disable();
    this.changeDetectorRef.detectChanges();
  }
  loadTeamsForProject(projectName: string) {
    return this._homeService.getTeamsByProject({ projectName });
  }

  loadRolesForTeam(projectName: string, teamName: string) {
    console.log(
      `Fetching roles for project: ${projectName}, team: ${teamName}`
    );
    return this._homeService.getRolesByProjectAndTeam({
      projectName,
      teamName,
    });
  }

  editMapping(item: any, index: number) {
    this.editingMappingIndex = index;
    this.selectedMappings.splice(index, 1);

    // Find the project object from ProjectsData
    this.selectedProject =
      this.ProjectManagementData.find(
        (p) => p.projectName === item.projectName
      ) || null;
    this.onboardForm.patchValue({
      project: item.projectName,
      team: '',
      role: '',
    });

    if (!this.selectedProject) {
      this.openModal(
        'exampleModalLabel1',
        `Project '${item.projectName}' not found.`
      );
      return;
    }

    this._loadingService.show();
    const projectData = this.ProjectManagementData.find(
      (p) => p.projectName === item.projectName
    );
    if (projectData && projectData.teams) {
      // Use ProjectsData to populate TeamManagementData
      this.TeamManagementData = projectData.teams.map((t: any) => ({
        TeamName: t.teamName,
        TeamId: t.teamId ?? null,
        roles: t.roles.map((r: any) => ({
          roleName: r.role,
          roleId: r.roleId ?? null,
        })),
      }));
      this._loadingService.hide();
      this.changeDetectorRef.detectChanges();

      const team = this.TeamManagementData.find(
        (t) => t.TeamName === item.teamName
      );
      if (team) {
        this.onboardForm.patchValue({ team: team });

        // Populate roles from the team's roles array
        this.RoleManagementData = team.roles.map((r: any) => ({
          RoleId: r.roleId ?? null,
          RoleName: r.roleName,
        }));
        this.changeDetectorRef.detectChanges();

        // Patch the role if it exists
        const role = this.RoleManagementData.find(
          (r) => r.RoleName === item.roleName
        );
        if (role) {
          this.onboardForm.patchValue({ role: role });
        } else {
          this.openModal(
            'exampleModalLabel1',
            `Role '${item.roleName}' is not available for team '${item.teamName}' in project '${this.selectedProject.projectName}'.`
          );
        }
      } else {
        this.openModal(
          'exampleModalLabel1',
          `Team '${item.teamName}' is not available for project '${this.selectedProject.projectName}'.`
        );
      }
    } else {
      this.loadTeamsForProject(this.selectedProject.projectName).subscribe({
        next: ({ data }) => {
          this._loadingService.hide();
          this.TeamManagementData = data.Teams.map((t: any) => ({
            TeamName: t.teamName || t.name,
            TeamId: t.teamId ?? null,
            roles: t.roles.map((r: any) =>
              typeof r === 'string'
                ? { roleName: r, roleId: null }
                : { roleName: r.role, roleId: r.roleId ?? null }
            ),
          }));
          this.changeDetectorRef.detectChanges();

          // Find and patch the team
          const team = this.TeamManagementData.find(
            (t) => t.TeamName === item.teamName
          );
          if (team) {
            this.onboardForm.patchValue({ team: team });

            // Populate roles
            this.RoleManagementData = team.roles.map((r: any) => ({
              RoleId: r.roleId ?? null,
              RoleName: r.roleName,
            }));
            this.changeDetectorRef.detectChanges();

            // Patch the role
            const role = this.RoleManagementData.find(
              (r) => r.RoleName === item.roleName
            );
            if (role) {
              this.onboardForm.patchValue({ role: role });
            } else {
              this.openModal(
                'exampleModalLabel1',
                `Role '${item.roleName}' is not available for team '${item.teamName}' in project '${this.selectedProject.projectName}'.`
              );
            }
          } else {
            this.openModal(
              'exampleModalLabel1',
              `Team '${item.teamName}' is not available for project '${this.selectedProject.projectName}'.`
            );
          }
        },
        error: (err) => {
          this._loadingService.hide();
          const error = getApiError(err);
          if (error) {
            this.openModal(
              'exampleModalLabel1',
              `No teams available for project '${this.selectedProject.projectName}'.`
            );
            return;
          }
          this.openModal(
            'exampleModalLabel1',
            `Failed to load teams for project '${item.projectName}'.`
          );
        },
      });
    }
  }
  removeMapping(index: number) {
    this.selectedMappings.splice(index, 1);
    this.editingMappingIndex = null; // Reset editing index
    this.changeDetectorRef.detectChanges();
  }

  isRoleMapped(roleName: string): boolean {
    if (this.IsUserEdit) {
      return false; // Allow all roles in edit mode
    }
    return this.selectedMappings.some((m) => m.roleName === roleName);
  }

  isTeamFullyMapped(teamName: string): boolean {
    const rolesMapped: string[] = this.RoleManagementData.map(
      (r) => r.RoleName
    );
    if (!rolesMapped.length) return false;

    const selectedRolesForTeam = this.selectedMappings
      .filter((m) => m.teamName === teamName)
      .map((m) => m.roleName);

    return rolesMapped.every((role) => selectedRolesForTeam.includes(role));
  }

  isRoleSelected(roleName: string) {
    return this.selectedMappings.some((m) => m.roleName === roleName);
  }

  isTeamAlreadyMapped(teamName: string) {
    return this.selectedMappings.some((m) => m.teamName === teamName);
  }

  isProjectAdded(projectName: string) {
    return this.selectedMappings.some((m) => m.projectName === projectName);
  }
  getRoleForActiveProject(): string {
    const activeProject = this.loggedUser.ActiveProject?.trim();
    const userDetails = this.UserManagementGridData?.find(
      (user) => user.Email === this.loggedUser.Email
    );

    if (userDetails && userDetails.PrjDetails && activeProject) {
      const projectDetails = userDetails.PrjDetails.find(
        (p: any) =>
          p.prj_name === activeProject || p.projectName === activeProject
      );
      return (
        projectDetails?.role_name ||
        projectDetails?.roleName ||
        this.loggedUser.Role
      );
    }
    return this.loggedUser.Role;
  }

  project_management_link(): void {
    this._router.navigate(['/managesubscription']);
  }
  isSuperAdminMaster(): boolean {
    return (
      this.roleDetail?.trim() === 'Super Admin' &&
      this.activeProject?.trim().toLowerCase() ===
        this.masterDatabase.trim().toLowerCase()
    );
  }

  get displayAvatar(): string {
    const path = this.avatarPath?.trim(); // trim whitespace
    if (!path || path === 'null' || path === 'undefined') {
      return 'assets/img/profile_image.png';
    }
    return path;
  }

  loadNotifications(){
    this._homeService.getNotificationsByUser(this.emailID).subscribe({
      next: (response: any) => {
        this.notifications = response.data;
        this.notificationRequestsCount = this.notifications.filter(n => n.type === 'recieved_request' || n.type === 'sent_request').length;
        this.notificationActivitiesCount = this.notifications.filter(n => n.type === 'activity').length;
        this.cdr?.detectChanges();
      },
      error: (err) => {
        console.error('Error loading notifications:', err);
      }
    });
  }

  openApprovalPage(data:any) {
    // const urlToOpen = environment.baseUIUrl + '?redirectRoute=agentApproval&agentId=' + data.agent_id + '&approvalAction=' + data.action;
    // window.open(urlToOpen, '_blank');
    localStorage.setItem('agentId', data.agent_id);
    localStorage.setItem('approvalAction', data.action);
    this._router.navigate(['/agentApproval']);
  } 
}
