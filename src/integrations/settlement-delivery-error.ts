/** Collection must remain recoverable until its settlement intent is durable. */
export class SettlementNotPersistedError extends Error {
 readonly code='SETTLEMENT_NOT_PERSISTED';
 constructor(){super('Settlement intent could not be persisted; recover the same task without recollection.');}
}
