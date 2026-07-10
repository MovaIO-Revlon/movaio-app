import {
  Component,
  ElementRef,
  HostListener,
  model,
  ViewChild,
  effect,
  input,
  AfterViewInit,
} from '@angular/core';

@Component({
  selector: 'popover',
  standalone: true,
  templateUrl: './popover.html',
  styleUrl: './popover.css',
})
export class Popover implements AfterViewInit {
  @ViewChild('defaultTrigger') defaultTrigger!: ElementRef<HTMLElement>;
  @ViewChild('popover') popover!: ElementRef<HTMLElement>;

  isOpen = model(false);
  disabled = input(false);
  anchorName = input<string>(`--popover-${crypto.randomUUID()}`);
  closeOnClick = input<boolean>(false);

  constructor() {
    effect(() => {
      const isOpen = this.isOpen();
      const disabled = this.disabled();

      if (disabled) return;

      this.render(isOpen);
    });
  }

  ngAfterViewInit(): void {
    const isOpen = this.isOpen();
    this.render(isOpen);
  }

  render(isOpen: boolean) {
    const element = this.popover?.nativeElement;
    if (!element) return;

    if (isOpen) {
      if (!element.matches(':popover-open')) element.showPopover();
    } else {
      if (element.matches(':popover-open')) element.hidePopover();
    }
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
