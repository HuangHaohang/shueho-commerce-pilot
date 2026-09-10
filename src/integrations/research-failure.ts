import {ExternalDataControlError} from './external-data-control-client.js';
/** Deterministic governance refusals are actionable failures, not uncertain provider results. */
export function permanentResearchFailure(error:unknown):Record<string,any>|null{
 if(error instanceof ExternalDataControlError&&error.status>=400&&error.status<500){
  return {success:false,error:{code:error.code,message:error.message,details:error.details}};
 }
 return null;
}
