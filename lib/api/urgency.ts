// Track B2. Urgency vocabulary translation between frontend and DB.
// Frontend (Track B3 UrgencyFlag): info | routine | urgent | emergency
// DB (lib/db/schema urgencyEnum):  low  | normal  | high   | urgent
//
// The two `urgent` tokens are NOT the same value — frontend `urgent` maps to
// DB `high`; frontend `emergency` maps to DB `urgent`. Always map at the
// boundary; never compare raw strings across layers.

export type FeUrgency = "info" | "routine" | "urgent" | "emergency";
export type DbUrgency = "low" | "normal" | "high" | "urgent";

const FE_TO_DB: Readonly<Record<FeUrgency, DbUrgency>> = {
  info: "low",
  routine: "normal",
  urgent: "high",
  emergency: "urgent",
};

const DB_TO_FE: Readonly<Record<DbUrgency, FeUrgency>> = {
  low: "info",
  normal: "routine",
  high: "urgent",
  urgent: "emergency",
};

export function feToDb(fe: FeUrgency): DbUrgency {
  return FE_TO_DB[fe];
}

export function dbToFe(db: DbUrgency): FeUrgency {
  return DB_TO_FE[db];
}
