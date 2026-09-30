import {createClient} from '@supabase/supabase-js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') return response.status(405).json({error:'Use POST.'});

  const url = process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) return response.status(503).json({error:'Account deletion is not configured yet.'});

  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || '');
  if (!match) return response.status(401).json({error:'Sign in before deleting your account.'});

  try {
    const publicClient = createClient(url, publishableKey, {auth:{persistSession:false,autoRefreshToken:false}});
    const {data, error} = await publicClient.auth.getUser(match[1]);
    if (error || !data.user) return response.status(401).json({error:'Your session expired. Sign in again.'});

    const admin = createClient(url, secretKey, {auth:{persistSession:false,autoRefreshToken:false}});
    const deleted = await admin.auth.admin.deleteUser(data.user.id);
    if (deleted.error) throw deleted.error;
    return response.status(200).json({deleted:true});
  } catch {
    return response.status(500).json({error:'Account deletion failed. Please retry later.'});
  }
}
