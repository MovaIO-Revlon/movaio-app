import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiResponse } from '../types/common';

@Injectable({
  providedIn: 'root'
})
export class ExternalAppServices {

  constructor(private http: HttpClient) { }

  registerExternalApplication(payload: any): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`/registerExternalApplication`, payload).pipe(
      catchError((error) => {
        console.error('Error in registerExternalApplication:', error);
        return of({
          success: false,
          data: null,
          message: error?.error?.message || error?.message || 'Failed to register external application'
        } as unknown as ApiResponse<any>);
      })
    );
  }

  updateExternalApplication(applicationId: string, payload: any): Observable<ApiResponse<any>> {
  return this.http.post<ApiResponse<any>>(
    `/updateExternalApplication/${applicationId}`,
    payload).pipe(
      catchError((error) => {
        console.error('Error in updateExternalApplication:', error);
        return of({
          success: false,
          data: null,
          message: error?.error?.message || error?.message || 'Failed to update external application'
        } as unknown as ApiResponse<any>);
      })
    );
  }


  getExternalApplications(): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`/getExternalApplications`).pipe(
      catchError((error) => {
        console.error('Error in getExternalApplications:', error);
        return of({
          success: false,
          data: [],
          message: error?.message || 'Failed to fetch external applications'
        } as unknown as ApiResponse<any>);
      })
    );
  }

  getExternalApplicationById(applicationId: string): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`/getExternalApplication/${applicationId}`).pipe(
      catchError((error) => {
        console.error('Error in getExternalApplicationById:', error);
        return of({
          success: false,
          data: null,
          message: error?.message || 'Failed to fetch external application'
        } as unknown as ApiResponse<any>);
      })
    );
  }
   deleteExternalApplication(applicationId: string): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`/deleteExternalApplication/${applicationId}`, {}).pipe(
      catchError((error) => {
        console.error('Error in deleteExternalApplication:', error);
        return of({
          success: false,
          data: null,
          message: error?.error?.message || error?.message || 'Failed to delete external application'
        } as unknown as ApiResponse<any>);
      })
    );
  }

}