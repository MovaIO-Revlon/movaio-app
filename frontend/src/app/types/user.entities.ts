import { IRole, ITeam } from './roles-teams.entities';

export interface IProjectDetails {
  RoleId?: number;
  TeamId?: number;
  prj_id?: number;
  prj_name: string;
  role_name: string;
  team_name: string;
}
export interface ILoginResponse {
  ActiveProject: string;
  Avatar: string;
  ProjectDtl: IProjectDetails[];
  Role: string;
  Team: string;
  UserName: string;

  // otp
  IsOTP?: false;
  Email?: string;
  EmployeeId?: string;
  Success?: boolean;
  Message?: string;

  // token
  Token: string;
  RefreshToken: string;
}

export interface ILoginOtpResponse {
  IsOTP: true;
  Email: string;
  EmployeeId: string;
  Success?: boolean;
  Message?: string;
}

export interface UserDetails {
  MappedProject: MappedProject[];
  ProjectManagement: ProjectManagement[];
  RoleManagement: IRole[];
  Success: boolean;
  TeamManagement: ITeam[];
  UserManagement: UserManagement[];
}

export interface MappedProject {
  projectId: number;
  projectName: string;
}

export interface ProjectManagement {
  _id: string;
  active: boolean;
  database_name?: string;
  dateCreated: string;
  description: string;
  projectId: number;
  projectName: string;
  project_desc: string;
  teams: Team[];
  project_db_name?: string;
}

interface Team {
  roles: Role[];
  teamName: string;
}

interface Role {
  role: string;
}

export interface UserManagement {
  ActiveProject?: string;
  Avatar?: string;
  CreatedBy: string;
  Email: string;
  FirstName: string;
  IsActive: boolean;
  IsDelete: boolean;
  LastName: string;
  PrjDetails?: ProjectDetail[];
  ProjectNames: any[];
  RoleId?: number;
  RoleNames: string[];
  TeamId?: number;
  TeamNames: string[];
  UpdatedBy?: string;
  UpdatedDate?: string;
  _id: string;
  CreatedDate?: string;
}

export interface ProjectDetail {
  RoleId: any;
  TeamId: any;
  prj_id: number;
  prj_name: string;
  role_name: string;
  team_name: string;
}

export interface IAddUserResponse {
  Email: string;
  UserName: string;
  RoleId: string;
  TeamId: string;
  PrjDetails: ProjectDetail[];
}

export interface MappingItem {
  projectName: string;
  projectId: string;
  teamName: string;
  teamId: string;
  roleName: string;
  roleId: string;
}

export interface IOnboardUserRequest {
  Email: string;
  FirstName: string;
  LastName: string;
  RoleId: string | null;
  TeamId: string | null;
  ActiveProject: string | null;
  PrjDetails: {
    project_name: string;
    project_id: number;
    team_name: string;
    team_id: string;
    role_name: string;
    role_id: string;
  }[];
  CreatedBy: string;
  CreatedDate: string;
  IsEdit?: boolean;
}
