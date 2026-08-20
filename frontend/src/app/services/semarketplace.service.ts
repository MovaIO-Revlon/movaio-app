import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ApiResponse,
  IAgency,
  IAgent,
  IConnectionData,
  IConnection,
  ISchemaForAgent,
  ISearchIndex,
  ITool,
  TConnectorType,
  IFunctionJson,
} from '../types';
import { abort } from '../utils';

@Injectable({
  providedIn: 'root',
})
export class SemarketplaceService {
  constructor(private readonly _http: HttpClient) {}
  //#region MarkerPlace/Agent-Services
  onboardInternalAgent(params: any) {
    return this._http.post<ApiResponse<null>>(`/AddAgentDetails`, params);
  }

  onboardExternalExistingAgent(params: any) {
    return this._http.post<ApiResponse<null>>(`/AddExternalAgent`, params);
  }

  onboardExternalNewAgent(params: any) {
    return this._http.post<ApiResponse<null>>(
      `/AddUpdateExternalNewAgent`,
      params,
    );
  }

  getAgentDetails() {
    return this._http.post<ApiResponse<IAgent[]>>(`/GetAllAgents`, null);
  }

  getAgentDetailsById(agentId: string) {
    return this._http.get<ApiResponse<IAgent>>(
      `/GetAgentDetailsForApproval/${agentId}`,
    );
  }

  updateAgentDetails(payload: any) {
    return this._http.put<ApiResponse<null>>(
      `/UpdateAgentDetails/${payload.agent_id}`,
      payload,
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
  deleteAgent(agentId: string) {
    return this._http.post<ApiResponse<null>>(`/DeleteAgent/${agentId}`, null);
  }

  deleteAgentWithApproval(params: any) {
    return this._http.post<ApiResponse<null>>(
      `/DeleteAgentWithApproval`,
      params,
    );
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
  //#endregion

  //#region MarkerPlace/Agency-Services
  getAgencyWithAgentsById(agencyId: string): Observable<any> {
    return this._http.get(`/GetAgencyWithAgents/${agencyId}`);
  }

  getAgencytype() {
    return this._http.get<ApiResponse<unknown[]>>(`/agencytypes`);
  }

  onboardAgencyWithAgents(params: any) {
    return this._http.post<
      ApiResponse<{
        agency_id: string;
        agency_type_counts: Record<string, number>;
      }>
    >(`/OnboardAgencyWithAgents`, params);
  }

  getAgencyWithAgents() {
    return this._http.get<ApiResponse<IAgency[]>>(`/GetAgencyWithAgents`);
  }

  getTrendingAgencyStats() {
    return this._http.get<
      ApiResponse<{
        total_agencies: number;
        trending_agencies: number;
        filter_status: string;
        agencies: unknown[];
      }>
    >(`/agency/stats`);
  }

  getAllAgencies() {
    return this._http.get<ApiResponse<IAgent[]>>(`/GetTaskAgentsDetails`);
  }

  getAutomationLibraries() {
    return this._http.get<ApiResponse<unknown[]>>(`/automationLibrary`);
  }

  getAutomationLibraryById(libraryId: string) {
    return this._http.get<ApiResponse<any>>(`/automationLibrary/${libraryId}`);
  }

  getAutomationScriptTypes() {
    return this._http.get<ApiResponse<any[]>>(`/GetAutomationScriptTypes`);
  }

  addAutomationLibrary(params: FormData) {
    return this._http.post<ApiResponse<any>>(`/AddAutomationLibrary`, params);
  }

  updateAutomationLibrary(params: FormData) {
    return this._http.post<ApiResponse<any>>(
      `/UpdateAutomationLibrary`,
      params,
    );
  }

  deleteAutomationLibrary(libraryId: string) {
    return this._http.delete<ApiResponse<any>>(
      `/DeleteAutomationLibrary/${libraryId}`,
    );
  }

  deleteAgencyDetails(agencyId: any): Observable<any> {
    return this._http.delete<any>(`/DeleteAgencyDetails/${agencyId}`);
  }

  GetAgentAndOrder2Agents(params: any) {
    return this._http.post<
      ApiResponse<{ main_agent: unknown; order_2_agents: unknown[] }>
    >(`/GetAgentAndOrder2Agents`, params);
  }

  getAgentsByAgency(params: any) {
    return this._http.post<
      ApiResponse<{ mappings: unknown[]; agents: IAgent[] }>
    >(`/AgencyMappings`, params);
  }
  getUpdatedExternalData(params: any) {
    return this._http.post<ApiResponse<boolean>>(`/LatestAgentDetails`, params);
  }
  //#endregion

  //#region KnowledgeStore-Services
  getKnowledgeStoreCounts() {
    return this._http.get<ApiResponse<{ total_knowlegeGraph: number }>>(
      `/getKnowledgestoreDetailsCounts`,
    );
  }

  getKnowledgeStoreDetails() {
    return this._http.post<ApiResponse<{ _id: string }[]>>(
      `/GetKnowledgeStoreDetails`,
      null,
    );
  }

  getKnowledgeStoreDocDetails(rag_id: any) {
    return this._http.post<ApiResponse<string[]>>(
      `/GetKnowledgeStoreDocDetails/${rag_id}`,
      null,
    );
  }

  getMCPConnectorsDetails() {
    return this._http.post<{ indexes: ISearchIndex[] }>(
      `/insights/opensearchindex`,
      null,
    );
  }

  getColumnsForExcelUpload(params: FormData) {
    return this._http.post<{
      columns: string[];
      schema_for_agent: ISchemaForAgent;
    }>(`/insights/extractcolumn`, params);
  }

  getSheetsForExcelUpload(params: any) {
    return this._http.post<{ sheet_names: string[]; status: string }>(
      `/insights/extractsheet`,
      params,
    );
  }

  ingestandUpdateDocMcp(params: any) {
    return this._http.post<ApiResponse<null>>(
      `/insights/ingestandupdatedoc`,
      params,
    );
  }

  getMCPDataForIndex(params: { index_id: string }) {
    return this._http.post<{ data: ISearchIndex; status: string }>(
      `/insights/indexbyid`,
      params,
    );
  }

  syncMCPToOpenSearch(params: { index_id: string; index_name: string }) {
    return this._http.post<{ status: string; message: string }>(
      `/insights/opensearchingestandupdate`,
      params,
    );
  }

  deleteMCPConnector(params: { index_id: string; index_name: string }) {
    return this._http.post<{ status: string; message: string }>(
      `/insights/deleteindex`,
      params,
    );
  }

  getMCPStatistics() {
    return this._http.get<{
      data: {
        connector_count: number;
        mcp_connector_count: Record<string, number>;
        mcp_count: number;
        total_entity_count: number;
        mcp_entity_count: Record<string, number>;
      };
      message: string;
      success: boolean;
    }>(`/getMCPStatistics`);
  }

  authenticateTool(params: {
    client_id: string;
    client_secret: string;
    auth_url: string;
    connector_type: string;
  }) {
    return this._http.post<ApiResponse<null>>(`/toolauthentication`, params);
  }

  saveConnection(params: {
    connection_name: string;
    connector: string;
    user_id: string;
    credentials?: Record<string, any>;
    connector_id: string;
    connection_id?: string;
    auth: string;
    custom_tool: {
      id?: string;
      action_name: string;
      action_desc: string;
      parameters: IFunctionJson;
    }[];
    tools_order: string[];
  }) {
    return this._http.post<ApiResponse<null>>(`/saveconnection`, params);
  }

  fetchConnection() {
    return this._http.post<
      ApiResponse<
        {
          connections: IConnection[];
          connector_type: TConnectorType;
        }[]
      >
    >(`/fetchconnection`, {});
  }

  removeConnector(id: string) {
    return this._http.delete<ApiResponse<null>>(`/deleteconnection/${id}`);
  }

  getConnectionData(connectionId: string) {
    return this._http.get<ApiResponse<Record<string, IConnectionData>>>(
      `/getconnectiondata/${connectionId}`,
    );
  }

  getAllTools() {
    return this._http.get<ApiResponse<ITool[]>>(`/tools`);
  }

  getVoiceAgents() {
    return this._http.post<
      ApiResponse<
        (IAgent & {
          agencies: { agency_id: string; agency_name: string; team: string }[];
        })[]
      >
    >(`/GetAllVoiceAgents`, null);
  }

  getKGStatistics() {
    return this._http.get<
      ApiResponse<{
        agencies_by_team: Record<string, number>;
        total_agencies: number;
      }>
    >(`/GetKnowledgeStoreStatistics`);
  }

  getAgencyStatistics() {
    return this._http.get<
      ApiResponse<{
        agencies_by_team: Record<string, number>;
        total_agencies: number;
      }>
    >(`/AgencyStatistics`);
  }

  getJiraProjects(
    params: {
      username: string;
      api_token: string;
      connector_url: string;
    },
    signal: AbortSignal,
  ) {
    return this._http
      .post<{
        project_keys: string[];
        status: string;
      }>(`/insights/jiraprojectkey`, params)
      .pipe(abort(signal));
  }

  getJiraFieldsSchema(
    params:
      | {
          tool: 'jira';
          api_token: string;
          username: string;
          connector_url: string;
          project_key: string;
        }
      | {
          tool: 'teamdynamics';
          app_id: string;
          username: string;
          connector_url: string;
          password: string;
        },
  ) {
    return this._http.post<ApiResponse<unknown>>(
      `/insights/fetchjiradata`,
      params,
    );
  }

  checkDuplicateIndex(params: { index_name: string }) {
    return this._http.post<{
      exists: boolean;
      status: string;
    }>(`/insights/checkindex`, params);
  }

  getTeamDynamixApplications(
    params: {
      username: string;
      password: string;
      connector_url: string;
    },
    signal: AbortSignal,
  ) {
    return this._http
      .post<{
        app_ids: string[];
        message: string;
        status: string;
      }>(`/insights/fetchappid`, params)
      .pipe(abort(signal));
  }

  // region for agent crud apis for new lyzr agent
  getKgsFromLyzr() {
    return this._http.get<ApiResponse<any>>(`/lyzr/getKnowledgeBase`);
  }

  getToolsFromLyzr() {
    return this._http.get<ApiResponse<any>>(`/lyzr/getTools`);
  }

  getProviderModelsFromLyzr() {
    return this._http.get<ApiResponse<any>>(`/lyzr/getProvidersModel`);
  }

  getProviderMemoryFromLyzr() {
    return this._http.get<ApiResponse<any>>(`/lyzr/getProviderMemory`);
  }

  getSemanticDataFromLyzr() {
    return this._http.get<ApiResponse<any>>(`/lyzr/getSemanticData`);
  }

  getMCPConnectorsFromLyzr() {
    return this._http.get<ApiResponse<any>>(`/lyzr/getMCPServers`);
  }

  getContextsFromLyzr() {
    return this._http.get<ApiResponse<any>>(`/lyzr/getContext`);
  }

  generateWithAI(params: any) {
    return this._http.post<ApiResponse<any>>(`/lyzr/generatewithAI`, params);
  }

  getApproverEmailsList() {
    return this._http.get<ApiResponse<string[]>>(`/getApproversList`);
  }

  getAgentVersionHistory(params: any) {
    return this._http.post<ApiResponse<any[]>>(
      `/fetchAgentVersionHistory`,
      params,
    );
  }

  getAgentVersionDetails(params: any) {
    return this._http.post<ApiResponse<any[]>>(
      `/fetchAgentVersionDetails`,
      params,
    );
  }

  deleteAgentVersion(agentId: string, version: string) {
    return this._http.delete<ApiResponse<any>>(
      `/agents/${agentId}/versions/${version}`,
    );
  }

  agentApprovalAction(
    agentId: string,
    action: 'Approved' | 'Rejected',
    approvalAction: string,
  ) {
    let params = {};
    return this._http.post<ApiResponse<any[]>>(
      `/approvalAPI/${agentId}/${approvalAction}/${action}`,
      params,
    );
  }

  //#endregion
}
