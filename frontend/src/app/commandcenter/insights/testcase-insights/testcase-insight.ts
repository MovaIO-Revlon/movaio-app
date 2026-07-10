import { Component, inject, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TestcaseHotspots } from './testcase-hotspots';
import { ITestcase } from '../../../types/testcase.entities';
import { TestcaseTableModal } from '../../../components/shared/testcase-table-modal/testcase-table-modal';
import { TestcaseImpacted } from './testcase-impacted';
import { TestcasePrioritization } from './testcase-prioritization';
import { TestcaseUseCases } from './testcase-use-cases';
import { TestCaseRegression } from './testcase-regression';
import { FilterStore } from '../../trends/filter.store';
import { INSIGHT_STATIC_USE_CASES_KEY } from '../../../marketplace/mcpconnectors/constants';
import { WidgetRenderer } from '../../../components/widgets/widget-renderer';
import { TableWidgetConfig } from '../../../types';
import {
  IHeading,
  EntityTable,
} from '../../../components/shared/entity-table/entity-table';
import { TestcaseDeduplication } from './testcase-deduplication';
import { TestcaseQuality } from './testcase-quality';

@Component({
  selector: 'testcase-insights',
  imports: [
    CommonModule,
    FormsModule,
    TestcaseHotspots,
    TestcaseTableModal,
    TestcaseImpacted,
    TestcasePrioritization,
    TestcaseUseCases,
    TestCaseRegression,
    WidgetRenderer,
    EntityTable,
    TestcaseDeduplication,
    TestcaseQuality,
  ],
  template: `
    @let activeUseCases = filterStore.activeUseCases();
    @let visualization = filterStore.visualization();

    @for (item of activeUseCases; track item) {
      @switch (item) {
        @case (useCases.TESTCASE_HOTSPOTS) {
          <testcase-hotspots
            (selectHotspot)="
              selectTetsCase([
                {
                  title: $event.hotspot_area,
                  data: $event.matching_test_cases || [],
                },
              ])
            "
          />
        }
        @case (useCases.TESTCASE_IMPACTED) {
          <testcase-impacted />
        }
        @case (useCases.TESTCASE_PRIORITIZATION) {
          <testcase-prioritization />
        }
        @case (useCases.POTENTIAL_AUTOMATION) {
          <testcase-use-cases />
        }
        @case (useCases.POTENTIAL_REGRESSION_TESTSUITE) {
          <testcase-regression style="grid-column: 1 / -1;" />
        }
        <!-- @case (useCases.TEST_COVERAGE_METRICS) {
          <testcase-coverage />
        } -->
        @case (useCases.TEST_SUITE_OPTIMIZATION_DEDUPLICATION) {
          <testcase-deduplication />
        }
        @case (useCases.TESTCASE_QUALITY) {
          <testcase-quality />
        }
        @default {
          @if (visualization[item]) {
            <widget-renderer
              [case]="item"
              [config]="visualization[item]"
              (select)="selectDynamicData($event)"
            />
          }
        }
      }
    }

    <testcase-table-modal
      [data]="selectedTestCaseData() || []"
      [open]="!!selectedTestCaseData()"
      (close)="selectTetsCase(null)"
    />

    @let dynamicWidgetData = dynamicData();
    <entity-table
      [open]="!!dynamicWidgetData.headings.length"
      [data]="dynamicWidgetData.data"
      [headings]="dynamicWidgetData.headings"
      (close)="dynamicData.set({ headings: [], data: [] })"
      [withCloseButton]="true"
    />
  `,
  styleUrl: '../insights.css',
})
export class TestCaseInsights {
  filterStore = inject(FilterStore);
  useCases = INSIGHT_STATIC_USE_CASES_KEY.testcase;
  isSmartInsightOpen = model(false);

  selectedTestCaseData = signal<{ title: string; data: ITestcase[] }[] | null>(
    null,
  );

  dynamicData = signal<{ headings: IHeading[]; data: unknown[] }>({
    headings: [],
    data: [],
  });

  selectTetsCase(data: { title: string; data: ITestcase[] }[] | null): void {
    this.selectedTestCaseData.set(data);
  }

  selectDynamicData({
    data,
    headers,
  }: {
    data: unknown[];
    headers: TableWidgetConfig['headers'];
    title: string;
  }) {
    this.dynamicData.set({
      data,
      headings: headers.map((item) => ({
        label: item.label,
        key: item.value,
        stringTemplate: true,
      })),
    });
  }
}
