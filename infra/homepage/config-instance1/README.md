# instance #1 homepage

Runs on `mc-i1` (the Minecraft host), port 80. Config lives in
`/srv/homepage/config`, secrets in `/srv/homepage/.env`.

## Redeploying

Recreate the container, never just restart it -- `--env-file` is read at
creation only, so a credential added afterwards stays empty in a restarted
container and widgets fail with "API Error Information" and nothing in the logs.

```bash
IMG=$(docker inspect homepage --format "{{.Config.Image}}")
docker rm -f homepage
docker run -d --name homepage --restart unless-stopped -p 80:3000 \
  --env-file /srv/homepage/.env \
  -v /srv/homepage/config:/app/config \
  -v /var/run/docker.sock:/var/run/docker.sock:ro "$IMG"
```

## Everything the container needs lives in the env FILE

Not in `-e` flags. Recreating the container preserved the image and mounts but
silently dropped the flags the original run carried, and
`HOMEPAGE_ALLOWED_HOSTS` came back empty -- so every browser request failed
validation with "Host validation failed".

The deploy still reported success, because it was verified with `curl` to
`localhost` **from the host itself**, which passes validation. Verify from the
machine that will actually load the page, with the real Host header:

```bash
curl -o /dev/null -w '%{http_code}\n' -H 'Host: mc-i1' http://mc-i1/
```

Required keys:

| key | why |
|---|---|
| `HOMEPAGE_ALLOWED_HOSTS` | every hostname and host:port the page is loaded as |
| `HOMEPAGE_VAR_ES_RO` | read-only Elasticsearch account for the live widgets |
