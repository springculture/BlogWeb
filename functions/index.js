export async function onRequest(context) {
  const { request, env } = context;

  const assetResponse = await env.ASSETS.fetch(request);
  if (!assetResponse.ok) return assetResponse;

  let html = await assetResponse.text();

  try {
    const { results } = await env.DB.prepare('SELECT * FROM content').all();
    const safe = JSON.stringify(results).replace(/<\/script>/gi, '<\\/script>');
    html = html.replace('</head>', `<script>window.__INITIAL_CONTENT__=${safe};<\/script></head>`);
  } catch {}

  return new Response(html, {
    headers: { 'content-type': 'text/html;charset=UTF-8' }
  });
}
