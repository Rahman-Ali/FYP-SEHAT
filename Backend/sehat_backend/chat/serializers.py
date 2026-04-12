from rest_framework import serializers
from .models import ChatSession, Message

class MessageSerializer(serializers.ModelSerializer):
    is_bot = serializers.SerializerMethodField()
    possible_condition = serializers.SerializerMethodField()
    triage_level = serializers.SerializerMethodField()

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
            'triage_level'       
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
            return obj.metadata.get('triage_level', 'Info')
        return 'Info'


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