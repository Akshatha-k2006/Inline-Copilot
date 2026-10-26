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
            return

        columns = {column["name"] for column in inspector.get_columns("findings")}
        if "content_version" not in columns:
            connection.execute(
                text(
                    "ALTER TABLE findings ADD COLUMN "
                    "content_version INTEGER NOT NULL DEFAULT 1"
                )
            )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
