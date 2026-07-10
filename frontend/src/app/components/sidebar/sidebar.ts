import { Component, model, input, signal, computed } from '@angular/core';
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
    :host:has(.content.open:not(.overlay)) {
      width: var(--expanded-width);
    }

    .content {
      display: flex;
      flex-direction: column;
      transition: width var(--transition-duration) ease-in-out;
      background: var(--bg);
    }
    .inner-content {
      display: flex;
      flex-direction: column;
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
      height: 100vh;
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
  isOpen = model<boolean>(false);

  private hoverOpen = signal(false);
  private hoverLeaveTimeout: ReturnType<typeof setTimeout> | null = null;

  expanded = computed(() => this.isOpen() || this.hoverOpen());

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
