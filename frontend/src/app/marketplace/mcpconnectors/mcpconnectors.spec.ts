import { ComponentFixture, TestBed } from '@angular/core/testing';

import { McpConnectors } from './mcpconnectors';

describe('Mcpconnectors', () => {
  let component: McpConnectors;
  let fixture: ComponentFixture<McpConnectors>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [McpConnectors],
    }).compileComponents();

    fixture = TestBed.createComponent(McpConnectors);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
