import './reviewer-data.js';
import './exhibit-alts.js';
import './core.js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
window.RevAuthClient = null;
if (url && key) {
  const {createClient} = await import('@supabase/supabase-js');
  window.RevAuthClient = createClient(url, key);
}
await import('./study-app.js');
