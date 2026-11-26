import { Elysia } from "elysia";

export class DomainError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = "Authentication required.") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Insufficient permissions.") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Resource not found.") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends DomainError {
  constructor(message = "Resource conflict.") {
    super(409, "CONFLICT", message);
  }
}

export class UnprocessableError extends DomainError {
  constructor(message = "Unprocessable request.") {
    super(422, "UNPROCESSABLE", message);
  }
}

export class UnavailableError extends DomainError {
  constructor(message = "Service temporarily unavailable.") {
    super(503, "UNAVAILABLE", message);
  }
}

export const createErrorPlugin = (onUnexpectedError?: (error: unknown) => void) =>
  new Elysia({ name: "mux-errors" }).onError({ as: "global" }, ({ code, error, set }) => {
    if (error instanceof DomainError) {
      set.status = error.statusCode;

      return {
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    if (code === "PARSE") {
      set.status = 400;

      return {
        error: {
          code: "BAD_REQUEST",
          message: "Malformed request body.",
        },
      };
    }

    if (code === "VALIDATION") {
      set.status = 422;

      return {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
        },
      };
    }

    if (code === "NOT_FOUND") {
      set.status = 404;

      return {
        error: {
          code: "NOT_FOUND",
          message: "Route not found.",
        },
      };
    }

    if (onUnexpectedError) {
      try {
        onUnexpectedError(error);
      } catch {
        void error;
      }
    }

    set.status = 500;

    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      },
    };
  });

export const errorPlugin = createErrorPlugin((error) => {
  console.error("Unhandled API error:", error);
});
