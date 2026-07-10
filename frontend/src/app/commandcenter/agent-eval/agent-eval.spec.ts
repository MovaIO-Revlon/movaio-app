import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentEval } from './agent-eval';

describe('AgentEval', () => {
  let component: AgentEval;
  let fixture: ComponentFixture<AgentEval>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentEval]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AgentEval);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
