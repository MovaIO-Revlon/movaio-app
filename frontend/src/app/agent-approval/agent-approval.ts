import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Header } from '../header/header';
import { SemarketplaceService } from '../services/semarketplace.service';
import { NgxSpinnerService } from 'ngx-spinner';

declare var bootstrap: any;

@Component({
  selector: 'app-agent-approval',
  standalone: true,
  imports: [CommonModule, Header],
  templateUrl: './agent-approval.html',
  styleUrl: './agent-approval.css'
})
export class AgentApproval {
  agentId: string = '';
  approvalAction:string = '';
  agentDetails: any;
  confirmationAction: 'Approved' | 'Rejected' | null = null;
  agentStatus: string | null = null;
  private modalInstance: any;
  toastMessage: string = '';

  constructor(private readonly _marketplaceService: SemarketplaceService , private readonly _loadingService: NgxSpinnerService, private readonly cdr: ChangeDetectorRef) {
  }

  ngOnInit() {
    this.agentId = localStorage.getItem('agentId') || '';
    this.approvalAction = localStorage.getItem('approvalAction') || '';
    this.getAgentDetails();
  }

  getAgentDetails(){
    this._loadingService.show();
    if (this.agentId) {
      this._marketplaceService.getAgentDetailsById(this.agentId).subscribe((response:any) => {
        console.log('Agent details fetched successfully:', response.data);
        this.agentDetails = response.data;
        this.agentStatus= response.data.Approval_Status || '';
        this.cdr.detectChanges(); // Trigger change detection to update the view
        this._loadingService.hide();
      },
      (error) => { 
        console.error('Error fetching agent details:', error);
        this.cdr.detectChanges(); // Trigger change detection to update the view
        this._loadingService.hide();
      }
    );
    }
  }

  openConfirm(action: 'Approved' | 'Rejected') {
    this.confirmationAction = action;

    const modalElement = document.getElementById('approvalConfirmModal');
    if (modalElement) {
      this.modalInstance = new bootstrap.Modal(modalElement);
      this.modalInstance.show();
    }
  }

  confirmAction() {
    if (!this.confirmationAction || !this.agentId) {
      return;
    }
    this._loadingService.show();

    this._marketplaceService.agentApprovalAction(this.agentId, this.confirmationAction , this.approvalAction).subscribe((response) => {
      if (response && response.success) {
        console.log('Agent approved successfully:', response);
        console.log('Agent approval action:', this.confirmationAction);
        this.agentStatus = this.confirmationAction;
        this.cdr.detectChanges(); // Trigger change detection to update the view
        this._loadingService.hide();
      }
      else{
        this.showToast('error', response.message || 'An error occurred while processing the request.');
        this._loadingService.hide();
      }
    },
    (error) => {
      console.error('Error approving agent:', error);
      this.cdr.detectChanges(); // Trigger change detection to update the view
      this._loadingService.hide();
    });

    if (this.modalInstance) {
      this.modalInstance.hide();
    }
    // this.confirmationAction = null;
  }

  get confirmationTitle() {
    return this.confirmationAction === 'Approved' ? 'Confirm Approval' : 'Confirm Decline';
  }

  get confirmationMessage() {
    return this.confirmationAction === 'Approved'
      ? 'Are you sure you want to approve this request? Once approved, the new agent will be onboarded and published to the Agent Marketplace.'
      : 'Are you sure you want to decline this request? Declined agents will not be onboarded and the requester will be notified.';
  }

  get confirmationButtonLabel() {
    return this.confirmationAction === 'Approved' ? 'Confirm Approval' : 'Confirm Decline';
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
}
