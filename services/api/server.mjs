// Compatibility constructor only. All live API behavior uses the authenticated domain server.
import {createApp} from './domain-server.mjs';
export {createApp};
export function createHealthThreadServer(options={}){const {databasePath,...rest}=options;return createApp({...rest,...(databasePath?{dbPath:databasePath}:{})});}
