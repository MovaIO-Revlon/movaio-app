import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RolePrivilegeMapping } from './role-privilege-mapping';

describe('RolePrivilegeMapping', () => {
  let component: RolePrivilegeMapping;
  let fixture: ComponentFixture<RolePrivilegeMapping>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RolePrivilegeMapping]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RolePrivilegeMapping);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
