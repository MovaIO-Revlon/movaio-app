import { Component, signal, computed, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SemarketplaceService } from '../../services/semarketplace.service';
import {
  AgentEvalService,
  FetchEvalRequest,
} from '../../services/agent-eval.service';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { forkJoin } from 'rxjs';
import { ChangeDetectorRef } from '@angular/core';
import { DatePicker } from '../../components/datepicker/datepicker';

type TabType = 'eval' | 'definition' | 'execution';
declare var bootstrap: any;

interface TabOption {
  value: TabType;
  label: string;
}

interface EvalTypeOption {
  value: string;
  label: string;
}

export interface DateGroup {
  dateKey: string;
  dateLabel: string;
  results: EvalResult[];
}

export interface RationaleMap {
  correctness: string;
  coherence: string;
  relevance: string;
  conciseness: string;
  completeness: string;
  fluency: string;
  hallucinationRate: string;
  toxicityScore: string;
  safety: string;
  average: string;
  status: string;
}

export interface EvalResult {
  runId: string;
  testCaseId: string;
  time: string;
  dateStr: string;
  timestamp: number;
  input: string;
  expectedOutput: string;
  actualOutput: string;
  status: 'PASS' | 'FAIL';
  correctness: number;
  coherence: number;
  relevance: number;
  conciseness: number;
  completeness: number;
  fluency: number;
  hallucinationRate: number;
  toxicityScore: number;
  safety: number;
  average: number;
  totalTests: number;
  correctnessRationale: string;
  coherenceRationale: string;
  relevanceRationale: string;
  concisenessRationale: string;
  completenessRationale: string;
  fluencyRationale: string;
  hallucinationRateRationale: string;
  toxicityScoreRationale: string;
  safetyRationale: string;
  averageRationale: string;
  statusRationale: string;
  detailed_results?: any[];
  agentConfig?: any;
}

export interface DataPair {
  id: string;
  input: string;
  output: string;
}

export interface TraceData {
  id: string;
  content: string;
  expectedOutput: string;
}

export interface AnalysisData {
  testCaseId: string;
  problem: string;
  rootCauses: string[];
  suggestedFixes: string[];
  impact?: string;     
  severity?: string;
  severityRationale?: string;
  agentConfig?: any;           
  configHighlights?: Record<string, string>;
}

@Component({
  selector: 'app-agent-eval',
  imports: [CommonModule, FormsModule, TooltipDirective, DatePicker],
  templateUrl: './agent-eval.html',
  styleUrl: './agent-eval.css',
})
export class AgentEval {
  constructor(
    private _marketService: SemarketplaceService,
    private _evalService: AgentEvalService,
    private _stateService: AIInfuseStateService,
     private cdr: ChangeDetectorRef,
  ) {}

  readonly tabs: TabOption[] = [
    { value: 'eval', label: 'Offline/Online Agent Evaluation' },
    { value: 'definition', label: 'Agent Definition' },
    { value: 'execution', label: 'Agent Execution' },
  ];

  readonly evalTypes: EvalTypeOption[] = [
    { value: 'offline', label: 'Offline' },
    { value: 'Online', label: 'Online' },
  ];

  readonly onlineDatasetOptions: { value: string; label: string }[] = [
    { value: 'Simulation Data', label: 'Simulation-based' },
    { value: 'I/O Dataset Evaluation', label: 'I/O Dataset Evaluation' },
    { value: 'Trace-Based Evaluation', label: 'Trace-based Evaluation' },
    { value: 'Config + I/O Dataset', label: 'Config + I/O Dataset' },
    { value: 'Config + Trace Data', label: 'Config + Trace Data' },
    { value: 'Configuration Only', label: 'Configuration Only' },
  ];

  isMethodOptionDisabled(optionValue: string): boolean {
    if (this.selectedEvalType() === 'Online') {
      return ['Configuration Only'].includes(optionValue);
    }
    return false;
  }

  datasetOptions = computed(() => {
    if (this.selectedEvalType() === 'Online') {
      return this.onlineDatasetOptions;
    }
    return [
      { value: 'Input/Output Data', label: 'Input/Output Data' },
      { value: 'Trace Data', label: 'Trace Data' },
    ];
  });

  simExpectedOutputs = signal<{ id: string; expectedOutput: string }[]>([
  { id: this.generateId(), expectedOutput: '' },
]);

  needsDataInput = computed(() => {
  if (this.selectedEvalType() === 'Online') {
    const ds = this.selectedDataSet();
    
    // Do NOT show Input/Output fields for Online I/O Dataset Evaluation
    if (['I/O Dataset Evaluation', 'Config + I/O Dataset'].includes(ds)) {
        return false;  
      }
    
    // No data input for trace-based scenarios
    if (['Trace-Based Evaluation', 'Config + Trace Data'].includes(ds)) {
      return false;
    }
    
    return ['Config + I/O Dataset'].includes(ds); // Only show for config+io
  }
  return true; // Offline scenarios
});

  readonly METRIC_KEYS = [
    'correctness',
    'coherence',
    'relevance',
    'conciseness',
    'completeness',
    'fluency',
    'hallucination_rate',
    'toxicity_score',
    'safety',
    'accuracy',
    'average',
    'status',
  ] as const;

  agents = signal<any[]>([]);
  agentSearchText = signal<string>('');
  isAgentDropdownOpen = signal<boolean>(false);
  activeTab = signal<TabType>('eval');
  selectedAgent = signal<string>('');
  selectedEvalType = signal<string>('');
  selectedDataSet = signal<string>('');

  isEvaluating = signal<boolean>(false);
  isFetchingHistory = signal<boolean>(false);

  dateGroups = signal<DateGroup[]>([]);
  activeDateKey = signal<string | null>(null);
  showResults = computed(() => this.dateGroups().length > 0);

  metricDefinitions = signal<Record<string, string>>({});

  evalError = signal<string | null>(null);
  invalidFields = signal<Map<string, string>>(new Map());
  hasInvalidFields = computed(() => this.invalidFields().size > 0);
  toastMessage: string = '';
  uploadingFields = signal<Set<string>>(new Set());

  dataPairs = signal<DataPair[]>([
    { id: this.generateId(), input: '', output: '' },
  ]);

  traceDataList = signal<TraceData[]>([
    { id: this.generateId(), content: '', expectedOutput: '' },
  ]);

  expandedCells = signal<Set<string>>(new Set());
  isSuperAdmin = signal<boolean>(false);
  showStep1 = computed(() => this.selectedAgent().length > 0);
  showStep2 = computed(() => this.showStep1() && this.selectedEvalType().length > 0);
  showStep3 = computed(() => this.showStep2() && this.selectedDataSet().length > 0);
  isTraceData = computed(() => {
  if (this.selectedEvalType() === 'Online') {
    return ['Trace-Based Evaluation', 'Config + Trace Data'].includes(this.selectedDataSet());
  }
  return this.selectedDataSet() === 'Trace Data';
});
  simScenarios = signal<string>('');
  simPersonas = signal<string>('');
  simTurns = signal<number>(1);

  isSimulationBased = computed(() =>
    this.selectedEvalType() === 'Online' && this.selectedDataSet() === 'Simulation Data'
  );
  selectedAgentObj = signal<any>(null);
  selectedAnalysis = signal<AnalysisData | null>(null);
  isOnlineEvaluation = computed(() => this.selectedEvalType() === 'Online');
  isConfigIoScenario = computed(() => {
    return this.selectedEvalType() === 'Online' && 
          this.selectedDataSet() === 'Config + I/O Dataset';
  });
  isConfigTraceScenario = computed(() => {
    return this.selectedEvalType() === 'Online' && 
          this.selectedDataSet() === 'Config + Trace Data';
  });
  readonly evalMethodDescriptions: Record<string, string> = {
  'Simulation Data': 'The system generates synthetic inputs, actual outputs and expected outputs, then evaluates the agent’s performance.',
  'I/O Dataset Evaluation': 'Evaluates the agent using predefined input-output datasets to measure accuracy and consistency against expected results.',
  'Trace-Based Evaluation': 'Uses past execution traces (logs of previous runs) to analyze agent behavior and performance.',
  'Config + I/O Dataset': 'Combines agent configuration with input–output datasets to evaluate how configuration changes impact expected outputs.',
  'Config + Trace Data': 'Uses configuration settings along with historical trace data to assess behavior under real-world execution scenarios.',
  'config-only': 'Evaluates the agent based solely on its configuration, without using input data or execution traces.',
};
  isMethodDropdownOpen = signal<boolean>(false);
  cellTooltip: {
  visible: boolean;
  position: { left: number; top: number };
  text: string;
  } = {
    visible: false,
    position: { left: 0, top: 0 },
    text: ''
  };
  cellTooltipTimeout: any = null;
  isCellTooltipHovered: boolean = false;
  cellTooltipSizing: { width: number; maxHeight: number } = { width: 280, maxHeight: 180 };
  isAgentsLoading = signal<boolean>(false);
  noTracesError = signal<string | null>(null);
  methodInfoTooltip = signal({
    visible: false,
    text: '',
    position: { left: 0, top: 0 }
  });
  dateRange = signal<Date[]>([]);
  showDateFilter = computed(() => {
    if (!this.showStep3()) return false;
    if (this.selectedEvalType() === 'offline') {
    return false;
  }
    const ds = this.selectedDataSet();
    const traceBased = ['Trace Data', 'Trace-Based Evaluation', 'Config + Trace Data'].includes(ds);
    const ioBased = ['Input/Output Data', 'I/O Dataset Evaluation', 'Config + I/O Dataset'].includes(ds);
    return traceBased || ioBased;
  });
  isEvaluateAction = signal<boolean>(false);
  expandedCauses = signal<Set<number>>(new Set());
  readonly evalTypeDescriptions: Record<string, string> = {
    offline: 'Evaluate the agent using input/output or trace data without connecting to a live agent endpoint.',
    Online: 'Connects to a live agent endpoint to run evaluations using simulation, I/O datasets, trace data, or configuration-only analysis.',
  };

  evalTypeTooltip = signal({
    visible: false,
    text: '',
    position: { left: 0, top: 0 }
  });
  copiedItems = signal<Set<string>>(new Set());
  tooltipCopied = signal<boolean>(false);
  evaluatingDateKey = signal<string | null>(null);
  showFallbackLoading = computed(() => {
  return this.isEvaluating() && 
    !this.dateGroups().some(g => g.dateKey === this.evaluatingDateKey());
});


  ngOnInit(): void {
    this.loadAgents();
    this.checkUserRole();
  }

  onTabChange(tab: TabType) {
    this.activeTab.set(tab);
  }

  apiAgentId = computed<string>(() => {
    const agent = this.selectedAgentObj();
    if (!agent) return '';
    return  agent.agent_id || '';
  });

  loadAgents(): void {
    this.isAgentsLoading.set(true);

    this._marketService.getAgentDetails().subscribe({
      next: (res) => {
        this.isAgentsLoading.set(false);
        if (res.success) {
          const filtered = (res.data || []).filter(
            (a: any) => a.agent_type_id == 'TYPE_MASTER' && a.status === 'active'
          );
          this.agents.set(filtered);
        }
      },
      error: (err) => {
        this.isAgentsLoading.set(false);
        console.error('Error:', err);
      },
    });
  }

  selectedAgentName = computed(() => {
    if (!this.selectedAgent()) return '';
    const agent = this.agents().find((a: any) =>
      a.agent_id === this.selectedAgent() 
    );
    if (!agent) return '';
    const runCount = agent.run_count ?? 0;
    return runCount > 0 ? `${agent.name}` : agent.name;
  });

  filteredAgents = computed(() => {
    const list = this.agents();
    if (!list || list.length === 0) return [];
    const term = this.agentSearchText().toLowerCase().trim();
    if (!term) return list;
    return list.filter((a: any) =>
      (a.name || '').toLowerCase().includes(term) ||
      (a.agent_id || '').toLowerCase().includes(term)
    );
  });

  @ViewChild('agentSearchInput') agentSearchInputRef?: ElementRef;

  openAgentDropdown() {
    this.isAgentDropdownOpen.set(true);
    this.agentSearchText.set('');
    setTimeout(() => {
      this.agentSearchInputRef?.nativeElement?.focus();
    }, 50);
  }

  closeAgentDropdown() {
    this.isAgentDropdownOpen.set(false);
    this.agentSearchText.set('');
  }

  toggleAgentDropdown() {
    if (this.isAgentDropdownOpen()) {
      this.closeAgentDropdown();
    } else {
      this.openAgentDropdown();
    }
  }

  onAgentSearchInput(value: string) {
    this.agentSearchText.set(value);
  }

  clearAgentSearch() {
    this.agentSearchText.set('');
    this.agentSearchInputRef?.nativeElement?.focus();
  }

  selectAgent(agentId: string) {
    this.selectedAgent.set(agentId);
    const agent = this.agents().find((a: any) =>
      a.agent_id === agentId
    );
    this.selectedAgentObj.set(agent || null);
    this.closeAgentDropdown();
    this.onAgentChange();
  }

  getHighlightedName(name: string): string {
    const term = this.agentSearchText().trim();
    if (!term || !name) return name;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return name.replace(regex, '<mark>$1</mark>');
  }

  validateSimTextField(fieldKey: string, value: string) {
  if (value.trim() === '') {
    this.addInvalid(fieldKey, 'This field is required.');
  } else {
    this.removeFromInvalid(fieldKey);
  }
}

  validateSimField(fieldKey: string, value: string) {
    const trimmed = value.trim();
    if (trimmed === '') {
      this.removeFromInvalid(fieldKey);
      return;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      const msg = (e as Error).message;
      let errorMsg = 'Invalid JSON format';
      if (msg.includes('Unexpected token')) {
        const match = msg.match(/position (\d+)/);
        errorMsg = match ? `Unexpected token at position ${match[1]}` : 'Unexpected token found';
      } else if (msg.includes('Expected')) {
        errorMsg = msg.length > 60 ? msg.substring(0, 60) + '...' : msg;
      }
      this.addInvalid(fieldKey, errorMsg);
      return;
    }

    if (!Array.isArray(parsed)) {
      this.addInvalid(fieldKey, 'JSON must be an array of objects.');
      return;
    }

    if (parsed.length === 0) {
      this.addInvalid(fieldKey, 'Array must contain at least one object.');
      return;
    }

    this.removeFromInvalid(fieldKey);
  }

  onSimTurnsChange(value: any) {
    // Allow empty without error
    if (value === '' || value === null || value === undefined) {
      this.removeFromInvalid('sim-turns');
      this.simTurns.set(0);
      return;
    }
    const num = Number(value);
    if (isNaN(num) || num < 0 || num > 50 || !Number.isInteger(num)) {
      this.addInvalid('sim-turns', 'Must be a whole number between 0 and 50.');
      this.simTurns.set(num);          // store parsed so buttons still work
    } else {
      this.removeFromInvalid('sim-turns');
      this.simTurns.set(num);
    }
  }

  incrementTurns() {
    const current = parseInt(String(this.simTurns()), 10) || 0;
    if (current < 50) {
      const next = current + 1;
      this.simTurns.set(next);
      this.removeFromInvalid('sim-turns');
      this.syncTurnsInput(next);
    }
  }

  decrementTurns() {
    const current = parseInt(String(this.simTurns()), 10) || 0;
    if (current > 0) {
      const next = current - 1;
      this.simTurns.set(next);
      this.removeFromInvalid('sim-turns');
      this.syncTurnsInput(next);
    }
  }

  syncTurnsInput(value: number) {
    const input = document.getElementById('sim-turns') as HTMLInputElement;
    if (input) {
      input.value = String(value);
    }
  }

  toDateKey(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private formatDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[date.getMonth()]} ${y}`;
}

  private formatTime(date: Date): string {
    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    };
    return date.toLocaleTimeString('en-US', options);
  }

  extractDefinitionsFromMetrics(metrics: any): Record<string, string> {
    const defs: Record<string, string> = {};
    if (!metrics || typeof metrics !== 'object') return defs;

    for (const [key, val] of Object.entries(metrics)) {
      if (val && typeof val === 'object' && 'definition' in val) {
        const def = (val as any).definition;
        if (def && typeof def === 'string' && def.trim().length > 0) {
          // Strip "/mean" suffix if present, keep bare key as-is
          const cleanKey = key.replace(/\/mean$/, '');
          defs[cleanKey] = def.trim();
        }
      } else if (typeof val === 'string' && val.trim().length > 0) {
        // Flat format: "correctness": "Measures how factually accurate..."
        defs[key] = val.trim();
      }
    }
    return defs;
  }

  private extractDefinitionsFromTopLevel(evalData: any): Record<string, string> {
    const defs: Record<string, string> = {};
    const md = evalData.metric_definitions;
    if (!md || typeof md !== 'object') return defs;

    for (const [key, val] of Object.entries(md)) {
      if (typeof val === 'string' && val.trim().length > 0) {
        defs[key] = val.trim();
      }
    }
    return defs;
  }

  mergeDefinitions(newDefs: Record<string, string>) {
    this.metricDefinitions.update(existing => {
      const merged = { ...existing };
      for (const [key, val] of Object.entries(newDefs)) {
        if (val && val.trim()) {
          merged[key] = val.trim();
        }
      }
      return merged;
    });
  }

  getMetricDefinition(metricKey: string): string {
    return this.metricDefinitions()[metricKey] || '';
  }

  fetchHistory(): void {
    if (!this.selectedAgent() || !this.selectedEvalType() || !this.selectedDataSet()) {
      return;
    }

    const request: FetchEvalRequest = {
      agent_id: this.apiAgentId(),
      evaluation_type: this.selectedEvalType(),
      data_set: this.selectedDataSet(),
    };

    this.isFetchingHistory.set(true);
    this.evaluatingDateKey.set(null); 
    this.evalError.set(null);
    this.noTracesError.set(null); 

    this._evalService.fetchEvaluationData(request).subscribe({
      next: (res) => {
        this.isFetchingHistory.set(false);
        this.evaluatingDateKey.set(null); 
        if (res.success && res.data) {
          const results = this.mapFetchedToResults(res.data);
          this.setSortedGroups(this.groupResultsByDate(results));
          const groups = this.dateGroups();
          if (groups.length > 0) {
            this.activeDateKey.set(groups[0].dateKey);
          }
        } else {
          this.setSortedGroups([]);
          this.activeDateKey.set(null);
          this.noTracesError.set(null);
        }
      },
      error: (err: any) => {
        this.isFetchingHistory.set(false);
        this.evaluatingDateKey.set(null); 
        this.setSortedGroups([]);
        this.activeDateKey.set(null);
        this.noTracesError.set(null);
        console.warn('Failed to fetch evaluation history:', err);
      },
    });
  }

  extractStatusFromRow(row: any, key: string): 'PASS' | 'FAIL' {
    let num: number | null = null;

    // Path 1: row.metrics with /mean suffix
    if (row.metrics && typeof row.metrics === 'object') {
      const meanKey = `${key}/mean`;
      const meanObj = row.metrics[meanKey];
      if (meanObj && typeof meanObj === 'object' && meanObj.value !== undefined) {
        num = this.parseToNumber(meanObj.value);
      }
      // Also try without /mean
      if (num === null) {
        const directObj = row.metrics[key];
        if (directObj && typeof directObj === 'object' && directObj.value !== undefined) {
          num = this.parseToNumber(directObj.value);
        }
      }
    }

    // Path 2: detailed_results[0]["status/value"]
    if (num === null) {
      const dr = row.detailed_results;
      if (dr && Array.isArray(dr) && dr.length > 0) {
        const val = dr[0][`${key}/value`] ?? null;
        if (val !== null && val !== undefined) {
          num = this.parseToNumberWithFraction(val);
        }
      }
    }

    if (num === null) return 'FAIL';

    // Strictly 1 = PASS, anything else = FAIL
    return num === 1 ? 'PASS' : 'FAIL';
  }

extractScore(row: any, key: string): number {
  // Path 1: row.metrics with /mean suffix
  if (row.metrics && typeof row.metrics === 'object') {
    const meanKey = `${key}/mean`;
    const meanObj = row.metrics[meanKey];
    if (meanObj && typeof meanObj === 'object' && meanObj.value !== undefined) {
      return this.parseToNumberClamped(meanObj.value);
    }
    // Also try without /mean
    const directObj = row.metrics[key];
    if (directObj && typeof directObj === 'object' && directObj.value !== undefined) {
      return this.parseToNumberClamped(directObj.value);
    }
  }

  // Path 2: detailed_results[0]["correctness/value"]
  const dr = row.detailed_results;
  if (dr && Array.isArray(dr) && dr.length > 0) {
    const val = dr[0][`${key}/value`] ?? null;
    if (val !== null && val !== undefined) {
      return this.parseToNumberClampedWithFraction(val);
    }
  }

  return 0;
}

  private parseToNumber(raw: any): number | null {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) return parsed;
    }
    return null;
  }

  private parseToNumberWithFraction(raw: any): number | null {
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const fractionMatch = raw.match(/^([\d.]+)\s*\/\s*([\d.]+)$/);
      if (fractionMatch) {
        const numVal = parseFloat(fractionMatch[1]);
        const denVal = parseFloat(fractionMatch[2]);
        if (denVal > 0) return numVal / denVal;
        return null;
      }
      const parsed = parseFloat(raw);
      if (!isNaN(parsed)) return parsed;
    }
    return null;
  }

  private parseToNumberClamped(raw: any): number {
    if (raw === null || raw === undefined || raw === 'NaN') return 0;
    const num = this.parseToNumber(raw);
    if (num === null) return 0;
    return Math.min(1, Math.max(0, +num.toFixed(2)));
  }

  private parseToNumberClampedWithFraction(raw: any): number {
    if (raw === null || raw === undefined || raw === 'NaN') return 0;
    const num = this.parseToNumberWithFraction(raw);
    if (num === null) return 0;
    return Math.min(1, Math.max(0, +num.toFixed(2)));
  }


  mapFetchedToResults(data: any): EvalResult[] {
  let evaluations: any[] = [];

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    if (data.status === 'failed') {
      if (this.isEvaluateAction() && data.error) {
        this.noTracesError.set(data.error);
      }
      return [];
    }
  }

  if (Array.isArray(data)) {
    evaluations = data;
  } else if (data?.evaluations && Array.isArray(data.evaluations)) {
    evaluations = data.evaluations;
  } else if (data?.data && Array.isArray(data.data)) {
    evaluations = data.data;
  } else if (typeof data === 'object' && data !== null) {
    if (data.individual_metrics) {
      evaluations = [data];
    }
  }

  if (evaluations.length === 0) {
    return [];
  }

  // Reset definitions before re-building from history
  this.metricDefinitions.set({});

  const allResults: EvalResult[] = [];

  for (const evalData of evaluations) {
    if (evalData.status === 'failed') {
      if (this.isEvaluateAction() && evalData.error) {
        this.noTracesError.set(evalData.error);
      }
      continue;
    }

    // ── Extract definitions from top-level metric_definitions field ──
    this.mergeDefinitions(this.extractDefinitionsFromTopLevel(evalData));

    // ── Extract definitions from individual_metrics ──
    const indivMetrics = evalData.individual_metrics || [];
    if (indivMetrics.length > 0) {
      if (indivMetrics[0]?.metrics) {
        this.mergeDefinitions(this.extractDefinitionsFromMetrics(indivMetrics[0].metrics));
      }
      const dr = indivMetrics[0]?.detailed_results;
      if (dr && Array.isArray(dr) && dr.length > 0) {
        this.mergeDefinitions(this.extractDefinitionsFromMetrics(dr[0]));
      }
    }

    const evalDate = new Date(
      evalData.evaluated_at || evalData.created_at || evalData.timestamp || Date.now()
    );
    const dateStr = this.toDateKey(evalDate);
    const time = this.formatTime(evalDate);
    const timestamp = evalDate.getTime();
    const runId = evalData.evaluation_id || this.generateId();

    if (indivMetrics.length > 0) {
      const individualResults = this.mapSingleEvalToResults(evalData).map((r) => ({
        ...r,
        runId,
        testCaseId: r.testCaseId || evalData.case_id || evalData.evaluation_id?.slice(-6).toUpperCase(),
        dateStr,
        time,
        timestamp,
        detailed_results: r.detailed_results || evalData.individual_metrics?.[0]?.detailed_results || [],
        agentConfig: evalData.agent_config || {}
      }));
      allResults.push(...individualResults);
    }
  }

  return allResults;
}

  private emptyRationaleMap(): RationaleMap {
    return {
      correctness: '',
      coherence: '',
      relevance: '',
      conciseness: '',
      completeness: '',
      fluency: '',
      hallucinationRate: '',
      toxicityScore: '',
      safety: '',
      average: '',
      status: '',
    };
  }

  private rationaleKeyToApi(key: keyof RationaleMap): string {
    switch (key) {
      case 'average': return 'average';
      case 'hallucinationRate': return 'hallucination_rate';
      case 'toxicityScore': return 'toxicity_score';
      default: return key as string;
    }
  }

  extractFetchedRationales(evalData: any): RationaleMap {
    const empty = this.emptyRationaleMap();

    // ── Source 1: individual_metrics → detailed_results → assessments ──
    const detailed = evalData.individual_metrics || evalData.detailed_results || evalData.results || [];

    if (detailed.length > 0) {
      const allAssessments: any[] = [];
      for (const row of detailed) {
        const rowAssessments =
          row.detailed_results?.[0]?.assessments ||
          row.assessments ||
          row.metrics?.assessments ||
          [];
        allAssessments.push(...rowAssessments);
      }

      if (allAssessments.length > 0) {
        const result: RationaleMap = { ...empty };
        const keys = Object.keys(empty) as (keyof RationaleMap)[];
        for (const key of keys) {
          const apiName = this.rationaleKeyToApi(key);
          const match = allAssessments.find(
            (a: any) =>
              a.assessment_name === apiName ||
              a.assessment_name === `${apiName}/mean` ||
              a.name === apiName
          );
          if (match?.rationale) {
            result[key] = this.truncateRationale(match.rationale);
          }
        }
        const foundAny = (Object.values(result) as string[]).some((v) => v !== '');
        if (foundAny) return result;
      }
    }

    // ── Source 2: individual_metrics → metrics with rationale sub-keys ──
    if (detailed.length > 0) {
      const result: RationaleMap = { ...empty };
      const keys = Object.keys(empty) as (keyof RationaleMap)[];

      for (const key of keys) {
        const targetKey = this.rationaleKeyToApi(key);
        const rationalePatterns = [
          `${targetKey}/rationale`,
          `${targetKey}_rationale`,
          `${targetKey}/reason`,
          `${targetKey}_reason`,
          `${targetKey}/explanation`,
          `${targetKey}_explanation`,
        ];

        for (const row of detailed) {
          const rowMetrics = row.metrics || {};
          for (const pattern of rationalePatterns) {
            const meanPattern = `${pattern}/mean`;
            const val = rowMetrics[meanPattern] ?? rowMetrics[pattern];
            if (val && typeof val === 'string') {
              result[key] = this.truncateRationale(val);
              break;
            }
            if (val && typeof val === 'object' && val.value && typeof val.value === 'string') {
              result[key] = this.truncateRationale(val.value);
              break;
            }
          }
          if (result[key]) break;
        }
      }

      const foundAny = (Object.values(result) as string[]).some((v) => v !== '');
      if (foundAny) return result;
    }

    // ── Source 3: Top-level rationale fields on evalData (not aggregate_metrics) ──
    const topPatterns = [
      'rationale', 'evaluation_rationale', 'summary',
      'assessment_rationale', 'overall_rationale',
    ];
    for (const p of topPatterns) {
      if (evalData[p] && typeof evalData[p] === 'string') {
        const r = this.truncateRationale(evalData[p]);
        const filled: RationaleMap = { ...empty };
        const keys = Object.keys(empty) as (keyof RationaleMap)[];
        for (const key of keys) {
          filled[key] = r;
        }
        return filled;
      }
    }

    return empty;
  }

  private truncateRationale(text: string, maxLen: number = 500): string {
    if (!text) return '';
    const cleaned = text.replace(/\n+/g, ' ').trim();
    if (cleaned.length <= maxLen) return cleaned;
    return cleaned;
  }


  private buildDataSummary(dataArray: any[], field: 'input' | 'expectation' | 'output'): string {
    if (!dataArray || dataArray.length === 0) return '-';

    const keyPriority: Record<string, string[]> = {
      input: ['Input', 'input', 'inputs'],
      expectation: ['Expectation', 'expectation', 'expectations'],
      output: ['Output', 'output', 'outputs'],
    };

    const keys = keyPriority[field];

    if (dataArray.length === 1) {
      const raw = this.extractFieldValue(dataArray[0], keys);
      return this.toDisplayString(raw);
    }

    const firstRaw = this.extractFieldValue(dataArray[0], keys);
    const display = this.toDisplayString(firstRaw);
    return `${display}  (+${dataArray.length - 1} more)`;
  }

  private extractFieldValue(item: any, keys: string[]): any {
    if (!item) return '';
    for (const k of keys) {
      if (item[k] !== undefined && item[k] !== null) {
        return item[k];
      }
    }
    return '';
  }

  private toDisplayString(val: any): string {
    if (val === null || val === undefined) return '-';
    if (typeof val === 'string') return val;
    try {
      const str = JSON.stringify(val, null, 0);
      return str.length > 300 ? str.substring(0, 300) + '...' : str;
    } catch {
      return String(val);
    }
  }

private extractTimeFromId(testCaseId: string): number {
  const match = testCaseId.match(/-(\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    const hours = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    const secs = parseInt(match[3], 10);
    return (hours * 3600) + (mins * 60) + secs;
  }
  return 0;
}

  private groupResultsByDate(results: EvalResult[]): DateGroup[] {
  const map = new Map<string, EvalResult[]>();

  for (const r of results) {
    const key = r.dateStr;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(r);
  }

  const groups: DateGroup[] = [];
  for (const [key, items] of map) {
    groups.push({
      dateKey: key,
      dateLabel: this.formatDateLabel(key),
      results: items,
    });
  }

  groups.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  for (const g of groups) {
    g.results.sort((a, b) => {
      if (b.timestamp !== a.timestamp) {
        return b.timestamp - a.timestamp;
      }
      // Tiebreaker: parse HH:MM:SS from the ID itself
      const timeA = this.extractTimeFromId(a.testCaseId);
      const timeB = this.extractTimeFromId(b.testCaseId);
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      // Final fallback: reverse alpha
      return b.testCaseId.localeCompare(a.testCaseId);
    });
  }

  return groups;
}

private extractInputOutputFromTraceData(evalData: any, index: number): { input: any; output: any } {
  const traceDataArr = evalData.trace_data;
  if (!traceDataArr || !Array.isArray(traceDataArr) || traceDataArr.length === 0) {
    return { input: '', output: '' };
  }

  const traceItem = traceDataArr[Math.min(index, traceDataArr.length - 1)];
  const spans = traceItem?.spans;

  if (!spans || !Array.isArray(spans) || spans.length === 0) {
    return { input: '', output: '' };
  }

  // Find the span whose SpanAttributes contain BOTH agent_id and agent_name
  const targetSpan = spans.find((span: any) => {
    const attrs = span.SpanAttributes || span.spanAttributes || span.span_attributes || {};
    return attrs.agent_id && attrs.agent_name;
  });

  if (!targetSpan) {
    return { input: '', output: '' };
  }

  const attrs = targetSpan.SpanAttributes || targetSpan.spanAttributes || targetSpan.span_attributes || {};
  return {
    input: attrs.input || '',
    output: attrs.output || '',
  };
}

  private mapSingleEvalToResults(evalData: any): EvalResult[] {
  const detailed =
    evalData.individual_metrics ||
    evalData.detailed_results ||
    evalData.results ||
    [];

  if (!detailed || detailed.length === 0) return [];

  return detailed.map((row: any, index: number) => {
    // Scores (unchanged)
    const correctness = this.extractScore(row, 'correctness');
    const coherence = this.extractScore(row, 'coherence');
    const relevance = this.extractScore(row, 'relevance');
    const conciseness = this.extractScore(row, 'conciseness');
    const completeness = this.extractScore(row, 'completeness');
    const fluency = this.extractScore(row, 'fluency');
    const hallucinationRate = this.extractScore(row, 'hallucination_rate');
    const toxicityScore = this.extractScore(row, 'toxicity_score');
    const safety = this.extractScore(row, 'safety');
    const average = this.extractScore(row, 'average');

    const status = this.extractStatusFromRow(row, 'status');

    let inputRaw: any = '';
    let expectedRaw: any = '';
    let actualRaw: any = '';

    // ====================== ONLINE TRACE CASES (Unified) ======================
    const isOnlineTrace = 
      (evalData.evaluation_method === 'Config + Trace Data' ||
       evalData.data_set === 'Config + Trace Data' ||
       evalData.evaluation_method === 'Trace-Based Evaluation' ||
       evalData.data_set === 'Trace-Based Evaluation') &&
      evalData.evaluation_type === 'Online';

    if (isOnlineTrace) {
      // === INPUT: Prefer user_query from individual_metrics ===
      if (row.input?.user_query) {
        inputRaw = row.input.user_query;
      } else if (row.input) {
        inputRaw = row.input;
      }

      // === ACTUAL OUTPUT: Look for inference span ===
      let fullTrace = row.input?.full_trace || 
                     row.full_trace || row.input?.trace_data ||
                     row.detailed_results?.[0]?.full_trace;

      if (fullTrace?.spans && Array.isArray(fullTrace.spans)) {
        const inferenceSpan = fullTrace.spans.find((span: any) => 
          span.SpanName === 'inference' || 
          span.span_name === 'inference' ||
          span.SpanAttributes?.output
        );

        if (inferenceSpan?.SpanAttributes) {
          const attrs = inferenceSpan.SpanAttributes;
          actualRaw = attrs.output || 
                     attrs.llm_output || 
                     attrs.response || 
                     attrs.content || 
                     '';
        }
      }

      // Fallback if not found
      if (!actualRaw && row.output) actualRaw = row.output;

      // === EXPECTED OUTPUT ===
      if (row.expected_output) {
        expectedRaw = row.expected_output;
      } else if (evalData.expected_output?.[index]) {
        expectedRaw = evalData.expected_output[index];
      }
    } 
    // ====================== REGULAR / OFFLINE TRACE ======================
    else if (evalData.trace_data) {
      const traceResult = this.extractInputOutputFromTraceData(evalData, index);
      inputRaw = traceResult.input || inputRaw;
      actualRaw = traceResult.output || actualRaw;

      if (row.expected_output) {
        expectedRaw = row.expected_output;
      } else if (evalData.expected_output?.[index]) {
        expectedRaw = evalData.expected_output[index];
      }
    } 
    // ====================== SIMULATION & I/O ======================
    else {
      const isSimBased = 
        evalData.evaluation_method === 'Simulation-Based' ||
        evalData.data_set === 'Simulation Data';

      if (isSimBased) {
        const simResult = this.extractSimInputOutputFromSpans(row);
        inputRaw = simResult.input || inputRaw;
        actualRaw = simResult.output || actualRaw;
        expectedRaw = simResult.expected || expectedRaw;
      } else {
        // Standard I/O fallback
        const inputItem = evalData.input_data?.[index];
        const outputItem = evalData.output_data?.[index];

        if (inputItem) {
          inputRaw = this.extractFieldValue(inputItem, ['Input', 'input', 'inputs', 'user_query']);
          expectedRaw = this.extractFieldValue(inputItem, ['Expectation', 'expectation', 'expectations']);
        }

        if (outputItem) {
          actualRaw = this.extractFieldValue(outputItem, ['Output', 'output', 'outputs']);
        }

        if (!inputRaw && row.input) {
          if (typeof row.input === 'object' && row.input !== null && row.input.user_query) {
            inputRaw = row.input.user_query;
          } else {
            inputRaw = row.input;
          }
        }
        if (!actualRaw && row.output) actualRaw = row.output;
        if (!expectedRaw && row.expected_output) expectedRaw = row.expected_output;
      }
    }

    // Rationales (unchanged)
    const assessments = row.detailed_results?.[0]?.assessments || row.assessments || [];
    const getRationale = (name: string): string => {
      const a = assessments.find((x: any) => x.assessment_name === name);
      return a?.rationale || '';
    };

    return {
      runId: '',
      testCaseId: row.case_id || `${String(index + 1).padStart(3, '0')}`,
      time: '',
      dateStr: '',
      timestamp: 0,
      input: this.toDisplayString(inputRaw),
      expectedOutput: this.toDisplayString(expectedRaw),
      actualOutput: this.toDisplayString(actualRaw),
      status,
      correctness,
      coherence,
      relevance,
      conciseness,
      completeness,
      fluency,
      hallucinationRate,
      toxicityScore,
      safety,
      average,
      totalTests: 1,
      correctnessRationale: getRationale('correctness'),
      coherenceRationale: getRationale('coherence'),
      relevanceRationale: getRationale('relevance'),
      concisenessRationale: getRationale('conciseness'),
      completenessRationale: getRationale('completeness'),
      fluencyRationale: getRationale('fluency'),
      hallucinationRateRationale: getRationale('hallucination_rate'),
      toxicityScoreRationale: getRationale('toxicity_score'),
      safetyRationale: getRationale('safety'),
      averageRationale: getRationale('average'),
      statusRationale: getRationale('status'),
      detailed_results: row.detailed_results || [],
      agentConfig: evalData.agent_config || {}
    };
  });
}

  private addInvalid(key: string, message: string) {
    this.invalidFields.update((map) => {
      const newMap = new Map(map);
      newMap.set(key, message);
      return newMap;
    });
  }

  private removeFromInvalid(key: string) {
    this.invalidFields.update((map) => {
      const newMap = new Map(map);
      newMap.delete(key);
      return newMap;
    });
  }

  isFieldInvalid(key: string): boolean {
    return this.invalidFields().has(key);
  }

  getJsonError(key: string): string {
    return this.invalidFields().get(key) || '';
  }

formatJsonField(fieldId: string) {
  const textarea = document.getElementById(fieldId) as HTMLTextAreaElement;
  if (!textarea) return;

  let content = textarea.value.trim();
  if (!content) return;

  let formatted: string;

  try {
    const parsed = JSON.parse(content);
    formatted = JSON.stringify(parsed, null, 2);
  } catch (e) {
    const smartFormatted = this.smartFormatJsonContent(content);
    formatted = smartFormatted || this.fallbackFormat(content);
  }

  // Update DOM
  textarea.value = formatted;

  // CRITICAL: Update Angular model + trigger validation
  this.triggerModelUpdate(fieldId, formatted);

  // Force validation after model update
  setTimeout(() => {
    this.forceValidateField(fieldId, formatted);
  }, 50);   // Increased delay for Angular digest cycle
}

private forceValidateField(fieldId: string, value: string) {
  const parts = fieldId.split('-');
  const type = parts[0];
  const id = parts.slice(1).join('-');

  if (type === 'input') {
    // "Input" is required, "Expectation" is optional
    this.validateJson(value, `input-${id}`, ['Input'], false, undefined, ['Expectation']);
  } 
  else if (type === 'output') {
    this.validateJson(value, `output-${id}`, ['Output']);
  } 
  else if (type === 'expected-trace') {
    this.validateJson(value, `expected-trace-${id}`, ['Expectation']);
  } 
  else if (type === 'trace') {
    this.validateJson(value, `trace-${id}`, undefined, false, ['span_count']);
  }
}

private triggerModelUpdate(fieldId: string, newValue: string) {
  const parts = fieldId.split('-');
  const type = parts[0];
  const id = parts.slice(1).join('-');

  if (type === 'input') {
    this.updateInput(id, newValue);
  } else if (type === 'output') {
    this.updateOutput(id, newValue);
  } else if (type === 'trace') {
    this.updateTraceData(id, newValue);
  } else if (type === 'expected-trace') {
    this.updateTraceExpectedOutput(id, newValue);   // Make sure this exists and calls validate
  }
}

private smartFormatJsonContent(content: string): string | null {
  try {
    let cleaned = content.replace(/\r\n?/g, '\n');

    cleaned = cleaned.replace(
      /("[\w\s-]+?")\s*:\s*("[\s\S]*?")(?=\s*[,}\]]|$)/g,
      (match, key, value) => {
        let inner = value.slice(1, -1)
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n');
        return `${key}: "${inner}"`;
      }
    );

    const parsed = JSON.parse(cleaned);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

private fallbackFormat(content: string): string {
  // This is useful when the user pastes plain text (not JSON structure)
  let formatted = content
    .replace(/\r\n?/g, '\n')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');

  // Try to wrap it as a simple JSON if it looks like plain text
  if (!formatted.startsWith('{') && !formatted.startsWith('[')) {
    return JSON.stringify({ content: formatted }, null, 2);
  }

  return formatted;
}

  private getMultipleDataMessage(fieldKey: string, keyName: string): string {
    if (fieldKey.startsWith('input-')) {
      return `Each field accepts a single Input data. To provide multiple inputs, click "Add Input/Output Data" below.`;
    }
    if (fieldKey.startsWith('output-')) {
      return `Each field accepts a single Output data. To provide multiple outputs, click "Add Input/Output Data" below.`;
    }
    if (fieldKey.startsWith('trace-')) {
      return `Each field accepts a single trace data. To provide additional trace data, click "Add Trace Data" below.`;
    }
    if (fieldKey.startsWith('expected-trace-')) {
      return `Each field accepts a single expected data. To provide multiple entries, click "Add Trace Data" below.`;
    }
    return `Only one "${keyName}" entry is allowed per field. To provide more data, add a new field using the button below.`;
  }

  private getArrayNotAllowedMessage(fieldKey: string): string {
    if (fieldKey.startsWith('input-') || fieldKey.startsWith('output-')) {
      return 'Each field accepts a single Input/Output data. To provide multiple entries, click "Add Input/Output Data" below.';
    }
    if (fieldKey.startsWith('trace-') || fieldKey.startsWith('expected-trace-')) {
      return 'Each field accepts a single trace data. To provide multiple trace entries, click "Add Trace Data" below.';
    }
    return 'Each field accepts a single Input/Output data. To provide more data, add a new field using the button below.';
  }

    validateJson(
  value: string,
  fieldKey: string,
  requiredKeys?: string[],
  skipDuplicateCheck: boolean = false,
  exactOneKeys?: string[],
  optionalKeys?: string[]  // NEW PARAMETER
): boolean {
  const trimmed = value.trim();
  if (trimmed === '') {
    this.removeFromInvalid(fieldKey);
    return true;
  }

  // ── Duplicate key check ──
  if (!skipDuplicateCheck) {
    const keyRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/g;
    const foundKeys: string[] = [];
    let match;

    while ((match = keyRegex.exec(trimmed)) !== null) {
      foundKeys.push(match[1]);
    }

    // Check exactOneKeys — must appear exactly once
    if (exactOneKeys && exactOneKeys.length > 0) {
      for (const exactKey of exactOneKeys) {
        const lowerExactKey = exactKey.toLowerCase();
        const matches = foundKeys.filter((k) => k.toLowerCase() === lowerExactKey);

        if (matches.length > 1) {
          this.addInvalid(fieldKey, this.getMultipleDataMessage(fieldKey, exactKey));
          return false;
        }
        if (matches.length === 0) {
          this.addInvalid(fieldKey, `Missing required key: "${exactKey}"`);
          return false;
        }
      }
    } else {
      // No exactOneKeys — check requiredKeys for duplicates
      if (requiredKeys && requiredKeys.length > 0) {
        for (const reqKey of requiredKeys) {
          const lowerReqKey = reqKey.toLowerCase();
          const matches = foundKeys.filter((k) => k.toLowerCase() === lowerReqKey);
          if (matches.length > 1) {
            this.addInvalid(fieldKey, this.getMultipleDataMessage(fieldKey, reqKey));
            return false;
          }
        }
        // Also check optional keys for duplicates
        if (optionalKeys && optionalKeys.length > 0) {
          for (const optKey of optionalKeys) {
            const lowerOptKey = optKey.toLowerCase();
            const matches = foundKeys.filter((k) => k.toLowerCase() === lowerOptKey);
            if (matches.length > 1) {
              this.addInvalid(fieldKey, this.getMultipleDataMessage(fieldKey, optKey));
              return false;
            }
          }
        }
      }

      // Check all other keys for duplicates (excluding required and optional)
      const allowedKeys = [
        ...(requiredKeys || []),
        ...(optionalKeys || [])
      ].map(k => k.toLowerCase());
      
      const keyCounts = new Map<string, number>();
      for (const key of foundKeys) {
        const lowerKey = key.toLowerCase();
        keyCounts.set(lowerKey, (keyCounts.get(lowerKey) || 0) + 1);
      }

      for (const [lowerKey, count] of keyCounts) {
        if (count > 1 && !allowedKeys.includes(lowerKey)) {
          const originalKey = foundKeys.find((k) => k.toLowerCase() === lowerKey) || lowerKey;
          this.addInvalid(fieldKey, this.getMultipleDataMessage(fieldKey, originalKey));
          return false;
        }
      }
    }
  }

  // ── JSON parsing ──
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    const msg = (e as Error).message;
    let errorMsg = 'Invalid JSON format';
    if (msg.includes('Unexpected token')) {
      const match = msg.match(/position (\d+)/);
      errorMsg = match ? `Unexpected token at position ${match[1]}` : 'Unexpected token found';
    } else if (msg.includes('Expected')) {
      errorMsg = msg.length > 60 ? msg.substring(0, 60) + '...' : msg;
    }
    this.addInvalid(fieldKey, errorMsg);
    return false;
  }

  // ── Array check ──
  if (Array.isArray(parsed)) {
    this.addInvalid(fieldKey, this.getArrayNotAllowedMessage(fieldKey));
    return false;
  }

  // ── Validate requiredKeys exist ──
  if (requiredKeys && requiredKeys.length > 0) {
    if (typeof parsed === 'object' && parsed !== null) {
      const originalKeys = Object.keys(parsed);

      for (const reqKey of requiredKeys) {
        const lowerReqKey = reqKey.toLowerCase();
        const matchingKeys = originalKeys.filter((k) => k.toLowerCase() === lowerReqKey);
        if (matchingKeys.length === 0) {
          this.addInvalid(fieldKey, `Missing required key: "${reqKey}"`);
          return false;
        }
      }

      // UPDATED: Check for unexpected keys (excluding optional keys)
      const allowedKeysLower = [
        ...(requiredKeys || []),
        ...(optionalKeys || [])
      ].map(k => k.toLowerCase());

      const extraKeys = originalKeys.filter((k) => {
        return !allowedKeysLower.includes(k.toLowerCase());
      });

      if (extraKeys.length > 0) {
        const allowedKeysStr = [
          ...requiredKeys,
          ...(optionalKeys || []).map(k => `${k} (optional)`)
        ].join('", "');
        const extraKeysStr = extraKeys.join('", "');

        if (extraKeys.length === 1) {
          this.addInvalid(fieldKey, `Unexpected key "${extraKeys[0]}" found. Only "${allowedKeysStr}" are allowed.`);
        } else {
          this.addInvalid(fieldKey, `Unexpected keys "${extraKeysStr}" found. Only "${allowedKeysStr}" are allowed.`);
        }
        return false;
      }
    } else {
      this.addInvalid(fieldKey, 'JSON must be an object containing the required keys.');
      return false;
    }
  }

  // ── Validate exactOneKeys exist at parsed level ──
  if (exactOneKeys && exactOneKeys.length > 0) {
    if (typeof parsed === 'object' && parsed !== null) {
      const originalKeys = Object.keys(parsed);
      for (const exactKey of exactOneKeys) {
        const lowerExactKey = exactKey.toLowerCase();
        const matchingKeys = originalKeys.filter((k) => k.toLowerCase() === lowerExactKey);
        if (matchingKeys.length === 0) {
          this.addInvalid(fieldKey, `Missing required key: "${exactKey}"`);
          return false;
        }
      }
    } else {
      this.addInvalid(fieldKey, 'JSON must be an object containing the required keys.');
      return false;
    }
  }

  this.removeFromInvalid(fieldKey);
  return true;
}

  toggleCellExpand(key: string) {
    this.expandedCells.update((set) => {
      const newSet = new Set(set);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  }

  isCellExpanded(key: string): boolean {
    return this.expandedCells().has(key);
  }

  toggleDateGroup(dateKey: string) {
    this.activeDateKey.update((k) => (k === dateKey ? null : dateKey));
  }

  isDateGroupExpanded(dateKey: string): boolean {
    return this.activeDateKey() === dateKey;
  }

  getDateGroupSummary(
    group: DateGroup
  ): { total: number; passed: number; failed: number; passRate: number; latestTime: string } {
    const total = group.results.length;
    const passed = group.results.filter((r) => r.status === 'PASS').length;
    const failed = total - passed;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    // Results are sorted by timestamp descending, so first result = latest time
    const latestTime = group.results.length > 0 ? group.results[0].time : '';

    return { total, passed, failed, passRate, latestTime };
  }

private setSortedGroups(groups: DateGroup[]): void {
  this.dateGroups.set(this.sortDateGroups(groups));
}

private updateSortedGroups(updater: (groups: DateGroup[]) => DateGroup[]): void {
  this.dateGroups.update((groups: DateGroup[]) => this.sortDateGroups(updater(groups)));
}

  private sortDateGroups(groups: DateGroup[]): DateGroup[] {
  if (!groups || groups.length === 0) return [];

  return [...groups]
    // Sort date groups descending (newest date on top)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    // Sort results within each group descending by timestamp (latest case on top)
    .map(g => ({
      ...g,
      results: [...g.results].sort((a, b) => {
        if (b.timestamp !== a.timestamp) {
          return b.timestamp - a.timestamp;
        }
        // Tiebreaker: parse HH:MM:SS from the ID itself
        const timeA = this.extractTimeFromId(a.testCaseId);
        const timeB = this.extractTimeFromId(b.testCaseId);
        if (timeB !== timeA) {
          return timeB - timeA;
        }
        // Final fallback: reverse alpha
        return b.testCaseId.localeCompare(a.testCaseId);
      }),
    }));
}

  onAgentChange() {
    if (!this.selectedAgent()) {
      this.selectedEvalType.set('');
      this.selectedDataSet.set('');
    }
    this.isEvaluateAction.set(false);  
    this.noTracesError.set(null);      
    this.evalError.set(null);
    this.invalidFields.set(new Map());
    this.setSortedGroups([]);
    this.activeDateKey.set(null);
    this.metricDefinitions.set({});

    this.dataPairs.set([{ id: this.generateId(), input: '', output: '' }]);
    this.traceDataList.set([{ id: this.generateId(), content: '', expectedOutput: '' }]);
    this.simExpectedOutputs.set([{ id: this.generateId(), expectedOutput: '' }]);
    // Re-fetch history for the new combination
    if (this.selectedAgent() && this.selectedEvalType() && this.selectedDataSet()) {
      this.fetchHistory();
    }
  }

  onEvalTypeChange(value: string) {
    this.isEvaluateAction.set(false);  
    this.noTracesError.set(null);      
    this.selectedEvalType.set(value);
    this.selectedDataSet.set('');
    if (!value) {
      this.selectedDataSet.set('');
    }
    this.evalError.set(null);
    this.invalidFields.set(new Map());
    this.setSortedGroups([]);
    this.activeDateKey.set(null);
    this.metricDefinitions.set({});
    // Reset any uploaded/typed input data
    this.dataPairs.set([{ id: this.generateId(), input: '', output: '' }]);
    this.traceDataList.set([{ id: this.generateId(), content: '', expectedOutput: '' }]);
    this.simExpectedOutputs.set([{ id: this.generateId(), expectedOutput: '' }]);
    
    this.simScenarios.set('');
    this.simPersonas.set('');
    this.simTurns.set(1);

    // Re-fetch history for the new combination
    if (this.selectedAgent() && this.selectedEvalType() && this.selectedDataSet()) {
      this.fetchHistory();
    }
  }

  onDataSetChange() {
    this.isEvaluateAction.set(false);  
    this.noTracesError.set(null);      
    this.evalError.set(null);
    this.invalidFields.set(new Map());
    this.setSortedGroups([]);
    this.activeDateKey.set(null);
    this.metricDefinitions.set({});

    this.dataPairs.set([{ id: this.generateId(), input: '', output: '' }]);
    this.traceDataList.set([{ id: this.generateId(), content: '', expectedOutput: '' }]);
    this.simExpectedOutputs.set([{ id: this.generateId(), expectedOutput: '' }]);
    
    // Reset any uploaded/typed input data
    this.dataPairs.set([{ id: this.generateId(), input: '', output: '' }]);
    this.traceDataList.set([{ id: this.generateId(), content: '', expectedOutput: '' }]);
    // Reset simulation fields
    this.simScenarios.set('');
    this.simPersonas.set('');
    this.simTurns.set(1);

    this.fetchHistory();
  }

  addSimExpectedOutput() {
    this.simExpectedOutputs.update((list) => [...list, { id: this.generateId(), expectedOutput: '' }]);
  }

  removeSimExpectedOutput(id: string) {
    this.simExpectedOutputs.update((list) => {
      if (list.length <= 1) return list;
      return list.filter((t) => t.id !== id);
    });
    this.invalidFields.update((map) => {
      const newMap = new Map(map);
      newMap.delete(`sim-expected-${id}`);
      return newMap;
    });
  }

  updateSimExpectedOutput(id: string, value: string) {
    this.simExpectedOutputs.update((list) =>
      list.map((t) => (t.id === id ? { ...t, expectedOutput: value } : t))
    );
    this.validateJson(value, `sim-expected-${id}`, ['Expectation']);
  }

  onSimExpectedFileUpload(event: Event, id: string) {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      this.showToast('error', 'Please select a valid JSON file.');
      fileInput.value = '';
      return;
    }

    const fieldKey = `sim-expected-${id}`;
    this.setUploading(fieldKey, true);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        JSON.parse(content);
      } catch {
        this.setUploading(fieldKey, false);
        this.showToast('error', 'The selected file does not contain valid JSON.');
        return;
      }
      this.updateSimExpectedOutput(id, content);
      this.setUploading(fieldKey, false);
    };
    reader.onerror = () => {
      this.setUploading(fieldKey, false);
      this.showToast('error', 'Failed to read the file.');
    };
    reader.readAsText(file);
    fileInput.value = '';
  }

  addDataPair() {
    this.dataPairs.update((pairs) => [...pairs, { id: this.generateId(), input: '', output: '' }]);
  }

  removeDataPair(id: string) {
    this.dataPairs.update((pairs) => {
      if (pairs.length <= 1) return pairs;
      return pairs.filter((p) => p.id !== id);
    });
    this.invalidFields.update((map) => {
      const newMap = new Map(map);
      newMap.delete(`input-${id}`);
      newMap.delete(`output-${id}`);
      return newMap;
    });
  }

  updateInput(id: string, value: string) {
    this.dataPairs.update((pairs) =>
      pairs.map((p) => (p.id === id ? { ...p, input: value } : p))
    );
    // "Input" is required, "Expectation" is optional
    this.validateJson(value, `input-${id}`, ['Input'], false, undefined, ['Expectation']);
  }

  updateOutput(id: string, value: string) {
    this.dataPairs.update((pairs) => pairs.map((p) => (p.id === id ? { ...p, output: value } : p)));
    this.validateJson(value, `output-${id}`, ['Output']);
  }

  addTraceData() {
    this.traceDataList.update((list) => [...list, { id: this.generateId(), content: '', expectedOutput: '' }]);
  }

  removeTraceData(id: string) {
    this.traceDataList.update((list) => {
      if (list.length <= 1) return list;
      return list.filter((t) => t.id !== id);
    });
    this.invalidFields.update((map) => {
      const newMap = new Map(map);
      newMap.delete(`trace-${id}`);
      newMap.delete(`expected-trace-${id}`);
      return newMap;
    });
  }

  updateTraceExpectedOutput(id: string, value: string) {
    this.traceDataList.update((list) => list.map((t) => (t.id === id ? { ...t, expectedOutput: value } : t)));
    this.validateJson(value, `expected-trace-${id}`, ['Expectation']);
  }

  updateTraceData(id: string, value: string) {
  this.traceDataList.update((list) => list.map((t) => (t.id === id ? { ...t, content: value } : t)));
  // Validate: no duplicate keys, and "span_count" must appear exactly once
  this.validateJson(value, `trace-${id}`, undefined, false, ['span_count']);
}

  onTraceFileUpload(event: Event, id: string) {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      this.showToast('error', 'Please select a valid JSON file.');
      fileInput.value = '';
      return;
    }

    const fieldKey = `trace-${id}`;
    this.setUploading(fieldKey, true);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        JSON.parse(content);
      } catch {
        this.setUploading(fieldKey, false);
        this.showToast('error', 'The selected file does not contain valid JSON.');
        return;
      }
      this.updateTraceData(id, content);
      this.setUploading(fieldKey, false);
    };
    reader.onerror = () => {
      this.setUploading(fieldKey, false);
      this.showToast('error', 'Failed to read the file.');
    };
    reader.readAsText(file);
    fileInput.value = '';
  }

  onTraceExpectedFileUpload(event: Event, id: string) {
  const fileInput = event.target as HTMLInputElement;
  const file = fileInput.files?.[0];
  if (!file) return;

  if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
    this.showToast('error', 'Please select a valid JSON file.');
    fileInput.value = '';
    return;
  }

  const fieldKey = `expected-trace-${id}`;
  this.setUploading(fieldKey, true);

  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target?.result as string;
    try {
      JSON.parse(content);
    } catch {
      this.setUploading(fieldKey, false);
      this.showToast('error', 'The selected file does not contain valid JSON.');
      return;
    }
    this.updateTraceExpectedOutput(id, content);
    this.setUploading(fieldKey, false);
  };
  reader.onerror = () => {
    this.setUploading(fieldKey, false);
    this.showToast('error', 'Failed to read the file.');
  };
  reader.readAsText(file);
  fileInput.value = '';
}

  onFileUpload(event: Event, pairId: string, fieldType: 'input' | 'output') {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    this.uploadingFields.update((set) => {
      const newSet = new Set(set);
      newSet.add(`${fieldType}-${pairId}`);
      return newSet;
    });

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = (e.target?.result as string) || '';
      
      if (fieldType === 'input') {
        this.updateInput(pairId, content);
        // Validation is already called in updateInput with optional Expectation
      } else {
        this.updateOutput(pairId, content);
      }

      // Reset file input
      fileInput.value = '';
      
      this.uploadingFields.update((set) => {
        const newSet = new Set(set);
        newSet.delete(`${fieldType}-${pairId}`);
        return newSet;
      });
    };
    reader.readAsText(file);
  }

  isUploading(key: string): boolean {
    return this.uploadingFields().has(key);
  }

  setUploading(key: string, loading: boolean) {
    this.uploadingFields.update((set) => {
      const newSet = new Set(set);
      if (loading) {
        newSet.add(key);
      } else {
        newSet.delete(key);
      }
      return newSet;
    });
  }

  
  validateAllFields(): void {
    // Clear existing invalid fields
    this.invalidFields.set(new Map());

    // Validate agent selection
    if (!this.selectedAgent()) {
      this.addInvalid('agent', 'Please select an agent');
    }

    // Validate evaluation type
    if (!this.selectedEvalType()) {
      this.addInvalid('eval-type', 'Please select an evaluation type');
    }

    // Validate data set
    if (!this.selectedDataSet()) {
      this.addInvalid('data-set', 'Please select a data set');
    }

    // Validate based on scenario
    if (this.isConfigIoScenario()) {
      // Validate input/output data pairs
      for (const pair of this.dataPairs()) {
        this.validateJson(pair.input, `input-${pair.id}`, ['Input'], false, undefined, ['Expectation']);
        this.validateJson(pair.output, `output-${pair.id}`, ['Output']);
      }
    } else if (this.isSimulationBased()) {
      // Validate simulation fields
      this.validateSimTextField('sim-scenarios', this.simScenarios());
      this.validateSimTextField('sim-personas', this.simPersonas());
      
      if (this.simTurns() < 1) {
        this.addInvalid('sim-turns', 'Max turns must be at least 1');
      }
    } else if (this.isTraceData()) {
      // Validate trace data
      for (const trace of this.traceDataList()) {
        this.validateJson(trace.content, `trace-${trace.id}`, undefined, false, ['span_count']);
        if (trace.expectedOutput.trim()) {
          this.validateJson(trace.expectedOutput, `expected-trace-${trace.id}`, ['Expectation']);
        }
      }
    } else if (this.needsDataInput()) {
      // Validate input/output pairs
      for (const pair of this.dataPairs()) {
        this.validateJson(pair.input, `input-${pair.id}`, ['Input'], false, undefined, ['Expectation']);
        this.validateJson(pair.output, `output-${pair.id}`, ['Output']);
      }
    }
  }

  onEvaluate(): void {
  
  this.isEvaluateAction.set(true);  
  const todayKey = this.toDateKey(new Date());
  this.isEvaluating.set(true);
  this.evaluatingDateKey.set(todayKey);
  this.activeDateKey.set(todayKey);
  this.noTracesError.set(null);  

  // Validate all fields
  this.validateAllFields();
  if (this.hasInvalidFields()) {
    return;
  }

  // ── Base Payload ──
  const payload: any = {
    agent_id: this.apiAgentId(),
    evaluation_type: this.selectedEvalType(),
    created_by: this._stateService.getLoginDetails()?.Email || '',
  };

// Replace the existing dateRange block with this:
const dateRangeVal = this.dateRange();
if (dateRangeVal && dateRangeVal.length === 2) {
  const start = dateRangeVal[0];
  const end = dateRangeVal[1];

   // Format: YYYY-MM-DDT00:00:00Z (12:00 AM of start date)
  payload.start_time = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}T00:00:00Z`;

  // Format: YYYY-MM-DDT23:59:59Z (11:59 PM of end date)
  payload.end_time = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}T23:59:59Z`;

  console.log('Full ISO dates added:', payload.start_time, 'to', payload.end_time);
} else {
  console.log('No date range selected (optional for Online I/O)');
}

  // =============================================
  // 1. SIMULATION-BASED
  // =============================================
  if (this.isSimulationBased()) {
    payload.evaluation_method = 'Simulation-Based';
    payload.agent_api_key = this.selectedAgentObj()?.agent_api_key || '';
    payload.goal = this.simScenarios();
    payload.persona = this.simPersonas();
    payload.max_turns = this.simTurns();
    // No data_set needed for simulation
  }

  // =============================================
// 2. ONLINE CONFIG + I/O DATASET
// =============================================
else if (this.isConfigIoScenario()) {
  payload.evaluation_method = 'Config + I/O Dataset';
  payload.agent_api_key = this.selectedAgentObj()?.agent_api_key || '';
  payload.data_set = 'Config + I/O Dataset';

  const parsedInputData: any[] = [];
  const parsedOutputData: any[] = [];

  for (const pair of this.dataPairs()) {
    if (pair.input.trim()) {
      try {
        parsedInputData.push(JSON.parse(pair.input));
      } catch (e) {
        this.evalError.set(`Invalid JSON in Input Data: ${(e as Error).message}`);
        return;
      }
    }
    if (pair.output.trim()) {
      try {
        parsedOutputData.push(JSON.parse(pair.output));
      } catch (e) {
        this.evalError.set(`Invalid JSON in Output Data: ${(e as Error).message}`);
        return;
      }
    }
  }

  payload.input_data = parsedInputData;
  payload.output_data = parsedOutputData;
}

  // =============================================
  // 3. ONLINE I/O DATASET EVALUATION  ← NEW/FIXED
  // =============================================
  else if (
    this.selectedEvalType() === 'Online' &&
    this.selectedDataSet() === 'I/O Dataset Evaluation'
  ) {
    payload.evaluation_method = 'I/O Dataset Evaluation';
    payload.data_set = 'I/O Dataset Evaluation';

    const parsedInputData: any[] = [];
    const parsedOutputData: any[] = [];

    for (const pair of this.dataPairs()) {
      if (pair.input.trim()) {
        try {
          parsedInputData.push(JSON.parse(pair.input));
        } catch (e) {
          this.evalError.set(`Invalid JSON in Input Data: ${(e as Error).message}`);
          return;
        }
      }
      if (pair.output.trim()) {
        try {
          parsedOutputData.push(JSON.parse(pair.output));
        } catch (e) {
          this.evalError.set(`Invalid JSON in Output Data: ${(e as Error).message}`);
          return;
        }
      }
    }

    payload.input_data = parsedInputData;
    payload.output_data = parsedOutputData;
  }

  // =============================================
  // 4. TRACE-BASED (Online or Offline) + Config + Trace
  // =============================================
  else if (this.isTraceData()) {
    payload.data_set = this.selectedDataSet();

    const parsedTraceData: any[] = [];
    const parsedExpected: any[] = [];

    for (const trace of this.traceDataList()) {
      if (trace.content.trim()) {
        try {
          parsedTraceData.push(JSON.parse(trace.content));
        } catch (e) {
          this.evalError.set(`Invalid JSON in Trace Data: ${(e as Error).message}`);
          return;
        }
      }
      if (trace.expectedOutput?.trim()) {
        try {
          parsedExpected.push(JSON.parse(trace.expectedOutput));
        } catch (e) {
          this.evalError.set(`Invalid JSON in Expected Output: ${(e as Error).message}`);
          return;
        }
      }
    }

    // === BOTH Online Trace-Based AND Config + Trace now use same payload structure ===
    if (this.selectedEvalType() === 'Online') {
      payload.agent_api_key = this.selectedAgentObj()?.agent_api_key || '';

      if (this.selectedDataSet() === 'Config + Trace Data') {
        payload.evaluation_method = 'Config + Trace Data';
      } else {
        payload.evaluation_method = 'Trace-Based Evaluation';   // or 'trace-based-evaluation' if backend expects exact string
      }

      // Do NOT send trace_data by default for online trace cases (backend fetches it)
      if (parsedTraceData.length > 0) {
        payload.trace_data = parsedTraceData;
      }

      if (parsedExpected.length > 0) {
        payload.expected_output = parsedExpected;
      }
    } 
    else {
      // Offline Trace Data (keep original behavior)
      payload.evaluation_method = 'Trace Data';
      payload.trace_data = parsedTraceData;

      if (parsedExpected.length > 0) {
        payload.output_data = parsedExpected;
      }
    }
  }

  // =============================================
  // 5. OFFLINE FALLBACK (Input/Output Data)
  // =============================================
  else if (this.needsDataInput() && !this.isTraceData()) {
    payload.data_set = this.selectedDataSet();

    const parsedInputData: any[] = [];
    const parsedOutputData: any[] = [];

    for (const pair of this.dataPairs()) {
      if (pair.input.trim()) {
        try {
          parsedInputData.push(JSON.parse(pair.input));
        } catch (e) {
          this.evalError.set(`Invalid JSON in Input Data: ${(e as Error).message}`);
          return;
        }
      }
      if (pair.output.trim()) {
        try {
          parsedOutputData.push(JSON.parse(pair.output));
        } catch (e) {
          this.evalError.set(`Invalid JSON in Output Data: ${(e as Error).message}`);
          return;
        }
      }
    }

    payload.input_data = parsedInputData;
    payload.output_data = parsedOutputData;
  }

  // Execute
this.isEvaluating.set(true);
this.scrollToLoadingRow();

this._evalService.evaluateAgent(payload).subscribe({
  next: (res) => {
    this.isEvaluating.set(false);
    this.evaluatingDateKey.set(null); 
    this.noTracesError.set(null);
    if (res.success && res.data) {
      const newResults = this.mapFetchedToResults(res.data);
      
      if (newResults.length > 0) {
        // Use the same merging logic as mapResultsToTable for consistency
        const now = new Date();
        const dateStr = this.toDateKey(now);

        const existingGroups = this.dateGroups();
        const matchingGroupIndex = existingGroups.findIndex(g => g.dateKey === dateStr);

        if (matchingGroupIndex !== -1) {
          // Merge into today's existing group (at the top)
          this.updateSortedGroups((groups) =>
            groups.map((g: DateGroup, idx) =>
              idx === matchingGroupIndex
                ? { 
                    ...g, 
                    results: [...newResults, ...g.results] 
                  }
                : g
            )
          );
        } else {
          // No group for today yet — create new one
          const newGroup: DateGroup = {
            dateKey: dateStr,
            dateLabel: this.formatDateLabel(dateStr),
            results: newResults,
          };
          this.updateSortedGroups((groups) => [newGroup, ...groups]);
        }

        // Auto-expand today's group
        this.activeDateKey.set(dateStr);
        this.cdr.detectChanges();
      }
    } else {
      this.evalError.set(res.message || 'Evaluation failed.');
    }
  },
  error: (err) => {
    this.isEvaluating.set(false);
    this.evaluatingDateKey.set(null); 
    this.noTracesError.set(null);
    this.evalError.set(err?.error?.message || err?.message || 'Unexpected error');
  },
});
}

  scrollToLoadingRow(): void {
    // Retry mechanism — the loading row may not be in DOM yet after signal update
    let attempts = 0;
    const maxAttempts = 15;
    const baseDelay = 50;

    const tryScroll = (): void => {
      const loadingRow = document.querySelector('.eval-loading-row');
      if (loadingRow) {
        loadingRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      // Fallback: scroll to container if loading row not found
      const container = document.querySelector('.eval-runs-container');
      if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      // Not in DOM yet — retry
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(tryScroll, baseDelay + (attempts * 20));
      }
    };

    setTimeout(tryScroll, baseDelay);
  }

mapResultsToTable(data: any) {
    const detailed = data.individual_metrics || data.detailed_results || data.results || [];

    const now = new Date();
    const dateStr = this.toDateKey(now);
    const time = this.formatTime(now);
    const runId = data.evaluation_id || this.generateId();
    const timestamp = now.getTime();

    // ── Extract definitions from top-level metric_definitions field ──
    this.mergeDefinitions(this.extractDefinitionsFromTopLevel(data));

    // ── Extract definitions from individual_metrics ──
    if (detailed.length > 0) {
      if (detailed[0]?.metrics) {
        this.mergeDefinitions(this.extractDefinitionsFromMetrics(detailed[0].metrics));
      }
      const dr = detailed[0]?.detailed_results;
      if (dr && Array.isArray(dr) && dr.length > 0) {
        this.mergeDefinitions(this.extractDefinitionsFromMetrics(dr[0]));
      }
    }

    let results: EvalResult[];

    // ── Always use individual_metrics — no aggregate_metrics fallback ──
    if (detailed.length > 0) {
      results = this.mapSingleEvalToResults(data).map((r) => ({
        ...r,
        runId,
        testCaseId: r.testCaseId || data.case_id || '001',
        dateStr,
        time,
        timestamp,
        agentConfig: data.agent_config || {}
      }));
    } else {
      // No individual_metrics available — nothing to display
      results = [];
    }

    // Merge into existing date groups or create new ones
    const existingGroups = this.dateGroups();
    const matchingGroup = existingGroups.find((g) => g.dateKey === dateStr);

    if (matchingGroup) {
      this.updateSortedGroups((groups) =>
        groups.map((g: DateGroup) =>
          g.dateKey === dateStr
            ? { ...g, results: [...results, ...g.results] }
            : g
        )
      );
    } else {
      const newGroup: DateGroup = {
        dateKey: dateStr,
        dateLabel: this.formatDateLabel(dateStr),
        results,
      };
      this.updateSortedGroups((groups) => [newGroup, ...groups]);
    }

    // Auto-expand the target date group
    this.activeDateKey.set(dateStr);
  }

getRationaleTooltip(rationale: string): string {
    if (rationale && rationale.trim().length > 0) {
      return rationale;
    }
    return '';
  }


  getAverageTooltip(result: EvalResult): string {
    // Prefer the actual rationale from the API if available
    if (result.averageRationale && result.averageRationale.trim().length > 0) {
      return result.averageRationale;
    }

    // Use the metric definition as the base sentence
    const definition = this.getMetricDefinition('average');

    if (definition) {
      return `The overall performance score calculated as the arithmetic mean of correctness, coherence, relevance, conciseness, and safety, resulting in a score of ${result.average}`;
    }

    return `The overall performance score calculated as the arithmetic mean of correctness, coherence, relevance, conciseness, and safety, resulting in a score of ${result.average}`;
  }

  resetEvaluation() {
    this.setSortedGroups([]);
    this.activeDateKey.set(null);
  }

  exportResults() {
    const groups = this.dateGroups();
    if (groups.length === 0) return;

    const allResults = groups.flatMap((g) => g.results);
    const csvContent = [
      [
        'Date', 'Time', 'Input', 'Expected Output', 'Actual Output', 'Status',
        'Correctness', 'Coherence', 'Relevance', 'Conciseness', 'Completeness',
        'Fluency', 'Hallucination Rate', 'Toxicity Score', 'Safety', 'Average',
      ],
      ...allResults.map((r) => [
        r.dateStr,
        r.time,
        `"${r.input.replace(/"/g, '""')}"`,
        `"${r.expectedOutput.replace(/"/g, '""')}"`,
        `"${r.actualOutput.replace(/"/g, '""')}"`,
        r.status,
        r.correctness,
        r.coherence,
        r.relevance,
        r.conciseness,
        r.completeness,
        r.fluency,
        r.hallucinationRate,
        r.toxicityScore,
        r.safety,
        r.average,
      ]),
    ]
      .map((row) => row.join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `agent-eval-results-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  getStatusClass(status: 'PASS' | 'FAIL' | 'PENDING'): string {
    switch (status) {
      case 'PASS': return 'status-badge--pass';
      case 'FAIL': return 'status-badge--fail';
      default: return 'status-badge--pending';
    }
  }

  getScoreBadgeClass(score: number): string {
    if (score >= 0.85) return 'score-badge score-badge--positive';
    if (score >= 0.70) return 'score-badge score-badge--medium';
    return 'score-badge score-badge--negative';
  }

  generateId(): string {
    return 'dp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
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

  checkUserRole() {
  const loggedUser = this._stateService.getLoginDetails();
  const activePrj = loggedUser?.ActiveProject;
  const projectDetails = loggedUser?.ProjectDtl || [];

  const mappedProject = projectDetails.find(
    (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase()
  );

  const mappedRole = mappedProject?.role_name?.toLowerCase() || '';

  this.isSuperAdmin.set(mappedRole === 'super admin');
}
  
  // extractSimInputOutputFromSpans(row: any): { input: string; output: string; expected: string } {
  //   const dr = row.detailed_results?.[0];
  //   if (!dr?.spans) return { input: '', output: '', expected: '' };

  //   const spans = Array.isArray(dr.spans) ? dr.spans : [];
  //   if (spans.length === 0) return { input: '', output: '', expected: '' };

  //   // Get the last span (most recent turn for this row)
  //   const span = spans[spans.length - 1];
  //   if (!span?.attributes) return { input: '', output: '', expected: '' };

  //   const attrs = span.attributes;
  //   let input = '';
  //   let output = '';
  //   let expected = '';

  //   // ── Extract INPUT from mlflow.spanInputs → last user message (index -1) ──
  //   const spanInputsRaw = attrs['mlflow.spanInputs'] || '';
  //   if (spanInputsRaw) {
  //     try {
  //       const parsed = JSON.parse(spanInputsRaw);
  //       const messages = parsed.messages || [];
  //       const userMessages = messages.filter((m: any) => m.role === 'user');
  //       if (userMessages.length > 0) {
  //         input = userMessages[userMessages.length - 1].content || '';
  //       }
  //     } catch {
  //       input = spanInputsRaw;
  //     }
  //   }

  //   // ── Extract ACTUAL OUTPUT from mlflow.spanOutputs ──
  //   const spanOutputsRaw = attrs['mlflow.spanOutputs'] || '';
  //   if (spanOutputsRaw) {
  //     try {
  //       // spanOutputs is double-encoded: "\"text here\"" → parse once to unwrap
  //       let parsed: any = JSON.parse(spanOutputsRaw);
  //       if (typeof parsed === 'string') {
  //         output = parsed;
  //       } else {
  //         output = JSON.stringify(parsed);
  //       }
  //     } catch {
  //       output = spanOutputsRaw;
  //     }
  //   }

  //   // ── Extract EXPECTED OUTPUT from row.expected_output (double-encoded string) ──
  //   // Value format: "\"User stories may not be defined clearly...\""
  //   // Parse once to unwrap the extra quotes
  //   const expectedRaw = row.expected_output || '';
  //   if (expectedRaw) {
  //     try {
  //       const parsed = JSON.parse(expectedRaw);
  //       if (typeof parsed === 'string') {
  //         expected = parsed;
  //       } else {
  //         expected = JSON.stringify(parsed);
  //       }
  //     } catch {
  //       // If parse fails, use as-is
  //       expected = expectedRaw;
  //     }
  //   }

  //   return { input, output, expected };
  // }

  private extractSimInputOutputFromSpans(row: any): { input: string; output: string; expected: string } {
  let input = '';
  let output = '';
  let expected = '';

  const dr = row.detailed_results;
  if (dr && Array.isArray(dr) && dr.length > 0) {

    // ── INPUT: parse mlflow.spanInputs → user_message ──
    const spans = dr[0].spans;
    if (spans && Array.isArray(spans) && spans.length > 0) {
      const attrs = spans[0].attributes || {};

      const spanInputsStr =
        attrs['mlflow.spanInputs'] ||
        attrs.mlflow_spanInputs ||
        '';
      if (spanInputsStr) {
        try {
          const parsed = JSON.parse(spanInputsStr);
          if (typeof parsed === 'object' && parsed.user_message) {
            input = parsed.user_message;
          } else if (typeof parsed === 'string') {
            input = parsed;
          } else {
            input = JSON.stringify(parsed);
          }
        } catch {
          input = spanInputsStr;
        }
      }

      // ── OUTPUT: parse mlflow.spanOutputs (double-encoded string) ──
      const spanOutputsStr =
        attrs['mlflow.spanOutputs'] ||
        attrs.mlflow_spanOutputs ||
        '';
      if (spanOutputsStr) {
        try {
          const parsed = JSON.parse(spanOutputsStr);
          output = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
        } catch {
          output = spanOutputsStr;
        }
      }
    }

    // ── EXPECTED: from assessments where assessment_name === 'expected_response' ──
    const assessments: any[] = dr[0].assessments || [];
    const expectedAssessment = assessments.find(
      (a: any) => a.assessment_name === 'expected_response'
    );
    if (expectedAssessment?.expectation?.value) {
      expected = expectedAssessment.expectation.value;
    }
  }

  // ── Fallbacks from row-level fields ──
  if (!input && row.input) {
    if (typeof row.input === 'object') {
      input =
        row.input.user_message ||
        row.input.message ||
        row.input.content ||
        JSON.stringify(row.input);
    } else {
      input = String(row.input);
    }
  }

  if (!output && row.output) {
    output = typeof row.output === 'string' ? row.output : JSON.stringify(row.output);
  }

  if (!expected && row.expected_output) {
    expected = String(row.expected_output);
  }

  return { input, output, expected };
}
  
toggleConfigHighlight(index: number) {
  this.expandedCauses.update(set => {
    const newSet = new Set(set);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    return newSet;
  });
}

showAnalysisModal(result: EvalResult) {
  let assessments: any[] = [];

  if (result.detailed_results?.[0]?.assessments?.length) {
    assessments = result.detailed_results[0].assessments;
  } else if (result.detailed_results?.[0]) {
    assessments = result.detailed_results[0].assessments || [];
  }

  const configEval = assessments.find((a: any) => 
    a.assessment_name === 'agent_config_evaluation'
  );

  const agentConfig = (result as any).agentConfig || (result as any).agent_config || {};

  let analysis: AnalysisData = {
    testCaseId: result.testCaseId,
    problem: "No analysis available.",
    rootCauses: [],
    suggestedFixes: [],
    impact: "",
    severity: "",
    severityRationale: "",
    agentConfig,
    configHighlights: {}
  };

  if (configEval?.rationale) {
    try {
      let rationaleText = String(configEval.rationale).trim()
        .replace(/\\n/g, '\n')
        .replace(/\n/g, ' ')
        .replace(/\\"/g, '"');

      let parsed: any = null;
      try {
        parsed = JSON.parse(rationaleText);
      } catch {
        parsed = null;
      }

      if (parsed && typeof parsed === 'object') {
                let rootCauses: string[] = [];

        const rootCauseFields = ['config_area', 'root_cause', 'rootCauses', 'causes'];

        for (const field of rootCauseFields) {
          if (parsed[field]) {
            let value = parsed[field];

            if (typeof value === 'string') {
              const trimmed = value.trim();

              // Split ONLY if it contains commas AND looks like a list of short items
              if (trimmed.includes(',')) {
                const parts = trimmed.split(',').map(item => item.trim()).filter(Boolean);
                
                // Heuristic: if most parts are short (likely config keys), split them
                const isLikelyConfigList = parts.every(part => part.length < 60) && 
                                         parts.length > 1;

                rootCauses = isLikelyConfigList ? parts : [trimmed];
              } else {
                rootCauses = [trimmed];
              }
            } 
            else if (Array.isArray(value)) {
              rootCauses = value.map(item => String(item).trim()).filter(Boolean);
            } 
            else {
              rootCauses = [String(value).trim()];
            }
            break;
          }
        }

        // Build highlights...
        const highlights: Record<string, string> = {};

        rootCauses.forEach(rawKey => {
          const cleanKey = rawKey.trim();
          if (!cleanKey) return;

          const found = this.findConfigValue(agentConfig, cleanKey);
          if (found !== undefined) {
            highlights[cleanKey] = typeof found === 'string' 
              ? found 
              : JSON.stringify(found, null, 2);
          }
        });

        analysis = {
          testCaseId: result.testCaseId,
          problem: parsed.highlight_problem || parsed.problem || "No specific problem identified.",
          rootCauses: rootCauses,
          suggestedFixes: parsed.suggestion ? [parsed.suggestion] : 
                         (Array.isArray(parsed.suggestedFixes) ? parsed.suggestedFixes : []),
          impact: parsed.impact_on_output || parsed.impact || "",
          severity: parsed.severity || "",
          severityRationale: parsed.rationale || parsed.explanation || "",
          agentConfig,
          configHighlights: highlights
        };
      } else {
        analysis.severityRationale = rationaleText;
      }
    } catch (e) {
      console.error("Failed to parse rationale:", e);
      analysis.severityRationale = String(configEval.rationale).trim();
    }
  }

  this.selectedAnalysis.set(analysis);

  setTimeout(() => {
    const modalEl = document.getElementById('analysisModal');
    if (modalEl) new bootstrap.Modal(modalEl).show();
    this.cdr.detectChanges();
  }, 100);
}

private findConfigValue(obj: any, searchKey: string): any {
  if (!obj || typeof obj !== 'object') return undefined;

  const lowerSearch = searchKey.toLowerCase().trim();

  // 1. Direct top-level match
  if (obj[searchKey] !== undefined) return obj[searchKey];

  // 2. Dot notation support
  if (searchKey.includes('.')) {
    const value = this.getNestedValue(obj, searchKey);
    if (value !== undefined) return value;
  }

  // 3. Dynamic Feature Array Search (works for any feature type)
  if (Array.isArray(obj.features)) {
    for (const feature of obj.features) {
      if (!feature || typeof feature !== 'object') continue;

      const featureType = String(feature.type || '').toLowerCase();
      const config = feature.config || {};

      // Match if search key contains feature type or any key inside its config
      if (lowerSearch.includes(featureType) || 
          featureType.includes(lowerSearch) ||
          Object.keys(config).some(k => 
            k.toLowerCase().includes(lowerSearch) || lowerSearch.includes(k.toLowerCase())
          )) {
        return config;   // Return the config object of the matching feature
      }
    }
  }

  // 4. General recursive search as final fallback
  const searchRecursively = (current: any): any => {
    if (!current || typeof current !== 'object') return undefined;

    for (const [key, value] of Object.entries(current)) {
      if (key.toLowerCase().includes(lowerSearch) || 
          lowerSearch.includes(key.toLowerCase())) {
        return value;
      }
      if (typeof value === 'object' && value !== null) {
        const found = searchRecursively(value);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };

  return searchRecursively(obj);
}

private getNestedValue(obj: any, path: string): any {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

  getEvalMethodDescription(value: string): string {
  return this.evalMethodDescriptions[value] || '';
}

  selectedMethodName = computed(() => {
    if (!this.selectedDataSet()) return '';
    const opt = this.datasetOptions().find(d => d.value === this.selectedDataSet());
    return opt?.label || '';
  });

  toggleMethodDropdown() {
    this.isMethodDropdownOpen.update(v => !v);
  }

  closeMethodDropdown() {
    this.isMethodDropdownOpen.set(false);
  }

  selectMethod(value: string) {
    this.selectedDataSet.set(value);
    this.closeMethodDropdown();
    this.onDataSetChange();
  }
  
showCellTooltip(event: MouseEvent, text: string): void {
  if (!text || text.length <= 80) return;

  this.clearCellTooltipTimeout();

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const gap = 2;

  // Adaptive sizing based on content length
  const isShort = text.length <= 250;
  const tooltipWidth = isShort ? 280 : 420;
  const tooltipMaxHeight = isShort ? 180 : 300;

  let left = rect.left;
  let top = rect.bottom + gap;

  // If tooltip would go below viewport, show above
  if (top + tooltipMaxHeight > window.innerHeight - 12) {
    top = rect.top - tooltipMaxHeight - gap;
  }
  if (top < 12) {
    top = 12;
  }

  // Clamp horizontal
  if (left + tooltipWidth > window.innerWidth - 12) {
    left = window.innerWidth - tooltipWidth - 12;
  }
  if (left < 12) {
    left = 12;
  }

  this.cellTooltip = {
    visible: true,
    position: { left, top },
    text: text
  };

  this.cellTooltipSizing = { width: tooltipWidth, maxHeight: tooltipMaxHeight };

  this.cdr.detectChanges();

  // RESET scroll to top every time a new tooltip appears
  setTimeout(() => {
    const el = document.querySelector('.cell-tooltip-popup') as HTMLElement;
    if (el) {
      el.scrollTop = 0;
    }
  }, 0);
}

hideCellTooltip(): void {
  this.isCellTooltipHovered = false;
  this.clearCellTooltipTimeout();

  this.cellTooltipTimeout = setTimeout(() => {
    if (!this.isCellTooltipHovered) {
      this.cellTooltip.visible = false;
      this.cdr.detectChanges();
    }
  }, 150);
}

onCellTooltipEnter(): void {
  this.isCellTooltipHovered = true;
  this.clearCellTooltipTimeout();
}

onCellTooltipLeave(): void {
  this.isCellTooltipHovered = false;
  this.clearCellTooltipTimeout();

  this.cellTooltipTimeout = setTimeout(() => {
    this.cellTooltip.visible = false;
    this.cdr.detectChanges();
  }, 100);
}

private clearCellTooltipTimeout(): void {
  if (this.cellTooltipTimeout) {
    clearTimeout(this.cellTooltipTimeout);
    this.cellTooltipTimeout = null;
  }
}

getPassCountTooltip(summary: { total: number; passed: number; failed: number; passRate: number }): string {
  return `Number of cases passed out of total runs.`;
}

getPassRateTooltip(summary: { total: number; passed: number; failed: number; passRate: number }): string {
  return `Pass rate in percentage`;
}

showMethodInfo(event: MouseEvent, text: string) {
  event.stopPropagation();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const tooltipWidth = 280;

  let left = rect.right + 10;
  // If it would go off-screen right, flip to the left
  if (left + tooltipWidth > window.innerWidth) {
    left = rect.left - tooltipWidth - 10;
  }

  this.methodInfoTooltip.set({
    visible: true,
    text,
    position: {
      left,
      top: rect.top + rect.height / 2 - 20
    }
  });
}

hideMethodInfo() {
  this.methodInfoTooltip.update(v => ({ ...v, visible: false }));
}

showEvalTypeInfo(event: MouseEvent, text: string) {
  event.stopPropagation();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const tooltipWidth = 280;

  let left = rect.right + 10;
  if (left + tooltipWidth > window.innerWidth) {
    left = rect.left - tooltipWidth - 10;
  }

  this.evalTypeTooltip.set({
    visible: true,
    text,
    position: {
      left,
      top: rect.top + rect.height / 2 - 20
    }
  });
}

hideEvalTypeInfo() {
  this.evalTypeTooltip.update(v => ({ ...v, visible: false }));
}

isCopied(itemId: string): boolean {
  return this.copiedItems().has(itemId);
}

async copyToClipboard(text: string, itemId: string): Promise<void> {
  if (!text || text.trim() === '-' || text.trim() === '') return;
  
  try {
    await navigator.clipboard.writeText(text);
    this.setCopiedState(itemId);
  } catch (err) {
    console.error('Clipboard API failed, using fallback:', err);
    this.fallbackCopy(text, itemId);
  }
}

private fallbackCopy(text: string, itemId: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  
  try {
    const success = document.execCommand('copy');
    if (success) {
      this.setCopiedState(itemId);
    }
  } catch (err) {
    console.error('Fallback copy failed:', err);
  }
  
  document.body.removeChild(textarea);
}

private setCopiedState(itemId: string): void {
  this.copiedItems.update(set => {
    const newSet = new Set(set);
    newSet.add(itemId);
    return newSet;
  });
  
  setTimeout(() => {
    this.copiedItems.update(set => {
      const newSet = new Set(set);
      newSet.delete(itemId);
      return newSet;
    });
  }, 2000);
}

// Method to copy tooltip content specifically
copyTooltipContent(): void {
  const text = this.cellTooltip.text;
  if (!text || text.trim() === '-' || text.trim() === '') return;
  
  this.copyToClipboard(text, 'tooltip-content');
  
  // Also set tooltip-specific copied state
  this.tooltipCopied.set(true);
  setTimeout(() => {
    this.tooltipCopied.set(false);
  }, 2000);
}

copyCellContent(result: EvalResult, field: 'input' | 'expectedOutput' | 'actualOutput'): void {
  const text = result[field];
  const itemId = `${result.runId}-${result.testCaseId}-${field}`;
  this.copyToClipboard(text, itemId);
}

onTooltipMouseEnter(): void {
  this.isCellTooltipHovered = true;
  if (this.cellTooltipTimeout) {
    clearTimeout(this.cellTooltipTimeout);
    this.cellTooltipTimeout = null;
  }
}

onTooltipMouseLeave(): void {
  this.isCellTooltipHovered = false;
  this.hideCellTooltip();
}
}