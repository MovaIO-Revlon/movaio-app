import { Injectable } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
  UrlTree,
} from '@angular/router';
import { AIInfuseStateService } from '../aiinfuse-state.service';

@Injectable({
  providedIn: 'root',
})
export class AuthGuardService implements CanActivate {
  constructor(
    private _stateService: AIInfuseStateService,
    private _router: Router,
  ) {}

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): boolean | UrlTree {
    const userDet = this._stateService.getLoginDetails();
    const currentUrl = state.url.split('?')[0];

    const isPublicRoute =
      currentUrl === '/' || currentUrl === '/login' || currentUrl === '/otp';

    if (userDet) {
      if (isPublicRoute) {
        const redirectRoute = route.queryParamMap.get('redirectRoute');

        if (redirectRoute) {
          const agentId = route.queryParamMap.get('agentId');
          const approvalAction = route.queryParamMap.get('approvalAction');

          if (agentId) localStorage.setItem('agentId', agentId);
          if (approvalAction)
            localStorage.setItem('approvalAction', approvalAction);

          return this._router.createUrlTree([redirectRoute]);
        }

        return this._router.createUrlTree(['/managesubscription']);
      }

      return true;
    }

    if (isPublicRoute) {
      return true;
    }

    return this._router.createUrlTree(['/']);
  }
}
