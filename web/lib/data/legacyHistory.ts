/**
 * The league before Sleeper (2017-2021): final regular-season standings and
 * the top three finishers, transcribed from the old platform's history page.
 * There are no weekly scores, so these seasons count toward records, titles
 * and finishes but not head to head, points or game records.
 *
 * Owners are Sleeper display names (matched case-insensitively), or a plain
 * name for someone who never played on Sleeper.
 */

export interface LegacyTeam {
  owner: string;
  teamName: string;
  wins: number;
  losses: number;
  /** Final standings position on the old platform's history page */
  rank: number;
  /** 1 = champion, 2 = runner-up, 3 = third place */
  finish?: 1 | 2 | 3;
}

export interface LegacySeason {
  season: string;
  teams: LegacyTeam[];
}

/** Managers' first names, by Sleeper display name (or plain name) */
export const MANAGER_FIRST_NAMES: Record<string, string> = {
  shivvv: 'Shiv',
  A_Schoell: 'Aidan',
  BradysOldCheeks: 'Jonathan',
  bergenjay: 'Bergen',
  kbmckenna: 'Keegan',
  jberrysmoothie: 'Jon',
  dezdroppedit27: 'Caleb',
  bigbuttboi: 'Cam',
  lublub22: 'Lucas',
  RTred: 'Reid',
  ThePaulBufano: 'Tristian',
  KickWazowski: 'Luan',
  tchoezin: 'Choezin',
  richardholt: 'Richard',
  Vikram: 'Vikram',
};

const t = (rank: number, teamName: string, record: string, owner: string, finish?: 1 | 2 | 3): LegacyTeam => {
  const [wins, losses] = record.split('-').map(Number);
  return { owner, teamName, wins, losses, rank, ...(finish ? { finish } : {}) };
};

export const LEGACY_SEASONS: LegacySeason[] = [
  {
    season: '2021',
    teams: [
      t(1, 'Suisauce Squad', '11-3', 'shivvv', 3),
      t(2, 'Ekeler I barely know her', '9-5', 'A_Schoell'),
      t(3, 'Who’s Cookin Travy Patties', '9-5', 'BradysOldCheeks', 2),
      t(4, 'Tyler Higbee Look-alike Club', '8-6', 'bergenjay'),
      t(5, 'Butker Right in the P', '8-6', 'kbmckenna', 1),
      t(6, 'Highway to Hellmann’s', '6-8', 'jberrysmoothie'),
      t(7, 'Bass Pro Shops', '6-8', 'dezdroppedit27'),
      t(8, 'james robinyouofawinson', '5-9', 'bigbuttboi'),
      t(9, 'Bass Fishin’', '5-9', 'lublub22'),
      t(10, '7th Place Champion', '3-11', 'RTred'),
    ],
  },
  {
    season: '2020',
    teams: [
      t(1, 'Mayolord', '12-1', 'lublub22', 3),
      t(2, 'Buddhist Mccaffrey', '9-4', 'dezdroppedit27', 1),
      t(3, 'Yayo McMayo', '8-5', 'jberrysmoothie'),
      t(4, 'Cactus Jack Sent Me', '7-6', 'RTred', 2),
      t(5, 'Team Mayomust', '6-7', 'shivvv'),
      t(6, 'Baba Barkley', '5-8', 'BradysOldCheeks'),
      t(7, 'DJ Shark', '5-8', 'bergenjay'),
      t(8, 'Fantasy Football Team', '5-8', 'kbmckenna'),
      t(9, 'Michael the Tank Engine', '4-9', 'bigbuttboi'),
      t(10, 'Would you like an Ertz Donut', '4-9', 'A_Schoell'),
    ],
  },
  {
    season: '2019',
    teams: [
      t(1, 'BetterIngredients Better Pizza', '8-5', 'A_Schoell', 3),
      t(2, 'Saquon deez nuts', '8-5', 'BradysOldCheeks'),
      t(3, 'Jordan BELLfort', '8-5', 'dezdroppedit27', 1),
      t(4, 'I Am Speed', '8-5', 'shivvv', 2),
      t(5, 'Three Headed Snake', '7-6', 'lublub22'),
      t(6, 'We Were On A Bye', '6-7', 'bigbuttboi'),
      t(7, 'The Chicken Chokin’ Champs', '5-8', 'jberrysmoothie'),
      t(8, 'Case', '5-8', 'kbmckenna'),
      t(9, 'Chef Dalvin', '5-8', 'bergenjay'),
      t(10, 'Full Chubb', '5-8', 'RTred'),
    ],
  },
  {
    season: '2018',
    teams: [
      t(1, 'The Dickriders', '11-3', 'shivvv', 1),
      t(2, 'BetterIngredients Better Pizza', '10-4', 'A_Schoell'),
      t(3, 'The Cunning Stunts', '9-5', 'kbmckenna', 2),
      t(4, 'Crab Island', '8-6', 'dezdroppedit27', 3),
      t(5, 'bill clinton', '8-6', 'bergenjay'),
      t(6, 'GULPIN Deez Nuts', '7-7', 'lublub22'),
      t(7, 'Cam’s Mom', '6-8', 'RTred'),
      t(8, 'Fuck Ya Chicken Strips', '4-10', 'jberrysmoothie'),
      t(9, 'Sharky Socks', '4-10', 'bigbuttboi'),
      t(10, 'The Bell-Ends', '3-11', 'BradysOldCheeks'),
    ],
  },
  {
    season: '2017',
    teams: [
      t(1, 'UVM Epiphany', '12-2', 'bergenjay', 2),
      t(2, 'Boner City', '11-3', 'bigbuttboi', 1),
      t(3, 'The Lil’ Reds', '8-6', 'Vikram'),
      t(4, 'Lick Lick Lick my Balls', '8-6', 'A_Schoell', 3),
      t(5, 'The Wayfinders', '6-8', 'shivvv'),
      t(6, 'Cam’s Competition', '5-9', 'jberrysmoothie'),
      t(7, 'Pit Bulls to Baboons', '5-9', 'dezdroppedit27'),
      t(8, 'Lemme Lickilicky That Ass', '5-9', 'lublub22'),
      t(9, 'The Argonaugts', '5-9', 'BradysOldCheeks'),
      t(10, 'Vikram’s dirty asshole', '5-9', 'RTred'),
    ],
  },
];
