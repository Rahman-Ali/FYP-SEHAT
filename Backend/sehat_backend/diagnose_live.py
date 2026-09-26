import os, sys, django, uuid, time, json

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "sehat_backend.settings")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
django.setup()

from chat.models import ChatSession
from chat.services import get_chat_service

service = get_chat_service()

print("="*80)
print("DIAGNOSIS 1 & 2: REPRODUCE COUGH CONVERSATION + 'koi treatment suggest karen please'")
print("="*80)

uid1 = "diag_user_" + str(uuid.uuid4())[:8]
session1 = ChatSession.objects.create(firebase_uid=uid1, title="Cough Diagnosis")
s1_id = str(session1.id)

def run_step(session_id, q, turn_idx):
    print(f"\n--- Turn {turn_idx}: {q!r} ---")
    t0 = time.time()
    try:
        u_msg, b_msg = service.process_user_query(session_id, q)
        elapsed = time.time() - t0
        meta = b_msg.metadata or {}
        print(f"Elapsed Wall-Clock: {elapsed:.2f}s ({elapsed*1000:.0f} ms)")
        print(f"Bot Response:\n{b_msg.message_text[:300]}...")
        print(f"Triage: {meta.get('triage_level')}")
        print(f"Source: {meta.get('source')}")
        print(f"Language: {meta.get('language')}")
        print("Stage Timings:")
        for k, v in (meta.get("stage_timings") or {}).items():
            print(f"   {k}: {v} ms")
        return b_msg, None
    except Exception as e:
        import traceback
        print(f"EXCEPTION ON TURN {turn_idx}: {e}")
        traceback.print_exc()
        return None, e

# 2+ clarification rounds then answer triggering message
run_step(s1_id, "khansi hai", 1)
run_step(s1_id, "3 din se hai aur khushk khansi hai", 2)
b3, err3 = run_step(s1_id, "koi treatment suggest karen please", 3)

print("\n" + "="*80)
print("DIAGNOSIS 3: REPRODUCE 'My wife has delivery right now, suggest me the treatment'")
print("="*80)

uid2 = "diag_user_" + str(uuid.uuid4())[:8]
session2 = ChatSession.objects.create(firebase_uid=uid2, title="Delivery Diagnosis")
s2_id = str(session2.id)

b_del, err_del = run_step(s2_id, "My wife has delivery right now, suggest me the treatment", 1)

print("\n" + "="*80)
print("DIAGNOSIS COMPLETE")
print("="*80)
