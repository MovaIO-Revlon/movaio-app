import { Component, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { NgxSpinnerService } from 'ngx-spinner';
import { PromptRepositoryService, TryPromptData } from '../../services/prompt-repository.service';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { Router, NavigationEnd } from '@angular/router';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { SemarketplaceService } from '../../services/semarketplace.service';
import { environment as config } from '../../../environments/environment';

declare var bootstrap: any;

interface Agent {
  agent_id: string;
  agent_type_id: string;
  agent_type_name:string;
  name: string;
  usage_count?: number;
  last_used?: string;
  average_rating?: number;
  queries?: any[];
  description?: string;
  model?: string;
  master_agent_id?: string;
  master_agent_name?: string;
  agency_id:string;
}

interface Agency {
  agency_name: string;
  agency_run_count: number;
  agents: Agent[];
  avatar?: string;
}

interface PromptMetrics {
  correctness?: number;
  accuracy?: number;
  safety?: number;
  coherence?: number;
  conciseness?: number;
  relevance?: number;
  latency?: number;
  status?: number;
}

interface AgentConfig {
  agent_id: string;
  name: string;
  agent_type?: string;
  agent_type_name?: string; 
  model?: string;
  model_name?: string;        
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  description?: string;
  system_prompt?: string;
  tools?: any[];
  configurations?: any;
  master_agent_id?: string;  
  master_agent_name?: string; 
  [key: string]: any;
}

@Component({
  selector: 'app-promptrepository',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule,TooltipDirective],
  templateUrl: './promptrepository.html',
  styleUrls: ['./promptrepository.css']
})
export class Promptrepository {
  constructor(
    private _loadingService: NgxSpinnerService,
    private promptRepoService: PromptRepositoryService,
    private _stateService: AIInfuseStateService,
    private cdr: ChangeDetectorRef,
    private _router: Router,
    private _marketService: SemarketplaceService,
  ) {}
  
  apiData: any = null;
  selectedAgency: any = null;
  showAddPrompt = false;
  currentAgent: any = null;
  newPRForm = {
    agency: '',
    agent: '',
    promptTitle: '',
    prompt: '',
    created_by: '',
    map_id:''
  };
  promptActions: { [key: string]: boolean } = {};
  filteredAgentsForModal: Agent[] = [];
  toastMessage: string = '';
  toastType: 'success' | 'error' = 'success';
  deleteConfirmModal: any;
  queryToDelete: any = null;
  isDeleting = false;
  agentToDelete: any = null;
  editConfirmModal: any;
  queryToEdit: any = null;
  agentToEdit: any = null;
  isEditing = false;
  editForm = {
    promptTitle: '',
    prompt: ''
  };
  isSuperAdmin: boolean = false;
  globalSearchTerm: string = '';
  modalSearchTerm: string = '';
  filteredAgencies: any[] = [];
  filteredAgentsInModal: Agent[] = [];
  filteredModalData: any[] = [];
  filterAgency: string = '';
  filterAgent: string = '';
  filteredFilterAgents: any[] = [];
  allAvailableAgents: any[] = [];
  editWarningModal: any = null;
  queryToEditWarning: any = null;
  agentToEditWarning: any = null;
  agenciesWithAgents: any[] = [];
  itemsPerPage: number = 10;
  promptPageMap: { [agentId: string]: number } = {};
  isLoadingAgencies: boolean = false;
  expandedAgentId: string | null = null;
  expandedQueryId: string | null = null;
  isPrivilegeView: boolean = false;
  isPrivilegeAdd: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeExecute: boolean = false;
  isPrivilegeRefresh: boolean = false;
  loggedUser: any;
  masterDatabase = config.masterDatabase;
  isRefreshing: boolean = false;
  refreshingAgencyId: string | null = null;
  allAgentDetails: any[] = [];
  agentConfigMap: { [agentId: string]: any } = {};
  isLoadingAgentDetails: boolean = false;
  showAgentConfig: string | null = null;
  configHoverTimeout: any = null;
  configPopupPosition: { left: number; top: number } = { left: 0, top: 0 };
  isPopupHovered: boolean = false;
  isTriggerHovered: boolean = false;
  lastHoveredAgentId: string | null = null;
  pendingAgentId: string | null = null;


  ngOnInit(): void {
    this.loadPrivileges();
    this.fetchAgencies();
    this.fetchAgenciesWithAgents();
    this.fetchAllAgentDetails();
    this.filteredAgencies = [];
    const deleteModalEl = document.getElementById('deleteConfirmModal');
    if (deleteModalEl) {
      this.deleteConfirmModal = new bootstrap.Modal(deleteModalEl);
    }
    const editModalEl = document.getElementById('editConfirmModal');
    if (editModalEl) {
      this.editConfirmModal = new bootstrap.Modal(editModalEl);
    }

    const editWarningEl = document.getElementById('editWarningModal');
      if (editWarningEl) {
        this.editWarningModal = new bootstrap.Modal(editWarningEl);
      }
  }


  // ==================== AGENT CONFIG DETAILS ====================

// Fetch all agent details from marketplace service
fetchAllAgentDetails(): void {
  this.isLoadingAgentDetails = true;
  
  this._marketService.getAgentDetails().subscribe({
    next: (response) => {
      if (response?.success && response?.data) {
        this.allAgentDetails = response.data;
        
        // Create a map for quick lookup by agent_id
        this.agentConfigMap = {};
        response.data.forEach((agent: any) => {
          if (agent.agent_id) {
            this.agentConfigMap[agent.agent_id] = agent;
          }
        });
        
        console.log(`Loaded ${response.data.length} agent details`);
      }
      this.isLoadingAgentDetails = false;
      this.cdr.detectChanges();
    },
    error: (err) => {
      console.error('Error fetching agent details:', err);
      this.isLoadingAgentDetails = false;
      this.cdr.detectChanges();
    }
  });
}

// Get agent config by agent_id
getAgentConfig(agentId: string): AgentConfig | null {
  return this.agentConfigMap[agentId] || null;
}

// Get tools count safely for template
getAgentToolsCount(agentId: string): number {
  const config = this.getAgentConfig(agentId);
  if (config?.tools && Array.isArray(config.tools)) {
    return config.tools.length;
  }
  return 0;
}

// Check if agent has config details
hasAgentConfig(agentId: string): boolean {
  const config = this.getAgentConfig(agentId);
  return !!config;
}

// Toggle agent config popup
toggleAgentConfig(event: Event, agentId: string) {
  event.stopPropagation();
  event.preventDefault();
  
  if (this.showAgentConfig === agentId) {
    this.showAgentConfig = null;
  } else {
    this.showAgentConfig = agentId;
  }
  
  this.cdr.detectChanges();
}

// Get config summary for quick view
getAgentConfigSummary(agentId: string): string {
  const config = this.getAgentConfig(agentId);
  if (!config) return 'No configuration available';
  
  const parts: string[] = [];
  
  if (config['role_name']) {
    parts.push(`Role: ${config['role_name']}`);
  }
  if (config['model']) {
    parts.push(`Model: ${config['model']}`);
  }
  if (config['agent_goal']) {
    const goal = String(config['agent_goal']);
    const shortGoal = goal.length > 30 ? goal.substring(0, 30) + '...' : goal;
    parts.push(`Goal: ${shortGoal}`);
  }
  
  return parts.length > 0 ? parts.join(' | ') : 'Configuration available';
}

// Improved mouse enter for trigger button
onConfigMouseEnter(event: MouseEvent, agentId: string): void {
  // Clear any pending close timeout
  this.clearConfigTimeout();
  
  // Mark that trigger is being hovered
  this.isTriggerHovered = true;
  
  // If already showing this agent's config, just ensure it stays open
  if (this.showAgentConfig === agentId) {
    this.lastHoveredAgentId = agentId;
    return;
  }
  
  // Store the pending agent to show
  this.pendingAgentId = agentId;
  this.lastHoveredAgentId = agentId;
  
  // Small delay before switching to prevent flickering during fast mouse movement
  this.configHoverTimeout = setTimeout(() => {
    this.showConfigForAgent(agentId, event);
    this.pendingAgentId = null;
  }, 50);
}

// Show config popup for specific agent
private showConfigForAgent(agentId: string, event?: MouseEvent): void {
  if (!agentId) return;
  
  let buttonRect: DOMRect | undefined = undefined;
  
  if (event && event.currentTarget) {
    const buttonElement = event.currentTarget as HTMLElement;
    buttonRect = buttonElement.getBoundingClientRect();
  } else {
    const allContainers = document.querySelectorAll('.agent-config-container');
    const agents = this.filteredModalData;
    
    for (let i = 0; i < allContainers.length; i++) {
      if (agents[i]?.agent_id === agentId) {
        const btn = allContainers[i].querySelector('button');
        if (btn) {
          buttonRect = btn.getBoundingClientRect();
          break;
        }
      }
    }
  }
  
  if (!buttonRect) {
    console.warn('Could not find button element for agent:', agentId);
    return;
  }

  const modalContent = document.querySelector('#agencyModal .modal-content') as HTMLElement;
  const modalRect = modalContent?.getBoundingClientRect() || {
    left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight
  };

  const popupWidth = 420;
  const popupHeight = 500;

  let left = buttonRect.left;
  let top = buttonRect.top - popupHeight - 8;

  if (left + popupWidth > modalRect.right - 20) {
    left = modalRect.right - popupWidth - 20;
  }
  if (left < modalRect.left + 20) {
    left = modalRect.left + 20;
  }

  if (top + popupHeight > modalRect.bottom - 30) {
    top = buttonRect.top - popupHeight - 8;
  }
  if (top < modalRect.top + 20) {
    top = modalRect.top + 20;
  }

  this.configPopupPosition = { left, top };
  this.showAgentConfig = agentId;
  this.cdr.detectChanges();
}

// Mouse leave for trigger button
onConfigMouseLeave(): void {
  this.isTriggerHovered = false;
  this.clearConfigTimeout();
  
  this.configHoverTimeout = setTimeout(() => {
    if (!this.isPopupHovered) {
      this.closeConfigPopup();
    }
  }, 150);
}

// Mouse enter for popup
onPopupMouseEnter(): void {
  this.isPopupHovered = true;
  this.clearConfigTimeout();
}

// Mouse leave for popup
onPopupMouseLeave(): void {
  this.isPopupHovered = false;
  this.clearConfigTimeout();
  
  this.configHoverTimeout = setTimeout(() => {
    if (!this.isTriggerHovered) {
      this.closeConfigPopup();
    }
  }, 150);
}

// Clear timeout helper
private clearConfigTimeout(): void {
  if (this.configHoverTimeout) {
    clearTimeout(this.configHoverTimeout);
    this.configHoverTimeout = null;
  }
}

// Close popup and reset all states
closeConfigPopup(): void {
  this.clearConfigTimeout();
  this.showAgentConfig = null;
  this.isPopupHovered = false;
  this.isTriggerHovered = false;
  this.lastHoveredAgentId = null;
  this.pendingAgentId = null;
  this.cdr.detectChanges();
}

// getAgentConfigDisplay(agentId: string): any[] {
//   const config = this.getAgentConfig(agentId);
//   if (!config) return [];
  
//   const details: any[] = [];
  
//   // API URL
//   // if (config['agent_api_url']) {
//   //   details.push({
//   //     label: 'API Endpoint',
//   //     value: String(config['agent_api_url'])
//   //   });
//   // }

//   // Status
//   // if (config['status']) {
//   //   details.push({
//   //     label: 'Status',
//   //     value: String(config['status'])
//   //   });
//   // }

//   // Role Name
//   if (config['role_name']) {
//     details.push({
//       label: 'Role',
//       value: String(config['role_name'])
//     });
//   }

//   // Agent Type
//   if (config['agent_type'] || config['agent_type_name']) {
//     details.push({
//       label: 'Agent Type',
//       value: String(config['agent_type'] || config['agent_type_name'] || 'N/A')
//     });
//   }
  
//   // Model
//   if (config['model']) {
//     details.push({
//       label: 'Model',
//       value: String(config['model'])
//     });
//   }
  
//   // Knowledge Store - Header
//   if (config['knowledge_store'] && Array.isArray(config['knowledge_store']) && config['knowledge_store'].length > 0) {
//     const stores = config['knowledge_store'];
    
//     details.push({
//       label: 'Knowledge Store',
//       value: `${stores.length} knowledge store${stores.length !== 1 ? 's' : ''} found`
//     });
    
//     // Add each store as a nested item
//     stores.forEach((store: any, index: number) => {
//       details.push({
//         isStoreItem: true,
//         storeIndex: index + 1,
//         storeName: store.name,
//         storeId: store.id || 'N/A',
//         docCount: store.document_count || 0,
//       });
//     });
//   } else if (config['knowledge_store_enabled']) {
//     details.push({
//       label: 'Knowledge Store',
//       value: 'Enabled (No stores attached)'
//     });
//   }

    
//    // Agent Role / Objective
//   if (config['agent_role']) {
//     details.push({
//       label: 'Agent Role',
//       value: String(config['agent_role'])
//     });
//   }
  
//   // Agent Goal
//   if (config['agent_goal']) {
//     details.push({
//       label: 'Agent Goal',
//       value: String(config['agent_goal'])
//     });
//   }

  
//   if (config['agent_prompt']) {
//     const promptText = String(config['agent_prompt']);
//     const truncated = promptText
//     details.push({
//       label: 'Agent Prompt',
//       value: truncated
//     });
//   }
  
//   // Tools count
//   if (config['tools'] && Array.isArray(config['tools']) && config['tools'].length > 0) {
//     details.push({
//       label: 'Tools',
//       value: `${config['tools'].length} tool(s) configured`
//     });
//   }
  
//   return details;
// }

getAgentConfigDisplay(agentId: string): any[] {
  const config = this.getAgentConfig(agentId);
  if (!config) return [];

  const details: any[] = [];

  // ==================== BASIC INFO (Kept as-is) ====================
  if (config['role_name']) {
    details.push({ label: 'Role', value: String(config['role_name']) });
  }

  if (config['agent_type'] || config['agent_type_name']) {
    details.push({
      label: 'Agent Type',
      value: String(config['agent_type'] || config['agent_type_name'] || 'N/A')
    });
  }

  if (config['model']) {
    details.push({ label: 'Model', value: String(config['model']) });
  }

  // ==================== KNOWLEDGE STORE - Smart Logic ====================
  const hasNewKS = !!(config['knowledge_store_value']?.name || config['knowledge_store_value']?.data?.name);

  if (hasNewKS) {
    // NEW STRUCTURE - Preferred
    const ks = config['knowledge_store_value'];
    const ksName = ks.name || ks.data?.name || 'Enabled';

    details.push({ label: 'Knowledge Base', value: ksName });

    // if (ks.chunks !== undefined) {
    //   details.push({ isSubDetail: true, label: 'Chunks', value: ks.chunks });
    // }
    // if (ks.type) {
    //   details.push({ isSubDetail: true, label: 'Type', value: ks.type });
    // }
  } 
  else if (config['knowledge_store'] && Array.isArray(config['knowledge_store']) && config['knowledge_store'].length > 0) {
    // OLD STRUCTURE - Only show if new one is not present
    const stores = config['knowledge_store'];
    details.push({
      label: 'Knowledge Store',
      value: `${stores.length} knowledge store${stores.length !== 1 ? 's' : ''} found`
    });

    stores.forEach((store: any, index: number) => {
      details.push({
        isStoreItem: true,
        storeIndex: index + 1,
        storeName: store.name,
        storeId: store.id || 'N/A',
        docCount: store.document_count || 0,
      });
    });
  } 
  else if (config['knowledge_store_enabled']) {
    details.push({
      label: 'Knowledge Store',
      value: 'Enabled (No stores attached)'
    });
  }
  
  // Tools
  if (config['mcp_connector_value']?.name) {
    details.push({
      label: 'Configured Tool',
      value: config['mcp_connector_value'].name
    });
  } else if (config['tools'] && Array.isArray(config['tools']) && config['tools'].length > 0) {
    const toolNames = config['tools'].map((t: any) => t.tool_name || t.name).join(', ');
    details.push({ label: 'Tools', value: toolNames });
  }

  // ==================== NEW ENHANCED SECTIONS ====================

  // Data Query Configuration
  if (config['data_store_value']) {
    const ds = config['data_store_value'];
    const dsName = ds.name || ds.data?.name || 'Enabled';

    details.push({ label: 'Data Query Configuration', value: dsName });

    // const maxRetries = ds.maxTries || ds.data?.maxTries;
    // if (maxRetries !== undefined) {
    //   details.push({ isSubDetail: true, label: 'Max Retries', value: maxRetries });
    // }

    // const timeLimit = ds.timeLimit || ds.data?.timeLimit;
    // if (timeLimit !== undefined) {
    //   details.push({ isSubDetail: true, label: 'Time Limit (s)', value: timeLimit });
    // }
  }

  // Memory
  if (config['memory_value']?.provider || config['memory_value']?.data?.provider) {
    const provider = config['memory_value'].provider || config['memory_value'].data?.provider;
    details.push({
      label: 'Memory Provider',
      value: `${provider}`
    });
  }

  // Context
  if (config['context_value']) {
    const ctx = config['context_value'];
    const ctxName = ctx.name || ctx.data?.name || ctx.data?.value || 'Enabled';
    details.push({
      label: 'Context Configuration',
      value: `${ctxName}`
    });
  }

  // ==================== OTHER EXISTING FIELDS ====================
  if (config['agent_role']) {
    details.push({ label: 'Agent Role', value: String(config['agent_role']) });
  }

  if (config['agent_goal']) {
    details.push({ label: 'Agent Goal', value: String(config['agent_goal']) });
  }

  if (config['agent_prompt']) {
    const promptText = String(config['agent_prompt']);
    details.push({
      label: 'Agent Prompt',
      value: promptText
    });
  }

  return details;
}

  @HostListener('document:click', ['$event'])
onClickOutside(event: Event) {
  // Close all menus
  this.promptActions = {};
}

   loadPrivileges() {
    this._stateService.getPrivilegesByPage('Prompt Repository').subscribe({
      next: (loaded_privileges:any) => {
        console.log('Loaded privileges for Prompt Repository by page: ', loaded_privileges);
        if (loaded_privileges) {
          this.isPrivilegeView = loaded_privileges?.view || false;
          this.isPrivilegeEdit = loaded_privileges?.['insert / edit'] || loaded_privileges?.edit || false;
          this.isPrivilegeAdd = loaded_privileges?.['add / create'] || loaded_privileges?.add || false;
          this.isPrivilegeDelete = loaded_privileges?.delete || false;
          this.isPrivilegeRefresh = loaded_privileges?.refresh || false;
          this.isPrivilegeExecute = loaded_privileges?.execute || false;
          this.cdr.detectChanges();
        }
      }
    });
  }

  checkUserRole() {
    const loggedUser = this._stateService.getLoginDetails();
    const activePrj = loggedUser?.ActiveProject;
    const projectDetails = loggedUser?.ProjectDtl || [];

    const mappedProject = projectDetails.find(
      (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
    );

    const mappedRole = mappedProject?.role_name?.toLowerCase() || '';

    this.isSuperAdmin = mappedRole === 'super admin';

    console.log('User Role Check - Super Admin:', this.isSuperAdmin);
  }

fetchAgenciesWithAgents(): void {
  this._marketService.getAgencyWithAgents().subscribe({
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
        this.cdr.detectChanges();
      }
    },
    error: (err) => console.error('Error:', err),
  });
}

  fetchAgencies() {
  this.isLoadingAgencies = true;
  this.filteredAgencies = [];   
  this.apiData = [];
  this._loadingService.show();

  this.promptRepoService.getAgencyWithAgentsEnhanced().subscribe(
    (response) => {
      this.apiData = response.data || [];
      this.filteredAgencies = [...this.apiData];
      this.prepareFilterData();
     
      setTimeout(() => {
        this.autoFixNoTitlePrompts();
      }, 800);
      

      this.isLoadingAgencies = false;
      this._loadingService.hide();
      this.cdr.detectChanges();
    },
    (error) => {
      console.error('Error fetching agencies:', error);
      this.apiData = [];
      this.filteredAgencies = [];
      this.isLoadingAgencies = false;
      this._loadingService.hide();
      this.cdr.detectChanges();
    }
  );
}
  
    onAgencyChange(selectedAgencyName: string) {
    if (!selectedAgencyName || !this.agenciesWithAgents?.length) {
      this.filteredAgentsForModal = [];
      return;
    }

    const selectedAgency = this.agenciesWithAgents.find((agency: any) => 
      agency.agency_name === selectedAgencyName
    );

    if (selectedAgency) {
      this.filteredAgentsForModal = this.getFilteredAgents(selectedAgency);
    } else {
      this.filteredAgentsForModal = [];
    }
  }

  showToast(type: 'success' | 'error', message: string): void {
  this.toastType = type;
  this.toastMessage = message;
  this.cdr.detectChanges(); // Trigger change detection
  
  // Show toast after DOM update
  setTimeout(() => {
    const toastId = type === 'success' ? '#successToast' : '#errorToast';
    const toastEl = document.querySelector(toastId) as HTMLElement;
    if (toastEl) {
      const toast = new bootstrap.Toast(toastEl, {
        autohide: true,
        delay: 4000
      });
      toast.show();
    }
  }, 0);
}

tryThisPrompt(agent: Agent, query: any) {
  if (!agent || !query) return;

  console.log('tryThisPrompt called with:', { 
    agentId: agent.agent_id, 
    agentName: agent.name,
    queryId: query._id,
    status: query.status,
    executionCount: query.execution_count
  });

  const statusObj = this.getExecutionStatus(query);
  const isReExecute = statusObj.label === 'Re-execute';
  
    // Normal prompts: auto-execute only if never run before
  const hasBeenExecuted = !!(query.execution_count && Number(query.execution_count) > 0) ||
                            !!(query.status && query.status.toLowerCase() === 'completed');

  // ==================== PRIVILEGE CHECK ====================
  const hasExecutePrivilege = this.isPrivilegeExecute;
  const hasViewPrivilege = this.isPrivilegeView;

  if (!hasViewPrivilege) {
    this.showToast('error', 'You do not have permission to view this prompt.');
    return;
  }

  // If user has NO execute privilege:
  if (!hasExecutePrivilege) {
    if (isReExecute|| hasBeenExecuted) {
      // Allow viewing in review mode (do not auto-execute)
      console.log('Re-execute prompt opened in REVIEW mode (view-only user)');
    } else {
      // Block execution for non-re-execute prompts
      this.showToast('error', 'You do not have access to execute this prompt.');
      return;
    }
  }
  // ========================================================

  // Resolve proper Master Agent
  let masterAgent = agent;

  if (agent.agent_type_id === 'TYPE_MASTER' || 
      !agent.agent_type_id?.toLowerCase().includes('master')) {
    
    masterAgent = this.findMasterAgentForTask(agent.agent_id) || agent;
  }

  // ==================== Determine Auto-Execute Logic ====================
  let shouldAutoExecute = false;

  if (isReExecute) {
    // Re-execute behavior depends on privilege
    shouldAutoExecute = hasExecutePrivilege;   // Execute only if user has execute right
  } else {
    shouldAutoExecute = !hasBeenExecuted;
  }
  // ===================================================================

  const agencyId = this.selectedAgency?.agency_id ||
                   this.selectedAgency?._id ||
                   query.agency_id || 
                   agent.agency_id || '';

  const eventId = query.event_id || '';
  const mapId = query.map_id || '';

  const payload = {
    agent: {
      ...agent,
      master_agent_id: masterAgent.agent_id || agent.agent_id,
      master_agent_name: masterAgent.name || agent.name,
      name: agent.name,
      agent_id: agent.agent_id,
      agency_id: agencyId,
      agent_type_id: masterAgent.agent_type_id || agent.agent_type_id
    },
    query: {
      ...query,
      user_query: query.user_query || query.promptTitle || query.title,
      prompt_output: query.prompt_output,
      name: agent.name,
      agent_id: agent.agent_id,
      master_agent_id: masterAgent.agent_id || agent.agent_id,
      master_agent_name: masterAgent.name || agent.name,
      agency_id: agencyId,
      event_id: eventId,
      map_id: mapId
    },
    isFromPromptRepository: true,
    shouldAutoExecute: shouldAutoExecute
  };

  console.log('Try Prompt Payload - Auto Execute:', shouldAutoExecute, 
              '| Re-execute:', isReExecute, 
              '| Has Execute Privilege:', hasExecutePrivilege);

  this._stateService.setTryPromptData(payload);
  this._router.navigate(['/commandcenterdashboard']);
}

private findMasterAgentForTask(taskAgentId: string): any {
  if (!taskAgentId || !this.agenciesWithAgents?.length) {
    console.warn('agenciesWithAgents not loaded yet');
    return null;
  }

  for (const agency of this.agenciesWithAgents) {
    // Check if this task agent belongs to the agency
    const isTaskAgentInAgency = agency.agents?.some((a: any) => a.agent_id === taskAgentId);
    
    if (isTaskAgentInAgency) {
      // Find Master Agent in the same agency
      const master = agency.agents?.find((a: any) => 
        a.agent_type_id === 'MASTER' || 
        a.agent_type_name?.toLowerCase().includes('master')
      );

      if (master) {
        console.log(`Resolved Master Agent: ${master.name} (${master.agent_id}) for Task Agent: ${taskAgentId}`);
        return master;
      }
    }
  }

  console.warn(`Could not resolve master agent for: ${taskAgentId}`);
  return null;
}

  openAgencyModal(agency: any) {
  this.selectedAgency = agency;
  this.showAddPrompt = false;
  this.modalSearchTerm = '';
  const filteredAgents = this.getFilteredAgents(agency);
  this.filteredModalData = [...filteredAgents];
  
  // Reset expanded state
  this.expandedAgentId = null;
  this.expandedQueryId = null;
  this.promptPageMap = {};

  setTimeout(() => {
    const modalElement = document.getElementById('agencyModal');
    if (modalElement) {
      const modal = new bootstrap.Modal(modalElement);
      modal.show();
    }
  }, 0);
}
  // Initialize accordions properly
  initializeAccordions(modalElement: HTMLElement) {
    // Get all accordion buttons
    const accordionButtons = modalElement.querySelectorAll('.accordion-button') as NodeListOf<HTMLButtonElement>;
    
    accordionButtons.forEach(button => {
      // Get target collapse element
      const targetId = button.getAttribute('data-bs-target');
      if (targetId) {
        const target = modalElement.querySelector(targetId) as HTMLElement;
        if (target) {
          // Initialize Bootstrap Collapse
          const collapse = new bootstrap.Collapse(target, {
            toggle: false  // Don't auto-open
          });
          
          // Ensure it's collapsed
          collapse.hide();
        }
      }
    });
  }
  
getLastExecutedTime(lastUsed: string | null | undefined, executionCount: number = 0): string {
  // If never executed, always show 'Never' — regardless of created_ts
  if (!executionCount || executionCount <= 0) {
    return 'Never';
  }

  if (!lastUsed) return 'Never';

  try {
    const lastUsedDate = new Date(lastUsed);
    if (isNaN(lastUsedDate.getTime())) return 'Invalid date';

    const now = new Date();
    const diffInMs = now.getTime() - lastUsedDate.getTime();

    if (diffInMs < 0) return 'Just now';

    const minutes = Math.floor(diffInMs / (1000 * 60));
    const hours = Math.floor(diffInMs / (1000 * 60 * 60));
    const days = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    const months = Math.floor(diffInMs / (1000 * 60 * 60 * 24 * 30));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 30) return `${days}d ago`;
    return `${months}mo ago`;
  } catch (error) {
    console.error('Error parsing date:', error);
    return 'Invalid date';
  }
}

  getLastExecuted(agents: any[]): string {
    if (!agents?.length) return '';
    
    const latestDate = agents.reduce((max, agent) => {
      if (!agent.last_used) return max;
      const date = new Date(agent.last_used);
      return max > date ? max : date;
    }, new Date(0));

    if (latestDate.getTime() === 0) return '';
    
    const now = new Date();
    const diff = now.getTime() - latestDate.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    
    return hours < 24 ? `${hours}h ago` : `${Math.floor(hours/24)}d ago`;
  }


  cancelAddPrompt() {
    this.showAddPrompt = false;
    // Trigger change detection
    this.cdr.detectChanges();
  }

 toggleActions(event: Event, queryId: string) {
  event.stopImmediatePropagation();

  // Force open the accordion first
  this.expandedQueryId = queryId;

  // Toggle the menu
  this.promptActions[queryId] = !this.promptActions[queryId];

  // Small delay for smooth accordion expansion
  if (this.promptActions[queryId]) {
    setTimeout(() => {
      this.cdr.detectChanges();
    }, 80);
  } else {
    this.cdr.detectChanges();
  }
}

editPrompt(event: Event, query: any, agent: Agent) {
  event.stopImmediatePropagation();

  // === FORCE OPEN THE PROMPT ACCORDION ===
  this.expandedQueryId = query._id;

  // Add editing properties
  query.isEditing = true;
  query.editTitle = query.prompt_title || '';
  query.editPrompt = query.user_query || '';

  // Close action popup
  this.promptActions = {};

  this.cdr.detectChanges();
}

cancelEditQuery(agent: Agent, query: any) {
  // Remove editing properties
  query.isEditing = false;
  delete query.editTitle;
  delete query.editPrompt;
  
  // Trigger change detection
  this.cdr.detectChanges();
}

saveEditedQuery(agent: Agent, query: any) {
  if (!query.editTitle?.trim() || !query.editPrompt?.trim()) {
    this.showToast('error', 'Title and prompt content are required!');
    return;
  }

  const originalPrompt = query.user_query?.trim();
  const newPrompt = query.editPrompt?.trim();
  const isPromptContentChanged = originalPrompt !== newPrompt;

  // Deep copy for warning modal
  this.queryToEditWarning = JSON.parse(JSON.stringify(query));
  this.agentToEditWarning = agent;

  if (isPromptContentChanged && this.editWarningModal) {
    this.editWarningModal.show();
  } else {
    this.proceedWithEditSave(query, agent);
  }
}

private refreshModalDataAfterEdit(agentId: string) {
  if (!this.selectedAgency?.agents) return;

  const agent = this.selectedAgency.agents.find((a: Agent) => a.agent_id === agentId);
  if (!agent) return;

  const indexInModal = this.filteredModalData.findIndex((a: Agent) => a.agent_id === agentId);
  
  if (indexInModal !== -1) {
    this.filteredModalData[indexInModal] = { ...agent, queries: [...(agent.queries || [])] };
  } else {
    this.filteredModalData = this.getFilteredAgents(this.selectedAgency);
  }

  this.cdr.detectChanges();
}

proceedWithEditSave(query?: any, agent?: any) {
  if (!query || !agent) {
    query = this.queryToEditWarning;
    agent = this.agentToEditWarning;
  }

  if (!query || !agent) {
    this.showToast('error', 'Something went wrong.');
    this.editWarningModal?.hide();
    return;
  }

  this.editWarningModal?.hide();
  this._loadingService.show();

  const eventId = query.event_id || '';
  const mapId = query.map_id || this.generateUUID();

  const payload = {
    agency_id: this.selectedAgency?.agency_id || this.selectedAgency?._id || '',
    agent_id: agent.agent_id,
    prompt_title: query.editTitle.trim(),
    user_query: query.editPrompt.trim(),
    event_id: eventId,
    map_id: mapId
  };

  this.promptRepoService.UpdatePrompt(payload).subscribe({
    next: (response) => {
      this._loadingService.hide();

      if (response?.success) {
        this.showToast('success', 'Prompt updated successfully!');

        const originalQuery = this.findOriginalQuery(agent, query);

        if (originalQuery) {
          const oldPrompt = originalQuery.user_query?.trim() || '';
          const newPrompt = query.editPrompt?.trim() || '';

          const isContentChanged = oldPrompt !== newPrompt;

          // Always update title and prompt
          originalQuery.prompt_title = query.editTitle.trim();
          originalQuery.user_query = newPrompt;

          // === Reset metrics/execution data ONLY if content changed ===
          if (isContentChanged) {
            console.log('Prompt content changed → Resetting execution data');
            originalQuery.status = 'stored';           // or 'updated'
            originalQuery.execution_count = 0;
            originalQuery.metrics = null;
            originalQuery.detailed_results = null;
            originalQuery.prompt_output = '';          // optional
            originalQuery.feedback_rating = 0;
            originalQuery.feedback_comments = '';
          }

          originalQuery.isEditing = false;
          delete originalQuery.editTitle;
          delete originalQuery.editPrompt;
        }

        // Refresh modal data immediately
        this.refreshModalDataAfterEdit(agent.agent_id);

        this.cdr.detectChanges();
      } else {
        this.showToast('error', 'Failed to update: ' + (response?.message || ''));
      }
    },
    error: (err) => {
      this._loadingService.hide();
      console.error('Update error:', err);
      this.showToast('error', 'Error updating prompt.');
    }
  });

  this.queryToEditWarning = null;
  this.agentToEditWarning = null;
}



// Add this new helper method
private findOriginalQuery(agent: any, editedQuery: any): any {
  if (!agent?.queries || !editedQuery?._id) return null;
  
  return agent.queries.find((q: any) => q._id === editedQuery._id);
}

confirmEdit() {
  if (!this.queryToEdit || !this.agentToEdit) return;

  this.isEditing = true;
  this._loadingService.show();

  const eventId = this.queryToEdit.event_id || this.queryToEdit._id || this.queryToEdit.prompt_id || '';
  const mapId = this.queryToEdit.map_id || this.generateUUID();

  const payload = {
    agency_id: this.selectedAgency?.agency_id || this.selectedAgency?._id || '',
    agent_id: this.agentToEdit.agent_id,
    prompt_title: this.editForm.promptTitle.trim(),
    user_query: this.editForm.prompt.trim(),
    event_id: eventId,
    map_id: mapId
  };

  console.log("confirmEdit Payload:", payload);

  this.promptRepoService.UpdatePrompt(payload).subscribe({
    next: (response) => {
      this._loadingService.hide();
      this.isEditing = false;

      if (response?.success) {
        this.showToast('success', 'Prompt updated successfully!');

        const agentIndex = this.selectedAgency.agents.findIndex((a: Agent) => 
          a.agent_id === this.agentToEdit.agent_id
        );

        if (agentIndex !== -1) {
          const queryIndex = this.selectedAgency.agents[agentIndex].queries.findIndex((q: any) => 
            q._id === this.queryToEdit._id
          );
          if (queryIndex !== -1) {
            this.selectedAgency.agents[agentIndex].queries[queryIndex].prompt_title = this.editForm.promptTitle;
            this.selectedAgency.agents[agentIndex].queries[queryIndex].user_query = this.editForm.prompt;
          }
        }
        this.fetchAgencies();
        this.cdr.detectChanges();
      } else {
        this.showToast('error', 'Failed to update: ' + (response?.message || ''));
      }

      this.editConfirmModal?.hide();
      this.clearEditModal();
    },
    error: (err) => {
      this._loadingService.hide();
      this.isEditing = false;
      console.error('Update error details:', err);
      this.showToast('error', 'Error updating prompt.');
    }
  });
}

cancelEdit() {
  this.editConfirmModal?.hide();
  this.clearEditModal();
}

clearEditModal() {
  this.queryToEdit = null;
  this.agentToEdit = null;
  this.isEditing = false;
  this.editForm = {
    promptTitle: '',
    prompt: ''
  };
}

deletePrompt(event: Event, query: any, agent: Agent) {
  event.stopImmediatePropagation();

  this.expandedQueryId = query._id;
  
  // Store the query and agent to delete
  this.queryToDelete = query;
  this.agentToDelete = agent;
  // Show confirmation modal
  this.deleteConfirmModal?.show();

  this.cdr.detectChanges();
}

confirmDelete() {
  if (!this.queryToDelete ) return;
  
  this.isDeleting = true;
  this._loadingService.show();
  
  const payload = {
    agency_id: this.selectedAgency?.agency_id || '',
    agent_id: this.agentToDelete.agent_id,
    prompt_title: this.queryToDelete.prompt_title,
    user_query: this.queryToDelete.user_query
  };
  
  this.promptRepoService.DeletePrompt(payload).subscribe({
    next: (response) => {
      this._loadingService.hide();
      this.isDeleting = false;
      
      if (response?.success) {
        this.showToast('success', 'Prompt deleted successfully!');
        // Remove from local data
        const agentIndex = this.selectedAgency.agents.findIndex((a: Agent) => a.agent_id === this.agentToDelete.agent_id);
        if (agentIndex !== -1) {
          this.selectedAgency.agents[agentIndex].queries = this.selectedAgency.agents[agentIndex].queries.filter((q: any) => q._id !== this.queryToDelete._id);
        }
        this.fetchAgencies();
        this.cdr.detectChanges();
      } else {
        this.showToast('error', 'Failed to delete: ' + (response?.message));
      }
      
      // Close modal
      this.deleteConfirmModal?.hide();
      this.clearDeleteModal();
    },
    error: (err) => {
      this._loadingService.hide();
      this.isDeleting = false;
      console.error('Delete error:', err);
      this.showToast('error', 'Error deleting prompt. Please try again.');
    }
  });
}

cancelDelete() {
  this.deleteConfirmModal?.hide();
  this.clearDeleteModal();
}

clearDeleteModal() {
  this.queryToDelete = null;
  this.isDeleting = false;
}

  openNewPRModal() {
    this.resetForm();
    this.filteredAgentsForModal = [];

    const modalElement = document.getElementById('newPRModal');
    if (modalElement) {
      const modal = new bootstrap.Modal(modalElement);
      modal.show();
    }
  }

  showAddPromptForm(agent?: any) {
    if (agent) {
      // Make sure we store the complete agent object
      this.currentAgent = agent;
      // Set both agency and agent in the form
      this.newPRForm = {
        agency: this.selectedAgency?.agency_name || '',
        agent: agent.name || '',  // This is important!
        promptTitle: '',
        prompt: '',
        created_by: this._stateService.getLoginDetails()?.Email|| '',
        map_id: this.generateUUID()
      };
      console.log("pay1 - with agent:", this.newPRForm);
    } else {
      this.newPRForm = {
        agency: this.selectedAgency?.agency_name || '',
        agent: '',  // Clear agent when no specific agent is passed
        promptTitle: '',
        prompt: '',
        created_by: this._stateService.getLoginDetails()?.Email || '',
        map_id: this.generateUUID()
      };
      console.log("pay2 - without agent:", this.newPRForm);
    }
    this.showAddPrompt = true;
    // Trigger change detection
    this.cdr.detectChanges();
  }

  private generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

  savePrompt(isFromModal: boolean = false) {
  if (!this.validatePromptFields()) {
    this.cdr.detectChanges();
    return;
  }

  const form = this.newPRForm;

  if (!form.promptTitle?.trim() || !form.prompt?.trim()) {
    this.showToast('error', 'Prompt Title and Prompt content are required!');
    return;
  }

  this._loadingService.show();

  if (!form.map_id) {
    form.map_id = this.generateUUID();
  }

  let agencyId: string | null = null;
  let agentId: string | null = null;

  if (isFromModal) {
    const selectedAgencyObj = this.agenciesWithAgents?.find((a: any) => 
      a.agency_name === form.agency
    );
    
    if (!selectedAgencyObj) {
      this._loadingService.hide();
      this.showToast('error', 'Please select a valid agency.');
      return;
    }

    const selectedAgentObj = selectedAgencyObj?.agents?.find((a: Agent) => 
      a.name === form.agent
    );

    if (!selectedAgentObj) {
      this._loadingService.hide();
      this.showToast('error', 'Please select a valid agent.');
      return;
    }

    agencyId = selectedAgencyObj.agency_id || selectedAgencyObj._id;
    agentId = selectedAgentObj.agent_id;
  } else {
    agencyId = this.selectedAgency?.agency_id || this.selectedAgency?._id;
    
    if (this.currentAgent) {
      agentId = this.currentAgent.agent_id;
    } else if (this.selectedAgency && form.agent) {
      const agent = this.selectedAgency.agents.find((a: Agent) => a.name === form.agent);
      agentId = agent?.agent_id;
    }
  }

  if (!agencyId || !agentId) {
    this._loadingService.hide();
    this.showToast('error', 'Could not determine Agency or Agent ID.');
    return;
  }

  const MapId = this.generateUUID();
  const now = new Date().toISOString();

  const payload = {
    agency_id: agencyId,
    agent_id: agentId,
    prompt_title: form.promptTitle.trim(),
    user_query: form.prompt.trim(),
    created_by: form.created_by,
    map_id: form.map_id
  };

  this.promptRepoService.savePrompt(payload).subscribe({
    next: (response) => {
      this._loadingService.hide();
      
      if (response?.success) {
        this.showToast('success', 'Prompt saved successfully!');

        const newQuery = {
          _id: response.data?._id || `temp_${Date.now()}`,
          user_query: form.prompt.trim(),
          prompt_title: form.promptTitle.trim(),
          map_id: form.map_id,
          created_ts: now,                    // ← Important
          updated_ts: now,
          execution_count: 0,
          average_rating: 0,
          prompt_output: ''                   // optional
        };

        // Add to current agent (if inline add)
        if (this.currentAgent && !isFromModal) {
          this.currentAgent.queries = [newQuery, ...(this.currentAgent.queries || [])]; // Add at top
        }

        // Refresh only if needed (modal case)
        if (isFromModal) {
          const modalElement = document.getElementById('newPRModal');
          if (modalElement) {
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) modal.hide();
          }
          this.fetchAgencies(); // Full refresh for modal case
        } else {
          // For inline add → no full refresh, just local update + sort
          this.resetForm();
          this.showAddPrompt = false;
          this.cdr.detectChanges();
        }
      } else {
        this.showToast('error', 'Failed to save: ' + (response?.message || ''));
      }
    },
    error: (err) => {
      this._loadingService.hide();
      console.error('Save error:', err);
      this.showToast('error', 'Error saving prompt. Please try again.');
    }
  });
}

  closeModals() {
    // Close main modal
    const mainModal = document.getElementById('newPRModal');
    if (mainModal) {
      const modal = bootstrap.Modal.getInstance(mainModal);
      if (modal) modal.hide();
    }
    
    // Close agency modal if open
    this.showAddPrompt = false;
  }

  saveNewPR() {
    // Use the unified savePrompt method instead
    this.savePrompt(true);
  }

  // Single method that works for both cases
  getFilteredAgents(agency?: Agency): Agent[] {
    // If no agency provided, use selectedAgency
    const targetAgency = agency || this.selectedAgency;
    
    if (!targetAgency?.agents) return [];
    
    return targetAgency.agents.filter((agent: Agent) => 
      agent.agent_type_id !== 'MASTER'
    );
  }

  getTaskAgentCount(agency: Agency): number {
  if (!agency?.agents) return 0;
  return agency.agents.filter(agent => agent.agent_type_id !== 'MASTER').length;
}
  getTotalAgencies(): number {
    return this.apiData?.length || 0;
  }

  // Global search (Agency name + description)
onGlobalSearch() {
  if (!this.apiData) {
    this.filteredAgencies = [];
    return;
  }

  const term = this.globalSearchTerm.toLowerCase().trim();

  if (!term) {
    this.filteredAgencies = [...this.apiData];
    return;
  }

  this.filteredAgencies = this.apiData.filter((agency: any) => 
    agency.agency_name?.toLowerCase().includes(term) ||
    agency.agency_desc?.toLowerCase().includes(term)
  );
}

// Modal search - MASTER excluded + proper reset when clearing search
onModalSearch() {
  if (!this.selectedAgency?.agents) {
    this.filteredModalData = [];
    return;
  }

  const term = this.modalSearchTerm.toLowerCase().trim();

  // Always start with non-MASTER agents
  const baseAgents = this.getFilteredAgents(this.selectedAgency);

  if (!term) {
    // Reset to full non-master agents with complete queries
    this.filteredModalData = baseAgents.map((agent: Agent) => ({
      ...agent,
      queries: [...(agent.queries || [])]
    }));
    this.cdr.detectChanges();
    return;
  }

  // Perform search
  const results: Agent[] = [];

  for (const agent of baseAgents) {
    const agentNameMatch = agent.name?.toLowerCase().includes(term) || false;

    const filteredQueries = (agent.queries || []).filter((query: any) =>
      query.prompt_title?.toLowerCase().includes(term) ||
      query.user_query?.toLowerCase().includes(term)
    );

    if (agentNameMatch || filteredQueries.length > 0) {
      results.push({
        ...agent,
        queries: filteredQueries.length > 0 ? filteredQueries : [...(agent.queries || [])]
      });
    }
  }

  this.filteredModalData = results;
  this.cdr.detectChanges();
}

  closeAgencyModal() {
  this.modalSearchTerm = '';
  this.filteredModalData = [];
}

  onAgencyFilterChange() {
  if (!this.filterAgency) {
    this.filteredFilterAgents = this.allAvailableAgents;
    return;
  }

  this.filteredFilterAgents = this.allAvailableAgents.filter(
    agent => agent.agency_name === this.filterAgency
  );
}

// Prepare all agents for filter dropdown (with unique agent names)
private prepareFilterData() {
  this.allAvailableAgents = [];
  if (!this.apiData) return;

  const agentMap = new Map<string, any>(); // Use Map to ensure uniqueness by agent name

  this.apiData.forEach((agency: any) => {
    const nonMaster = this.getFilteredAgents(agency);
    
    nonMaster.forEach(agent => {
      const agentName = agent.name?.trim();
      
      // Keep only the first occurrence of each agent name (removes duplicates)
      if (agentName && !agentMap.has(agentName)) {
        agentMap.set(agentName, {
          ...agent,
          agency_name: agency.agency_name
        });
      }
    });
  });

  this.allAvailableAgents = Array.from(agentMap.values());
  this.filteredFilterAgents = [...this.allAvailableAgents];

  console.log(`Prepared ${this.allAvailableAgents.length} unique agents for filter`);
}

// Main Apply Filters Method
applyFilters() {
  if (!this.filterAgency && !this.filterAgent) {
    this.filteredAgencies = [...this.apiData];
    this.cdr.detectChanges();
    return;
  }

  this.filteredAgencies = this.apiData.filter((agency: any) => {
    const agencyMatch = !this.filterAgency || agency.agency_name === this.filterAgency;

    if (!agencyMatch) return false;

    if (!this.filterAgent) return true;

    // Check if agency has the selected agent
    const agents = this.getFilteredAgents(agency);
    return agents.some(agent => agent.name === this.filterAgent);
  });

  this.cdr.detectChanges();
}

// Clear Filters
clearFilters() {
  this.filterAgency = '';
  this.filterAgent = '';
  this.filteredFilterAgents = [...this.allAvailableAgents];
  this.filteredAgencies = [...this.apiData];
  this.cdr.detectChanges();
}

// Add these properties (already present)
promptTitleError: string = '';
promptContentError: string = '';

// Updated Validation Method
isValidPromptContent(value: string): boolean {
  if (!value || value.trim().length === 0) return false;
  
  const trimmed = value.trim();
  
  // Must contain at least ONE alphabet letter (a-z or A-Z)
  const hasLetter = /[a-zA-Z]/.test(trimmed);
  
  return hasLetter;
}

// Updated Validation Fields Method
validatePromptFields(): boolean {
  this.promptTitleError = '';
  this.promptContentError = '';

  const title = this.newPRForm.promptTitle?.trim();
  const prompt = this.newPRForm.prompt?.trim();

  let isValid = true;

  if (!title) {
    this.promptTitleError = 'Prompt Title is required.';
    isValid = false;
  } else if (!this.isValidPromptContent(title)) {
    this.promptTitleError = 'Please give proper content for title. Only numbers and special characters are not allowed.';
    isValid = false;
  }

  if (!prompt) {
    this.promptContentError = 'Prompt content is required.';
    isValid = false;
  } else if (!this.isValidPromptContent(prompt)) {
    this.promptContentError = 'Please give proper content. Only numbers and special characters are not allowed.';
    isValid = false;
  }

  return isValid;
}

// Clear errors when form is reset
resetForm() {
  this.newPRForm = {
    agency: '',
    agent: '',
    promptTitle: '',
    prompt: '',
    created_by: this._stateService.getLoginDetails()?.Email || '',
    map_id: this.generateUUID()
  };
  this.promptTitleError = '';
  this.promptContentError = '';
  this.currentAgent = null;
}

// Real-time validation for individual fields (called on blur)
onTitleBlur() {
  const title = this.newPRForm.promptTitle?.trim();
  if (!title) {
    this.promptTitleError = 'Prompt Title is required.';
  } else if (!this.isValidPromptContent(title)) {
    this.promptTitleError = 'Please give proper content for title. Only numbers and special characters are not allowed.';
  } else {
    this.promptTitleError = '';
  }
}

onPromptBlur() {
  const prompt = this.newPRForm.prompt?.trim();
  if (!prompt) {
    this.promptContentError = 'Prompt content is required.';
  } else if (!this.isValidPromptContent(prompt)) {
    this.promptContentError = 'Please give proper content. Only numbers and special characters are not allowed.';
  } else {
    this.promptContentError = '';
  }
}

getPromptMetrics(query: any): PromptMetrics {
  const metrics: PromptMetrics = {
    correctness: 0,
    accuracy: 0,
    safety: 0,
    coherence: 0,
    conciseness: 0,
    relevance: 0,
    latency: undefined,
    status: undefined
  };

  if (!query) {
    return metrics;
  }

  // Priority 1: Use pre-computed metrics object
  if (query.metrics && typeof query.metrics === 'object') {
    const m = query.metrics;
    metrics.correctness = m['correctness/mean'] ?? 0;
    metrics.accuracy = m['accuracy/mean'] !== undefined ? Math.round(m['accuracy/mean'] * 100) : 0;
    metrics.safety = m['safety/mean'] ?? 0;
    metrics.coherence = m['coherence/mean'] ?? 0;
    metrics.conciseness = m['conciseness/mean'] ?? 0;
    metrics.relevance = m['relevance/mean'] ?? 0;
    metrics.latency = this.getLatency(query);
    return metrics;
  }

  // Priority 2: Fallback to detailed_results
  if (query.detailed_results?.length > 0) {
    const result = query.detailed_results[0];
    metrics.correctness = result['correctness/value'] ?? 0;
    metrics.accuracy = result['accuracy/value'] !== undefined ? Math.round(result['accuracy/value'] * 100) : 0;
    metrics.safety = result['safety/value'] ?? 0;
    metrics.coherence = result['coherence/value'] ?? 0;
    metrics.conciseness = result['conciseness/value'] ?? 0;
    metrics.relevance = result['relevance/value'] ?? 0;
    metrics.latency = this.getLatency(query);
    return metrics;
  }

  return metrics; // All defaults when no data
}

getLatency(query: any): number | undefined {
  // Priority 1: New trace_duration field
  if (query?.trace_info?.trace_summary?.[0]?.trace_duration !== undefined) {
    const duration = query.trace_info.trace_summary[0].trace_duration;
    return Number(duration); // Ensure it's a number
  }

  // Priority 2: Fallback (old fields)
  if (query.execution_duration !== undefined) {
    return Number(query.execution_duration);
  }
  if (query.detailed_results?.[0]?.execution_duration !== undefined) {
    return Number(query.detailed_results[0].execution_duration);
  }

  return undefined;
}

getPaginatedQueries(agent: any): any[] {
  if (!agent?.queries?.length) return [];

  const sortedQueries = [...agent.queries].sort((a, b) => {
    const timeA = a.created_ts ? new Date(a.created_ts).getTime() : 0;
    const timeB = b.created_ts ? new Date(b.created_ts).getTime() : 0;
    
    if (timeB !== timeA) return timeB - timeA; // Newest first

    // Fallback to _id 
    return (b._id || '').toString().localeCompare((a._id || '').toString());
  });

  const page = this.promptPageMap[agent.agent_id] || 1;
  const start = (page - 1) * this.itemsPerPage;

  return sortedQueries.slice(start, start + this.itemsPerPage);
}

getTotalPrompts(agent: any): number {
  return agent?.queries?.length || 0;
}

getPromptStartItem(agent: any): number {
  const page = this.promptPageMap[agent.agent_id] || 1;
  return (page - 1) * this.itemsPerPage + 1;
}

getPromptEndItem(agent: any): number {
  const page = this.promptPageMap[agent.agent_id] || 1;
  const total = this.getTotalPrompts(agent);
  return Math.min(page * this.itemsPerPage, total);
}

changePromptPage(agent: any, newPage: number): void {
  if (newPage < 1 || newPage > this.getTotalPromptPages(agent)) return;
  this.promptPageMap[agent.agent_id] = newPage;
  this.cdr.detectChanges();
}

getTotalPromptPages(agent: any): number {
  const total = this.getTotalPrompts(agent);
  return Math.ceil(total / this.itemsPerPage) || 1;
}

goToPromptPage(agent: any, page: number): void {
  this.changePromptPage(agent, page);
}

// Add this method at the bottom of your class
getDisplayTitle(query: any): string {
  if (query?.prompt_title && query.prompt_title.trim() !== '') {
    return query.prompt_title.trim();
  }

  // Fallback using the provided logic
  const text = query?.prompt_output || query?.user_query || '';
  const agentName = query?.agent_name || '';

  let title = 'Response';

  if (typeof text !== 'string' || !text) {
    return agentName || title;
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) {
    return agentName || title;
  }

  let titleLineIndex = lines.findIndex(item =>
    ['#', 'title:', '**'].some(s => item.toLowerCase().includes(s))
  );

  if (titleLineIndex === -1) {
    titleLineIndex = 0;
  }

  const line = lines[titleLineIndex];
  const parts = line.split(':').filter(Boolean);

  if (parts.length > 1) {
    title = parts[1];
  } else {
    title = parts[0] || title;
  }

  const output = title.replace(/^[#* ]+|[#* ]+$/g, "").trim();
  console.log("title field",output)
  return output || agentName || 'Untitled Prompt';
}

// Toggle agent accordion
toggleAgent(agent: Agent, event: Event) {
  event.stopPropagation();
  
  // Close config popup when toggling accordion
  this.showAgentConfig = null;
  
  // Close current agent if it's the same one being clicked
  if (this.expandedAgentId === agent.agent_id) {
    this.expandedAgentId = null;
    this.expandedQueryId = null;
  } else {
    this.expandedAgentId = agent.agent_id;
    this.expandedQueryId = null;
  }
  
  this.cdr.detectChanges();
}

toggleQuery(agent: Agent, query: any, event: Event) {
  event.stopPropagation();

  const isCurrentlyOpen = this.expandedQueryId === query._id;

  if (isCurrentlyOpen) {
    // Closing the accordion → also close its menu
    this.promptActions[query._id] = false;
    this.expandedQueryId = null;
  } else {
    // Opening the accordion
    this.expandedQueryId = query._id;
  }

  this.cdr.detectChanges();
}

// Improved & Strict Title Extraction
extractTitleFromResponse(text: string, agentName?: string): string {
  if (typeof text !== 'string' || !text.trim()) {
    return agentName || 'Untitled Prompt';
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) {
    return agentName || 'Untitled Prompt';
  }

  // Find the first meaningful header (Priority order)
  let titleLineIndex = lines.findIndex(line => {
    const trimmed = line.trim();
    
    // Strong match for top-level headers
    return (
      /^#\s+/.test(trimmed) ||                    // # Main Title
      trimmed.toLowerCase().startsWith('title:') || 
      trimmed.startsWith('## ') && !trimmed.includes('EPIC') // Avoid secondary headers
    );
  });

  if (titleLineIndex === -1) {
    titleLineIndex = 0; // fallback to first line
  }

  let line = lines[titleLineIndex];

  // Clean the line aggressively
  line = line
    .replace(/^#{1,6}\s+/, '')           // Remove markdown header markers
    .replace(/^Title:\s*/i, '')          // Remove "Title:" prefix
    .replace(/^\*\*|\*\*$/g, '')         // Remove bold markers
    .replace(/\\n/g, ' ')                // Remove escaped newlines
    .trim();

  // Stop at first colon or double newline indicator
  const cleanTitle = line.split(/[:|\n#]/)[0].trim();

  return cleanTitle || agentName || 'Untitled Prompt';
}

// Auto update prompts with EXACTLY "No Title" only - BATCH + INITIAL LOAD ONLY
autoFixNoTitlePrompts() {
  if (!this.apiData) return;

  const updatePayloads: any[] = [];
  const processedIds = new Set<string>();

  this.apiData.forEach((agency: any) => {
    agency.agents?.forEach((agent: any) => {
      agent.queries?.forEach((query: any) => {
        if (!query?._id || processedIds.has(query._id)) return;
        processedIds.add(query._id);

        const currentTitle = query.prompt_title;

        // STRICT CHECK: ONLY "No Title" string — nothing else (null, "", undefined, etc.)
        if (currentTitle !== "No Title") {
          return;
        }

        const newTitle = this.extractTitleFromResponse(query.prompt_output, agent.name);

        if (newTitle && newTitle !== "No Title" && newTitle.trim() !== "") {
          console.log(`Preparing batch fix for query ${query._id}: "${newTitle.substring(0, 100)}..."`);

          const payload = {
            agency_id: agency.agency_id || agency._id,
            agent_id: agent.agent_id,
            prompt_title: newTitle,
            user_query: query.user_query,
            event_id: query.event_id || '',
            map_id: query.map_id || ''
          };

          updatePayloads.push(payload);

          // Optimistically update UI
          query.prompt_title = newTitle;
        }
      });
    });
  });

  if (updatePayloads.length === 0) {
    console.log('No prompts with exact "No Title" found.');
    return;
  }

  console.log(`Sending batch update for ${updatePayloads.length} "No Title" prompts...`);

  this._loadingService.show();

  this.promptRepoService.batchUpdatePrompts({ updates: updatePayloads }).subscribe({
    next: (response) => {
      this._loadingService.hide();
      
      if (response?.success) {
        this.cdr.detectChanges();
        console.log(`Successfully batch-updated ${updatePayloads.length} prompts.`);
        
        if (updatePayloads.length >= 3) {
          console.log('success', `${updatePayloads.length} prompt titles were auto-updated.`);
        }
      }
    },
    error: (err) => {
      this._loadingService.hide();
      console.error('Batch update failed:', err);
      console.log('error', 'Some prompt titles could not be auto-updated.');
    }
  });
}

getExecutionStatus(query: any): { label: string; class: string } {
  if (!query) {
    return { label: 'Unknown', class: 'bg-secondary' };
  }

  const status = (query.status || '').toString().toLowerCase().trim();
  const executionCount = Number(query.execution_count || 0);

  // New Condition: All metrics are 0 but used more than once → Re-execute
  if (executionCount > 0) {
    const metrics = this.getPromptMetrics(query);
    const allMetricsZero = 
      (!metrics.correctness || metrics.correctness === 0) &&
      (!metrics.coherence || metrics.coherence === 0) &&
      (!metrics.relevance || metrics.relevance === 0) &&
      (!metrics.conciseness || metrics.conciseness === 0) &&
      (!metrics.safety || metrics.safety === 0) &&
      (!metrics.accuracy || metrics.accuracy === 0);

    if (allMetricsZero) {
      return { 
        label: 'Re-execute', 
        class: 'bg-warning text-dark' 
      };
    }
  }

  // Existing logic
  if (status === 'completed') {
    return { label: 'Completed', class: 'bg-success text-white' };
  } 
  else if (['inprogress', 'in_progress', 'pending'].includes(status)) {
    return { label: 'In Progress', class: 'bg-warning text-dark' };
  } 
  else if (status === 'stored' || query.is_stored_prompt === true) {
    return { 
      label: 'Not Executed', 
      class: 'bg-secondary text-white'
    };
  }
  else {
    return { 
      label: status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Not Executed', 
      class: 'bg-secondary text-white' 
    };
  }
}

refreshAgencyData(event: Event, agency: any) {
  event.stopPropagation();
  
  if (this.isRefreshing) return;
  
  this.isRefreshing = true;
  this.refreshingAgencyId = agency.agency_name;
  this.cdr.detectChanges();

  // First refresh agency data
  this.promptRepoService.getAgencyWithAgentsEnhanced().subscribe({
    next: (response) => {
      if (response?.data) {
        const updatedAgency = response.data.find((a: any) => a.agency_name === agency.agency_name);
        if (updatedAgency) {
          // Update in apiData
          const index = this.apiData.findIndex((a: any) => a.agency_name === agency.agency_name);
          if (index !== -1) {
            this.apiData[index] = updatedAgency;
          }
          
          // Update filteredAgencies
          if (!this.globalSearchTerm) {
            const filteredIndex = this.filteredAgencies.findIndex((a: any) => a.agency_name === agency.agency_name);
            if (filteredIndex !== -1) {
              this.filteredAgencies[filteredIndex] = updatedAgency;
            }
          }
          
          // Update selectedAgency if modal is open
          if (this.selectedAgency?.agency_name === agency.agency_name) {
            this.selectedAgency = updatedAgency;
            if (this.modalSearchTerm) {
              this.onModalSearch();
            } else {
              this.filteredModalData = this.getFilteredAgents(updatedAgency);
            }
          }
        }
      }
      
      // Then refresh agent config data
      this.refreshAgentConfigData();
    },
    error: (err) => {
      console.error('Error refreshing agency data:', err);
      this.showToast('error', 'Failed to refresh agency data.');
      this.isRefreshing = false;
      this.refreshingAgencyId = null;
      this.cdr.detectChanges();
    }
  });
}

// Separate method to refresh agent config data
private refreshAgentConfigData(): void {
  this._marketService.getAgentDetails().subscribe({
    next: (response) => {
      if (response?.success && response?.data) {
        this.allAgentDetails = response.data;
        
        // Rebuild the agentConfigMap
        this.agentConfigMap = {};
        response.data.forEach((agent: any) => {
          if (agent.agent_id) {
            this.agentConfigMap[agent.agent_id] = agent;
          }
        });
        
        console.log(`Refreshed ${response.data.length} agent config details`);
      }
      
      this.isRefreshing = false;
      this.refreshingAgencyId = null;
      this.showToast('success', 'Data refreshed successfully!');
      this.cdr.detectChanges();
    },
    error: (err) => {
      console.error('Error refreshing agent config:', err);
      this.isRefreshing = false;
      this.refreshingAgencyId = null;
      this.showToast('success', 'Agency data refreshed. Config data may not be updated.');
      this.cdr.detectChanges();
    }
  });
}

getAgentQueryCount(agent: Agent): number {
  return agent?.queries?.length || 0;
}

}