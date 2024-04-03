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

## How to check/override schedule?
We can check the current schedule by looking at state file at path: `/root/perfscale-jedi/current_jedi_schedule.txt` in our jump host. For example
```
[root@ocp-intlab-grafana perfscale-jedi]# cat current_jedi_schedule.txt 
['ancollin', 'liqcui', '2024-04-05 12:00:00', '2024-04-12 12:00:00']
['vzepedam', 'krvoora', '2024-04-12 12:00:00', '2024-04-19 12:00:00']
['mukrishn', 'sboyapal', '2024-04-19 12:00:00', '2024-04-26 12:00:00']
['lhorsley', 'rsevilla', '2024-04-26 12:00:00', '2024-05-03 12:00:00']
['vkommadi', 'msheth', '2024-05-03 12:00:00', '2024-05-10 12:00:00']
['rzaleski', 'jlema', '2024-05-10 12:00:00', '2024-05-17 12:00:00']
['prubenda', 'dsanzmor', '2024-05-17 12:00:00', '2024-05-24 12:00:00']
['sninganu', 'sahshah', '2024-05-24 12:00:00', '2024-05-31 12:00:00']
['svetsa', 'vchalla', '2024-05-31 12:00:00', '2024-06-07 12:00:00']
['skordas', 'smanda', '2024-06-07 12:00:00', '2024-06-14 12:00:00']
['qili', 'jtaleric', '2024-06-14 12:00:00', '2024-06-21 12:00:00']
```
In order to override the schedule, one can simply update this file's content. If interested in previous schedule, we can check it in `/root/perfscale-jedi/previous_jedi_schedule.txt` file.