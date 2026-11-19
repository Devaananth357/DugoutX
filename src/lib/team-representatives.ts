export const TEAM_REPRESENTATIVES:Record<string,string>={
  CHE:"Kasi Viswanathan",
  MUM:"Nita Ambani",
  BLR:"Prathmesh Mishra",
  KOL:"Venky Mysore",
  DEL:"Parth Jindal",
  HYD:"Kavya Maran",
  PUN:"Preity Zinta",
  RAJ:"Manoj Badale",
  LKN:"Sanjiv Goenka",
  GUJ:"Siddharth Patel",
};

export function teamRepresentative(team:string){return TEAM_REPRESENTATIVES[team]??`${team} Management`;}
export const TEAM_DISPLAY_CODES:Record<string,string>={CHE:"CSK",MUM:"MI",BLR:"RCB",KOL:"KKR",DEL:"DC",HYD:"SRH",PUN:"PBKS",RAJ:"RR",LKN:"LSG",GUJ:"GT"};
export function displayTeamCode(team:string){return TEAM_DISPLAY_CODES[team]??team;}
