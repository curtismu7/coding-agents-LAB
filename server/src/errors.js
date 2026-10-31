// A bad request from the caller: becomes a short 400 JSON, never a stack trace.
export class InputError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
