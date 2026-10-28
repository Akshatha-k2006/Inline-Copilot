import unittest
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from app.config import settings
from app.dependencies import get_authenticated_principal


def make_request(host: str) -> Request:
    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/api/content",
            "raw_path": b"/api/content",
            "query_string": b"",
            "headers": [],
            "client": (host, 1234),
            "server": ("localhost", 8000),
        }
    )


class AuthenticationDependencyTests(unittest.TestCase):
    def test_production_rejects_spoofed_role_and_user_headers(self):
        with patch.object(settings, "app_env", "production"):
            with self.assertRaises(HTTPException) as raised:
                get_authenticated_principal(
                    make_request("203.0.113.8"),
                    x_role="admin",
                    x_user="attacker",
                )

        self.assertEqual(raised.exception.status_code, 401)
        self.assertEqual(
            raised.exception.detail["error"],
            "authentication_not_configured",
        )

    def test_development_role_headers_are_local_only(self):
        with patch.object(settings, "app_env", "development"):
            principal = get_authenticated_principal(
                make_request("127.0.0.1"),
                x_role="reviewer",
                x_user="local reviewer",
            )

            self.assertEqual(principal.role, "reviewer")
            self.assertEqual(principal.user, "local reviewer")

            with self.assertRaises(HTTPException) as raised:
                get_authenticated_principal(
                    make_request("203.0.113.8"),
                    x_role="admin",
                    x_user="remote caller",
                )

        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
