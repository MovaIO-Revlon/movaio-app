import {
  Component,
  OnInit,
  AfterViewInit,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { NgxSpinnerService } from 'ngx-spinner';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import Chart from 'chart.js/auto';
import { Header } from '../../header/header';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { ChangeDetectorRef } from '@angular/core';
import { SemarketplaceService } from '../../services/semarketplace.service';

declare var $: any;
declare var bootstrap: any;

@Component({
  selector: 'app-marketplace',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    Header,
    RouterModule,
  ],
  templateUrl: './marketplace.html',
  styleUrl: './marketplace.css',
})
export class MarketPlace implements AfterViewInit {
  constructor(
    private _router: Router,
    private apiService: SemarketplaceService,
    private fb: FormBuilder,
    private cdRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    if (
      !['/marketplace/workflows', '/marketplace/mcpconnectors','/marketplace/promptrepository'].includes(
        this._router.url,
      )
    ) {
      this.agentManage_link();
    }
  }

  ngAfterViewInit(): void {}

  agentManage_link(): void {
    this._router.navigate(['/marketplace/agentmanagement']);
  }

  agencyManage_link(): void {
    this._router.navigate(['/marketplace/agencymanagement']);
  }

  isActiveRoute(route: string): boolean {
    return this._router.url === route;
  }
}
