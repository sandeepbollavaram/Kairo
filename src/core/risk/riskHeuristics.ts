import type { RiskLevel } from '../../types/domain.js';

/**
 * Lightweight path-based risk inference used when the agent does not declare a risk
 * level explicitly. This is the seed of the v0.3 risk engine; kept deliberately small
 * and path-only here. Bias: when unsure, do not under-rate.
 */
const HIGH = [
  /(^|\/)(auth|authn|authz|login|session|password|credential)/i,
  /(payment|billing|invoice|stripe|razorpay|paypal|checkout)/i,
  /(^|\/)(infra|terraform|k8s|kubernetes|helm|deploy|ops)/i,
  /(security|secret|crypto|signing|token)/i,
  /(prod|production).*(config|env)|(config|env).*(prod|production)/i,
  /\.env(\.|$)/i,
  /(^|\/)Dockerfile$|docker-compose/i,
];

const MEDIUM = [
  /(^|\/)(api|routes?|controllers?|handlers?|graphql|grpc)/i,
  /(schema|migration|migrations|prisma|models?)/i,
  /(^|\/)(middleware|interceptors?)/i,
  /\.(sql)$/i,
  /(ci|workflow|github\/workflows)/i,
];

const LOW = [/(readme|\.md$|docs?\/|changelog|license)/i, /(^|\/)(test|tests|__tests__|spec)/i];

export function inferRisk(path: string): RiskLevel {
  if (HIGH.some((r) => r.test(path))) return 'high';
  if (MEDIUM.some((r) => r.test(path))) return 'medium';
  if (LOW.some((r) => r.test(path))) return 'low';
  return 'low';
}

const ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return ORDER[a] >= ORDER[b] ? a : b;
}
