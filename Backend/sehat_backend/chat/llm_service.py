import os
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from sentence_transformers import util

load_dotenv()


class LLMService:
    """Manages all LLM interactions."""
    
    def __init__(self):
        self.GROQ_API_KEY = os.getenv("GROQ_API_KEY")
        if not self.GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY missing in .env file")

        self.llm = ChatGroq(
            model_name="llama-3.1-8b-instant",
            groq_api_key=self.GROQ_API_KEY,
            temperature=0.2,
            max_tokens=1024,
            timeout=30,
            max_retries=2,
        )

    def validate_query(self, query: str) -> str:
        if not query.strip():
            return "invalid"
            
        prompt = f"""You are a query classifier for a medical information system.

VALID   - The message clearly asks about a health topic, symptom, disease, or treatment.
UNCLEAR - The message is health-related but too vague to search.
INVALID - The message is a greeting, random text, or not about health.

Output ONLY one word: VALID, UNCLEAR, or INVALID

User message: {query}

Classification:"""
        try:
            resp = self.llm.invoke(prompt)
            result = (resp.content if hasattr(resp, "content") else str(resp)).strip().upper()
            word = result.split()[0] if result.split() else "UNCLEAR"
            if word in ("VALID", "UNCLEAR", "INVALID"):
                print(f"Validation: {word}")
                return word.lower()
            return "unclear"
        except Exception as e:
            print(f"Validation error: {e}")
            return "unclear"

    def detect_language(self, query: str) -> str:
        hindi_chars = ['ा', 'ि', 'ी', 'ु', 'ू', 'े', 'ै', 'ो', 'ौ', 'ं', 'ः', 'ँ']
        
        if any(char in query for char in hindi_chars):
            print("Hindi detected - language not supported")
            return "invalid_hindi"
        
        prompt = f"""Determine the EXACT language of this text.

Rules:
- If text contains Urdu words written in English alphabet (like: hai, hain, mera, aapka, kya, etc.) -> roman_urdu
- If text is pure English -> english

Output ONLY ONE WORD: roman_urdu OR english

Text: {query}

Language:"""
        try:
            resp = self.llm.invoke(prompt)
            result = (resp.content if hasattr(resp, "content") else str(resp)).strip().lower()
            
            if "urdu" in result or "roman" in result:
                print("Language: Roman Urdu")
                return "roman_urdu"
            else:
                print("Language: English")
                return "english"
        except Exception as e:
            print(f"Language detection error: {e}")
            return "english"

    def translate_to_english(self, query: str, language: str) -> str:
        if language == "english":
            return query
        if language == "invalid_hindi":
            return query

        prompt = f"""Translate this Roman Urdu medical query into accurate English.
Preserve all symptoms, conditions, and medical details.

Roman Urdu: {query}

English translation:"""
        try:
            resp = self.llm.invoke(prompt)
            translation = (resp.content if hasattr(resp, "content") else str(resp)).strip()
            if translation and len(translation) > 2:
                print(f"Translated: '{query}' -> '{translation}'")
                return translation
            return query
        except Exception as e:
            print(f"Translation error: {e}")
            return query

    def verify_relevance(self, english_query: str, retrieved_text: str) -> bool:
        prompt = f"""You are a relevance checker.

Question: {english_query}

Retrieved Text:
{retrieved_text[:1500]}

Does the retrieved text contain information that answers the question?

Output ONLY: YES or NO

Relevant?"""
        try:
            resp = self.llm.invoke(prompt)
            result = (resp.content if hasattr(resp, "content") else str(resp)).strip().upper()
            is_relevant = result.startswith("YES")
            print(f"Relevance: {'YES' if is_relevant else 'NO'}")
            return is_relevant
        except Exception as e:
            print(f"Relevance check error: {e}")
            return True

    def generate_answer(self, original_query: str, retrieved_text: str, language: str) -> str:
        if language == "invalid_hindi":
            return ("Please ask your question in English or Roman Urdu. "
                    "Hindi (Devanagari script) is not supported.\n\n"
                    "Baraye meharbani apna sawaal English ya Roman Urdu mein poochein.")

        if language == "roman_urdu":
            lang_rule = """IMPORTANT: Write the ENTIRE answer in Roman Urdu (Urdu using English alphabet).
Use words like: hai, hain, ka, ki, mein, aap, aapka, etc."""
            no_info_msg = ("Maafi chahta hoon, is sawaal ka jawab mere paas mojood documents "
                          "mein nahi mila. Kisi doctor se rabta karein.")
        else:
            lang_rule = """IMPORTANT: Write the ENTIRE answer in clear English."""
            no_info_msg = ("Sorry, I could not find information about this in my knowledge base. "
                          "Please consult a doctor.")

        prompt = f"""You are a helpful medical assistant. {lang_rule}

Information from medical documents:
{retrieved_text}

User's question: {original_query}

CRITICAL INSTRUCTIONS:
1. Read the question carefully. Identify ALL parts/symptoms mentioned.
2. Answer EVERY part of the question.
3. Use ONLY the information provided above.
4. Rewrite in simple, easy-to-understand language.
5. If the information does NOT answer the question, output EXACTLY: {no_info_msg}
6. Do NOT introduce yourself.
7. Use bullet points (dash -) for clarity. Maximum 5-6 points.

Answer:"""
        try:
            resp = self.llm.invoke(prompt)
            answer = (resp.content if hasattr(resp, "content") else str(resp)).strip()
            answer = answer.replace("**", "").replace("##", "").replace("__", "")
            
            if language == "english":
                urdu_markers = [" hai ", " hain ", " ka ", " ki ", " mein ", " aap "]
                answer_lower = " " + answer.lower() + " "
                urdu_count = sum(1 for marker in urdu_markers if marker in answer_lower)
                if urdu_count >= 2:
                    print("Language mismatch: English expected but got Urdu markers")
                    return no_info_msg
            
            return answer
        except Exception as e:
            print(f"Generation error: {e}")
            return no_info_msg

    def compute_ragas_metrics(self, answer: str, retrieved_text: str, 
                               query: str, context_docs: list, sbert_model) -> dict:
        zero = {k: 0.0 for k in ["faithfulness", "answer_relevancy", 
                                  "context_recall", "context_precision", "answer_correctness"]}
        if not sbert_model:
            return zero
            
        try:
            enc = sbert_model.encode
            
            sentences = [s.strip() for s in answer.replace('\n', '.').split(".") if len(s.strip()) > 10]
            if sentences:
                ctx_emb = enc(retrieved_text)
                supported = sum(1 for s in sentences if util.cos_sim(enc(s), ctx_emb).item() > 0.35)
                faithfulness = supported / len(sentences)
            else:
                faithfulness = 0.0

            ans_rel = util.cos_sim(enc(query), enc(answer)).item()
            ctx_rec = util.cos_sim(enc(retrieved_text), enc(answer)).item()
            chunk_sims = [util.cos_sim(enc(query), enc(d.page_content)).item() for d in context_docs]
            ctx_prec = sum(chunk_sims) / len(chunk_sims) if chunk_sims else 0.0
            ans_corr = max((util.cos_sim(enc(answer), enc(d.page_content)).item() for d in context_docs), default=0.0)

            return {
                "faithfulness": round(faithfulness, 2),
                "answer_relevancy": round(ans_rel, 2),
                "context_recall": round(ctx_rec, 2),
                "context_precision": round(ctx_prec, 2),
                "answer_correctness": round(ans_corr, 2),
            }
        except Exception as e:
            print(f"RAGAS metrics error: {e}")
            return zero