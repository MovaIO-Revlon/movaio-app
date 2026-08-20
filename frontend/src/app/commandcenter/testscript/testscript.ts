import { Component,ChangeDetectorRef } from '@angular/core';
import { NgxSpinnerService } from 'ngx-spinner';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HomeService } from '../../services/home.service';
import { LoginService } from '../../services/login.service';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { Header } from '../../header/header';
@Component({
  selector: 'app-testscript',
  imports: [CommonModule,Header],
  templateUrl: './testscript.html',
  styleUrl: './testscript.css'
})
export class Testscript {
  loggedUser: any;
  userName: any;
  employeeId: any;
  userRole: any;
  roleId: any;
  roleDetail: string = "";
  emailID: any;

  constructor(private _loadingService: NgxSpinnerService,private _router: Router,private _stateService: AIInfuseStateService, private _homeService: HomeService, private _loginservice: LoginService,private changeDetectorRef: ChangeDetectorRef) {}

  ngOnInit(): void {
    // Stop the spinner when the component is initialized
    this.loggedUser = this._stateService.getLoginDetails();
    this.userName = this.loggedUser.UserName;
    this.emailID = this.loggedUser.Email;
    this.employeeId = this.loggedUser.EmployeeId;
    this.roleDetail = this.loggedUser.Role;
   
    this._loadingService.hide();
    this._loadingService.hide();
  }
  isActiveRoute(route: string): boolean {
    // Check if the current route matches the provided route
    return this._router.url === route;
  }


  home_link(): void {
    // Navigate to the home page
    this._router.navigate(['/home']);
  }

  testcase_link(): void {
    // Navigate to the test case page
    this._router.navigate(['/commandcenter/testcase']);
  }
  UserOnboard(): void {
    // Navigate to the user onboarding page
    this._router.navigate(['/commandcenter/useronboard']);
  }
}
