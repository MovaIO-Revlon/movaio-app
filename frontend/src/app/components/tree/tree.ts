import { Component, input, output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface TreeNode {
  id: string;
  label: string;
  icon?: string;
  children?: TreeNode[];
  tooltip?: string;
}

interface FlatRow {
  node: TreeNode;
  depth: number;
  hasChildren: boolean;
}

@Component({
  selector: 'app-tree',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ul class="tn-list" [style]="'--max-rows:' + (showMax() + 1)">
      @for (row of visibleRows(); track row.node.id) {
        <li
          class="tn-row"
          [class.tn-row-active]="row.node.id === activeId()"
          [style.paddingLeft.px]="row.depth * 16"
          (click)="onRowClick(row)"
          [title]="row.node.tooltip ?? row.node.label"
        >
          <i
            class="tn-caret fa fa-solid fa-chevron-right"
            [class.tn-caret-open]="isExpanded(row.node.id)"
            [class.tn-caret-spacer]="!row.hasChildren"
          >
          </i>
          @if (row.node.icon) {
            <span class="tn-icon" [innerHTML]="row.node.icon"></span>
          }
          <span class="tn-label">{{ row.node.label }}</span>
        </li>
      }

      @if (showMax() < flatRows().length) {
        <li
          class="tn-row position-sticky bg-white"
          style="bottom: -1px"
          (click)="toggleShowMore()"
        >
          <i class="tn-caret fa fa-solid" [class.tn-caret-open]="false"> </i>
          <span class="tn-icon"><i class="fa fa-solid fa-ellipsis-h"></i></span>

          <span class="tn-label">Show {{ showMore() ? 'less' : 'more' }}</span>
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      --text-color: #1f2937;
      --active-bg: #fca24721;
      --active-text-color: #fca247;
      --hover-bg: #fca24721;
      --caret-color: #9ca3af;
      --icon-size: 16px;
      --row-height: 36px;
      --row-radius: 6px;
      --font-size: 14px;
      --gap: 8px;
      --transition-duration: 150ms;
      display: block;
      font-size: var(--font-size);
      color: var(--text-color);
    }
    .tn-list {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: calc(var(--row-height) * var(--max-rows) + 1rem);
      overflow: auto;
    }
    .tn-row {
      display: flex;
      align-items: center;
      gap: var(--gap);
      height: var(--row-height);
      border-radius: var(--row-radius);
      cursor: pointer;
      user-select: none;
      transition: background var(--transition-duration) ease;
    }
    .tn-row:hover {
      background: var(--hover-bg);
    }
    .tn-row-active {
      background: var(--active-bg);
      color: var(--active-text-color);
      font-weight: 500;
    }
    .tn-caret {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      color: var(--caret-color);
      font-size: 10px;
      transition: transform var(--transition-duration) ease;
    }
    .tn-caret-open {
      transform: rotate(90deg);
    }
    .tn-caret-spacer {
      visibility: hidden;
    }
    .tn-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--icon-size);
      height: var(--icon-size);
      flex-shrink: 0;
      font-size: var(--icon-size);
      line-height: 1;
    }
    .tn-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class TreeComponent {
  nodes = input.required<TreeNode[]>();
  activeId = input<string | null>(null);
  showMax = input<number>(5);

  nodeClick = output<TreeNode>();

  private expandedIds = signal<Set<string>>(new Set());
  showMore = signal<boolean>(false);

  flatRows = computed<FlatRow[]>(() => {
    const result: FlatRow[] = [];
    const walk = (list: TreeNode[], depth: number) => {
      for (const node of list) {
        const hasChildren = !!node.children?.length;
        result.push({ node, depth, hasChildren });
        if (hasChildren && this.expandedIds().has(node.id)) {
          walk(node.children!, depth + 1);
        }
      }
    };
    walk(this.nodes(), 0);
    return result;
  });

  visibleRows = computed(() =>
    this.showMore()
      ? this.flatRows()
      : this.flatRows().slice(0, this.showMax()),
  );

  isExpanded(id: string): boolean {
    return this.expandedIds().has(id);
  }

  onRowClick(row: FlatRow): void {
    if (row.hasChildren) {
      this.expandedIds.update((ids) => {
        const next = new Set(ids);
        next.has(row.node.id)
          ? next.delete(row.node.id)
          : next.add(row.node.id);
        return next;
      });
    }
    this.nodeClick.emit(row.node);
  }

  toggleShowMore() {
    this.showMore.update((v) => !v);
  }
}
