import './reviewer-data.js';
import './exhibit-alts.js';
import './core.js';
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
window.RevAuthClient = url && key ? createClient(url, key) : null;
await import('./study-app.js');
