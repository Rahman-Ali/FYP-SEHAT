import uuid
from django.db import models
from django.utils import timezone


class ChatSession(models.Model):
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    firebase_uid = models.CharField(max_length=255, db_index=True)
    title = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'chat_sessions'
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['firebase_uid']),
            models.Index(fields=['-updated_at']),
        ]
    
    def __str__(self):
        return f"{self.firebase_uid} - {self.title or 'Untitled'}"


class Message(models.Model):
    SENDER_CHOICES = [
        ('user', 'User'),
        ('bot', 'Bot'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(
        ChatSession, 
        on_delete=models.CASCADE, 
        related_name='messages'
    )
    sender = models.CharField(max_length=10, choices=SENDER_CHOICES)
    message_text = models.TextField()
    metadata = models.JSONField(default=dict, blank=True, null=True)
    timestamp = models.DateTimeField(default=timezone.now)
    sequence_number = models.IntegerField(default=1)
    
    class Meta:
        db_table = 'messages'
        ordering = ['sequence_number']
        indexes = [
            models.Index(fields=['session', 'sequence_number']),
        ]
    
    def save(self, *args, **kwargs):
       
        if self._state.adding:  
            last_message = Message.objects.filter(
                session=self.session
            ).order_by('-sequence_number').first()
            
            if last_message:
                self.sequence_number = last_message.sequence_number + 1
            else:
                self.sequence_number = 1
        
        super().save(*args, **kwargs)
        
        
        self.session.updated_at = timezone.now()
        self.session.save(update_fields=['updated_at'])
    
    def __str__(self):
        return f"{self.sender}: {self.message_text[:50]}..."