import { ChangeDetectorRef, Component, OnInit, ViewChild } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { NgxSpinnerService } from 'ngx-spinner';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { LoginService } from '../services/login.service';
import { CommonModule } from '@angular/common';
import { environment as config } from '../../environments/environment';

@Component({
  selector: 'app-otp',
  imports: [CommonModule, FormsModule],
  templateUrl: './otp.html',
  styleUrl: './otp.css',
})
export class Otp implements OnInit {
  loggedUser: any;
  emailID: any;
  OTPCode: any;
  loginErr: String = '';
  remainingTime = 0;
  resendDisabled = true;
  employeeId: any;
  private countdownTimerRef: any;
  isNewPort: boolean = config.IsNewPort;

  @ViewChild('#otploginForm', { static: false }) public otploginForm!: NgForm;

  constructor(
    private router: Router,
    private _loadingService: NgxSpinnerService,
    private _stateService: AIInfuseStateService,
    private _loginService: LoginService,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loggedUser = this._stateService.getLoginDetails();
    this.emailID = this.loggedUser.Email;
    this.employeeId = this.loggedUser.EmployeeId;
    // this.startTimer();
    this.resendOTP();
    this._stateService.clearLoginOTPDetails();
    this.cd.detectChanges();
  }

  otploginSubmit(): void {
    let params = {
      EmailId: this.emailID,
      EmployeeId: this.employeeId,
      Otp: String(this.OTPCode),
    };
    var IsOTPDetails = this._stateService.getLoginOTPDetails();
    this._loadingService.show();
    this._loginService.ValidateOTP(params).subscribe({
      next: () => {
        var UserOTPDetails = {
          IsOTPverified: true,
          IsOTP: IsOTPDetails?.IsOTP,
        };
        this._stateService.setLoginOTPDetails(UserOTPDetails);
        const UserDetails = this._stateService.getLoginDetails();
        this._stateService.setLoginDetails(UserDetails);
        this.router.navigate(['/managesubscription']);
      },
      error: (err: any) => {
        //  console.log('Login Page---', err);
        this._loadingService.hide();
        this.loginErr = err?.error?.message || 'Error Occured...';
        this.cd.detectChanges();
      },
    });
  }

  resendOTP() {
    this.loginErr = '';
    this.OTPCode = '';
    this.resendDisabled = true;
    this.startTimer();
    const params = this._stateService.getLoginDetails();
    this._stateService.setLoginDetails(params);

    const params1 = {
      EmailId: this.emailID,
      EmployeeId: this.employeeId,
      Otp: 0,
    };
    this._loginService.SentOtp(params1).subscribe({
      next: () => {
        this._loadingService.hide();
      }
    });
  }

  startTimer_old() {
    const timerDuration = 120;
    clearInterval(this.countdownTimerRef);

    // Start the countdown timer
    this.remainingTime = timerDuration;
    this.countdownTimerRef = setInterval(() => {
      this.remainingTime--;
      if (this.remainingTime === 0) {
        this.resendDisabled = false;
        clearInterval(this.countdownTimerRef);
      }
      this.cd.detectChanges(); // manually trigger change detection
    }, 1000); // Update the timer every second
  }
  
  startTimer() {
    const timerDuration = 120; // seconds
    clearInterval(this.countdownTimerRef);

    // Record the exact moment the timer starts (in milliseconds)
    const startTime = Date.now();
    const expiryTime = startTime + timerDuration * 1000;

    this.remainingTime = timerDuration;
    this.resendDisabled = true;

    this.countdownTimerRef = setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - startTime) / 1000);
      this.remainingTime = Math.max(0, timerDuration - elapsedSeconds);

      if (this.remainingTime <= 0) {
        this.resendDisabled = false;
        clearInterval(this.countdownTimerRef);
      }

      this.cd.detectChanges();
    }, 1000);
  }
}
