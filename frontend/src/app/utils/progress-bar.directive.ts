import { Directive, ElementRef, Input, OnChanges } from '@angular/core';

@Directive({
  selector: '[appProgressBar]'
})
export class ProgressBarDirective implements OnChanges {
  @Input('appProgressBar') progress: number = 0;

  constructor(private el: ElementRef<HTMLDivElement>) {}

  ngOnChanges() {
    // Force width update
    this.el.nativeElement.style.width = `${this.progress}%`;
  }
}