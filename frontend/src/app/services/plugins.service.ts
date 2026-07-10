import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  ICreateRolesRequest,
  ICreateTeamsRequest,
  IRole,
  ITeam,
  IUpdateRoleRequest,
  IUpdateTeamRequest,
  ApiResponse,
} from '../types';

@Injectable({
  providedIn: 'root',
})
export class PluginsService {
  constructor(private http: HttpClient) {}

  fetchAllPlugins(){
    return this.http.get<ApiResponse<any>>(`/getAllPlugins`);
  }

  fetchPlugin(pluginId: string){
    return this.http.get<ApiResponse<any>>(`/getPlugin/${pluginId}`);
  }

  updatePlugin(data: any){
    return this.http.put<ApiResponse<any>>(`/updatePlugin`, data);
  }

  deletePlugin(pluginId: string){
    return this.http.delete<ApiResponse<any>>(`/deletePlugin/${pluginId}`);
  }
  
}
