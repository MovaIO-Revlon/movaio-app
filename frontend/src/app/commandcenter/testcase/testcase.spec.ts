import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Testcase } from './testcase';

describe('Testcase', () => {
  let component: Testcase;
  let fixture: ComponentFixture<Testcase>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Testcase]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Testcase);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
