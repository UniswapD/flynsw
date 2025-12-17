import { pgTable, uuid, varchar, integer, real, text, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';

export const sites = pgTable('sites', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  region: varchar('region', { length: 100 }).notNull(),
  launchLat: real('launch_lat').notNull(),
  launchLon: real('launch_lon').notNull(),
  launchElevation: integer('launch_elevation'),
  landingLat: real('landing_lat'),
  landingLon: real('landing_lon'),
  idealWindDirection: integer('ideal_wind_direction').notNull(),
  windSectorStart: integer('wind_sector_start').notNull(),
  windSectorEnd: integer('wind_sector_end').notNull(),
  minWindSpeed: integer('min_wind_speed').default(8),
  maxWindSpeedPg2: integer('max_wind_speed_pg2').default(14),
  maxWindSpeedPg3: integer('max_wind_speed_pg3').default(16),
  maxWindSpeedPg4: integer('max_wind_speed_pg4').default(20),
  maxWindSpeedPg5: integer('max_wind_speed_pg5').default(24),
  minRating: varchar('min_rating', { length: 10 }).notNull().default('PG2'),
  requiresSupervision: boolean('requires_supervision').default(false),
  requiresRadio: boolean('requires_radio').default(false),
  requiresInduction: boolean('requires_induction').default(false),
  description: text('description'),
  hazards: text('hazards'),
  siteGuideUrl: varchar('site_guide_url', { length: 500 }),
  webcamUrl: varchar('webcam_url', { length: 500 }),
  weatherStationUrl: varchar('weather_station_url', { length: 500 }),
  adminClub: varchar('admin_club', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const forecasts = pgTable('forecasts', {
  id: uuid('id').defaultRandom().primaryKey(),
  siteId: uuid('site_id').references(() => sites.id).notNull(),
  forecastTime: timestamp('forecast_time').notNull(),
  fetchedAt: timestamp('fetched_at').defaultNow(),
  provider: varchar('provider', { length: 50 }).notNull(),
  windSpeed: real('wind_speed'),
  windDirection: integer('wind_direction'),
  windGust: real('wind_gust'),
  temperature: real('temperature'),
  precipitation: real('precipitation'),
  precipitationProbability: integer('precipitation_probability'),
  cloudCover: integer('cloud_cover'),
  rawData: jsonb('raw_data'),
});

export const scores = pgTable('scores', {
  id: uuid('id').defaultRandom().primaryKey(),
  siteId: uuid('site_id').references(() => sites.id).notNull(),
  forecastTime: timestamp('forecast_time').notNull(),
  calculatedAt: timestamp('calculated_at').defaultNow(),
  scorePg2: integer('score_pg2'),
  scorePg3: integer('score_pg3'),
  scorePg4: integer('score_pg4'),
  scorePg5: integer('score_pg5'),
  labelPg2: varchar('label_pg2', { length: 20 }),
  labelPg3: varchar('label_pg3', { length: 20 }),
  labelPg4: varchar('label_pg4', { length: 20 }),
  labelPg5: varchar('label_pg5', { length: 20 }),
  reasonsPg2: jsonb('reasons_pg2'),
  reasonsPg3: jsonb('reasons_pg3'),
  reasonsPg4: jsonb('reasons_pg4'),
  reasonsPg5: jsonb('reasons_pg5'),
  windAngleOff: real('wind_angle_off'),
  crossComponent: real('cross_component'),
  gustSpread: real('gust_spread'),
  confidence: integer('confidence'),
});

export const pilotPreferences = pgTable('pilot_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: varchar('session_id', { length: 255 }).notNull().unique(),
  rating: varchar('rating', { length: 10 }).notNull().default('PG3'),
  conservatism: varchar('conservatism', { length: 20 }).notNull().default('normal'),
  homeLat: real('home_lat'),
  homeLon: real('home_lon'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type Forecast = typeof forecasts.$inferSelect;
export type NewForecast = typeof forecasts.$inferInsert;
export type Score = typeof scores.$inferSelect;
export type NewScore = typeof scores.$inferInsert;

// Note: Added columns holfuy_station_id, webcam_url, windy_url, bom_station_id, site_guide_url to sites table via SQL migration
