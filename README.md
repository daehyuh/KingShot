# KingShot

Kingshot Swordland Showdown manager.

Web + API tool to manage multiple alliances, register members per alliance, and split each alliance into Legion 1 / Legion 2 for recurring Swordland Showdown events.

## Run

```bash
uv run server.py --host 127.0.0.1 --port 8000
```

Open in browser:

- `http://127.0.0.1:8000`

Default DB file:

- `alliance_users.db`

## Main Workflow

1. Create or select an alliance.
2. Register members by FID (single or bulk) inside that alliance.
3. Create a new event for that alliance.
4. Move members into Legion 1 or Legion 2.
5. Repeat for each new event cycle.

## API Summary

### Alliances

- `GET /alliances`
- `POST /alliances` body: `{ "name": "ACE" }`

### Users

- `GET /users`
- `GET /users?alliance_id=1`
- `POST /users` body: `{ "fid": 254813172, "alliance_id": 1 }`
- `POST /users/bulk` body: `{ "fids": [254813172, 111111111], "alliance_id": 1 }`
- `DELETE /users/{fid}`
- `POST /users/delete-bulk` body: `{ "fids": [254813172, 111111111] }`
- `POST /users/{fid}/alliance` body: `{ "alliance_id": 2 }`

### Events

- `GET /events`
- `GET /events?alliance_id=1`
- `POST /events` body: `{ "name": "Swordland Showdown #1", "alliance_id": 1 }`
- `DELETE /events/{event_id}`
- `GET /events/{event_id}/board`
- `POST /events/{event_id}/assign` body: `{ "fid": 254813172, "legion": "legion1" }`
- `POST /events/{event_id}/assign-bulk` body: `{ "fids": [254813172], "legion": "legion2" }`
- `DELETE /events/{event_id}/members/{fid}`
- `POST /events/{event_id}/clear-legion` body: `{ "legion": "legion1" }`

### Gift Codes

- `GET /gift-codes`
- `POST /gift-codes` body: `{ "code": "VIP777" }`
- `DELETE /gift-codes/{gift_code_id}`
- `POST /gift-codes/redeem` body: `{ "fid": 254813172, "cdk": "VIP777", "captcha_code": "" }`
- `POST /gift-codes/use` body: `{ "fid": 254813172, "cdk": "VIP777" }` (`/redeem` alias)

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
