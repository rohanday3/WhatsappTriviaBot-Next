# Operations and recovery

## Recommended production layout

```text
/opt/whatsapp-trivia/        application, dependencies and compiled code
/opt/whatsapp-trivia/var/    writable database and backups
/etc/whatsapp-trivia.env     root-managed configuration
/etc/systemd/system/whatsapp-trivia.service
```

The service account has no login shell and cannot write outside the application `var` directory.

## First deployment

```bash
sudo ./scripts/install-systemd.sh
sudo editor /etc/whatsapp-trivia.env
sudo systemctl restart whatsapp-trivia
sudo journalctl -u whatsapp-trivia -f
```

A pairing code is easier than a terminal QR over SSH:

```env
PAIRING_MODE=code
PAIRING_NUMBER=27821234567
```

After the account is linked, credentials are stored inside `var/trivia.db`. Protect this file and its backups as secrets.

## Routine commands

```bash
sudo systemctl status whatsapp-trivia
sudo systemctl restart whatsapp-trivia
sudo systemctl stop whatsapp-trivia
sudo journalctl -u whatsapp-trivia --since today
curl http://127.0.0.1:8787/health/ready
curl http://127.0.0.1:8787/metrics
```

## Failure containment

The unit is designed so a bot defect remains local to the bot:

- `Restart=on-failure` restarts only this service.
- `MemoryMax=384M` stops runaway memory growth.
- `CPUQuota=50%` prevents sustained CPU saturation.
- `TasksMax=64` limits process/thread creation.
- startup bursts are capped at five attempts per five minutes;
- the service runs without root and cannot modify the rest of the filesystem;
- SIGTERM triggers a 15-second graceful shutdown path that closes WhatsApp, checkpoints SQLite, and stops the health listener.

Adjust limits only after observing actual usage. A very large number of concurrent groups may need a higher memory limit.

## Health semantics

- **Live:** the HTTP loop is running and can report process state.
- **Ready:** the database is healthy and WhatsApp is connected.

A temporary WhatsApp disconnect returns 503 from `/health/ready` but leaves `/health/live` at 200. This lets a supervisor distinguish connection recovery from a dead process.

## Database maintenance

SQLite is configured with WAL mode, foreign keys, normal synchronous mode, a five-second busy timeout, and periodic passive checkpoints.

Do not run two bot processes against the same account/database. The partial unique index protects one active game per chat, but it does not provide distributed WhatsApp session ownership.

### Backup

```bash
cd /opt/whatsapp-trivia
sudo -u whatsapp-trivia npm run backup
```

Environment options:

```env
BACKUP_DIR=/opt/whatsapp-trivia/var/backups
BACKUP_RETENTION=14
```

A daily systemd timer or cron entry can call the same command.

### Restore

1. Stop the service.
2. Copy the current `trivia.db`, `trivia.db-wal`, and `trivia.db-shm` elsewhere for safety.
3. Remove the WAL and SHM files.
4. Copy the selected backup to `var/trivia.db`.
5. Set ownership to the service account.
6. Run the doctor command.
7. Start the service.

```bash
sudo systemctl stop whatsapp-trivia
sudo cp var/backups/trivia-YYYY-MM-DDTHH-MM-SS.db var/trivia.db
sudo rm -f var/trivia.db-wal var/trivia.db-shm
sudo chown whatsapp-trivia:whatsapp-trivia var/trivia.db
sudo -u whatsapp-trivia npm run doctor
sudo systemctl start whatsapp-trivia
```

## Logged-out or invalid WhatsApp session

A logged-out connection is not restarted in a tight loop. Clear only the auth tables and pair again:

```bash
sudo systemctl stop whatsapp-trivia
sudo -u whatsapp-trivia bash -lc \
  'cd /opt/whatsapp-trivia && node --disable-warning=ExperimentalWarning scripts/reset-auth.mjs --yes'
sudo systemctl start whatsapp-trivia
sudo journalctl -u whatsapp-trivia -f
```

Scores, settings, games, and leaderboards are retained.

## Updating dependencies

Baileys is pinned exactly because protocol changes can be disruptive.

Safe update workflow:

```bash
cp var/trivia.db var/backups/pre-update.db
npm update
npm run check
npm audit
```

Test account linking, direct messages, group sender identity, group-admin permissions, answer delivery, and reconnect behavior before replacing production.

## Updating a systemd installation

Run the installer again from the new source tree. It preserves `/etc/whatsapp-trivia.env` and the installed `var` directory.

```bash
sudo ./scripts/install-systemd.sh
```

## Troubleshooting

### No QR or pairing code

Check `PAIRING_MODE`, `PAIRING_NUMBER`, and logs. Pairing numbers use digits only with the country code and no leading plus sign.

### Service repeatedly fails

```bash
sudo systemctl status whatsapp-trivia
sudo journalctl -u whatsapp-trivia -n 200 --no-pager
sudo -u whatsapp-trivia bash -lc 'cd /opt/whatsapp-trivia && npm run doctor'
```

After correcting the problem:

```bash
sudo systemctl reset-failed whatsapp-trivia
sudo systemctl start whatsapp-trivia
```

### Open Trivia DB unavailable

The bot logs a warning and uses the included local question bank. Games remain available, although category variety may be reduced.

### Health is live but not ready

The process and database are running, but WhatsApp is reconnecting, waiting to pair, or logged out. Inspect the journal.

### High memory use

Check the number of active games through `/metrics`, inspect the process with `systemctl status`, and verify the Baileys version. The hard memory limit will stop and restart the bot rather than allowing it to affect the rest of the server.
