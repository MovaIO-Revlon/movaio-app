import { HttpErrorResponse } from '@angular/common/http';
import { ApiError, ApiResponse } from '../types/common';
import { Router } from '@angular/router';
import {
  fromEvent,
  MonoTypeOperatorFunction,
  Observable,
  takeUntil,
  tap,
} from 'rxjs';
import {
  computed,
  effect,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { THistory } from '../services/analytics.service';
import { getValue, setValue } from './data.util';
import { rxResource } from '@angular/core/rxjs-interop';

function getError(e: any) {
  if (
    typeof e === 'object' &&
    e !== null &&
    'success' in e &&
    e.success === false &&
    'message' in e &&
    typeof e.message === 'string'
  )
    return e as ApiError;

  return null;
}

export function getApiError(error: unknown) {
  if (!(error instanceof HttpErrorResponse)) return null;

  const e = error.error;

  return getError(e);
}

export async function checkForFetchError(response: Response) {
  if (response.ok) return;

  const json = await response.json();

  const error = getError(json);
  throw new HttpErrorResponse({
    error,
    status: response.status,
    statusText: error?.message || 'Something went wrong!!!',
  });
}

export function getDefaultHeaders(router: Router, sessionId: string) {
  let route = router.routerState.snapshot.root;

  while (route.firstChild) route = route.firstChild;
  const label = route.data['label'];

  const headers = new Headers();

  headers.set('X-Request-Id', crypto.randomUUID());
  headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'text/event-stream');
  headers.set('X-Source', label || 'unknown');

  if (sessionId) {
    headers.set('X-Session-Id', sessionId);
  }

  return headers;
}

export const abort = <T>(signal: AbortSignal): MonoTypeOperatorFunction<T> =>
  takeUntil(fromEvent(signal, 'abort'));

export const historyCache = <T>(
  cacheSignal: WritableSignal<Record<string, unknown>>,
  path: string,
) => {
  return tap((data: ApiResponse<T>) => {
    const res = data?.data as THistory;
    const value = getValue(res, path);

    cacheSignal.update((v) => ({
      ...v,
      [path]: value,
      run_id: res?.['run_id'] ?? v?.['run_id'],
    }));
  });
};
