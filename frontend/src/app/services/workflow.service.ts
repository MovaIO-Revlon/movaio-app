import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  ApiResponse,
  ICreateWorkflowRequest,
  IImportWorkflowRequest,
  IUpdateWorkflowRequest,
  IWorkflow,
} from '../types';

@Injectable({
  providedIn: 'root',
})
export class WorkflowService {
  constructor(private _http: HttpClient) {}

  getWorkflows() {
    return this._http.get<ApiResponse<IWorkflow[]>>(`/workflows`);
  }

  getWorkflow(flowId: string) {
    return this._http.get(`/workflows/${flowId}`);
  }

  createWorkflow(payload: ICreateWorkflowRequest) {
    return this._http.post(`/workflows`, payload);
  }

  importWorkflow(payload: IImportWorkflowRequest) {
    return this._http.post(`/workflows/import`, payload);
  }

  updateWorkflow({ flowId, ...payload }: IUpdateWorkflowRequest) {
    return this._http.put(`/workflows/${flowId}`, payload);
  }

  deleteWorkflow(flowId: string) {
    return this._http.delete(`/workflows/${flowId}`);
  }

  getAgenciesForDropdown() {
    return this._http.get<ApiResponse<unknown[]>>(`/GetAgencyWithAgents`);
  }
  getWorkflowStatistics() {
    return this._http.get<ApiResponse<any>>(`/getWorkflowStatistics`);
  }
}
