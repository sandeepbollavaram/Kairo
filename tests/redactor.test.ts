import { describe, it, expect } from 'vitest';
import { sanitize, redactString } from '../src/security/redactor.js';

describe('redactor', () => {
  it('redacts AWS access key ids', () => {
    const { value, findings } = redactString('key AKIAIOSFODNN7EXAMPLE here');
    expect(value).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(value).toContain('«REDACTED:AWS_ACCESS_KEY_ID»');
    expect(findings.AWS_ACCESS_KEY_ID).toBe(1);
  });

  it('redacts GitHub tokens and PATs', () => {
    const r1 = redactString(`ghp_${'a'.repeat(36)}`);
    expect(r1.value).toBe('«REDACTED:GITHUB_TOKEN»');
    const r2 = redactString(`github_pat_${'B'.repeat(30)}`);
    expect(r2.value).toBe('«REDACTED:GITHUB_PAT»');
  });

  it('redacts Google/Firebase keys, Stripe, Razorpay, JWTs', () => {
    expect(redactString(`AIza${'x'.repeat(35)}`).value).toBe('«REDACTED:GOOGLE_API_KEY»');
    expect(redactString(`sk_live_${'1'.repeat(24)}`).value).toBe('«REDACTED:STRIPE_KEY»');
    expect(redactString(`rzp_live_${'a'.repeat(14)}`).value).toBe('«REDACTED:RAZORPAY_KEY»');
    expect(redactString('eyJhbGciOiJI.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4').value).toBe(
      '«REDACTED:JWT»',
    );
  });

  it('redacts PEM private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIBmin\nbody\n-----END RSA PRIVATE KEY-----';
    expect(redactString(pem).value).toBe('«REDACTED:PEM_PRIVATE_KEY»');
  });

  it('redacts credentials inside connection strings but keeps the scheme', () => {
    const { value } = redactString('postgres://admin:s3cretP@db.internal:5432/app');
    expect(value).toContain('postgres://');
    expect(value).not.toContain('s3cretP');
    expect(value).toContain('«REDACTED:CONNECTION_CREDENTIALS»');
  });

  it('redacts secret-shaped KEY=VALUE while preserving the key name', () => {
    const { value } = redactString('DATABASE_PASSWORD=hunter2hunter');
    expect(value).toBe('DATABASE_PASSWORD=«REDACTED:GENERIC_SECRET»');
  });

  it('walks nested objects and arrays, leaving non-secret data intact', () => {
    const input = {
      task: 'normal text',
      nested: { token: `ghp_${'z'.repeat(36)}`, list: ['safe', 'API_KEY=abcdef123'] },
      count: 42,
    };
    const { value, findings, redacted } = sanitize(input);
    expect(redacted).toBe(true);
    expect(value.task).toBe('normal text');
    expect(value.count).toBe(42);
    expect(value.nested.token).toBe('«REDACTED:GITHUB_TOKEN»');
    expect(value.nested.list[1]).toContain('«REDACTED:GENERIC_SECRET»');
    expect(findings.GITHUB_TOKEN).toBeGreaterThanOrEqual(1);
  });

  it('reports no findings for clean input', () => {
    const { redacted } = sanitize({ a: 'hello world', b: [1, 2, 3] });
    expect(redacted).toBe(false);
  });
});
