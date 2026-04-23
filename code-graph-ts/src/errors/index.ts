// Agent Error types — no enum (erasableSyntaxOnly: true)

const ErrorCode = {
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  PARSE_FAILED: 'PARSE_FAILED',
  LLM_RATE_LIMIT: 'LLM_RATE_LIMIT',
  TIMEOUT: 'TIMEOUT',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  INVALID_REPOSITORY: 'INVALID_REPOSITORY',
  NO_FILES_FOUND: 'NO_FILES_FOUND',
  LLM_API_ERROR: 'LLM_API_ERROR',
} as const;

type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// Recoverable errors: the pipeline can continue (skip/retry)
const RECOVERABLE_CODES: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.FILE_TOO_LARGE,
  ErrorCode.PARSE_FAILED,
  ErrorCode.LLM_RATE_LIMIT,
  ErrorCode.TIMEOUT,
] as const);

class AgentError extends Error {
  readonly code: ErrorCode;
  readonly agent: string;
  readonly recoverable: boolean;
  readonly context?: unknown;

  constructor(
    code: ErrorCode,
    agent: string,
    recoverable: boolean,
    context?: unknown,
  ) {
    const message = `[${code}] agent=${agent}${recoverable ? ' (recoverable)' : ''}`;
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.agent = agent;
    this.recoverable = recoverable;
    this.context = context;
  }

  static isRecoverable(code: ErrorCode): boolean {
    return RECOVERABLE_CODES.has(code);
  }
}

export { ErrorCode, RECOVERABLE_CODES, AgentError };
export type { ErrorCode as ErrorCodeType };
