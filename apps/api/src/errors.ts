export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown, public code?: string) { super(message); }
}
export const bad = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Sign in first.', code?: string) => new HttpError(401, msg, undefined, code);
export const forbidden = (msg = 'You do not have access to this.', code?: string) => new HttpError(403, msg, undefined, code);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const conflict = (msg: string, details?: unknown, code?: string) => new HttpError(409, msg, details, code);
export const locked = (msg: string) => new HttpError(423, msg);
