FROM node:22.13-slim

# Install curl (for downloading ngrok) and unzip
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git unzip \
    && rm -rf /var/lib/apt/lists/*

# Install ngrok by downloading the official binary
RUN curl -fsSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.zip -o /tmp/ngrok.zip \
    && unzip /tmp/ngrok.zip -d /usr/local/bin \
    && rm /tmp/ngrok.zip \
    && chmod +x /usr/local/bin/ngrok

WORKDIR /workspace

# Expose ports: 3000 for the dev server, 4040 for the on-demand ngrok inspector
EXPOSE 3000 4040

ENV HOST=0.0.0.0

# The mounted workspace and postCreateCommand install the current application.
# The public tunnel remains dormant until `npm run tunnel:start` is invoked.
CMD ["sleep", "infinity"]
