export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar?: string;
  metadata?: {
    avatar?: string;
    team_name?: string;
  };
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[];
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    division?: number;
  };
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number;
  points: number;
  players_points?: Record<string, number>;
  starters?: string[];
  players?: string[];
}

export interface SleeperBracketFrom {
  w?: number;
  l?: number;
  m?: number;
  r?: number;
}

export interface SleeperBracketMatchup {
  r: number;
  m: number;
  t1?: number | null | SleeperBracketFrom;
  t2?: number | null | SleeperBracketFrom;
  t1_from?: SleeperBracketFrom | null;
  t2_from?: SleeperBracketFrom | null;
  w?: number | null;
  l?: number | null;
  p?: number | null;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  status: string;
  avatar?: string;
  metadata?: {
    division_1?: string;
    division_2?: string;
    division_3?: string;
  };
  settings?: {
    leg?: number;
    last_scored_leg?: number;
    divisions?: number;
    playoff_teams?: number;
    playoff_week_start?: number;
    playoff_type?: number;
    playoff_seed_type?: number;
    playoff_round_type?: number;
    start_week?: number;
    num_teams?: number;
  };
  bracket_id?: string | null;
  loser_bracket_id?: string | null;
  previous_league_id?: string | null;
  draft_id?: string | null;
  /** Lineup slots, e.g. ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', ...] */
  roster_positions?: string[];
}

// Draft Types
export interface SleeperDraft {
  draft_id: string;
  season: string;
  type: string;
  status: string;
  settings?: {
    teams?: number;
    rounds?: number;
    budget?: number;
  };
  /** Draft slot (as a string key) -> roster_id */
  slot_to_roster_id?: Record<string, number> | null;
}

export interface SleeperDraftPick {
  pick_no: number;
  round: number | null;
  draft_slot: number | null;
  player_id: string | null;
  /** user_id of the drafter */
  picked_by: string | null;
  metadata?: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
    /** Auction price, as a string */
    amount?: string;
  } | null;
}

/** One player's line from /stats/nfl/regular/{season}/{week} */
export interface SleeperPlayerWeekStats {
  gp?: number;
  pts_half_ppr?: number;
}

export interface LeagueData {
  league: SleeperLeague;
  users: SleeperUser[];
  rosters: SleeperRoster[];
  matchups: Record<number, SleeperMatchup[]>;
  userMap: Record<string, SleeperUser>;
  rosterToUserMap: Record<number, string>;
  lastScoredWeek: number;
  availableSeasons: string[];
  divisionNames?: Record<number, string>;
  winnersBracket?: SleeperBracketMatchup[] | null;
  losersBracket?: SleeperBracketMatchup[] | null;
}

export interface TeamStats {
  rosterId: number;
  teamName: string;
  username: string;
  wins: number;
  losses: number;
  ties: number;
  totalPoints: number;
  pointsAgainst: number;
  avgPoints: number;
  weeklyScores: number[];
  weeklyResults: ('W' | 'L' | 'T')[];
  weeklyOpponentScores: number[];
  standing: number;
  standingValue: number;
  division?: number;
  divisionName?: string;
  divisionRank?: number;
  isDivisionLeader?: boolean;
  avatarUrl?: string | null;
  gamesBack?: number;
  wildCardRank?: number;
  wildCardGamesOut?: number;
  // Performance breakdown metrics
  avgPointsInWins?: number;
  medianPointsInWins?: number;
  avgPointsInLosses?: number;
  medianPointsInLosses?: number;
  avgWinMargin?: number;
  medianWinMargin?: number;
  avgLossMargin?: number;
  medianLossMargin?: number;
}

export interface WeekMatchup {
  week: number;
  matchupId: number;
  team1: {
    name: string;
    username: string;
    points: number;
    rosterId: number;
  };
  team2: {
    name: string;
    username: string;
    points: number;
    rosterId: number;
  };
  winner?: 'team1' | 'team2' | 'tie';
}

export interface PlayEveryoneStats {
  username: string;
  teamName: string;
  actualWins: number;
  actualLosses: number;
  playAllWins: number;
  playAllLosses: number;
  difference: number;
}

export interface ScheduleSimulationOutcome {
  wins: number;
  count: number;
  frequency: number;
}

export interface ScheduleLuckDistribution {
  username: string;
  teamName: string;
  actualWins: number;
  outcomes: ScheduleSimulationOutcome[];
}

export interface ScheduleLuckSimulation {
  simulations: number;
  weeksSimulated: number;
  teams: ScheduleLuckDistribution[];
}

export interface WeeklyPlayAllRecord {
  week: number;
  wins: number;
  losses: number;
  winPct: number;
  actualResult?: 'W' | 'L' | 'T' | null;
}

export interface WeeklyPlayAllStats {
  username: string;
  teamName: string;
  weeklyRecords: WeeklyPlayAllRecord[];
  totalWins: number;
  totalLosses: number;
  overallWinPct: number;
}

export interface DivisionStanding {
  division: number;
  divisionName: string;
  teams: TeamStats[];
  leader: TeamStats;
}

export interface WildCardStanding {
  team: TeamStats;
  rank: number;
  gamesOut: number;
  isIn: boolean;
}

export interface LeagueSettings {
  regularSeasonStart: number;
  regularSeasonEnd: number;
  playoffStart: number;
  totalTeams: number;
  playoffTeams: number;
  divisions: number;
  hasToiletBowl: boolean;
  playoffDescription: string;
  toiletBowlDescription: string;
}

// Transaction Types
export interface SleeperTransaction {
  type: 'trade' | 'waiver' | 'free_agent';
  transaction_id: string;
  status: string;
  settings: {
    waiver_bid?: number;
  } | null;
  roster_ids: number[];
  metadata?: {
    notes?: string;
  };
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks?: Array<{
    season: string;
    round: number;
    roster_id: number;
    previous_owner_id: number;
    owner_id: number;
  }>;
  waiver_budget?: Array<{
    sender: number;
    receiver: number;
    amount: number;
  }>;
  created: number;
  status_updated: number;
  creator: string;
  consenter_ids: number[];
}

export interface ProcessedTransaction {
  id: string;
  type: 'add' | 'drop' | 'trade' | 'swap';
  week: number;
  timestamp: number;
  teamName: string;
  username: string;
  rosterId: number;
  playerId?: string;
  playerName?: string;
  waiverBid?: number;
  // For swap type (combined add+drop)
  droppedPlayerId?: string;
  droppedPlayerName?: string;
  // For trade type
  tradePartner?: string;
  tradePartnerTeamName?: string;
  tradeDetails?: {
    team1: {
      username: string;
      teamName: string;
      gives: string[];
      receives: string[];
      givesIds: string[];
      receivesIds: string[];
    };
    team2: {
      username: string;
      teamName: string;
      gives: string[];
      receives: string[];
      givesIds: string[];
      receivesIds: string[];
    };
  };
}

export interface TransactionStats {
  username: string;
  teamName: string;
  rosterId: number;
  totalTransactions: number;
  adds: number;
  drops: number;
  trades: number;
  totalWaiverSpent: number;
  bestPickup?: {
    playerName: string;
    week: number;
  };
}

export interface PlayerTradeValue {
  playerName: string;
  valueAtTrade: number | null;
  valueToday: number | null;
  gain: number | null;
  gainPercentage: number | null;
}

export interface TradeAnalysis {
  tradeId: string;
  status: 'success' | 'partial' | 'error';
  errorMessage?: string;

  team1: {
    gaveUpValueAtTrade: number;
    gaveUpValueToday: number;
    gaveUpGain: number;
    gaveUpGainPercentage: number;
    receivedValueAtTrade: number;
    receivedValueToday: number;
    receivedGain: number;
    receivedGainPercentage: number;
    tradeQuality: number; // receivedGain - gaveUpGain
    tradeQualityPercentage: number;
    players: PlayerTradeValue[];
  };

  team2: {
    gaveUpValueAtTrade: number;
    gaveUpValueToday: number;
    gaveUpGain: number;
    gaveUpGainPercentage: number;
    receivedValueAtTrade: number;
    receivedValueToday: number;
    receivedGain: number;
    receivedGainPercentage: number;
    tradeQuality: number; // receivedGain - gaveUpGain
    tradeQualityPercentage: number;
    players: PlayerTradeValue[];
  };

  winner: 'team1' | 'team2' | 'even';
  winMargin: number;
  analyzedAt: Date;
}

export interface TradeInfo {
  id: string;
  week: number;
  timestamp: number;
  team1: {
    username: string;
    teamName: string;
    rosterId: number;
    gives: string[]; // Player names
    receives: string[]; // Player names
    givesIds: string[]; // Sleeper player IDs
    receivesIds: string[]; // Sleeper player IDs
  };
  team2: {
    username: string;
    teamName: string;
    rosterId: number;
    gives: string[]; // Player names
    receives: string[]; // Player names
    givesIds: string[]; // Sleeper player IDs
    receivesIds: string[]; // Sleeper player IDs
  };
  analysis?: TradeAnalysis;
}
