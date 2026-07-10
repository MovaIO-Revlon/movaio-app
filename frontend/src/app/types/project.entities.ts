export interface IProject {
  AgencyCount: number;
  AgentCount: number;
  UserCount: number;
  _id: string;
  database_name?: string;
  dateCreated: string;
  description: string;
  projectId: number;
  projectName: string;
  project_desc: string;
  teams: Team[];
}

interface Team {
  roles: Role[];
  teamName: string;
}

interface Role {
  role: string;
}
