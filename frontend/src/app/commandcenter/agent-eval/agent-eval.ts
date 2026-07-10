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

@Component({
  selector: 'app-agent-eval',
  imports: [CommonModule, FormsModule, TooltipDirective],
  templateUrl: './agent-eval.html',
  styleUrl: './agent-eval.css',
})
export class AgentEval {
  constructor(
    private _marketService: SemarketplaceService,
    private _evalService: AgentEvalService,
    private _stateService: AIInfuseStateService,
  ) {}

  readonly tabs: TabOption[] = [
    { value: 'eval', label: 'Offline/Online Agent Evaluation' },
    { value: 'definition', label: 'Agent Definition' },
    { value: 'execution', label: 'Agent Execution' },
  ];

  readonly evalTypes: EvalTypeOption[] = [
    { value: 'offline', label: 'Offline' },
    { value: 'online', label: 'Online' },
  ];

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

  agents: any;

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
  isTraceData = computed(() => this.selectedDataSet() === 'Trace Data');

  ngOnInit(): void {
    this.loadAgents();
    this.checkUserRole();
  }

  onTabChange(tab: TabType) {
    this.activeTab.set(tab);
  }

  loadAgents(): void {
    this._marketService.getAgentDetails().subscribe({
      next: (res) => {
        if (res.success) {
          this.agents = res.data;
        }
      },
      error: (err) => console.error('Error:', err),
    });
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
      agent_id: this.selectedAgent(),
      evaluation_type: this.selectedEvalType(),
      data_set: this.selectedDataSet() as 'Input/Output Data' | 'Trace Data',
    };

    this.isFetchingHistory.set(true);
    this.evalError.set(null);

    this._evalService.fetchEvaluationData(request).subscribe({
      next: (res) => {
        this.isFetchingHistory.set(false);

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
        }
      },
      error: (err: any) => {
        this.isFetchingHistory.set(false);
        this.setSortedGroups([]);
        this.activeDateKey.set(null);
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

  if (evaluations.length === 0) return [];

  // Reset definitions before re-building from history
  this.metricDefinitions.set({});

  const allResults: EvalResult[] = [];

  for (const evalData of evaluations) {
    if (evalData.status === 'failed') continue;

    // ── Extract definitions from top-level metric_definitions field ──
    this.mergeDefinitions(this.extractDefinitionsFromTopLevel(evalData));

    // ── Extract definitions from individual_metrics ──
    const indivMetrics = evalData.individual_metrics || [];
    if (indivMetrics.length > 0) {
      // From row.metrics (e.g. "fluency/mean": { definition: "..." })
      if (indivMetrics[0]?.metrics) {
        this.mergeDefinitions(this.extractDefinitionsFromMetrics(indivMetrics[0].metrics));
      }
      // From detailed_results[0] if it has definition sub-objects
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

    // ── Always use individual_metrics — no aggregate_metrics fallback ──
    if (indivMetrics.length > 0) {
      const individualResults = this.mapSingleEvalToResults(evalData).map((r) => ({
        ...r,
        runId,
        testCaseId: r.testCaseId || evalData.case_id || evalData.evaluation_id?.slice(-6).toUpperCase(),
        dateStr,
        time,
        timestamp,
      }));
      allResults.push(...individualResults);
    }
    // If no individual_metrics exist, this evaluation is skipped entirely
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
      // All scores now come from individual_metrics row via extractScore/extractStatusFromRow
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

      // Path 1: evalData.input_data / output_data (top-level arrays)
      const inputItem = evalData.input_data?.[index];
      const outputItem = evalData.output_data?.[index];

      if (inputItem) {
        inputRaw = this.extractFieldValue(inputItem, ['Input', 'input', 'inputs']);
        expectedRaw = this.extractFieldValue(inputItem, ['Expectation', 'expectation', 'expectations']);
      }

      if (outputItem) {
        actualRaw = this.extractFieldValue(outputItem, ['Output', 'output', 'outputs']);
      }

      // Path 2: row.input / row.output (on individual_metrics row)
      if (!inputRaw) {
        inputRaw = row.input?.user_query?.input || row.input?.inputs || row.inputs?.user_query || row.inputs || '';
      }
      if (!expectedRaw) {
        expectedRaw = row.input?.user_query?.expectation || row.input?.expectations || row.inputs?.prompt_output || '';
      }
      if (!actualRaw) {
        actualRaw = row.output?.output || row.output?.outputs || row.outputs || '';
      }

      // Path 3: row.input.prompt_output for actual output
      if (!actualRaw && row.input?.prompt_output?.output) {
        actualRaw = row.input.prompt_output.output;
      }

      // Path 4: detailed_results[0].request / .response (new API format)
      if ((!inputRaw || !expectedRaw) && row.detailed_results?.[0]?.request) {
        const req = row.detailed_results[0].request;
        if (!inputRaw) {
          inputRaw = req.user_query?.input || req.user_query?.inputs || req.inputs || '';
        }
        if (!expectedRaw) {
          expectedRaw = req.user_query?.expectation || req.user_query?.expectations || req.expectation || '';
        }
      }
      if (!actualRaw && row.detailed_results?.[0]?.response) {
        actualRaw = row.detailed_results[0].response.output || '';
      }

            // Path 5: evalData.expected_output (only for Input/Output data, NOT trace data)
      if (!evalData.trace_data && !expectedRaw && evalData.expected_output?.[index]) {
        const expItem = evalData.expected_output[index];
        expectedRaw = this.extractFieldValue(expItem, ['Expectation', 'expectation', 'expectations']) || expItem || '';
      }

            // Path 6: Trace Data — extract input & actual output from the span
      // that contains both agent_id and agent_name in SpanAttributes
      if (evalData.trace_data) {
        const traceResult = this.extractInputOutputFromTraceData(evalData, index);
        if (traceResult.input) {
          inputRaw = traceResult.input;
        }
        if (traceResult.output) {
          actualRaw = traceResult.output;
        }

        // For trace data, expected output comes from TWO possible locations:
        // Location A: row.expected_output (inside individual_metrics row) — most common
        // Location B: evalData.expected_output[index] (top-level array)
        let traceExpSource: any = null;

        // Location A: row.expected_output
        if (row.expected_output) {
          traceExpSource = row.expected_output;
        }
        // Location B: evalData.expected_output[index] (fallback)
        else if (evalData.expected_output?.[index]) {
          traceExpSource = evalData.expected_output[index];
        }

        if (traceExpSource) {
          if (typeof traceExpSource === 'string') {
            expectedRaw = traceExpSource;
          } else if (traceExpSource && typeof traceExpSource === 'object') {
            expectedRaw =
              traceExpSource.Expectation ||
              traceExpSource.expectation ||
              traceExpSource.Expectation_Value ||
              traceExpSource.expected_output ||
              traceExpSource.ExpectedOutput ||
              this.extractFieldValue(traceExpSource, [
                'Expectation', 'expectation', 'expectations',
                'Expectation_Value', 'expected_output', 'ExpectedOutput',
              ]) ||
              '';
          }
        }
      }

      // Extract rationales from assessments in individual_metrics row
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
    this.validateJson(value, `input-${id}`, ['Input', 'Expectation']);
  } 
  else if (type === 'output') {
    this.validateJson(value, `output-${id}`, ['Output']);
  } 
  else if (type === 'expected-trace') {
    this.validateJson(value, `expected-trace-${id}`, ['Expectation']);   // This was the problematic one
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
    exactOneKeys?: string[]
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
        // ── KEY CHANGE: When exactOneKeys is set, ONLY check those keys.
        //    Skip checking all other keys for duplicates.
        //    This ensures trace data only validates via span_count.
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
        }

        // Check all other keys for duplicates (only when no exactOneKeys)
        const keyCounts = new Map<string, number>();
        for (const key of foundKeys) {
          const lowerKey = key.toLowerCase();
          keyCounts.set(lowerKey, (keyCounts.get(lowerKey) || 0) + 1);
        }

        for (const [lowerKey, count] of keyCounts) {
          if (count > 1) {
            const isRequired = requiredKeys?.some((k) => k.toLowerCase() === lowerKey);

            if (!isRequired) {
              const originalKey = foundKeys.find((k) => k.toLowerCase() === lowerKey) || lowerKey;
              this.addInvalid(fieldKey, this.getMultipleDataMessage(fieldKey, originalKey));
              return false;
            }
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

    // ── Validate requiredKeys (strict — no extra keys allowed) ──
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

        const extraKeys = originalKeys.filter((k) => {
          return !requiredKeys.some((reqKey) => reqKey.toLowerCase() === k.toLowerCase());
        });

        if (extraKeys.length > 0) {
          const allowedKeysStr = requiredKeys.join('", "');
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
    this.evalError.set(null);
    this.invalidFields.set(new Map());
    this.setSortedGroups([]);
    this.activeDateKey.set(null);
    this.metricDefinitions.set({});

    this.dataPairs.set([{ id: this.generateId(), input: '', output: '' }]);
    this.traceDataList.set([{ id: this.generateId(), content: '', expectedOutput: '' }]);

    // Re-fetch history for the new combination
    if (this.selectedAgent() && this.selectedEvalType() && this.selectedDataSet()) {
      this.fetchHistory();
    }
  }

  onEvalTypeChange(value: string) {
    this.selectedEvalType.set(value);
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

    // Re-fetch history for the new combination
    if (this.selectedAgent() && this.selectedEvalType() && this.selectedDataSet()) {
      this.fetchHistory();
    }
  }

  onDataSetChange() {
    this.evalError.set(null);
    this.invalidFields.set(new Map());
    this.setSortedGroups([]);
    this.activeDateKey.set(null);
    this.metricDefinitions.set({});

    this.dataPairs.set([{ id: this.generateId(), input: '', output: '' }]);
    this.traceDataList.set([{ id: this.generateId(), content: '', expectedOutput: '' }]);

    // Reset any uploaded/typed input data
    this.dataPairs.set([{ id: this.generateId(), input: '', output: '' }]);
    this.traceDataList.set([{ id: this.generateId(), content: '', expectedOutput: '' }]);

    this.fetchHistory();
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
    this.dataPairs.update((pairs) => pairs.map((p) => (p.id === id ? { ...p, input: value } : p)));
    this.validateJson(value, `input-${id}`, ['Input', 'Expectation']);
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

  onFileUpload(event: Event, id: string, target: 'input' | 'output') {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      this.showToast('error', 'Please select a valid JSON file.');
      fileInput.value = '';
      return;
    }

    const fieldKey = `${target}-${id}`;
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
      if (target === 'input') {
        this.updateInput(id, content);
      } else {
        this.updateOutput(id, content);
      }
      this.setUploading(fieldKey, false);
    };
    reader.onerror = () => {
      this.setUploading(fieldKey, false);
      this.showToast('error', 'Failed to read the file.');
    };
    reader.readAsText(file);
    fileInput.value = '';
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

  onEvaluate() {
    if (this.hasInvalidFields()) return;

    if (this.isTraceData()) {
      const hasEmpty = this.traceDataList().some((t) => t.content.trim() === '');
      if (hasEmpty) {
        this.showToast('error', 'Please provide trace data.');
        return;
      }
    } else {
      const hasEmpty = this.dataPairs().some((p) => p.input.trim() === '' || p.output.trim() === '');
      if (hasEmpty) {
        this.showToast('error', 'Please fill in all Input and Output data fields.');
        return;
      }
    }

    let payload: any;

    if (this.isTraceData()) {
      const traceList = this.traceDataList().map((t) => {
        try { return JSON.parse(t.content); } catch { return t.content; }
      });
      const expectedOutputList = this.traceDataList()
        .filter((t) => t.expectedOutput.trim() !== '')
        .map((t) => {
          try { return JSON.parse(t.expectedOutput); } catch { return t.expectedOutput; }
        });

      payload = {
        agent_id: this.selectedAgent(),
        evaluation_type: this.selectedEvalType(),
        data_set: 'Trace Data',
        trace_data: traceList,
        created_by: this._stateService.getLoginDetails()?.Email || '',
        ...(expectedOutputList.length > 0 && { expected_output: expectedOutputList }),
      };
    } else {
      const inputList = this.dataPairs().map((p) => {
        try { return JSON.parse(p.input); } catch { return p.input; }
      });
      const outputList = this.dataPairs().map((p) => {
        try { return JSON.parse(p.output); } catch { return p.output; }
      });
      payload = {
        agent_id: this.selectedAgent(),
        evaluation_type: this.selectedEvalType(),
        data_set: 'Input/Output Data',
        input_data: inputList,
        output_data: outputList,
        created_by: this._stateService.getLoginDetails()?.Email || '',
      };
    }

    this.isEvaluating.set(true);
    this.evalError.set(null);
    // Auto-scroll to the loading row after it renders
    setTimeout(() => {
      const loadingRow = document.querySelector('.eval-loading-row');
      if (loadingRow) {
        loadingRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        const container = document.querySelector('.eval-runs-container');
        if (container) {
          container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, 50);

    this._evalService.evaluateAgent(payload).subscribe({
      next: (res: any) => {
        this.isEvaluating.set(false);

        if (res.success && res.data) {
          const data = res.data;
          if (data.status === 'failed') {
            this.evalError.set(data.error);
            this.showToast('error', data.error);
            return;
          }
          this.mapResultsToTable(data);
        } else {
          this.evalError.set(res.message);
          this.showToast('error', res.message);
        }
      },
      error: (err: any) => {
        this.isEvaluating.set(false);
        const msg = err?.error?.message || err?.message || 'An unexpected error occurred during evaluation.';
        this.evalError.set(msg);
        this.showToast('error', msg);
        console.error('Evaluation error:', err);
      },
    });
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
  
}