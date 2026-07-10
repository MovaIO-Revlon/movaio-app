import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Agentmanagement } from './agentmanagement';

describe('Agentmanagement', () => {
  let component: Agentmanagement;
  let fixture: ComponentFixture<Agentmanagement>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Agentmanagement]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Agentmanagement);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
