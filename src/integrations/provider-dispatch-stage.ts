export class ProviderNotDispatchedError extends Error {
 readonly code='PROVIDER_NOT_DISPATCHED';
 readonly uncertain=false;
 constructor(readonly reasonCode:string){super('Provider request was blocked before dispatch.');}
}
export function notDispatchedPayload(error:ProviderNotDispatchedError){return {
 success:false,provider_completed:false,dispatch_phase:'not_dispatched',
 error:{code:error.code,message:error.message,details:{reasonCode:error.reasonCode,providerDispatched:false}},
};}
