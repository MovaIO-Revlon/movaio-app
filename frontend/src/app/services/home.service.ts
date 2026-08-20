import { HttpClient, HttpErrorResponse, HttpEvent } from '@angular/common/http';
import { inject, Injectable,NgZone } from '@angular/core';
import { Observable, timeout, Subject } from 'rxjs';
import { AIInfuseStateService } from './aiinfuse-state.service';
import { HttpEventType, HttpResponse } from '@angular/common/http';
import { ApiResponse } from '../types/common';
import {
  IProject,
  WorkflowDetail,
  IAddUserResponse,
  UserDetails,
  ITeam,
  UserManagement,
  IRole,
  IAgent,
  ILoginResponse,
} from '../types';
import { filter, map, scan, distinctUntilChanged } from 'rxjs/operators';
import { environment as config } from '../../environments/environment';
import { checkForFetchError, getDefaultHeaders } from '../utils';
import { Router } from '@angular/router';
import { io } from 'socket.io-client';
import { fetchWithAuth } from './auth.interceptor';

@Injectable({
  providedIn: 'root',
})
export class HomeService {

  constructor(
    private _http: HttpClient,
    private userState: AIInfuseStateService,
    private ngZone: NgZone,
    private router: Router
  ) {
  }

  onboardUser(params: any) {
    return this._http.post<ApiResponse<IAddUserResponse>>(`/AddUser`, params);
  }

  sentMailUserManagement(mailID: string) {
    return this._http.post<ApiResponse<null>>(
      `/SentMailUserManagement/${mailID}`,
      null
    );
  }

  checkPassword(params: any) {
    return this._http.post<ApiResponse<null>>(`/checkPassword`, params);
  }

  userActiveOrInActive(Params: any) {
    return this._http.post<ApiResponse<{ UserManagement: UserManagement[] }>>(
      `/UserActiveOrInActive`,
      Params
    );
  }
  deleteUserDetails(params: any) {
    return this._http.post<ApiResponse<{ UserManagement: UserManagement[] }>>(
      `/DeleteUserDetails`,
      params
    );
  }

  changePassword(Params: any): Observable<any> {
    return this._http.post<any>(`/changePWD`, Params);
  }

  checkCurrentPassword(params: any): Observable<any> {
    return this._http.post<any>(`/checkCurrentPassword`, params);
  }

  getUserDetails() {
    return this._http.get<ApiResponse<UserDetails>>(`/GetUserDetails`);
  }

  uploadImage(params: any) {
    return this._http.post<ApiResponse<{ filePath: string; dataUrl: string }>>(
      `/UploadUserImage`,
      params
    );
  }

  downloadDocx(params: any, newApi: boolean) {
    return this._http.post(`/${newApi ? 'download-docx': 'download'}`, params, { 
      observe: 'response',
      responseType: 'blob' as any
    })
  }

  UpdateUser(params: any): Observable<any> {
    return this._http.post<any>(`/Updatedetails`, params)
  }

  getTeamsByProject(params: any) {
    return this._http.post<
      ApiResponse<{ ProjectName: string; Teams: unknown[] }>
    >(`/getTeamsByProject`, params);
  }

  getRolesByProjectAndTeam(params: any) {
    return this._http.post<
      ApiResponse<{
        Project: string;
        Team: string;
        Roles: IRole[];
      }>
    >(`/getRolesByProjectAndTeam`, params);
  }

  switchProject(params: any) {
    return this._http.put<ApiResponse<Pick<ILoginResponse, 'Token' | 'RefreshToken'>>>(`/switchProject`, params);
  }

  // region projectmanagement

  addProjectDetails(params: any) {
    return this._http.post<ApiResponse<boolean>>(`/addProject`, params);
  }

  getAllProjects() {
    return this._http.get<ApiResponse<IProject[]>>(`/getProject`);
  }

  getAllRolePrivileges() {
    return this._http.get<ApiResponse<any>>(`/getAllRolePermissions`);
  }

  updateProject(projectId: string, projectData: any) {
    return this._http.put<ApiResponse<boolean>>(
      `/updateProject/${projectId}`,
      projectData
    );
  }

  deleteProject(projectId: string) {
    return this._http.delete<ApiResponse<boolean>>(
      `/deleteProject/${projectId}`
    );
  }

  getAllTeams() {
    return this._http.get<ApiResponse<ITeam[]>>(`/getTeams`);
  }

  getAllRoles() {
    return this._http.get<ApiResponse<ITeam[]>>(`/getRoles`);
  }
  
  getAgencyWithAgents() {
    return this._http.get<ApiResponse<any[]>>(`/GetAgencyWithAgents`);
  }

  getSessionList(params: any) {
    return this._http.get<ApiResponse<any[]>>(`/getSessionList`, params);
  }

  getSessionDetails(sessionId: string) {
    return this._http.get<ApiResponse<any[]>>(`/getSessionDetails/${sessionId}`);
  }

  getRecentQuery(agentId: string) {
    return this._http.get<ApiResponse<{ top_query: string }>>(`/getRecentQuery/${agentId}`);
  }

  refreshsubScriptionDetails(params: any) {
    return this._http.post<ApiResponse<boolean>>(`/refreshsubScriptionDetails`, params);
  }

  //#endregion

  //#region Chatbot
  // chatbotAgent(params: any): Observable<any> {
  // return this._http.post<any>(`${this.baseURL}/chatbotagent`, params, this.httpOptions);
  // }

chatbotAgent_old(params: any): Observable<string> {
  return this._http.post( '/chatbotagent', params, {
    responseType: 'text',
    reportProgress: true,
    observe: 'events'
  }).pipe(
    filter((event: HttpEvent<any>) => {
      // Only emit when we have actual text
      return event.type === HttpEventType.DownloadProgress && (event as any).partialText ||
             event.type === HttpEventType.Response;
    }),
    map((event: HttpEvent<any>) => {
      if (event.type === HttpEventType.Response) {
        return (event as HttpResponse<string>).body || '';
      }
      return (event as any).partialText || (event as any).partialText || '';
    }),
    filter(text => text.length > 0),
    scan((acc: string, chunk: string) => {

      if (acc.endsWith(chunk)) return acc;
      if (chunk.startsWith(acc)) return chunk;
      return acc + chunk;
    }, ''),
    distinctUntilChanged()
  );
}

chatbotAgent(params: any): Observable<string> {
  return this._http.post('/chatbotagent', params, {
    responseType: 'text',
    reportProgress: true,
    observe: 'events'
  }).pipe(
    filter((event: HttpEvent<any>) => {
      // Only emit when we have actual text
      return event.type === HttpEventType.DownloadProgress && (event as any).partialText ||
             event.type === HttpEventType.Response;
    }),
    map((event: HttpEvent<any>) => {
      if (event.type === HttpEventType.Response) {
        return (event as HttpResponse<string>).body || '';
      }
      return (event as any).partialText || (event as any).partialText || '';
    }),
    filter(text => text.length > 0),
    scan((acc: string, chunk: string) => {

      if (acc.endsWith(chunk)) return acc;
      if (chunk.startsWith(acc)) return chunk;
      return acc + chunk;
    }, ''),
    distinctUntilChanged()
  );
}

chatbotAgentUnified(params: any): {
  stream: Observable<string>;
  traceDetails: Observable<any>;
  logDetails: Observable<any>;
} {
  // Create subjects for each type of data
  const streamSubject = new Subject<string>();
  const traceDetailsSubject = new Subject<any>();
  const logDetailsSubject = new Subject<any>();



  // Make a single API call
  fetchWithAuth(`${config.apiUrl}/chatbotagent`, {
    method: "POST",
    body: JSON.stringify(params),
    headers: getDefaultHeaders(
      this.router,
    ),
  })
    .then(async (res) => {
      await checkForFetchError(res);

      if (!res.body) throw new HttpErrorResponse({ statusText: 'No Response Body' });

      const contentType = res.headers.get('Content-Type');
      if (contentType?.includes('application/json')) {
        const d : ApiResponse<string> = await res.json()
        streamSubject.next(d?.data || '');
        this.ngZone.run(() => {
          streamSubject.next('end');
          streamSubject.complete();
          traceDetailsSubject.complete();
          logDetailsSubject.complete();
        });
      } else {

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let jsonBuffer = ''; // Buffer for accumulating potential JSON

        const read = async () => {
          while (true) {
            const { value, done } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const frames = buffer.split('\n');
            buffer = frames.pop()!;

            for (const frame of frames) {
              if (!frame.startsWith('data:')) continue;

              let parsed = frame.replace(/^data: /, '').replace(/^data:/, '');

              // Check for end signals first
              if (["[END]", "[DONE]"].some(item => parsed.toLowerCase().includes(item.toLowerCase()))) {
                // Send the special 'end' signal for the stream subscription's logic
                this.ngZone.run(() => streamSubject.next('end'));
                continue; // Skip further processing for this frame
              }

              // Check if this might be JSON
              if (parsed.startsWith('{') || parsed.startsWith('[')) {
                jsonBuffer += parsed; // Accumulate potential JSON
                try {
                  let unescaped = parsed.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                  const jsonData = JSON.parse(unescaped);
                  console.log('✅ Unified Service - Parsed JSON:', jsonData);

                  // Route to appropriate subject based on type
                  if (jsonData.type === 'trace_details') {
                    this.ngZone.run(() => traceDetailsSubject.next(jsonData));
                  } else if (jsonData.type === 'log') {
                    this.ngZone.run(() => logDetailsSubject.next(jsonData));
                  }
                  else if (jsonData.type === 'msg') {
                      this.ngZone.run(() => logDetailsSubject.next(jsonData));
                  } else if (jsonData.type === 'final_response') {
                      this.ngZone.run(() => {
                        streamSubject.next(jsonData?.data?.response || '')
                        if (jsonData?.data?.trace_details)
                          traceDetailsSubject.next({ type: 'trace_details' , data: jsonData.data.trace_details })

                        streamSubject.next('end')
                        streamSubject.complete()
                        traceDetailsSubject.complete()
                        logDetailsSubject.complete()
                    });
                  }
                  // else{
                  //   this.ngZone.run(() => streamSubject.next(jsonData));
                  // }
                } catch (e) {
                  try {
                    const fixedJson = parsed.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
                    const jsonData = JSON.parse(fixedJson);
                    if (jsonData.type === 'trace_details') {
                      this.ngZone.run(() => traceDetailsSubject.next(jsonData));
                    } else if (jsonData.type === 'log') {
                      this.ngZone.run(() => logDetailsSubject.next(jsonData));
                    } else if (jsonData.type === 'final_response') {
                      this.ngZone.run(() => {
                        streamSubject.next(jsonData?.data?.response || '')
                        if (jsonData?.data?.trace_details)
                          traceDetailsSubject.next({ type: 'trace_details' , data: jsonData.data.trace_details })

                        streamSubject.next('end')
                        streamSubject.complete()
                        traceDetailsSubject.complete()
                        logDetailsSubject.complete()
                    });
                  }
                    // else{
                    //   this.ngZone.run(() => streamSubject.next(jsonData));
                    // }
                  } catch (e2) {
                    console.log('❌ Unified Service - JSON parse error (both attempts failed):', e2);
                    this.ngZone.run(() => streamSubject.next(parsed)); // Fallback: send raw text
                  }
                }
              } else if (parsed) {
                // Don't convert \n to actual newlines here, as we want to preserve them as text
                // The component will handle the conversion
                this.ngZone.run(() => streamSubject.next(parsed));
              }
            }
          }

          // Complete all subjects when the stream is fully done
          this.ngZone.run(() => {
            streamSubject.complete();
            traceDetailsSubject.complete();
            logDetailsSubject.complete();
          });
        };

        read().catch(error => {
          this.ngZone.run(() => {
            streamSubject.error(error);
            traceDetailsSubject.error(error);
            logDetailsSubject.error(error);
          });
        });
      }
    })
    .catch(e => {
      this.ngZone.run(() => {
        streamSubject.error(e);
        traceDetailsSubject.error(e);
        logDetailsSubject.error(e);
      });
    });

  // Return observables for each data type
  return {
    stream: streamSubject.asObservable(),
    traceDetails: traceDetailsSubject.asObservable(),
    logDetails: logDetailsSubject.asObservable()
  };
}

chatbotAgentForTraceDetails(params: any) {
  return this.chatbotAgentUnified(params).traceDetails;
}

chatbotAgentForLogDetails(params: any) {
  return this.chatbotAgentUnified(params).logDetails;
}

chatbotAgent2(params: any) {
  return this.chatbotAgentUnified(params).stream;
}
  

chatbotAgentStream(payload: any): Observable<string> {
    return new Observable<string>(observer => {
      const url = '/chatbotagent'
        + '?payload=' + encodeURIComponent(JSON.stringify(payload));

      const es = new EventSource(url);

      es.onmessage = (event: MessageEvent) => {
        this.ngZone.run(() => {
          const data = event.data;
          if (!data) return;

          if (data === '[DONE]' || data === '[done]') {
            observer.complete();
            es.close();
            return;
          }

          observer.next(data);
        });
      };

      es.onerror = (err) => {
        this.ngZone.run(() => {
          observer.error(err);
          es.close();
        });
      };

      // Cleanup on unsubscribe
      return () => {
        es.close();
      };
    });
  }

  getPopularQueries(params: any) {
    return this._http.post<ApiResponse<unknown[]>>(`/popularQueries`, params);
  }

  getRecentData(params: any) {
    return this._http.post('/getRecentData', params, {
      responseType: 'text'   
    }).pipe(
      map((text: string) => {
        let sanitized = text.replace(/\bNaN\b/g, 'null')
                            .replace(/\bInfinity\b/g, 'null')
                            .replace(/\b-Infinity\b/g, 'null');
        
        return JSON.parse(sanitized);
      })
    );
}


  getRecentDataAgent(params: any) {
    return this._http.post<ApiResponse<unknown[]>>(`/getRecentDataAgent`, params);
  }
  
   getRecentDataForSuggestion(params: any) {
    return this._http.post<ApiResponse<unknown[]>>(`/getqueryresponse`, params);
  }

  updateFeedBackDetails(params: any) {
    return this._http.post<ApiResponse<boolean>>(
      `/updateFeedBackDetails`,
      params
    );
  }
  updatereviewFeedBackDetails(params: any) {
    return this._http.post<ApiResponse<boolean>>(
      `/updatereviewFeedBackDetails`,
      params
    );
  }
  getMasterAgent(params: any) {
    return this._http.post<
      ApiResponse<IAgent & { subagent: { name: string } }>
    >(`/getmasteragent`, params);
  }
  routeChat(params: any) {
    return this._http.post<
      ApiResponse<{
        agent: { subagent?: { name: string } };
        similarity_score: number;
      }>
    >(`/routeQuery`, params);
  }
runWorkflow(params: any): Observable<any> {
  const loggedUser = this.userState.getLoginDetails();

  const payload = {
    ...params,
    user: loggedUser ? {
      user_id: loggedUser.UserId || loggedUser.ID || loggedUser.id || loggedUser.sub,
      username: loggedUser.UserName || loggedUser.Email || loggedUser.UserName,
      email: loggedUser.Email,
      name: loggedUser.UserName || loggedUser.FullName || loggedUser.DisplayName || loggedUser.Email,
    } : null
  };

  return this._http.post<any>(`/workflowRun`, payload).pipe(
    timeout(720000)
  );
}

// Add a method to listen to real-time logs
listenToWorkflowLogs(workflowId: string, eventId: string): Observable<any> {
  return new Observable(observer => {
    // Assuming you use Socket.IO client
    const socket = io();
    const channel = `workflow*${workflowId}_${eventId}`;
    
    socket.on(channel, (data) => {
      observer.next(data);
    });
    
    // Cleanup function
    return () => {
      socket.off(channel);
      socket.disconnect();
    };
  });
}
  getWorkflowResponse(workflowId: string, Is_Review: boolean) {
    return this._http.get<ApiResponse<unknown[]>>(`/getWorkflowResponse/${workflowId}/${Is_Review}`);
  }
  
  getworkflowdetails() {
    return this._http.get<ApiResponse<WorkflowDetail[]>>(`/getAllMappings`);
  }
  getWorkflowEventResponse(params: any) {
    return this._http.post<ApiResponse<unknown[]>>(
      `/getWorkflowEventResponse`,
      params
    );
  }

  getWorkflowLogsAndTraces(workflowId: string, eventId: string): Observable<ApiResponse<any>> {
    return this._http.get<ApiResponse<any>>(`/workflow/${workflowId}/${eventId}/logs-and-traces`);
  }

  getNotificationsByUser(email: string) {
    return this._http.get<ApiResponse<any>>(`/getNotificationsByUser/${email}`);
  }

  getSessionToken() {
    return this._http.post<ApiResponse<{ session_token: string }>>('/session-token',{})
  }

  //#endregion
}
