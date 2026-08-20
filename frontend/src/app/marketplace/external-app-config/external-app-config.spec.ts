import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ExternalAppConfig } from './external-app-config';

describe('ExternalAppConfig', () => {
  let component: ExternalAppConfig;
  let fixture: ComponentFixture<ExternalAppConfig>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExternalAppConfig]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ExternalAppConfig);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
