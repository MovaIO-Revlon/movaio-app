import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Plugins } from './plugins';

describe('Plugins', () => {
  let component: Plugins;
  let fixture: ComponentFixture<Plugins>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Plugins]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Plugins);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
