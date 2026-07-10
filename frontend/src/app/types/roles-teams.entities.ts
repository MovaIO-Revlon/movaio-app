export interface IMaster {
  Created_By: string;
  Created_Date: string;
  Updated_Date?: string;
  IsActive: boolean;
  _id: string;
}

export interface IRole extends IMaster {
  RoleId: number;
  RoleName: string;
}

export interface ITeam extends IMaster {
  TeamId: number;
  TeamName: string;
}

export interface ICreateRolesRequest {
  RoleName: string;
  Created_By: string;
  IsActive: boolean;
}

export interface IUpdateRoleRequest {
  role_id: number;
  IsActive?: boolean;
  RoleName?: string;
}

export interface ICreateTeamsRequest {
  TeamName: string;
  Created_By: string;
  IsActive: boolean;
}

export interface IUpdateTeamRequest {
  team_id: number;
  IsActive?: boolean;
  TeamName?: string;
}
