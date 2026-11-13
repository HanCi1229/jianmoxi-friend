#!/bin/bash
# Run as root from the extracted, private release archive on TencentOS 4.
set -euo pipefail
test "$(id -u)" = 0
test -f cloud.env
dnf install -y python3 python3-pip nginx curl tar
id xingzou >/dev/null 2>&1 || useradd --system --home-dir /var/lib/xingzou --shell /sbin/nologin xingzou
install -d -m 755 /opt/xingzou /etc/xingzou
install -d -o xingzou -g xingzou -m 700 /var/lib/xingzou /var/lib/xingzou/backups
install -m 600 cloud.env /etc/xingzou/cloud.env
cp accounts.py cloud_app.py ai_service.py server.py requirements.txt /opt/xingzou/
cp -R dist deploy /opt/xingzou/
python3 -m venv /opt/xingzou/venv
/opt/xingzou/venv/bin/pip install -r /opt/xingzou/requirements.txt
chown -R root:root /opt/xingzou
chmod -R a+rX,go-w /opt/xingzou
install -m 644 deploy/xingzou.service /etc/systemd/system/xingzou.service
install -m 644 deploy/xingzou-backup.service deploy/xingzou-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now xingzou xingzou-backup.timer
curl --fail --silent --retry 5 --retry-connrefused --retry-delay 1 -H 'Host: 49.234.43.25' http://127.0.0.1:8765/healthz
echo 'Private backend installed. Public HTTPS is a separate step.'
