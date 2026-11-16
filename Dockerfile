# Chalkfall: build the static site with Node, serve it with nginx.
# The Box2D WebAssembly module is prebuilt in src/physics/wasm (rebuild with physics/build.sh).

# ---- build (runs on the build machine's own architecture; the output is plain static files)
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- serve
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
# ARCADE_URL → /arcade.json at start (see "In the arcade" in the README)
COPY deploy/arcade.sh /docker-entrypoint.d/40-arcade.sh
RUN chmod +x /docker-entrypoint.d/40-arcade.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
