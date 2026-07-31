import {
  Component,
  model,
  input,
  signal,
  computed,
  inject,
  ElementRef,
  NgZone,
  DestroyRef,
  afterNextRender,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'sidebar',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (mode() !== 'overlay') {
      <div
        select="[trigger]"
        class="trigger"
        (click)="onTriggerClick()"
        (mouseenter)="onHoverZoneEnter()"
        (mouseleave)="onHoverZoneLeave()"
      >
        <button type="button" class="btn btn-sm bg-white text-muted border-0">
          <i class="fa fa-solid fa-bars"></i>
        </button>
      </div>
    }

    @if (mode() === 'overlay') {
      <div class="backdrop" [class.open]="expanded()" (click)="close()"></div>
    }

    <aside
      class="content"
      [class.open]="expanded()"
      [class.overlay]="mode() === 'overlay'"
      (mouseenter)="onHoverZoneEnter()"
      (mouseleave)="onHoverZoneLeave()"
    >
      @if (mode() === 'overlay') {
        <div select="[trigger]" class="trigger" (click)="onTriggerClick()">
          <button type="button" class="btn btn-sm bg-white text-muted border-0">
            <i class="fa fa-solid fa-bars"></i>
          </button>
        </div>
      }

      <div class="inner-content">
        <ng-content />
      </div>

      @if (expanded()) {
        <div class="resize" (mousedown)="startResizing($event)"></div>
      }
    </aside>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-rows: auto 1fr;
      anchor-name: --sidebar-anchor;
      background: var(--bg);

      --bg: #fff;
      --collapsed-width: 2rem;
      --expanded-width: 12rem;
      --backdrop-color: rgba(0, 0, 0, 0.04);
      --transition-duration: 0.3s;
    }

    :host {
      width: var(--collapsed-width);
      transition: width var(--transition-duration) ease-in-out;
    }
    :host.resizing *,
    :host.resizing {
      transition: none;
    }
    :host:has(.content.open:not(.overlay)) {
      width: var(--expanded-width);
    }

    .resize {
      position: absolute;
      width: 0.3rem;
      background: #eaeaea;
      cursor: pointer;
      grid-row: 1 / -1;
      top: anchor(--sidebar-anchor bottom);
      right: 0;
      bottom: 0;
      height: calc(100dvh - var(--header-offset, 0));
      z-index: 1000;
    }

    .resize:hover {
      background: #3874ff;
      cursor: col-resize;
    }

    .content {
      display: flex;
      flex-direction: column;
      transition: width var(--transition-duration) ease-in-out;
      background: var(--bg);
      position: relative;
    }
    .inner-content {
      display: flex;
      flex-direction: column;
      flex: 1;
      width: 0;
      overflow: hidden;
      transition: width var(--transition-duration) ease-in-out;
      background: var(--bg);
    }
    .content.open .inner-content {
      width: var(--expanded-width);
    }

    .content.overlay {
      position: fixed;
      top: anchor(--sidebar-anchor bottom);
      left: anchor(--sidebar-anchor left);
      height: calc(100dvh - var(--header-offset, 0));
      z-index: 1000;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      background: var(--backdrop-color);
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--transition-duration) ease-in-out;
      z-index: 999;
    }
    .backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }
  `,
})
export class Sidebar {
  mode = input<'push' | 'overlay'>('push');
  trigger = input<'click' | 'hover'>('click');
  storageKey = input<string>('sidebar-width');
  isOpen = model<boolean>(false);

  private elementRef = inject(ElementRef<HTMLElement>);
  private zone = inject(NgZone);
  private destroyRef = inject(DestroyRef);

  private hoverOpen = signal(false);
  private hoverLeaveTimeout: ReturnType<typeof setTimeout> | null = null;

  private readonly MIN_WIDTH = 160;
  private readonly MAX_WIDTH = 480;

  private startX = 0;
  private startWidth = 0;

  expanded = computed(() => this.isOpen() || this.hoverOpen());

  constructor() {
    afterNextRender(() => {
      const saved = localStorage.getItem(this.storageKey());
      if (saved) {
        const width = this.clamp(parseInt(saved, 10));
        this.elementRef.nativeElement.style.setProperty(
          '--expanded-width',
          `${width}px`,
        );
      }
    });
  }

  startResizing(event: MouseEvent): void {
    event.preventDefault();
    this.startX = event.clientX;

    const host = this.elementRef.nativeElement;
    const innerContent = host.querySelector('.inner-content') as HTMLElement;
    this.startWidth = innerContent.getBoundingClientRect().width;

    host.classList.add('resizing');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    this.zone.runOutsideAngular(() => {
      const onMouseMove = (e: MouseEvent) => {
        const delta = e.clientX - this.startX;
        const width = this.clamp(this.startWidth + delta);
        host.style.setProperty('--expanded-width', `${width}px`);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        host.classList.remove('resizing');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';

        const finalWidth = innerContent.getBoundingClientRect().width;
        if (!isNaN(finalWidth) && finalWidth > 0) {
          localStorage.setItem(
            this.storageKey(),
            String(Math.round(finalWidth)),
          );
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      this.destroyRef.onDestroy(() => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      });
    });
  }

  private clamp(width: number): number {
    return Math.min(this.MAX_WIDTH, Math.max(this.MIN_WIDTH, width));
  }

  onTriggerClick() {
    this.isOpen.update((v) => !v);
  }

  onHoverZoneEnter() {
    if (this.trigger() !== 'hover') return;
    if (this.hoverLeaveTimeout) {
      clearTimeout(this.hoverLeaveTimeout);
      this.hoverLeaveTimeout = null;
    }
    this.hoverOpen.set(true);
  }

  onHoverZoneLeave() {
    if (this.trigger() !== 'hover') return;
    this.hoverLeaveTimeout = setTimeout(() => {
      this.hoverOpen.set(false);
    }, 100);
  }

  close() {
    this.isOpen.set(false);
    this.hoverOpen.set(false);
  }
}
