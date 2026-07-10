import { Component } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { NgxSpinnerService } from 'ngx-spinner';
import { CommonModule } from '@angular/common';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { LoginService } from '../services/login.service';

@Component({
  selector: 'app-unauthorized-popup',
  imports: [CommonModule, BrowserModule, FormsModule],
  templateUrl: './unauthorized-popup.html',
  styleUrl: './unauthorized-popup.css'
})

export class UnauthorizedPopup {
  constructor(private dialogRef: MatDialogRef<UnauthorizedPopup>,
    private dialog: MatDialog,
    private _loginservice: LoginService,
    private _router: Router,
    private _stateService: AIInfuseStateService,
    private _loadingService: NgxSpinnerService,
  ) { }

  public ngOnInit() {
    this._loadingService.hide();
    this.openDialog();
  }

  openDialog() {
    this.dialog.open(UnauthorizedPopup, {
      width: '250px',
      data: {} // any data you want to pass to the dialog
    });
  }

  closePopup(): void {
    this.dialogRef.close();
    this._stateService.clearLoginDetails();
    this._stateService.clearLoginOTPDetails();
    this._stateService.clearLogoutOTPDetails();
    this._loginservice.getReCaptchaConfig().subscribe({
      next: res => {
      let captcha = res.data.OTPRecaptcha;
      this._stateService.setLogoutOTPDetails(captcha);
      this._router.navigate(["/"]);
    }
  });
  }
}