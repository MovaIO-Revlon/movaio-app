import secrets
import requests
from langgraph.graph import StateGraph
from pydantic import BaseModel,ValidationError
from flask import Flask, json, request, jsonify
from flask_cors import CORS
import re
from pymongo import MongoClient
from datetime import datetime, timezone
import uuid
import os
import pandas as pd
from config_loader import ConfigLoader
from commonutils import DatabaseCollections, CommonUtils


class UserStory(BaseModel):
    description: str


class UserStoryReader:
    def __init__(self):
        super().__init__()
        self.config_loader = ConfigLoader()
    
    def read_from_file(self, filename: str) -> str:
        print("log")
       
        file_path = os.path.join(self.config_loader.USER_STORY_FOLDER, filename)
        print("log1")
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"User story file '{filename}' not found.")
        
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()


class Agent1:
    def __init__(self, event_id: str, agent_id: str, filename: str):
        self.event_id = event_id
        self.agent_id = agent_id
        self.filename = filename
        self.reader = UserStoryReader()
    
    def execute(self, state: dict) -> dict:
        print("entered")
        user_story = self.reader.read_from_file(self.filename)
        return {"user_story": user_story}


class Agent2(DatabaseCollections):
    def __init__(self, agent_data: dict, event_id: str, agent_id: str):
        super().__init__()
        self.agent_data = agent_data
        self.event_id = event_id
        self.agent_id = agent_id
        self.utils = CommonUtils()
        self.config_loader = ConfigLoader()
    
    def execute(self, state: dict) -> dict:
        user_story = state.get("user_story")
        print(f"User story received: {user_story}")
        print("Agent data:", self.agent_data)
        event_desc = user_story.strip().splitlines()[0] if user_story.strip() else ""
        print("res")
        
        message = f"""Extract the following content into a JSON key-value structure without changing the structure or wording of any part of the content.

        The top-level keys should include:
        - test_case_title
        - user_story
        - acceptance_criteria (as a list)
        - test_cases (as a list of objects)
        - summary

        Inside each item in test_cases, include:
        - test_case_name
        - objective
        - preconditions (as a list)
        - test_steps (as a list)
        - expected_results (as a list, one for each test step)
        - accuracy percentage - it should be a number between 90 and 99, representing the accuracy of the test case.

        Do not include markdown, code blocks, or explanations — only return a pure JSON object.
  {user_story}"""
        
        # lyzr_api_url, lyzr_api_key, lyzr_user_id, lyzr_agent_id, lyzr_session_id = self.config_loader.get_lyzr_internal_agent_details()
        api_url = self.agent_data.get('agent_api_url')
        api_key = self.agent_data.get('agent_api_key')
        
        # Validate that api_url and api_key are provided
        if not api_url:
            raise ValueError("agent_api_url is not configured for this agent")
        if not api_key:
            raise ValueError("agent_api_key is not configured for this agent")
        
        print("data")
        
        payload = {
            "user_id": self.agent_data.get('user_id'),
            "agent_id": self.agent_data.get('api_agent_id'),
            "session_id": self.agent_data.get('agent_session_id'),
            "message": message,
        }
        print("data1")
        
        headers = {
            "x-api-key": api_key,
            "Content-Type": "application/json",
        }
        print("data3")
        try:
            print("resp3")
            response = requests.post(api_url, json=payload, headers=headers)
            print("Response",response)
            response.raise_for_status()
            print("Response1")
            result = response.json()
            print("Response2")
            response_text = result.get("response")
            print("Response from APIIII:", response_text)
            print("[INFO] API call succeeded.")
        except Exception as e:
            self.utils.log_error(f"API call failed: {e}")
            response_text = f"[FAILED] API error: {e}"
        
        # self.agent_tracking_collection.insert_one({
        #     "id": self.utils.generate_uuid(),
        #     "agent_id": self.agent_id,
        #     "event_id": self.event_id,
        #     "agent_status": "completed",
        #     "created_ts": self.utils.get_current_timestamp()
        # })
        
        return {"response": response_text, "desc": event_desc}


class TestWorkflowManager(DatabaseCollections):
    def __init__(self):
        super().__init__()
        self.utils = CommonUtils()
        self.workflow = None
    
    def run_test_workflow(self, event_id: str, filename: str, agent_data: dict, agent_id: str) -> dict:
        self.workflow = StateGraph(state_schema=dict)
        
        agent1 = Agent1(event_id, agent_id, filename)
        agent2 = Agent2(agent_data, event_id, agent_id)
        
        self.workflow.add_node("reader", agent1.execute)
        self.workflow.add_node("generater_agent", agent2.execute)
        
        self.workflow.set_entry_point("reader")
        self.workflow.add_edge("reader", "generater_agent")
        self.workflow.set_finish_point("generater_agent")
        
        compiled = self.workflow.compile()
        return compiled.invoke({})


def run_test_workflow(event_id: str, filename: str, agent_data: dict, agent_id: str) -> dict:
    workflow_manager = TestWorkflowManager()
    return workflow_manager.run_test_workflow(event_id, filename, agent_data, agent_id)