import "server-only";import {createClient} from "@supabase/supabase-js";import {env} from "./env";
export function db(){const e=env();return createClient(e.SUPABASE_URL,e.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})}
