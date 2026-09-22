// @ts-nocheck
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  OnInit,
  signal,
  ViewChild,
  viewChild,
} from '@angular/core';
import { NgxSpinnerService } from 'ngx-spinner';
import {
  Vflow,
  VflowComponent,
  Edge,
  Connection,
  DynamicNode,
  HtmlTemplateDynamicNode,
  NodeChange,
} from 'ngx-vflow';
import { DndDropEvent, DndModule } from 'ngx-drag-drop';
import { WorkflowElementForm } from '../workflow-element-form/workflow-element-form';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  IReferenceData,
  IFlowData,
  IFlowTask,
  TWorkflowFormData,
  IAgentFormData,
  IIterativeFormData,
  IApiFormData,
  IConditionFormData,
  IWorkflow,
} from '../../types';
import { CommonModule } from '@angular/common';
import { WorkflowService } from '../../services/workflow.service';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { FormError } from '../../components/form-error/form-error';
import { Toast } from '../../components/toast/toast';
import { ToastService } from '../../services/toast.service';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';

type TCard = 'basicDetails' | 'nodes' | 'workflowComposition';
interface IDragComponentConfig {
  id: string;
  label: string;
  icon: string;
  type: IReferenceData['type'];
}
@Component({
  selector: 'app-create-workflow',
  imports: [
    Vflow,
    DndModule,
    WorkflowElementForm,
    RouterModule,
    CommonModule,
    ReactiveFormsModule,
    FormError,
    Toast,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-workflow.html',
  styleUrl: './create-workflow.css',
})
export class CreateWorkflow implements OnInit, AfterViewInit {
  vflow = viewChild.required(VflowComponent);
  @ViewChild('vflowContainer') vflowContainer!: ElementRef<HTMLDivElement>;

  toast = inject(ToastService);

  cardState: { [key in TCard]: { open: boolean } } = {
    basicDetails: { open: true },
    nodes: { open: true },
    workflowComposition: { open: true },
  };

  typeMapping: {
    [key in IReferenceData['type']]: Pick<
      IDragComponentConfig,
      'icon' | 'label'
    >;
  } = {
      agent: { label: 'Agent', icon: 'assets/img/bot.svg' },
      iterative: {
        label: 'Iterative',
        icon: 'assets/img/iterative.svg',
      },
      condition: {
        label: 'Condition',
        icon: '<i class="fa-solid fa-code-branch"></i>',
      },
      api: { label: 'Api Call', icon: 'assets/img/bot.svg' },
    };

  dragComponents: IDragComponentConfig[] = Object.keys(this.typeMapping).map(
    (type) => ({
      id: crypto.randomUUID(),
      label: this.typeMapping[type as IReferenceData['type']].label,
      icon: this.typeMapping[type as IReferenceData['type']].icon,
      type: type as IReferenceData['type'],
    })
  );

  edges: Edge[] = [];
  nodes: DynamicNode[] = [];
  zoomStep = 0.1;

  selectedNode?: HtmlTemplateDynamicNode;

  // form
  form: FormGroup<{
    flow_name: FormControl<string>;
    flow_description: FormControl<string>;
    agency_name: FormControl<string>;
  }>;
  isSubmitted = false;
  isSubmitting = false;

  nodesFormState: {
    [key: string]: TWorkflowFormData;
  } = {};

  workflowDetails: IWorkflow | null = null;
  IsEdit: boolean = false;
  titleDescription: string = 'Create New Workflow';
  agencyOptions: { id: string; name: string }[] = [];
  isWorkFlowExternal: boolean = false;
  isViewMode = false;
  isEditMode = true;
  
  editingNodeId: string | null = null;
  editName: string = '';
  isAgentDuplicate: boolean = false;


  constructor(
    private _loadingService: NgxSpinnerService,
    private _workflowService: WorkflowService,
    private router: Router,
    private fb: FormBuilder,
    private _stateService: AIInfuseStateService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {
    this.form = this.fb.group({
      flow_name: this.fb.control('', {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.minLength(4),
          Validators.maxLength(120),
        ],
      }),
      flow_description: this.fb.control('', {
        nonNullable: true,
        validators: Validators.required,
      }),
      agency_name: this.fb.control('', {
        nonNullable: true,
        validators: Validators.required,
      }),
    });
  }

  private getPreviousNode(
    target: string,
    nodes: HtmlTemplateDynamicNode<IDragComponentConfig>[],
    type?: IReferenceData['type']
  ): HtmlTemplateDynamicNode<IDragComponentConfig> | null {
    const edge = this.edges.find((item) => item.target === target);
    const edgeNode = nodes.find((item) => item.id === edge?.source);

    if (!type) return edgeNode || null;

    if (edgeNode && edgeNode.data?.().type === type) return edgeNode;

    if (edge?.source) return this.getPreviousNode(edge.source, nodes, type);
    return null;
  }

  get connectedAgent() {
    const selectedNode = this.selectedNode;

    if (
      !this.nodes.length ||
      !selectedNode ||
      selectedNode.data?.()?.type !== 'api'
    )
      return null;
    const nodes = this.nodes as HtmlTemplateDynamicNode<IDragComponentConfig>[];

    return this.getPreviousNode(selectedNode.id, nodes, 'agent');
  }

  private getNodeID(name: string) {
    // do not modify uuid
    if (
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
        name
      )
    )
      return name;

    let nameParts = name.split('-');

    if (!this.dragComponents.some((item) => nameParts[0].startsWith(item.type)))
      return name;

    if (nameParts.length < 2) nameParts = name.split('_');

    return nameParts.slice(1).join('-');
  }

  ngOnInit(): void {
    this.loadAgencies();
    const modeFromState = this._stateService.getWorkflowMode();
    this.isViewMode = modeFromState === 'view';
    this.isEditMode = modeFromState === 'edit';

    // Also support query param fallback (optional)
    const queryMode = this.route.snapshot.queryParamMap.get('mode');
    if (queryMode === 'view') {
      this.isViewMode = true;
      this.isEditMode = false;
    }

    this.IsEdit = !!this.route.snapshot.paramMap.get('id');

    if (this.isViewMode) {
      this.titleDescription = 'View Workflow';
      this.form.disable();           // ← disable top form
    } else if (this.IsEdit) {
      this.titleDescription = 'Edit Workflow';
    } else {
      this.titleDescription = 'Create New Workflow';
    }
    this.IsEdit = !!this.route.snapshot.paramMap.get('id');

    if (!this.IsEdit)
    {  
      this._stateService.SetIsBaseWorkflow(false);
      return;
    }

    this.titleDescription = 'Edit Workflow';
    this.workflowDetails = this._stateService.getWorkFlowDetails();
    console.log('workflowDetails:', this.workflowDetails);

    if (!this.workflowDetails || typeof this.workflowDetails !== 'object')
      return;

    const details = this.workflowDetails;

    // === 1. Fill top-level form ===
    this.form.setValue({
      flow_name: details.flow_name || '',
      flow_description: details.flow_description || '',
      agency_name: details.agency_name || '',
    });

    const IsExternal = details.IsExternal || false;
	
	this._stateService.SetIsBaseWorkflow(IsExternal);
	
    this.isWorkFlowExternal = IsExternal;
    let positions: any = {};

    positions = IsExternal ? this.normalizeNodePositions(details.flow_data?.flow_data?.node_positions) : details.flow_data?.flow_data?.node_positions || {};

    // === 2. Rebuild NODES ===
    const rawPositions = positions;
    const tasks = details.flow_data?.tasks || [];

    const nodes: DynamicNode[] = [];
    const nodesFormState: any = {};
    const validNodeIds: string[] = [];
	const processedNodeIds = new Set<string>(); // Track processed IDs to prevent duplicates
	
    for (const task of tasks) {
      let type: string;
    let nodeId = "";
      if(IsExternal)
      {
        const funcLower = task.function.toLowerCase();

        if (funcLower.includes("lyzr_agent")) {
          type = "agent";
        } else if (funcLower.includes("api_call") || funcLower.includes("api")) {
          type = "api";
        } else if (
          funcLower.includes("gpt_conditional") ||
          funcLower.includes("conditional") ||
          funcLower.includes("condition")
        ) {
          type = "condition";
        } else if (funcLower.includes("gpt") || funcLower.includes("llm") || funcLower.includes("prompt")) {
          type = "llm";  // or "gpt", "prompt" — whatever key your typeMapping uses
        } else {
          // or: continue;
        }
        nodeId = task.name
    }
    else{
      let nameParts = task.name.split('-');
      if (nameParts.length < 2) nameParts = task.name.split('_');

       type = nameParts[0] as IReferenceData['type'];
       nodeId = nameParts.slice(1).join('-');
    }
      if (type === "conditional") type = "condition";
	  
	  // === PREVENT DUPLICATES ===
      if (processedNodeIds.has(nodeId)) {
        console.warn(`Duplicate node detected and skipped: ${nodeId}`);
        continue; // Skip this duplicate
      }

      const config = this.typeMapping[type];
      if (!config) continue;

	  // Mark as processed
      processedNodeIds.add(nodeId);

      const nodeData: IDragComponentConfig = {
        id: nodeId,
        label: config.label,
        icon: config.icon,
        type,
      };

      nodesFormState[nodeId] = this.mapTaskToFormData(task, nodeId, type,details,this.isWorkFlowExternal);
      validNodeIds.push(nodeId);

      // Use saved position if valid, otherwise we'll layout later
      const savedPos = rawPositions[nodeId];
      const position =
        savedPos &&
          typeof savedPos.x === 'number' &&
          typeof savedPos.y === 'number'
          ? savedPos
          : null;

      nodes.push({
        id: nodeId,
        // @ts-expect-error: agent_id not defined in DynamicNode
        agent_id: '',
        Condition_false: '',
        agent_response: [],
        elapsedTime: 0,
        point: signal(position || { x: 0, y: 0 }), // temporary
        type: 'html-template',
        data: signal(nodeData),
      });
    }

    // === 3. AUTO-LAYOUT if positions are missing or broken ===
    const needsLayout = nodes.some((n) => !n.point() || n.point().x === 0);

    if (needsLayout && nodes.length > 0) {
      console.log('Applying auto-layout (horizontal, 250px spacing)');
      const startX = 100;
      const y = 150;
      const spacing = 250;

      nodes.forEach((node, index) => {
        node.point.set({ x: startX + index * spacing, y });
      });
    }

    this.nodes = nodes;
    this.nodesFormState = nodesFormState;

    // === 4. Rebuild EDGES – NEW + OLD + FALLBACK ===
    let edges: any[] = [];

    // Priority 1: Top-level edges (new workflow)
    const topLevelEdges = Array.isArray(details.edges) ? details.edges : [];
    if (topLevelEdges.length > 0) {
      edges = topLevelEdges.map((e: any, idx: number) => {
        const source = IsExternal ? e.source : this.getNodeID(e.source);
        const target = IsExternal ? e.target : this.getNodeID(e.target);

        console.log('Top-level edge:', { source, target });
        console.log('Edge ID:', e.id || `${source}->${target}-${Date.now()}-${idx}`, 'Type:', e.type || 'template');

        return {
          id: e.id || `${source}->${target}-${Date.now()}-${idx}`, // unique!
          source,
          target,
          type: e.type || 'template',
           edgeLabels: e.edgeLabels || {
            center: {
              type: 'html-template',
            },
          }    
 
        };
      });
      console.log('Loaded top-level edges:', edges.length);
    }
    // Priority 2: Nested flow_data.edges
    else {
      const nestedEdges = Array.isArray(details.flow_data?.edges)
        ? details.flow_data.edges
        : [];
      if (nestedEdges.length > 0) {
        edges = nestedEdges.map((e: any, idx: number) => {
          const source = IsExternal ? e.source : this.getNodeID(e.source);
          const target = IsExternal ? e.target : this.getNodeID(e.target);

          console.log('Top-level edge:', { source, target });
          console.log('Edge ID:', e.id || `${source}->${target}-${Date.now()}-${idx}`, 'Type:', e.type || 'template');

          return {
            id: e.id || `${source}->${target}-${Date.now()}-${idx}`,
            source,
            target,
            type: e.type || 'template',
             edgeLabels: e.edgeLabels || {
            center: {
              type: 'html-template',
            },
          }    
 
          };
        });
      }
      // Priority 3: Generate sequential
      else if (tasks.length > 1) {
        console.log('Generating sequential edges');
        edges = tasks.slice(0, -1).map((task: { name: any }, i: number) => {
          const source = task.name;
          const target = tasks[i + 1].name;
          return {
            id: `${source}->${target}-${Date.now()}-${i}`,
            source,
            target,
            type: 'template',
          };
        });
      }
    }

    // === 5. Force React Flow to render edges ===
    this.edges = []; // clear
    this.cdr.detectChanges(); // force digest
    this.edges = edges; // reassign
    this.cdr.detectChanges();

    console.log('Final edges assigned:', this.edges.length);
    console.table(
      this.edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))
    );

    // === 6. Final UI updates ===
    this.selectedNode = undefined;
    this.cdr.detectChanges();
  }

  ngAfterViewInit(): void {
    this._loadingService.hide();
  }

  toggleCard(cardType: TCard) {
    this.cardState[cardType].open = !this.cardState[cardType].open;
  }

  createNode({ event, data }: DndDropEvent) {
    if (!data?.type) return;

    const spaces = this.vflow().documentPointToFlowPoint(
      {
        x: event.x,
        y: event.y,
      },
      { spaces: true }
    );
    const [point] = spaces;

    const height =
      this.vflowContainer.nativeElement.getBoundingClientRect().height;
    point.y = Math.ceil(height / 2) - 30;

    // Create a unique ID for this new node, ignoring the drag component's id
    const uniqueId = crypto.randomUUID();
    const newNode: DynamicNode = {
      id: uniqueId,
      // @ts-expect-error: agent_id not defined in DynamicNode
      agent_id: '',
      Condition_false: '',
      agent_response: [],
      elapsedTime: 0,
      point: signal(point),
      type: 'html-template',
      data: signal({
        ...data,
        id: uniqueId, // Assign this unique id to data as well
      }),
    };

    this.nodes = [...this.nodes, newNode];

    this.nodesFormState[newNode.id] = {
      id: newNode.id,
      type: data.type,
    } as TWorkflowFormData;

    if (data.type === 'condition') {
      this.nodesFormState[newNode.id] = {
        ...this.nodesFormState[newNode.id],
        condition: '',
        true_cond_ids: [],
        false_cond_ids: [],
      };
    }
  }

  private isConditionNode(nodeId: string) {
    const node = this.nodes.find(
      (item) => item.id === nodeId
    ) as HtmlTemplateDynamicNode<IDragComponentConfig>;
    if (node?.data?.().type === 'condition') return node;
    return false;
  }

  isIterativeNode(nodeId: string): boolean {
  const node = this.nodes.find((item) => item.id === nodeId) as HtmlTemplateDynamicNode<IDragComponentConfig>;
  if (node?.data?.().type === 'iterative') return node;
  return false;
}

  isApiCallNode(nodeId: string): boolean {
    const node = this.nodes.find((item) => item.id === nodeId) as HtmlTemplateDynamicNode<IDragComponentConfig>;
    if (node?.data?.().type === 'api') return node;
    return false;
  }

  createEdge(event: Connection) {
    const { source, target, sourceHandle, targetHandle } = event;

    console.log('Trying to create edge:', event);

    const sourceIsCondition = this.isConditionNode(source);
    const sourceIsIterative = this.isIterativeNode(source);
    const sourceIsApiCall = this.isApiCallNode(source);

    const targetIsCondition = this.isConditionNode(target);
    const targetIsIterative = this.isIterativeNode(target);
    const targetIsApiCall = this.isApiCallNode(target);
    // ====================== VALIDATION RULES ======================

    // 1. Prevent Condition → Condition
    if (sourceIsCondition && targetIsCondition) {
      console.log("Cannot connect condition to another condition");
      return;
    }

    // 2. Prevent Iterative → Condition
    if (sourceIsIterative && targetIsCondition) {
      console.log("Cannot connect iterative node to condition");
      return;
    }

    // 3. Prevent API Call → Condition
    if (sourceIsApiCall && targetIsCondition) {
      console.log("Cannot connect API call node to condition");
      return;
    }

    // 4. Prevent  Condition  → API Call
    if (sourceIsCondition && targetIsApiCall) {
      console.log("Cannot connect condition node to API call node");
      return;
    }

    // 5. Prevent  Condition  → iterative
    if (sourceIsCondition && targetIsIterative) {
      console.log("Cannot connect condition node to iterative node");
      return;
    }

    // 4. Prevent duplicate edges
    const alreadyExists = this.edges.some(
      e => e.source === source && e.target === target
    );
    if (alreadyExists) {
      console.log("Duplicate edge prevented");
      return;
    }

    // ====================== CREATE EDGE ======================

    const newEdge = {
      id: `${source}${sourceHandle ? `-${sourceHandle}` : ''}->${target}${targetHandle ? `-${targetHandle}` : ''}`,
      source,
      target,
      sourceHandle,
      targetHandle,
      type: 'template',
      edgeLabels: {
        center: {
          type: 'html-template',
        },
      },
    };

    this.edges = [...this.edges, newEdge];

    // ====================== UPDATE CONDITION STATE ======================
    // Only update if source is a Condition node
    if (sourceIsCondition) {
      const conditionData = this.nodesFormState[source] as IConditionFormData;

      if (sourceHandle === 'true') {
        conditionData.true_cond_id = target;        // or true_cond_ids.push(target) if multiple
      } else {
        conditionData.false_cond_ids = [target];    // or .push(target) if multiple false paths allowed
      }
    }

    console.log('Edge created successfully. Edges:', this.edges);
  }

  toggleCondition(event: MouseEvent, edge: Edge) {
    event.stopPropagation();
    const formState = this.nodesFormState[edge.source] as IConditionFormData;

    if (formState.true_cond_ids.includes(edge.target)) {
      formState.true_cond_ids = formState.true_cond_ids.filter(
        (item) => item !== edge.target
      );
      formState.false_cond_ids.push(edge.target);
      return;
    }

    formState.false_cond_ids = formState.false_cond_ids.filter(
      (item) => item !== edge.target
    );
    formState.true_cond_ids.push(edge.target);
  }

  // Called when user types in the input
  onNameInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.editName = input.value;
  }

  startEditing(node: any): void {
    if (!node) return;

    this.editingNodeId = node.id;
    this.editName = this.nodesFormState[node.id]?.agentDetails?.name || '';

    // Focus and select the input after it renders
    setTimeout(() => {
      const inputElement = document.querySelector('.agent-edit-input') as HTMLInputElement;
      inputElement?.focus();
      inputElement?.select();
    }, 10);
  }

  saveAgentName(node: any): void {
    if (!this.editingNodeId || !node) {
      this.cancelEditing();
      return;
    }

    const newName = this.editName.trim();

    if (newName === '') {
      this.toast.showToast('error',"Agent name cannot be empty.");
      this.cancelEditing();
	  this.isAgentDuplicate = true;
      this.cdr.detectChanges();
      return;
    }

  if (this.isAgentNameDuplicate(newName, node.id)) {
	  this.isAgentDuplicate = true;
      this.cdr.detectChanges();
	  this.toast.showToast('error',"Agent name already exists. Please choose a different name.");
	  return;
  }

    // Update nodesFormState
    if (!this.nodesFormState[node.id]) {
      this.nodesFormState[node.id] = {};
    }
    if (!this.nodesFormState[node.id].agentDetails) {
      this.nodesFormState[node.id].agentDetails = {};
    }

    this.nodesFormState[node.id].agentDetails.name = newName;
    //this.nodesFormState[node.id].agent = true;

    // Update the node data directly (important for your graph)
    if (node.data) {
      node.data().name = newName;
      node.data().agentName = newName;
      // node.data().label = newName;   // uncomment only if needed
    }

    this.cancelEditing();
    console.log(`Agent name updated to: ${newName}`);
  }

  private isAgentNameDuplicate(name: string, excludeNodeId: string): boolean {
  const lowerName = name.toLowerCase();
  
  return Object.entries(this.nodesFormState).some(([nodeId, state]: [string, any]) => {
    // Skip the current node being edited
    if (nodeId === excludeNodeId) return false;
    
    const existingName = state?.agentDetails?.name?.trim().toLowerCase();
    return existingName === lowerName;
  });
}


  cancelEditing(): void {
    this.editingNodeId = null;
    this.editName = '';
  }

  normalizeNodePositions(nodePositions, padding = 50) {
    if (!nodePositions || Object.keys(nodePositions).length === 0) return {};

    // Find extreme coordinates to calculate required shift
    const allX = Object.values(nodePositions).map(n => n.x);
    const allY = Object.values(nodePositions).map(n => n.y);
    const minX = Math.min(...allX);
    const minY = Math.min(...allY);

    // Calculate single offset to bring entire graph into visible area
    const offsetX = -minX + padding;
    const offsetY = -minY + padding;

    // Generate new positions with consistent transformation
    const normalized = {};
    for (const [id, pos] of Object.entries(nodePositions)) {
      normalized[id] = {
        x: Math.round((pos.x + offsetX) / 20) * 20, // Snap to 20px grid
        y: Math.round((pos.y + offsetY) / 20) * 20
      };
    }
    return normalized;
  }


  onZoomIn() {
    const viewport = this.vflow().viewport();
    const maxZoom = this.vflow().maxZoom || 10;
    this.vflow().zoomTo(Math.min(maxZoom, viewport.zoom + this.zoomStep));
  }

  onZoomOut() {
    const viewport = this.vflow().viewport();
    const minZoom = this.vflow().minZoom || 0;
    this.vflow().zoomTo(Math.max(minZoom, viewport.zoom - this.zoomStep));
  }

  onZoomReset() {
    const el = this.vflowContainer.nativeElement;
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  onNodesChange(e: NodeChange[]) {
    const node = e[0];

    if (node.type !== 'select') return;

    if (node.selected) {
      if (this.selectedNode?.id === node.id) return;

      this.selectedNode = this.nodes.find(
        (item) => item.id === node.id
      ) as HtmlTemplateDynamicNode<IDragComponentConfig>;

      return;
    }
  }

  onNodeReset(deleteNode?: boolean) {
    if (this.selectedNode && deleteNode) this.deleteNode(this.selectedNode.id);
    this.selectedNode = undefined;
  }

  onNodeSelect(nodeId: string) {
    this.selectedNode = undefined;

    const n = this.nodes.find(
      (item) => item.id === nodeId
    ) as HtmlTemplateDynamicNode<IDragComponentConfig>;

    if (n) this.selectedNode = n;
  }

  handleNodeClick(event: MouseEvent) {
	  
	if(this.editingNodeId) return; // Ignore clicks when editing
	  
    const workflowNodeElement = (event.target as HTMLElement).closest(
      '.workflow-node'
    );

    if (workflowNodeElement) {
      const nodeId = workflowNodeElement.getAttribute('id');

      const n = this.nodes.find(
        (item) => item.id === nodeId
      ) as HtmlTemplateDynamicNode<IDragComponentConfig>;

      if (n) this.selectedNode = n;
      return;
    }

    this.selectedNode = undefined;
  }

  /** --------------------------------------------------------------
   *  deleteNode – removes a node + ALL connected edges (in/out)
   *  -------------------------------------------------------------- */
  deleteNode(nodeId: string, e?: MouseEvent): void {
    e?.stopPropagation();

    Object.keys(this.nodesFormState).forEach((item) => {
      if (this.nodesFormState[item].type === 'condition') {
        const formState = this.nodesFormState[
          item
        ] as IConditionFormData;

        if (formState.true_cond_ids.includes(nodeId)) {
          formState.true_cond_ids = formState.true_cond_ids.filter(
            (item) => item !== nodeId
          );
        } else if (formState.false_cond_ids.includes(nodeId)) {
          formState.false_cond_ids = formState.false_cond_ids.filter(
            (item) => item !== nodeId
          );
        }
      }
    });



    // 1. Remove from canvas nodes
    this.nodes = this.nodes.filter((n) => n.id !== nodeId);

    // 2. Remove ALL connected edges
    this.edges = this.edges.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId
    );

    // 3. CRITICAL: Remove from form state (this is what was missing!)
    delete this.nodesFormState[nodeId];

    // 4. Fix drag UI
    const el = document.getElementById(nodeId);
    if (el) el.style.pointerEvents = 'unset';

    // 5. Deselect
    if (this.selectedNode?.id === nodeId) {
      this.selectedNode = undefined;
    }
  }

  onNodeFormSubmission(data: TWorkflowFormData) {
    this.nodesFormState[data.id] = data;
    this.selectedNode = undefined;
  }

  private getConnectedNodes(
    nodeId: string,
    sourceTargetMap: Record<string, string[]>,
    value: string[] = []
  ): string[] {
    const nextNodeIds = sourceTargetMap[nodeId];
    if (this.nodesFormState[nodeId]?.type === 'condition') {
      const conditionFormState = this.nodesFormState[
        nodeId
      ] as IConditionFormData;

      // Helper: Normalize and sanitize IDs to non-empty strings only
      const normalizeIds = (ids) => {
        if (Array.isArray(ids)) {
          return ids.filter(id => typeof id === 'string' && id.trim() !== '');
        }
        if (typeof ids === 'string' && ids.trim() !== '') {
          return [ids];
        }
        return []; // Handles null, undefined, empty string, numbers, etc.
      };

      // Normalize both true/false condition IDs
      const normalizedTrue = normalizeIds(conditionFormState.true_cond_ids);
      const normalizedFalse = normalizeIds(conditionFormState.false_cond_ids);

      // Build final IDs array safely
      const ids = [
        ...value,
        ...normalizedTrue
          .map(id => this.getConnectedNodes(id, sourceTargetMap, [id]))
          .flat(),
        ...normalizedFalse
          .map(id => this.getConnectedNodes(id, sourceTargetMap, [id]))
          .flat(),
      ];

      return ids;
    }

    if (nextNodeIds?.length) {
      const ids = [
        ...value,
        ...nextNodeIds
          .map((id) => this.getConnectedNodes(id, sourceTargetMap, [id]))
          .flat(),
      ];

      return ids;
    }

    return value;
  }

  private sortNodesForm() {
    const sourceTargetMap: Record<string, string[]> = {};
    this.edges.forEach((edge) => {
      if (sourceTargetMap[edge.source])
        sourceTargetMap[edge.source].push(edge.target);
      else sourceTargetMap[edge.source] = [edge.target];
    });
    const targets = Object.values(sourceTargetMap).flat();

    // 1. find the first node ( decided based on edge ) nodeId should not be target of any edge
    const firstNode = this.nodes.find((node) => !targets.includes(node.id));

    if (!firstNode) return [];

    let tempNodeId = firstNode.id;

    const newNodeArray: string[] = [
      tempNodeId,
      ...this.getConnectedNodes(tempNodeId, sourceTargetMap),
    ];

    return newNodeArray.map((item) => ({
      call_next:
        sourceTargetMap[item]?.map(
          (id) => `${this.nodesFormState[id]?.type}-${id}`
        ) || [],
      ...this.nodesFormState[item],
    }));
  }

  onSave() {
    if (this.form.invalid || !this.isFormValid) return;

	const isExternal = this.workflowDetails?.IsExternal;
    const tasks: IFlowTask[] = [];
    const sortedState = this.sortNodesForm();

    sortedState.forEach(({ call_next, ...data }) => {
      if (data.type === 'agent') {
        const d = data as IAgentFormData;
        tasks.push({
          function: 'call_lyzr_agent',
          name: !isExternal? `agent-${d.id}`: d.id.startsWith('agent_') ? d.id : `${d.id}`,
          user_input: d.input,
          call_next,
          params: {
            assets: [],
            config: {
              agent_id: d?.agent || '',
              agent_name: d.agentDetails?.name || '',
              user_id: d.agentDetails?.user_id || '',
              api_key: d.agentDetails?.agent_api_key || '',
              api_url: d.agentDetails?.agent_api_url || '',
              session_id: d.agentDetails?.agent_session_id || '',
              api_agent_id: d.agentDetails?.api_agent_id || '',
            },
          },
          tag: '',
        });
      } else if (data.type === 'api') {
        const d = data as IApiFormData;
        tasks.push({
          function: 'api_call',
          name: !isExternal ? `api-${d.id}` : d.id.startsWith('api_') ? d.id : `${d.id}`,
          call_next,
          params: {
            assets: [],
            config: {
              agent_id: '',
              agent_name: '',
              user_id: '',
              api_key: '',
              api_url: d.api_url,
              session_id: '',
            },
          },
          tag: '',
        });
      } else if (data.type === 'iterative') {
        const d = data as IIterativeFormData;
        tasks.push({
          function: d.loop_condition,
          name: !isExternal ? `iterative-${d.id}` : d.id.startsWith('iterative_') ? d.id : `${d.id}`,
          call_next, // ← will be "iterative", "condition", "agent-xxx", or ""
          params: {
            assets: [],
            config: {
              agent_id: '',
              agent_name: '',
              user_id: '',
              api_key: '',
              api_url: '',
              session_id: '',
            },
          },
          tag: '',
        });
      } else if (data.type === 'condition') {
        const d = data as IConditionFormData;
        tasks.push({
          function: 'condition',
          name: !isExternal ? `condition-${d.id}` : d.id.startsWith('condition_') ? d.id : `${d.id}`,
          user_input: d.condition,
          call_next, // ← same rule: based only on next node
          params: {
            assets: [],
            config: {
              agent_id: '',
              agent_name: '',
              user_id: '',
              api_key: '',
              api_url: '',
              session_id: '',
              true_cond_ids: d.true_cond_ids,
              false_cond_ids: d.false_cond_ids,
            },
          },
          tag: '',
        });
      }
    });

    // Build positions
    const flow_data: IFlowData = {
      flow_data: { node_positions: {} },
      tasks,
      edges: this.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: e.type,
         edgeLabels: e.edgeLabels || {
            center: {
              type: 'html-template',
            },
          }    
 
      })),
    };

    this.nodes.forEach((item) => {
      const { x, y } = item.point();
      flow_data.flow_data.node_positions[item.id] = { x, y };
    });

    // Submit
    this.isSubmitting = true;
    this._loadingService.show();

    const payload = {
      flow_name: this.form.value.flow_name!,
      flow_description: this.form.value.flow_description!,
      agency_name: this.form.value.agency_name!,
      flow_data,
      edges: this.edges,
    };

    const isFirstTaskAgent = flow_data?.tasks?.[0]?.function === 'agent' || (flow_data?.tasks?.[0]?.function === 'call_lyzr_agent');

    if (!isFirstTaskAgent && !isExternal) {
      this.toast.showToast(
          'error',
          'Agent Node must be the first node in the workflow. Please rearrange your nodes and try again.'
        );
        this._loadingService.hide();
    }
    else{	
    const request$ = this.IsEdit
      ? this._workflowService.updateWorkflow({
        flowId: (this.workflowDetails?.flow_id || this.workflowDetails?._id)!,
        ...payload,
      })
      : this._workflowService.createWorkflow(payload);

    request$.subscribe({
      next: () => {
        this._loadingService.hide();
        this.toast.showToast(
          'success',
          this.IsEdit
            ? 'Workflow updated successfully'
            : 'Workflow created successfully'
        );
        setTimeout(
          () => this.router.navigateByUrl('/marketplace/workflows'),
          1000
        );
        this.isSubmitting = false;
      },
      error: (err) => {
        console.error('Save failed:', err);
        this.toast.showToast(
          'error',
          err?.message || 'Failed to save workflow'
        );
        this._loadingService.hide();
        this.isSubmitting = false;
      },
    });
  }
  }
  get isFormValid(): boolean {
	  if (this.isViewMode) return false;
	  if (
		!this.form.value.flow_name ||
		!this.form.value.flow_description ||
		!this.form.value.agency_name||
		!this.nodes.length
	  ) {
		return false;
	  }
	 
	  const n = this.nodes.length;
	  const e = this.edges.length;

	  if (n === 0 || n === 1) {
		return true;           // isolated nodes or empty → always valid
	  }

	  if (e < n - 1) {
		return false;          // not even a tree (disconnected or too few edges)
	  }

	  return true;

	}


  private mapTaskToFormData(
    task: IFlowTask,
    nodeId: string,
    type: IReferenceData['type'],
	workflowdetails: any,
    isExternal: boolean
  ): TWorkflowFormData {
    const base = {
      id: nodeId,
      type,
      agent: '', // will be filled below
      agentDetails: undefined,
      api_url: '',
      loop_condition: '',
      input: '',
    };

    if (type === 'agent') {
      const config = task.params.config;
      console.log('Mapping task to agent form data:', task, config);
      return {
        ...base,
        input: task?.user_input || task?.params?.user_message?.value || '',
        agent: config.agent_id || '',
        agentDetails: {
          name: config.agent_name || '',
          agent_owner: config.user_id || '',
          _id: '',
          agent_id: config.agent_id,
          agent_prompt: '',
          agent_type_id: '',
          agent_type_name: '',
          api_agent_id: config?.api_agent_id || '',
          agent_session_id: config?.session_id || '',
          user_id: config?.user_id || '',
          agent_api_key: config?.api_key || '',
          agent_api_url: config?.api_url || '',
          description: '',
          feedback: '',
          foundation_ethic_ai: undefined,
          foundation_guardrails_ai: undefined,
          foundation_resp_ai: undefined,
          isDeleted: false,
          knowledge_store_id: '',
          mcp_connector_id: '',
          mcp_connector_name: '',
          model: undefined,
          model_name: '',
          prompt_template: '',
          rating: 0,
          ref_output: '',
          role_id: '',
          role_name: '',
          run_count: 0,
          run_status: '',
          scheduleFrequency: '',
          schedulerTime: undefined,
          status: '',
          trending: false,
          updated_by: '',
          updated_ts: '',
        },
      };
    }

    if (type === 'api') {
      const config = task.params.config;
      return {
        ...base,
        api_url: config.api_url || '',
      };
    }

    if (type === 'iterative') {
      return {
        ...base,
        loop_condition: task.function || '',
      };
    }

    if (type === 'condition') {
     let trueTargets = "";
      let falseTargets ="";

      if(isExternal){
      // Filter edges by condition and extract target values
        trueTargets = workflowdetails.flow_data.edges.filter(edge => edge.condition === "true").map(edge => edge.target);
        falseTargets = workflowdetails.flow_data.edges.filter(edge => edge.condition === "false").map(edge => edge.target);
      }
      else{
        trueTargets = normalizeTargets(task.params.config?.true_cond_ids || task.params?.true);
       falseTargets = normalizeTargets(task.params.config?.false_cond_ids || task.params?.false);
      }

      return {
        ...base,
        condition: task?.user_input || task?.params?.condition || '',
        true_cond_ids: trueTargets,
        false_cond_ids: falseTargets,
      };
    }

    return base as any; // fallback
  }

  onCancel() {
    this.router.navigateByUrl('/marketplace/workflows', { replaceUrl: true });
  }

  loadAgencies() {
    this._workflowService.getAgenciesForDropdown().subscribe({
      next: (response) => {
        const raw = Array.isArray(response) ? response : response?.data || [];

        this.agencyOptions = raw
          .filter((a: any) => a?.agency_id && a?.agency_name)
          .map((a: any) => ({
            id: a.agency_id,
            name: a.agency_name,
          }))
          .sort((a: { name: string }, b: { name: string }) =>
            a.name.localeCompare(b.name)
          );

        this.cdr.detectChanges();

        // Auto-select in edit mode
        const agency_name = this.workflowDetails?.agency_name;
        if (this.IsEdit && agency_name) {
          this.form.patchValue({
            agency_name: this.agencyOptions.find(
              (item) => item.name === agency_name
            )?.id,
          });
        }
      },
      error: (err) => {
        console.error('Failed to load agencies', err);
        this.toast.showToast('error', 'Could not load agencies');
        this.agencyOptions = [];
      },
    });
  }

  deleteEdge(edge: Edge): void {
    this.edges = this.edges.filter((item) => item.id !== edge.id);
  }
  
  get isValidWorkflow(): boolean {
	return !this.isFormValid || this.isAgentDuplicate;
  }
  
}
