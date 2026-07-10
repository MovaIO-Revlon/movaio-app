import { Routes } from '@angular/router';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Home } from './home/home';
import { Login } from './login/login';
import { Otp } from './otp/otp';
import { UnauthorizedPopup } from './unauthorized-popup/unauthorized-popup';
import { NotFound } from './not-found/not-found';
import { AuthGuardService } from './services/guard/auth-guard.service';
import { Testcase } from './commandcenter/testcase/testcase';
import { Testscript } from './commandcenter/testscript/testscript';
import { Agentmanagement } from './marketplace/agentmanagement/agentmanagement';
import { AgencyManagement } from './marketplace/agencymanagement/agencymanagement';
import { CommendCenter } from './commandcenter/commendcenter/commendcenter';
import { MarketPlace } from './marketplace/marketplace/marketplace';
import { CommendCenterMain } from './commandcenter/commendcentermain/commendcentermain';
import { Projectmanagement } from './projectmanagement/projectmanagement';
import { Knowledgestore } from './marketplace/knowledgestore/knowledgestore';
import { Workflow } from './workflow-management/workflow/workflow';
import { CreateWorkflow } from './workflow-management/create-workflow/create-workflow';
import { Logs } from './logs/logs';
import { RolesTeams } from './roles-teams/roles-teams';
import { McpConnectors } from './marketplace/mcpconnectors/mcpconnectors';
import { Plugins } from './plugins/plugins';
import { AutomationLibrary } from './marketplace/automationlibrary/automationlibrary';
import { Promptrepository } from './marketplace/promptrepository/promptrepository';
import { VoiceChat } from './chatbot/voice-chat';
import { ConversationalChatbot } from './conversational-chatbot/conversational-chatbot';

export const routes: Routes = [
  { path: '', component: Login, data: { label: 'Login' } },
  {
    path: 'home',
    component: Home,
    canActivate: [AuthGuardService],
    pathMatch: 'full',
    data: { label: 'Home' },
  },
  {
    path: 'otp',
    component: Otp,
    canActivate: [AuthGuardService],
    pathMatch: 'full',
    data: { label: 'OTP' },
  },
  {
    path: 'commandcenterdashboard',
    component: CommendCenterMain,
    canActivate: [AuthGuardService],
    pathMatch: 'full',
    data: { label: 'Command Center dashboard' },
  },
  {
    path: 'commandcenter',
    component: CommendCenter,
    canActivate: [AuthGuardService],
    children: [
      { path: 'testcase', component: Testcase, data: { label: 'Test Cases' } },
      {
        path: 'testscript',
        component: Testscript,
        data: { label: 'Test Scripts' },
      },
      { path: '', redirectTo: 'testcase', pathMatch: 'full' },
    ],
  },

  {
    path: 'marketplace',
    component: MarketPlace, // Reuse same layout if sidebar is common
    canActivate: [AuthGuardService],
    children: [
      {
        path: 'agentmanagement',
        component: Agentmanagement,
        data: { label: 'Agent Management' },
      },
      {
        path: 'agencymanagement',
        component: AgencyManagement,
        data: { label: 'Agency Management' },
      },
      {
        path: 'knowledgestore',
        component: Knowledgestore,
        data: { label: 'Knowledge Store' },
      },
      { path: 'workflows', component: Workflow, data: { label: 'Workflows' } },
      {
        path: 'workflows/new',
        component: CreateWorkflow,
        data: { label: 'New Workflow' },
      },
      {
        path: 'workflows/:id',
        component: CreateWorkflow,
        data: { label: 'Edit Workflow' },
      },
      {
        path: 'mcpconnectors',
        component: McpConnectors,
        data: { label: 'MCP Connectors' },
      },
      {
        path: 'automationlibrary',
        component: AutomationLibrary,
        data: { label: 'Automation Library' },
      },
      {
        path: 'promptrepository',
        component: Promptrepository,
        data: { label: 'Prompt Repository' },
      },
      { path: '', redirectTo: 'agentmanagement', pathMatch: 'full' },
    ],
  },
  {
    path: 'managesubscription',
    component: Projectmanagement,
    canActivate: [AuthGuardService],
    pathMatch: 'full',
    data: { label: 'AI Solution Management' },
  },
  {
    path: 'logs',
    component: Logs,
    canActivate: [AuthGuardService],
    pathMatch: 'full',
    data: { label: 'Logs' },
  },
  {
    path: 'roles-teams',
    component: RolesTeams,
    canActivate: [AuthGuardService],
    pathMatch: 'full',
    data: { label: 'Roles & Team Management' },
  },
  {
    path: 'plugins',
    component: Plugins,
    canActivate: [AuthGuardService],
    pathMatch: 'full',
    data: { label: 'Plugins' },
  },
  {
    path: 'voice-chat',
    component: VoiceChat,
    canActivate: [AuthGuardService],
    pathMatch: 'full',
    data: { label: 'Voice Chat' },
  },
  {
    path: 'chatbot',
    component: ConversationalChatbot,
    canActivate: [AuthGuardService],
    pathMatch: 'full',
    data: { label: 'Conversational Chatbot' },
  },
  { path: 'unauthorized', component: UnauthorizedPopup },
  { path: '**', component: NotFound },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
