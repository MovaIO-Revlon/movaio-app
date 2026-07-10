import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { SemarketplaceService } from '../../services/semarketplace.service';

declare var bootstrap: any;

@Component({
  selector: 'app-automationlibrary',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ReactiveFormsModule,
  ],
  templateUrl: './automationlibrary.html',
  styleUrl: './automationlibrary.css',
})
export class AutomationLibrary implements OnInit {
  // Data Management
  automationLibraries: any[] = [];
  filteredLibraries: any[] = [];
  
  // Search & Filter
  librarySearchTerm: string = '';
  filterForm!: FormGroup;

  // Add Library Form
  addLibraryForm!: FormGroup;
  selectedFiles: File[] = [];
  automationScriptTypes: any[] = [];
  modalAction: 'create' | 'update' = 'create';
  modalTitle: string = 'Add New Automation Script';
  selectedLibraryDetails: any = null;

  // Pagination
  currentPage: number = 1;
  itemsPerPage: number = 12;
  totalPages: number = 1;
  
  // UI State
  toastMessage: string = '';
  toastType: 'success' | 'error' | '' = '';
  isSubmitting: boolean = false;
  duplicateLibraryName: boolean = false;
  
  // Privileges
  isPrivilegeView: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeRefresh: boolean = false;
  
  // Logged User
  loggedUser: any;

  // Delete confirmation
  libraryToDelete: any = null;
  deleteConfirmModal: any = null;

  constructor(
    private readonly cdr: ChangeDetectorRef,
    private readonly fb: FormBuilder,
    private readonly _stateService: AIInfuseStateService,
    private readonly _apiService: SemarketplaceService,
  ) {}

  ngOnInit(): void {
    this.loggedUser = this._stateService.getLoginDetails();
    this.initFilterForm();
    this.initAddLibraryForm();
    this.loadAutomationLibraries();
    this.loadAutomationScriptTypes();
    this.loadPrivileges();
  }

  initFilterForm(): void {
    this.filterForm = this.fb.group({
      category: [''],
    });
  }

  initAddLibraryForm(): void {
    this.addLibraryForm = this.fb.group({
      name: ['', Validators.required],
      description: ['', Validators.required],
      automation_script_type: ['', Validators.required],
    });
  }

  loadAutomationLibraries(): void {
    this._apiService.getAutomationLibraries().subscribe({
      next: (res) => {
        if (res?.success) {
          this.automationLibraries = res.data || [];
          this.filteredLibraries = [...this.automationLibraries];
          this.currentPage = 1;
          this.updatePagination();
        } else {
          this.automationLibraries = [];
          this.filteredLibraries = [];
          this.currentPage = 1;
          this.updatePagination();
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading automation libraries:', err);
        this.automationLibraries = [];
        this.filteredLibraries = [];
        this.currentPage = 1;
        this.updatePagination();
        this.cdr.detectChanges();
      },
    });
  }

  filterLibraries(): void {
    let sourceList = [...this.automationLibraries];

    if (this.librarySearchTerm) {
      const searchTerm = this.librarySearchTerm.toLowerCase().trim();
      sourceList = sourceList.filter(
        (library) =>
          library.name?.toLowerCase().includes(searchTerm) ||
          library.description?.toLowerCase().includes(searchTerm) ||
          library.category?.toLowerCase().includes(searchTerm)
      );
    }

    this.filteredLibraries = sourceList;
    this.currentPage = 1;
    this.updatePagination();
    this.cdr.detectChanges();
  }

  applyFilters(): void {
    const categoryFilter = this.filterForm.get('category')?.value?.toLowerCase() || '';

    let sourceList = [...this.automationLibraries];

    if (categoryFilter) {
      sourceList = sourceList.filter(
        (library) =>
          library.category?.toLowerCase().includes(categoryFilter)
      );
    }

    if (this.librarySearchTerm) {
      const searchTerm = this.librarySearchTerm.toLowerCase().trim();
      sourceList = sourceList.filter(
        (library) =>
          library.name?.toLowerCase().includes(searchTerm) ||
          library.description?.toLowerCase().includes(searchTerm)
      );
    }

    this.filteredLibraries = sourceList;
    this.currentPage = 1;
    this.updatePagination();

    this.closeFilterModal();
    this.cdr.detectChanges();
  }

  clearFilters(): void {
    this.filterForm.setValue({
      category: '',
    });
    this.librarySearchTerm = '';
    this.filterLibraries();
    this.closeFilterModal();
    this.cdr.detectChanges();
  }

  getCategories(): string[] {
    const categories = this.automationLibraries
      .map((lib) => lib.category)
      .filter((cat, index, self) => cat && self.indexOf(cat) === index);
    return categories;
  }

  getScriptCount(library: any): number {
    if (library.script_count !== undefined && library.script_count !== null) {
      return Number(library.script_count) || 0;
    }
    if (library.scriptCount !== undefined && library.scriptCount !== null) {
      return Number(library.scriptCount) || 0;
    }
    if (Array.isArray(library.scripts)) {
      return library.scripts.length;
    }
    if (library.scripts_count !== undefined && library.scripts_count !== null) {
      return Number(library.scripts_count) || 0;
    }
    return 0;
  }

  updatePagination(): void {
    this.totalPages = Math.ceil(this.filteredLibraries.length / this.itemsPerPage) || 1;
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }
  }

  get paginatedLibraries(): any[] {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    return this.filteredLibraries.slice(startIndex, endIndex);
  }

  getPageNumbers(): number[] {
    const pages: number[] = [];
    const maxPagesToShow = 5;
    let startPage = Math.max(1, this.currentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(this.totalPages, startPage + maxPagesToShow - 1);

    if (endPage - startPage + 1 < maxPagesToShow) {
      startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    return pages;
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.cdr.detectChanges();
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.cdr.detectChanges();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.cdr.detectChanges();
    }
  }

  NewLibrary(): void {
    this.modalAction = 'create';
    this.modalTitle = 'Add New Automation Script';
    this.selectedLibraryDetails = null;
    this.resetAddLibraryForm();
    this.showAddLibraryModal();
  }

  openLibraryModal(library: any): void {
    const libraryId = library.id || library._id || library.library_id || library.libraryId;
    this.modalAction = 'update';
    this.modalTitle = 'Update Automation Script';
    this.selectedFiles = [];
    this.duplicateLibraryName = false;

    if (!libraryId) {
      this.selectedLibraryDetails = library;
      this.addLibraryForm.patchValue({
        name: library.name || library.library_name || '',
        description: library.description || '',
      });
      this.checkDuplicateLibraryName();
      this.cdr.detectChanges();
      this.showAddLibraryModal();
      return;
    }

    this._apiService.getAutomationLibraryById(libraryId).subscribe({
      next: (res) => {
        if (res?.success) {
          const data = res.data || {};
          this.selectedLibraryDetails = data;
          this.addLibraryForm.patchValue({
            name: data.name || data.library_name || '',
            description: data.description || '',
            automation_script_type: data.automation_script_type || data.automation_script_type_id || data.automationScriptType || data.script_type || '',
          });
          this.checkDuplicateLibraryName();
        } else {
          this.showToast('error', 'Unable to load library details.');
        }
        this.cdr.detectChanges();
        this.showAddLibraryModal();
      },
      error: (err) => {
        console.error('Error loading automation script details:', err);
        this.showToast('error', 'Unable to load script details.');
        this.cdr.detectChanges();
        this.showAddLibraryModal();
      },
    });
  }

  private getLibraryId(library: any): string | null {
    return (
      library._id ||
      library.library_id ||
      library.id ||
      library.libraryId ||
      null
    );
  }

  deleteLibrary(library: any): void {
    const libraryId = this.getLibraryId(library);
    if (!libraryId) {
      this.showToast('error', 'Unable to delete library: missing id.');
      return;
    }

    this.libraryToDelete = library;
    this.showDeleteConfirmModal();
  }

  showDeleteConfirmModal(): void {
    const modalElement = document.getElementById('deleteConfirmModal');
    if (modalElement) {
      this.deleteConfirmModal = new bootstrap.Modal(modalElement);
      this.deleteConfirmModal.show();
    }
  }

  confirmDelete(): void {
    if (!this.libraryToDelete) return;

    const libraryId = this.getLibraryId(this.libraryToDelete);
    if (!libraryId) {
      this.showToast('error', 'Unable to delete library: missing id.');
      this.cancelDelete();
      return;
    }

    this._apiService.deleteAutomationLibrary(libraryId).subscribe({
      next: (res) => {
        if (res?.success) {
          this.showToast('success', 'Library deleted successfully.');
          this.loadAutomationLibraries();
          this.cdr.detectChanges();
        } else {
          this.showToast('error', res?.message || 'Failed to delete library.');
          this.cdr.detectChanges();
        }
        this.cancelDelete();
      },
      error: (err) => {
        console.error('Error deleting automation library:', err);
        this.showToast('error', 'Failed to delete library.');
        this.cdr.detectChanges();
        this.cancelDelete();
      },
    });
  }

  cancelDelete(): void {
    if (this.deleteConfirmModal) {
      this.deleteConfirmModal.hide();
    }
    this.libraryToDelete = null;
  }

  showAddLibraryModal(): void {
    const addModalElement = document.getElementById('addLibraryModal');
    if (addModalElement) {
      const modal = new bootstrap.Modal(addModalElement);
      modal.show();
    }
  }

  resetAddLibraryForm(): void {
    this.addLibraryForm.reset({
      name: '',
      description: '',
      automation_script_type: '',
    });
    this.selectedFiles = [];
    this.selectedLibraryDetails = null;
    this.duplicateLibraryName = false;
    this.cdr.detectChanges();
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) {
      return;
    }

    const files = Array.from(input.files);
    this.selectedFiles = [...this.selectedFiles, ...files];
    input.value = '';
    this.cdr.detectChanges();
  }

  removeExistingFile(index: number): void {
    if (!this.selectedLibraryDetails?.script_file_ids) {
      return;
    }
    this.selectedLibraryDetails.script_file_ids.splice(index, 1);
    this.cdr.detectChanges();
  }

  loadAutomationScriptTypes(): void {
    this._apiService.getAutomationScriptTypes().subscribe({
      next: (res) => {
        if (res?.success) {
          this.automationScriptTypes = res.data || [];
        } else {
          this.automationScriptTypes = [];
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error loading automation script types:', err);
        this.automationScriptTypes = [];
        this.cdr.detectChanges();
      },
    });
  }

  removeSelectedFile(index: number): void {
    this.selectedFiles.splice(index, 1);
    this.cdr.detectChanges();
  }

  checkDuplicateLibraryName(): void {
    const nameControl = this.addLibraryForm.get('name');
    const nameValue = nameControl?.value?.toString().trim() || '';
    if (!nameValue) {
      this.duplicateLibraryName = false;
      return;
    }

    const normalizedName = nameValue.toLowerCase();
    const currentLibraryId = this.getLibraryId(this.selectedLibraryDetails || {});

    this.duplicateLibraryName = this.automationLibraries.some((library) => {
      const libraryName = (library.name || library.library_name || '').toString().trim().toLowerCase();
      const libraryId = this.getLibraryId(library);
      return (
        libraryName &&
        libraryName === normalizedName &&
        (!currentLibraryId || libraryId !== currentLibraryId)
      );
    });
  }

  submitAddLibrary(): void {
    if (this.isSubmitting) {
      return;
    }

    if (!this.addLibraryForm.valid) {
      this.showToast('error', 'Please enter a library name.');
      return;
    }

    if (this.duplicateLibraryName) {
      this.showToast('error', 'A script with this name already exists.');
      return;
    }

    this.isSubmitting = true;
    this.cdr.detectChanges();

    const formData = new FormData();
    formData.append('name', this.addLibraryForm.get('name')?.value || '');
    formData.append('description', this.addLibraryForm.get('description')?.value || '');
    formData.append('automation_script_type', this.addLibraryForm.get('automation_script_type')?.value || '');

    if (this.modalAction === 'update' && this.selectedLibraryDetails) {
      const libraryId = this.selectedLibraryDetails._id || this.selectedLibraryDetails.library_id || this.selectedLibraryDetails.id || this.selectedLibraryDetails.libraryId;
      if (libraryId) {
        formData.append('_id', libraryId);
        formData.append('library_id', libraryId);
      }

      const remainingFileIds = (this.selectedLibraryDetails.script_file_ids || [])
        .map((file: any) => file.file_id || file.id || file.fileId)
        .filter(Boolean);
      formData.append('script_file_ids', JSON.stringify(remainingFileIds));
    }

    this.selectedFiles.forEach((file) => {
      formData.append('files', file, file.name);
    });

    const request$ = this.modalAction === 'update'
      ? this._apiService.updateAutomationLibrary(formData)
      : this._apiService.addAutomationLibrary(formData);

    request$.subscribe({
      next: (res) => {
        this.isSubmitting = false;
        if (res?.success) {
          this.showToast('success', this.modalAction === 'update' ? 'Library updated successfully.' : 'Library added successfully.');
          this.resetAddLibraryForm();
          this.loadAutomationLibraries();
          setTimeout(() => {
            this.closeAddLibraryModal();
            this.cdr.detectChanges();
          }, 500);
        } else {
          this.showToast('error', res?.message || `Failed to ${this.modalAction === 'update' ? 'update' : 'add'} library.`);
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isSubmitting = false;
        console.error(`Error ${this.modalAction === 'update' ? 'updating' : 'adding'} automation library:`, err);
        this.showToast('error', `Failed to ${this.modalAction === 'update' ? 'update' : 'add'} library.`);
        this.cdr.detectChanges();
      },
    });
  }

  closeAddLibraryModal(): void {
    const modalElement = document.getElementById('addLibraryModal');
    if (modalElement) {
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) {
        modal.hide();
      }
    }
  }

  closeFilterModal(): void {
    const modalElement = document.getElementById('filterLibrary');
    if (modalElement) {
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) {
        modal.hide();
      }
    }
  }

  showToast(type: 'success' | 'error', message: string): void {
    this.toastMessage = message;
    this.toastType = type;
    const toastElement = document.getElementById(
      type === 'success' ? 'successToast' : 'errorToast'
    );
    if (toastElement) {
      const toast = new bootstrap.Toast(toastElement);
      toast.show();
    }
  }

  loadPrivileges(): void {
    this._stateService.getPrivilegesByPage('Automation Library').subscribe({
      next: (loaded_privileges: any) => {
        if (loaded_privileges) {
          this.isPrivilegeView = loaded_privileges?.view || false;
          this.isPrivilegeEdit = loaded_privileges?.['insert / edit'] || loaded_privileges?.edit || false;
          this.isPrivilegeDelete = loaded_privileges?.delete || false;
          this.isPrivilegeRefresh = loaded_privileges?.refresh || false;
          this.cdr.detectChanges();
        }
      },
    });
  }
}
