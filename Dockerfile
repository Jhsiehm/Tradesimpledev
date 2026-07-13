# Minimal Node + Python image for Railway (use when builder=DOCKERFILE).
# Finnhub is primary; python3+yfinance is market-data fallback only.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && pip3 install --break-system-packages --no-cache-dir "yfinance>=0.2.40" \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --chown=node:node . .

ENV NODE_ENV=production
ENV YFINANCE_PYTHON=python3

# Run as the image's built-in unprivileged user rather than root.
USER node

EXPOSE 8080
CMD ["node", "server.mjs"]
