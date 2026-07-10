import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UnauthorizedPopup } from './unauthorized-popup';

describe('UnauthorizedPopup', () => {
  let component: UnauthorizedPopup;
  let fixture: ComponentFixture<UnauthorizedPopup>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnauthorizedPopup]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UnauthorizedPopup);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
