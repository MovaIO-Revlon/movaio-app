import { Directive, ElementRef, Input, OnInit, Renderer2 } from '@angular/core';

@Directive({
  selector: '[appMessageExpand]'
})
export class MessageExpandDirective implements OnInit {

  @Input() messageIndex!: number;
  @Input() messageFrom!: string;

  private isExpanded = false;

  constructor(
    private el: ElementRef,
    private renderer: Renderer2
  ) {}

  ngOnInit() {
    if (this.messageFrom !== 'user') return;

    // Check after a small delay
    setTimeout(() => this.checkOverflow(), 50);
  }

  private checkOverflow() {
    const element = this.el.nativeElement;
    const isOverflowing = element.scrollHeight > element.clientHeight + 4;

    if (isOverflowing) {
      this.renderer.addClass(element, 'needs-toggle');
      // You can emit or use a service if needed
    }
  }

  toggle() {
    this.isExpanded = !this.isExpanded;
    if (this.isExpanded) {
      this.renderer.addClass(this.el.nativeElement, 'expanded');
    } else {
      this.renderer.removeClass(this.el.nativeElement, 'expanded');
    }
  }
}