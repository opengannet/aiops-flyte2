import http from 'node:http'
import { spawn } from 'node:child_process'

const listenHost = process.env.HOSTNAME || '0.0.0.0'
const listenPort = Number.parseInt(process.env.PORT || '8080', 10)
const nextPort = Number.parseInt(process.env.NEXT_PORT || '3000', 10)
const apiOrigin =
  process.env.FLYTE_API_ORIGIN || 'http://flyte-binary-http.flyte.svc.cluster.local:8090'

const nextProcess = spawn('node', ['server.js'], {
  env: {
    ...process.env,
    HOSTNAME: '127.0.0.1',
    PORT: String(nextPort),
  },
  stdio: 'inherit',
})

const proxyRequest = (targetOrigin, req, res) => {
  const target = new URL(req.url || '/', targetOrigin)
  const upstream = http.request(
    target,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: target.host,
      },
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
