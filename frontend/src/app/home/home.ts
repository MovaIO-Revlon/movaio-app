import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { AbstractControl, FormBuilder, FormControl, FormGroup, FormsModule, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { NgxSpinnerService } from 'ngx-spinner';
import { CommonModule, DatePipe } from '@angular/common';
import { HomeService } from '../services/home.service';
import { LoginService } from '../services/login.service';
import { Router, RouterModule } from '@angular/router';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { NgxPaginationModule } from 'ngx-pagination';
import { Header } from '../header/header';

declare var $: any;
declare var bootstrap: any;  // if not using strict types

@Component({
  selector: 'app-home',
  imports: [CommonModule,FormsModule,ReactiveFormsModule,NgxPaginationModule,RouterModule,Header],
  templateUrl: './home.html',
  styleUrl: './home.css'
})

export class Home implements OnInit,AfterViewInit {

  
  constructor(private _loadingService: NgxSpinnerService, private _homeService: HomeService, private _stateService: AIInfuseStateService, private fb: FormBuilder,
    private datePipe: DatePipe, private _router: Router, private _loginservice: LoginService, private changeDetectorRef: ChangeDetectorRef) {
    
  }
  ngAfterViewInit(): void {
    // Reinitialize the carousel if needed
    const myCarouselElement = document.querySelector('#carouselExampleIndicators');
    if (myCarouselElement) {
      new bootstrap.Carousel(myCarouselElement, {
        interval: 3000,
        ride: 'carousel'
      });
    }
  }

  isActiveRoute(route: string): boolean {
    return this._router.url === route;
  }

  ngOnInit(): void {

    this._loadingService.hide();
  }
}
