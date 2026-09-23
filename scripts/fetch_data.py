"""
Fetch data from Sleeper API for league analysis
"""
import requests
import json
from typing import Dict, List, Any

LEAGUE_ID = "1323741311471194112"
BASE_URL = "https://api.sleeper.app/v1"

def fetch_league_info() -> Dict[str, Any]:
    """Fetch basic league information"""
    response = requests.get(f"{BASE_URL}/league/{LEAGUE_ID}")
    return response.json()

def fetch_users() -> List[Dict[str, Any]]:
    """Fetch all users in the league"""
    response = requests.get(f"{BASE_URL}/league/{LEAGUE_ID}/users")
    return response.json()

def fetch_rosters() -> List[Dict[str, Any]]:
    """Fetch all rosters in the league"""
    response = requests.get(f"{BASE_URL}/league/{LEAGUE_ID}/rosters")
    return response.json()

def fetch_matchups(week: int) -> List[Dict[str, Any]]:
    """Fetch matchups for a specific week"""
    response = requests.get(f"{BASE_URL}/league/{LEAGUE_ID}/matchups/{week}")
    return response.json()

def fetch_all_matchups(num_weeks: int = 14) -> Dict[int, List[Dict[str, Any]]]:
    """Fetch matchups for all weeks"""
    all_matchups = {}
    for week in range(1, num_weeks + 1):
        all_matchups[week] = fetch_matchups(week)
    return all_matchups

def create_user_map(users: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Create a mapping of user_id to user info"""
    return {user['user_id']: user for user in users}

def create_roster_to_user_map(rosters: List[Dict[str, Any]]) -> Dict[int, str]:
    """Create a mapping of roster_id to user_id (owner_id)"""
    return {roster['roster_id']: roster['owner_id'] for roster in rosters}

def main():
    """Fetch all data and save to JSON files"""
    print("Fetching league info...")
    league_info = fetch_league_info()

    print("Fetching users...")
    users = fetch_users()

    print("Fetching rosters...")
    rosters = fetch_rosters()

    print("Fetching matchups...")
    # Determine current week from league settings
    current_week = league_info.get('settings', {}).get('leg', 14)
    all_matchups = fetch_all_matchups(current_week)

    # Create mapping structures
    user_map = create_user_map(users)
    roster_to_user_map = create_roster_to_user_map(rosters)

    # Save all data
    data = {
        'league_info': league_info,
        'users': users,
        'rosters': rosters,
        'matchups': all_matchups,
        'user_map': user_map,
        'roster_to_user_map': roster_to_user_map
    }

    with open('league_data.json', 'w') as f:
        json.dump(data, f, indent=2)

    print(f"✓ Data saved to league_data.json")
    print(f"  - League: {league_info['name']}")
    print(f"  - Teams: {len(users)}")
    print(f"  - Weeks: {len(all_matchups)}")

if __name__ == "__main__":
    main()
