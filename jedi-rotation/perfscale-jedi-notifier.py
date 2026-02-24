import json
import os
import random
import sys
import datetime
import logging
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

MEMBERS_PER_SLOT = int(os.getenv("MEMBERS_PER_SLOT", 3))

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)

logger = logging.getLogger('performance-jedi-notifier')


def load_last_rotation(full_path):
    """Load last_rotation.json; return dict domain -> list of member ids."""
    try:
        with open(full_path, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        return {}


def save_last_rotation(full_path, data):
    """Save last_rotation.json (domain -> members)."""
    with open(full_path, "w") as f:
        json.dump(data, f, indent=2)


def pick_three_members(domain, team_members_by_group, last_rotation_for_domain, all_members_list):
    """
    Pick exactly 3 members for this domain. Prefer members not in last rotation; if not enough, reuse.
    If domain has < 3 members, fill from other domains at random.
    """
    domain_members = list(team_members_by_group.get(domain, []))
    other_list = [m for m in all_members_list if m not in domain_members]
    pool = list(domain_members)
    while len(pool) < MEMBERS_PER_SLOT and other_list:
        idx = random.randrange(len(other_list))
        pool.append(other_list.pop(idx))
    last_set = set(last_rotation_for_domain or [])
    preferred = [m for m in pool if m not in last_set]
    rest = [m for m in pool if m in last_set]
    if len(preferred) >= MEMBERS_PER_SLOT:
        chosen = random.sample(preferred, MEMBERS_PER_SLOT)
    else:
        chosen = preferred + rest
        chosen = chosen[:MEMBERS_PER_SLOT]
    return chosen


def assign_members_to_schedule(ordered_schedule, team_members_by_group, last_rotation_path):
    """
    Assign 3 members to each slot that doesn't already have 3. Prefer not in last rotation; update and save last_rotation.json.
    Returns schedule with "members" key per entry.
    """
    full_path = os.path.join(os.getcwd(), last_rotation_path)
    last_rotation = load_last_rotation(full_path)
    all_members_list = [m for members in team_members_by_group.values() for m in members]

    for entry in ordered_schedule:
        if entry.get("members") and len(entry["members"]) == MEMBERS_PER_SLOT:
            continue
        domain = entry["domain"]
        last_for_domain = last_rotation.get(domain, [])
        members = pick_three_members(domain, team_members_by_group, last_for_domain, all_members_list)
        entry["members"] = members
        last_rotation[domain] = members

    save_last_rotation(full_path, last_rotation)
    return ordered_schedule


# Function to reschedule past entries: move all slots with end_date < current_date to the end with new dates
def reschedule_past_entries(ordered_schedule, current_date):
    if not ordered_schedule:
        return ordered_schedule
    current_dt = datetime.datetime.strptime(current_date, "%Y-%m-%d %H:%M:%S")

    past = []
    future = []
    for e in ordered_schedule:
        end_dt = datetime.datetime.strptime(e["end_date"], "%Y-%m-%d %H:%M:%S")
        if end_dt < current_dt:
            past.append(e)
        else:
            future.append(e)

    if not past:
        return ordered_schedule

    # New dates for past entries start the week after the last end_date in the schedule
    last_end_dt = max(datetime.datetime.strptime(e["end_date"], "%Y-%m-%d %H:%M:%S") for e in ordered_schedule)
    rescheduled = []
    for e in past:
        start_dt = last_end_dt
        end_dt = start_dt + datetime.timedelta(weeks=1)
        rescheduled.append({
            "domain": e["domain"],
            "start_date": start_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "end_date": end_dt.strftime("%Y-%m-%d %H:%M:%S"),
        })
        last_end_dt = end_dt

    return future + rescheduled

# Function to build or rotate schedule: list of {domain, start_date, end_date} ordered by start_date
def rotate(ordered_schedule, team_members_by_group, current_date=None, index=None):
    domains = list(team_members_by_group.keys())
    if index is None:
        if not current_date:
            current_date = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        result = []
        for d in domains:
            start_dt = datetime.datetime.strptime(current_date, "%Y-%m-%d %H:%M:%S")
            end_dt = start_dt + datetime.timedelta(weeks=1)
            result.append({"domain": d, "start_date": start_dt.strftime("%Y-%m-%d %H:%M:%S"), "end_date": end_dt.strftime("%Y-%m-%d %H:%M:%S")})
            current_date = end_dt.strftime("%Y-%m-%d %H:%M:%S")
        return result
    # Reorder existing schedule so domain at index is first
    if not ordered_schedule or index is None or index >= len(ordered_schedule):
        return ordered_schedule
    return ordered_schedule[index:] + ordered_schedule[:index]

# Function to get current jedi: load schedule JSON, order by start date, return ordered schedule and current domain
def get_jedi(current_date, rotation_file):
    current_dt = datetime.datetime.strptime(current_date, "%Y-%m-%d %H:%M:%S")
    full_path = os.path.join(os.getcwd(), rotation_file)
    try:
        with open(full_path, "r") as f:
            schedule_by_domain = json.load(f)
    except FileNotFoundError:
        return [], None, None
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in {rotation_file}: {e}")
        return [], None, None

    # Flatten to list of {domain, start_date, end_date, members?} (one entry per domain slot)
    ordered = []
    for domain, slots in schedule_by_domain.items():
        for slot in slots:
            entry = {
                "domain": domain,
                "start_date": slot["start_date"],
                "end_date": slot["end_date"],
            }
            if "members" in slot:
                entry["members"] = slot["members"]
            ordered.append(entry)

    # Order by start date
    ordered.sort(key=lambda e: e["start_date"])

    current_domain = None
    current_index = None
    for idx, entry in enumerate(ordered):
        start_dt = datetime.datetime.strptime(entry["start_date"], "%Y-%m-%d %H:%M:%S")
        end_dt = datetime.datetime.strptime(entry["end_date"], "%Y-%m-%d %H:%M:%S")
        if start_dt <= current_dt < end_dt:
            current_domain = entry["domain"]
            current_index = idx
            logger.info(f"Current date: {current_dt} falls under range {start_dt} - {end_dt}")
            logger.info(f"Current domain: {current_domain}, index: {idx}")
            break

    return ordered, current_domain, current_index

# Function to save rotation (writes schedule as JSON grouped by domain)
def save_rotation(ordered_schedule, current_date, rotation_file):
    full_path = os.path.join(os.getcwd(), rotation_file)
    schedule_by_domain = {}
    for entry in ordered_schedule:
        d = entry["domain"]
        if d not in schedule_by_domain:
            schedule_by_domain[d] = []
        slot = {"start_date": entry["start_date"], "end_date": entry["end_date"]}
        if "members" in entry:
            slot["members"] = entry["members"]
        schedule_by_domain[d].append(slot)
    with open(full_path, "w") as f:
        json.dump(schedule_by_domain, f, indent=2)

# Function to save rotation and generate stylish, responsive HTML table
def save_rotation_html(pairs, current_date, rotation_file, current_jedi_pair, team_members_by_group=None):
    full_path = os.path.join(os.getcwd(), rotation_file)
    with open(full_path, "w") as file:
        file.write("""
        <html>
        <head>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background-color: #f9f9f9;
                }
                h2 {
                    text-align: center;
                    color: #333333;
                    margin: 0;
                    font-size: 28px;
                    border: 2px solid #333333;
                    padding: 10px 0px;
                    background-color: #f9f9f9;
                }
                table {
                    width: 100%;
                    font-family: Arial, sans-serif;
                    border-collapse: collapse;
                }
                th, td {
                    border: 1px solid #dddddd;
                    text-align: left;
                    padding: 12px 15px;
                }
                tr:nth-child(even) {
                    background-color: #f2f2f2;
                }
                th {
                    background-color: #04AA6D;
                    color: white;
                }
                tr:hover {
                    background-color: #f1f1f1; /* Hover effect for table rows */
                }
                .highlight {
                    border: 3px solid #FFCD00; /* Highlight border for current Jedi */
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <h2>PerfScale Jedi Rotation Schedule</h2>
            <table>
                <tr>
                    <th>Domain</th>
                    <th>Members</th>
                    <th>Start Date</th>
                    <th>End Date</th>
                </tr>
        """)  # Start of the HTML file and table

        for entry in pairs:
            domain = entry["domain"]
            start_date = entry["start_date"]
            end_date = entry["end_date"]
            members = entry.get("members", [])
            members_str = ", ".join(members) if members else "—"
            is_current = (current_jedi_pair and current_jedi_pair.get("domain") == domain and
                         current_jedi_pair.get("start_date") == start_date)
            row_class = "highlight" if is_current else ""
            data_row = f"<tr class='{row_class}'><td>{domain}</td><td>{members_str}</td><td>{start_date}</td><td>{end_date}</td></tr>"
            file.write(data_row + "\n")  # Write each row of data to the HTML table

        # Close the table and HTML structure
        file.write("""
            </table>
        </body>
        </html>
        """)

# Main function to generate and save the rotation for the week
def main():
    team_members_file = os.getenv("TEAM_MEMBERS_FILE")
    if not team_members_file:
        sys.exit("Environment variable TEAM_MEMBERS_FILE is not set")
    with open(team_members_file, "r") as f:
        team_members_by_group = json.load(f)
    team_members = [m for members in team_members_by_group.values() for m in members]

    rotation_file = os.getenv("ROTATION_FILE", "current_jedi_schedule.json")
    rotation_html_file = os.getenv("ROTATION_HTML_FILE", "/usr/share/nginx/html/perfscale_jedi/index.html")
    last_rotation_file = os.getenv("LAST_ROTATION_FILE", "last_rotation.json")
    hostname = os.getenv("HOSTNAME")

    current_date = os.getenv("CURRENT_DATE")
    if not current_date:
        sys.exit("Environment variable CURRENT_DATE is not set")

    ordered_schedule, current_domain, current_index = get_jedi(current_date, rotation_file)

    # Always run rotation: reschedule any past entries to new dates at the end, or build initial schedule if empty
    if not ordered_schedule:
        ordered_schedule = rotate(ordered_schedule, team_members_by_group, current_date)
        ordered_schedule = assign_members_to_schedule(ordered_schedule, team_members_by_group, last_rotation_file)
        save_rotation(ordered_schedule, current_date, rotation_file)
        logger.info("New rotation set (initial schedule):")
        for entry in ordered_schedule:
            logger.info(f"  {entry['domain']}: {entry.get('members', [])}")
    else:
        rescheduled = reschedule_past_entries(ordered_schedule, current_date)
        if rescheduled != ordered_schedule:
            rescheduled = assign_members_to_schedule(rescheduled, team_members_by_group, last_rotation_file)
            save_rotation(rescheduled, current_date, rotation_file)
            logger.info("New rotation set (past entries rescheduled with members):")
            for entry in rescheduled:
                logger.info(f"  {entry['domain']}: {entry.get('members', [])}")
            ordered_schedule = rescheduled
        else:
            # Backfill members for any slot missing 3 members (e.g. old schedule format)
            need_members = any(not entry.get("members") or len(entry.get("members", [])) != MEMBERS_PER_SLOT for entry in ordered_schedule)
            if need_members:
                ordered_schedule = assign_members_to_schedule(ordered_schedule, team_members_by_group, last_rotation_file)
                save_rotation(ordered_schedule, current_date, rotation_file)
                logger.info("New rotation set (members assigned to schedule):")
                for entry in ordered_schedule:
                    logger.info(f"  {entry['domain']}: {entry.get('members', [])}")

    ordered_schedule, current_domain, current_index = get_jedi(current_date, rotation_file)
    current_slot = ordered_schedule[current_index] if current_index is not None else None
    members = current_slot.get("members", team_members_by_group.get(current_domain, [])) if current_slot else []
    jedi = (current_domain, members, current_slot["start_date"], current_slot["end_date"]) if current_slot else None
    save_rotation_html(ordered_schedule, current_date, rotation_html_file, current_slot, team_members_by_group)

    logger.info(f"Jedi Info: {jedi}")
    slack_token = os.getenv("SLACK_BOT_TOKEN")
    channel_id = os.getenv("SLACK_CHANNEL_ID")
    if not slack_token or not channel_id:
        sys.exit("Environment variables SLACK_BOT_TOKEN or SLACK_CHANNEL_ID are not set")

    slack_client = WebClient(token=slack_token)
    if not current_slot:
        sys.exit("No current rotation slot found")
    jedi_mentions = ", ".join(f"<@{m}>" for m in members) if members else "—"
    message = (
        f"*Jedi Week:* {current_slot['start_date']} - {current_slot['end_date']}\n"
        f"*Domain:* {current_domain}\n"
        f"*Jedi:* {jedi_mentions}\n"
        f"Please click <http://ocp-intlab-grafana.rdu2.scalelab.redhat.com:3030|here> to view rotation schedule"
    )

    logger.info(f"notification message preview: {message}")
    try:
        logger.info("Sending Slack message using bot token")
        response = slack_client.chat_postMessage(
            channel=channel_id,
            text=message
        )
        logger.info(f"Message sent. Slack response ts: {response['ts']}")
    except SlackApiError as e:
        logger.error(f"Slack API Error: {e.response['error']}")

# Driver code
if __name__ == "__main__":
    main()
