
    # def process_request(self, data):
        # user_query = data.get('userQuery', "")
        # agent_id = data.get('agent_id', "")
        # master_agent_id = data.get('master_agent_id', "")
        # user_id= data.get('user_id', '')
        
        # event_id = self.utils.generate_uuid()
        # session_id = self.utils.generate_uuid()
        
        # new_event = {
            # "event_id": event_id,
            # "user_query": user_query,
            # "prompt_output": "",
            # "agent_id": agent_id,
            # "status": "inprogress",
            # "session_id":session_id,
            # "feedback_rating": data.get("feedback_rating"),
            # "feedback_comments": data.get("feedback_comments", ""),
            # "created_ts": self.utils.get_current_timestamp(),
            # "updated_ts": self.utils.get_current_timestamp(),
            # "user_id": user_id,
            # "master_agent_id": master_agent_id
        # }
        # ##self.chatbot_tracking_collection.insert_one(new_event)
        # insert_event_op = {'type': 'insert_one', 'document': new_event}
        # self._query_db('chatbot_tracking', insert_event_op)
        
        # if not agent_id:
            # return self.static_chatbot_agent(user_query, event_id,session_id, user_id)
        
        # agent_data = self.agent_collection.find_one({"agent_id": agent_id})
        # if not agent_data:
            # return jsonify({"error": "Agent not found"}), 400
        
        # api_key = agent_data.get('agent_api_key', '')
        # if not api_key:
            # return jsonify({"error": "Missing API key for agent"}), 400
        
        # return self.call_agent_api(agent_data, user_query, event_id, api_key,session_id,user_id)
    
    # def call_agent_api(self, agent_data, user_query, event_id, api_key,session_id,user_id):
        # message = f"""Give response for this user query with atleast three headings ended with ":".{user_query}"""
        # message = f"""Give response for this user query with atleast three headings ended with ":".{user_query}"""
        
        # agent_api_url = agent_data.get('agent_api_url', config_loader.LYZR_AGENT_URL + '/v3/inference/chat/')
        # if 'agents' in agent_api_url:
            # agent_api_url = agent_api_url.replace('agents', 'inference/chat')
        
        # payload = {
            # "user_id": user_id,
            # "agent_id": agent_data.get('api_agent_id', agent_data.get('agent_id')),
            # "session_id": session_id,
            # "message": message
        # }
        
        # headers = {"x-api-key": api_key, "Content-Type": "application/json"}
        # chat_response = requests.post(agent_api_url, json=payload, headers=headers)
        
        # self.utils.update_document(
            # self.chatbot_tracking_collection,
            # {"event_id": event_id},
            # {
                # "prompt_output": chat_response.json() if chat_response.headers.get('Content-Type') == 'application/json' else chat_response.text,
                # "status": "completed",
                # "session_id":session_id
            # }
        # )
        # update_op = {
                # 'type': 'update_one',
                # 'filter': {'event_id': event_id},
                # 'update': {
                    # "$set": {
                        # "prompt_output": chat_response.json()
                        # if chat_response.headers.get('Content-Type') == 'application/json'
                        # else chat_response.text,
                        # "status": "completed",
                        # "session_id":session_id
                        
                    # }
                # }
            # }
        # self._query_db('chatbot_tracking', update_op)
        
        # return self.get_trace_details(agent_data, api_key, chat_response)