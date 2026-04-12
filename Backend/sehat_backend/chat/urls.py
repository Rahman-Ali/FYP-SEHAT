# backend/chat/urls.py
from django.urls import path
from . import views

urlpatterns = [
    
    path('health/', views.health_check, name='health_check'),
    
    
    
    
    path('sessions/create/', views.create_session, name='create_session'),
    
    path('sessions/list/', views.get_user_sessions, name='get_user_sessions'),
    
    path('sessions/detail/', views.get_session_detail, name='get_session_detail'),
    
    path('sessions/delete/', views.delete_session, name='delete_session'),
    
    path('sessions/update-title/', views.update_session_title, name='update_session_title'),
    
  
  
  
  
    path('messages/list/', views.get_session_messages, name='get_session_messages'),
    
    path('messages/delete/', views.delete_message, name='delete_message'),
    
    
    
   
    path('query/', views.process_query, name='process_query'),
]