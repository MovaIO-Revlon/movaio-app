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
export class RolesTeamsService {
  constructor(private http: HttpClient) {}

  fetchRoles() {
    return this.http.get<ApiResponse<IRole[]>>(`/roles/active`);
  }

  createRole(payload: ICreateRolesRequest) {
    return this.http.post<ApiResponse<{ RoleId: number; RoleName: string }[]>>(
      `/roles`,
      payload
    );
  }

  updateRole({ role_id, ...payload }: IUpdateRoleRequest) {
    return this.http.put<ApiResponse<{}>>(`/roles/${role_id}`, payload);
  }

  deleteRole(role_id: number) {
    return this.http.delete<ApiResponse<{}>>(`/roles/${role_id}`);
  }

  fetchTeams() {
    return this.http.get<ApiResponse<ITeam[]>>(`/teams/active`);
  }

  createTeam(payload: ICreateTeamsRequest) {
    return this.http.post<ApiResponse<{ TeamId: number; TeamName: string }[]>>(
      `/teams`,
      payload
    );
  }

  updateTeam({ team_id, ...payload }: IUpdateTeamRequest) {
    return this.http.put<ApiResponse<{}>>(`/teams/${team_id}`, payload);
  }

  deleteTeam(team_id: number) {
    return this.http.delete<ApiResponse<{}>>(`/teams/${team_id}`);
  }
}
