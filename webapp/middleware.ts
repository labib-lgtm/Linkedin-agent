// Auth bypassed: webapp is intentionally open. Anyone with the URL can access.
// Protection comes from keeping the production URL private. If we add real auth
// later, restore the imports + updateSession() call from lib/supabase/middleware.ts.

export const config = {
  matcher: [],
};
