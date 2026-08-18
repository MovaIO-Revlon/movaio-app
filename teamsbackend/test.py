import requests
import json
import datetime
from time import sleep

def call_teamdynamix_api():
    """
    Calls TeamDynamix API for 30 consecutive days and stores responses in JSON files
    """
    # API Configuration
    base_url = "https://newporthealthcare.teamdynamix.com/TDWebApi/api/288/tickets/search"
    headers = {
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6IkFQSV80NDQ1RkFDOS03NzY3LTQzRkItQUIxRC0xRDI4Q0JGRThDMTdfMTMxIiwidGR4X2VudGl0eSI6Ijg3IiwidGR4X3BhcnRpdGlvbiI6IjEwMDYiLCJuYmYiOjE3Nzk1NTMxNzksImV4cCI6MTc3OTYzOTU3OSwiaWF0IjoxNzc5NTUzMTc5LCJpc3MiOiJURCIsImF1ZCI6Imh0dHBzOi8vd3d3LnRlYW1keW5hbWl4LmNvbS8ifQ.UoSosrAaEQwMx4cLvCpOqMLmdodyLT9Bemum49y-aOA",  # Replace with your actual token
        "Content-Type": "application/json"
    }
    
    # Starting date (you can modify this as needed)
    start_date = datetime.date(2026, 1, 31)  # Starting from January 1, 2026
    
    # Storage for all responses
    all_responses = {}
    
    print(f"Starting API calls for 30 days from {start_date}")
    
    for day in range(30):
        # Calculate current date
        current_date = start_date + datetime.timedelta(days=day)
        next_date = current_date + datetime.timedelta(days=1)
        
        # Format dates for API
        from_date = current_date.strftime("%Y-%m-%d")
        to_date = next_date.strftime("%Y-%m-%d")
        
        # Request body
        request_body = {
            "CreatedDateFrom": from_date,
            "CreatedDateTo": to_date
        }
        
        print(f"Day {day + 1}/30: Fetching data for {from_date} to {to_date}")
        
        try:
            # Make API call
            response = requests.post(
                base_url,
                headers=headers,
                json=request_body,
                timeout=30
            )
            
            # Check if request was successful
            if response.status_code == 200:
                response_data = response.json()
                
                # Store response with date as key
                all_responses[from_date] = {
                    "date_range": f"{from_date} to {to_date}",
                    "status_code": response.status_code,
                    "data": response_data,
                    "timestamp": datetime.datetime.now().isoformat()
                }
                
                # Save individual daily response
                daily_filename = f"teamdynamix_response_{from_date}.json"
                with open(daily_filename, 'w', encoding='utf-8') as f:
                    json.dump(all_responses[from_date], f, indent=2, ensure_ascii=False)
                
                print(f"✓ Success: Data saved to {daily_filename}")
                
            else:
                error_info = {
                    "date_range": f"{from_date} to {to_date}",
                    "status_code": response.status_code,
                    "error": response.text,
                    "timestamp": datetime.datetime.now().isoformat()
                }
                all_responses[from_date] = error_info
                print(f"✗ Error {response.status_code}: {response.text}")
                
        except requests.exceptions.RequestException as e:
            error_info = {
                "date_range": f"{from_date} to {to_date}",
                "error": str(e),
                "timestamp": datetime.datetime.now().isoformat()
            }
            all_responses[from_date] = error_info
            print(f"✗ Request failed: {e}")
        
        # Add a small delay to avoid overwhelming the API
        sleep(20)
    
    # Save consolidated response file
    consolidated_filename = f"teamdynamix_consolidated_{start_date.strftime('%Y%m%d')}_30days.json"
    with open(consolidated_filename, 'w', encoding='utf-8') as f:
        json.dump(all_responses, f, indent=2, ensure_ascii=False)
    
    print(f"\n✓ All responses saved to {consolidated_filename}")
    print(f"✓ Individual daily files created for each day")
    print(f"✓ Processed {len(all_responses)} days")

def call_api_with_custom_date_range(start_date_str, days=30):
    """
    Alternative function with custom start date
    
    Args:
        start_date_str (str): Start date in format 'YYYY-MM-DD'
        days (int): Number of days to process
    """
    # API Configuration
    base_url = "https://newporthealthcare.teamdynamix.com/TDWebApi/api/288/tickets/search"
    headers = {
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6IkFQSV80NDQ1RkFDOS03NzY3LTQzRkItQUIxRC0xRDI4Q0JGRThDMTdfMTMxIiwidGR4X2VudGl0eSI6Ijg3IiwidGR4X3BhcnRpdGlvbiI6IjEwMDYiLCJuYmYiOjE3Nzk1NTMxNzksImV4cCI6MTc3OTYzOTU3OSwiaWF0IjoxNzc5NTUzMTc5LCJpc3MiOiJURCIsImF1ZCI6Imh0dHBzOi8vd3d3LnRlYW1keW5hbWl4LmNvbS8ifQ.UoSosrAaEQwMx4cLvCpOqMLmdodyLT9Bemum49y-aOA",  # Replace with your actual token
        "Content-Type": "application/json"
    }
    
    # Parse start date
    try:
        start_date = datetime.datetime.strptime(start_date_str, "%Y-%m-%d").date()
    except ValueError:
        print("Invalid date format. Please use YYYY-MM-DD")
        return
    
    # Storage for all responses
    all_responses = {}
    
    print(f"Starting API calls for {days} days from {start_date}")
    
    for day in range(days):
        # Calculate current date
        current_date = start_date + datetime.timedelta(days=day)
        next_date = current_date + datetime.timedelta(days=1)
        
        # Format dates for API
        from_date = current_date.strftime("%Y-%m-%d")
        to_date = next_date.strftime("%Y-%m-%d")
        
        # Request body
        request_body = {
            "CreatedDateFrom": from_date,
            "CreatedDateTo": to_date
        }
        
        print(f"Day {day + 1}/{days}: Fetching data for {from_date} to {to_date}")
        
        try:
            # Make API call
            response = requests.post(
                base_url,
                headers=headers,
                json=request_body,
                timeout=30
            )
            
            # Check if request was successful
            if response.status_code == 200:
                response_data = response.json()
                
                # Store response with date as key
                all_responses[from_date] = {
                    "date_range": f"{from_date} to {to_date}",
                    "status_code": response.status_code,
                    "data": response_data,
                    "timestamp": datetime.datetime.now().isoformat()
                }
                
                print(f"✓ Success: Retrieved data for {from_date}")
                
            else:
                error_info = {
                    "date_range": f"{from_date} to {to_date}",
                    "status_code": response.status_code,
                    "error": response.text,
                    "timestamp": datetime.datetime.now().isoformat()
                }
                all_responses[from_date] = error_info
                print(f"✗ Error {response.status_code}: {response.text}")
                
        except requests.exceptions.RequestException as e:
            error_info = {
                "date_range": f"{from_date} to {to_date}",
                "error": str(e),
                "timestamp": datetime.datetime.now().isoformat()
            }
            all_responses[from_date] = error_info
            print(f"✗ Request failed: {e}")
        
        # Add a small delay to avoid overwhelming the API
        sleep(1)
    
    # Save consolidated response file
    consolidated_filename = f"teamdynamix_consolidated_{start_date.strftime('%Y%m%d')}_{days}days.json"
    with open(consolidated_filename, 'w', encoding='utf-8') as f:
        json.dump(all_responses, f, indent=2, ensure_ascii=False)
    
    print(f"\n✓ All responses saved to {consolidated_filename}")
    print(f"✓ Processed {len(all_responses)} days")

if __name__ == "__main__":
    print("TeamDynamix API Data Fetcher")
    print("=" * 40)
    
    # Option 1: Use default settings (starts from 2026-04-01)
    # call_teamdynamix_api()
    
    # Option 2: Use custom start date and number of days
    start_date = input("Enter start date (YYYY-MM-DD) or press Enter for default (2026-01-31): ").strip()
    if not start_date:
        start_date = "2026-01-31"
    
    days_input = input("Enter number of days (default 30): ").strip()
    days = int(days_input) if days_input.isdigit() else 30
    
    call_api_with_custom_date_range(start_date, days)
