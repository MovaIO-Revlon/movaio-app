import { Component, OnInit, ChangeDetectorRef, AfterViewInit, ViewChild, ElementRef } from '@angular/core';
import { NgxSpinnerService } from 'ngx-spinner';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HomeService } from '../../services/home.service';
import { LoginService } from '../../services/login.service';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { Header } from '../../header/header';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { Chatbot } from '../../chatbot/chatbot';

declare var $: any;

@Component({
  selector: 'app-commendcenter',
  imports: [CommonModule, Header, FormsModule,RouterModule],
  templateUrl: './commendcenter.html',
  styleUrl: './commendcenter.css'
})
export class CommendCenter implements AfterViewInit {

  captcha: boolean = false;
  showTestCases: boolean = false;

  constructor(private _loadingService: NgxSpinnerService, private _router: Router, private _stateService: AIInfuseStateService, private _homeService: HomeService, private _loginservice: LoginService, private changeDetectorRef: ChangeDetectorRef,
    private sanitizer: DomSanitizer
  ) { }

  ngAfterViewInit(): void {
  }

  ngOnInit(): void {
   this.initialRoute();
  }

  initialRoute():void{
    this._router.navigate(['commandcenter/testcase']);
  }

  isActiveRoute(route: string): boolean {
    // Check if the current route matches the provided route
    return this._router.url === route;
  }


  home_link(): void {
    // Navigate to the home page
    this._router.navigate(['/home']);
  }

  toggleSection(val: boolean) {
    this.showTestCases = val;
  }

  doLogOut(): void {
    this._stateService.clearLoginDetails();
    this._stateService.clearLoginOTPDetails();
    this._stateService.clearLogoutOTPDetails();
    this._loginservice.getReCaptchaConfig().subscribe(res => {
      this.captcha = res.data.OTPRecaptcha;
      this._stateService.setLogoutOTPDetails(this.captcha);
      this._router.navigate(["/"]);
    });
  }
}
