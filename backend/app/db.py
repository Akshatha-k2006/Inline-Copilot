from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def migrate_review_schema(bind: Engine = engine) -> None:
    with bind.begin() as connection:
        inspector = inspect(connection)
        tables = inspector.get_table_names()
        if "findings" not in tables:
            findings_columns = set()
        else:
            findings_columns = {
                column["name"] for column in inspector.get_columns("findings")
            }

        if "findings" in tables and "content_version" not in findings_columns:
            connection.execute(
                text(
                    "ALTER TABLE findings ADD COLUMN "
                    "content_version INTEGER NOT NULL DEFAULT 1"
                )
            )
        if "content" in tables:
            content_columns = {
                column["name"] for column in inspector.get_columns("content")
            }
            if "content_type" not in content_columns:
                connection.execute(
                    text(
                        "ALTER TABLE content ADD COLUMN "
                        "content_type VARCHAR(100) NOT NULL DEFAULT 'marketing_copy'"
                    )
                )
            if "reviewed_version" not in content_columns:
                connection.execute(
                    text("ALTER TABLE content ADD COLUMN reviewed_version INTEGER")
                )
            if "reviewed_at" not in content_columns:
                connection.execute(
                    text("ALTER TABLE content ADD COLUMN reviewed_at TIMESTAMP")
                )
        if "terms" in tables:
            term_columns = {
                column["name"] for column in inspector.get_columns("terms")
            }
            if "guideline_id" not in term_columns:
                connection.execute(
                    text(
                        "ALTER TABLE terms ADD COLUMN guideline_id INTEGER "
                        "REFERENCES guidelines(id) ON DELETE SET NULL"
                    )
                )
        if "facts" in tables:
            fact_columns = {
                column["name"] for column in inspector.get_columns("facts")
            }
            if "last_reviewed" not in fact_columns:
                connection.execute(
                    text("ALTER TABLE facts ADD COLUMN last_reviewed TIMESTAMP")
                )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
