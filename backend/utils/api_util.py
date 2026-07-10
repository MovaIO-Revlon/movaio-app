import logging
import sys
import traceback

from flask import Flask, jsonify


def buildResponse(message: str = "OK", data=None, status: int = 200):
    return jsonify({"success": True, "message": message, "data": data}), status


class ApiError(Exception):
    def __init__(self, message: str = "error", error=None, status: int = 400):
        self.message = message
        self.status = status
        self.error = error
        super().__init__(message)


class AuthorizationError(ApiError):
    def __init__(self, message: str = "Authorization Error", data=None):
        super().__init__(message, data, 401)


class NotFoundError(ApiError):
    def __init__(self, message: str = "Not Found"):
        super().__init__(message, None, 404)


class ValidationError(ApiError):
    def __init__(self, message: str = "Invalid Input", data=None):
        super().__init__(message, data, 400)


def handle_api_error(err: ApiError):
    return jsonify(
        {"success": False, "message": err.message, "error": str(err.error)}
    ), err.status


def handle_exception(app: Flask, err: Exception):
    exc_type, exc_value, exc_traceback = sys.exc_info()
    stack_list = traceback.format_exception(exc_type, exc_value, exc_traceback)
    full_stack = "".join(stack_list)
    error = str(err)
    logging.error(f"{error}: {full_stack}")

    response = {
        "success": False,
        "message": error or "Internal Server Error",
        "error": full_stack,
    }

    if app.debug:
        response["details"] = full_stack

    return jsonify(response), 500
