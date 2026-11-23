class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
module.exports = { HttpError, httpError: (status, message) => new HttpError(status, message) };
