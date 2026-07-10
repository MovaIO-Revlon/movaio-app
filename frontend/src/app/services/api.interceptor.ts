import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { TrackRequestService } from './track-request.service';

export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  const tracker = inject(TrackRequestService);
  const cloned = req.clone({
    url: req.url.startsWith('http') ? req.url : environment.apiUrl + req.url,
  });

  const trackRequest = req.url.includes('/insights/call_agent');
  if (trackRequest) tracker.requestStarted();

  return next(cloned).pipe(
    finalize(() => trackRequest && tracker.requestEnded()),
  );
};
