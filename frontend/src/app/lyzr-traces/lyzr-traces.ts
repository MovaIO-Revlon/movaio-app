import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  input,
} from '@angular/core';
import {
  IGroupedLog,
  ILogDetail,
  ILyzrTrace,
  ILyzrTraceDetails,
  ILyzrTraceQuery,
  IWorkflowTrace,
  IWorkflowTraceQuery,
  IWorkflowTraceResponse,
} from '../types';
import { LyzrService } from '../services/lyzr.service';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';
import { TooltipDirective } from '../custom-tooltip/tooltip.directive';

@Component({
  selector: 'app-lyzr-traces',
  imports: [CommonModule, TooltipDirective],
  templateUrl: './lyzr-traces.html',
  styleUrl: './lyzr-traces.css',
})
export class LyzrTraces implements AfterViewInit {
  traces: ILyzrTrace[] = [];
  workflowTraces: IWorkflowTrace[] = [];
  traceDetails?: ILyzrTraceDetails;
  workflowTraceDetails?: IWorkflowTrace['trace_details'];
  groupedLogs: IGroupedLog[] = [];
  logFeatureMapping: Record<string, ILogDetail[]> = {};
  realTimeLogs: any[] = []; // Add this to store real-time logs

  tabs = ['run', 'metadata', 'logs'];

  selectedTraceId: string = '';
  activeTab = this.tabs[0];

  // Make sure these input properties are correctly defined
  agentId = input<string>();
  requestId = input<string>();
  startDate = input<string>();
  endDate = input<string>();
  workflowId = input<string>();
  eventId = input<string>();
  agents = input<any[]>();
  project = input<string>();
  insightsTraces = input<any[]>();  // New input for direct insights traces
  sessionId = input<string>();     // New input for session ID

  isTracesLoading = false;
  isTraceDetailLoading = false;
  isLogsLoading = false;
  workflowRealTimeLogs: any[] = [];

  logFeatureLabelIconMapping: Record<string, [string, string] | undefined> = {
  __start__: ['Start', 'fa-play'],
  llm_generation: ['Llm Generation', 'fa-hexagon-nodes'],
  __end__: ['End', 'fa-stop'],
  rag_retrieval: ['RAG Retrieval', 'fa-search'],
  embed_documents: ['Embed Documents', 'fa-file-code'],
  kb_documents_retrieved: ['KB Documents Retrieved', 'fa-database'],
  retrieved_documents: ['Retrieved Documents', 'fa-file-alt'],
  agent_process_start: ['Agent Process Start', 'fa-play-circle'],
  agent_process_end: ['Agent Process End', 'fa-stop-circle'],
  knowledge_base: ['Knowledge Base', 'fa-database'],
  websocket_connections: ['Websocket Connections', 'fa-plug'],
};

  constructor(
    private readonly service: LyzrService,
    private readonly cdRef: ChangeDetectorRef
  ) {}

  ngAfterViewInit(): void {
    const agent_id = this.agentId();
    const request_id = this.requestId();
    const start_date = this.startDate();
    const end_date = this.endDate();
    const workflow_id = this.workflowId();
    const event_id = this.eventId();
    const agents = this.agents();
    const project = this.project();
    this.clearTraceState();

    // Determine if we're dealing with insights traces, workflow traces, or regular traces
    if (workflow_id && event_id && agents && agents.length > 0) {
      // Check if this is an insights trace (workflow_id starts with 'insights_')
      if (workflow_id.startsWith('insights_')) {
        this.captureInsightsTraces({ workflow_id, event_id, limit: 1, agents, project, request_id });
      } else {
        this.captureWorkflowTraces({ workflow_id, event_id, limit: 1, agents, project });
      }
    } else if (agent_id && request_id && start_date && end_date) {
      this.fetchTraces({ agent_id, start_date, end_date });
    }
  }

clearTraceState(): void {
  this.selectedTraceId = '';
  this.traceDetails = undefined;
  this.workflowTraceDetails = undefined;
  this.groupedLogs = [];
  this.logFeatureMapping = {};
  this.realTimeLogs = [];
  this.workflowRealTimeLogs = []; // Add this to store workflow real-time logs
  this.activeTab = this.tabs[0];
}

private extractWebsocketConnectionsFromSpans(spans: any[], traceStartTime: string): any[] {
  const websockets: any[] = [];

  spans.forEach((span, spanIndex) => {
    // Look for spans that represent websocket connections or events
    const spanName = span.SpanName || '';
    const isWebsocket = spanName.toLowerCase().includes('websocket') ||
                        spanName.toLowerCase().includes('socket') ||
                        spanName.toLowerCase().includes('connection') ||
                        spanName.toLowerCase().includes('stream');

    if (isWebsocket) {
      // Extract events from the span
      const eventNames = span['Events.Name'] || [];
      const eventAttributes = span['Events.Attributes'] || [];

      eventNames.forEach((eventName: string, eventIndex: number) => {
        const eventAttrs = eventAttributes[eventIndex] || {};

        websockets.push({
          timestamp: eventAttrs.timestamp || traceStartTime,
          desc: eventName,
          body: JSON.stringify(eventAttrs, null, 2),
          status: eventAttrs.status || 'active',
          span_name: spanName,
          event_type: 'websocket'
        });
      });
    }

    // Also extract any events that might contain websocket-related data
    if (span['Events.Attributes']) {
      span['Events.Attributes'].forEach((attrs: any, index: number) => {
        const eventName = span['Events.Name']?.[index] || 'websocket_event';

        // Check if this event looks like a websocket connection
        if (attrs.type === 'websocket' || attrs.connection_type === 'websocket' ||
            eventName.toLowerCase().includes('socket')) {
          websockets.push({
            timestamp: attrs.timestamp || traceStartTime,
            desc: eventName,
            body: JSON.stringify(attrs, null, 2),
            status: attrs.status || 'active',
            span_name: spanName,
            event_type: 'websocket'
          });
        }
      });
    }
  });

  return websockets;
}

private extractAllEventsFromSpans(spans: any[]): any[] {
  const allEvents: any[] = [];
  const traceStartTime = new Date().toISOString();

  spans.forEach((span) => {
    const spanName = span.SpanName || '';
    const eventNames = span['Events.Name'] || [];
    const eventAttributes = span['Events.Attributes'] || [];

    // Extract each event from the span
    eventNames.forEach((eventName: string, eventIndex: number) => {
      const eventAttrs = eventAttributes[eventIndex] || {};

      // Determine if this is a websocket event
      const isWebsocket = spanName.toLowerCase().includes('websocket') ||
                         spanName.toLowerCase().includes('socket') ||
                         spanName.toLowerCase().includes('connection') ||
                         spanName.toLowerCase().includes('stream') ||
                         eventName.toLowerCase().includes('socket') ||
                         eventAttrs.type === 'websocket' ||
                         eventAttrs.connection_type === 'websocket';

      allEvents.push({
        feature: isWebsocket ? 'websocket_connections' : spanName.toLowerCase().replace(/\s+/g, '_'),
        timestamp: eventAttrs.timestamp || traceStartTime,
        message: eventName,
        desc: eventName,
        body: JSON.stringify(eventAttrs, null, 2),
        status: eventAttrs.status || 'active',
        span_name: spanName,
        event_type: isWebsocket ? 'websocket' : 'event',
        level: 'info'
      });
    });
  });

  return allEvents;
}

 captureWorkflowTraces(query: IWorkflowTraceQuery) {
  this.isTracesLoading = true;
  this.cdRef.detectChanges();

  console.log('Capturing workflow traces with query:', query);
  const payload = {
    workflow_id: query.workflow_id,
    event_id: query.event_id,
    limit: query.limit || 1,
    agents: query.agents,
    project: this.project()
  };

  this.service.captureWorkflowAgentTraces(query).subscribe({
    next: (res: IWorkflowTraceResponse) => {
      console.log('Workflow traces response:', res);
      if (res.success && res.data && res.data.traces) {
        this.workflowTraces = res.data.traces;

        // Populate agent names from input agents data if missing from API response
        const agentsData = this.agents();
        if (agentsData && agentsData.length > 0) {
          this.workflowTraces.forEach(trace => {
            // If trace doesn't have agent_name, try to find it from the agents data
            if (!trace.agent_name && trace.agent_id) {
              const matchingAgent = agentsData.find(agent => agent.agent_id === trace.agent_id);
              if (matchingAgent && matchingAgent.agent_name) {
                trace.agent_name = matchingAgent.agent_name;
              }
            }
          });
        }

        console.log('Set workflow traces:', this.workflowTraces);

        // Extract real-time logs from each trace
        this.workflowRealTimeLogs = [];
        this.workflowTraces.forEach(trace => {
          if (trace.real_time_logs && trace.real_time_logs.length > 0) {
            this.workflowRealTimeLogs.push(...trace.real_time_logs);
          }
        });
        console.log('Extracted workflow real-time logs:', this.workflowRealTimeLogs);
      } else {
        this.workflowTraces = [];
        this.workflowRealTimeLogs = [];
      }
      this.isTracesLoading = false;
      this.cdRef.detectChanges();
    },
    error: (err: any) => {
      console.error('Error capturing workflow traces:', err);
      this.workflowTraces = [];
      this.workflowRealTimeLogs = [];
      this.isTracesLoading = false;
      this.cdRef.detectChanges();
    },
  });
}

captureInsightsTraces(query: any) {
  this.isTracesLoading = true;
  this.cdRef.detectChanges();

  console.log('Capturing insights traces with query:', query);

  // For insights traces, we still use the same endpoint but handle it specially
  const payload = {
    workflow_id: query.workflow_id,
    event_id: query.event_id,
    limit: query.limit || 1,
    agents: query.agents,
    project: query.project
  };

  this.service.captureWorkflowAgentTraces(payload).subscribe({
    next: (res: IWorkflowTraceResponse) => {
      console.log('Insights traces response:', res);

      let insightsTraces: IWorkflowTrace[] = [];

      if (res.success && res.data && res.data.traces && res.data.traces.length > 0) {
        // Backend returned actual traces
        insightsTraces = res.data.traces;
      } else {
        // No traces found via backend, create mock traces from insights metrics
        // The real_time_logs will be populated from insights metrics
        const agentsData = this.agents();
        if (agentsData && agentsData.length > 0) {
          insightsTraces = agentsData.map((agent, index) => ({
            trace_id: `insights_${query.request_id}_${agent.agent_id}`,
            agent_id: agent.agent_id,
            agent_name: agent.agent_name || `Agent ${index + 1}`,
            trace_summary: {
              trace_id: `insights_${query.request_id}_${agent.agent_id}`,
              agent_id: agent.agent_id,
              name: agent.agent_name || `Agent ${index + 1}`,
              trace_start_time: new Date().toISOString(),
              trace_end_time: new Date().toISOString(),
              trace_duration: 0,
              total_spans: 0,
              llm_input_tokens: 0,
              llm_output_tokens: 0,
              action_cost: 0
            },
            trace_details: {
              spans: [],
              input_messages: [],
              output_messages: { content: '' },
              chat_messages: { input_message: '', output_message: '' }
            },
            real_time_logs: [],
            captured_at: new Date().toISOString()
          }));
        }
      }

      // Populate agent names from input agents data if missing
      const agentsData = this.agents();
      if (agentsData && agentsData.length > 0) {
        insightsTraces.forEach(trace => {
          if (!trace.agent_name && trace.agent_id) {
            const matchingAgent = agentsData.find(agent => agent.agent_id === trace.agent_id);
            if (matchingAgent && matchingAgent.agent_name) {
              trace.agent_name = matchingAgent.agent_name;
            }
          }
        });
      }

      this.workflowTraces = insightsTraces;
      console.log('Set insights traces:', this.workflowTraces);

      // Extract real-time logs and websocket connections from each trace
      this.workflowRealTimeLogs = [];

      this.workflowTraces.forEach(trace => {
        if (trace.real_time_logs && trace.real_time_logs.length > 0) {
          this.workflowRealTimeLogs.push(...trace.real_time_logs);
        }

        // Extract websocket connections and other events from trace spans
        if (trace.trace_details?.spans?.length > 0) {
          const allEvents = this.extractAllEventsFromSpans(trace.trace_details.spans);
          if (allEvents.length > 0) {
            this.workflowRealTimeLogs.push(...allEvents);
          }
        }
      });

      // If no real_time_logs found, try to fetch insights metrics
      if (this.workflowRealTimeLogs.length === 0) {
        console.log('No real_time_logs found in traces, attempting to fetch insights metrics');
        this.fetchInsightsMetrics(query.request_id);
      } else {
        console.log('Extracted insights real-time logs:', this.workflowRealTimeLogs);
      }

      this.isTracesLoading = false;
      this.cdRef.detectChanges();
    },
    error: (err: any) => {
      console.error('Error capturing insights traces:', err);

      // Even on error, try to create mock traces for display
      const agentsData = this.agents();
      if (agentsData && agentsData.length > 0) {
        this.workflowTraces = agentsData.map((agent, index) => ({
          trace_id: `insights_${query.request_id}_${agent.agent_id}`,
          agent_id: agent.agent_id,
          agent_name: agent.agent_name || `Agent ${index + 1}`,
          trace_summary: {
            trace_id: `insights_${query.request_id}_${agent.agent_id}`,
            agent_id: agent.agent_id,
            name: agent.agent_name || `Agent ${index + 1}`,
            trace_start_time: new Date().toISOString(),
            trace_end_time: new Date().toISOString(),
            trace_duration: 0,
            total_spans: 0,
            llm_input_tokens: 0,
            llm_output_tokens: 0,
            action_cost: 0
          },
          trace_details: {
            spans: [],
            input_messages: [],
            output_messages: { content: '' },
            chat_messages: { input_message: '', output_message: '' }
          },
          real_time_logs: [],
          captured_at: new Date().toISOString()
        }));

        this.workflowRealTimeLogs = [];
        console.log('Created mock insights traces on error');
      }

      this.isTracesLoading = false;
      this.cdRef.detectChanges();
    },
  });
}

private fetchInsightsMetrics(requestId: string): void {
  // This method can be used to fetch insights metrics from the logs
  // For now, it's a placeholder that can be implemented based on backend availability
  console.log('Fetching insights metrics for request_id:', requestId);
}

// Check if a value is a complex object (object or array)
isComplexObject(value: any): boolean {
  return value !== null && (typeof value === 'object' || Array.isArray(value));
}

// Format data for display
formatData(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

formatKey(key: unknown): string {
  if (typeof key !== 'string' || !key) {
    return String(key ?? '');
  }

  let formatted = key.replace(/_/g, ' ');
  formatted = formatted
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return formatted;
}

closeTraceDrawer(event?: MouseEvent | KeyboardEvent): void {
  if (event) {
    const target = (event.target as HTMLElement);
    if (!target.closest('.trace-viewer')) {
      this.clearTraceState();
    }
  } else {
    this.clearTraceState();
  }
}

// Add this method to your LyzrTraces component class
getFeatureLabelAndIcon(feature: string): [string, string] {
  // If the feature is in our mapping, return the mapped label and icon
  if (this.logFeatureLabelIconMapping[feature]) {
    return this.logFeatureLabelIconMapping[feature];
  }

  return [this.formatKey(feature), 'fa-info-circle'];
}
// Add a helper method to format values for display
formatValue(value: any): any {
  // Return the value as-is for logs
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : value;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.keys(value).length === 0 ? '{}' : value;
  }
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string' && value.trim() === '') {
    return '""';
  }
  return value;
}

hasAttributes(attrs: Record<string, any> | undefined): boolean {
  return !!attrs && Object.keys(attrs).length > 0;
}

filterEmptyEntries(entries: any[]): any[] {
  // For logs, we want to show all fields exactly as they are
  return entries;
}

expandedData: { [key: string]: boolean } = {};

toggleExpandedData(index: number, key: string): void {
  const dataKey = `${index}_${key}`;
  this.expandedData[dataKey] = !this.expandedData[dataKey];
}

isDataExpanded(index: number, key: string): boolean {
  const dataKey = `${index}_${key}`;
  return this.expandedData[dataKey] || false;
}

onSelectTrace(traceId: string) {
  // If clicking the same trace, just toggle the drawer
  if (this.selectedTraceId === traceId) {
    this.closeTraceDrawer();
    return;
  }

  // Clear previous state before setting new trace
  this.clearTraceState();
  this.selectedTraceId = traceId;

  if (!this.selectedTraceId) {
    return;
  }

  // Check if this is a workflow trace
  const workflowTrace = this.workflowTraces.find((t: IWorkflowTrace) => t.trace_id === traceId);
  if (workflowTrace) {
    // For workflow traces, we already have the details
    this.workflowTraceDetails = workflowTrace.trace_details;

    // Store real-time logs for this specific trace
    this.workflowRealTimeLogs = workflowTrace.real_time_logs || [];

    this.cdRef.detectChanges();
    return;
  }

  // For regular traces, fetch details from API
  const agent_id = this.agentId();
  const request_id = this.requestId();
  if (!agent_id || !request_id) return;

  this.isTraceDetailLoading = true;
  this.cdRef.detectChanges();
  const project = this.project();

  this.service
    .getLyzrTrace({ trace_id: this.selectedTraceId, agent_id, request_id,project})
    .subscribe({
      next: (res: any) => {
        this.traceDetails = res.data;
        this.isTraceDetailLoading = false;
        this.cdRef.detectChanges();

        // Extract real-time logs from the response
        if (this.traceDetails && (this.traceDetails as any).real_time_logs) {
          this.realTimeLogs = (this.traceDetails as any).real_time_logs;
        }

        if (!this.traceDetails) return;

        const { run_id, log_id, trace_id } = this.traceDetails;

        // Only fetch logs if we don't already have them
        if (!this.groupedLogs.length && run_id && log_id && trace_id) {
          this.isLogsLoading = true;
          this.service
            .getLyzrGroupedLogs({ run_id, agent_id, log_id, trace_id })
            .subscribe({
              next: (res: any) => {
                this.isLogsLoading = false;
                this.groupedLogs = res.data;
                this.cdRef.detectChanges();
              },
              error: () => {
                this.groupedLogs = [];
                this.isLogsLoading = false;
                this.cdRef.detectChanges();
              },
            });
        }
      },
      error: (err: any) => {
        this.traceDetails = undefined;
        this.groupedLogs = [];
        this.realTimeLogs = [];
        this.isTraceDetailLoading = false;
        this.isLogsLoading = false;
        this.cdRef.detectChanges();
      },
    });
}

// Update the onSelectTab method in the LyzrTraces component
onSelectTab(tab: string) {
  this.activeTab = tab;

  // For workflow traces (including insights), use real-time logs if available
  if (this.workflowTraceDetails && tab === 'logs') {
    // Clear previous logs first
    this.groupedLogs = [];
    this.logFeatureMapping = {};

    if (this.workflowRealTimeLogs && this.workflowRealTimeLogs.length > 0) {
      // Process workflow real-time logs (includes websocket events)
      this.processWorkflowRealTimeLogs();
    } else {
      // Don't create mock logs, just leave groupedLogs empty
      // This will trigger the "No Logs found" message
      this.isLogsLoading = false;
      this.cdRef.detectChanges();
    }
  } else if (this.traceDetails && tab === 'logs') {
    // For regular traces, use real-time logs if available, otherwise fetch grouped logs
    if (this.realTimeLogs && this.realTimeLogs.length > 0) {
      // Process real-time logs into the expected format
      this.processRealTimeLogs();
    } else if (!Object.keys(this.logFeatureMapping).length) {
      // Regular trace logs handling
      const agent_id = this.agentId();
      if (!agent_id) return;

      const { log_id, run_id, trace_id } = this.traceDetails;
      this.logFeatureMapping = {};

      this.isLogsLoading = !!this.groupedLogs.length;
      forkJoin(
        this.groupedLogs.map((log) =>
          this.service.getLyzrLogDetails({
            agent_id,
            log_id,
            run_id,
            trace_id,
            feature: log.feature,
          })
        )
      ).subscribe((res: any) => {
        this.isLogsLoading = false;
        res.forEach((logDetails: any) => {
          this.logFeatureMapping[logDetails.data[0].feature] = logDetails.data;
        });
        this.cdRef.detectChanges();
      });
    }
  }
}

// Update the processWorkflowRealTimeLogs method
processWorkflowRealTimeLogs() {
  this.isLogsLoading = true;
  this.groupedLogs = [];
  this.logFeatureMapping = {};

  // Check if there are any real-time logs
  if (!this.workflowRealTimeLogs || this.workflowRealTimeLogs.length === 0) {
    console.log('No workflow real-time logs found');
    this.isLogsLoading = false;
    // Keep groupedLogs empty to trigger "No Logs found" message
    this.cdRef.detectChanges();
    return;
  }

  console.log('Processing workflow real-time logs:', this.workflowRealTimeLogs);

  // Group logs by feature
  const logsByFeature: Record<string, any[]> = {};
  this.workflowRealTimeLogs.forEach((log: any) => {
    const feature = log.feature;
    if (!logsByFeature[feature]) {
      logsByFeature[feature] = [];
    }
    logsByFeature[feature].push(log);
  });

  // Create grouped logs and log feature mapping
  Object.keys(logsByFeature).forEach((feature) => {
    const log: IGroupedLog = {
      feature,
      start_time: logsByFeature[feature][0]?.timestamp || new Date().toISOString(),
      end_time: logsByFeature[feature].at(-1)?.timestamp || new Date().toISOString(),
      duration_seconds: 0,
      log_count: logsByFeature[feature].length
    };
    this.groupedLogs.push(log);

    // Create log details for each log
    const logDetails: ILogDetail[] = logsByFeature[feature].map((logData: any) => {
      // Create a data object that includes ALL fields from the log
      const data: any = {};

      // Copy all properties from the original log data
      Object.keys(logData).forEach(key => {
        data[key] = logData[key];
      });

      return {
        data: data,
        event_type: logData.event_type,
        feature: logData.feature || feature,
        level: logData.level || 'info',
        message: logData.message || `Log: ${logData.event_type}`,
        status: logData.status || 'completed',
        timestamp: logData.timestamp || new Date().toISOString(),
      };
    });

    this.logFeatureMapping[feature] = logDetails;
  });

  console.log('Processed grouped logs:', this.groupedLogs);
  console.log('Processed log feature mapping:', this.logFeatureMapping);

  this.isLogsLoading = false;
  this.cdRef.detectChanges();
}

processRealTimeLogs() {
  this.isLogsLoading = true;
  this.groupedLogs = [];
  this.logFeatureMapping = {};

  // Group logs by feature
  const logsByFeature: Record<string, any[]> = {};
  this.realTimeLogs.forEach((log: any) => {
    const feature = log.feature;
    if (!logsByFeature[feature]) {
      logsByFeature[feature] = [];
    }
    logsByFeature[feature].push(log);
  });

  // Create grouped logs and log feature mapping
  Object.keys(logsByFeature).forEach((feature) => {
    const log: IGroupedLog = {
      feature,
      start_time: logsByFeature[feature][0]?.timestamp || new Date().toISOString(),
      end_time: logsByFeature[feature].at(-1)?.timestamp || new Date().toISOString(),
      duration_seconds: 0,
      log_count: logsByFeature[feature].length
    };
    this.groupedLogs.push(log);

    // Create log details for each log
    const logDetails: ILogDetail[] = logsByFeature[feature].map((logData: any) => {
      // Create a data object that includes ALL fields from the log
      const data: any = {};

      // Copy all properties from the original log data
      Object.keys(logData).forEach(key => {
        data[key] = logData[key];
      });

      return {
        data: data,
        event_type: logData.event_type,
        feature: logData.feature || feature,
        level: logData.level || 'info',
        message: logData.message || `Log: ${logData.event_type}`,
        status: logData.status || 'completed',
        timestamp: logData.timestamp || new Date().toISOString(),
      };
    });

    this.logFeatureMapping[feature] = logDetails;
  });

  this.isLogsLoading = false;
  this.cdRef.detectChanges();
}

  createWorkflowLogsFromSpans() {
    if (!this.workflowTraceDetails?.spans) return;

    this.isLogsLoading = true;
    this.groupedLogs = [];
    this.logFeatureMapping = {};

    // Create mock logs based on spans
    const mockLogs: IGroupedLog[] = [];
    const spans = this.workflowTraceDetails.spans;

    spans.forEach((span, index) => {
      // Create a log entry for each span
      const log: IGroupedLog = {
        feature: span.SpanName || 'span_' + index,
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        duration_seconds: 0,
        log_count: 1 // Add this required property
      };
      mockLogs.push(log);

      // Create mock log details
      const logDetails: ILogDetail[] = [{
        data: {
          agent_name: span.SpanAttributes?.['agent_name'] ,
          session_id: span.SpanAttributes?.['session_id'] ,
        },
        event_type: 'span',
        feature: span.SpanName || 'span_' + index,
        level: 'info',
        message: `Span: ${span.SpanName}`,
        status: 'completed',
        timestamp: new Date().toISOString(),
      }];

      this.logFeatureMapping[log.feature] = logDetails;
    });

    this.groupedLogs = mockLogs;
    this.isLogsLoading = false;
    this.cdRef.detectChanges();
  }

  fetchTraces(query: ILyzrTraceQuery) {
    this.isTracesLoading = true;
    this.cdRef.detectChanges();

    this.service.getLyzrTraces(query).subscribe({
      next: (res: any) => {
        console.log("res", res);
        // Handle both response structures - direct array or nested in data
        let fetchedTraces = Array.isArray(res?.data) ? res.data : (res?.data?.traces || []);

        // Populate agent names from input agents data for traces that don't have them
        const agents = this.agents();
        if (agents && agents.length > 0) {
          fetchedTraces = fetchedTraces.map((trace: any) => ({
            ...trace,
            name: trace.name || this.getAgentNameForTrace(trace) || agents[0]?.agent_name || 'Unknown Agent'
          }));
        } else {
          // Even without agents input, try to populate name using agent_id fallback
          fetchedTraces = fetchedTraces.map((trace: any) => ({
            ...trace,
            name: trace.name || this.getAgentNameForTrace(trace) || 'Unknown Agent'
          }));
        }

        this.traces = fetchedTraces;
        console.log("traces", this.traces);
        console.log("agents input", agents);
        this.isTracesLoading = false;
        this.cdRef.detectChanges();
      },
      error: () => {
        this.traces = [];
        this.isTracesLoading = false;
        this.cdRef.detectChanges();
      },
    });
  }

  getJson(object: object) {
    return JSON.stringify(object || {}, null, 2);
  }

  get messages() {
    const obj = { input: '', output: '' };

    // For workflow traces, extract input/output from spans
    if (this.workflowTraceDetails) {
      const spans = this.workflowTraceDetails.spans || [];
      // Find the first span with chat_messages (usually the inference span)
      const chatSpan = spans.find((span: any) =>
        span.SpanName === 'inference' &&
        (span as any).chat_messages
      );
      if (chatSpan) {
        obj.input = (chatSpan as any).chat_messages?.input_message || '';
        obj.output = (chatSpan as any).chat_messages?.output_message || '';
      }

      return obj;
    }

    if (!this.traceDetails) return obj;

    // For regular traces, first try to extract from chat_messages at the top level
    const chatMessages = (this.traceDetails as any).chat_messages;
    if (chatMessages && typeof chatMessages === 'object' &&
      (chatMessages.input_message || chatMessages.output_message)) {
      obj.input = chatMessages.input_message || '';
      obj.output = chatMessages.output_message || '';
      return obj;
    }

    // If not found at top level, check inside spans (for insights traces)
    if ((this.traceDetails as any).spans && Array.isArray((this.traceDetails as any).spans)) {
      const spans = (this.traceDetails as any).spans;
      for (const span of spans) {
        if (span.chat_messages &&
          (span.chat_messages.input_message || span.chat_messages.output_message)) {
          obj.input = span.chat_messages.input_message || '';
          obj.output = span.chat_messages.output_message || '';
          return obj;
        }
      }
    }

    // Final fallback to input_messages and output_messages
    const { input_messages, output_messages } = this.traceDetails;
    obj.input = input_messages?.find((item: any) => item.role === 'user')?.content || '';
    obj.output = output_messages?.content || '';

    return obj;
  }

  // Helper method to get the current trace details (either regular or workflow)
  get currentTraceDetails() {
    // For workflow traces, return the actual spans
    if (this.workflowTraceDetails) {
      const firstSpan = this.workflowTraceDetails.spans?.[0];

      // Get agent_name from the selected workflow trace or from agents input
      let agentName = this.workflowTraces[0]?.agent_name || '';
      const agents = this.agents();
      if (!agentName && agents && agents.length > 0) {
        agentName = agents[0].agent_name || '';
      }

      return {
        spans: this.workflowTraceDetails.spans || [],
        chat_messages: { input_message: '', output_message: '' },
        input_messages: [],
        output_messages: { content: '' },
        agent_name: agentName,
        agent_id: this.workflowTraces[0]?.agent_id || '',
        llm_provider: firstSpan?.SpanAttributes?.['llm_provider'] || '',
        language_model: firstSpan?.SpanAttributes?.['llm_model'] || '',
        latency_ms: 0,
        cost: 0,
        total_tokens: 0,
        tool_actions: 0,
        run_id: '',
        trace_id: this.selectedTraceId,
        log_id: '',
        real_time_logs: this.workflowRealTimeLogs || [] // Use workflow real-time logs
      };
    }

    // For regular traces, return the actual traceDetails or a default object
    return (this.traceDetails ? {
      ...this.traceDetails,
      // Ensure chat_messages is handled properly
      chat_messages: this.traceDetails.chat_messages && Object.keys(this.traceDetails.chat_messages).length > 0
        ? this.traceDetails.chat_messages
        : { input_message: '', output_message: '' },
      real_time_logs: this.realTimeLogs || [] // Add real-time logs using type assertion
    } : {
      spans: [],
      chat_messages: { input_message: '', output_message: '' },
      input_messages: [],
      output_messages: { content: '' },
      agent_name: '',
      agent_id: '',
      llm_provider: '',
      language_model: '',
      latency_ms: 0,
      cost: 0,
      total_tokens: 0,
      tool_actions: [],
      run_id: '',
      trace_id: '',
      log_id: '',
      real_time_logs: this.realTimeLogs || [] // Add real-time logs for regular traces
    });
  }

  // Helper method to check if we have workflow traces
  get hasWorkflowTraces(): boolean {
    return this.workflowTraces && this.workflowTraces.length > 0;
  }

  // Helper method to get workflow traces as ILyzrTrace format for the table
  // Helper method to get agent name from trace or from input agents data
  private getAgentNameForTrace(trace: any): string {
    // First, try to get from trace.agent_name
    if (trace.agent_name && trace.agent_name.trim()) {
      return trace.agent_name;
    }

    // If not found, try to match from input agents data by agent_id
    const agents = this.agents();
    if (agents && agents.length > 0 && trace.agent_id) {
      const matchingAgent = agents.find(agent => agent.agent_id === trace.agent_id);
      if (matchingAgent && matchingAgent.agent_name && matchingAgent.agent_name.trim()) {
        return matchingAgent.agent_name;
      }
    }

    // If still not found and we have agents, use the first one's name
    if (agents && agents.length > 0 && agents[0].agent_name && agents[0].agent_name.trim()) {
      return agents[0].agent_name;
    }

    // Last resort: return agent_id instead of empty string
    if (trace.agent_id) {
      return `Agent: ${trace.agent_id.substring(0, 8)}...`;
    }

    return 'Unknown Agent';
  }

  get workflowTracesAsLyzrTraces(): ILyzrTrace[] {
    return this.workflowTraces.map(trace => {
      const agentName = this.getAgentNameForTrace(trace);
      console.log(`Trace ${trace.trace_id} agent name:`, agentName, 'from trace.agent_name:', trace.agent_name);
      return {
        trace_id: trace.trace_id,
        name: agentName,
        trace_start_time: trace.trace_summary?.trace_start_time || '',
        trace_duration: trace.trace_summary?.trace_duration || 0,
        llm_input_tokens: trace.trace_summary?.llm_input_tokens || 0,
        llm_output_tokens: trace.trace_summary?.llm_output_tokens || 0,
        action_cost: trace.trace_summary?.action_cost || 0,
        runs: []
      };
    });
  }

  // Helper method to check if current trace is a workflow trace
  get isWorkflowTrace(): boolean {
    return !!this.workflowTraceDetails;
  }
}
