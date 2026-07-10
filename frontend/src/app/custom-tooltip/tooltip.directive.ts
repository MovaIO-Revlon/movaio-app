import { Directive, Input, ElementRef, HostListener, Renderer2, OnDestroy } from '@angular/core';

@Directive({
  selector: '[appTooltip]'
})
export class TooltipDirective implements OnDestroy {

  @Input('appTooltip') tooltipText: string = '';

  private tooltip: HTMLElement | null = null;

  constructor(
    private el: ElementRef,
    private renderer: Renderer2
  ) { }

  @HostListener('mouseenter')
  onMouseEnter(): void {
    this.destroyTooltip();
    this.createTooltip();
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    this.destroyTooltip();
  }

  @HostListener('click')
  onClick(): void {
    this.destroyTooltip();
  }

  // Fixed: No ['$event'] since we don't use the event
  @HostListener('window:scroll')
  @HostListener('window:resize')
  onGlobalEvents(): void {
    this.destroyTooltip();
  }

  private createTooltip(): void {
    if (!this.tooltipText?.trim()) {
      return;
    }

    this.tooltip = this.renderer.createElement('span');

    if(!this.tooltip) return;

    this.tooltip.innerText = this.tooltipText;

    this.renderer.addClass(this.tooltip, 'custom-tooltip');
    this.renderer.appendChild(document.body, this.tooltip);

    this.positionTooltip();
  }

  private positionTooltip(): void {
    if (!this.tooltip) return;

    const hostRect = this.el.nativeElement.getBoundingClientRect();
    const tooltipRect = this.tooltip.getBoundingClientRect();

    let left = hostRect.left;
    let top = hostRect.top - tooltipRect.height - 8;

    if (left + tooltipRect.width > window.innerWidth - 10) {
      left = window.innerWidth - tooltipRect.width - 10;
    }

    if (left < 10) {
      left = 10;
    }

    if (top < 10) {
      top = hostRect.bottom + 8;
    }

    this.tooltip.style.position = 'fixed';
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
    this.tooltip.style.zIndex = '2000';
  }

  private destroyTooltip(): void {
    if (this.tooltip) {
      this.renderer.removeChild(document.body, this.tooltip);
      this.tooltip = null;
    }
  }

  ngOnDestroy(): void {
    this.destroyTooltip();
  }
}