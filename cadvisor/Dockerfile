# cAdvisor com suporte ao containerd snapshotter do Docker Engine.
#
# O cAdvisor upstream (google/cadvisor) não enxerga containers quando o Docker
# usa o containerd image store (driver-type io.containerd.snapshotter.v1): ele
# falha em localizar o layerdb em /var/lib/docker/image/... (issue #3643,
# fechada como not_planned). Este build usa o fork da comunidade com o fix:
#   https://github.com/dillon-giacoppo/cadvisor  (commit d63def0)
# CPU/memória/rede por container funcionam; métricas de filesystem, não.
FROM golang:1.23-bookworm AS builder
WORKDIR /src
RUN git clone --depth 1 --branch fix-3643-add-support-overlayfs-containerd https://github.com/dillon-giacoppo/cadvisor.git . \
    && git fetch --depth 1 origin d63def0ff6802f6c777d2907236649f5b470ef05 \
    && git checkout d63def0ff6802f6c777d2907236649f5b470ef05 \
    && make build

FROM debian:bookworm-slim
COPY --from=builder /src/_output/cadvisor /usr/bin/cadvisor
EXPOSE 8080
ENTRYPOINT ["/usr/bin/cadvisor"]
