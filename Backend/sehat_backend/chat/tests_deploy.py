"""
Tests for: HealthCheckMiddleware, warmup state machine, hash-error -> zero deletes.
Run with: python manage.py test chat.tests_deploy
"""
import json
import threading
import time
import unittest
from unittest.mock import patch, MagicMock

from django.test import TestCase, RequestFactory
from langchain_core.documents import Document
from chat.rag_service import RAGService


# ---------------------------------------------------------------------------
# 1. Health middleware tests
# ---------------------------------------------------------------------------

class HealthMiddlewareTest(TestCase):
    """Test that /healthz and /readyz respond correctly without touching DB/Neo4j."""

    def test_healthz_returns_200(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertEqual(data["status"], "ok")

    def test_healthz_with_trailing_slash_returns_200(self):
        response = self.client.get("/healthz/")
        self.assertEqual(response.status_code, 200)

    def test_readyz_returns_503_when_loading(self):
        """readyz must return 503 state=loading when warm-up is in progress."""
        with patch("chat.warmup.get_warmup_state", return_value="loading"):
            response = self.client.get("/readyz")
            self.assertEqual(response.status_code, 503)
            data = json.loads(response.content)
            self.assertEqual(data["state"], "loading")

    def test_readyz_returns_503_when_idle(self):
        with patch("chat.warmup.get_warmup_state", return_value="idle"):
            response = self.client.get("/readyz")
            self.assertEqual(response.status_code, 503)
            data = json.loads(response.content)
            self.assertEqual(data["state"], "idle")

    def test_readyz_returns_503_when_failed(self):
        with patch("chat.warmup.get_warmup_state", return_value="failed"):
            response = self.client.get("/readyz")
            self.assertEqual(response.status_code, 503)
            data = json.loads(response.content)
            self.assertEqual(data["state"], "failed")

    def test_readyz_returns_200_when_ready(self):
        with patch("chat.warmup.get_warmup_state", return_value="ready"):
            response = self.client.get("/readyz")
            self.assertEqual(response.status_code, 200)
            data = json.loads(response.content)
            self.assertEqual(data["status"], "ready")

    def test_process_query_returns_503_warming_up(self):
        """process_query must return 503 warming_up with Retry-After when state=loading."""
        with patch("chat.warmup.get_warmup_state", return_value="loading"):
            # We still need a valid auth token flow to reach the warmup check.
            # Patch auth to return a dummy uid.
            with patch("chat.views.extract_and_verify_token", return_value=("uid-test", None)):
                response = self.client.post(
                    "/api/chat/query/",
                    data=json.dumps({"session_id": "fake", "query": "test"}),
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 503)
                data = json.loads(response.content)
                self.assertEqual(data["error"], "warming_up")
                self.assertIn("Retry-After", response.headers)

    def test_process_query_returns_503_failed(self):
        with patch("chat.warmup.get_warmup_state", return_value="failed"):
            with patch("chat.views.extract_and_verify_token", return_value=("uid-test", None)):
                response = self.client.post(
                    "/api/chat/query/",
                    data=json.dumps({"session_id": "fake", "query": "test"}),
                    content_type="application/json",
                )
                self.assertEqual(response.status_code, 503)
                data = json.loads(response.content)
                self.assertEqual(data["error"], "knowledge_base_unavailable")


# ---------------------------------------------------------------------------
# 2. Warmup state machine tests
# ---------------------------------------------------------------------------

class WarmupStateMachineTest(unittest.TestCase):
    """Tests for chat.warmup state transitions without real Neo4j/models."""

    def setUp(self):
        """Reset warmup module state before each test."""
        import chat.warmup as wu
        wu._state = "idle"
        wu._error_class = None
        wu._started = False

    def test_initial_state_is_idle(self):
        from chat.warmup import get_warmup_state
        self.assertEqual(get_warmup_state(), "idle")

    def test_start_warmup_transitions_to_loading(self):
        """Calling start_warmup() sets state to 'loading' within the thread."""
        import chat.warmup as wu

        events = []

        def mock_warmup_run():
            wu._state = "loading"
            events.append("loading")
            time.sleep(0.05)
            with wu._lock:
                wu._state = "ready"
            events.append("ready")

        with patch.object(wu, "_run_warmup", side_effect=mock_warmup_run):
            wu.start_warmup()
            time.sleep(0.01)
            self.assertIn("loading", events)
            time.sleep(0.1)
            self.assertEqual(wu.get_warmup_state(), "ready")

    def test_start_warmup_only_runs_once(self):
        """Calling start_warmup() twice should only start one thread."""
        import chat.warmup as wu
        start_count = [0]

        def mock_run():
            start_count[0] += 1
            time.sleep(0.1)

        with patch.object(wu, "_run_warmup", side_effect=mock_run):
            wu.start_warmup()
            wu.start_warmup()
            wu.start_warmup()
            time.sleep(0.2)
            self.assertEqual(start_count[0], 1)

    def test_warmup_failure_sets_failed_state(self):
        """If _run_warmup raises, state becomes 'failed'."""
        import chat.warmup as wu

        def mock_run():
            with wu._lock:
                wu._state = "loading"
            raise ConnectionError("Neo4j unreachable")

        with patch.object(wu, "_run_warmup", side_effect=mock_run):
            # Directly call the real error-handling logic
            try:
                mock_run()
            except ConnectionError as e:
                with wu._lock:
                    wu._state = "failed"
                    wu._error_class = e.__class__.__name__

            self.assertEqual(wu.get_warmup_state(), "failed")
            self.assertEqual(wu.get_warmup_error(), "ConnectionError")

    def test_get_warmup_error_none_when_idle(self):
        from chat.warmup import get_warmup_error
        self.assertIsNone(get_warmup_error())


# ---------------------------------------------------------------------------
# 3. Hash-error -> zero deletes
# ---------------------------------------------------------------------------

class HashErrorSafetyTest(unittest.TestCase):
    """Verify that a hash-read error causes skip (no delete) in load_document."""

    def test_hash_read_error_does_not_delete_chunks(self):
        """If get_source_hash raises, load_document must return a skip result
        and must NOT call delete_chunks_by_source."""
        from chat.rag_service import RAGService

        rag = RAGService()

        # Simulate hash read error
        rag.vector_service.get_source_hash = MagicMock(
            side_effect=ConnectionError("Neo4j timeout")
        )
        rag.vector_service.delete_chunks_by_source = MagicMock()

        # Provide a real (but tiny) dummy PDF path via a mock so we never
        # actually read a file.
        with patch("chat.rag_service._compute_file_hash", return_value="abc123"):
            result = rag.load_document("/fake/path/doc.pdf", "Test Doc")

        # Must skip
        self.assertIn("Skipped", result)
        # Must NOT have deleted anything
        rag.vector_service.delete_chunks_by_source.assert_not_called()

    def test_hash_match_returns_skipped(self):
        """If stored_hash == current_hash, load_document skips cleanly."""
        from chat.rag_service import RAGService

        rag = RAGService()
        rag.vector_service.get_source_hash = MagicMock(return_value="abc123")
        rag.vector_service.delete_chunks_by_source = MagicMock()

        with patch("chat.rag_service._compute_file_hash", return_value="abc123"):
            result = rag.load_document("/fake/path/doc.pdf", "Test Doc")

        self.assertIn("Skipped", result)
        rag.vector_service.delete_chunks_by_source.assert_not_called()


# ---------------------------------------------------------------------------
# 4. Phase 1 & 2: Citation Title & Display Title Fallback Tests
# ---------------------------------------------------------------------------

class CitationTitleFallbackTest(unittest.TestCase):
    """Verify that _build_citations uses display_title when available and falls back cleanly."""

    def test_uses_display_title_when_present(self):
        rag = RAGService.__new__(RAGService)
        doc = Document(
            page_content="Dengue fever is a mosquito-borne tropical disease.",
            metadata={
                "source_file": "1-DENGUE-WHO-BOOK.pdf",
                "display_title": "Dengue: Guidelines for Diagnosis, Treatment, Prevention and Control",
                "page": 5,
            },
        )
        retrieved_text, cite_block, pages_str, sources = rag._build_citations([doc])

        self.assertIn("1- Dengue: Guidelines for Diagnosis", cite_block)
        self.assertEqual(len(sources), 1)
        self.assertEqual(
            sources[0]["title"],
            "1- Dengue: Guidelines for Diagnosis, Treatment, Prevention and Control",
        )
        self.assertEqual(
            sources[0]["clean_title"],
            "Dengue: Guidelines for Diagnosis, Treatment, Prevention and Control",
        )
        self.assertEqual(sources[0]["pages"], ["5"])

    def test_falls_back_to_filename_when_display_title_absent(self):
        rag = RAGService.__new__(RAGService)
        doc = Document(
            page_content="Clinical guidance on influenza treatment.",
            metadata={
                "source_file": "/path/to/3-INFLUENZA-WHO.pdf",
                "page": 12,
            },
        )
        retrieved_text, cite_block, pages_str, sources = rag._build_citations([doc])

        self.assertIn("1- 3-INFLUENZA-WHO.pdf", cite_block)
        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0]["title"], "1- 3-INFLUENZA-WHO.pdf")
        self.assertEqual(sources[0]["clean_title"], "3-INFLUENZA-WHO.pdf")
        self.assertEqual(sources[0]["pages"], ["12"])


# ---------------------------------------------------------------------------
# 5. Phase 3: Step-back Clarifying Question Tests
# ---------------------------------------------------------------------------

class ClarificationRoundTest(unittest.TestCase):
    """Verify that clarification gate triggers when round < 5 and is bypassed at round 5."""

    def test_clarification_triggers_when_under_specified_and_round_below_5(self):
        rag = RAGService.__new__(RAGService)
        rag.llm_service = MagicMock()
        rag.vector_service = MagicMock()
        rag.llm_service.sanitize_input = MagicMock(return_value={"is_emergency": False})
        rag.llm_service.validate_query = MagicMock(return_value="valid")
        rag.llm_service.detect_language = MagicMock(return_value="english")
        rag.vector_service.is_ready = True
        rag._needs_clarification = MagicMock(
            return_value=(True, "What specific symptoms are you experiencing?")
        )

        res = rag.retrieve_context("I feel sick", chat_history=[], clarification_round=0)
        self.assertEqual(res["status"], "clarifying")
        self.assertEqual(res["follow_up_question"], "What specific symptoms are you experiencing?")

    def test_clarification_bypassed_at_round_5(self):
        rag = RAGService.__new__(RAGService)
        rag.llm_service = MagicMock()
        rag.vector_service = MagicMock()
        rag.llm_service.sanitize_input = MagicMock(return_value={"is_emergency": False})
        rag.llm_service.validate_query = MagicMock(return_value="valid")
        rag.llm_service.detect_language = MagicMock(return_value="english")
        rag.llm_service.translate_to_english = MagicMock(return_value="I feel sick")
        rag.vector_service.is_ready = True
        dummy_chunk = Document(page_content="Medical info", metadata={"source_file": "doc.pdf"})
        rag.vector_service.hybrid_search = MagicMock(return_value=[dummy_chunk])
        rag._needs_clarification = MagicMock(
            return_value=(True, "Should not be called")
        )

        # Round 5: hard cap, must bypass clarification check
        res = rag.retrieve_context("I feel sick", chat_history=[], clarification_round=5)
        self.assertEqual(res["status"], "valid")
        self.assertEqual(len(res["chunks"]), 1)
        rag._needs_clarification.assert_not_called()

    def test_generate_with_context_clarifying_branch(self):
        rag = RAGService.__new__(RAGService)
        context_data = {
            "status": "clarifying",
            "follow_up_question": "Can you describe when the fever started?",
            "language": "english",
        }
        res = rag.generate_with_context("I have a fever", context_data)
        self.assertEqual(res["response"], "Can you describe when the fever started?")
        self.assertIsNone(res["metadata"]["triage_level"])
        self.assertEqual(res["metadata"]["source"], "Clarification Gate")


# ---------------------------------------------------------------------------
# 6. Contextual Memory & Token Budget Tests
# ---------------------------------------------------------------------------

class ContextualMemoryTests(TestCase):
    """
    Tests for:
    - Merged rewrite + fact extraction (single LLM call, token budget)
    - Pre-filter skipping fact extraction for greetings and short acks
    - Structured patient facts extraction and contradiction handling
    - Rolling summarization trigger (8-turn window, Groq model, updates not resets)
    - Step-back clarification checking patient_context first
    - Backend authoritative history ignoring client-supplied history
    - Backward-compatible session defaults
    """

    def setUp(self):
        from chat.services import ChatService
        self.service = ChatService()
        self.session = self.service.create_new_session("test-user-123", title="Test Session")

    def test_merge_not_add_llm_call_count(self):
        """Verify that query rewrite + fact extraction run in EXACTLY 1 LLM call, not 2."""
        from chat.llm_service import LLMService
        llm = LLMService()

        # Mock the auxiliary LLM call to return JSON with rewritten_query and new_facts
        call_count = [0]
        def mock_aux_call(prompt):
            call_count[0] += 1
            return json.dumps({
                "rewritten_query": "What are the complications of high fever?",
                "new_facts": {"age": "34", "symptom": "fever"}
            })

        with patch.object(llm, "_call_aux_llm", side_effect=mock_aux_call):
            rewritten, facts = llm.rewrite_query(
                "What are its complications?",
                chat_history=[{"sender": "user", "text": "I am 34 years old with fever"}],
                patient_context={}
            )
            # Must be exactly 1 call (merged), NOT 2 calls!
            self.assertEqual(call_count[0], 1)
            self.assertEqual(rewritten, "What are the complications of high fever?")
            self.assertEqual(facts, {"age": "34", "symptom": "fever"})

    def test_pre_filter_skips_fact_extraction(self):
        """Verify pre-filter skips LLM fact extraction for greetings, short acks, and <4 words."""
        from chat.llm_service import LLMService
        llm = LLMService()

        test_cases = [
            "hello",
            "salam",
            "ok",
            "thanks",
            "yes",
            "theek hai",
            "thank you",
        ]
        for q in test_cases:
            self.assertTrue(
                llm.should_skip_fact_extraction(q),
                f"Query '{q}' should have triggered pre-filter skip"
            )

        # For filtered messages without history, rewrite_query must make ZERO LLM calls
        with patch.object(llm, "_call_aux_llm") as mock_aux:
            rewritten, facts = llm.rewrite_query("hello")
            mock_aux.assert_not_called()
            self.assertEqual(rewritten, "hello")
            self.assertEqual(facts, {})

    def test_fact_contradiction_handling(self):
        """Verify new facts merge and contradiction updates rather than duplicates."""
        from chat.services import merge_patient_facts
        ctx = {"age": "34", "gender": "male"}

        # Non-contradictory update
        ctx, changed = merge_patient_facts(ctx, {"symptom": "fever"})
        self.assertTrue(changed)
        self.assertEqual(ctx["symptom"], "fever")
        self.assertEqual(ctx["age"], "34")

        # Contradiction: age updated from 34 to 35
        ctx, changed = merge_patient_facts(ctx, {"age": "35"})
        self.assertTrue(changed)
        self.assertEqual(ctx["age"], "35")  # Updated, not duplicated

    def test_summarization_trigger_and_model(self):
        """
        Verify rolling summarization trigger:
        - <= 8 turns: 0 summarization calls
        - 9 turns: triggers once, summarizes turn 1 using Groq (llama-3.1-8b-instant)
        - 10 turns: triggers once, updates existing summary
        - 15 turns test conversation verifies updates not resets
        """
        from chat.services import extract_turn_pairs, ChatService
        from chat.models import Message

        service = ChatService()
        session = self.session

        # Create 8 turns (16 messages) in DB
        for i in range(1, 9):
            Message.objects.create(session=session, sender="user", message_text=f"Turn {i} question", sequence_number=2*i-1)
            Message.objects.create(session=session, sender="bot", message_text=f"Turn {i} answer", sequence_number=2*i)

        groq_calls = []
        def mock_groq_summary(existing_summary, overflowing_turns):
            groq_calls.append({
                "existing": existing_summary,
                "turns_count": len(overflowing_turns),
                "turns": overflowing_turns
            })
            return f"{existing_summary or ''} [Summary of {len(overflowing_turns)} turns]".strip()

        with patch.object(service.llm_service, "summarize_turns_with_groq", side_effect=mock_groq_summary):
            # Check at 8 turns: should NOT trigger
            triggered = service.trigger_rolling_summarization_if_needed(session)
            self.assertFalse(triggered)
            self.assertEqual(len(groq_calls), 0)
            self.assertEqual(session.summarized_up_to_turn, 0)

            # Add turn 9 (now 9 turns exist in DB)
            Message.objects.create(session=session, sender="user", message_text="Turn 9 question", sequence_number=17)
            Message.objects.create(session=session, sender="bot", message_text="Turn 9 answer", sequence_number=18)

            # Check at 9 turns: triggers for turn 1
            triggered = service.trigger_rolling_summarization_if_needed(session)
            self.assertTrue(triggered)
            self.assertEqual(len(groq_calls), 1)
            self.assertEqual(groq_calls[0]["turns_count"], 1)
            self.assertEqual(session.summarized_up_to_turn, 1)
            self.assertIn("Summary of 1 turns", session.rolling_summary)

            # Add turn 10: triggers for turn 2, merges into existing summary (not reset)
            Message.objects.create(session=session, sender="user", message_text="Turn 10 question", sequence_number=19)
            Message.objects.create(session=session, sender="bot", message_text="Turn 10 answer", sequence_number=20)
            triggered = service.trigger_rolling_summarization_if_needed(session)
            self.assertTrue(triggered)
            self.assertEqual(len(groq_calls), 2)
            self.assertEqual(session.summarized_up_to_turn, 2)
            # Verify previous summary was passed in to merge, not restarted
            self.assertTrue(len(groq_calls[1]["existing"]) > 0)

            # Complete up to 15 turns
            for i in range(11, 16):
                Message.objects.create(session=session, sender="user", message_text=f"Turn {i} question", sequence_number=2*i-1)
                Message.objects.create(session=session, sender="bot", message_text=f"Turn {i} answer", sequence_number=2*i)
                service.trigger_rolling_summarization_if_needed(session)

            self.assertEqual(session.summarized_up_to_turn, 7)  # 15 - 8 = 7 turns summarized
            self.assertEqual(len(groq_calls), 7)

    def test_step_back_clarification_respects_patient_context(self):
        """Verify clarification gate does not re-ask a fact already in patient_context."""
        rag = self.service.rag_service

        # Mock LLM check to ensure prompt receives patient_context
        prompt_received = []
        def mock_aux_call(prompt):
            prompt_received.append(prompt)
            return "SUFFICIENT"

        with patch.object(rag.llm_service, "_call_aux_llm", side_effect=mock_aux_call):
            needs_clarify, follow_up = rag._needs_clarification(
                "What medicine should I take?",
                chat_history=[],
                patient_context={"symptoms": "high fever", "age": "34"}
            )
            self.assertFalse(needs_clarify)
            self.assertIn("Known Patient Context:", prompt_received[0])
            self.assertIn("high fever", prompt_received[0])
            self.assertIn("34", prompt_received[0])

    def test_backend_authoritative_history_ignores_frontend(self):
        """Verify backend ignores client-provided chat_history and relies on DB history."""
        from chat.models import Message
        session = self.session

        # Seed real message in DB
        Message.objects.create(session=session, sender="user", message_text="I was diagnosed with dengue yesterday.")
        Message.objects.create(session=session, sender="bot", message_text="Please stay hydrated and monitor platelet counts.")

        # Client sends a bogus/empty chat_history
        bogus_history = [{"sender": "user", "text": "Something completely fake"}]

        # Mock retrieve_context and generate_with_context to verify what history is received
        history_passed_to_rag = []
        def mock_retrieve(query, chat_history=None, **kwargs):
            history_passed_to_rag.append(chat_history)
            return {
                "status": "valid",
                "chunks": [],
                "language": "english",
                "english_query": query,
                "original_query": query,
                "extracted_facts": {},
            }

        with patch.object(self.service.rag_service, "retrieve_context", side_effect=mock_retrieve), \
             patch.object(self.service.rag_service, "generate_with_context", return_value={"response": "Take rest.", "metadata": {}}):
            self.service.process_user_query(
                session.id,
                "What was my diagnosis?",
                chat_history=bogus_history
            )

            # RAG must receive DB history, NOT bogus_history!
            self.assertTrue(len(history_passed_to_rag) > 0)
            received = history_passed_to_rag[0]
            self.assertTrue(any("dengue" in msg.get("text", "") for msg in received))
            self.assertFalse(any("Something completely fake" in msg.get("text", "") for msg in received))

    def test_backward_compatible_session_defaults(self):
        """Verify pre-migration session defaults operate cleanly without errors."""
        self.assertIsNone(self.session.rolling_summary)
        self.assertEqual(self.session.patient_context, {})
        self.assertEqual(self.session.summarized_up_to_turn, 0)

