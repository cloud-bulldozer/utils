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
        pairs.append((result_list[len(result_list)-1], result_list[mid_index]))
    return pairs

# Function to get current jedi
def get_jedi(current_date, rotation_file):
    current_date = datetime.datetime.strptime(current_date, "%Y-%m-%d %H:%M:%S")
    full_path = os.path.join(os.getcwd(), rotation_file)
    try:
        with open(full_path, "r") as file:
            lines = file.readlines()
    except FileNotFoundError:
        return None, None

    index = None
    pairs = []
    for idx, line in enumerate(lines):
        data = eval(line.strip())
        start_date = datetime.datetime.strptime(data[2], "%Y-%m-%d %H:%M:%S")
        end_date = datetime.datetime.strptime(data[3], "%Y-%m-%d %H:%M:%S")
        pairs.append([data[0], data[1], data[2], data[3]])
        
        if start_date <= current_date < end_date:
            logger.info(f"Current date: {current_date} falls under range {start_date} - {end_date}")
            index = idx
    if index is not None:
        return pairs, index
    else:
        os.rename(full_path, os.path.join(os.getcwd(), f"previous_jedi_schedule.txt"))
        return None, None

# Function to save rotation
def save_rotation(pairs, current_date, rotation_file):
    full_path = os.path.join(os.getcwd(), rotation_file)
    with open(full_path, "w") as file:
        for pair in pairs:
            end_date = (datetime.datetime.strptime(current_date, "%Y-%m-%d %H:%M:%S") + datetime.timedelta(weeks=1)).strftime("%Y-%m-%d %H:%M:%S")
            data = [pair[0], pair[1], current_date, end_date]
            current_date = end_date
            file.write(str(data) + "\n")

# Function to save rotation and generate stylish, responsive HTML table
def save_rotation_html(pairs, current_date, rotation_file, current_jedi_pair):
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
                    <th>Jedi 1</th>
                    <th>Jedi 2</th>
                    <th>Start Date</th>
                    <th>End Date</th>
                </tr>
        """)  # Start of the HTML file and table

        for pair in pairs:
            end_date = (datetime.datetime.strptime(current_date, "%Y-%m-%d %H:%M:%S") + datetime.timedelta(weeks=1)).strftime("%Y-%m-%d %H:%M:%S")
            
            # Conditional check for highlighting the current Jedi pair with a border
            if pair == current_jedi_pair:
                data_row = f"<tr class='highlight'><td>{pair[0]}</td><td>{pair[1]}</td><td>{current_date}</td><td>{end_date}</td></tr>"
            else:
                data_row = f"<tr><td>{pair[0]}</td><td>{pair[1]}</td><td>{current_date}</td><td>{end_date}</td></tr>"
            
            current_date = end_date
            file.write(data_row + "\n")  # Write each row of data to the HTML table

        # Close the table and HTML structure
        file.write("""
            </table>
        </body>
        </html>
        """)

# Main function to generate and save the rotation for the week
def main():
    team_members = os.getenv("TEAM_MEMBERS")
    if not team_members:
        sys.exit("Environment variable TEAM_MEMBERS is not set")
    team_members = team_members.split(",")

    rotation_file = os.getenv("ROTATION_FILE", "current_jedi_schedule.txt")
    rotation_html_file = os.getenv("ROTATION_HTML_FILE", "/usr/share/nginx/html/perfscale_jedi/index.html")
    hostname = os.getenv("HOSTNAME")

    current_date = os.getenv("CURRENT_DATE")
    if not team_members:
        sys.exit("Environment variable CURRENT_DATE is not set")

    webhook_url = os.getenv("WEBHOOK_URL")
    if not webhook_url:
        sys.exit("Environment variable WEBHOOK_URL is not set")

    pairs, idx = get_jedi(current_date, rotation_file)
    if idx is None:
        pairs = generate_pairs(team_members)
        save_rotation(pairs, current_date, rotation_file)
        pairs, idx = get_jedi(current_date, rotation_file)
    jedi = pairs[idx]
    if idx != 0:
        rotated_pairs = pairs[idx:] + pairs[:idx]
        rotated_pairs[len(rotated_pairs)-2][0], rotated_pairs[len(rotated_pairs)-1][1] = rotated_pairs[len(rotated_pairs)-1][1], rotated_pairs[len(rotated_pairs)-2][0]
        save_rotation(rotated_pairs, rotated_pairs[0][2], rotation_file)
        pairs, idx = get_jedi(rotated_pairs[0][2], rotation_file)
        save_rotation_html(pairs, rotated_pairs[0][2], rotation_html_file, jedi)
    else:
        save_rotation_html(pairs, jedi[2], rotation_html_file, jedi)

    logger.info(f"Jedi Info: {jedi}")
    message = (
        f"*Jedi Week:* {jedi[2]} - {jedi[3]}\n"
        f"*Jedi:* <@{jedi[0]}>, <@{jedi[1]}>\n"
        f"Please click <http://ocp-intlab-grafana.rdu2.scalelab.redhat.com:3030|here> to view rotation schedule"
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
