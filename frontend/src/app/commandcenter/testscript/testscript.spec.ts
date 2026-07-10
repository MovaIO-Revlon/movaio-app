import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Testscript } from './testscript';

describe('Testscript', () => {
  let component: Testscript;
  let fixture: ComponentFixture<Testscript>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Testscript]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Testscript);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
