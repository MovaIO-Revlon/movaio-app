import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiResponse, ILoginResponse } from '../types';
import { environment as config } from '../../environments/environment';


@Injectable({
  providedIn: 'root',
})
export class LoginService {
	
   private baseURL: string = config.apiUrl;
	
	  httpOptions = {
    headers: new HttpHeaders({
      'Content-Type': 'application/json; charset=utf-8'
    })
  };
	
  constructor(private _http: HttpClient) {}

  //#region UserManagement

  // UserLogin(params: any) {
    // return this._http.post<ApiResponse<ILoginResponse>>('/DoLogin', params); // Ensure correct path here
  // }
  
    UserLogin(params: any): Observable<any> {
      return this._http.post<any>('/DoLogin', params, this.httpOptions); // Ensure correct path here
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
      params
    );
  }
  ValidateOTP(params: any) {
    return this._http.post<ApiResponse<object>>('/ValidateOTP', params);
  }
  sentforgotEmail(mailID: any) {
    return this._http.post<ApiResponse<null>>(
      `/SendRecoveryMail/${mailID}`,
      {}
    );
  }

  //#endregion
}
