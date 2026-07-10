import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SmartInsightCard } from './smart-insight-card';
import { ImpactedApplications } from '../impacted-applications';
import {
  IAiInference,
  IApplication,
  ISimilarIncident,
  IIncidentSmartInsightResponse,
  ISolution,
  IUseCases,
} from '../../../../types';
import { AiInference } from '../ai-inferences';
import { UseCases } from '../use-cases';
import { Drawer } from '../../../../components/drawer/drawer';
import { AnalyticsService } from '../../../../services/analytics.service';
import { FilterStore } from '../../../trends/filter.store';
import { PRIORITY_COLOR_MAPPING } from '../../../../utils';

@Component({
  selector: 'smart-insights',
  imports: [
    FormsModule,
    SmartInsightCard,
    ImpactedApplications,
    AiInference,
    UseCases,
    Drawer,
  ],
  templateUrl: './smart-insights.html',
  styleUrl: './smart-insights.css',
})
export class SmartInsights {
  close = output();
  open = input(false);
  label = input('Smart Insight');
  description = input('Get AI-powered insights and solution recommendations.');

  incidentId = '';
  priorityColorMapping = PRIORITY_COLOR_MAPPING;
  solutions = signal<ISolution[]>([]);
  applications = signal<IApplication[]>([]);
  similarIncidents = signal<ISimilarIncident[]>([]);

  aiInferenceData: IAiInference[] = [];
  useCases = signal<IUseCases[]>([]);
  incidentDetails = signal<
    | (Pick<
        IIncidentSmartInsightResponse['ai_analysis'],
        'errors' | 'overview' | 'title'
      > & {
        details?: IIncidentSmartInsightResponse['ai_analysis']['top 5 solutions']['incident_details'];
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
    const incidentId = this.incidentId.trim();
    const filters = this.filterStore.tempFilters();
    const index_name = this.filterStore
      .indexOptions()
      .find((item) => item.value === filters.index)?.label;

    if (
      !incidentId ||
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
        incident_id: incidentId,
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
            {}) as IIncidentSmartInsightResponse['ai_analysis'];

          this.incidentDetails.set({
            errors,
            overview,
            title,
            details: rest?.['top 5 solutions']?.incident_details,
          });

          this.solutions.set(rest?.['top 5 solutions']?.top_solutions || []);
          this.applications.set(
            rest?.['Top 10 Applications Impacted']?.top_applications || [],
          );
          this.similarIncidents.set(rest?.similar_incident || []);
          this.useCases.set(
            rest?.['potential automation use cases']?.automation_use_cases ||
              [],
          );
        },
        error: (e) => {
          this.isSmartInsightLoading.set(false);
          this.apiError.set(
            e?.error?.error || e?.error?.message || 'Failed to get insights',
          );

          this.incidentDetails.set(null);

          this.solutions.set([]);
          this.applications.set([]);
          this.similarIncidents.set([]);
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
