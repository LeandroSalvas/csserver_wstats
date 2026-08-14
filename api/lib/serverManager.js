// Gerenciamento de servidores: adapter flexível (SERVER_MANAGER_PROVIDER).
// Provider "docker" controla os containers via docker CLI + socket montado no
// container da API, e provisiona (add/remove) reutilizando scripts/servers.sh
// dentro de um container descartável.
//
// O container api precisa de: /var/run/docker.sock, repo em SERVER_REPO_DIR (rw)
// e imagem `csserver_wstats-api` com docker CLI + compose plugin instalados.
//
// A API lê config/servers.list em runtime (serverCtx), então o serviço api é
// ESTÁTICO no compose — add/remove rodam provision/unprovision cirúrgicos
// (up --no-recreate) que criam/removem só o container do servidor alvo, sem
// recriar a stack inteira.

const { execFile } = require('child_process')
const fs = require('fs')
const path = require('path')

const { serverManagerProvider, serverRepoDir } = require('./config')

const PROVISION_IMAGE = process.env.SERVER_MANAGER_IMAGE || 'csserver_wstats-api'
const PROVISION_TIMEOUT_MS = parseInt(process.env.SERVER_MANAGER_TIMEOUT_MS || '240000', 10)

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      timeout: opts.timeout || 30000,
      maxBuffer: 20 * 1024 * 1024,
      cwd: opts.cwd || serverRepoDir,
      env: opts.env || process.env
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || stdout || err.message || '').trim().split('\n').slice(-8).join('\n')))
        return
      }
      resolve(stdout || '')
    })
  })
}

function slugifyName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isValidId(id) {
  return /^[a-z0-9][a-z0-9_-]*$/.test(String(id || ''))
}

// --- config/servers.list (fonte de verdade, montada no container) ---

function serversListPath() {
  return path.join(serverRepoDir, 'config', 'servers.list')
}

function readServersList() {
  const file = serversListPath()
  if (!fs.existsSync(file)) return []
  const servers = []
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  for (const line of lines) {
    const parts = String(line).trim().split(/\s+/)
    if (!parts[0] || parts[0].startsWith('#')) continue
    const [id, name, host_port, map, maxplayers, rotate = 'yes', context = slugifyName(name)] = parts
    servers.push({ id, name, host_port, map, maxplayers, rotate, context })
  }
  return servers
}

function writeServersList(servers, header) {
  const file = serversListPath()
  let preservedHeader = null
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `${file}.bak`)
    // Preserva os comentários (#) do arquivo existente (docs do setup.sh).
    preservedHeader = fs.readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('#'))
      .join('\n')
  }
  const rows = servers.map((s) =>
    `${s.id} ${s.name} ${s.host_port} ${s.map} ${s.maxplayers} ${s.rotate} ${s.context}`
  )
  const content = [
    preservedHeader || header || `# Lista de servidores CS 1.6 gerenciados pelo docker-compose.`,
    ...rows,
    ''
  ].join('\n')
  fs.writeFileSync(file, content, { mode: 0o644 })
}

function nextFreePort(servers, start = 27016) {
  const used = new Set(servers.map((s) => s.host_port))
  let port = start
  while (used.has(String(port))) port += 1
  return port
}

function readMapcycle() {
  const file = path.join(serverRepoDir, 'config', 'mapcycle.txt')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

// --- Provisioning: roda servers.sh num container descartável ---

// O docker CLI dentro do container api resolve os `-v` contra o namespace do
// DAEMON (host). Um bind `./:/repo` aparece em /proc/self/mountinfo com o
// source = caminho real no host; traduzimos o mountpoint do container para o
// caminho do host antes de montar no container de provisionamento.
function hostPathFor(containerPath) {
  const want = String(containerPath).replace(/\/+$/, '')
  try {
    const info = fs.readFileSync('/proc/self/mountinfo', 'utf8')
    for (const line of info.split('\n')) {
      const sep = line.indexOf(' - ')
      if (sep === -1) continue
      const left = line.slice(0, sep).split(' ')
      const mountpoint = (left[4] || '').replace(/\/+$/, '')
      if (mountpoint !== want) continue
      // Bind mounts do compose aparecem com o caminho do host no campo `root`
      // (left[3]), ex.: "2092 2023 8:2 /home/salvas/csserver_wstats /repo rw ... - ext4 /dev/sda2 ...".
      const root = left[3] || ''
      if (root.startsWith('/')) return root
      const right = line.slice(sep + 3).split(' ')
      if (right[1] && right[1].startsWith('/')) return right[1]
    }
  } catch (err) {
    /* cai no fallback abaixo */
  }
  return containerPath
}

function runProvision(args, postScript) {
  // O compose resolve os sources dos binds (`./config/...`) contra o working_dir
  // do container de provisionamento, mas o daemon monta contra o path do HOST.
  // Por isso o repo é montado no MESMO caminho absoluto do host (ex.:
  // /home/salvas/csserver_wstats), não em /repo — senão os mounts dos servidores
  // apontariam para /repo/config/... que não existe no host.
  //
  // `--network host` deixa o container de provisionamento alcançar o Prometheus
  // em localhost:9090 (Admin API, bound no 127.0.0.1 do host) — necessário para
  // o `postScript` (node, roda DEPOIS do servers.sh) limpar as séries do
  // servidor removido. O provisionamento roda num container descartável e a api
  // NÃO é recriada no add/remove (config estática), então a resposta ao request
  // chega normalmente.
  const hostRepo = hostPathFor(serverRepoDir)
  const sh = path.join(hostRepo, 'scripts', 'servers.sh')
  let cmd = `bash ${JSON.stringify(sh)} ${args.map((a) => JSON.stringify(a)).join(' ')}`
  if (postScript) {
    // O script passa por env var (não embutido no -c) para preservar as quebras
    // de linha: `node -e` com \n literal escapado pelo bash quebraria com
    // SyntaxError ("Invalid or unexpected token").
    cmd += ' && node -e "$PROM_POST_SCRIPT"'
  }
  return run('docker', [
    'run', '--rm',
    '--network', 'host',
    '-w', hostRepo,
    '-e', `COMPOSE_PROJECT_NAME=${path.basename(hostRepo) || 'csserver_wstats'}`,
    ...(postScript ? ['-e', `PROM_POST_SCRIPT=${postScript}`] : []),
    '-v', `${hostRepo}:${hostRepo}`,
    '-v', `${hostPathFor('/var/run/docker.sock')}:/var/run/docker.sock`,
    PROVISION_IMAGE,
    'bash', '-c', cmd
  ], { timeout: PROVISION_TIMEOUT_MS })
}

// Gera o script node que roda no container de provisionamento (pós servers.sh up)
// para remover do TSDB do Prometheus as séries do servidor removido (labels
// `server` do cs16_stats e `container_label_*` do cAdvisor), espelhando o
// prom_delete_series do scripts/servers.sh prune --metrics.
function promDeleteScript(id) {
  const matches = [
    `{server="${id}"}`,
    `{container_label_com_docker_compose_service="cs16${id}"}`
  ]
  return `
(async () => {
  const base = 'http://localhost:9090/api/v1/admin/tsdb'
  for (const m of ${JSON.stringify(matches)}) {
    try {
      const r = await fetch(base + '/delete_series?match[]=' + encodeURIComponent(m), { method: 'POST' })
      console.log('prom-cleanup: ' + m + ' -> http ' + r.status)
    } catch (e) { console.log('prom-cleanup: erro em ' + m + ': ' + e.message) }
  }
  try {
    const r = await fetch(base + '/clean_tombstones', { method: 'POST' })
    console.log('prom-cleanup: clean_tombstones -> http ' + r.status)
  } catch (e) { console.log('prom-cleanup: erro no clean_tombstones: ' + e.message) }
})()
`
}

// --- Provider docker ---

function serviceFor(id) {
  return id === 'main' ? 'cs16' : `cs16${id}`
}

async function containerFor(id) {
  const out = await run('docker', [
    'ps', '-a',
    '--filter', `label=com.docker.compose.service=${serviceFor(id)}`,
    '--format', '{{.Names}}'
  ], { timeout: 15000 })
  const name = out.split('\n').map((s) => s.trim()).filter(Boolean)[0]
  return name || null
}

function containerControl(action, id) {
  const verbs = { start: 'start', stop: 'stop', restart: 'restart' }
  const verb = verbs[action]
  if (!verb) throw new Error(`Ação inválida: ${action}`)
  return async () => {
    const name = await containerFor(id)
    if (!name) throw new Error(`Container do servidor '${id}' não encontrado`)
    await run('docker', [verb, name], { timeout: 60000 })
    return { id, action, container: name }
  }
}

async function listContainers() {
  // Filtra pela presença do label (não pelo valor) e seleciona só os serviços
  // cs16* — um --filter com valor exato pegaria apenas o "main".
  const out = await run('docker', [
    'ps', '-a',
    '--filter', 'label=com.docker.compose.service',
    '--format', '{{json .}}'
  ], { timeout: 20000 })
  const containers = out.trim().split('\n').filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) } catch (err) { return null }
    })
    .filter(Boolean)

  const byService = {}
  for (const c of containers) {
    const labels = {}
    for (const kv of String(c.Labels || '').split(',')) {
      const i = kv.indexOf('=')
      if (i > -1) labels[kv.slice(0, i)] = kv.slice(i + 1)
    }
    const service = labels['com.docker.compose.service']
    if (service === 'cs16' || /^cs16[a-z0-9_-]+$/.test(service)) {
      byService[service] = c
    }
  }
  return byService
}

// Ids de servidores com a stack de espectador (CSTV) CRIADA, ou seja, com o
// container watch-main-<id> existente (provisionado com --cstv ou watch.sh).
// Cache curto (30s): a rota pública /servers usa isso e o docker ps é barato,
// mas não queremos um exec por requisição.
let watchCache = { at: 0, ids: new Set() }
async function getWatchServerIds() {
  const now = Date.now()
  if (now - watchCache.at < 30000) return watchCache.ids
  watchCache = { at: now, ids: new Set() }
  try {
    const out = await run('docker', [
      'ps', '-a',
      '--filter', 'name=cs16-watch-main-',
      '--format', '{{.Names}}'
    ], { timeout: 15000 })
    for (const line of out.split('\n')) {
      const m = /^cs16-watch-main-(.+)$/.exec(line.trim())
      if (m) watchCache.ids.add(m[1])
    }
  } catch (err) {
    console.error('getWatchServerIds: docker indisponível — assumindo stack de espectador ausente:', err.message)
  }
  return watchCache.ids
}

async function availableMaps() {
  const images = ['cs16_stats:local', 'leandrosalvas/cs16_stats:latest']
  for (const img of images) {
    try {
      const out = await run('docker', [
        'run', '--rm', '--entrypoint', 'ls', img, '/home/cs16/cstrike/maps/'
      ], { timeout: 60000 })
      const maps = out.split('\n')
        .map((s) => s.trim())
        // O diretório de mapas também tem .res/.txt/.zip/.url — só interessam os .bsp.
        .filter((s) => /\.bsp$/i.test(s))
        .map((s) => s.replace(/\.bsp$/i, ''))
        .filter(Boolean)
      if (maps.length) return [...new Set(maps)].sort()
    } catch (err) {
      /* tenta a próxima imagem */
    }
  }
  return readMapcycle()
}

// --- Adapter público ---

function validateAddSpec(spec) {
  const name = String(spec.name || '').trim()
  if (!name) throw Object.assign(new Error('Nome do servidor é obrigatório'), { status: 400 })
  if (/\s/.test(name)) throw Object.assign(new Error('Nome não pode conter espaços (use _ se necessário)'), { status: 400 })
  if (/["\\|#]/.test(name)) throw Object.assign(new Error('Nome não pode conter aspas, barra, pipe ou #'), { status: 400 })

  const map = String(spec.map || 'de_dust2').trim()
  if (!/^[a-z0-9_]+$/.test(map)) throw Object.assign(new Error('Mapa inicial inválido (use letras minúsculas, números e _)'), { status: 400 })

  const slots = parseInt(spec.slots, 10)
  if (!Number.isFinite(slots) || slots < 2 || slots > 30 || slots % 2 !== 0) {
    throw Object.assign(new Error('Slots (vagas visíveis) devem ser um número par entre 2 e 30'), { status: 400 })
  }

  const rotate = String(spec.rotate || 'yes').toLowerCase()
  if (rotate !== 'yes' && rotate !== 'no') {
    throw Object.assign(new Error('rotate deve ser yes ou no'), { status: 400 })
  }

  const cstv = Boolean(spec.cstv)

  return { name, map, slots, rotate, cstv }
}

const dockerProvider = {
  async list() {
    const configs = readServersList()
    const byService = await listContainers()
    return configs.map((cfg) => {
      const svc = serviceFor(cfg.id)
      const container = byService[svc]
      return {
        id: cfg.id,
        name: cfg.name,
        hostPort: cfg.host_port,
        map: cfg.map,
        maxplayers: cfg.maxplayers,
        rotate: cfg.rotate,
        context: cfg.context,
        containerState: container ? container.State : 'absent',
        containerStatus: container ? container.Status : '',
        online: false
      }
    })
  },

  async start(id) {
    return containerControl('start', id)()
  },

  async stop(id) {
    return containerControl('stop', id)()
  },

  async restart(id) {
    return containerControl('restart', id)()
  },

  async add(spec) {
    const { name, map, slots, rotate, cstv } = validateAddSpec(spec)
    const current = readServersList()
    const id = slugifyName(name)
    if (!isValidId(id)) throw Object.assign(new Error('Nome sem caracteres válidos para id'), { status: 400 })
    if (id === 'main' || current.some((s) => s.id === id)) {
      throw Object.assign(new Error(`Já existe servidor com id '${id}'. Use um nome diferente`), { status: 400 })
    }
    const context = slugifyName(name)
    if (current.some((s) => s.context === context)) {
      throw Object.assign(new Error(`Contexto de espectador '${context}' já está em uso`), { status: 400 })
    }
    const hostPort = nextFreePort(current)
    const entry = { id, name, host_port: hostPort, map, maxplayers: slots, rotate, context }
    writeServersList([...current, entry])
    try {
      // Provisionamento cirúrgico: só o container do servidor novo (up
      // --no-recreate), com os serviços de espectador se o formulário marcou CSTV.
      const args = ['provision', id]
      if (cstv) args.push('--cstv')
      await runProvision(args)
    } catch (err) {
      // Rollback: devolve a lista ao estado anterior (sem o servidor novo).
      writeServersList(current)
      throw err
    }
    return { ...entry, hostPort, cstv, containerState: 'created' }
  },

  async remove(id) {
    if (id === 'main') throw Object.assign(new Error('Não é possível remover o servidor principal (main)'), { status: 400 })
    const current = readServersList()
    const next = current.filter((s) => s.id !== id)
    if (next.length === current.length) {
      throw Object.assign(new Error(`Servidor '${id}' não encontrado`), { status: 404 })
    }
    writeServersList(next)
    fs.rmSync(path.join(serverRepoDir, 'config', 'servers', id), { recursive: true, force: true })
    fs.rmSync(path.join(serverRepoDir, 'live', id), { recursive: true, force: true })
    fs.rmSync(path.join(serverRepoDir, 'config', 'watch', id), { recursive: true, force: true })
    fs.rmSync(path.join(serverRepoDir, 'live', 'watch', id), { recursive: true, force: true })
    try {
      const out = await runProvision(['unprovision', id], promDeleteScript(id))
      if (out && out.trim()) console.log('Provision (cleanup Prometheus):', out.trim())
    } catch (err) {
      // Melhor esforço: restaura a lista (configs/live já foram removidos).
      writeServersList(current)
      throw err
    }
    return { removed: id }
  },

  async availableMaps() {
    return availableMaps()
  }
}

function getProvider() {
  if (serverManagerProvider === 'docker') return dockerProvider
  throw new Error(`SERVER_MANAGER_PROVIDER '${serverManagerProvider}' não implementado (use 'docker')`)
}

module.exports = {
  getProvider,
  getWatchServerIds,
  serverManagerProvider
}
