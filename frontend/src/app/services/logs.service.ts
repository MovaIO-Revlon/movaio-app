import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { AIInfuseStateService } from './aiinfuse-state.service';
import { ILogQuery, TLogQueryResponse } from '../types';
import { Observable } from 'rxjs';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { handleAuthError } from './auth.interceptor';
import { getDefaultHeaders } from '../utils';

@Injectable({
  providedIn: 'root',
})
export class LogsService {
  private baseURL: string = environment.apiUrl;

  constructor(private router: Router, private userState: AIInfuseStateService) {
  }

  getLogs(query: ILogQuery, ctx: { es?: AbortController }) {
    const searchParams = new URLSearchParams();

    searchParams.append(
      'timezone',
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );

    if (query.project) {
      searchParams.append('project', query.project);
    } else if (query.project === '') {
      const activeProject = this.userState.getLoginDetails()?.ActiveProject;
      searchParams.append('project', activeProject || 'master');
    }
    if (query.fromDate || query.toDate) {
      const sorted = [query.fromDate, query.toDate]
        .filter(Boolean)
        .map((d) => new Date(d as string))
        .sort((a, b) => a.getTime() - b.getTime());

      if (sorted.length > 0)
        searchParams.append(
          'from_date',
          new DatePipe('en-US').transform(sorted[0], 'yyyy-MM-dd') || ''
        );

      if (sorted.length > 1)
        searchParams.append(
          'to_date',
          new DatePipe('en-US').transform(sorted[1], 'yyyy-MM-dd') || ''
        );
    }

    searchParams.append('stream', 'true');

    return new Observable<TLogQueryResponse>((observer) => {
      ctx.es = new AbortController();

      fetch(`${this.baseURL}/api/logs?${searchParams}`, {
        headers: getDefaultHeaders( this.router, this.userState.getLoginDetails()?.SessionId),
        signal: ctx.es.signal,
      })
        .then((res) => {
          handleAuthError(res.status, this.router);
          if (!res.body) throw new Error('No Response Body');

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          const read = async () => {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });

              const frames = buffer.split('\n\n');
              buffer = frames.pop()!;

              for (const frame of frames) {
                if (!frame.startsWith('data:')) continue;

                const json = frame.replace(/^data:\s*/, '');
                const parsed = JSON.parse(json) as TLogQueryResponse;

                observer.next(parsed);

                if (parsed.type === 'end') {
                  ctx.es?.abort();
                  observer.complete();
                  return;
                }
              }
            }
          };

          read().catch(observer.error);
        })
        .catch(observer.error);

      return () => ctx.es?.abort();
    });
  }
}
