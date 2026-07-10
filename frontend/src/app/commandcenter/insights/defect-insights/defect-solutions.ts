import { Component, computed, effect, model, resource } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IDefectSolution } from '../../../types';
import { TooltipDirective } from '../../../custom-tooltip/tooltip.directive';
import { CardLoader } from '../../../components/shared/card-loader';
import { firstValueFrom } from 'rxjs';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
@Component({
  selector: 'defect-solutions',
  imports: [CommonModule, FormsModule, TooltipDirective, CardLoader],
  template: `
    <div class="title">
      <span>Top Solutions</span>
      <span
        class="info"
        appTooltip="The Top solutions highlight the most common actions taken by support teams to resolve defects."
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 17 17"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            opacity="0.6"
            d="M7.65 12.75H9.35V7.65H7.65V12.75ZM8.5 0C3.80375 0 0 3.80375 0 8.5C0 13.1962 3.80375 17 8.5 17C13.1962 17 17 13.1962 17 8.5C17 3.80375 13.1962 0 8.5 0ZM8.5 15.3C4.7515 15.3 1.7 12.2485 1.7 8.5C1.7 4.7515 4.7515 1.7 8.5 1.7C12.2485 1.7 15.3 4.7515 15.3 8.5C15.3 12.2485 12.2485 15.3 8.5 15.3ZM7.65 5.95H9.35V4.25H7.65V5.95Z"
            fill="#FFA242"
          />
        </svg>
      </span>
    </div>

    @if (solutionsQuery.isLoading() || hasNoData()) {
      <card-loader
        style="--top-spacing: 3rem"
        [loading]="solutionsQuery.isLoading()"
        [noData]="hasNoData()"
      />
    }

    <div class="wrapper overflow-auto" style="max-height: 380px">
      @for (solution of data(); track $index) {
        <details class="request-details">
          <summary class="title">
            {{ solution.solution }}
            <span class="count">{{ solution.source_defects.length || 0 }}</span>
            <i class="fa-solid fa-chevron-down"></i>
          </summary>
          <div class="dropdown">
            <p class="fs-12">
              <strong>Explanation</strong>: {{ solution.explanation }}
            </p>
            <p class="fs-12">
              <strong>Resolution time</strong>:
              {{ solution.resolution_time_days }} days
            </p>

            <p class="fs-12">
              <strong>Source Defects</strong>:
              @for (item of solution.source_defects; track $index) {
                <span class="text-muted">{{ item }}</span>
              }
            </p>
          </div>
        </details>
      }
    </div>
  `,
  styleUrl: '../insights.css',
})
export class DefectSolutions {
  data = model<IDefectSolution[]>([]);

  constructor(
    private readonly service: AnalyticsService,
    readonly filterStore: FilterStore,
  ) {
    effect(() => {
      const res = this.solutionsQuery.value();
      if (res?.data) {
        this.data.set(
          Array.isArray(
            res.data.agent_execution?.['Defect Solution']?.top_solutions,
          )
            ? res.data.agent_execution['Defect Solution'].top_solutions
            : [],
        );
      }
    });
  }

  hasNoData = computed(() => !this.data().length);

  solutionsQuery = resource({
    params: () => this.filterStore.queryFilters(),
    loader: ({ params, abortSignal }) =>
      firstValueFrom(this.service.fetchTopDefectSolutions(params, abortSignal)),
  });
}
