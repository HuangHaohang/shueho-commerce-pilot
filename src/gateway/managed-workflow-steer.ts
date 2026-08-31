export type ManagedWorkflowSteerTransition<T> = {
  result: T | { turnId: string };
  alreadyCommitted: boolean;
};

export async function dispatchManagedWorkflowSteer<T>(input: {
  findCommittedTurnId: () => Promise<string | null>;
  assertExpectedTurnActive: () => Promise<void>;
  dispatch: () => Promise<T>;
  findCommittedTurnIdAfterFailure: () => Promise<string | null>;
}): Promise<ManagedWorkflowSteerTransition<T>> {
  const committedTurnId = await input.findCommittedTurnId();
  if (committedTurnId) {
    return { result: { turnId: committedTurnId }, alreadyCommitted: true };
  }

  await input.assertExpectedTurnActive();
  try {
    return { result: await input.dispatch(), alreadyCommitted: false };
  } catch (error) {
    const acceptedTurnId = await input.findCommittedTurnIdAfterFailure();
    if (acceptedTurnId) {
      return { result: { turnId: acceptedTurnId }, alreadyCommitted: true };
    }
    throw error;
  }
}
