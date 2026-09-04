/**
 * Admin now resolves from the deployment environment, never from a table the
 * customer can write. The implementation moved to lib/privileges.ts, which
 * explains why; this file stays so existing imports keep working.
 */
export { isAdmin } from "@/lib/privileges";
