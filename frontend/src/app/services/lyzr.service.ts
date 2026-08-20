import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  ApiResponse,
  IGroupedLog,
  ILogDetail,
  ILyzrGroupedLogDetailsQuery,
  ILyzrGroupedLogsQuery,
  ILyzrTrace,
  ILyzrTraceDetails,
  ILyzrTraceQuery,
  IWorkflowTrace,
  ILyzrTraceDetailsQuery,
  IWorkflowTraceQuery,
  IWorkflowTraceResponse
} from '../types';

@Injectable({
  providedIn: 'root',
})
export class LyzrService {
  constructor(private http: HttpClient) {}

  getLyzrTraces(payload: ILyzrTraceQuery) {
    const query = new URLSearchParams();
    query.append('agent_id', payload.agent_id);
    query.append('start_date', payload.start_date);
    query.append('end_date', payload.end_date);

    return this.http.get<ApiResponse<{ count: number; traces: ILyzrTrace[] }>>(
      `/traces?${query}`
    );
  }

  getLyzrTrace({ trace_id, request_id, agent_id, project }: ILyzrTraceDetailsQuery& { project?: string }) {
    const query = new URLSearchParams();
    query.append('agent_id', agent_id);
    query.append('request_id', request_id);
    if (project) {
    query.append('project', project);     
  }

    return this.http.get<ApiResponse<ILyzrTraceDetails>>(
      `/trace/${trace_id}?${query}`
    );
  }

captureWorkflowAgentTraces(payload: IWorkflowTraceQuery) {
    const body = {
      workflow_id: payload.workflow_id,
      event_id: payload.event_id,
      limit: payload.limit || 10,
      agents: payload.agents,
      project: payload.project
    };

    console.log('Making API call to capture-workflow-agent-traces with body:', body); // Debug log

    return this.http.post<IWorkflowTraceResponse>(
      '/capture-workflow-agent-traces',
      body
    );
  }
  getLyzrGroupedLogs({
    run_id,
    log_id,
    trace_id,
    agent_id,
  }: ILyzrGroupedLogsQuery) {
    const query = new URLSearchParams();
    query.append('run_id', run_id);
    query.append('log_id', log_id);
    query.append('trace_id', trace_id);
    query.append('agent_id', agent_id);

    return this.http.get<ApiResponse<IGroupedLog[]>>(
      `/grouped-logs?${query}`
    );
  }

  getLyzrLogDetails({
    run_id,
    log_id,
    trace_id,
    agent_id,
    feature
  }: ILyzrGroupedLogDetailsQuery) {
    const query = new URLSearchParams();
    query.append('run_id', run_id);
    query.append('log_id', log_id);
    query.append('trace_id', trace_id);
    query.append('agent_id', agent_id);
    query.append('feature', feature);

    return this.http.get<ApiResponse<ILogDetail[]>>(
      `/log-details?${query}`
    );
  }
  
}