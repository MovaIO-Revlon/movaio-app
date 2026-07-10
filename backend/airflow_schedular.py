# backend/generate_dags.py
import requests
import os
from datetime import datetime

BASE_URL = "https://sdlcai.movatesolutions.com/devapi"   # Flask API
DAGS_DIR = r"\home\ec2-user\airflow\dags" # airflow_dags/

def to_cron(scheduleFrequency, schedulerTime):
    scheduleFrequency = (scheduleFrequency or "daily").lower()
    schedulerTime = schedulerTime or "00:00"

    try:
        t = datetime.strptime(schedulerTime.strip(), "%I:%M%p")
    except ValueError:
        try:
            t = datetime.strptime(schedulerTime.strip(), "%H:%M")
        except Exception:
            print(f"  Invalid time '{schedulerTime}', using 00:00")
            t = datetime.strptime("00:00", "%H:%M")

    minute = t.minute
    hour = t.hour

    if scheduleFrequency == "daily":
        return f"{minute} {hour} * * *"
    elif scheduleFrequency == "hourly":
        return f"{minute} * * * *"
    elif scheduleFrequency == "weekly":
        return f"{minute} {hour} * * 0"
    else:
        print(f"  Unknown frequency '{scheduleFrequency}', skipping.")
        return None


def fetch_agents():
    try:
        resp = requests.get(f"{BASE_URL}/getScheduledAgents")
        resp.raise_for_status()
        # Debug: Check response content
        #print(f"Response status: {resp.status_code}")
        #print(f"Response content: '{resp.text}'")        
        data = resp.json()
        return data.get("Data", [])
    except Exception as e:
        print(f"JSON decode error: {e}")
        print(f"Response text: '{resp.text}'")
        return []


def create_dag_file(agent):
    agent_id = agent["agent_id"]
    name = agent.get("name", "Unknown").strip()
    
    # === Sanitize name for filename (remove invalid chars) ===
    import re
    clean_name = re.sub(r'[<>:"/\\|?*]', '_', name)  # Replace bad chars
    clean_name = re.sub(r'\s+', '_', clean_name)     # Replace spaces with _
    clean_name = clean_name[:50]                     # Limit length

    # Extract frequency
    freq_raw = agent.get("scheduleFrequency", "")
    if isinstance(freq_raw, list) and freq_raw:
        freq_raw = freq_raw[0]
    elif isinstance(freq_raw, dict) and freq_raw:
        freq_raw = list(freq_raw.keys())[0]
    frequency = str(freq_raw).strip().lower() if freq_raw else "daily"

    # Extract time
    time_raw = agent.get("schedulerTime", "")
    scheduler_time = "00:00"

    if isinstance(time_raw, dict):
        if frequency in time_raw and "time" in time_raw[frequency]:
            scheduler_time = time_raw[frequency]["time"]
        elif "time" in time_raw:
            scheduler_time = time_raw["time"]
    elif isinstance(time_raw, str) and time_raw.strip():
        scheduler_time = time_raw.strip()
    elif time_raw is None:
        scheduler_time = "00:00"

    print(f"Processing: {name} ({agent_id}) → {frequency} at {scheduler_time}")

    cron = to_cron(frequency, scheduler_time)
    if not cron:
        print(f"  Skipping {agent_id}: invalid schedule")
        return

    # NEW FILENAME: agent_id + clean_name
    dag_id = f"agent_{agent_id}_{clean_name}_scheduler"
    filename = os.path.join(DAGS_DIR, f"{dag_id}.py")

    content = f'''\
from airflow import DAG
from airflow.operators.python import PythonOperator
from datetime import datetime, timedelta
import requests, logging

BASE_URL = "{BASE_URL}"

default_args = {{
    'owner': 'airflow',
    'depends_on_past': False,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}}

def run_chatbot_agent():
    try:
        payload = {{
            "userQuery": "Scheduled run for agent {agent_id}",
            "agent_id": "{agent_id}",
            "master_agent_id": "",
            "user_id": "system_scheduler"
        }}
        resp = requests.post(f"{{BASE_URL}}/chatbotagent", json=payload)
        resp.raise_for_status()
        logging.info("Agent {agent_id} executed successfully.")
    except Exception as e:
        logging.error(f"Error running agent {agent_id}: {{str(e)}}")

dag = DAG(
    dag_id="{dag_id}",
    default_args=default_args,
    description="Scheduled run for {name}",
    schedule="{cron}",
    start_date=datetime(2025, 1, 1),
    catchup=False,
    tags=["scheduler", "agent"],
)

task = PythonOperator(
    task_id="run_agent",
    python_callable=run_chatbot_agent,
    dag=dag,
)

# Dependency (only one task here)
task    
'''

    try:
        os.makedirs(DAGS_DIR, exist_ok=True)
        with open(filename, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  Created: {filename}")
    except Exception as e:
        print(f"  Failed to write {filename}: {e}")


if __name__ == "__main__":
    # Optional: Test with mock data
    # create_dag_file({
    #     "agent_id": "test123",
    #     "name": "Mock Agent",
    #     "scheduleFrequency": ["daily"],
    #     "schedulerTime": {"daily": {"time": "14:30"}}
    # })

    agents = fetch_agents()
    for agent in agents:
        create_dag_file(agent)