import {
  AfterViewInit,
  Component,
  ElementRef,
  OnInit,
  OnDestroy,
  Inject,
  PLATFORM_ID,
  inject,
  signal,
  viewChild,
  NgZone,
  effect,
} from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { NgxSpinnerService } from 'ngx-spinner';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { LoginService } from '../services/login.service';
import { CommonModule, isPlatformBrowser, DOCUMENT } from '@angular/common';
import { environment as config } from '../../environments/environment';
import { V } from '../utils';
import { FormError } from '../components/form-error/form-error';
import { setToken } from '../services/auth.interceptor';
import { ToastService } from '../services/toast.service';
import { Toast } from '../components/toast/toast';
import { finalize } from 'rxjs';

declare var $: any;

@Component({
  selector: 'login',
  imports: [CommonModule, FormsModule, ReactiveFormsModule, FormError, Toast],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit, AfterViewInit, OnDestroy {
  readonly isNewPort = config.IsNewPort;

  readonly fb = inject(FormBuilder);
  readonly router = inject(Router);
  readonly toast = inject(ToastService);

  readonly service = inject(LoginService);
  readonly loading = inject(NgxSpinnerService);
  readonly state = inject(AIInfuseStateService);
  readonly document = inject(DOCUMENT);
  readonly zone = inject(NgZone);

  forgotPassword = viewChild<ElementRef<HTMLDivElement>>('forgotPassword');
  recaptchaElement = viewChild<ElementRef<HTMLDivElement>>('recaptchaElement');

  loginForm = this.fb.nonNullable.group({
    username: ['', V.string('Username').email().required().build()],
    password: ['', V.string('Password').required().build()],
  });

  forgotPasswordForm = this.fb.nonNullable.group({
    email: ['', V.string('Email').email().required().build()],
  });

  loginError = signal('');

  recaptcha: any;
  captcha = signal<boolean>(false);
  siteKey = signal<string>('');
  captchaCompleted = signal(false);

  captchaResponse = '';

  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.isBrowser = isPlatformBrowser(this.platformId);

    effect(async () => {
      if (this.captcha() && this.isBrowser) {
        await this.loadRecaptchaScript();
        this.renderReCaptch();
      }
    });
  }

  ngAfterViewInit(): void {
    this.isSignInEnabled();
  }

  ngOnInit(): void {
    this.service.getReCaptchaConfig().subscribe({
      next: async (res) => {
        if (res.data) {
          this.captcha.set(res.data.OTPRecaptcha);
          this.siteKey.set(res.data.SiteKey);
        }
      },
      error: (error) => {
        console.error('Failed to get reCAPTCHA config', error);
      },
    });
  }

  ngOnDestroy(): void {
    if (this.isBrowser && (window as any)['grecaptchaCallback']) {
      delete (window as any)['grecaptchaCallback'];
    }
  }

  isSignInEnabled(): boolean {
    const isFormValid = this.loginForm?.valid ?? false;

    if (this.isNewPort) return isFormValid;

    return this.captcha()
      ? isFormValid && this.captchaCompleted()
      : isFormValid;
  }

  login(): void {
    if (!this.loginForm.valid) return;

    this.loading.show();
    const trimmedEmail = this.loginForm.value.username?.trim();

    const params = {
      EmailId: trimmedEmail!,
      Password: this.loginForm.value.password!,
    };

    this.service
      .UserLogin(params)
      .pipe(
        finalize(() => {
          this.loading.hide();
        }),
      )
      .subscribe({
        next: (res) => {
          this.loginError.set('');

          if (!res) {
            this.loading.hide();
            this.loginError.set('Error Occurred...');
            return;
          }

          if (!res.Success) {
            this.loading.hide();
            this.loginError.set(res.Message || 'Something went wrong!!');
            return;
          }

          if ('Token' in res) {
            setToken({
              accessToken: res.Token,
              refreshToken: res.RefreshToken,
            });

            const { Token: _t, RefreshToken: _r, ...userData } = res;
            if (userData.Avatar?.includes(';base64'))
              userData.Avatar = '/assets/img/profile_image.png';

            this.state.setLoginDetails(userData);
          }

          if (res.IsOTP) {
            this.router.navigate(['/otp'], {
              queryParams: {
                email: res.Email,
                employeeId: res.EmployeeId,
              },
            });
            return;
          }

          const route =
            localStorage.getItem('redirectRoute') || '/managesubscription';
          if (localStorage.getItem('redirectRoute'))
            localStorage.removeItem('redirectRoute');

          this.router.navigate([route]);
        },
        error: (err) => {
          this.loginError.set(
            err?.error?.Message || 'An error occurred during login.',
          );
        },
      });
  }

  sendRecoveryEmail(): void {
    const email = this.forgotPasswordForm.value.email?.trim();
    if (!email) return;

    this.loading.show();

    this.service
      .sentforgotEmail(email)
      .pipe(finalize(() => this.loading.hide()))
      .subscribe({
        next: () => {
          this.loading.show();
          this.toast.showToast(
            'success',
            'Your new password has been sent to your registered email.',
          );
          const el = this.forgotPassword()?.nativeElement;
          if (el) $(el).modal('hide');
        },

        error: () => {
          this.toast.showToast('error', 'Failed to send recovery email');
        },
      });
  }

  closeForgotEmail() {
    const el = this.forgotPassword()?.nativeElement;
    if (el) $(el).modal('hide');
  }

  private loadRecaptchaScript(): Promise<void> {
    return new Promise((resolve) => {
      if (
        this.document.getElementById('recaptcha-script') ||
        (window as any)['grecaptcha']
      ) {
        resolve();
        return;
      }

      (window as any)['grecaptchaCallback'] = () => {
        resolve();
      };

      const script = this.document.createElement('script');
      script.id = 'recaptcha-script';
      script.src =
        'https://www.google.com/recaptcha/api.js?onload=grecaptchaCallback&render=explicit';
      script.async = true;
      script.defer = true;

      this.document.head.appendChild(script);
    });
  }

  private renderReCaptch() {
    const el = this.recaptchaElement()?.nativeElement;
    const grecaptcha = (window as any)['grecaptcha'];

    if (!el || !grecaptcha) return;

    grecaptcha.render(el, {
      sitekey: this.siteKey(),
      callback: (response: string) =>
        this.zone.run(() => {
          this.recaptcha = response;

          if (response) {
            this.captchaCompleted.set(true);
            this.loginError.set('');
          } else {
            this.captchaCompleted.set(false);
            this.loginError.set('ReCAPTCHA response is empty');
          }
        }),
      'expired-callback': () =>
        this.zone.run(() => {
          this.captchaCompleted.set(false);
          this.loginError.set('ReCAPTCHA expired');
        }),
    });
  }
}
