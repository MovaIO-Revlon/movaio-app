import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConversationalChatbot } from './conversational-chatbot';

describe('ConversationalChatbot', () => {
  let component: ConversationalChatbot;
  let fixture: ComponentFixture<ConversationalChatbot>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationalChatbot]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ConversationalChatbot);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
