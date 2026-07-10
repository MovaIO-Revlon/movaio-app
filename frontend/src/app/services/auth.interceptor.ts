import {
  HttpInterceptorFn,
  HttpRequest,
  HttpHandlerFn,
  HttpEvent,
  HttpErrorResponse,
} from '@angular/common/http';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessionTimeoutService } from './session-management/session-timeout.service';

export function handleAuthError(status: number, router: Router) {
  if (status === 401) {
    localStorage.clear();
    sessionStorage.clear();
    router.navigate(['/']);
  }
}

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<any>,
  next: HttpHandlerFn
): Observable<HttpEvent<any>> => {
  const router = inject(Router);
  const sessionSrv = inject(SessionTimeoutService);

  return next(req).pipe(
    tap(() => sessionSrv.resetSessionTimer()),
    catchError((err: HttpErrorResponse) => {
      handleAuthError(err.status, router);
      return throwError(() => err);
    })
  );
};
