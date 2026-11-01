from sqlalchemy import JSON, Boolean, Integer, String, Text, create_engine, inspect, text
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


def _backfill_default(column) -> str | None:
    """SQL literal used to backfill existing rows when adding a column."""
    if isinstance(column.type, (String, Text)):
        return "''"
    if isinstance(column.type, (Integer, Boolean)):
        return "0"
    if isinstance(column.type, JSON):
        return "'{}'"
    return None


def ensure_model_schema(bind: Engine = engine) -> None:
    """Add model columns that the database tables do not have yet.

    `create_all` creates missing tables but never alters existing ones, so
    a database created by an older app version keeps running without the
    columns the current models select, and every query touching them fails.
    Missing columns are added as nullable backfilled columns; leaving out
    the NOT NULL constraint does not affect ORM reads or writes because the
    ORM always supplies values for them.
    """
    with bind.begin() as connection:
        inspector = inspect(connection)
        tables = set(inspector.get_table_names())
        preparer = connection.dialect.identifier_preparer
        for table in Base.metadata.sorted_tables:
            if table.name not in tables:
                continue
            existing_columns = {
                column["name"] for column in inspector.get_columns(table.name)
            }
            for column in table.columns:
                if column.name in existing_columns:
                    continue
                statement = (
                    f"ALTER TABLE {preparer.format_table(table)} "
                    f"ADD COLUMN {preparer.format_column(column)} "
                    f"{column.type.compile(connection.dialect)}"
                )
                for foreign_key in column.foreign_keys:
                    referenced_table, referenced_column = (
                        foreign_key.target_fullname.split(".", maxsplit=1)
                    )
                    statement += (
                        f" REFERENCES {preparer.quote(referenced_table)}"
                        f"({preparer.quote(referenced_column)})"
                    )
                    if foreign_key.ondelete:
                        statement += f" ON DELETE {foreign_key.ondelete}"
                default = (
                    _backfill_default(column)
                    if not column.nullable and not column.foreign_keys
                    else None
                )
                if default is not None:
                    statement += f" DEFAULT {default}"
                connection.execute(text(statement))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
