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
export TEAM_MEMBERS="ancollin,vzepedam,krvoora,vkommadi,rsevilla,msheth,jtaleric,rzaleski,mukrishn,dsanzmor,vchalla,jlema,svetsa,prubenda,sboyapal,smanda,sahshah,qili,liqcui,lhorsley,skordas,sninganu"
export ROTATION_FILE="current_jedi_schedule.txt"
export CURRENT_DATE=$(date -d '2 days' "+%Y-%m-%d 12:00:00")
export WEBHOOK_URL="URL"
export HOSTNAME=$(hostname)
python3 /root/perfscale-jedi/perfscale-jedi-notifier.py
```

## How to check schedule?
Please login [here](http://ocp-intlab-grafana.rdu2.scalelab.redhat.com:3030/) to view the rotation schedule.

## How to override the schedule?
In order to override the schedule, please update the below files with appropriate user IDs in our jump host.
* `/root/perfscale-jedi/current_jedi_schedule.txt`
* `/usr/share/nginx/html/perfscale_jedi/index.html`

If you wish to notify others about the update, please run the below commands afterwards.
```
cd /root/perfscale-jedi; sh perfscale-jedi-notifier.sh
```