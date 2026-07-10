// Subsonic API error codes (subset of the official spec).
export const SubsonicErrorCode = {
  GENERIC: 0,
  MISSING_PARAM: 10,
  UNKNOWN_PARAM: 20,
  BAD_PARAM_VALUE: 30,
  UNAUTHORIZED: 40,
  NOT_AUTHENTICATED: 41,
  PERMISSION_DENIED: 50,
  NOT_FOUND: 70,
  NOT_ALLOWED: 80,
} as const;

export class SubsonicError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "SubsonicError";
    this.code = code;
  }
}

export function missingParam(name: string): SubsonicError {
  return new SubsonicError(SubsonicErrorCode.MISSING_PARAM, `Required parameter '${name}' is missing.`);
}

export function notFound(resource: string): SubsonicError {
  return new SubsonicError(SubsonicErrorCode.NOT_FOUND, `${resource} not found.`);
}
