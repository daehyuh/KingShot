# KingShot

Kingshot Swordland Showdown manager.

Web + API tool to manage alliance members and split them into Legion 1 / Legion 2 for recurring Swordland Showdown events.

## Run

```bash
uv run server.py --host 127.0.0.1 --port 8000
```

Open in browser:

- `http://127.0.0.1:8000`

Default DB file:

- `alliance_users.db`

## Main Workflow

1. Register members by FID (single or bulk).
2. Create a new event.
3. Move members into Legion 1 or Legion 2.
4. Repeat for each new event cycle.

## API Summary

### Users

- `GET /users`
- `POST /users` body: `{ "fid": 254813172 }`
- `POST /users/bulk` body: `{ "fids": [254813172, 111111111] }`
- `DELETE /users/{fid}`
- `POST /users/delete-bulk` body: `{ "fids": [254813172, 111111111] }`

### Events

- `GET /events`
- `POST /events` body: `{ "name": "Swordland Showdown #1" }`
- `DELETE /events/{event_id}`
- `GET /events/{event_id}/board`
- `POST /events/{event_id}/assign` body: `{ "fid": 254813172, "legion": "legion1" }`
- `POST /events/{event_id}/assign-bulk` body: `{ "fids": [254813172], "legion": "legion2" }`
- `DELETE /events/{event_id}/members/{fid}`
- `POST /events/{event_id}/clear-legion` body: `{ "legion": "legion1" }`

## Frontend Files

- `static/index.html`
- `static/styles.css`
- `static/app.js`

## CORS

API responses include `Access-Control-Allow-Origin: *`.

## Ubuntu Deploy

Use the deployment guide:

- `deploy/ubuntu/DEPLOY.md`

Templates:

- `deploy/ubuntu/kingshot.service`
- `deploy/ubuntu/nginx-kingshot.conf`

Optional env var:

- `KINGSHOT_API_SECRET` (defaults to the current built-in value if not set)
