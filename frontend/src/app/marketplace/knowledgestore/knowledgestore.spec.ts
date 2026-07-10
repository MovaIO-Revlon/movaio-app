import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Knowledgestore } from './knowledgestore';

describe('Knowledgestore', () => {
  let component: Knowledgestore;
  let fixture: ComponentFixture<Knowledgestore>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Knowledgestore]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Knowledgestore);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
