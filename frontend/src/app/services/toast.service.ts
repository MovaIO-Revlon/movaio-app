import { Injectable, signal } from '@angular/core';

declare var bootstrap: any;

@Injectable({
  providedIn: 'root',
})
export class ToastService {
  toastMessage = signal('');

  showToast(type: 'success' | 'error', message: string): void {
    this.toastMessage.update(() => message);
    const toastId = type === 'success' ? '#successToast' : '#errorToast';
    const toastEl = document.querySelector(toastId);
    if (toastEl) {
      const toast = new bootstrap.Toast(toastEl);
      toast.show();
    }
  }
}
