export type PendingSteerState = {
  threadId: string;
  turnId: string;
  queuedSubmissionId: string;
  clientUserMessageId: string;
  content: string;
  sequence: number;
};

export type NewPendingSteerState = Omit<PendingSteerState, "sequence">;

export class PendingSteerRegistry {
  private readonly states = new Map<string, PendingSteerState>();
  private sequence = 0;

  add(input: NewPendingSteerState): PendingSteerState {
    if (this.states.has(input.clientUserMessageId)) {
      throw new Error(`Pending steer ${input.clientUserMessageId} already exists.`);
    }
    const state = { ...input, sequence: ++this.sequence };
    this.states.set(state.clientUserMessageId, state);
    return state;
  }

  hydrate(states: PendingSteerState[]): void {
    this.states.clear();
    this.sequence = 0;
    for (const state of [...states].sort((left, right) => left.sequence - right.sequence)) {
      if (this.states.has(state.clientUserMessageId)) {
        continue;
      }
      this.states.set(state.clientUserMessageId, state);
      this.sequence = Math.max(this.sequence, state.sequence);
    }
  }

  snapshot(): PendingSteerState[] {
    return [...this.states.values()].sort((left, right) => left.sequence - right.sequence);
  }

  hasClientId(clientUserMessageId: string): boolean {
    return this.states.has(clientUserMessageId);
  }

  hasQueuedSubmission(threadId: string, queuedSubmissionId: string): boolean {
    return this.list(threadId).some((state) => state.queuedSubmissionId === queuedSubmissionId);
  }

  list(threadId: string): PendingSteerState[] {
    return [...this.states.values()]
      .filter((state) => state.threadId === threadId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  acknowledgeFront(threadId: string, clientUserMessageId: string): PendingSteerState | null {
    const front = this.list(threadId)[0];
    if (!front || front.clientUserMessageId !== clientUserMessageId) {
      return null;
    }
    this.states.delete(front.clientUserMessageId);
    return front;
  }

  delete(clientUserMessageId: string): boolean {
    return this.states.delete(clientUserMessageId);
  }
}

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
