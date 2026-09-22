import { HttpBackend, HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ApiResponse, ILoginOtpResponse, ILoginResponse } from '../types';
import { environment as config } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class LoginService {
  private baseURL: string = config.apiUrl;

  private bypassHttp = new HttpClient(inject(HttpBackend));

  httpOptions = {
    headers: new HttpHeaders({
      'Content-Type': 'application/json; charset=utf-8',
    }),
  };

  constructor(private _http: HttpClient) {}

  //#region UserManagement

  UserLogin(params: { EmailId: string; Password: string }) {
    return this._http.post<ILoginResponse | ILoginOtpResponse>(
      `${this.baseURL}/DoLogin`,
      params,
      this.httpOptions,
    );
  }

  refreshToken(refreshToken: string) {
    return this.bypassHttp.post<{ Token: string; RefreshToken: string }>(
      `${this.baseURL}/refresh-token`,
      {},
      {
        headers: {
          Authorization: `Bearer ${refreshToken}`,
        },
      },
    );
  }

  getReCaptchaConfig() {
    return this._http.get<
      ApiResponse<{
        OTPRecaptcha: boolean;
        SiteKey: string;
      }>
    >('/GetReCaptchaConfig'); // Ensure correct path here
  }
  SentOtp(params: any) {
    return this._http.post<ApiResponse<{ sentOtp: boolean }>>(
      '/OTPDetails',
      params,
    );
  }
  ValidateOTP(params: any) {
    return this._http.post<ApiResponse<ILoginResponse>>('/ValidateOTP', params);
  }
  sentforgotEmail(mailID: any) {
    return this._http.post<ApiResponse<null>>(
      `/SendRecoveryMail/${mailID}`,
      {},
    );
  }

  //#endregion
}
