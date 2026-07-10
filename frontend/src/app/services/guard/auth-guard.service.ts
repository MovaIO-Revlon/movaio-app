import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AIInfuseStateService } from '../aiinfuse-state.service';
import { MatDialog } from '@angular/material/dialog';
import { NgxSpinnerService } from 'ngx-spinner';


@Injectable({
  providedIn: 'root'
})
export class AuthGuardService implements CanActivate {

  constructor(private _stateService: AIInfuseStateService, private _router: Router, private dialog: MatDialog,private _loadingService: NgxSpinnerService) { }

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    const userDet = this._stateService.getLoginDetails();
    const IsOTPverifiedDtls = this._stateService.getLoginOTPDetails();

    const currentUrl = state.url.split('?')[0];
    if (currentUrl === '/' || currentUrl === '/login' || currentUrl === '/otp') {
      return true;
    }

    const allowedMenus = ['login', 'otp', 'managesubscription']; // Specify the menus allowed for managers
    const requestedMenu = route.data['menu'];

    if (userDet !== null) {
      const requestedMenu = route.routeConfig?.path;

      if (requestedMenu === 'managesubscription') {

        if (IsOTPverifiedDtls != null) {
          if (IsOTPverifiedDtls?.IsOTP) {
            if (IsOTPverifiedDtls.IsOTP && IsOTPverifiedDtls.IsOTPverified) {
              return true;
            }
            else {
              this._router.navigate(["/"]);
              return false;
            }
          }
          else {
            return true;
          }
        }
        else {
          this._loadingService.hide();
          return false;
        }
      }
      else {
        return true;

      }
    }
    else {
      return this._router.createUrlTree(['/']);
    }

  };
}
