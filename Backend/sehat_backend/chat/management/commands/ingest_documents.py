import os
from django.core.management.base import BaseCommand, CommandError
from django.conf import settings
from chat.services import get_chat_service


class Command(BaseCommand):
    help = "Ingest PDF documents from medical_documents into the Neo4j vector store and BM25 index."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Bypass hash checks and force re-ingestion of all documents",
        )
        parser.add_argument(
            "--file",
            type=str,
            default=None,
            help="Ingest only a specific file (e.g. 1-DENGUE-WHO-BOOK.pdf)",
        )

    def handle(self, *args, **options):
        # Render production guard
        if os.getenv("RENDER") and os.getenv("ALLOW_INGEST_ON_RENDER", "false").strip().lower() not in ("true", "1", "yes"):
            raise CommandError(
                "Ingestion is strictly prohibited on Render unless ALLOW_INGEST_ON_RENDER=true is set in environment."
            )

        force = options["force"]
        target_file = options["file"]

        if force:
            os.environ["FORCE_REINGEST"] = "true"

        medical_docs_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
            "medical_documents",
        )

        if not os.path.isdir(medical_docs_dir):
            raise CommandError(f"Medical documents directory not found: {medical_docs_dir}")

        if target_file:
            pdf_files = [target_file]
            target_path = os.path.join(medical_docs_dir, target_file)
            if not os.path.exists(target_path):
                raise CommandError(f"Target file does not exist: {target_path}")
        else:
            pdf_files = sorted([f for f in os.listdir(medical_docs_dir) if f.endswith(".pdf")])

        if not pdf_files:
            self.stdout.write(self.style.WARNING("No PDF files found to ingest."))
            return

        self.stdout.write(f"Starting ingestion of {len(pdf_files)} document(s)... (force={force})")

        chat_svc = get_chat_service()
        rag_svc = chat_svc.rag_service

        loaded_count = 0
        skipped_count = 0
        error_count = 0

        for filename in pdf_files:
            pdf_path = os.path.join(medical_docs_dir, filename)
            book_name = filename.replace(".pdf", "").replace("-", " ").replace("_", " ")

            try:
                result = rag_svc.load_document(pdf_path, book_name)
                self.stdout.write(f"  {book_name}: {result}")
                if result.startswith("Skipped"):
                    skipped_count += 1
                else:
                    loaded_count += 1
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"  ERROR loading '{filename}': {e}"))
                error_count += 1

        if skipped_count:
            self.stdout.write("Warming up BM25 index from Neo4j text...")
            rag_svc.vector_service.warm_up_bm25_from_neo4j()

        self.stdout.write(
            self.style.SUCCESS(
                f"INGESTION COMPLETE: {loaded_count} re-indexed, {skipped_count} skipped, {error_count} errored."
            )
        )
