# SEHAT (صحت) — AI-Powered Multilingual Medical Assistant

> **Final Year Project (FYP)**  
> An intelligent, clinical decision-support and health guidance system designed to provide accurate, guideline-grounded medical assistance for rural and underserved communities in Pakistan.

---

## 📌 Overview

**SEHAT** is an AI-powered medical chatbot that bridges healthcare accessibility gaps. Users can ask medical questions and describe symptoms in either **English** or **Roman Urdu** (Urdu written in Latin script). 

The backend employs an advanced **Hybrid Retrieval-Augmented Generation (RAG)** pipeline grounded in vetted World Health Organization (WHO), WGO, and EAU clinical guidelines. Answers include precise page-level citations, automated urgency triage (`Emergency`, `Doctor`, `Self-Care`), and rigorous mathematical safety gates to prevent medical hallucinations.

---

## ✨ Key Features

### 1. 🌐 Native Dual-Language Support (English & Roman Urdu)
- Automatic language detection and translation into clinical English queries.
- Strict language purity checks ensuring Roman Urdu responses are natural and free of unintended code-switching or English markers.

### 2. 🔍 Hybrid RAG Retrieval Engine
- **Sparse Retrieval:** BM25 keyword matching for exact medical terms and drug names (weight: 0.4).
- **Dense Retrieval:** Neo4j Aura graph-backed vector store using SBERT embeddings (weight: 0.6).
- **Reciprocal Rank Fusion (RRF):** Blends sparse and dense candidate documents.
- **Semantic Reranking & Dynamic Cutoff:** SBERT (`all-MiniLM-L6-v2`) reranks candidates with dynamic confidence thresholds (e.g. `< 0.48` cutoff to filter out-of-scope queries like diabetes or asthma).

### 3. 📚 Curated WHO Medical Knowledge Base
- Ingests **15 medical reference books** covering **10 core disease domains**:
  1. Dengue Fever
  2. Diarrhoea
  3. Hepatitis A
  4. Influenza
  5. Tuberculosis (TB)
  6. Malaria
  7. Skin Allergy & Contact Dermatitis
  8. Typhoid Fever
  9. Common Cold
  10. Urinary Tract Infections (UTI)
- Automated disease tagging stamped across both Neo4j nodes and in-memory BM25 indices.
- **Incremental Ingestion:** SHA-256 byte hashing skips unchanged files on startup; startup BM25 warm-up restores indices from Neo4j without re-embedding.

### 4. 🛡️ Clinical Safety & Quality Gates
- **Emergency / Self-Harm Intercept:** Immediate bypass for suicidal ideation or self-harm queries with localized emergency helplines (`1122` in Pakistan).
- **Automated Triage Classification:** Auxiliary LLM classifies each query into `Emergency`, `Doctor`, or `Self-Care`.
- **Hallucination Prevention (RAGAS Gate):** Evaluates faithfulness before returning answers. If faithfulness score drops below `0.25`, the response safely falls back to a medical disclaimer and physician referral.
- **Exact Citations:** Every substantiated answer includes document name and page number references.

### 5. ⚡ Multi-Model LLM Orchestration
- **Primary Generator:** Google Gemini 3.1 Flash Lite (`gemini-3.1-flash-lite`).
- **Auxiliary & Fallback:** Groq LLaMA 3.1 8B (`llama-3.1-8b-instant`) for query validation, translation, triage classification, and fallback generation.

### 6. 📱 Cross-Platform Mobile Application
- Built with **React Native** and **Expo**.
- Modern, accessible UI with chat history, document viewing, role-based profiles (User, Doctor, Admin), and an Admin Dashboard for real-time document management.
- Secure user authentication powered by **Firebase Auth**.

---

## 🏗️ System Architecture

```
                      ┌──────────────────────────────────────┐
                      │    React Native Mobile Client        │
                      │     (Expo / iOS / Android / Web)     │
                      └──────────────────┬───────────────────┘
                                         │ HTTPS / REST
                                         ▼
                      ┌──────────────────────────────────────┐
                      │     Django REST Framework API        │
                      │  Rate Limiter & Input Sanitization   │
                      └──────────────────┬───────────────────┘
                                         │
        ┌────────────────────────────────┴────────────────────────────────┐
        ▼                                                                 ▼
┌───────────────────────────────┐                       ┌───────────────────────────────────┐
│     Firebase Authentication   │                       │          RAG Pipeline             │
│   Token Verification & Roles  │                       │  • Language Detection             │
└───────────────────────────────┘                       │  • Emergency / Safety Filter      │
                                                        └─────────────────┬─────────────────┘
                                                                          │
                        ┌─────────────────────────────────────────────────┴───────────────────┐
                        ▼                                                                     ▼
        ┌────────────────────────────────┐                                    ┌───────────────────────────────┐
        │       Retrieval Engine         │                                    │      Generation & Safety      │
        │  • BM25 Sparse Search (0.4)    │                                    │  • Gemini 3.1 Flash Lite      │
        │  • Neo4j Aura Vector (0.6)     │                                    │  • Groq LLaMA 3.1 (Fallback)  │
        │  • SBERT Cosine Reranking      │                                    │  • RAGAS Faithfulness Gate    │
        │  • Dynamic Threshold (<0.48)   │                                    │  • Triage Level Classifier    │
        └────────────────────────────────┘                                    └───────────────────────────────┘
```

---

## 📂 Project Structure

```
FYP-SEHAT/
├── Backend/
│   ├── medical_documents/           # WHO/WGO clinical guideline PDF documents
│   ├── sehat_backend/
│   │   ├── manage.py                # Django management entry point
│   │   ├── sehat_backend/           # Django settings, WSGI, ASGI, URLs
│   │   │   ├── settings.py
│   │   │   └── urls.py
│   │   └── chat/                    # Core RAG and Chat application
│   │       ├── document_service.py  # PDF cleaning, text splitting, disease tagging
│   │       ├── vector_store_service.py # BM25 + Neo4j vector store & SBERT reranker
│   │       ├── llm_service.py       # Gemini/Groq LLM chains, triage & language checks
│   │       ├── rag_service.py       # Main RAG coordinator & evaluation gates
│   │       ├── services.py          # Session management & business logic
│   │       ├── models.py            # ChatSession and Message ORM models
│   │       ├── views.py             # DRF API endpoints & ingestion runner
│   │       └── serializers.py       # REST API serializers
│   └── requirements.txt             # Python dependencies
├── Frontend/
│   ├── app/                         # Expo Router screens and navigation
│   │   ├── screens/                 # ChatScreen, HomeScreen, AdminDashboard
│   │   ├── services/api.jsx         # Axios API client & Firebase token attachment
│   │   └── _layout.jsx              # Root app layout & theme
│   ├── package.json                 # Node dependencies
│   └── firebase.config.js           # Firebase Client SDK configuration
├── .gitignore                       # Git ignore rules
└── README.md                        # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.10+**
- **Node.js 18+** & **npm**
- **Neo4j Aura** cloud instance (or local Neo4j 5+ with GDS plugin)
- API Keys for **Google Gemini** and **Groq**
- **Firebase Project** with Authentication enabled

---

### Backend Setup

1. **Navigate to the backend directory:**
   ```bash
   cd Backend
   ```

2. **Create and activate a virtual environment:**
   ```bash
   python -m venv venv
   # On Windows:
   venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure Environment Variables:**
   Create a `.env` file inside `Backend/sehat_backend/` (or repository root):
   ```env
   SECRET_KEY=your-django-secret-key
   DEBUG=True

   # AI / LLM Keys
   GOOGLE_API_KEY=your-google-gemini-api-key
   GROQ_API_KEY=your-groq-api-key

   # Neo4j Aura Database
   NEO4J_URI=neo4j+s://<your-instance-id>.databases.neo4j.io
   NEO4J_USERNAME=neo4j
   NEO4J_PASSWORD=your-neo4j-password
   NEO4J_DATABASE=neo4j

   # Firebase Service Account
   FIREBASE_SERVICE_ACCOUNT_KEY=secrets/firebase-service-account.json
   FIREBASE_PROJECT_ID=sehat-538ee

   # Ingestion Settings (optional)
   FORCE_REINGEST=false
   ```

5. **Run database migrations:**
   ```bash
   cd sehat_backend
   python manage.py migrate
   ```

6. **Start the development server:**
   ```bash
   python manage.py runserver 0.0.0.0:8000
   ```
   *On initial startup, the server indexes medical PDFs into Neo4j and warms up the BM25 index.*

---

### Frontend Setup

1. **Navigate to the frontend directory:**
   ```bash
   cd Frontend
   ```

2. **Install Node dependencies:**
   ```bash
   npm install
   ```

3. **Configure Firebase:**
   Ensure `Frontend/firebase.config.js` points to your active Firebase project credentials.

4. **Start the Expo development server:**
   ```bash
   npx expo start
   ```
   Press `a` for Android emulator, `i` for iOS simulator, or scan the QR code using the **Expo Go** app on a physical device.

---

## 🧪 Testing & Verification

SEHAT includes test scripts verifying RAG retrieval accuracy, disease tagging, and out-of-scope fallback behavior:

- **Full RAG Pipeline Verification:**
  ```bash
  python manage.py test chat
  ```
- **Live Retrieval Multi-Disease Test:**
  Tests across all 10 guideline diseases and verifies out-of-scope fallbacks (e.g. diabetes, asthma) trigger the proper `no_info` response.

---

## 👥 Contributors

- **Rahman Ali** — Lead Developer & RAG Pipeline Architect
- **FYP Team SEHAT**

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
