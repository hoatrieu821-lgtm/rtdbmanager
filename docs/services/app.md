# App service (`compose.apps.yml`)

## Vai trò
- Service `app` chạy RTDB Manager: một Express backend phục vụ frontend tĩnh trong `services/app/public`.
- Ứng dụng dùng Firebase Auth để đăng nhập, lưu users/sessions/project metadata trong master Firebase RTDB, và quản lý nhiều Firebase Realtime Database project.
- REST API public nằm dưới `/api/v1/*` và yêu cầu header `X-API-Key`.

## Cấu hình chính
- Image local tag: `${PROJECT_NAME}-app:local`
- Build context: `./services/app`
- Entrypoint: `node src/app.js`
- Port trong container: `PORT=${APP_PORT}`
- Port expose localhost: `127.0.0.1:${APP_HOST_PORT}:${APP_PORT}`
- Logs volume: `${DOCKER_VOLUMES_ROOT:-./.docker-volumes}/app/logs:/app/logs`
- Healthcheck: `wget --header "X-API-Key: $API_SECRET_KEY" http://localhost:${APP_PORT}${HEALTH_PATH}`

## ENV bắt buộc
- `APP_PORT`: port app lắng nghe trong container, được map sang `PORT`.
- `PROJECT_NAME`, `DOMAIN`: tạo hostname public.
- `CADDY_AUTH_USER`, `CADDY_AUTH_HASH`: basic auth tại reverse proxy.
- `MASTER_FIREBASE_PROJECT_ID`: master Firebase project id.
- `MASTER_FIREBASE_DATABASE_URL`: master Firebase Realtime Database URL.
- `MASTER_FIREBASE_CLIENT_EMAIL`: service-account email của master project.
- `MASTER_FIREBASE_PRIVATE_KEY`: service-account private key, giữ escaped newline `\n` trong `.env`.
- `SESSION_SECRET`: secret ký session cookie.
- `CRYPTO_KEY`: secret mã hóa credential của managed projects.
- `FIREBASE_API_KEY`: Firebase Web API key cho browser login.
- `API_SECRET_KEY`: secret cho header `X-API-Key` của `/api/v1/*`.
- `ALLOWED_EMAILS`: danh sách email Google được phép đăng nhập, phân tách bằng dấu phẩy; dùng `*` chỉ cho private deployment tin cậy.

## ENV optional
- `APP_HOST_PORT` (default `3000`): chỉ truy cập từ localhost host machine.
- `NODE_ENV` (default `production`).
- `APP_BASE_URL` (default `http://localhost:3000`): URL public dùng cho CORS và cookie secure detection.
- `HEALTH_PATH` (default `/api/v1/health`).
- `LOG_LEVEL` (default `info`).
- `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_STORAGE_BUCKET`: Firebase web config bổ sung.
- `MASTER_BACKUP_PASSWORD`: passphrase cho Settings > Master Database dump/restore.
- `DOCKER_VOLUMES_ROOT` (default `./.docker-volumes`).
- `TAILSCALE_TAILNET_DOMAIN`: dùng cho route HTTPS nội bộ qua `caddy_1`.

## Routing
- Public host: `${PROJECT_NAME}.${DOMAIN}` (+ alias).
- Internal HTTPS host: `${PROJECT_NAME}.${TAILSCALE_TAILNET_DOMAIN}` với `tls internal`.
- App shell: `/`
- Session/frontend API: `/auth`, `/projects`, `/data`, `/admin`
- Automation API: `/api/v1/*` với `X-API-Key`.
