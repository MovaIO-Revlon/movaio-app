import { TestBed } from '@angular/core/testing';

import { AgentEvalService } from './agent-eval.service';

describe('AgentEvalService', () => {
  let service: AgentEvalService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AgentEvalService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
