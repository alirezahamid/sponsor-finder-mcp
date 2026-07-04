/**
 * Static glossary baked into the server (spec §4.4).
 *
 * Baking this in prevents the model from hallucinating explanations of what a
 * sponsorship licence, route, or rating means. It is returned verbatim by
 * `get_register_info` alongside live register statistics.
 */

export const DISCLAIMER =
  'This information is provided for general guidance only and is not legal advice. ' +
  'Always verify against the official sources before making decisions: the UK ' +
  'government sponsor list (gov.uk) and the Dutch IND public register of recognised sponsors.';

export const UK_GLOSSARY = {
  overview:
    'A UK sponsorship licence lets an employer sponsor non-UK workers for work visas. ' +
    'The Home Office publishes the register of licensed sponsors as a CSV; SponsorFinder ' +
    'checks it daily. Absence from the register means a company cannot currently sponsor a worker. ' +
    'The register lists official registered legal entity names, not brand or trading names — ' +
    'resolve a company to its registered legal name before looking it up.',
  ratings: {
    'A rating':
      'Full compliance — the sponsor can assign Certificates of Sponsorship normally.',
    'B rating':
      'Transitional / action-plan rating — the sponsor has compliance issues to fix and is ' +
      'restricted until it upgrades back to an A rating.',
  },
  routes: {
    'Skilled Worker':
      'The main route for sponsoring skilled employees in eligible occupations.',
    'Global Business Mobility: Senior or Specialist Worker':
      'For senior managers or specialist employees transferring into a UK branch of the same group.',
    'Global Business Mobility: Graduate Trainee':
      'For employees on a structured graduate training programme transferring to the UK.',
    'Global Business Mobility: UK Expansion Worker':
      'For overseas businesses setting up a UK presence.',
    'Global Business Mobility: Service Supplier':
      'For contractual service suppliers or self-employed professionals fulfilling an overseas contract.',
    'Global Business Mobility: Secondment Worker':
      'For workers seconded to the UK as part of a high-value contract or investment.',
    'Scale-up': 'For fast-growing UK businesses sponsoring skilled workers.',
    'Minister of Religion':
      'For religious workers taking a role within a faith community.',
    'International Sportsperson': 'For elite sportspeople and coaches.',
    'Seasonal Worker': 'For temporary workers in horticulture and poultry.',
    'Tier 2 Ministers of Religion': 'Legacy route for religious ministers.',
  },
} as const;

export const NL_GLOSSARY = {
  overview:
    'The Dutch IND maintains a public register of recognised sponsors (erkende referenten). ' +
    'Only recognised sponsors may apply for certain residence permits on behalf of migrants. ' +
    'The NL register lists recognised sponsors only and carries far less detail than the UK register ' +
    '(no routes, ratings, or locations). It lists official registered legal entity names, not brand ' +
    'or trading names — resolve a company to its registered legal name before looking it up.',
  sponsorTypes: {
    WORK: 'Labour — covers regular labour migrants and highly skilled migrants (kennismigranten).',
    STUDY: 'Study — educational institutions sponsoring international students.',
    RESEARCH:
      'Research — organisations sponsoring researchers under Directive (EU) 2016/801.',
    EXCHANGE:
      'Exchange — organisations running recognised cultural or au-pair exchange programmes.',
  },
} as const;
