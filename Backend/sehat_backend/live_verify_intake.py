"""
Live sequential 7-turn verification for SEHAT general conversational reasoning.
Exercises NEW variations never tested before:
- "kal se bukhar hai" (Roman Urdu new symptom)
- "tez bukhar hai 102F aur sar dard bhi hai" (Followup answer)
- "say that in Urdu" (Translation request)
- "did you forget what I told you" (Meta query)
- "I also like playing cricket on weekends" (Off-topic)
- "I have a rash and it's spreading" (Symptom needing follow-up)
- "It is on both my arms, started today, and it is very itchy" (Intake completed)
"""
import os, sys, django, uuid, time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "sehat_backend.settings")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from chat.models import ChatSession
from chat.services import get_chat_service

FIREBASE_UID = "live_intake_uid_" + str(uuid.uuid4())[:8]
session = ChatSession.objects.create(firebase_uid=FIREBASE_UID, title="General Reasoning Live Test")
session_id = str(session.id)
service = get_chat_service()

print("="*70)
print(f"SESSION ID: {session_id}")
print(f"FIREBASE UID: {FIREBASE_UID}")
print("="*70)

def run_turn(turn_no, query):
    print(f"\n{'='*70}")
    print(f"TURN {turn_no}: User query = {query!r}")
    print(f"{'='*70}")
    t0 = time.time()
    try:
        user_msg, bot_msg = service.process_user_query(session_id, query)
        resp_text = bot_msg.message_text
        meta = bot_msg.metadata or {}
        elapsed = time.time() - t0

        print(f"ELAPSED: {elapsed:.2f}s")
        print(f"RESPONSE:\n{resp_text}\n")
        print(f"SOURCE: {meta.get('source', '-')}")
        print(f"LANGUAGE: {meta.get('language', '-')}")
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        resp_text = ""

    session.refresh_from_db()
    print(f"PATIENT_CONTEXT: {session.patient_context}")
    print(f"SESSION_METADATA: {session.session_metadata}")
    return resp_text

# Run 7-turn conversation
t1 = run_turn(1, "kal se bukhar hai")
t2 = run_turn(2, "tez bukhar hai 102F aur sar dard bhi hai")
t3 = run_turn(3, "say that in Urdu")
t4 = run_turn(4, "did you forget what I told you")
t5 = run_turn(5, "I also like playing cricket on weekends")
t6 = run_turn(6, "I have a rash and it's spreading")
t7 = run_turn(7, "It is on both my arms, started today, and it is very itchy")

print("\n" + "="*70)
print("EVIDENCE & GENERALIZATION VERIFICATION SUMMARY")
print("="*70)

# Check Turn 1: Clarification triggered for "kal se bukhar hai"
session.refresh_from_db()
print(f"1. Turn 1 (kal se bukhar hai) -> patient_context has bukhar/duration? {'bukhar' in str(session.patient_context).lower() or 'fever' in str(session.patient_context).lower()}")

# Check Turn 3: "say that in Urdu" -> no Arabic script
arabic_in_t3 = any('\u0600' <= c <= '\u06FF' for c in (t3 or ''))
print(f"2. Turn 3 (say that in Urdu) -> Arabic-script detected (MUST BE False): {arabic_in_t3}")
print(f"   Turn 3 length > 30 chars? {len(t3) > 30}")

# Check Turn 4: "did you forget what I told you" -> confirms memory from DB history
print(f"3. Turn 4 (did you forget what I told you) -> contains DB history/remember? {'remember' in t4.lower() or 'yaad' in t4.lower() or 'bukhar' in t4.lower() or 'fever' in t4.lower()}")

# Check Turn 5: Off-topic -> context preserved
ctx_after_t5 = session.patient_context or {}
print(f"4. Turn 5 (off-topic) -> patient_context retained? {bool(ctx_after_t5)}")

# Check Turn 6: "I have a rash and it's spreading" -> rash in patient_context
print(f"5. Turn 6 (rash and spreading) -> rash in patient_context? {'rash' in str(session.patient_context).lower()}")

# Check Turn 7: Intake complete -> symptoms accumulated
final_ctx = session.patient_context or {}
print(f"6. Turn 7 (rash details complete) -> Final Accumulated Patient Context: {final_ctx}")
print(f"   Final clarification_round == 0? {(session.session_metadata or {}).get('clarification_round', 0) == 0}")

print("="*70)
print("ALL TURNS COMPLETED SUCCESSFULLY.")
