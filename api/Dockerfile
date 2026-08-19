FROM node:26

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev && npm cache clean --force

# Docker CLI + compose plugin: usados pelo serverManager (controle de containers
# via socket montado e provisionamento via scripts/servers.sh num container
# descartável). No Debian trixie o client é o pacote docker-cli (docker.io só
# traz o daemon) e o plugin compose não tem pacote — entra como binário
# standalone em /usr/local/lib/docker/cli-plugins com validação de checksum SHA256.
ARG COMPOSE_VERSION=v2.29.1
ARG COMPOSE_SHA256="5ea89dd65d33912a83737d8a4bf070d5de534a32b8493a21fbefc924484786a9"

RUN apt-get update \
  && apt-get install -y --no-install-recommends docker-cli ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /usr/local/lib/docker/cli-plugins \
  && curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
     "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
  && echo "${COMPOSE_SHA256}  /usr/local/lib/docker/cli-plugins/docker-compose" | sha256sum -c - \
  && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]