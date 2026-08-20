import {
  AfterViewInit,
  Component,
  ElementRef,
  signal,
  ViewChild,
  ChangeDetectorRef,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Header } from '../../header/header'; 
import { ExternalAppServices } from '../../services/external-app.services';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { V } from '../../utils';
import { HostListener } from '@angular/core';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';

// declare var $: any;
declare var bootstrap: any;

interface IFilter {
  search?: string;
}

interface ICardItem {
  id: string;
  title: string;
  description: string;
  connector_type: string;
  application_url?: string;
  entity_type?: string;
  agent_name?: string;
  allowed_apis?: string[];
  status?: 'active' | 'inactive';
  auth_method?: string;
  last_synced_at?: string;
  createdAt?: string;
  updated_at?: string;
  badge?: string;
}

interface ITab {
  label: string;
  key: string;
  count: number;
}

@Component({
  selector: 'app-external-app-config',
  standalone: true,
  imports: [FormsModule, Header, CommonModule, ReactiveFormsModule, TooltipDirective],
  templateUrl: './external-app-config.html',
  styleUrl: './external-app-config.css',
})
export class ExternalAppConfig implements AfterViewInit {
  @ViewChild('deleteConfirmModal') deleteConfirmModal!: ElementRef;
  @ViewChild('addExternalAppModal') addExternalAppModal!: ElementRef;

  readonly tabs: ITab[] = [
    { label: 'Tab One', key: 'tab1', count: 0 },
    { label: 'Tab Two', key: 'tab2', count: 0 },
  ];

  readonly applicationTypes: { label: string; value: string; icon: string }[] = [
    { label: 'Web Application', value: 'Web Application', icon: 'assets/img/web_app.png' },
    { label: 'Microsoft Teams', value: 'Microsoft Teams', icon: 'assets/img/ms_teams.png' },
    { label: 'ServiceNow', value: 'ServiceNow', icon: 'assets/img/service_now.png' },
    { label: 'VS Code Extension', value: 'VS Code Extension', icon: 'assets/img/vs_code.png' },
    { label: 'Mobile Application', value: 'Mobile Application', icon: 'assets/img/mobile_app.png' },
  ];
  private readonly typesRequiringUrl = ['Web Application', 'Mobile Application'];
  isTypeDropdownOpen = false;
  readonly authenticationMethods = [
    { value: 'API Key', label: 'API Key', disabled: false },
    { value: 'JWT', label: 'JWT', disabled: true },
    { value: 'OAuth 2.0', label: 'OAuth 2.0', disabled: true },
  ];

  readonly allowedApis: { label: string; disabled: boolean }[] = [
    { label: 'Agents', disabled: false },
    { label: 'Tools', disabled: false },
    { label: 'Workflows', disabled: false },
    { label: 'Knowledge Bases', disabled: true },
    { label: 'Voice Agents', disabled: false },
    { label: 'Insights', disabled: true },  
  ];

  items: ICardItem[] = [];
  filteredItems: ICardItem[] = [];
  loading = signal(false);
  selectedData?: ICardItem;
  showDeleteModal = signal(false);
  addForm: FormGroup;
  modalAction: 'create' | 'update' = 'create';
  modalTitle: string = 'Register External Application';
  selectedCardDetails: ICardItem | null = null;
  isSubmitting = false;
  isDeleting = false;
  addModalInstance: any = null;
  deleteModalInstance: any = null;
  toastMessage: string = '';
  toastType: 'success' | 'error' | '' = '';
  page = signal(1);
  pageSize = signal(12);
  readonly pageSizeOptions = [12, 24, 48, 100];
  viewMode: 'grid' | 'list' = 'grid';
  filters = signal<IFilter>({ search: '' });
  filterName: string = '';
  filterType: string = '';
  filterAuthMethod: string = '';
  filterStatus: string = '';
  filterCreatedDate: string = '';
  isPrivilegeView: boolean = false;
  isPrivilegeAdd: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;

  readonly connectorIconsMap: Record<string, string> = {};

  constructor(
    private readonly cdr: ChangeDetectorRef,
    private readonly fb: FormBuilder,
    private externalAppService: ExternalAppServices,
    private _stateService: AIInfuseStateService
  ) {
    this.addForm = this.fb.group({
      application_name: ['', [Validators.required, Validators.maxLength(100)]],
      application_type: ['Web Application', Validators.required],
      application_url: ['', [Validators.required, ...[].concat(V.string('Application URL').url().build() as any),]],
      description: [''],
      allowed_apis: [[], [this.minArrayLength(1)]],
      authentication_method: ['API Key', Validators.required],
      status: [true],
    });
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.isTypeDropdownOpen = false;
  }

  ngOnInit(): void {
    this.loadExternalApps();
    this.loadPrivileges();
  }

  ngAfterViewInit(): void {}

  loadPrivileges() {
    this._stateService.getPrivilegesByPage('External Applications').subscribe({
      next: (loaded_privileges:any) => {
        console.log('Loaded privileges for Ext App by page: ', loaded_privileges);
        if (loaded_privileges) {
          this.isPrivilegeView = loaded_privileges?.view || false;
          this.isPrivilegeEdit = loaded_privileges?.['insert / edit'] || loaded_privileges?.edit || false;
          this.isPrivilegeAdd = loaded_privileges?.['add / create'] || loaded_privileges?.add || false;
          this.isPrivilegeDelete = loaded_privileges?.delete || false;
          this.cdr.detectChanges();
        }
      }
    });
  }

  needsApplicationUrl(): boolean {
    const type = this.addForm?.get('application_type')?.value;
    return this.typesRequiringUrl.includes(type);
  }

  updateUrlValidators(): void {
    const urlControl = this.addForm.get('application_url');
    if (!urlControl) return;

    if (this.needsApplicationUrl()) {
      urlControl.setValidators([
        Validators.required,
        ...[].concat(V.string('Application URL').url().build() as any),
      ]);
    } else {
      urlControl.clearValidators();
      urlControl.setValue('');
    }
    urlControl.updateValueAndValidity({ emitEvent: false });
    urlControl.markAsPristine();
    urlControl.markAsUntouched();
  }

  private mapApiToUi(api: string): string {
    const map: Record<string, string> = {
      agents: 'Agents',
      tools: 'Tools',
      workflows: 'Workflows',
      knowledge_base: 'Knowledge Bases',
      voice_agents: 'Voice Agents',
      insights: 'Insights',
    };
    return map[api?.toLowerCase()] || api;
  }

  loadExternalApps(): void {
    this.loading.set(true);
    this.externalAppService.getExternalApplications().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.items = res.data.map((app: any) => ({
            id: app.application_id,
            title: app.name,
            description: app.description,
            connector_type: this.mapApplicationType(app.application_type),
            application_url: app.application_url || '',
            auth_method: app.auth_method,
            status: app.status,
            allowed_apis: (app.allowed_apis || []).map((a: string) => this.mapApiToUi(a)),
            createdAt: app.created_at,
          }));
          this.applyFilters();
        }
        this.loading.set(false);
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading.set(false);
        this.showToast('error', 'Failed to load external applications');
      }
    });
  }

  private minArrayLength(min: number) {
    return (control: any) => {
      const value = control.value;
      if (!Array.isArray(value) || value.length < min) {
        return { minLength: true };
      }
      return null;
    };
  }

  getUrlErrorMessage(): string {
    const control = this.addForm.get('application_url');
    if (!control?.errors) return '';
    if (control.errors['required']) return 'Application URL is required.';
    if (control.errors['url'] || control.errors['pattern'] || control.errors['invalid']) {
      return 'Please enter a valid URL (e.g. https://example.com)';
    }
    const firstKey = Object.keys(control.errors)[0];
    const err = control.errors[firstKey];
    if (typeof err === 'string') return err;
    if (err?.message) return err.message;
    return 'Please enter a valid URL (e.g. https://example.com)';
  }

  applyAdvancedFilters(): void {
    this.applyFilters();
  }

  clearFilters(): void {
    this.filterName = '';
    this.filterType = '';
    this.filterAuthMethod = '';
    this.filterStatus = '';
    this.filterCreatedDate = '';
    this.filters.set({ search: '' });
    this.applyFilters();
  }

  applyFilters(): void {
    const f = this.filters();
    let result = [...this.items];

    if (f.search) {
      const s = f.search.toLowerCase().trim();
      result = result.filter(
        (item) =>
          item.title?.toLowerCase().includes(s) ||
          item.description?.toLowerCase().includes(s) ||
          item.connector_type?.toLowerCase().includes(s)
      );
    }

    if (this.filterName?.trim()) {
      const name = this.filterName.toLowerCase().trim();
      result = result.filter((item) => item.title?.toLowerCase().includes(name));
    }

    if (this.filterType) {
      result = result.filter((item) => item.connector_type === this.filterType);
    }

    if (this.filterStatus) {
      result = result.filter((item) => item.status === this.filterStatus);
    }

    if (this.filterAuthMethod) {
      result = result.filter((item: any) => item.auth_method === this.filterAuthMethod);
    }

    if (this.filterCreatedDate) {
      const selected = new Date(this.filterCreatedDate);
      const y = selected.getFullYear();
      const m = selected.getMonth();
      const d = selected.getDate();

      result = result.filter((item) => {
        if (!item.createdAt) return false;
        const created = new Date(item.createdAt);
        return (
          created.getFullYear() === y &&
          created.getMonth() === m &&
          created.getDate() === d
        );
      });
    }

    this.filteredItems = result;
    this.page.set(1);
    this.cdr.detectChanges();
  }

  get totalPages(): number {
    return Math.ceil(this.filteredItems.length / this.pageSize()) || 1;
  }

  get paginatedData(): ICardItem[] {
    const start = (this.page() - 1) * this.pageSize();
    const end = start + this.pageSize();
    return this.filteredItems.slice(start, end);
  }

  get startIndex(): number {
    return (this.page() - 1) * this.pageSize();
  }

  get endIndex(): number {
    const end = this.page() * this.pageSize();
    return Math.min(end, this.filteredItems.length);
  }

  get hasPrevPage(): boolean {
    return this.page() > 1;
  }

  get hasNextPage(): boolean {
    return this.page() < this.totalPages;
  }

  onPageSizeChange(size: number | string): void {
    this.pageSize.set(Number(size));
    this.page.set(1);
  }

  get visiblePages(): number[] {
    const total = this.totalPages;
    const current = this.page();
    const maxVisible = 5;

    if (total <= maxVisible) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }

    let start = Math.max(1, current - Math.floor(maxVisible / 2));
    let end = start + maxVisible - 1;

    if (end > total) {
      end = total;
      start = Math.max(1, end - maxVisible + 1);
    }

    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  submitAddForm(): void {
    if (this.isSubmitting) return;

    if (!this.addForm.valid) {
      this.addForm.markAllAsTouched();
      this.cdr.detectChanges();
      return;
    }

    this.isSubmitting = true;
    const formValues = this.addForm.value;

    const payload = {
      name: formValues.application_name,
      application_type: this.mapTypeToBackend(formValues.application_type),
      application_url: formValues.application_url,
      description: formValues.description,
      allowed_apis: (formValues.allowed_apis || []).map((api: string) =>
        api.toLowerCase().replace(/ /g, '_')
      ),
      auth_method: 'api_key',
      status: formValues.status ? 'active' : 'inactive'
    };

    const request$ =
      this.modalAction === 'update' && this.selectedCardDetails?.id
        ? this.externalAppService.updateExternalApplication(
          this.selectedCardDetails.id,
          payload
        )
        : this.externalAppService.registerExternalApplication(payload);

    request$.subscribe({
      next: (res) => {
        this.isSubmitting = false;
        if (res.success) {
          const msg =
            this.modalAction === 'update'
              ? 'External application updated successfully.'
              : 'External application registered successfully.';
          this.showToast('success', msg);
          this.closeAddModal();
          this.loadExternalApps();
        } else {
          this.showToast('error', res.message || 'Operation failed');
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.isSubmitting = false;
        this.showToast('error', 'Failed to save external application');
        this.cdr.detectChanges();
      }
    });
  }

  private mapApplicationType(type: string): string {
    const map: Record<string, string> = {
      web: 'Web Application',
      teams: 'Microsoft Teams',
      vscode: 'VS Code Extension',
      servicenow: 'ServiceNow',
      mobile: 'Mobile Application',
    };
    return map[type] || type;
  }

  private mapTypeToBackend(uiType: string): string {
    const map: Record<string, string> = {
      'Web Application': 'web',
      'Microsoft Teams': 'teams',
      'VS Code Extension': 'vscode',
      'ServiceNow': 'servicenow',
      'Mobile Application': 'mobile',
    };
    return map[uiType] || 'web';
  }

  resetAddForm(): void {
    this.addForm.reset({
      application_name: '',
      application_type: 'Web Application',
      application_url: '',
      description: '',
      allowed_apis: [],
      authentication_method: 'API Key',
      status: true,
    });
    this.addForm.markAsPristine();
    this.addForm.markAsUntouched();
    Object.keys(this.addForm.controls).forEach((key) => {
      const control = this.addForm.get(key);
      control?.setErrors(null);
      control?.markAsPristine();
      control?.markAsUntouched();
    });
    this.updateUrlValidators();
    this.selectedCardDetails = null;
  }

  isApiChecked(api: string): boolean {
    const arr = this.addForm.get('allowed_apis')?.value as string[] || [];
    return arr.includes(api);
  }

  toggleApi(api: string, event: Event): void {
    const control = this.addForm.get('allowed_apis');
    const arr = [...(control?.value as string[] || [])];
    const index = arr.indexOf(api);

    if (index === -1) {
      arr.push(api);
    } else {
      arr.splice(index, 1);
    }

    control?.setValue(arr);
    control?.markAsTouched();
    control?.updateValueAndValidity();
  }

  openAddModal(): void {
    this.modalAction = 'create';
    this.modalTitle = 'Register External Application';
    this.selectedCardDetails = null;
    this.resetAddForm();

    try {
      const el = this.addExternalAppModal?.nativeElement;
      if (el) {
        this.addModalInstance = new bootstrap.Modal(el);
        this.addModalInstance.show();
      }
    } catch (e) {
      console.error('Failed to open modal:', e);
    }
  }

  openEditModal(item: ICardItem): void {
    this.modalAction = 'update';
    this.modalTitle = item.title || 'Update External Application';
    this.selectedCardDetails = { ...item };

    this.addForm.reset({
      application_name: item.title || '',
      application_type: item.connector_type || 'Web Application',
      application_url: item.application_url || '',
      description: item.description || '',
      allowed_apis: item.allowed_apis || [],
      authentication_method: 'API Key',
      status: item.status === 'active',
    });

    this.addForm.markAsPristine();
    this.addForm.markAsUntouched();
    Object.keys(this.addForm.controls).forEach((key) => {
      const control = this.addForm.get(key);
      control?.markAsPristine();
      control?.markAsUntouched();
    });

    this.updateUrlValidators();
    try {
      const el = this.addExternalAppModal?.nativeElement;
      if (el) {
        this.addModalInstance = new bootstrap.Modal(el);
        this.addModalInstance.show();
      }
    } catch (e) {
      console.error('Failed to open modal:', e);
    }
  }

  closeAddModal(): void {
    try {
      if (this.addModalInstance) {
        this.addModalInstance.hide();
        this.addModalInstance = null;
      }
    } catch (e) {
      console.error('Failed to close modal:', e);
    }
  }

  showToast(type: 'success' | 'error', message: string): void {
    this.toastMessage = message;
    this.toastType = type;
    this.cdr.detectChanges();

    const toastElement = document.getElementById(
      type === 'success' ? 'successToast' : 'errorToast'
    );
    if (toastElement) {
      const toast = new bootstrap.Toast(toastElement);
      toast.show();
    }
  }

  setFilters(patch: Partial<IFilter>): void {
    this.filters.update((prev) => ({ ...prev, ...patch }));
    this.applyFilters();
  }

  prevPage(): void {
    if (this.hasPrevPage) this.page.update((p) => p - 1);
  }

  nextPage(): void {
    if (this.hasNextPage) this.page.update((p) => p + 1);
  }

  goToLast(): void {
    this.page.set(this.totalPages);
  }

  setPage(p: number): void {
    if (p >= 1 && p <= this.totalPages) this.page.set(p);
  }

  onCardClick(item: ICardItem): void {
    this.openEditModal(item);
  }

  // ✅ FIXED: Replace jQuery with native Bootstrap
  openDeleteConfirmModal(event: Event | null, item: ICardItem): void {
    event?.stopPropagation();
    this.selectedData = item;
    this.showDeleteModal.set(true);
    
    try {
      const el = this.deleteConfirmModal?.nativeElement;
      if (el) {
        this.deleteModalInstance = new bootstrap.Modal(el);
        this.deleteModalInstance.show();
      }
    } catch (e) {
      console.error('Failed to open modal:', e);
    }
  }

  // ✅ FIXED: Replace jQuery with native Bootstrap
  confirmDelete(): void {
    if (!this.selectedData || this.isDeleting) return;
    this.isDeleting = true;

    this.externalAppService.deleteExternalApplication(this.selectedData.id).subscribe({
      next: (res) => {
        this.isDeleting = false;
        if (res.success) {
          this.showToast('success', 'External app deleted successfully.');
          
          // ✅ Use native Bootstrap instead of jQuery
          if (this.deleteModalInstance) {
            this.deleteModalInstance.hide();
            this.deleteModalInstance = null;
          }
          
          this.loadExternalApps();
        } else {
          this.showToast('error', res.message || 'Failed to delete external application');
        }
      },
      error: () => {
        this.isDeleting = false;
        this.showToast('error', 'Failed to delete external application');
      }
    });
  }

  getAppIcon(type: string): string {
    const found = this.applicationTypes.find((t) => t.value === type || t.label === type);
    return found?.icon || 'assets/default-icon.png';
  }

  getSelectedTypeIcon(): string {
    const selected = this.addForm.get('application_type')?.value;
    const found = this.applicationTypes.find((t) => t.value === selected);
    return found?.icon || 'assets/icons/web-app.svg';
  }

  getSelectedTypeLabel(): string {
    return this.addForm.get('application_type')?.value || 'Select Type';
  }

  toggleTypeDropdown(event?: Event): void {
    event?.stopPropagation();
    this.isTypeDropdownOpen = !this.isTypeDropdownOpen;
  }

  selectApplicationType(type: { label: string; value: string; icon: string }): void {
    this.addForm.get('application_type')?.setValue(type.value);
    this.addForm.get('application_type')?.markAsTouched();
    this.isTypeDropdownOpen = false;
    this.updateUrlValidators();
  }

  closeTypeDropdown(): void {
    this.isTypeDropdownOpen = false;
  }
}