/** Every failure the API returns on purpose flows through this class. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: { path: string; message: string }[]) =>
  new AppError(400, 'bad_request', message, details);

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'unauthorized', message);

/**
 * Used for resources owned by another user as well as ones that do not exist -- a 403
 * would confirm the id is real, which is a needless disclosure.
 */
export const notFound = (resource = 'Resource') =>
  new AppError(404, 'not_found', `${resource} not found`);

export const conflict = (message: string) => new AppError(409, 'conflict', message);

export const unprocessable = (message: string, details?: { path: string; message: string }[]) =>
  new AppError(422, 'unprocessable_entity', message, details);
