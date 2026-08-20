import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { IWorkflow } from '../types';
import { BehaviorSubject, Observable, map } from 'rxjs';
import { RolePrivilegeMappingService } from '../services/role-privilege-mapping.service';
import { ACCESS_TOKEN_KEY, decodeJWT, getCookie, setCookie, USER_DETAILS_KEY } from '../utils';

@Injectable({
  providedIn: 'root',
})
export class AIInfuseStateService {
  private isBrowser: boolean;
  private workflowDetails = new BehaviorSubject<IWorkflow | null>(null);
  private selectedWorkflowSubject = new BehaviorSubject<IWorkflow | null>(null);
  selectedWorkflow$ = this.selectedWorkflowSubject.asObservable();
  private workflowRouted = false;
  private workflowRoutedSubject = new BehaviorSubject<boolean>(false);
  private workflowMode = new BehaviorSubject<'edit' | 'view'>('edit');
  workflowMode$ = this.workflowMode.asObservable();
  private privilegeData = new BehaviorSubject<any[]>([]);
  privilegeData$ = this.privilegeData.asObservable();
  private tryPromptSubject = new BehaviorSubject<any>(null);
  tryPrompt$ = this.tryPromptSubject.asObservable();


  constructor(@Inject(PLATFORM_ID) private platformId: Object, private rolePrivilegeService: RolePrivilegeMappingService) {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  // -----------------------
  // Private methods
  // -----------------------

  private getItem(key: string): any {
    if (this.isBrowser) {
      try {
        const value = sessionStorage.getItem(key);
        if (value === null) {
          return null;
        }
        return JSON.parse(value);
      } catch (error) {
        this.removeItem(key);
        return null;
      }
    }
    return null;
  }

  private setItem(key: string, data: any): void {
    if (this.isBrowser) {
      try {
        sessionStorage.setItem(key, JSON.stringify(data));
      } catch (error) {
        console.error(`sessionStorage: Failed to set key "${key}":`, error);
      }
    }
  }

  private removeItem(key: string): void {
    if (this.isBrowser) {
      sessionStorage.removeItem(key);
    }
  }

  // -----------------------
  // User Login Info
  // -----------------------

  setLoginDetails(userDetail: any) {
    this.setItem('UserDetails', userDetail);
  }

  setSelectedAgency(agencyId: any) {
    this.setItem('SelectedAgencyId', agencyId);
  }
  setIsReviewCase(IsReviewCase: boolean) {
    this.setItem('IsReviewCase', IsReviewCase);
  }

  setAgentwithAgencyDetails(agentDetails: any) {
    this.setItem('AgentDetails', agentDetails);
  }

  getAgentWithAgencyDetails(): any {
    return this.getItem('AgentDetails');
  }

  getLoginDetails(): any {
    return this.getItem('UserDetails');
  }

  getSelectedAgency(): any {
    return this.getItem('SelectedAgencyId');
  }

  getIsReviewCase(): boolean {
    return this.getItem('IsReviewCase');
  }

  clearLoginDetails(): void {
    this.removeItem('UserDetails');
  }

  // -----------------------
  // OTP Info (Login)
  // -----------------------

  setLoginOTPDetails(userDetail: any) {
    this.setItem('UserOTPDetails', userDetail);
  }

  getLoginOTPDetails(): any {
    return this.getItem('UserOTPDetails');
  }

  clearLoginOTPDetails(): void {
    this.removeItem('UserOTPDetails');
  }

  // -----------------------
  // OTP Info (Logout)
  // -----------------------

  setLogoutOTPDetails(userDetail: any) {
    sessionStorage.setItem('UserLogoutOTPDetails', JSON.stringify(userDetail));
  }

  getLogoutOTPDetails(): any {
    const userDetailsString = sessionStorage.getItem('UserLogoutOTPDetails');

    // Check if the value exists and is not the literal string 'undefined'
    if (userDetailsString && userDetailsString !== 'undefined') {
      try {
        return JSON.parse(userDetailsString);
      } catch (error) {
        console.error('Failed to parse UserLogoutOTPDetails:', error);
        // You can handle this case (e.g., clear storage or return null)
      }
    }
    return null; // Or handle default case
  }

  clearLogoutOTPDetails(): void {
    this.removeItem('UserLogoutOTPDetails');
  }

  // -----------------------
  //  User Management
  // -----------------------

  setUserManagementData(userDetail: any) {
    this.setItem('UserManagementData', userDetail);
  }

  getUserManagementData(): any {
    return this.getItem('UserManagementData');
  }

  setTeamManagementData(teamDetails: any) {
    this.setItem('TeamManagementData', teamDetails);
  }

  setRoleManagementData(roleDetails: any) {
    this.setItem('RoleManagementData', roleDetails);
  }

  setProjectManagementData(projectDetails: any) {
    this.setItem('ProjectManagementData', projectDetails);
  }

  setRolePrivilegeData(roleMapDetails: any) {
    this.setItem('RolePrivilegeData', roleMapDetails);
  }

  getTeamManagementData(): any {
    return this.getItem('TeamManagementData');
  }

  getRoleManagementData(): any {
    return this.getItem('RoleManagementData');
  }

  getRolePrivilegeData(): any {
    return this.getItem('RolePrivilegeData');
  }

  getProjectManagementData(): any {
    return this.getItem('ProjectManagementData');
  }
  setProjectsData(MappedProject: any[]) {
    this.setItem('MappedProject', MappedProject);
  }

  getProjectsData(): any[] {
    return this.getItem('MappedProject');
  }

  // -----------------------
  // User Password Info
  // -----------------------

  setUserPwd(userDetail: any) {
    this.setItem('UserPwdDetails', userDetail);
  }

  getUserPwd(): any {
    return this.getItem('UserPwdDetails');
  }

  clearUserPwd(): void {
    this.removeItem('UserPwdDetails');
  }

  hasUserRole(roleName: string): boolean {
    const userData = this.getUserManagementData();

    if (!userData) return false;

    // If it's an array of user objects
    if (Array.isArray(userData)) {
      return userData.some((u: any) => {
        // Case: role stored directly as string
        if (u.role && typeof u.role === 'string') {
          return u.role.toLowerCase() === roleName.toLowerCase();
        }

        // Case: nested object
        if (u.role?.name) {
          return u.role.name.toLowerCase() === roleName.toLowerCase();
        }

        return false;
      });
    }

    // If it's a single object with roles
    if (userData.roles && Array.isArray(userData.roles)) {
      return userData.roles.some(
        (r: any) =>
          (typeof r === 'string' ? r : r.name)?.toLowerCase() ===
          roleName.toLowerCase()
      );
    }

    return false;
  }

  // -----------------------
  // Workflows
  // -----------------------

  setWorkflows(workflows: IWorkflow[]) {
    this.setItem('workflows', workflows);
  }
  setWorkFlowDetails(workflowDetails: any) {
    this.setItem('WorkflowDetails', workflowDetails);
  }

  getWorkFlowDetails(): any {
    return this.getItem('WorkflowDetails');
  }

  getWorkflows() {
    return this.getItem('workflows') as IWorkflow[];
  }

  setWorkflowDetails(workflow: IWorkflow | null): void {
    this.workflowDetails.next(workflow);
    this.setItem('WorkflowDetails', workflow);
  }
  getWorkflowDetails(): IWorkflow | null {
    return this.getItem('WorkflowDetails');
  }

  setSelectedWorkflow(workflow: IWorkflow | null): void {
    this.selectedWorkflowSubject.next(workflow);
  }
  setReviewWorkflow(workflow: IWorkflow | null): void {
    this.selectedWorkflowSubject.next(workflow);
  }
  getReviewWorkflow(): IWorkflow | null {
    return this.selectedWorkflowSubject.value;
  }

  getSelectedWorkflow(): IWorkflow | null {
    return this.selectedWorkflowSubject.value;
  }
  clearWorkflowDetails() {
    this.workflowDetails.next(null);
    this.workflowRouted = false;
  }
  setWorkflowRouted(isRouted: boolean): void {
    this.workflowRoutedSubject.next(isRouted);
  }
  setWorkflowRouted1(isRouted: boolean): void {
    this.workflowRoutedSubject.next(isRouted);
  }

  getWorkflowRoutedObservable(): Observable<boolean> {
    return this.workflowRoutedSubject.asObservable();
  }

  getWorkflowReviewObservable(): Observable<boolean> {
    return this.workflowRoutedSubject.asObservable();
  }

  setWorkflowMode(mode: 'edit' | 'view') {
  this.workflowMode.next(mode);
}

getWorkflowMode(): 'edit' | 'view' {
  return this.workflowMode.value;
}

//---------------Role Privileges----------------

  // method to set all privileges for every project and pages
  setAllRolePrivileges(data: any[]) {
    //console.log('Updating privilege data with:', data);
    this.privilegeData.next(data);
  }

  // method to get all privileges for every project and pages
  getAllPrivileges() {
    return this.privilegeData.value;
  }

  // method to get privileges for the pagename passed, returning privilegeData$ observable back
  getPrivilegesByPage(pageName: string): any {
    const loggedUser = this.getLoginDetails();
    //console.log('Loading privileges for page:', pageName, 'with logged user:', loggedUser);
    const activeProject = loggedUser?.ActiveProject;
    if (!activeProject) {
      console.warn('No active project found for user. Cannot load privileges.');
      return;
    }
    let project_id:any = null;
    let team_name:any = null;
    let role_name:any = null;
    loggedUser.ProjectDtl.forEach((project: any) => {
      if (project.prj_name === activeProject) {
        project_id = project.prj_id
        team_name = project.team_name;
        role_name = project.role_name;
        //console.log(`Loading privileges for project_id: ${project_id}, team: ${team_name}, role: ${role_name}`);
      }
    });
    // returning observable after mapping through the privilegeData to find the matching privileges for the current user context (project_id, team_name, role_name) and pageName
    return this.privilegeData$.pipe(
      map((privileges: any[]) => {
        const userRole = loggedUser?.Role?.toString().trim().toLowerCase();
        const userRoleName = role_name?.toString().trim().toLowerCase();
        //console.log('Checking privileges for user role:', userRole, 'and role name:', userRoleName);

        if (userRoleName === 'super admin') {
          return {
            view: true,
            'add / create': true,
            'insert / edit': true,
            delete: true,
            refresh: true,
            execute: true,
          };
        }

        const matchingPrivilege = privileges.find(priv =>
          priv?.ProjectId === project_id &&
          priv?.TeamId === team_name &&
          priv?.RoleName === role_name
        );

        if (matchingPrivilege) {
          //console.log('Found matching privileges for current user context:', matchingPrivilege)
          return matchingPrivilege?.permissions?.[pageName] || {}
        } else {
          console.warn('No matching privileges found for current user context. Returning empty privileges for page:', pageName)
          return {}
        }
      })
    );
  }


  // not in use , keeping it as backup
  loadPrivilegesByPage(pageName: string): any {
    const loggedUser = this.getLoginDetails();
    //console.log('Loading privileges for page:', pageName, 'with logged user:', loggedUser);
    const activeProject = loggedUser?.ActiveProject;
    if (!activeProject) {
      console.warn('No active project found for user. Cannot load privileges.');
      return;
    }

    // if (loggedUser?.Role==='Super Admin' || loggedUser?.Role==='super admin') {
    //   return { 'view': true, 'insert / edit': true, 'delete': true, 'refresh': true , 'execute': true }; // Full access for Super Admin
    // }

    let project_id:any = null;
    let team_name:any = null;
    let role_name:any = null;
    loggedUser.ProjectDtl.forEach((project: any) => {
      if (project.prj_name === activeProject) {
        project_id = project.prj_id
        team_name = project.team_name;
        role_name = project.role_name;
        //console.log(`Loading privileges for project_id: ${project_id}, team: ${team_name}, role: ${role_name}`);
      }
    });

    
    let page_privileges:any = {};
    if (project_id && team_name && role_name) {
      if (this.privilegeData.value && this.privilegeData.value.length > 0) {
        //console.log('Privileges already loaded, skipping API call.', this.privilegeData.value);
        this.privilegeData.value.forEach((priv:any) => {
          if (priv?.ProjectId === project_id && priv?.TeamId === team_name && priv?.RoleName === role_name) {
            //console.log('Found matching privileges for current user context:', priv);
            page_privileges = priv?.permissions?.[pageName] || {};
          }
        });
        //console.log('Extracted page privileges from cache:', page_privileges);
        return page_privileges;
      }
      else {
          let request_json={
            "ProjectId": project_id,
            "TeamId": team_name,
            "RoleId": role_name
          }
          this.rolePrivilegeService.getPermissionsForRole(request_json).subscribe(
            (privileges: any) => {
              //console.log('Privileges loaded:', privileges);
              page_privileges = privileges?.data?.permissions[pageName] || {};
              //console.log('Extracted page privileges from api:', page_privileges);
              return page_privileges;
              // this.setAllRolePrivileges(privileges);
            },
            (error: any) => {
              console.error('Error loading privileges:', error);
              return {};
            }
          );
      }
    } else {
        console.warn('Could not determine project_id, team_name, or role_name. Cannot load privileges.');
        return {};
      }
  }

  SetIsBaseWorkflow(IsBasedWorkflow: any) {
    this.setItem('IsBasedWorkflow', IsBasedWorkflow);
  }
  GetIsBaseWorkflow(): any {
    return this.getItem('IsBasedWorkflow');
  }

  setTryPromptData(data: any): void {
  this.tryPromptSubject.next(data);
  this.setItem('TryPromptData', data);
}

  getTryPromptData(): any {
    return this.getItem('TryPromptData');
  }

  clearTryPromptData(): void {
    this.tryPromptSubject.next(null);
    this.removeItem('TryPromptData');
  }

}
