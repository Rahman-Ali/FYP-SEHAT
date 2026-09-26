"""Set display_title on existing Neo4j MedicalDocument nodes (property-only; --dry-run to preview)."""
import os
from django.core.management.base import BaseCommand, CommandError
from neo4j import GraphDatabase
from dotenv import load_dotenv

from chat.document_service import FILENAME_TO_DISPLAY_TITLE, get_display_title

load_dotenv()


class Command(BaseCommand):
    help = (
        "Set display_title property on existing Neo4j MedicalDocument nodes "
        "using the curated title mapping. Property-only SET — no deletes."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print the planned updates without writing to Neo4j.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        neo4j_uri = os.getenv("NEO4J_URI", "neo4j+s://98b70f75.databases.neo4j.io")
        neo4j_user = os.getenv("NEO4J_USERNAME", "neo4j")
        neo4j_password = os.getenv("NEO4J_PASSWORD")
        neo4j_database = os.getenv("NEO4J_DATABASE", "neo4j")

        if not neo4j_password:
            raise CommandError("NEO4J_PASSWORD environment variable is not set.")

        self.stdout.write(
            f"{'[DRY RUN] ' if dry_run else ''}Connecting to Neo4j: {neo4j_uri}"
        )

        try:
            driver = GraphDatabase.driver(
                neo4j_uri,
                auth=(neo4j_user, neo4j_password),
                connection_timeout=10.0,
            )
            driver.verify_connectivity()
        except Exception as e:
            raise CommandError(f"Neo4j connection failed: {e}")

        # Step 1: fetch distinct source_files currently in Neo4j
        with driver.session(database=neo4j_database) as session:
            result = session.run(
                "MATCH (n:MedicalDocument) "
                "RETURN DISTINCT n.source_file AS source_file, "
                "count(n) AS node_count"
            )
            neo4j_files = {
                rec["source_file"]: rec["node_count"]
                for rec in result
                if rec["source_file"]
            }

        self.stdout.write(
            f"Found {len(neo4j_files)} distinct source_file(s) in Neo4j.\n"
        )

        # Step 2: build update plan
        plan = []  # list of (source_file, display_title, node_count)
        for source_file, node_count in sorted(neo4j_files.items()):
            title = get_display_title(source_file)
            plan.append((source_file, title, node_count))
            mapped = source_file in FILENAME_TO_DISPLAY_TITLE
            flag = "  [mapped]" if mapped else "  [fallback]"
            self.stdout.write(
                f"  {source_file}\n"
                f"    -> {title}{flag}\n"
                f"    nodes to update: {node_count}"
            )

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"\n[DRY RUN] Would update {sum(p[2] for p in plan)} nodes "
                    f"across {len(plan)} source_file(s). No writes made."
                )
            )
            driver.close()
            return

        # Step 3: apply updates — SET only, never DELETE
        total_updated = 0
        with driver.session(database=neo4j_database) as session:
            for source_file, title, node_count in plan:
                try:
                    result = session.run(
                        "MATCH (n:MedicalDocument) "
                        "WHERE n.source_file = $source_file "
                        "SET n.display_title = $title "
                        "RETURN count(n) AS updated",
                        source_file=source_file,
                        title=title,
                    )
                    updated = result.single()["updated"]
                    total_updated += updated
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"  SET display_title on {updated} nodes "
                            f"for '{source_file}'"
                        )
                    )
                except Exception as e:
                    self.stdout.write(
                        self.style.ERROR(
                            f"  ERROR updating '{source_file}': {e}"
                        )
                    )

        driver.close()
        self.stdout.write(
            self.style.SUCCESS(
                f"\nDONE: display_title property set on {total_updated} "
                f"Neo4j node(s) across {len(plan)} source_file(s)."
            )
        )
