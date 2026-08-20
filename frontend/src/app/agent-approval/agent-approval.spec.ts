import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentApproval } from './agent-approval';

describe('AgentApproval', () => {
  let component: AgentApproval;
  let fixture: ComponentFixture<AgentApproval>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentApproval]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AgentApproval);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
