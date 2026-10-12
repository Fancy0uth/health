import {randomUUID} from 'node:crypto';
export class DomainError extends Error {
 constructor(status,code,message,details){super(message);Object.assign(this,{status,code,details});}
}
export function fail(status,code,message=code,details){throw new DomainError(status,code,message,details);}
export function check(condition,code='VALIDATION_ERROR',status=400){if(!condition)fail(status,code);}
export function errorBody(error,phase='request',requestId=randomUUID()) {return {error:{code:error.status?error.code:'INTERNAL_ERROR',message:error.status?error.message:'服务暂时不可用。',request_id:requestId,phase,retryable:['QUEUE_BUSY','DEPENDENCY_UNAVAILABLE'].includes(error.code),...(error.details?{details:error.details}:{})}};}
export const LIMITS=Object.freeze({textBytes:100_000,uploadBytes:5_000_000,pdfPages:30,pdfTextBytes:150_000,bodyBytes:7_000_000,queueDepth:100,userQueueDepth:10,concurrency:2,userConcurrency:1,deadlineMs:120_000,scopeTtlMs:600_000,sessionTtlMs:28_800_000,outputBytes:150_000,retrievalCount:100,loginAttempts:10,loginWindowMs:900_000,dispatchMaxAttempts:3,dispatchBackoffMs:250,dispatchBackoffMaxMs:5000});
