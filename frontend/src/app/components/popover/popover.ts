import {
  Component,
  ElementRef,
  HostListener,
  model,
  ViewChild,
  effect,
  input,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';

@Component({
  selector: 'popover',
  standalone: true,
  template: `<div
      class="popover-trigger"
      #defaultTrigger
      (click)="toggle()"
      [ariaDisabled]="disabled()"
    >
      <ng-content select="[trigger]">Trigger</ng-content>
    </div>

    <div
      #popover
      popover="manual"
      class="popover-content"
      (click)="handleContentClick($event)"
    >
      <ng-content select="[content]"></ng-content>
    </div> `,
  styles: `
    :host([popover-width='parent']) {
      display: block;
    }

    div[popover] {
      display: none;
      position: fixed;
      margin: 0;
      border: none;
      background: transparent;

      max-height: calc(100vh - 16px);
      max-width: calc(100vw - 16px);
      overflow-y: auto;
      overflow-x: hidden;
    }

    div[popover]:popover-open {
      display: block;
    }
  `,
})
export class Popover implements AfterViewInit, OnDestroy {
  @ViewChild('defaultTrigger') defaultTrigger!: ElementRef<HTMLElement>;
  @ViewChild('popover') popover!: ElementRef<HTMLElement>;

  isOpen = model(false);
  disabled = input(false);
  positionY = input<'top' | 'bottom'>('bottom');
  closeOnClick = input<boolean>(false);

  matchParentWidth = input<boolean>(false, { alias: 'popover-width' });

  private animationFrameId: number | null = null;

  private updateHandler = () => {
    if (this.isOpen()) {
      if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = requestAnimationFrame(() =>
        this.updatePosition(),
      );
    }
  };

  constructor() {
    effect(() => {
      const isOpen = this.isOpen();
      const disabled = this.disabled();

      if (disabled) return;
      this.render(isOpen);
    });
  }

  ngAfterViewInit(): void {
    this.render(this.isOpen());
  }

  ngOnDestroy(): void {
    this.removeEventListeners();
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
  }

  render(isOpen: boolean) {
    const element = this.popover?.nativeElement;
    if (!element) return;

    if (isOpen) {
      if (!element.matches(':popover-open')) {
        element.showPopover();
        this.addEventListeners();
        queueMicrotask(() => this.updatePosition());
      }
    } else {
      if (element.matches(':popover-open')) {
        element.hidePopover();
      }
      this.removeEventListeners();
    }
  }

  private addEventListeners() {
    if (typeof window === 'undefined') return;
    window.addEventListener('scroll', this.updateHandler, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', this.updateHandler, { passive: true });
  }

  private removeEventListeners() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('scroll', this.updateHandler, { capture: true });
    window.removeEventListener('resize', this.updateHandler);
  }

  updatePosition() {
    if (!this.isOpen() || typeof window === 'undefined') return;

    const trigger = this.defaultTrigger.nativeElement;
    const popover = this.popover.nativeElement;

    const tRect = trigger.getBoundingClientRect();
    const pRect = popover.getBoundingClientRect();

    const gap = 6;
    const padding = 8;

    let top = 0;
    let left = tRect.left;

    if (this.positionY() === 'bottom') {
      top = tRect.bottom + gap;

      if (
        top + pRect.height > window.innerHeight &&
        tRect.top - pRect.height - gap > 0
      ) {
        top = tRect.top - pRect.height - gap;
      }
    } else {
      top = tRect.top - pRect.height - gap;

      if (top < 0 && tRect.bottom + pRect.height + gap < window.innerHeight) {
        top = tRect.bottom + gap;
      }
    }

    if (this.matchParentWidth()) {
      popover.style.width = `${tRect.width}px`;
    } else {
      popover.style.width = '';
    }

    if (left + pRect.width > window.innerWidth - padding) {
      left = window.innerWidth - pRect.width - padding;
    }

    if (left < padding) {
      left = padding;
    }

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  toggle() {
    if (this.disabled()) return;
    this.isOpen.update((v) => !v);
  }

  @HostListener('toggle', ['$event'])
  onNativeToggle(event: any) {
    if (this.disabled()) return;
    const isNativeOpen = event.newState === 'open';
    if (this.isOpen() !== isNativeOpen) {
      this.isOpen.set(isNativeOpen);
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.isOpen() || this.disabled()) return;

    const target = event.target as HTMLElement;
    const clickedInside = this.popover.nativeElement.contains(target);
    const clickedTrigger = this.defaultTrigger.nativeElement.contains(target);

    if (!clickedInside && !clickedTrigger) {
      this.isOpen.set(false);
    }
  }

  handleContentClick(event?: MouseEvent) {
    event?.stopPropagation();
    if (this.closeOnClick()) {
      queueMicrotask(() => this.isOpen.set(false));
    }
  }
}
