import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable,Subject,of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ApiResponse } from '../types/common'; 
import { environment } from '../../environments/environment';

export interface TryPromptData {
  agent: any;
  query: any;
}

@Injectable({
  providedIn: 'root'
})
export class PromptRepositoryService {
  constructor(private http: HttpClient) { }

  private tryPromptSource = new Subject<TryPromptData>();
  tryPrompt$ = this.tryPromptSource.asObservable();

  triggerTryPrompt(data: TryPromptData) {
    this.tryPromptSource.next(data);
  }

  getAgencyWithAgentsEnhanced(): Observable<ApiResponse<any>> {
    return this.http.get(`/GetAgencyWithAgentsEnhanced`, { responseType: 'text' }).pipe(
      map((rawResponse: string) => {
        // Sanitize invalid JSON tokens
        const sanitized = this.sanitizeJsonString(rawResponse);
        
        // Parse the cleaned JSON
        const parsed = JSON.parse(sanitized);
        
        return parsed as ApiResponse<any>;
      }),
      catchError((error) => {
        console.error('Error in getAgencyWithAgentsEnhanced:', error);
        
        // Return empty response structure on error so UI doesn't break
        return of({
          success: false,
          data: [],
          message: error?.message || 'Failed to fetch agencies'
        } as unknown as ApiResponse<any>);  // ✅ Fixed: cast via unknown
      })
    );
  }

  sanitizeJsonString(jsonString: string): string {
    let sanitized = jsonString;
    
    // Replace NaN values with null
    sanitized = sanitized.replace(/:\s*NaN\b/g, ': null');
    
    // Replace Infinity values with null
    sanitized = sanitized.replace(/:\s*Infinity\b/g, ': null');
    
    // Replace -Infinity values with null
    sanitized = sanitized.replace(/:\s*-Infinity\b/g, ': null');
    
    return sanitized;
  }
  
  savePrompt(params: any) {
    return this.http.post<ApiResponse<any>>(`/SavePrompt`, params);
  }
  
  UpdatePrompt(params: any) {
    return this.http.post<ApiResponse<any>>(`/UpdatePrompt`, params);
  }

  batchUpdatePrompts(params: any) {
    return this.http.post<ApiResponse<any>>(`/BatchUpdate`, params);
  }

  DeletePrompt(params: any) {
    return this.http.post<ApiResponse<any>>(`/DeletePrompt`, params);
  }

deduplicatePromptTitles(params: any = {}): Observable<ApiResponse<any>> {
  return this.http.post<ApiResponse<any>>(`/recoverDuplicateTitle`, params);
}

}