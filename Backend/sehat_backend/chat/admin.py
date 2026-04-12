from django.contrib import admin
from .models import ChatSession, Message


class MessageInline(admin.TabularInline):
    model = Message
    extra = 0
    fields = ['sender', 'message_text', 'timestamp', 'sequence_number']
    readonly_fields = ['timestamp', 'sequence_number']


@admin.register(ChatSession)
class ChatSessionAdmin(admin.ModelAdmin):
    list_display = ['id', 'firebase_uid', 'title', 'created_at', 'message_count']
    list_filter = ['created_at']
    search_fields = ['firebase_uid', 'title']
    inlines = [MessageInline]
    
    def message_count(self, obj):
        return obj.messages.count()
    message_count.short_description = 'Messages'


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ['id', 'session', 'sender', 'short_text', 'timestamp', 'sequence_number']
    list_filter = ['sender', 'timestamp']
    search_fields = ['message_text']
    
    def short_text(self, obj):
        return obj.message_text[:50] + '...' if len(obj.message_text) > 50 else obj.message_text
    short_text.short_description = 'Message'