// Copies the shared calculation code into the Supabase functions folder,
// so the server (Monday summary, AI assistant) uses exactly the same numbers
// as the app. Run before deploying functions: npm run sync-core
import { cpSync, rmSync, mkdirSync } from 'node:fs';
const src = new URL('../packages/core/src/', import.meta.url);
const dest = new URL('../supabase/functions/_shared/core/', import.meta.url);
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('Copied packages/core/src -> supabase/functions/_shared/core');
