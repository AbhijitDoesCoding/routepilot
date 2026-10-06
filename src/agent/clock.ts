export class Clock {
  /**
   * Return the current time.
   */
  public now(): Date {
    return new Date();
  }

  /**
   * Return the timezone configured for the session/demo.
   */
  public getTimezone(): string {
    return process.env.DEFAULT_TIMEZONE || "Asia/Kolkata";
  }

  /**
   * Return the current ISO string.
   */
  public nowIso(): string {
    return this.now().toISOString();
  }
}
