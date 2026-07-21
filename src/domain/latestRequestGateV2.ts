/** Invalidates stale asynchronous completions after auth/account transitions. */
export class LatestRequestGateV2 {
  private version = 0;

  begin(): () => boolean {
    const requestVersion = ++this.version;
    return () => this.version === requestVersion;
  }

  invalidate(): void {
    this.version += 1;
  }
}
