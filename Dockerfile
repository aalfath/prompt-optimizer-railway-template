# Prompt Optimizer for Railway: official image, pinned by version and digest.
FROM linshen/prompt-optimizer:2.16.1@sha256:88a59aa626eabbff2f6cf66afe9c055f582338256d2d67e858a49a3a00c6ff8e

# Two nginx workers (Railway hosts report many CPUs; the default "auto" wastes RAM on small plans).
# The upstream default.conf is replaced at start from our template.
RUN sed -i 's/^worker_processes auto;/worker_processes 2;/' /etc/nginx/nginx.conf \
 && grep -q '^worker_processes 2;' /etc/nginx/nginx.conf \
 && rm -f /etc/nginx/http.d/default.conf /etc/nginx/http.d/auth.conf

COPY nginx.conf.template railway-start.cjs /etc/railway/

ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
WORKDIR /app/mcp-server
CMD ["node", "/etc/railway/railway-start.cjs"]
