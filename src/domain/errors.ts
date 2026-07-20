export type DomainErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_AUTHORIZED'
  | 'PRICE_FIELD_FORBIDDEN'
  | 'UNKNOWN_FIELD'
  | 'DUPLICATE_REQUIRES_CONFIRMATION'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_JOIN_CODE'
  | 'REVOKED_JOIN_CODE'
  | 'EXPIRED_JOIN_CODE'
  | 'EXHAUSTED_JOIN_CODE'
  | 'ALREADY_A_MEMBER'
  | 'MEMBERSHIP_SUSPENDED'
  | 'NO_SHARED_COMMUNITY'
  | 'USER_BLOCKED';

/** A safe, serializable error for API/server-action boundaries. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
