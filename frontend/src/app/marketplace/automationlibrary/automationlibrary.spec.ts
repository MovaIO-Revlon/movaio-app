import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AutomationLibrary } from './automationlibrary';

describe('AutomationLibrary', () => {
  let component: AutomationLibrary;
  let fixture: ComponentFixture<AutomationLibrary>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutomationLibrary],
    }).compileComponents();

    fixture = TestBed.createComponent(AutomationLibrary);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
