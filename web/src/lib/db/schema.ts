import { pgTable, serial, integer, text, numeric, boolean, timestamp, jsonb, bigserial } from 'drizzle-orm/pg-core';

// Scrapers (definidos via SQL — só leio aqui)
export const scrapers = pgTable('scrapers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  enabled: boolean('enabled').notNull().default(true),
  schedule: text('schedule'),
});

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  scraperId: integer('scraper_id').notNull(),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  rowsInserted: integer('rows_inserted').notNull().default(0),
  movementsAdded: integer('movements_added').notNull().default(0),
  movementsRemoved: integer('movements_removed').notNull().default(0),
  movementsChanged: integer('movements_changed').notNull().default(0),
  movementsTransferred: integer('movements_transferred').notNull().default(0),
  movementsHeld: integer('movements_held').notNull().default(0),
  movementsReleased: integer('movements_released').notNull().default(0),
  error: text('error'),
});

export const encoreSlabs = pgTable('encore_slabs', {
  id: serial('id').primaryKey(),
  jobId: integer('job_id').notNull(),
  scraperId: integer('scraper_id').notNull(),
  scrapedAt: timestamp('scraped_at', { withTimezone: true }).notNull().defaultNow(),
  itemId: integer('item_id'),
  serialNumber: text('serial_number'),
  itemName: text('item_name'),
  categoryName: text('category_name'),
  productForm: text('product_form'),
  location: text('location'),
  locationId: integer('location_id'),
  availableQty: numeric('available_qty'),
  uom: text('uom'),
  availableSlabs: integer('available_slabs'),
  averageLength: numeric('average_length'),
  averageWidth: numeric('average_width'),
  price1: numeric('price_1'),
  onHold: boolean('on_hold'),
  onSo: boolean('on_so'),
  inTransit: boolean('in_transit'),
  extra: jsonb('extra').notNull().default({}),
});

export const movements = pgTable('movements', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  scraperId: integer('scraper_id').notNull(),
  jobId: integer('job_id').notNull(),
  prevJobId: integer('prev_job_id'),
  sourceKey: text('source_key').notNull(),
  kind: text('kind').notNull(),
  itemName: text('item_name'),
  prevValue: text('prev_value'),
  nextValue: text('next_value'),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
});

export const savedQueries = pgTable('saved_queries', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  sql: text('sql').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunMs: integer('last_run_ms'),
  lastRowCount: integer('last_row_count'),
  lastError: text('last_error'),
});

export const slabsHistory = pgTable('slabs_history', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  scraperId: integer('scraper_id').notNull(),
  jobId: integer('job_id').notNull(),
  sourceKey: text('source_key').notNull(),
  itemName: text('item_name'),
  categoryName: text('category_name'),
  location: text('location'),
  availableSlabs: integer('available_slabs'),
  price: numeric('price'),
  onHold: boolean('on_hold'),
  scrapedAt: timestamp('scraped_at', { withTimezone: true }).notNull().defaultNow(),
});
