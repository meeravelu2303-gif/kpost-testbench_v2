/** Signatures of information that must never reach an API client. Shared by security validators. */
export const LEAK_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  {
    name: 'stack trace',
    pattern:
      /\bat\s+[\w$.<>]+\s+\([^()]+:\d+:\d+\)|Traceback \(most recent call last\)|Exception in thread|\.java:\d+\)/,
  },
  {
    name: 'SQL error',
    pattern:
      /SQL syntax|SQLSTATE|ORA-\d{5}|syntax error at or near|unterminated quoted string|SqlException|PG::\w+Error/i,
  },
  {
    name: 'SQL query',
    pattern:
      /\bSELECT\s+[\w*,\s.]+\s+FROM\s+\w+|\bINSERT\s+INTO\s+\w+|\bUPDATE\s+\w+\s+SET\s|\bDELETE\s+FROM\s+\w+/i,
  },
  { name: 'NoSQL error', pattern: /MongoError|MongoServerError|CastError: Cast to/ },
  {
    name: 'filesystem path',
    pattern:
      /[A-Za-z]:\\(?:[\w.-]+\\)+|(?<![\w.])\/(?:home|var|usr|opt|srv|etc)\/[\w./-]+|node_modules[\\/]/,
  },
  { name: 'connection string', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:[^@\s]+@/i },
  {
    name: 'credential assignment',
    pattern: /\b(?:password|passwd|pwd|secret)\s*[=:]\s*[^\s,"}]+/i,
  },
  { name: 'private key', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
];

export function findLeaks(text: string): string[] {
  return LEAK_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}
