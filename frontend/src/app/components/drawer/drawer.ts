import { Component, output } from '@angular/core';

@Component({
  selector: 'drawer',
  imports: [],
  templateUrl: './drawer.html',
  styleUrl: './drawer.css',
  host: {
    '(click)': 'closeModal($event)',
  },
})
export class Drawer {
  close = output();

  closeModal(event: MouseEvent) {
    const target = event.target as HTMLDivElement;

    if (target.tagName === 'DRAWER') this.close.emit();
  }
}
