import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Promptrepository } from './promptrepository';

describe('Promptrepository', () => {
  let component: Promptrepository;
  let fixture: ComponentFixture<Promptrepository>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Promptrepository]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Promptrepository);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
