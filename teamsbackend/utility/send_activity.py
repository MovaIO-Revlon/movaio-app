from microsoft_teams.api import AdaptiveCardActionCardResponse, AdaptiveCardActionMessageResponse, AdaptiveCardInvokeAction, AdaptiveCardInvokeActivity, AdaptiveCardInvokeResponse, MessageActivity, TypingActivityInput, MessageActivityInput , Attachment , SuggestedActions , CardAction
from microsoft_teams.apps import ActivityContext, App
from utility.database_manager import mydb

async def send_message_activity(ctx: ActivityContext[MessageActivity], text="" , attachments=None ,suggested_actions=None) -> None:
    """
    Send a message activity with optional text, attachments, and suggested actions.
    args:
        ctx (ActivityContext[MessageActivity]): The activity context.
        text (str): The text message to send.
        attachments (list, optional): List of attachments to include in the message.
        suggested_actions (SuggestedActions, optional): Suggested actions to include in the message.
    """
    # configurations=mydb["Configurations"].find_one({})
    # suggested_cards = configurations.get("suggestions", [])
    # show_suggestions = configurations.get("show_suggestions_everywhere", False)
    # suggested_actions_for_selected_agent=[]
    # if show_suggestions and suggested_cards:
                                                    
        # suggested_actions_for_selected_agent = SuggestedActions(
            # to=[ctx.activity.from_.id],
            # actions=[CardAction(
                # type="imBack",
                # title=suggested_card.get("title", ""),
                # value=suggested_card.get("value", "")
            # ) for suggested_card in suggested_cards]
        # )
    response = await ctx.send(MessageActivityInput(text=text, attachments=attachments ))
    
    return response
