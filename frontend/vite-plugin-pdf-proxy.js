// vite-plugin-pdf-proxy.js
import https from 'node:https';
import http from 'node:http';

export default function pdfProxyPlugin() {
  return {
    name: 'comelit-pdf-proxy',
    
    configureServer(server) {
      console.log('\n  🔌 [PDF-PROXY] Plugin loaded — /proxy-pdf ready\n');
      
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/proxy-pdf')) return next();

        const urlObj = new URL(req.url, 'http://localhost');
        const pdfUrl = urlObj.searchParams.get('url');
        if (!pdfUrl) {
          res.writeHead(400); res.end('Missing url'); return;
        }

        console.log('[PDF-PROXY] →', pdfUrl);

        const doFetch = (fetchUrl) => {
          const c = fetchUrl.startsWith('https') ? https : http;
          c.get(fetchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/pdf,*/*' }
          }, (upstream) => {
            if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
              doFetch(upstream.headers.location); return;
            }
            if (upstream.statusCode !== 200) {
              res.writeHead(upstream.statusCode); res.end('HTTP ' + upstream.statusCode); return;
            }
            const chunks = [];
            upstream.on('data', (c) => chunks.push(c));
            upstream.on('end', () => {
              const buf = Buffer.concat(chunks);
              if (buf.slice(0, 5).toString() === '%PDF-') {
                console.log('[PDF-PROXY] ✅', (buf.length / 1024).toFixed(0), 'KB');
                res.writeHead(200, {
                  'Content-Type': 'application/pdf',
                  'Content-Length': buf.length,
                  'Access-Control-Allow-Origin': '*',
                });
                res.end(buf);
              } else {
                console.warn('[PDF-PROXY] ❌ Not PDF');
                res.writeHead(404); res.end('Not PDF');
              }
            });
          }).on('error', (e) => {
            console.error('[PDF-PROXY] Error:', e.message);
            res.writeHead(502); res.end('Error');
          });
        };

        doFetch(pdfUrl);
      });
    }
  };
}
