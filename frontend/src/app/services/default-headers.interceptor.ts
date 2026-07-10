import { HttpHeaders, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AIInfuseStateService } from './aiinfuse-state.service';
import { Router } from '@angular/router';

export function defaultHeaders(
  router: Router,
  body: unknown,
  headers: HttpHeaders,
  sessionId: string
) {
  let route = router.routerState.snapshot.root;
  while (route.firstChild) route = route.firstChild;
  const label = route.data['label'];

  let newHeaders = headers
    .append('X-Request-Id', crypto.randomUUID())
    .set('X-Source', label || 'unknown');

  if (!(body instanceof FormData))
    newHeaders = newHeaders.set('Content-Type', 'application/json');

  if (sessionId) {
    newHeaders = newHeaders.set('X-Session-Id', sessionId);
  }

  return newHeaders;
}

export const defaultHeadersInterceptor: HttpInterceptorFn = (req, next) => {
  const userState = inject(AIInfuseStateService);
  const sessionId = userState.getLoginDetails()?.SessionId;
  const router = inject(Router);

  const headers = defaultHeaders(router, req.body, req.headers, sessionId);

  const cloned = req.clone({
    headers,
  });
  return next(cloned);
};
