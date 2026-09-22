import os
import re
from collections import Counter
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter


# ---------------------------------------------------------------------------
# Reference-section heading patterns (conservative — only clear labels)
# ---------------------------------------------------------------------------
_REFERENCE_HEADING_RE = re.compile(
    r'^\s*(references|bibliography|works\s+cited|further\s+reading)\s*$',
    re.IGNORECASE,
)

# Table-of-contents indicator: many lines that are "text .... N" or "text ... N"
_TOC_LINE_RE = re.compile(r'\.{3,}\s*\d+\s*$')

# Standalone page-number line: optional whitespace, digits only, optional whitespace
_PAGE_NUMBER_LINE_RE = re.compile(r'^\s*\d{1,4}\s*$')


def _clean_pages(docs):
    """
    Clean boilerplate from a list of LangChain Document objects (one per page).

    Steps (conservative — bias toward under-removal):
      1. Detect repeated headers/footers by line frequency across pages.
         Only remove a line if it appears on ≥50 % of pages AND on ≥3 pages.
      2. Remove standalone page-number-only lines.
      3. Detect and skip TOC pages (>= 60 % of non-empty lines match TOC pattern).
      4. Truncate reference/bibliography sections from heading to end of doc.
      5. Collapse 3+ consecutive blank lines to 2.

    Returns a new list of Documents with cleaned page_content.
    Keeps original metadata unchanged.
    """
    if not docs:
        return docs

    total_pages = len(docs)
    threshold = max(3, int(total_pages * 0.50))  # ≥50 % of pages, at least 3

    # ── Step 1: build line-frequency map ────────────────────────────────────
    line_counts = Counter()
    for doc in docs:
        # Count each unique stripped line once per page
        seen_on_page = set()
        for raw_line in doc.page_content.splitlines():
            stripped = raw_line.strip()
            if stripped and len(stripped) >= 5 and stripped not in seen_on_page:
                line_counts[stripped] += 1
                seen_on_page.add(stripped)

    # Lines that appear on ≥50 % of pages (and ≥3 pages)
    repeated_boilerplate = {
        line for line, count in line_counts.items() if count >= threshold
    }

    # ── Step 2-4: process each page ─────────────────────────────────────────
    ref_section_started = False  # once True, all subsequent pages are dropped
    cleaned_docs = []

    for doc in docs:
        # If we hit a reference section in a previous page, drop remainder
        if ref_section_started:
            continue

        lines = doc.page_content.splitlines()
        non_empty = [l for l in lines if l.strip()]

        # ── Step 3: skip TOC pages ───────────────────────────────────────────
        if non_empty:
            toc_lines = sum(1 for l in non_empty if _TOC_LINE_RE.search(l))
            if toc_lines / len(non_empty) >= 0.60:
                # Skip this page entirely — it's a table of contents
                continue

        # ── Steps 1, 2, 4: clean line by line ───────────────────────────────
        cleaned_lines = []
        for line in lines:
            stripped = line.strip()

            # Remove repeated header/footer boilerplate
            if stripped in repeated_boilerplate:
                continue

            # Remove standalone page-number lines
            if _PAGE_NUMBER_LINE_RE.match(line):
                continue

            # Detect reference/bibliography heading — truncate from here onward
            if stripped and _REFERENCE_HEADING_RE.match(stripped):
                ref_section_started = True
                break  # drop rest of this page and all subsequent pages

            cleaned_lines.append(line)

        # ── Step 5: collapse excess blank lines ──────────────────────────────
        text = "\n".join(cleaned_lines)
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = text.strip()

        if not text:
            # Page became empty after cleaning — skip entirely
            continue

        # Build a new Document with cleaned content, preserving all metadata
        from langchain_core.documents import Document as LC_Document
        cleaned_docs.append(LC_Document(page_content=text, metadata=doc.metadata))

    return cleaned_docs


# ---------------------------------------------------------------------------
# Filename prefix to disease mapping covering all 15 medical document books
# ---------------------------------------------------------------------------
FILENAME_PREFIX_TO_DISEASE = {
    "1-": "dengue",
    "2-": "diarrhoea",
    "3-": "hepatitis_a",
    "4-": "influenza",
    "5-": "tuberculosis",
    "6-": "malaria",
    "7-": "skin_allergy",
    "8-": "typhoid",
    "9-": "common_cold",
    "10-": "uti",
}


# ---------------------------------------------------------------------------
# Real display titles for all 15 medical PDF books
# Keys are exact basenames of the files in medical_documents/
# ---------------------------------------------------------------------------
FILENAME_TO_DISPLAY_TITLE = {
    "1-DENGUE-WHO-BOOK.pdf":
        "Dengue: Guidelines for Diagnosis, Treatment, Prevention and Control",
    "2-DIARRHOEA-WGO-BOOK.pdf":
        "WGO Global Guidelines: Acute Diarrhea",
    "2-DIARRHOEA-WHO-BOOK.pdf":
        "WHO: The Treatment of Diarrhoea - A Manual for Physicians",
    "3-Hepatitis-A-%20WHO-BOOK-1.pdf":
        "WHO: Hepatitis A Vaccine Position Paper",
    "4-INFLUENZA-WHO-BOOK.pdf":
        "WHO: Vaccines Against Influenza",
    "5-Tuberculosis%20(TB)-WHO-BOOK.pdf":
        "WHO: Global Tuberculosis Report",
    "6-MALARIA-WHO-BOOK.pdf":
        "WHO: Guidelines for the Treatment of Malaria",
    "7-Skin-Allergy%20-Dermatitis-BOOK.pdf":
        "Clinical Guide to Skin Allergy and Contact Dermatitis",
    "7-Skin-Allergy-Contact-Dermatitis-Book.pdf":
        "Contact Dermatitis: A Clinical Reference Guide",
    "8-Typhoid-Fever-WHO-BOOK-surveillancevaccinepreventable.pdf":
        "WHO: Typhoid Fever - Surveillance and Vaccine Use",
    "8-Typhoid-Fever-WHO-BOOK.pdf":
        "WHO: Background Document on the Diagnosis, Treatment and Prevention of Typhoid Fever",
    "9-COMMON_COLD_1.pdf":
        "Clinical Review: Management of the Common Cold",
    "9-COMMON_COLD_2.pdf":
        "Evidence-Based Guidelines for Common Cold Treatment",
    "10-Urinary-Tract-Infection-EAU.pdf":
        "EAU Guidelines on Urological Infections",
    "10-Urinary-Tract-Infections-Core-Curriculum-2024_202.pdf":
        "ASN: Urinary Tract Infections - Core Curriculum 2024",
}


def get_display_title(filename: str) -> str:
    """Return the curated human-readable title for a PDF file.

    Looks up the exact basename in FILENAME_TO_DISPLAY_TITLE.  If not found
    (e.g. a user-uploaded book with a non-standard name), falls back to a
    cleaned version of the filename (hyphens/underscores → spaces, no ext).
    """
    basename = os.path.basename(filename)
    if basename in FILENAME_TO_DISPLAY_TITLE:
        return FILENAME_TO_DISPLAY_TITLE[basename]
    # Fallback: clean filename
    name = os.path.splitext(basename)[0]
    name = name.replace("-", " ").replace("_", " ").replace("%20", " ")
    # Collapse multiple spaces
    import re as _re
    name = _re.sub(r" +", " ", name).strip()
    return name


def get_disease_from_filename(filename: str) -> str:
    """Derive disease tag from filename prefix or keywords.

    Maps all 15 standard medical document books to their corresponding disease tag:
    dengue, diarrhoea, hepatitis_a, influenza, tuberculosis, malaria,
    skin_allergy, typhoid, common_cold, uti.
    """
    clean_name = os.path.basename(filename).strip()
    for prefix in sorted(FILENAME_PREFIX_TO_DISEASE.keys(), key=len, reverse=True):
        if clean_name.startswith(prefix):
            return FILENAME_PREFIX_TO_DISEASE[prefix]

    lower = clean_name.lower()
    if "dengue" in lower:
        return "dengue"
    if "diarrhoea" in lower or "diarrhea" in lower:
        return "diarrhoea"
    if "hepatitis" in lower:
        return "hepatitis_a"
    if "influenza" in lower or "flu" in lower:
        return "influenza"
    if "tuberculosis" in lower or "(tb)" in lower or "tb-" in lower:
        return "tuberculosis"
    if "malaria" in lower:
        return "malaria"
    if "skin" in lower or "dermatitis" in lower or "allergy" in lower:
        return "skin_allergy"
    if "typhoid" in lower:
        return "typhoid"
    if "cold" in lower:
        return "common_cold"
    if "urinary" in lower or "uti" in lower:
        return "uti"

    return "general"


class DocumentService:
    """Handles PDF loading, text chunking, and file deletion."""

    def load_and_split_pdf(
        self,
        pdf_path: str,
        source_hash: str | None = None,
        disease: str | None = None,
    ):
        """Load PDF and split into chunks.

        Args:
            pdf_path: Absolute path to the PDF file.
            source_hash: Optional SHA-256 hex digest of the file bytes. When
                provided it is stored as ``source_hash`` in every chunk's
                metadata so Neo4j nodes carry the hash for future comparisons.
            disease: Optional disease classification tag. If omitted, it is
                derived automatically from the filename prefix.
        """
        loader = PyPDFLoader(pdf_path)
        docs = loader.load()

        # ── Clean boilerplate before chunking ────────────────────────────────
        docs = _clean_pages(docs)

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=100,
            separators=["\n\n", "\n", ". ", " ", ""],
        )
        chunks = splitter.split_documents(docs)

        disease_tag = disease or get_disease_from_filename(pdf_path)
        display_title = get_display_title(pdf_path)

        for chunk in chunks:
            chunk.metadata["source_file"] = os.path.basename(pdf_path)
            chunk.metadata["disease"] = disease_tag
            chunk.metadata["display_title"] = display_title
            if source_hash:
                chunk.metadata["source_hash"] = source_hash

        return chunks
    
    def delete_pdf(self, file_path: str) -> bool:
        """Delete a PDF file from the medical documents directory."""
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                print(f"Deleted file: {file_path}")
                return True
            else:
                print(f"File not found: {file_path}")
                return False
        except Exception as e:
            print(f"Error deleting file: {e}")
            return False
    
    def list_pdf_files(self, directory_path: str) -> list:
        """List all PDF files in the medical documents directory."""
        try:
            if not os.path.exists(directory_path):
                return []
            files = [f for f in os.listdir(directory_path) if f.endswith('.pdf')]
            return files
        except Exception as e:
            print(f"Error listing files: {e}")
            return []