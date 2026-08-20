import { Component, AfterViewInit, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Header } from '../../header/header';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-commendcenter',
  imports: [CommonModule, Header, FormsModule, RouterModule],
  templateUrl: './commendcenter.html',
  styleUrl: './commendcenter.css',
})
export class CommendCenter implements AfterViewInit {
  private router = inject(Router);

  showTestCases: boolean = false;

  ngAfterViewInit(): void {}

  ngOnInit(): void {
    this.initialRoute();
  }

  initialRoute(): void {
    this.router.navigate(['commandcenter/testcase']);
  }

  isActiveRoute(route: string): boolean {
    // Check if the current route matches the provided route
    return this.router.url === route;
  }

  home_link(): void {
    // Navigate to the home page
    this.router.navigate(['/home']);
  }

  toggleSection(val: boolean) {
    this.showTestCases = val;
  }
}
