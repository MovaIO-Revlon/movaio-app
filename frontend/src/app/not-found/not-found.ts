import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { NgxSpinnerService } from 'ngx-spinner';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-not-found',
  imports:[CommonModule],
  templateUrl: './not-found.html',
  styleUrl: './not-found.css'
})

export class NotFound implements OnInit {

  constructor(private _loadinService: NgxSpinnerService, private _router: Router, private _stateService: AIInfuseStateService) { }

  ngOnInit(): void {
    this._loadinService.hide();
    this._stateService.clearLoginDetails();
  }
  closePopup(): void {
    this._router.navigate(['/login']);
  }
}

