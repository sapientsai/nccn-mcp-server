# Build stage
FROM node:24-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

# Production stage
FROM node:24-alpine AS production

ARG GIT_HASH=""
ENV GIT_HASH=${GIT_HASH}

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

# Cache directory for index YAML and downloaded PDFs
RUN mkdir -p /app/downloads

ENV MCP_TRANSPORT=httpStream
ENV MCP_PORT=8000

EXPOSE 8000

CMD ["node", "dist/index.js"]
