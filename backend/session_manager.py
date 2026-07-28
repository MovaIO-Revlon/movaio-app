import uuid
from datetime import datetime
from functools import wraps
from flask import session, request
from config_loader import config_loader
from utils import AuthorizationError

class SessionManager:
    def __init__(self):
        self.config = config_loader
        self.sessions = {}  # In-memory storage (use Redis for production)
        self.session_timeout = 1200  # 2 hour in seconds
    
    def create_session(self, user_data):
        """Create new session for user"""
        session_id = str(uuid.uuid4())
        session_data = {
            'session_id': session_id,
            'user_id': user_data.get('Email'),
            'user_name': user_data.get('UserName'),
            'role': user_data.get('Role'),
            'team': user_data.get('Team'),
            'created_at': datetime.now(),
            'last_activity': datetime.now(),
            'is_active': True,
            'ActiveProject': user_data.get('ActiveProject'),
            "ProjectDtl":user_data.get('ProjectDtl')
        }
        
        self.sessions[session_id] = session_data
        session['session_id'] = session_id
        session['user_id'] = user_data.get('Email')
        
        return session_id
    
    def validate_session(self, session_id):
        """Validate if session exists and is active"""
        if not session_id or session_id not in self.sessions:
            return False
        
        session_data = self.sessions[session_id]
        
        # Check if session expired
        if self._is_session_expired(session_data):
            self.destroy_session(session_id)
            return False
        
        # Update last activity
        session_data['last_activity'] = datetime.now()
        return True
    
    def get_session_data(self, session_id):
        """Get session data"""
        if session_id in self.sessions:
            return self.sessions[session_id]
        return None
    
    def update_session(self, session_id, update_data):
        """Update session data"""
        if session_id in self.sessions:
            self.sessions[session_id].update(update_data)
            self.sessions[session_id]['last_activity'] = datetime.now()
            return True
        return False
    
    def replace_session(self, session_id, new_data):
        """Replace session data completely"""
        
        if session_id in self.sessions:
            # Keep essential session fields
            essential_fields = {
                'session_id': self.sessions[session_id]['session_id'],
                'created_at': self.sessions[session_id]['created_at'],
                'last_activity': datetime.now(),
                'is_active': True,
                'user_id': self.sessions[session_id]['user_id'],
                'user_name': self.sessions[session_id]['user_name'],
                'role': self.sessions[session_id]['role'],
                'team': self.sessions[session_id]['team'],
                'ActiveProject': new_data.get('ActiveProject'),
                "ProjectDtl":new_data.get('PrjDetails')
            }
            # Replace with new data but keep essential fields
            self.sessions[session_id] = {**essential_fields}
            return True
        return False
    
    def destroy_session(self, session_id):
        """Destroy session"""
        if session_id in self.sessions:
            del self.sessions[session_id]
        session.clear()
    
    def _is_session_expired(self, session_data):
        """Check if session is expired"""
        last_activity = session_data['last_activity']
        return (datetime.now() - last_activity).seconds > self.session_timeout

# Global session manager instance
session_manager = SessionManager()

def require_session(f):
    """Decorator to require valid session"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        session_id = session.get('session_id') or request.headers.get('X-Session-ID')
        
        if not session_id or not session_manager.validate_session(session_id):
            raise AuthorizationError("Invalid or expired session", {'redirect': '/login'})
        
        return f(*args, **kwargs)
    return decorated_function

def get_current_user():
    """Get current user from session"""
    session_id = session.get('session_id') or request.headers.get('X-Session-ID')
    if session_id:
        return session_manager.get_session_data(session_id)
    return None
