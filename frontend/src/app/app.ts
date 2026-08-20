import { Component, OnInit } from '@angular/core';
import { Event, NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router, RouterModule } from '@angular/router';
import { NgxSpinnerService,NgxSpinnerModule } from 'ngx-spinner';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { NgxPaginationModule } from 'ngx-pagination';
import { RecaptchaV3Module } from 'ng-recaptcha';
import { LoginService } from './services/login.service';
import { AuthGuardService } from './services/guard/auth-guard.service';
import { SessionTimeoutService } from './services/session-management/session-timeout.service';
import { CommonModule, DatePipe } from '@angular/common';
import { HomeService } from './services/home.service';
import { SemarketplaceService } from './services/semarketplace.service';
import { secommendcenter } from './services/secommedcenter.service';
import { NgMultiSelectDropDownModule } from 'ng-multiselect-dropdown';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterModule,
    NgxSpinnerModule,
    FormsModule,
    CommonModule,
    MatDialogModule,
    NgxPaginationModule,
    ReactiveFormsModule,
    RecaptchaV3Module,
	NgMultiSelectDropDownModule
      ],
  providers:[LoginService,HomeService,DatePipe,AuthGuardService,SemarketplaceService,secommendcenter],
  template: `
    <router-outlet></router-outlet>
    <ngx-spinner bdColor="rgba(0,0,0,0.8)" size="medium" color="#fff" type="ball-clip-rotate-multiple" [fullScreen]="true">
    </ngx-spinner>
  `,
})
export class App implements OnInit {

  constructor(private readonly _loadingService: NgxSpinnerService, private readonly _router: Router, private readonly sessionTimeoutService: SessionTimeoutService, private route: ActivatedRoute) {
   this._router.events.subscribe((routerEvent: Event) => {

     if (routerEvent instanceof NavigationStart) {
       this._loadingService.show();
     }
     if (routerEvent instanceof NavigationEnd || routerEvent instanceof NavigationCancel || routerEvent instanceof NavigationError) {
       // Hide the global spinner when navigation finishes, is cancelled, or errors
       this._loadingService.hide();
     }

   });
 }

 ngOnInit() {
  this.route.queryParamMap.subscribe(params => {
    const id = params.get('redirectRoute');
    if (id) {
      localStorage.setItem('redirectRoute', id);
    }
    const agentId = params.get('agentId');
    if (agentId) {
      localStorage.setItem('agentId', agentId);
    }
    const approvalAction = params.get('approvalAction');
    if (approvalAction) {
      localStorage.setItem('approvalAction', approvalAction);
    }
  });
   this.sessionTimeoutService.startSessionTimer();
   this.sessionTimeoutService.trackUserActivity();
 }
}
