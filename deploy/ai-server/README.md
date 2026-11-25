# AI server on a VPS

This deployment runs the server and stores its data on the VPS. Connect your own computers as machines to run agent work. The image is built from this checkout's prebuilt `bb-app` package; it does not download the published `bb-app` package.

## Prepare

1. Install Docker Engine and the Compose plugin using the [official Docker instructions](https://docs.docker.com/engine/install/).
2. On the target OS and architecture, run `pnpm exec turbo run server:package --filter=bb-app --output-logs=new-only` from the repository root. For Ubuntu x64, the fork's **Build AI Server** workflow also produces the `AI-server-linux-x64` artifact. It contains `ai-server.tgz`, `sha256sums.txt` and `build-info.json`; place these under `packages/bb-app/release-server`. A macOS verification package is not a verified Linux release. The Docker build context contains only these release artifacts. Transfer the deployment files and artifacts to the VPS, preserving their relative paths, and verify `sha256sum -c sha256sums.txt` in the artifact directory.
3. Point an A record for your domain to the VPS IPv4 address. Add an AAAA record only if the VPS has working public IPv6. Allow inbound TCP ports 80 and 443 for Caddy and ensure they are not already in use. Caddy obtains and renews the HTTPS certificate.
4. From `deploy/ai-server`, copy `.env.example` to `.env` and set `AI_DOMAIN` to your domain. `AI_HTTP_PORT` is an optional loopback-only port for local access on the VPS.

```sh
cd deploy/ai-server
cp .env.example .env
docker compose build ai
```

Set the owner password before starting the server. The password must contain at least 12 characters. This reads it without echoing it or putting it in shell history:

The following password commands use Bash.

```bash
read -r -s -p 'Owner password: ' AI_OWNER_PASSWORD
printf '\n'
printf '%s\n' "$AI_OWNER_PASSWORD" | docker compose run --rm -T --no-deps --entrypoint node ai /opt/ai/node_modules/bb-app/dist/bb.js server auth set-password --data-dir /data --username owner --password-stdin
unset AI_OWNER_PASSWORD
docker compose --profile https up -d
```

Open `https://YOUR_DOMAIN` and sign in as `owner` with that password. The server requires owner authentication; the health check reports whether it is responding. Check startup with `docker compose ps` and, if needed, `docker compose logs ai caddy`. The AI port is bound to loopback on the VPS; Caddy is the public HTTPS entry point.

In Settings → Machines, follow the enrollment instructions to connect each computer. Machine requests use their own credentials. The CLI and SDK running on a connected machine use the machine's local authenticated proxy. Keep each computer online when its agent work needs to run.

On iPhone or iPad, open the HTTPS site in Safari, sign in, then choose Share → Add to Home Screen. Compatibility of the official TestFlight app with this owner-auth setup has not yet been verified.

Settings → General → Owner session signs this browser out. The CLI uses `bb server auth login --username owner --password-stdin`, `status` and `logout`; its private session is scoped to the server origin. Rotating the password with `set-password` invalidates existing owner cookies and closes owner WebSockets within one second.

## Verify and update

Before deployment, `pnpm exec turbo run smoke:server --filter=bb-app` builds the archive, installs it into a fresh directory and checks owner login, an enrolled worker, shared queued dialogue, restart and offline backup/restore. The Linux workflow additionally builds and runs the Docker image. These checks do not prove public DNS, HTTPS issuance or physical iPhone behavior.

To update, take the offline backup described below, retain the previous image and obtain a newly built archive from this fork. Verify its checksum, replace the staged release artifacts, then run:

```sh
docker image tag ai-server:local ai-server:previous
docker compose build ai
docker compose --profile https up -d
docker compose ps
```

Keep the existing `ai-data` volume and owner credential file. Do not initialize a new password during an ordinary update. The server-only process has no desktop update launcher; replace its image to update it. If a migration or update fails, verify restoration of the matching pre-update backup and previous image in a fresh project before switching traffic.

## Backup and restore

The `ai-data` Docker volume contains the server's persistent data. To obtain a consistent backup, stop the server before reading the volume; do not copy a live SQLite database. Protect the resulting archive as sensitive data.

```sh
docker compose stop ai
docker compose run --rm -T --no-deps --entrypoint tar ai -C /data -czf - . > ai-data-backup.tar.gz
docker compose --profile https up -d
```

To restore, use a **fresh Compose project and fresh volume**, with the same deployment files and image available. For example, set a new `COMPOSE_PROJECT_NAME` and choose unused ports and a suitable domain in its `.env`. Before starting that project's server, extract the backup into its new volume:

```sh
export COMPOSE_PROJECT_NAME=ai-restore
docker compose run --rm -T --no-deps --entrypoint tar ai -C /data -xzf - < ai-data-backup.tar.gz
```

Verify the restored data in the isolated project before switching traffic. The archive can include owner credentials and machine enrollment material. Never restore over an existing data volume.
