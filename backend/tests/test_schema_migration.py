import unittest

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, ensure_model_schema
from app.models import Asset, Fact, Guideline, Term


LEGACY_SCHEMA = {
    "guidelines": "CREATE TABLE guidelines ("
    "id INTEGER PRIMARY KEY, "
    "title VARCHAR(200) NOT NULL, "
    "category VARCHAR(100), "
    "created_at TIMESTAMP"
    ")",
    "terms": "CREATE TABLE terms ("
    "id INTEGER PRIMARY KEY, "
    "term VARCHAR(200) NOT NULL, "
    "status VARCHAR(50), "
    "explanation TEXT, "
    "created_at TIMESTAMP"
    ")",
    "facts": "CREATE TABLE facts ("
    "id INTEGER PRIMARY KEY, "
    "statement TEXT NOT NULL, "
    "created_at TIMESTAMP"
    ")",
    "assets": "CREATE TABLE assets ("
    "id INTEGER PRIMARY KEY, "
    "name VARCHAR(200) NOT NULL, "
    "created_at TIMESTAMP"
    ")",
}


class EnsureModelSchemaTests(unittest.TestCase):
    """Deployed databases can be created by an older app version.

    `create_all` never alters existing tables, so tables created before
    columns were added to the models keep working but queries that select
    the new columns raise a database error. `ensure_model_schema` has to
    reconcile such a legacy database at startup.
    """

    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        with self.engine.begin() as connection:
            for statement in LEGACY_SCHEMA.values():
                connection.execute(text(statement))
        # The legacy tables exist, so no new tables are created here; only
        # missing tables (for example ones added after the deploy) are.
        Base.metadata.create_all(self.engine)
        ensure_model_schema(self.engine)

    def test_legacy_tables_have_all_model_columns(self):
        expected = {
            "guidelines": {"description", "updated_at"},
            "terms": {"replacement", "definition", "guideline_id"},
            "facts": {"source", "owner", "last_reviewed", "review_by"},
            "assets": {"description", "asset_type", "url", "metadata_json"},
        }
        inspector = inspect(self.engine)
        for table, missing_columns in expected.items():
            columns = {
                column["name"] for column in inspector.get_columns(table)
            }
            for name in missing_columns:
                self.assertIn(name, columns)

    def test_legacy_knowledge_rows_work_with_the_orm(self):
        with Session(self.engine) as db:
            guideline = Guideline(
                title="Tone",
                description="Keep the tone helpful.",
            )
            db.add(guideline)
            db.flush()
            term = Term(
                term="you're",
                definition="Avoid colloquial contractions.",
                replacement="you are",
                status="prohibited",
                explanation="Contractions are too informal.",
                guideline_id=guideline.id,
            )
            db.add(term)
            db.add(
                Fact(
                    statement="The campaign launches on Monday.",
                    source="mymarketing@brand.example",
                    owner="MARGARET",
                )
            )
            db.add(
                Asset(
                    name="Logo pack",
                    description="Primary logo variants.",
                    asset_type="image",
                    url="https://example.com/logo",
                    metadata_json={"format": "svg"},
                )
            )
            db.commit()

            self.assertTrue(db.query(Asset).all())
            self.assertTrue(db.query(Fact).all())
            self.assertTrue(db.query(Term).all())
            self.assertTrue(db.query(Guideline).all())
            db.refresh(term)
            self.assertEqual(term.guideline_id, guideline.id)

    def test_running_migration_twice_is_harmless(self):
        with self.engine.begin():
            ensure_model_schema(self.engine)


if __name__ == "__main__":
    unittest.main()
