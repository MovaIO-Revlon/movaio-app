import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ApiResponse, IAgent } from '../types';

@Injectable({
  providedIn: 'root',
})
export class QemarketplaceService {
  constructor(private _http: HttpClient) {}

  onboardInternalAgent(params: any) {
    return this._http.post<ApiResponse<null>>(`/AddAgentDetails`, params);
  }

  onboardExternalAgent(params: any) {
    return this._http.post<ApiResponse<null>>(`/AddExternalAgent`, params);
  }
  getAgentDetails() {
    return this._http.post<ApiResponse<IAgent[]>>(`/GetAllAgents`, null);
  }

  updateAgentDetails(payload: any) {
    return this._http.put<ApiResponse<null>>(
      `/UpdateAgentDetails/${payload.agent_id}`,
      payload
    );
  }
  getAllDropdowns() {
    return this._http.get<
      ApiResponse<
        Record<
          | 'mcp_connectors'
          | 'ai_models'
          | 'roles'
          | 'agent_types'
          | 'agent_providers'
          | 'knowledge_store'
          | 'ai_foundations',
          { label: string; value: string }[]
        >
      >
    >(`/dropdowns/all`);
  }

  getAgentCounts() {
    return this._http.get<
      ApiResponse<{
        total_agents: number;
        active_agents: number;
        trending_agents: number;
      }>
    >(`/agentcounts`);
  }

  getProviderDetails(params: any) {
    return this._http.post<
      ApiResponse<{ provider_url: string; provider_key: string }>
    >(`/GetProviderDetails`, params);
  }
}
