CREATE TABLE "forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"forecast_time" timestamp NOT NULL,
	"fetched_at" timestamp DEFAULT now(),
	"provider" varchar(50) NOT NULL,
	"wind_speed" real,
	"wind_direction" integer,
	"wind_gust" real,
	"temperature" real,
	"precipitation" real,
	"precipitation_probability" integer,
	"cloud_cover" integer,
	"raw_data" jsonb
);
--> statement-breakpoint
CREATE TABLE "pilot_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" varchar(255) NOT NULL,
	"rating" varchar(10) DEFAULT 'PG3' NOT NULL,
	"conservatism" varchar(20) DEFAULT 'normal' NOT NULL,
	"home_lat" real,
	"home_lon" real,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "pilot_preferences_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"forecast_time" timestamp NOT NULL,
	"calculated_at" timestamp DEFAULT now(),
	"score_pg2" integer,
	"score_pg3" integer,
	"score_pg4" integer,
	"score_pg5" integer,
	"label_pg2" varchar(20),
	"label_pg3" varchar(20),
	"label_pg4" varchar(20),
	"label_pg5" varchar(20),
	"reasons_pg2" jsonb,
	"reasons_pg3" jsonb,
	"reasons_pg4" jsonb,
	"reasons_pg5" jsonb,
	"wind_angle_off" real,
	"cross_component" real,
	"gust_spread" real,
	"confidence" integer
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"region" varchar(100) NOT NULL,
	"launch_lat" real NOT NULL,
	"launch_lon" real NOT NULL,
	"launch_elevation" integer,
	"landing_lat" real,
	"landing_lon" real,
	"ideal_wind_direction" integer NOT NULL,
	"wind_sector_start" integer NOT NULL,
	"wind_sector_end" integer NOT NULL,
	"min_wind_speed" integer DEFAULT 8,
	"max_wind_speed_pg2" integer DEFAULT 14,
	"max_wind_speed_pg3" integer DEFAULT 16,
	"max_wind_speed_pg4" integer DEFAULT 20,
	"max_wind_speed_pg5" integer DEFAULT 24,
	"min_rating" varchar(10) DEFAULT 'PG2' NOT NULL,
	"requires_supervision" boolean DEFAULT false,
	"requires_radio" boolean DEFAULT false,
	"requires_induction" boolean DEFAULT false,
	"description" text,
	"hazards" text,
	"site_guide_url" varchar(500),
	"webcam_url" varchar(500),
	"weather_station_url" varchar(500),
	"admin_club" varchar(255),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sites_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;