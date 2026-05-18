/**
 * Secret detectors. Pattern-based and intentionally conservative-but-broad: a false
 * positive only redacts a harmless string; a false negative leaks a credential to
 * disk. We bias toward over-redaction.
 *
 * `replace` receives the full match and must return the replacement, allowing
 * patterns (e.g. KEY=VALUE) to preserve a non-sensitive prefix for readability.
 */
export interface SecretPattern {
  /** Stable type tag used in audit details and the redaction placeholder. */
  readonly type: string;
  readonly regex: RegExp;
  readonly replace: (match: string, ...groups: string[]) => string;
}

const tag = (type: string): string => `«REDACTED:${type}»`;

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    type: 'PEM_PRIVATE_KEY',
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    replace: () => tag('PEM_PRIVATE_KEY'),
  },
  {
    type: 'AWS_ACCESS_KEY_ID',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: () => tag('AWS_ACCESS_KEY_ID'),
  },
  {
    type: 'GITHUB_TOKEN',
    regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
    replace: () => tag('GITHUB_TOKEN'),
  },
  {
    type: 'GITHUB_PAT',
    regex: /\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g,
    replace: () => tag('GITHUB_PAT'),
  },
  {
    type: 'GOOGLE_API_KEY',
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
    replace: () => tag('GOOGLE_API_KEY'),
  },
  {
    type: 'SLACK_TOKEN',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,72}\b/g,
    replace: () => tag('SLACK_TOKEN'),
  },
  {
    type: 'STRIPE_KEY',
    regex: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,99}\b/g,
    replace: () => tag('STRIPE_KEY'),
  },
  {
    type: 'RAZORPAY_KEY',
    regex: /\brzp_(?:live|test)_[0-9A-Za-z]{10,40}\b/g,
    replace: () => tag('RAZORPAY_KEY'),
  },
  {
    type: 'JWT',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: () => tag('JWT'),
  },
  {
    type: 'CONNECTION_STRING_CREDENTIALS',
    // scheme://user:password@host  →  redact only the credentials portion
    regex:
      /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?|rediss):\/\/)[^\s:@/]+:[^\s:@/]+@/gi,
    replace: (_m, scheme: string) => `${scheme}${tag('CONNECTION_CREDENTIALS')}@`,
  },
  {
    type: 'GENERIC_SECRET_ASSIGNMENT',
    // KEY = VALUE where KEY looks secret-shaped. Preserve the key for readability.
    regex:
      /\b([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|AUTH)[A-Za-z0-9_]*)\s*[:=]\s*["']?([^\s"',]{6,})["']?/gi,
    replace: (_m, key: string) => `${key}=${tag('GENERIC_SECRET')}`,
  },
];
