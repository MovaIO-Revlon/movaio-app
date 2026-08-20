import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, throwError } from 'rxjs';
import { catchError, filter, switchMap, take } from 'rxjs/operators';
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  decodeJWT,
  deleteCookie,
  getCookie,
  setCookie,
} from '../utils';
import { LoginService } from '../services/login.service';
import { environment } from '../../environments/environment';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';

let isRefreshing = false;
const refreshTokenSubject = new BehaviorSubject<string | null>(null);

const PUBLIC_URLS = [
  /doLogin/i,
  /OTPDetails/i,
  /ValidateOTP/i,
  /refresh-token/i,
  /SendRecoveryMail/i,
  /SentMailUserManagement/i,
  /getAllMappings/i,
  /getAllMappings/i,
];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(LoginService);
  const stateService = inject(AIInfuseStateService);

  const isPublic = PUBLIC_URLS.some((regex) => regex.test(req.url));

  let authReq = req;
  authReq = addDefaultHeaders(authReq, router);

  const token = getCookie(ACCESS_TOKEN_KEY);
  if (!isPublic && token) {
    authReq = addTokenHeader(authReq, token);
  }
    // Only add API key when user has external-app mapping + api_key
  const apiKey = getApiKeyForActiveProject(stateService);
  if (apiKey) {
    authReq = authReq.clone({
      setHeaders: { 'x-api-key': apiKey },
    });
  }


  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !isPublic) {
        return handle401Error(authReq, next, authService, router,stateService);
      }
      return throwError(() => error);
    }),
  );
};

function getApiKeyForActiveProject(stateService: AIInfuseStateService): string | null {
  try {
    const loggedUser = stateService.getLoginDetails();
    console.log('[API-KEY] loggedUser', loggedUser);

    if (!loggedUser) return null;

    const activeProject = (loggedUser.ActiveProject || '').trim().toLowerCase();
    console.log('[API-KEY] activeProject', activeProject);

    if (!activeProject) return null;

    const projects: any[] =
      stateService.getProjectManagementData() ||
      stateService.getProjectsData() ||
      [];

    console.log('[API-KEY] projects from state', projects);

    if (!Array.isArray(projects) || projects.length === 0) {
      console.warn('[API-KEY] No projects in state → API key will not be sent');
      return null;
    }

    const project = projects.find(
      (p: any) => (p.projectName || '').trim().toLowerCase() === activeProject
    );

    console.log('[API-KEY] matched project', project);

    if (!project?.external_apps?.length) {
      console.warn('[API-KEY] Project has no external_apps');
      return null;
    }

    const appWithKey = project.external_apps.find(
      (app: any) =>
        !!app.api_key &&
        app.credentialsEnabled !== false
    );

    console.log('[API-KEY] found api_key?', !!appWithKey?.api_key, appWithKey?.api_key);

    return appWithKey?.api_key || null;
  } catch (e) {
    console.error('[API-KEY] error', e);
    return null;
  }
}

function addDefaultHeaders(
  request: HttpRequest<any>,
  router: Router,
): HttpRequest<any> {
  let route = router.routerState.snapshot.root;
  while (route.firstChild) route = route.firstChild;
  const label = route.data['label'];

  let headers = request.headers
    .append('X-Request-Id', crypto.randomUUID())
    .set('X-Source', label || 'unknown');

  if (!(request.body instanceof FormData)) {
    headers = headers.set('Content-Type', 'application/json');
  }

  return request.clone({ headers });
}

function addTokenHeader(
  request: HttpRequest<any>,
  token: string,
): HttpRequest<any> {
  return request.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  });
}

function handle401Error(
  request: HttpRequest<any>,
  next: HttpHandlerFn,
  authService: LoginService,
  router: Router,
  stateService: AIInfuseStateService,
): Observable<any> {
  if (!isRefreshing) {
    isRefreshing = true;
    refreshTokenSubject.next(null);

    const refreshToken = getCookie(REFRESH_TOKEN_KEY);

    if (refreshToken) {
      return authService.refreshToken(refreshToken).pipe(
        switchMap((response) => {
          isRefreshing = false;

          // Pass the cookies instance down
          setToken({
            accessToken: response.Token,
            refreshToken: response.RefreshToken,
          });

          refreshTokenSubject.next(response.Token);
          let retried = addTokenHeader(request, response.Token);

          const apiKey = getApiKeyForActiveProject(stateService);
          if (apiKey) {
            retried = retried.clone({
              setHeaders: { 'x-api-key': apiKey },
            });
          }

          return next(retried);
        }),
        catchError((err) => {
          isRefreshing = false;
          // Pass instances down to logout
          logout(router);
          return throwError(() => err);
        }),
      );
    } else {
      isRefreshing = false;
      logout(router);
      return throwError(() => new Error('No refresh token available'));
    }
  } else {
    return refreshTokenSubject.pipe(
      filter((token) => token !== null),
      take(1),
      switchMap((token) => {
       let retried = addTokenHeader(request, token!);

        const apiKey = getApiKeyForActiveProject(stateService);
        if (apiKey) {
          retried = retried.clone({
            setHeaders: { 'x-api-key': apiKey },
          });
        }

        return next(retried);
      }),
    );
  }
}

export function logout(router?: Router): void {
  deleteCookie(ACCESS_TOKEN_KEY);
  deleteCookie(REFRESH_TOKEN_KEY);
  localStorage.clear();
  sessionStorage.clear();
  router?.navigate(['/']);
}

export function setToken(options: {
  accessToken: string;
  refreshToken: string;
}) {
  const accessTokenData = decodeJWT(options.accessToken);
  const refreshTokenData = decodeJWT(options.refreshToken);

  const accessExpiry = accessTokenData?.exp
    ? new Date(accessTokenData.exp * 1000)
    : undefined;
  const refreshExpiry = refreshTokenData?.exp
    ? new Date(refreshTokenData.exp * 1000)
    : undefined;
  const isSecure = window.location.protocol === 'https:';

  setCookie(ACCESS_TOKEN_KEY, options.accessToken, {
    expires: accessExpiry,
    path: '/',
    secure: isSecure,
    sameSite: 'Strict',
  });

  setCookie(REFRESH_TOKEN_KEY, options.refreshToken, {
    expires: refreshExpiry,
    path: '/',
    secure: isSecure,
    sameSite: 'Strict',
  });
}

let refreshTokenPromise: Promise<string | null> | null = null;

export const handle401ErrorFetch = async (
  url: string | Request,
  options: RequestInit,
): Promise<Response> => {
  if (!refreshTokenPromise) {
    refreshTokenPromise = (async () => {
      const refreshToken = getCookie('REFRESH_TOKEN_KEY');

      if (!refreshToken) {
        logout();
        window.location.href = '/';
        return null;
      }

      try {
        const response = await fetch(`${environment.baseUrl}/refresh-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${refreshToken}`,
          },
          body: JSON.stringify({}),
        });

        if (!response.ok) throw new Error('Refresh failed');
        const data = await response.json();

        setToken({
          accessToken: data.Token,
          refreshToken: data.RefreshToken,
        });

        return data.Token;
      } catch (err) {
        logout();
        window.location.href = '/';
        return null;
      } finally {
        refreshTokenPromise = null;
      }
    })();
  }

  const token = await refreshTokenPromise;

  if (token) {
    const newHeaders = new Headers(options.headers || {});
    newHeaders.set('Authorization', `Bearer ${token}`);

    return fetch(url, { ...options, headers: newHeaders });
  }

  return Promise.reject(new Error('No refresh token available'));
};

export const fetchWithAuth = async (
  url: string | Request,
  options: RequestInit = {},
): Promise<Response> => {
  const urlString = typeof url === 'string' ? url : url.url;
  const isPublic = PUBLIC_URLS.some((regex) => regex.test(urlString));

  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  const token = getCookie(ACCESS_TOKEN_KEY);
  if (!isPublic && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const authOptions: RequestInit = {
    ...options,
    headers,
  };

  try {
    let response = await fetch(url, authOptions);

    if (response.status === 401 && !isPublic) {
      return await handle401ErrorFetch(url, authOptions);
    }

    if (!response.ok) {
      throw response;
    }

    return response;
  } catch (error) {
    throw error;
  }
};
