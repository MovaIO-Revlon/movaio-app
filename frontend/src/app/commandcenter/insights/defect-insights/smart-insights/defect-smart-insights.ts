import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IDefectSolution,
  IDefectSmartInsightResponse,
  IDefectDetails,
  IDefect,
  IDefectRegressionScenario,
} from '../../../../types';
import { Drawer } from '../../../../components/drawer/drawer';
import { AnalyticsService } from '../../../../services/analytics.service';
import { FilterStore } from '../../../trends/filter.store';
import { SmartInsightCard } from '../../incident-insights/smart-insights/smart-insight-card';
import { DefectUseCases } from '../defect-use-cases';
import { PRIORITY_COLOR_MAPPING } from '../../../../utils';

@Component({
  selector: 'defect-smart-insights',
  imports: [FormsModule, SmartInsightCard, Drawer, DefectUseCases],
  templateUrl: './defect-smart-insights.html',
  styleUrl: '../../incident-insights/smart-insights/smart-insights.css',
})
export class DefectSmartInsights {
  close = output();
  open = input(false);
  label = input('Smart Insight');
  description = input('Get AI-powered insights and solution recommendations.');

  defectId = '';
  priorityColorMapping = PRIORITY_COLOR_MAPPING;

  solutions = signal<IDefectSolution[]>([]);
  similarDefects = signal<IDefect[]>([]);
  useCases = signal<IDefectRegressionScenario[]>([]);
  defectDetails = signal<
    | (Pick<
        IDefectSmartInsightResponse['ai_analysis'],
        'errors' | 'overview' | 'title'
      > & {
        details?: IDefectDetails;
      })
    | null
  >(null);

  isSmartInsightLoading = signal(false);
  apiError = signal('');

  constructor(
    private readonly service: AnalyticsService,
    private readonly filterStore: FilterStore,
  ) {}

  closeModal() {
    this.close.emit();
  }

  getSmartInsight() {
    const defectId = this.defectId.trim();
    const filters = this.filterStore.tempFilters();
    const index_name = this.filterStore
      .indexOptions()
      .find((item) => item.value === filters.index)?.label;

    if (
      !defectId ||
      !filters?.entity ||
      !filters.index ||
      !filters.agent ||
      !index_name
    )
      return;

    this.isSmartInsightLoading.set(true);
    this.apiError.set('');

    this.service
      .getSmartInsight({
        defect_id: defectId,
        entity: filters.entity,
        agent_id: filters.agent,
        index_id: filters.index,
        index_name,
        run_id: filters.entity,
        page_name: 'insights',
      })
      .subscribe({
        next: (data) => {
          if (!data) return;

          const { errors, overview, title, ...rest } = (data?.ai_analysis ||
            {}) as IDefectSmartInsightResponse['ai_analysis'];

          this.defectDetails.set({
            errors,
            overview,
            title,
            details: rest?.['Defect solution']?.defect_details,
          });

          this.solutions.set(rest?.['Defect solution']?.top_solutions || []);

          this.similarDefects.set(rest?.similar_defect || []);
          this.useCases.set(
            rest?.['potential regression scenarios']?.regression_scenarios ||
              [],
          );
        },
        error: (e) => {
          this.isSmartInsightLoading.set(false);
          this.apiError.set(
            e?.error?.error || e?.error?.message || 'Failed to get insights',
          );

          this.defectDetails.set(null);

          this.solutions.set([]);
          this.similarDefects.set([]);
          this.useCases.set([]);
        },
        complete: () => {
          this.isSmartInsightLoading.set(false);
        },
      });
  }

  getSeverity(value?: string) {
    if (!value || value.toLowerCase().includes('high')) return 'LOW';
    if (value.toLowerCase().includes('high')) return 'HIGH';
    if (value.toLowerCase().includes('medium')) return 'MEDIUM';
    return 'LOW';
  }
}
