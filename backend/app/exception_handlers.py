
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class CatchUnhandledExceptionsMiddleware:
    """Convert unhandled exceptions into JSON 500 responses.

    Unhandled exceptions are turned into responses after the middleware
    stack, and those responses cannot carry CORS headers, so every server
    side failure looks like a blocked CORS request in the browser. This
    middleware runs before the CORS middleware so error responses keep the
    CORS headers and the frontend can show the real HTTP status.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        try:
            await self.app(scope, receive, send)
        except Exception:
            response = JSONResponse(
                status_code=500,
                content={
                    "error": "internal_error",
                    "message": "The server could not complete the request.",
                },
            )
            await response(scope, receive, send)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_exception_handler(
        request: Request, exc: HTTPException
    ) -> JSONResponse:
        if isinstance(exc.detail, dict):
            error = exc.detail.get("error", "http_error")
            message = exc.detail.get("message", "Request failed.")
        else:
            error = {
                403: "forbidden",
                404: "not_found",
            }.get(exc.status_code, "http_error")
            message = str(exc.detail)

        return JSONResponse(
            status_code=exc.status_code,
            content={"error": error, "message": message},
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": "validation_error",
                "message": "The request data is invalid.",
            },
        )
