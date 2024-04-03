import random
import os
import sys
import datetime
import logging
import json
import requests

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)

logger = logging.getLogger('performance-jedi-notifier')

# Function to generate pairs
def generate_pairs(team_members):
    random.shuffle(team_members)
    
    full_path = os.path.join(os.getcwd(), f"previous_jedi_schedule.txt")
    try:
        with open(full_path, "r") as file:
            lines = file.readlines()
    except FileNotFoundError:
        return None

    last_two_week_members = [eval(lines[len(lines)-1])[0], eval(lines[len(lines)-1])[1], eval(lines[len(lines)-2])[0], eval(lines[len(lines)-2])[1]]
    print(last_two_week_members)
    result_list = list(filter(lambda x: x not in last_two_week_members, team_members))
    mid_index = len(result_list)//2
    result_list.insert(mid_index, last_two_week_members[3])
    result_list.insert(mid_index, last_two_week_members[1])
    result_list.insert(mid_index, last_two_week_members[2])
    result_list.insert(mid_index, last_two_week_members[0])

    pairs = []
    for idx in range(0, len(result_list), 2):
        if idx + 1 < len(result_list):
            pairs.append((result_list[idx], result_list[idx+1]))
    if (len(result_list) % 2 != 0):
        pairs.append((result_list[len(result_list)-1], result_list[0]))
    return pairs

# Function to get current jedi
def get_jedi(current_date, rotation_file):
    current_date = datetime.datetime.strptime(current_date, "%Y-%m-%d %H:%M:%S")
    full_path = os.path.join(os.getcwd(), rotation_file)
    try:
        with open(full_path, "r") as file:
            lines = file.readlines()
    except FileNotFoundError:
        return None

    for line in lines:
        data = eval(line.strip())
        start_date = datetime.datetime.strptime(data[2], "%Y-%m-%d %H:%M:%S")
        end_date = datetime.datetime.strptime(data[3], "%Y-%m-%d %H:%M:%S")
        
        if start_date <= current_date < end_date:
            logger.info(f"Current date: {current_date} falls under range {start_date} - {end_date}")
            return data
    os.rename(full_path, os.path.join(os.getcwd(), f"previous_jedi_schedule.txt"))
    return None

# Function to save rotation
def save_rotation(pairs, current_date, rotation_file):
    full_path = os.path.join(os.getcwd(), rotation_file)
    with open(full_path, "a") as file:
        for pair in pairs:
            end_date = (datetime.datetime.strptime(current_date, "%Y-%m-%d %H:%M:%S") + datetime.timedelta(weeks=1)).strftime("%Y-%m-%d %H:%M:%S")
            data = [pair[0], pair[1], current_date, end_date]
            current_date = end_date
            file.write(str(data) + "\n")

# Main function to generate and save the rotation for the week
def main():
    team_members = os.getenv("TEAM_MEMBERS")
    if not team_members:
        sys.exit("Environment variable TEAM_MEMBERS is not set")
    team_members = team_members.split(",")

    rotation_file = os.getenv("ROTATION_FILE", "current_jedi_schedule.txt")
    hostname = os.getenv("HOSTNAME")

    current_date = os.getenv("CURRENT_DATE")
    if not team_members:
        sys.exit("Environment variable CURRENT_DATE is not set")

    webhook_url = os.getenv("WEBHOOK_URL")
    if not webhook_url:
        sys.exit("Environment variable WEBHOOK_URL is not set")

    jedi = get_jedi(current_date, rotation_file)
    if jedi is None:
        pairs = generate_pairs(team_members)
        logger.info(pairs)
        save_rotation(pairs, current_date, rotation_file)
        jedi = get_jedi(current_date, rotation_file)

    logger.info(f"Jedi Info: {jedi}")
    message = (
        f"*Jedi Week:* {jedi[2]} - {jedi[3]}\n"
        f"*Jedi:* <@{jedi[0]}>, <@{jedi[1]}>\n"
        f"Please check */root/perfscale-jedi/current_jedi_schedule.txt* in the *host:{hostname}* for the entire rotation schedule"
    )
    payload = {
        "text": message
    }

    payload_json = json.dumps(payload)
    logger.info(f"notification message preview: {payload_json}")
    headers = {'Content-type': 'application/json'}
    response = requests.post(webhook_url, data=payload_json, headers=headers)
    if response.status_code == 200:
       logger.info("Message sent over slack successfully")
    else:
       logger.info(f"Failed to send message. Status code: {response.status_code}")
       logger.info(response.text)

# Driver code
if __name__ == "__main__":
    main()
