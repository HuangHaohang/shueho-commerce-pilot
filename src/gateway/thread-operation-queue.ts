export class ThreadOperationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(threadId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(task);
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(threadId, tail);
    try {
      return await operation;
    } finally {
      if (this.tails.get(threadId) === tail) {
        this.tails.delete(threadId);
      }
    }
  }

  clear(): void {
    this.tails.clear();
  }
}
