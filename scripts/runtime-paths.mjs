import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const PROJECT=fileURLToPath(new URL('../',import.meta.url));
// All relative settings are anchored to the checkout, never a developer's home or cwd.
export const AGH_ROOT=resolve(PROJECT,process.env.AGH_ROOT||'.runtime/agnes-harness');
export const AGH_ACCOUNT_HOME=resolve(PROJECT,process.env.AGH_ACCOUNT_HOME||process.env.AGH_HOME||'.runtime/agh-account');
export const AGH_ACCOUNT_PROFILE=process.env.AGH_ACCOUNT_PROFILE||'local-dev';
