from rest_framework import serializers
from .models import ChatSession, Message

class MessageSerializer(serializers.ModelSerializer):
    is_bot = serializers.SerializerMethodField()
    possible_condition = serializers.SerializerMethodField()
    triage_level = serializers.SerializerMethodField()
    response_type = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            'id',
            'sender',
            'message_text',
            'timestamp',
            'sequence_number',
            'metadata',         
            'is_bot',           
            'possible_condition', 
            'triage_level',
            'response_type'
        ]
        read_only_fields = ['id', 'timestamp', 'sequence_number']

    
    def get_is_bot(self, obj):
        return obj.sender == 'bot'

    
    def get_possible_condition(self, obj):
        if obj.metadata and isinstance(obj.metadata, dict):
            return obj.metadata.get('possible_condition', None)
        return None

    def get_triage_level(self, obj):
        if obj.metadata and isinstance(obj.metadata, dict):
            return obj.metadata.get('triage_level', None)  # None = not a clinical response
        return None

    def get_response_type(self, obj):
        if obj.metadata and isinstance(obj.metadata, dict):
            return obj.metadata.get('response_type', None)  # None = older message
        return None


class ChatSessionSerializer(serializers.ModelSerializer):

    message_count = serializers.SerializerMethodField()
    
    class Meta:
        model = ChatSession
        fields = [
            'id',
            'firebase_uid',
            'title',
            'created_at',
            'updated_at',
            'message_count'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_message_count(self, obj):
        # Use the count annotated by the view when present (avoids one query per session)
        annotated = getattr(obj, 'message_count_value', None)
        if annotated is not None:
            return annotated
        return obj.messages.count()


class ChatSessionDetailSerializer(serializers.ModelSerializer):
    
    messages = MessageSerializer(many=True, read_only=True)
    
    class Meta:
        model = ChatSession
        fields = [
            'id',
            'firebase_uid',
            'title',
            'created_at',
            'updated_at',
            'messages'
        ]