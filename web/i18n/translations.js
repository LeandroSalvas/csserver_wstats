const i18n = {
  pt: {
    nav: {
      home: '🏠 Home',
      maps: '🗺️ Ver ranking por mapa',
      rankings: '🏆 Rankings',
      advanced: '📈 Avançadas',
      connect: '🔗 Conectar',
      live: '📡 Live Match',
      admin: '🛠️ Painel RCON',
      system: '🛡️ Sistema'
    },
    status: {
      online: 'Online',
      offline: 'Offline',
      degraded: 'Degradado',
      pending: 'Aguardando',
      notUsed: 'Não usado',
      loading: 'Carregando...',
      updating: 'Atualizando...',
      updatingSystem: 'Atualizando status do sistema...',
      loadingRanking: 'Carregando ranking...',
      loadingAdvanced: 'Carregando estatísticas avançadas...',
      loadingPlayer: 'Carregando dados do jogador...',
      loadingMap: 'Carregando ranking do mapa...',
      loadingMaps: 'Carregando mapas...',
      loadingLive: 'Carregando dados ao vivo...'
    },
    errors: {
      loadFailed: 'Erro ao carregar',
      loadRanking: 'Erro ao carregar ranking',
      loadAdvanced: 'Erro ao carregar estatísticas avançadas',
      loadPlayer: 'Erro ao carregar dados',
      loadMap: 'Erro ao carregar ranking do mapa',
      loadMaps: 'Erro ao carregar mapas',
      loadLive: 'Erro ao carregar dados ao vivo',
      loadServer: 'Erro ao carregar status do servidor',
      loadSystem: 'Não foi possível carregar status do sistema',
      notFound: 'não encontrado',
      notProvided: 'não informado',
      playerNotFound: 'Jogador não encontrado',
      steamidNotProvided: 'SteamID não informado na URL',
      mapNotProvided: 'Nome do mapa não informado',
      commandRequired: 'Comando obrigatório',
      passwordRequired: 'Senha RCON obrigatória',
      authFailed: 'Falha ao autenticar no RCON',
      authSuccess: 'Autenticado com sucesso',
      invalidPassword: 'Senha incorreta',
      rconNotConfigured: 'RCON não configurado no servidor',
      rconNotConfiguredLocal: 'RCON não configurado',
      tooManyAttempts: 'Muitas tentativas. Tente novamente em 1 minuto.',
      executing: 'Executando...',
      noReturnText: '(sem retorno textual)',
      failToLoad: 'Falha ao carregar'
    },
    labels: {
      kills: 'Kills',
      deaths: 'Deaths',
      hs: 'HS',
      kd: 'KD',
      skill: 'Skill',
      map: 'Mapa',
      maps: 'Mapas',
      player: 'Player',
      players: 'Players',
      accuracy: 'Accuracy',
      streak: 'Streak',
      data: 'Data',
      topPlayers: 'Top Players',
      availableMaps: 'Mapas disponíveis',
      matches: 'Partidas',
      topJogadores: 'Top jogadores',
      recentHistory: 'Histórico recente',
      killsEvolution: 'Evolução de Kills',
      ranking: 'Ranking',
      rankingWeekly: 'Ranking semanal',
      rankingMonthly: 'Ranking mensal',
      rankingMap: 'Ranking do mapa',
      weekly: 'Semanal',
      monthly: 'Mensal',
      rank: '#',
      noData: 'Nenhum dado disponível',
      noMaps: 'Nenhum mapa encontrado',
      failLoadData: 'Falha ao carregar dados',
      failLoadMaps: 'Falha ao carregar mapas',
      noPlayersThisTeam: 'Nenhum jogador neste time',
      noRecentKills: 'Nenhuma kill recente'
    },
    admin: {
      title: 'Painel RCON',
      authTitle: 'Autenticação RCON',
      passwordPlaceholder: 'Digite a senha RCON',
      connect: 'Conectar',
      disconnect: 'Desconectar',
      console: 'Console RCON',
      commandPlaceholder: 'Ex.: status, users, changelevel de_dust2, amx_map de_inferno',
      execute: 'Executar',
      response: 'Resposta',
      historyTitle: 'Histórico de comandos',
      referenceTitle: 'Referência de comandos',
      searchPlaceholder: 'Buscar comando...',
      connecting: 'Conectando...',
      authSuccess: 'Autenticado com sucesso.',
      errorAuth: 'Erro ao autenticar.',
      errorExecute: 'Erro ao executar comando.',
      disconnected: 'Desconectado'
    },
    server: {
      title: 'Servidor',
      hostname: 'Servidor',
      address: 'Endereço do servidor',
      host: 'Host',
      port: 'Porta',
      fullConnect: 'Conexão completa',
      openSteamRecommended: 'Abrir pelo Steam (recomendado se você tem CS 1.6 na biblioteca)',
      openDescription: 'Este botão pede ao Steam para iniciar o Counter-Strike 1.6 e passar o comando +connect na linha de lançamento.',
      openCsAndConnect: 'Abrir CS 1.6 e conectar',
      openCsOnly: 'Só abrir o CS 1.6 (sem comando de conexão)',
      manualConnect: 'Conectar manualmente (funciona com Steam e não-Steam)',
      step1: 'Abra o CS 1.6.',
      step2: 'Abra o console com ~ ou º (tecla ao lado do 1).',
      step3: 'Digite o comando (Enter para enviar):',
      alternative: 'Outra opção:',
      findServers: 'No jogo, acesse Find Servers / Internet.',
      addFavorites: 'Adicione o servidor aos favoritos usando',
      allowBrowser: 'Se o navegador perguntar, permite abrir o Steam.',
      browserNote: 'Em alguns PCs o protocolo só traz o Steam à frente ou não inicia o jogo; nesse caso use o passo a passo abaixo.'
    },
    system: {
      title: 'Status do Sistema',
      api: 'API',
      database: 'Banco de Dados',
      redis: 'Redis',
      gameServer: 'Servidor CS',
      info: 'Informações',
      infoDescription: 'Esta página mostra o estado atual dos principais subsistemas: API, banco de dados, cache Redis e servidor Counter-Strike.',
      infoAutoUpdate: 'Os indicadores atualizam automaticamente enquanto a página estiver visível.'
    },
    live: {
      title: 'Live Match',
      currentMap: 'Mapa atual',
      playersOnline: 'Players online',
      terrorists: 'Terrorists',
      counterTerrorists: 'Counter-Terrorists',
      playersCount: 'players',
      status: 'Status',
      score: 'Score',
      alive: 'Alive',
      dead: 'Dead',
      killFeed: '🔫 Kill Feed'
    },
    player: {
      title: 'Player Stats',
      steamid: 'SteamID',
      lastMap: 'Último mapa'
    },
    cmd: {
      status: 'Mostra status do servidor',
      users: 'Lista jogadores conectados',
      stats: 'Mostra estatísticas básicas do servidor',
      version: 'Mostra versão do servidor',
      hostname: 'Altera o nome do servidor',
      changelevelDust2: 'Troca imediatamente para de_dust2',
      changelevelInferno: 'Troca imediatamente para de_inferno',
      changelevelNuke: 'Troca imediatamente para de_nuke',
      mapDust2: 'Inicia o mapa de_dust2',
      timelimit: 'Tempo do mapa',
      roundtime: 'Tempo de round',
      freezetime: 'Freeze time',
      buytime: 'Tempo de compra',
      startmoney: 'Dinheiro inicial',
      c4timer: 'Tempo da bomba',
      friendlyfire: 'Liga/desliga friendly fire',
      autoteambalance: 'Balanceamento automático',
      limitteams: 'Limite de diferença entre times',
      restart: 'Reinicia a rodada',
      say: 'Mensagem no chat do servidor',
      echo: 'Mensagem no console',
      amxMap: 'Troca mapa via AMX',
      amxSay: 'Mensagem global do admin',
      amxCsay: 'Mensagem central na tela',
      amxChat: 'Chat entre admins',
      amxKick: 'Kicka jogador',
      amxBan: 'Bane jogador por 30 min',
      amxSlap: 'Dá slap em jogador',
      amxSlay: 'Mata jogador',
      amxWho: 'Lista admins online',
      amxPlugins: 'Lista plugins carregados',
      amxModules: 'Lista módulos carregados',
      amxReloadadmins: 'Recarrega admins',
      pbAdd: 'Adiciona 1 bote com nível 50 de dificuldade',
      pbRemove: 'Remove o bot PodBod especificado',
      pbRemovebots: 'Remove todos os bots PodBod',
      pbKillbots: 'Mata todos os bots PodBod',
      pbFillserver: 'Preenche o servidor com bots',
      pbHelp: 'Mostra a lista de comandos do PodBod',
      pbWeaponmode: 'Define o modo de arma do PodBod',
      restartDanger: 'Reinicia o servidor',
      execDanger: 'Executa arquivo de config',
      categoryServer: 'Servidor',
      categoryMap: 'Mapa',
      categoryGameplay: 'Gameplay',
      categoryMessages: 'Mensagens',
      categoryAmx: 'AMX',
      categoryPodbod: 'PodBod',
      categoryDangerous: 'Perigosos'
    },
    advanced: {
      headshots: 'Top Headshots',
      accuracy: 'Top Accuracy',
      streak: 'Top Kill Streak'
    }
  },

  en: {
    nav: {
      home: '🏠 Home',
      maps: '🗺️ Map Rankings',
      rankings: '🏆 Rankings',
      advanced: '📈 Advanced',
      connect: '🔗 Connect',
      live: '📡 Live Match',
      admin: '🛠️ RCON Panel',
      system: '🛡️ System'
    },
    status: {
      online: 'Online',
      offline: 'Offline',
      degraded: 'Degraded',
      pending: 'Waiting',
      notUsed: 'Not used',
      loading: 'Loading...',
      updating: 'Updating...',
      updatingSystem: 'Updating system status...',
      loadingRanking: 'Loading ranking...',
      loadingAdvanced: 'Loading advanced stats...',
      loadingPlayer: 'Loading player data...',
      loadingMap: 'Loading map ranking...',
      loadingMaps: 'Loading maps...',
      loadingLive: 'Loading live data...'
    },
    errors: {
      loadFailed: 'Failed to load',
      loadRanking: 'Failed to load ranking',
      loadAdvanced: 'Failed to load advanced stats',
      loadPlayer: 'Failed to load data',
      loadMap: 'Failed to load map ranking',
      loadMaps: 'Failed to load maps',
      loadLive: 'Failed to load live data',
      loadServer: 'Failed to load server status',
      loadSystem: 'Failed to load system status',
      notFound: 'not found',
      notProvided: 'not provided',
      playerNotFound: 'Player not found',
      steamidNotProvided: 'SteamID not provided in URL',
      mapNotProvided: 'Map name not provided',
      commandRequired: 'Command required',
      passwordRequired: 'RCON password required',
      authFailed: 'Failed to authenticate with RCON',
      authSuccess: 'Authenticated successfully',
      invalidPassword: 'Invalid password',
      rconNotConfigured: 'RCON not configured on server',
      rconNotConfiguredLocal: 'RCON not configured',
      tooManyAttempts: 'Too many attempts. Try again in 1 minute.',
      executing: 'Executing...',
      noReturnText: '(no text return)',
      failToLoad: 'Failed to load'
    },
    labels: {
      kills: 'Kills',
      deaths: 'Deaths',
      hs: 'HS',
      kd: 'KD',
      skill: 'Skill',
      map: 'Map',
      maps: 'Maps',
      player: 'Player',
      players: 'Players',
      accuracy: 'Accuracy',
      streak: 'Streak',
      data: 'Date',
      topPlayers: 'Top Players',
      availableMaps: 'Available Maps',
      matches: 'Matches',
      topJogadores: 'Top players',
      recentHistory: 'Recent History',
      killsEvolution: 'Kills Evolution',
      ranking: 'Ranking',
      rankingWeekly: 'Weekly Ranking',
      rankingMonthly: 'Monthly Ranking',
      rankingMap: 'Map Ranking',
      weekly: 'Weekly',
      monthly: 'Monthly',
      rank: '#',
      noData: 'No data available',
      noMaps: 'No maps found',
      failLoadData: 'Failed to load data',
      failLoadMaps: 'Failed to load maps',
      noPlayersThisTeam: 'No players on this team',
      noRecentKills: 'No recent kills'
    },
    admin: {
      title: 'RCON Panel',
      authTitle: 'RCON Authentication',
      passwordPlaceholder: 'Enter RCON password',
      connect: 'Connect',
      disconnect: 'Disconnect',
      console: 'RCON Console',
      commandPlaceholder: 'Ex.: status, users, changelevel de_dust2, amx_map de_inferno',
      execute: 'Execute',
      response: 'Response',
      historyTitle: 'Command History',
      referenceTitle: 'Command Reference',
      searchPlaceholder: 'Search command...',
      connecting: 'Connecting...',
      authSuccess: 'Authenticated successfully.',
      errorAuth: 'Authentication error.',
      errorExecute: 'Error executing command.',
      disconnected: 'Disconnected'
    },
    server: {
      title: 'Connect to Server',
      hostname: 'Server',
      address: 'Server Address',
      host: 'Host',
      port: 'Port',
      fullConnect: 'Full connection',
      openSteamRecommended: 'Open via Steam (recommended if you have CS 1.6 in your library)',
      openDescription: 'This button asks Steam to launch Counter-Strike 1.6 and pass the +connect command — the same as adding it to the game launch options.',
      openCsAndConnect: 'Open CS 1.6 and Connect',
      openCsOnly: 'Open CS 1.6 only (no connect command)',
      manualConnect: 'Connect manually (works with Steam and Non-Steam)',
      step1: 'Open CS 1.6.',
      step2: 'Open the console with ~ or º (key next to 1).',
      step3: 'Type the command (press Enter to send):',
      alternative: 'Alternative:',
      findServers: 'In-game, go to Find Servers / Internet.',
      addFavorites: 'Add the server to favorites using',
      allowBrowser: 'If the browser asks, allow opening Steam.',
      browserNote: 'On some PCs the protocol only brings Steam to the foreground or does not start the game; in that case use the steps below.'
    },
    system: {
      title: 'System Status',
      api: 'API',
      database: 'Database',
      redis: 'Redis',
      gameServer: 'Game Server',
      info: 'Information',
      infoDescription: 'This page shows the current status of the main subsystems: API, database, Redis cache, and Counter-Strike server.',
      infoAutoUpdate: 'The indicators update automatically while the page is visible.'
    },
    live: {
      title: 'Live Match',
      currentMap: 'Current Map',
      playersOnline: 'Players online',
      terrorists: 'Terrorists',
      counterTerrorists: 'Counter-Terrorists',
      playersCount: 'players',
      status: 'Status',
      score: 'Score',
      alive: 'Alive',
      dead: 'Dead',
      killFeed: '🔫 Kill Feed'
    },
    player: {
      title: 'Player Stats',
      steamid: 'SteamID',
      lastMap: 'Last Map'
    },
    cmd: {
      status: 'Shows server status',
      users: 'Lists connected players',
      stats: 'Shows basic server stats',
      version: 'Shows server version',
      hostname: 'Changes server name',
      changelevelDust2: 'Immediately switches to de_dust2',
      changelevelInferno: 'Immediately switches to de_inferno',
      changelevelNuke: 'Immediately switches to de_nuke',
      mapDust2: 'Starts de_dust2 map',
      timelimit: 'Map time limit',
      roundtime: 'Round time',
      freezetime: 'Freeze time',
      buytime: 'Buy time',
      startmoney: 'Starting money',
      c4timer: 'Bomb timer',
      friendlyfire: 'Enable/disable friendly fire',
      autoteambalance: 'Auto team balance',
      limitteams: 'Team difference limit',
      restart: 'Restart round',
      say: 'Message in server chat',
      echo: 'Message in console',
      amxMap: 'Change map via AMX',
      amxSay: 'Global admin message',
      amxCsay: 'Center screen message',
      amxChat: 'Chat between admins',
      amxKick: 'Kick player',
      amxBan: 'Ban player for 30 min',
      amxSlap: 'Slap player',
      amxSlay: 'Kill player',
      amxWho: 'List online admins',
      amxPlugins: 'List loaded plugins',
      amxModules: 'List loaded modules',
      amxReloadadmins: 'Reload admins',
      pbAdd: 'Adds 1 bot with difficulty level 50',
      pbRemove: 'Removes specified PodBod bot',
      pbRemovebots: 'Removes all PodBod bots',
      pbKillbots: 'Kills all PodBod bots',
      pbFillserver: 'Fills server with bots',
      pbHelp: 'Shows PodBod command list',
      pbWeaponmode: 'Sets bot weapon mode',
      restartDanger: 'Restarts the server',
      execDanger: 'Executes config file',
      categoryServer: 'Server',
      categoryMap: 'Map',
      categoryGameplay: 'Gameplay',
      categoryMessages: 'Messages',
      categoryAmx: 'AMX',
      categoryPodbod: 'PodBod',
      categoryDangerous: 'Dangerous'
    },
    advanced: {
      headshots: 'Top Headshots',
      accuracy: 'Top Accuracy',
      streak: 'Top Kill Streak'
    }
  }
}

const i18nUtils = {
  currentLang: 'pt',

  init() {
    const stored = localStorage.getItem('lang')
    const browserLang = navigator.language.toLowerCase().startsWith('en') ? 'en' : 'pt'
    this.currentLang = stored || browserLang
    this.apply()
  },

  t(key) {
    const keys = key.split('.')
    let val = i18n[this.currentLang]
    for (const k of keys) {
      val = val?.[k]
      if (val === undefined) break
    }
    return val !== undefined ? val : key
  },

  setLang(lang) {
    this.currentLang = lang
    localStorage.setItem('lang', lang)
    this.apply()
  },

  apply() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n
      el.textContent = this.t(key)
    })
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.dataset.i18nHtml
      el.innerHTML = this.t(key)
    })
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.dataset.i18nPlaceholder
      el.placeholder = this.t(key)
    })
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.dataset.i18nTitle
      el.title = this.t(key)
    })
    document.dispatchEvent(new CustomEvent('i18n applied'))
  },

  getLangLabel() {
    return this.currentLang === 'pt' ? 'PT | EN' : 'PT | EN'
  },

  getToggleHtml() {
    if (this.currentLang === 'pt') {
      return '<b>PT</b> | EN'
    }
    return 'PT | <b>EN</b>'
  }
}
