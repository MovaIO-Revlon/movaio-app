import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild, Inject, PLATFORM_ID } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, NgForm, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { NgxSpinnerService } from 'ngx-spinner';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { LoginService } from '../services/login.service';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { environment as config } from '../../environments/environment';
import { getApiError } from '../utils';

declare var $: any;

@Component({
  selector: 'app-login',
  imports: [CommonModule, FormsModule,],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit, AfterViewInit {
  UserName: any;
  Password: any;
  loginErr: String = '';
  IsOTP: string = '';
  @ViewChild('loginForm', { static: false }) public loginForm!: NgForm;
  @ViewChild('forgotPassword') forgotPassword?: ElementRef;
  @ViewChild('loadalert') loadalert?: ElementRef;
  @ViewChild('recaptchaElement', { static: false })
  recaptchaElement!: ElementRef;

  loginFormGroup!: FormGroup; // Declare FormGroup variable
  isEmailValid: boolean = false;
  isEmailTouched: boolean = false;
  myEmail: any;
  showModal = false;
  message = '';
  popupTitle = '';
  recaptcha: any;
  token: string | undefined;
  captcha: boolean = false;
  captchaCompleted: boolean = false;
  setcaptcha: any;
  siteKey: string = '';
  captchaResponse = '';
  isNewPort: boolean = config.IsNewPort;

  constructor(
    private router: Router,
    private _loginservice: LoginService,
    private _loadingService: NgxSpinnerService,
    private _stateService: AIInfuseStateService,
    private cd: ChangeDetectorRef,
    @Inject(PLATFORM_ID) private platformId: Object) {
    this.token = undefined;
  }

  ngAfterViewInit(): void {
    this.captcha = this._stateService.getLogoutOTPDetails() ?? false;

    if (this.captcha) {
      this.addRecaptchaScript();
    }
    this.isSignInEnabled();
    this.cd.detectChanges(); // manually trigger change detection
  }

  ngOnInit(): void {
    this.captcha = this._stateService.getLogoutOTPDetails();
    if (this.captcha !== null) {
      if (this.captcha) {
        this._loginservice.getReCaptchaConfig().subscribe({
          next: (res) => {
            if (res.data) {
              this.captcha = res.data.OTPRecaptcha;
              this.siteKey = res.data.SiteKey;

              this.cd.detectChanges();

              if (this.captcha) {
                this.addRecaptchaScript();
              }
            }
          },
          error: (error) => {
            console.error('Failed to get reCAPTCHA config', error);
          },
        });
      } else {
        if (this.captcha) {
          this.addRecaptchaScript();
        }
      }
    } else {
      this._loginservice.getReCaptchaConfig().subscribe(
        (res) => {
          if (res.data) {
            this.captcha = res.data.OTPRecaptcha;
            this.siteKey = res.data.SiteKey;

            // Trigger Angular change detection explicitly if required
            this.cd.detectChanges();

            if (this.captcha) {
              this.addRecaptchaScript();
            }
          }
        },
        (error) => {
          console.error('Failed to get reCAPTCHA config', error);
        }
      );
    }

    this._stateService.clearLoginDetails();
    this._stateService.clearLoginOTPDetails();
    this._stateService.clearLogoutOTPDetails();
  }



  isSignInEnabled(): boolean {
    const isFormValid = this.loginForm?.valid ?? false;
    let IsEnable: boolean = false;
    if (this.isNewPort) {
      IsEnable = isFormValid;
    }
    else {
      IsEnable = this.captcha ? (isFormValid && this.captchaCompleted) : isFormValid;
    }
    return IsEnable;
  }

  LoginNavigate(): void {
    if (this.loginForm.valid) {
      this._loadingService.show();
      const trimmedEmail = this.loginForm.value.email.trim();

      const params = {
        EmailId: trimmedEmail,
        Password: this.loginForm.value.password,
        RecaptchaResponse: this.captchaResponse
      };

      this._loadingService.show();

      this._loginservice.UserLogin(params).subscribe((data:
        {
          Success: any;
          UserName: any;
          IsOTP: string;
          Email: any;
          EmployeeId: any;
          Role: any;
          Team: any;
          Avatar: string;
          Message: String;
          ActiveProject: string;
        } | undefined) => {
        if (data !== undefined) {
          if (data.Success) {
            this._stateService.setLoginDetails(data);
            var UserOTPDetails = {
              IsOTPverified: false,
              IsOTP: this.captcha
            }
            this._stateService.setLoginOTPDetails(UserOTPDetails);
            this.loginErr = "";
            this.IsOTP = data.IsOTP;
            if (this.IsOTP) {

              const params = {
                EmailId: data.Email,
                EmployeeId: data.EmployeeId,
                Otp: 0,
              };

              this.SendOTP(params);

            }
            else {
              this._loadingService.hide();
              this.router.navigate(['/managesubscription']);
            }

          } else {
            this._loadingService.hide();
            this.loginErr = data.Message;
            this.cd.detectChanges();   // manually trigger change detection
          }
        } else {
          this._loadingService.hide();
          this.loginErr = "Error Occurred...";
        }
      }, (err: any) => {
        //  console.log('Login Page---', err);
      });
    } else {
      //  console.log('Invalid...');
    }
  }

  SendOTP(params: any): void {
    // this._loginservice.SentOtp(params).subscribe((data: undefined) => {
    // if (data !== undefined) {
    this.router.navigate(['/otp']);
    // //  console.log("OTP sented");
    // }
    // });
  }
  markEmailAsTouched() {
    this.isEmailTouched = true;
  }

  validateEmail() {
    const emailPattern = /^[A-Za-z0-9._%+-]+@movate\.com$/;
    this.isEmailValid = emailPattern.test(this.myEmail);
  }

  sendMail(): void {
    if (this.myEmail) {
      this._loginservice.sentforgotEmail(this.myEmail).subscribe((res) => {
        if (this.forgotPassword && this.forgotPassword.nativeElement) {
          const modalElement = this.forgotPassword.nativeElement;
          $(modalElement).modal('hide');
        }
        if (this.loadalert && this.loadalert.nativeElement) {
          const modalElement = this.loadalert.nativeElement;
          $(modalElement).modal('show');
        }
        this.popupTitle = 'Forgot Password';
        this._loadingService.hide();
        this.openModal(
          'exampleModalLabel1',
          'Password has been sent successfully! '
        );
        this.cd.detectChanges(); // manually trigger change detection
      });
    } else {
    }
  }
  openModal(messageId: string, Usermessage: string) {
    this.showModal = true;
    this.message = Usermessage;
    const element = document.getElementById(messageId);
    if (element) {
      element.style.display = 'block';
    } else {
      //  console.error(`Element with ID ${messageId} not found`);
    }
  }

  closeModal() {
    this.showModal = false;
    this.message = '';
  }

  closealert(): void {
    this.showModal = false;
    this.message = '';
    this.popupTitle = '';
    if (this.loadalert && this.loadalert.nativeElement) {
      const modalElement1 = this.loadalert.nativeElement;
      $(modalElement1).modal('hide');
    }
  }

  closeForgotEmail(): void {
    this.myEmail = '';
    this.isEmailTouched = false;
    this.isEmailValid = true;
    if (this.forgotPassword && this.forgotPassword.nativeElement) {
      const modalElement1 = this.forgotPassword.nativeElement;
      $(modalElement1).modal('hide');
    }
  }

  renderReCaptch() {
    if (this.recaptchaElement && this.recaptchaElement.nativeElement) {
      window['grecaptcha'].render(this.recaptchaElement.nativeElement, {
        sitekey: this.siteKey,
        callback: (response) => {
          this.recaptcha = response;
          if (response !== '') {
            this.captchaResponse = response;
            //console.log("Rechaptcha :"+ response);
            this.captchaCompleted = response ? true : false;
            this.loginErr = response ? '' : 'ReCAPTCHA response is empty';
            this.isSignInEnabled();
            this.cd.detectChanges();
          } else {
            this.captchaCompleted = false;
            this.isSignInEnabled();
            this.cd.detectChanges();
          }
        },
        'expired-callback': () => {
          this.captchaCompleted = false;
          this.isSignInEnabled();
          this.cd.detectChanges();
        },
      });
    } else {
      if (this.captcha) {
        //  this.loginErr = "recaptcha is not defined or not available";
      }
    }
  }

  addRecaptchaScript() {
    if (!isPlatformBrowser(this.platformId)) {
      // Do nothing if it's not running in the browser
      return;
    }

    let myWindow: any = window;
    myWindow['grecaptchaCallback'] = () => {
      this.renderReCaptch();
    };

    (function (d, s, id, obj) {
      var js: HTMLScriptElement, fjs = d.getElementsByTagName(s)[0];
      if (d.getElementById(id)) { obj.renderReCaptch(); return; }
      js = d.createElement(s) as HTMLScriptElement;
      js.id = id;
      js.src = "https://www.google.com/recaptcha/api.js?onload=grecaptchaCallback&render=explicit";
      fjs.parentNode!.insertBefore(js, fjs);
    })(document, 'script', 'recaptcha-jssdk', this);
  }
}
