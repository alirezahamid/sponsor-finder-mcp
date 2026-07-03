import { z } from 'zod';

/**
 * Zod schemas for the upstream SponsorFinder API (see §3 of the build spec).
 *
 * These were validated against real API responses. Objects intentionally strip
 * unknown keys (Zod's default) rather than rejecting them: the upstream API is a
 * separate repo that adds fields over time (e.g. `dataHash`, `csvAppearances`),
 * so we fail loudly only when a field we depend on is missing or the wrong type —
 * that is the contract-drift guard the spec asks for, without breaking on purely
 * additive changes.
 */

export const CountrySchema = z.enum(['uk', 'nl']);
export type Country = z.infer<typeof CountrySchema>;

export const SponsorTypeSchema = z.enum(['WORK', 'EXCHANGE', 'STUDY', 'RESEARCH']);
export type SponsorType = z.infer<typeof SponsorTypeSchema>;

// ---------------------------------------------------------------------------
// §3.1  GET /organization/fuzzy
// ---------------------------------------------------------------------------

export const FuzzyHitSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  totalRecords: z.number().int(),
  isActive: z.boolean(),
  score: z.number(),
});
export type FuzzyHit = z.infer<typeof FuzzyHitSchema>;

export const FuzzyResponseSchema = z.object({
  data: z.array(FuzzyHitSchema),
  query: z.string(),
  appliedThreshold: z.number(),
  total: z.number().int(),
});
export type FuzzyResponse = z.infer<typeof FuzzyResponseSchema>;

// ---------------------------------------------------------------------------
// §3.2  GET /organization/:id  (shared sub-objects)
// ---------------------------------------------------------------------------

export const CitySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  displayName: z.string().nullable().optional(),
  variations: z.array(z.string()).optional(),
});
export type City = z.infer<typeof CitySchema>;

export const CountySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  displayName: z.string().nullable().optional(),
  variations: z.array(z.string()).optional(),
});
export type County = z.infer<typeof CountySchema>;

export const SicCodeSchema = z.object({
  code: z.string(),
  description: z.string(),
  sector: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
});
export type SicCode = z.infer<typeof SicCodeSchema>;

export const SponsorRecordSchema = z.object({
  id: z.number().int(),
  organizationId: z.number().int().optional(),
  typeRating: z.string(),
  route: z.string(),
  isInCurrentCsv: z.boolean(),
  csvAppearances: z.number().int().optional(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  city: CitySchema.nullable().optional(),
  county: CountySchema.nullable().optional(),
});
export type SponsorRecord = z.infer<typeof SponsorRecordSchema>;

export const UkOrganizationSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  totalRecords: z.number().int(),
  isActive: z.boolean(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  sector: z.string().nullable().optional(),
  sicCodes: z.array(SicCodeSchema).default([]),
  companiesHouseId: z.string().nullable().optional(),
  sponsorRecords: z.array(SponsorRecordSchema).default([]),
  cities: z.array(CitySchema).default([]),
  counties: z.array(CountySchema).default([]),
  typeRatings: z.array(z.string()).default([]),
  routes: z.array(z.string()).default([]),
});
export type UkOrganization = z.infer<typeof UkOrganizationSchema>;

export const NlOrganizationSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  kvkNumber: z.string().nullable().optional(),
  sponsorType: SponsorTypeSchema,
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  // Present on the real API even though the original spec said otherwise.
  isActive: z.boolean().optional(),
  country: z.literal('nl').optional(),
});
export type NlOrganization = z.infer<typeof NlOrganizationSchema>;

// ---------------------------------------------------------------------------
// §3.3  GET /organization/search
// ---------------------------------------------------------------------------

/**
 * List-shape organization (no `sponsorRecords`). UK and NL rows share a `name`
 * and `id`; the remaining fields differ, so both variants are optional and the
 * caller narrows by country.
 */
export const OrganizationListItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  isActive: z.boolean().optional(),
  // UK
  totalRecords: z.number().int().optional(),
  sector: z.string().nullable().optional(),
  companiesHouseId: z.string().nullable().optional(),
  // NL
  kvkNumber: z.string().nullable().optional(),
  sponsorType: SponsorTypeSchema.optional(),
  firstSeenAt: z.string().optional(),
  lastSeenAt: z.string().optional(),
});
export type OrganizationListItem = z.infer<typeof OrganizationListItemSchema>;

export const PageMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});
export type PageMeta = z.infer<typeof PageMetaSchema>;

export const SearchResponseSchema = z.object({
  data: z.array(OrganizationListItemSchema),
  meta: PageMetaSchema,
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ---------------------------------------------------------------------------
// §3.4  GET /organization/status
// ---------------------------------------------------------------------------

export const RegisterStatsSchema = z.object({
  lastUpdated: z.string(),
  totalActive: z.number().int(),
  newLast7Days: z.number().int(),
  removedLast7Days: z.number().int(),
  reactivatedLast7Days: z.number().int(),
  newLast30Days: z.number().int(),
  removedLast30Days: z.number().int(),
});
export type RegisterStats = z.infer<typeof RegisterStatsSchema>;

export const StatusResponseSchema = z.object({
  uk: RegisterStatsSchema,
  nl: RegisterStatsSchema,
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

// ---------------------------------------------------------------------------
// §3.5  GET /organization/:id/history
// ---------------------------------------------------------------------------

export const HistoryEventTypeSchema = z.enum(['ADDED', 'REMOVED', 'REACTIVATED']);
export type HistoryEventType = z.infer<typeof HistoryEventTypeSchema>;

export const HistoryEventSchema = z.object({
  eventType: HistoryEventTypeSchema,
  timestamp: z.string(),
  runId: z.number().int().nullable().optional(),
  source: z.string().nullable().optional(),
});
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;

export const HistoryResponseSchema = z.object({
  orgId: z.number().int(),
  orgName: z.string(),
  isActive: z.boolean().optional(),
  firstSeenAt: z.string().nullable().optional(),
  events: z.array(HistoryEventSchema).default([]),
  total: z.number().int(),
  page: z.number().int(),
  totalPages: z.number().int(),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

// ---------------------------------------------------------------------------
// §3.6  GET /organization/filters
// ---------------------------------------------------------------------------

export const UkFiltersSchema = z.object({
  cities: z.array(z.string()).default([]),
  counties: z.array(z.string()).default([]),
  typeRatings: z.array(z.string()).default([]),
  routes: z.array(z.string()).default([]),
  sectors: z.array(z.string()).default([]),
});
export type UkFilters = z.infer<typeof UkFiltersSchema>;

export const NlFiltersSchema = z.object({
  sponsorTypes: z.array(SponsorTypeSchema).default([]),
});
export type NlFilters = z.infer<typeof NlFiltersSchema>;

// ---------------------------------------------------------------------------
// Upstream error body (NestJS default), e.g. 404 / 400
// ---------------------------------------------------------------------------

export const UpstreamErrorBodySchema = z.object({
  statusCode: z.number().int(),
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string().optional(),
});
export type UpstreamErrorBody = z.infer<typeof UpstreamErrorBodySchema>;
