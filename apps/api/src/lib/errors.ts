export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, "bad_request", message, details);

export const unauthorized = (message = "No autenticado") =>
  new HttpError(401, "unauthorized", message);

export const forbidden = (message = "No autorizado") => new HttpError(403, "forbidden", message);

export const notFound = (message = "Recurso no encontrado") =>
  new HttpError(404, "not_found", message);

export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, "conflict", message, details);

export const tooManyRequests = (message = "Demasiadas peticiones") =>
  new HttpError(429, "rate_limited", message);

export const serviceUnavailable = (message = "Servicio no disponible") =>
  new HttpError(503, "service_unavailable", message);
