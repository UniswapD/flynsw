#!/bin/bash
export PATH=/usr/bin:/usr/local/bin:$PATH
cd /var/www/flynsw
npx tsx scripts/update-all.ts >> /var/log/flynsw-update.log 2>&1
