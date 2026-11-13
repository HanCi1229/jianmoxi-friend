#!/bin/bash
set -euo pipefail
install -d -m 755 /var/www/letsencrypt/.well-known/acme-challenge
install -m 644 /opt/xingzou/deploy/nginx-http.conf /etc/nginx/conf.d/xingzou-http.conf
nginx -t
systemctl enable --now nginx
# Only execute after port 80 is confirmed reachable from outside.
/opt/certbot/bin/certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
    --preferred-profile shortlived --webroot --webroot-path /var/www/letsencrypt \
    --ip-address 49.234.43.25 --cert-name 49.234.43.25
install -m 644 /opt/xingzou/deploy/nginx-https.conf /etc/nginx/conf.d/xingzou-https.conf
nginx -t
systemctl reload nginx
install -m 644 /opt/xingzou/deploy/xingzou-cert-renew.service /opt/xingzou/deploy/xingzou-cert-renew.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now xingzou-cert-renew.timer
