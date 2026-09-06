# Build the Vite app, then serve the static bundle with nginx.
# HF Spaces docker SDK: the container must listen on app_port (8080);
# nginx-unprivileged listens on 8080 by default and runs as non-root,
# which is exactly what Spaces expects.

FROM node:22-alpine AS build
WORKDIR /build
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
