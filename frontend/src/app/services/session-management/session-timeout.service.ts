import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import config from '../../../assets/config/config.json';
import { environment } from '../../../environments/environment';
 
 
@Injectable({
  providedIn: 'root'
})
export class SessionTimeoutService {
  private sessionTimeout: any;
  // private SessionTime: number = config.apiServer.SessionTime;
  // private readonly timeoutDuration = this.SessionTime * 60 * 1000; // 30 minutes
  private readonly timeoutDuration = environment.SessionTclsime * 60 * 1000;
  private isBrowser: boolean;
 
  constructor(
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isBrowser = isPlatformBrowser(this.platformId);
    // console.log('Session timeout set to', this.timeoutDuration / 1000, 'seconds');
  }
 
  startSessionTimer() {
    if (!this.isBrowser) return;
    // Clear any existing timer first
    this.clearTimer();
    // Start new timer
    this.sessionTimeout = setTimeout(() => {
      this.handleSessionTimeout();
    }, this.timeoutDuration);
  }
 
  resetSessionTimer() {
    if (!this.isBrowser) return;
    this.clearTimer();           // Clear old
    this.startSessionTimer();    // Start fresh → NO LOOP
  }
 
  private clearTimer() {
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null; // ← Important: reset reference
    }
  }
 
  handleSessionTimeout() {
    if (!this.isBrowser) return;
    localStorage.clear();
    sessionStorage.clear();
    this.router.navigate(['/']);
  }
 
  trackUserActivity() {
    if (!this.isBrowser) return;
    const reset = () => this.resetSessionTimer();
    ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'].forEach(event => {
      window.addEventListener(event, reset, { passive: true });
    });
  }
}