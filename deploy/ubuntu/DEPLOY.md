# Ubuntu Deployment Guide

This guide uses `systemd + nginx`.

## 1) Prepare server packages

```bash
sudo apt update
sudo apt install -y git curl nginx
```

## 2) Install `uv`

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
uv --version
```

## 3) Clone and install Python

```bash
sudo mkdir -p /opt/kingshot
sudo chown -R $USER:$USER /opt/kingshot
git clone https://github.com/daehyuh/KingShot.git /opt/kingshot
cd /opt/kingshot
uv python install 3.14
uv sync
```

## 4) Test run

```bash
uv run server.py --host 127.0.0.1 --port 8000 --db /opt/kingshot/alliance_users.db
```

Open `http://SERVER_IP:8000` once to verify, then stop with `Ctrl+C`.

## 5) Configure systemd service

Copy and edit service:

```bash
sudo cp deploy/ubuntu/kingshot.service /etc/systemd/system/kingshot.service
sudo nano /etc/systemd/system/kingshot.service
```

Update these fields:
- `User`
- `Group`
- `WorkingDirectory`
- `ExecStart` (especially uv path and project path)
- `KINGSHOT_API_SECRET` (if different)

Enable service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kingshot
sudo systemctl status kingshot --no-pager
```

## 6) Configure nginx reverse proxy

```bash
sudo cp deploy/ubuntu/nginx-kingshot.conf /etc/nginx/sites-available/kingshot
sudo nano /etc/nginx/sites-available/kingshot
```

Set `server_name` to your domain, then:

```bash
sudo ln -sf /etc/nginx/sites-available/kingshot /etc/nginx/sites-enabled/kingshot
sudo nginx -t
sudo systemctl reload nginx
```

## 7) Optional HTTPS (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Useful commands

```bash
sudo journalctl -u kingshot -n 200 --no-pager
sudo systemctl restart kingshot
sudo systemctl restart nginx
```

## SQLite backup

```bash
cd /opt/kingshot
cp alliance_users.db "alliance_users-$(date +%F-%H%M).db"
```
