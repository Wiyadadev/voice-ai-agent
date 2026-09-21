import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CallService, snapshot } from './core.js';
import { configuredServiceOptions } from './providers.js';

export function createServer(service = new CallService(...configuredServiceOptions())) {
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) return json(403, { error: 'Use the 127.0.0.1 address shown at startup' });
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: 'Cross-origin request blocked' });
      if (req.method === 'GET' && ['/','/app.js','/style.css'].includes(req.url)) {
        const file = req.url === '/' ? 'index.html' : req.url.slice(1);
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'text/css');
        return res.end(await readFile(new URL(`./public/${file}`, import.meta.url)));
      }
      if (req.method === 'GET' && req.url === '/health') return json(200, { status: 'ok', sandbox: true });
      if (req.method === 'POST' && req.headers['content-type'] !== 'application/json') return json(415, { error: 'Use application/json' });
      let body = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 10000) return json(413, { error: 'Request too large' }); }
        try { body = JSON.parse(raw || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
      }
      if (req.method === 'POST' && req.url === '/api/calls') return json(201, service.start());
      const match = req.url.match(/^\/api\/calls\/([a-f0-9-]+)(?:\/(turn|end))?$/);
      if (!match) return json(404, { error: 'Not found' });
      const [, id, action] = match;
      if (req.method === 'GET' && !action) return json(200, snapshot(service.store.get(id)));
      if (req.method === 'DELETE' && !action) { service.store.delete(id); return json(200, { deleted: true }); }
      if (req.method === 'POST' && action === 'turn') return json(200, await service.turn(id, body.text));
      if (req.method === 'POST' && action === 'end') return json(200, await service.end(id));
      return json(405, { error: 'Method not allowed' });
    } catch (e) {
      const safe = /^(Call |Enter |Sandbox )/.test(e.message);
      return json(safe ? 409 : 502, { error: safe ? e.message : 'Provider response could not be accepted. The previous call state is preserved; please try again.' });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3030);
  createServer().listen(port, '127.0.0.1', () => console.log(`VYADA sandbox: http://127.0.0.1:${port}`));
}
