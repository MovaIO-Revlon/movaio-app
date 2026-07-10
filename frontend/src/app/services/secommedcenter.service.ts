import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse, IInsight } from '../types';

@Injectable({
  providedIn: 'root',
})
export class secommendcenter {
  constructor(private _http: HttpClient) {}

  //#region CommendCenter/TestCase

  testCaseGenerate(params: any): Observable<any> {
    return this._http.post<any>(`/langflow`, params);
  }

  gettestCases(params: any): Observable<any> {
    return this._http.post<any>(`/GetEventResponse`, params);
  }

  gettestevents(params: any): Observable<any> {
    return this._http.post<any>(`/GetEvents`, params);
  }
  //#endregion

  //#region CommendCenter/Insights
  GetInsightAgents() {
    return this._http.get<ApiResponse<IInsight[]>>(`/GetInsightAgentsDetails`);
  }
  //#endregion

  //#endregion CommendCenter/Knowledge_Graph
  GetGraphData(params: any) {
    return this._http.post<
      ApiResponse<{
        node_labels: unknown[];
        relationship_types: unknown[];
        nodes: unknown[];
        edges: unknown[];
      }>
    >(`/getGraphData`, params);
  }
  getKnowledgeGraphDropdownDetails() {
    return this._http.get<ApiResponse<unknown[]>>(`/getKnowlegeGraphDetails`);
  }
  //#endregion
}
