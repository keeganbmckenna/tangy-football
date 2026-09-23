/**
 * Application configuration with environment variable support
 */

/**
 * Sleeper API configuration
 */
export const SLEEPER_CONFIG = {
  /**
   * League ID - can be overridden via NEXT_PUBLIC_LEAGUE_ID environment variable
   * Default: Tangy Football league
   */
  leagueId: process.env.NEXT_PUBLIC_LEAGUE_ID || '1323741311471194112',

  /**
   * Base URL for Sleeper API
   */
  baseUrl: 'https://api.sleeper.app/v1',

  /**
   * Maximum number of weeks to fetch (regular season)
   */
  maxWeeks: 18,
} as const;

/**
 * Application metadata
 */
export const APP_CONFIG = {
  name: 'Tangy Football',
  description: 'Advanced fantasy football analytics and insights powered by Sleeper',
  author: 'Fantasy Football Analytics',
} as const;

/**
 * Cache configuration (in milliseconds)
 */
export const CACHE_CONFIG = {
  /**
   * Default cache duration for player data and FantasyCalc API (24 hours)
   */
  playerData: 24 * 60 * 60 * 1000,

  /**
   * League data revalidation (5 minutes)
   */
  leagueData: 300,

  /**
   * Transaction data revalidation (30 minutes)
   */
  transactionData: 1800,

  /**
   * Completed week matchups (1 day)
   */
  completedWeek: 86400,

  /**
   * Current week matchups (no cache - real-time)
   */
  currentWeek: 0,
} as const;

/**
 * API retry configuration
 */
export const RETRY_CONFIG = {
  /**
   * Maximum number of retry attempts for failed API calls
   */
  maxRetries: 4,

  /**
   * Initial delay between retries in milliseconds
   */
  initialDelay: 100,
} as const;
