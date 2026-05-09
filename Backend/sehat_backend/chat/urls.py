from django.urls import path
from . import views

urlpatterns = [
    # Public
    path('health/', views.health_check, name='health_check'),
    
    # Session Management
    path('sessions/create/', views.create_session, name='create_session'),
    path('sessions/list/', views.get_user_sessions, name='get_user_sessions'),
    path('sessions/detail/', views.get_session_detail, name='get_session_detail'),
    path('sessions/delete/', views.delete_session, name='delete_session'),
    path('sessions/update-title/', views.update_session_title, name='update_session_title'),
    
    # Messages
    path('messages/list/', views.get_session_messages, name='get_session_messages'),
    path('messages/delete/', views.delete_message, name='delete_message'),
    
    # Query Processing
    path('query/', views.process_query, name='process_query'),
    
    # Admin Panel
    path('admin/documents/list/', views.admin_list_documents, name='admin_list_documents'),
    path('admin/documents/add/', views.admin_add_document, name='admin_add_document'),
    path('admin/documents/remove/', views.admin_remove_document, name='admin_remove_document'),
]