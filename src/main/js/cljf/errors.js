// An error whose message is meant for the user as it is: the CLI prints it
// without a stack trace.
export class LauncherError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'LauncherError';
  }
}
