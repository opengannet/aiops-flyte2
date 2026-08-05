import http from 'node:http'
import { spawn } from 'node:child_process'

const listenHost = process.env.HOSTNAME || '0.0.0.0'
const listenPort = Number.parseInt(process.env.PORT || '8080', 10)
const nextPort = Number.parseInt(process.env.NEXT_PORT || '3000', 10)
const apiOrigin =
  process.env.FLYTE_API_ORIGIN || 'http://flyte-binary-http.flyte.svc.cluster.local:8090'
const appProxyBaseDomain = (process.env.APP_PROXY_BASE_DOMAIN || '')
  .trim()
  .replace(/^\.+|\.+$/g, '')
  .toLowerCase()
const appProxyOrigin =
  process.env.APP_PROXY_TARGET_ORIGIN ||
  'http://kourier-internal.kourier-system.svc.cluster.local'

const nextProcess = spawn('node', ['server.js'], {
  env: {
    ...process.env,
    HOSTNAME: '127.0.0.1',
    PORT: String(nextPort),
  },
  stdio: 'inherit',
})

const hostWithoutPort = (host) => (host || '').split(':')[0].toLowerCase()

const appHostFromRequest = (req) => {
  if (!appProxyBaseDomain) {
    return ''
  }
  const host = hostWithoutPort(req.headers.host)
  const suffix = `.${appProxyBaseDomain}`
  if (!host.endsWith(suffix) || host.length <= suffix.length) {
    return ''
  }
  return host
}

const proxyRequest = (targetOrigin, req, res, options = {}) => {
  const target = new URL(req.url || '/', targetOrigin)
  const headers = {
    ...req.headers,
    host: options.hostOverride || target.host,
  }
  if (options.forwardedHost) {
    headers['x-forwarded-host'] = options.forwardedHost
  }
  const upstream = http.request(
    target,
    {
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    },
  )

  upstream.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`proxy error: ${err.message}`)
  })

  req.pipe(upstream)
}

const server = http.createServer((req, res) => {
  const path = req.url || '/'
  const appHost = appHostFromRequest(req)
  if (appHost) {
    proxyRequest(appProxyOrigin, req, res, {
      hostOverride: appHost,
      forwardedHost: req.headers.host,
    })
    return
  }

  if (path === '/favicon.ico') {
    res.writeHead(302, { location: '/v2/union-192x192.png' })
    res.end()
    return
  }

  if (
    path.startsWith('/flyteidl2.') ||
    path === '/healthz' ||
    path === '/readyz'
  ) {
    proxyRequest(apiOrigin, req, res)
    return
  }

  proxyRequest(`http://127.0.0.1:${nextPort}`, req, res)
})

const shutdown = () => {
  server.close()
  nextProcess.kill('SIGTERM')
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

nextProcess.on('exit', (code) => {
  if (code !== 0) {
    process.exit(code || 1)
  }
})

server.listen(listenPort, listenHost, () => {
  console.log(
    `flyte console proxy listening on ${listenHost}:${listenPort}, api=${apiOrigin}`,
  )
})
