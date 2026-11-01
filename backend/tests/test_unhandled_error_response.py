import unittest

from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from starlette.middleware.cors import CORSMiddleware

from app.exception_handlers import (
    CatchUnhandledExceptionsMiddleware,
    register_exception_handlers,
)

FRONTEND_ORIGIN = "https://frontend.example"


def build_app() -> FastAPI:
    app = FastAPI()
    register_exception_handlers(app)
    # Same ordering as production: the catch-all runs inside the CORS
    # middleware so its responses can still carry CORS headers.
    app.add_middleware(CatchUnhandledExceptionsMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[FRONTEND_ORIGIN],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    router = APIRouter(prefix="/api")

    @router.get("/broken")
    def broken() -> dict:
        raise RuntimeError("simulated database failure")

    @router.get("/ok")
    def ok() -> dict:
        return {"status": "working"}

    app.include_router(router)
    return app


class CatchUnhandledExceptionsMiddlewareTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(build_app(), raise_server_exceptions=False)

    def test_unhandled_errors_get_json_and_cors_headers(self):
        response = self.client.get(
            "/api/broken", headers={"Origin": FRONTEND_ORIGIN}
        )
        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.headers.get("access-control-allow-origin"),
            FRONTEND_ORIGIN,
        )
        self.assertEqual(
            response.headers.get("content-type"), "application/json"
        )
        self.assertEqual(response.json()["error"], "internal_error")

    def test_successful_requests_pass_through(self):
        response = self.client.get(
            "/api/ok", headers={"Origin": FRONTEND_ORIGIN}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "working"})


if __name__ == "__main__":
    unittest.main()
