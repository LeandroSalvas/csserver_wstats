# Config do prometheus-nginxlog-exporter (quay.io/martinhelmich/prometheus-nginxlog-exporter).
# Lê o access.log do nginx (volume compartilhado com o serviço web) e expõe
# métricas de duração ($request_time) para o Prometheus.
#
# O `format` aqui DEVE espelhar exatamente a `log_format metrics` do nginx
# (web/nginx.conf), senão as linhas viram <namespace>_parse_errors_total.

listen {
  port = 4040
  address = "0.0.0.0"
  metrics_endpoint = "/metrics"
}

namespace "nginxlog" {
  format = "$remote_addr - $remote_user [$time_local] \"$request\" $status $body_bytes_sent rt=$request_time"

  source {
    files = [
      "/var/log/nginx/access.log"
    ]
  }

  histogram_buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
}
