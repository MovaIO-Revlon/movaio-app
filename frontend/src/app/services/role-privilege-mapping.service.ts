import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiResponse, IRole } from '../types';

@Injectable({
  providedIn: 'root', // Makes the service available globally
})
export class RolePrivilegeMappingService {
  private privilegeData = new BehaviorSubject<any[]>([]);
  privilegeData$ = this.privilegeData.asObservable();

  constructor(private _http: HttpClient) {}

  getRoles() {
    return this._http.get<ApiResponse<IRole[]>>(`/roles`);
  }

  getPermissions() {
    return this._http.get<ApiResponse<unknown[]>>(`/permissions`);
  }

  getPermissionsForRole(request_json: any) {
    return this._http.post<ApiResponse<unknown[]>>(`/permissions`, request_json);
  }

  updatePermissions(
    request_json: any
  ) {
    return this._http.put<
      ApiResponse<{
        Matched: number;
        Modified: number;
        UpsertedId: string;
      }>
    >(`/permissions`, request_json);
  }
  // Update privilege data
  setPrivileges(data: any[]) {
    this.privilegeData.next(data);
  }

  // Get current value (snapshot)
  getCurrentPrivileges() {
    return this.privilegeData.value;
  }

  getAllPages() {
    return this._http.get<ApiResponse<unknown[]>>(`/getPageConfiguration`)
  }
}
