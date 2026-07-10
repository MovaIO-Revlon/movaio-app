import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map, catchError } from 'rxjs';
import { ApiResponse } from '../types/common';

export interface AgentEvalRequest {
  agent_id: string;
  evaluation_type: 'offline' | 'online';
  data_set: 'input-output' | 'trace';
  input_data: (string | object)[];
  output_data?: (string | object)[];
  trace_data?: (string | object)[];
}

export interface FetchEvalRequest {
  agent_id: string;
  evaluation_type: string;
  data_set: 'Input/Output Data' | 'Trace Data';
}

export interface FetchEvalResult {
  input_data: any[] | null;
  output_data: any[] | null;
  trace_data: any[] | null;
  expected_output: any[] | null;
  [key: string]: any;
}

export interface AgentEvalMetrics {
  correctness: number;
  relevance: number;
  safety: number;
  completeness: number;
  fluency: number;
  coherence: number;
  conciseness: number;
  accuracy: number;
  status: number;
  hallucination_rate: number;
  toxicity_score: number;
  [key: string]: number;
}

export interface AgentEvalDetailedResult {
  inputs: any;
  outputs: any;
  correctness: number;
  relevance: number;
  safety: number;
  completeness: number;
  fluency: number;
  coherence: number;
  conciseness: number;
  accuracy: number;
  status: number;
  hallucination_rate: number;
  toxicity_score: number;
  [key: string]: any;
}

export interface AgentEvalResponse {
  evaluation_id: string;
  status: 'in_progress' | 'completed' | 'failed';
  metrics: AgentEvalMetrics | null;
  detailed_results: AgentEvalDetailedResult[] | null;
  input_data: any[] | null;
  output_data: any[] | null;
  error: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class AgentEvalService {

  constructor(
    private _http: HttpClient,
  ) { }

   evaluateAgent(payload: AgentEvalRequest): Observable<ApiResponse<any>> {
    return this._http.post('/agent-evaluation', payload, { 
      responseType: 'text' 
    }).pipe(
      map((responseText: string) => this.sanitizeAndParse(responseText))
    );
  }

   fetchEvaluationData(params: FetchEvalRequest): Observable<ApiResponse<FetchEvalResult>> {
    const httpParams = new HttpParams()
      .set('agent_id', params.agent_id)
      .set('evaluation_type', params.evaluation_type)
      .set('data_set', params.data_set);

    return this._http.get('/agent-evaluation/fetch', { 
      params: httpParams, 
      responseType: 'text' 
    }).pipe(
      map((responseText: string) => this.sanitizeAndParse(responseText))
    );
  }

  // Common sanitizer for both GET and POST
  private sanitizeAndParse(responseText: string): any {
    if (!responseText || responseText.trim() === '') {
      throw new Error('Empty response received from server');
    }

    // Replace invalid JSON values: NaN, Infinity, -Infinity
    let sanitized = responseText
      .replace(/:\s*NaN\b/g, ': null')
      .replace(/:\s*Infinity\b/g, ': null')
      .replace(/:\s*-Infinity\b/g, ': null');

    try {
      return JSON.parse(sanitized);
    } catch (parseError) {
      console.error('JSON Parse Error after sanitization:', parseError);
      console.error('First 400 chars of response:', responseText.substring(0, 400));
      throw parseError;
    }
  }
 
}
