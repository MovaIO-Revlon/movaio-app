from config_loader import config_loader
from database_manager import select_database_by_user_type

# Example 1: Query with user type condition
def get_user_by_type(user_id, user_type):
    operation = {
        'type': 'find_one',
        'filter': {'user_id': user_id}
    }
    return config_loader.query_db(
        'user', 
        operation, 
        condition_func=select_database_by_user_type,
        user_type=user_type
    )

# Example 2: Query with load balancing
def get_all_agents(current_load):
    operation = {
        'type': 'find',
        'filter': {'status': 'active'}
    }
    return config_loader.query_db(
        'agent',
        operation,
        condition_func=select_database_by_user_type,
        current_load=current_load
    )


# Example 2: Query with load balancing
def get_all_agencies(user_type):
    operation = {
        'type': 'find',
        'filter': {"is_deleted": False}
    }
    return config_loader.query_db(
        'agency',
        operation,
        condition_func=select_database_by_user_type,
        user_type=user_type
    )
    

# Example 3: Insert with custom condition
def create_user(user_data, user_type):
    operation = {
        'type': 'insert_one',
        'document': user_data
    }
    return config_loader.query_db(
        'user',
        operation,
        condition_func=select_database_by_user_type,
        user_type=user_type
    )

# Example 4: Update with runtime condition
def update_agent_status(agent_id, status, system_load):
    operation = {
        'type': 'update_one',
        'filter': {'agent_id': agent_id},
        'update': {'$set': {'status': status}}
    }
    return config_loader.query_db(
        'agent',
        operation,
        condition_func=select_database_by_user_type,
        current_load=system_load
    )

# Example usage
# if __name__ == "__main__":
# Get premium user from secondary DB
print('Get premium user from secondary DB....')
# user = get_user_by_type("user123", "premium")
agencies = get_all_agencies("1premium")
print('Get agencies from primary DB (low load)....',agencies)
# Get agents from primary DB (low load)
# agents = get_all_agents(current_load=83)
# print('Create regular user in primary DB....',agents)
# Create regular user in primary DB
# new_user = create_user({"name": "John", "email": "john@example.com"}, "regular")

# Update agent in secondary DB (high load)
# update_result = update_agent_status("agent456", "inactive", 85)