import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  signal,
  computed
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { NgxSpinnerService } from 'ngx-spinner';
import { finalize } from 'rxjs';

import { LoginService } from '../services/login.service';
import { environment as config } from '../../environments/environment';
import { FormError } from '../components/form-error/form-error';
import { V } from '../utils';
import { setToken } from '../services/auth.interceptor';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';

@Component({
  selector: 'app-otp',
  standalone: true,
  imports: [ReactiveFormsModule, FormError],
  template: `
    <div class="bg-color w-100 h-100">
      <div class="row m-0 vh-100">
        <div class="col-md-6 p-0 bg-black">
          <img
            src="assets/img/login.png"
            class="img-fluid h-100 w-100 object-fit-cover"
            alt="Login"
          />
        </div>
        <div
          class="col-md d-flex justify-content-center align-items-center bg-white"
        >
          <div class="logcont-1 bg-white d-flex flex-column pt-5">
            @if (!isNewPort) {
              <img
                src="assets/img/header.svg"
                width="250"
                class="align-self-center"
                alt="Logo"
              />
            } @else {
              <img
                src="assets/img/header_newport.png"
                class="align-self-center"
                style="width: 350px;"
                alt="Newport"
              />
            }

            <div class="border rounded-4 p-5 mt-3">
              <p class="fs-20 pt-2 align-self-center text-center">
                Two step authentication
              </p>
              <p class="fs-15 d-flex">
                <i
                  class="fa fa-envelope text-danger fs-3"
                  aria-hidden="true"
                ></i>
                <span class="ps-2">
                  An email with a verification code was just sent to <br />
                  <b>{{ emailID() }}</b>
                </span>
              </p>

              <form
                [formGroup]="otpForm"
                class="row"
                (ngSubmit)="otploginSubmit()"
              >
                <div class="col-md-12 mt-3">
                  <label class="form-label fs-13"
                    >Enter Verification Code</label
                  >
                  <input
                    type="text"
                    formControlName="otpCode"
                    autocomplete="off"
                    maxlength="6"
                    class="form-control p-3 br-clr1 text-center fs-13"
                    placeholder="Enter the 6-digit code"
                  />
                  <form-error controlName="otpCode" />

                  <p
                    class="fs-13 mt-2 align-items-center d-flex justify-content-between"
                    style="min-height: 2rem;"
                  >
                    @let time = remainingTime();
                    <label class="form-label fs-13 mb-0">
                      {{ time ? time + ' Seconds Left....' : ' ' }}
                    </label>
                    <a
                      href="javascript:void(0)"
                      (click)="!resendDisabled() && resendOTP()"
                      class="link-clr fs-13"
                      [class.disabled-link]="resendDisabled()"
                    >
                      <i class="fa fa-repeat" aria-hidden="true"></i>
                      Resend again
                    </a>
                  </p>
                </div>

                @let error = loginError();

                <div class="text-center">
                  <button
                    class="btn btn-primary bt-bg-color px-5 py-2 border-0 br-30 fs-13 pt-2 pb-2"
                    type="submit"
                    [disabled]="
                      otpForm.invalid ||
                      error === 'Maximum OTP attempts exceeded'
                    "
                  >
                    Verify
                  </button>
                </div>
              </form>

              @if (error) {
                <small class="form-text text-danger mt-2 d-block text-center">
                  {{ error }}
                </small>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class Otp implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private loader = inject(NgxSpinnerService);
  private service = inject(LoginService);
  private state = inject(AIInfuseStateService);
  private fb = inject(FormBuilder);

  isNewPort = config.IsNewPort;

  emailID = signal('');
  employeeId = signal('');
  remainingTime = signal(0);
  loginError = signal('');
  resendDisabled = computed(() => this.remainingTime() > 0);

  otpForm = this.fb.nonNullable.group({
    otpCode: [
      '',
      V.string('Verification Code')
        .required('Please enter the verification code.')
        .matches(/^[0-9]{6}$/, 'Code must be exactly 6 digits.')
        .build(),
    ],
  });

  private countdownTimerRef: any;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;

    this.emailID.set(params.get('email') || '');
    this.employeeId.set(params.get('employeeId') || '');

    this.startTimer();
  }

  ngOnDestroy(): void {
    clearInterval(this.countdownTimerRef);
  }

  otploginSubmit(): void {
    this.otpForm.markAllAsTouched();

    if (this.otpForm.invalid) return;

    this.loader.show();
    this.loginError.set('');

    const params = {
      EmailId: this.emailID(),
      EmployeeId: this.employeeId(),
      Otp: this.otpForm.getRawValue().otpCode,
    };

    this.service
      .ValidateOTP(params)
      .pipe(finalize(() => this.loader.hide()))
      .subscribe({
        next: ({ data }) => {
          setToken({
            accessToken: data.Token,
            refreshToken: data.RefreshToken,
          });

          const { Token: _t, RefreshToken: _r, ...userData } = data;
          this.state.setLoginDetails(userData);
          const route = localStorage.getItem('redirectRoute');
          if (route) localStorage.removeItem('redirectRoute');

          this.router.navigate([route || '/managesubscription']);
        },
        error: (err) => {
          this.loginError.set(
            err?.error?.message || 'An error occurred while verifying the OTP.',
          );

          if (err?.error?.message === 'Maximum OTP attempts exceeded') {
            if (this.countdownTimerRef) clearInterval(this.countdownTimerRef);

            this.remainingTime.set(0);
          }
        },
      });
  }

  resendOTP(): void {
    if (this.resendDisabled()) return;

    this.loginError.set('');
    this.otpForm.reset();
    this.startTimer();

    this.loader.show();

    this.service
      .SentOtp({
        EmailId: this.emailID(),
        EmployeeId: this.employeeId(),
        Otp: 0,
      })
      .pipe(finalize(() => this.loader.hide()))
      .subscribe({
        error: () => this.loginError.set('Failed to resend OTP.'),
      });
  }

  private startTimer(): void {
    const timerDuration = 120; // seconds
    this.remainingTime.set(timerDuration);
    clearInterval(this.countdownTimerRef);

    this.countdownTimerRef = setInterval(() => {
      this.remainingTime.update((time) => time - 1);

      if (this.remainingTime() <= 0) {
        clearInterval(this.countdownTimerRef);
      }
    }, 1000);
  }
}
