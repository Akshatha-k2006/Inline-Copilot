
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


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
