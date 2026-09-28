import type { z } from 'zod';
import { unprocessable } from './errors.ts';

/** Parses untrusted input, turning Zod issues into the API's error envelope. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const details = result.error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  const summary = details[0]
    ? `${details[0].path}: ${details[0].message}`
    : 'Request validation failed';
  throw unprocessable(summary, details);
}
