import { computed, Injectable, InjectionToken, signal } from '@angular/core';
export const PAGE_NAME = new InjectionToken<'insights' | 'trends'>('insights');

@Injectable({ providedIn: 'root' })
export class TrackRequestService {
  activeRequests = signal(0);
  allDone = computed(() => this.activeRequests() === 0);

  requestStarted() {
    this.activeRequests.update((v) => v + 1);
  }

  requestEnded() {
    this.activeRequests.update((v) => Math.max(0, v - 1));
  }
}
