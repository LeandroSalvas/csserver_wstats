FROM node:26

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

# Docker CLI + compose plugin: usados pelo serverManager (controle de containers
# via socket montado e provisionamento via scripts/servers.sh num container
# descartável). No Debian trixie o client é o pacote docker-cli (docker.io só
# traz o daemon) e o plugin compose não tem pacote — entra como binário
# standalone em /usr/local/lib/docker/cli-plugins.
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker-cli \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /usr/local/lib/docker/cli-plugins \
  && curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
     https://github.com/docker/compose/releases/download/v2.29.1/docker-compose-linux-x86_64 \
  && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]