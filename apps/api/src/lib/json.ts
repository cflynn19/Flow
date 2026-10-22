/**
 * Replaces every `\u0000` escape in raw JSON text with `�`, the replacement
 * character.
 *
 * PostgreSQL cannot store U+0000 in `text` or `jsonb`, so a single NUL anywhere in a
 * request -- a step's output, an error message, even an object key -- would fail the
 * insert and turn a valid request into a 500. JSON can only carry a NUL as that escape
 * (a raw control character is not valid JSON), so rewriting the text before it is
 * parsed catches every one without walking the parsed value.
 *
 * A backslash run of odd length ends in the escape's own backslash; an even run is
 * escaped backslashes followed by the literal text "u0000", which is left alone.
 */
export function replaceNullEscapes(text: string): string {
  if (!text.includes('u0000')) return text;
  return text.replace(/(\\+)u0000/g, (match, slashes: string) =>
    slashes.length % 2 === 1 ? `${slashes.slice(0, -1)}\\ufffd` : match,
  );
}
