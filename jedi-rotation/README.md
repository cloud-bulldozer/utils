# Jedi Rotation
Script to perform ocp perfscale jedi rotation.

## **Prerequisites**
* Python3 installation.
* Systemd installation.

## **How is this setup?**
Jump Host: `ocp-intlab-grafana.rdu2.scalelab.redhat.com`

We have a systemd timer setup that gets triggered on every friday evening to notify the perfscale group about jedi rotation.

**Systemd Timer**
```
[Unit]
Description=Perfscale Jedi Notifications Timer
Requires=perfscale-jedi-notifier.service

[Timer]
OnCalendar=Sat *-*-* 00:00:00
Unit=perfscale-jedi-notifier.service

[Install]
WantedBy=timers.target
```
This timer trigger a systemd service.

**Systemd Service**
```
[Unit]
Description=Perfscale Jedi Notifications Service
Wants=perfscale-jedi-notifier.timer

[Service]
Type=simple
User=root
WorkingDirectory=/root/perfscale-jedi
# This driver script can be found in the jump host: ocp-intlab-grafana.rdu2.scalelab.redhat.com. Hiding it as it has contains secrets.
ExecStart=/bin/bash perfscale-jedi-notifier.sh

[Install]
WantedBy=multi-user.target
```
This service unit triggers a script exposing the ENVs below used by the script to create/notify rotations.
```
export JEDI_LIST="ancollin,vzepedam,krvoora,vkommadi,rsevilla,msheth,jtaleric"
export PANDAWAN_LIST="vchalla,jose,svesta,prubenda"
export ROTATION_FILE="current_jedi_schedule.txt"
export CURRENT_DATE=$(date -d '2 days' "+%Y-%m-%d 12:00:00")
export WEBHOOK_URL="URL"
export HOSTNAME=$(hostname)
python3 /root/perfscale-jedi/perfscale-jedi-notifier.py
```

## How to check/override schedule?
We can check the current schedule by looking at state file at path: `/root/perfscale-jedi/current_jedi_schedule.txt` in our jump host.
```
['vzepedam', 'vchalla', '2024-01-01 12:00:00', '2024-01-08 12:00:00']
['ancollin', 'svesta', '2024-01-08 12:00:00', '2024-01-15 12:00:00']
['rsevilla', 'jose', '2024-01-15 12:00:00', '2024-01-22 12:00:00']
['krvoora', 'prubenda', '2024-01-22 12:00:00', '2024-01-29 12:00:00']
['msheth', 'vchalla', '2024-01-29 12:00:00', '2024-02-05 12:00:00']
['jtaleric', 'svesta', '2024-02-05 12:00:00', '2024-02-12 12:00:00']
['vkommadi', 'jose', '2024-02-12 12:00:00', '2024-02-19 12:00:00']
['vzepedam', 'prubenda', '2024-02-19 12:00:00', '2024-02-26 12:00:00']
```
In order to override the schedule, one can simply update this file's content. If interested in previous schedule, we can check it in `/root/perfscale-jedi/previous_jedi_schedule.txt` file.