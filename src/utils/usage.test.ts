import { describe, expect, it } from 'vitest';
import {
  buildApiKeyFilterOptions,
  filterUsageByApiKey,
  type UsageSourceFilterOption
} from './usage';

const createUsagePayload = () => ({
  total_requests: 5,
  success_count: 4,
  failure_count: 1,
  total_tokens: 150,
  apis: {
    'POST /v1/responses': {
      total_requests: 5,
      success_count: 4,
      failure_count: 1,
      total_tokens: 150,
      models: {
        'gpt-5.4': {
          total_requests: 5,
          success_count: 4,
          failure_count: 1,
          total_tokens: 150,
          details: [
            {
              timestamp: '2026-03-29T10:00:00.000Z',
              source: 'sk-client-alpha-1234561111',
              auth_index: 1,
              failed: false,
              tokens: {
                input_tokens: 10,
                output_tokens: 20,
                reasoning_tokens: 0,
                cached_tokens: 0,
              total_tokens: 30
              }
            },
            {
              timestamp: '2026-03-29T10:01:00.000Z',
              source: 'sk-client-alpha-1234561111',
              auth_index: 1,
              failed: false,
              tokens: {
                input_tokens: 5,
                output_tokens: 10,
                reasoning_tokens: 0,
                cached_tokens: 0,
              total_tokens: 15
              }
            },
            {
              timestamp: '2026-03-29T10:02:00.000Z',
              source: 'sk-client-beta-1234562222',
              auth_index: 2,
              failed: true,
              tokens: {
                input_tokens: 10,
                output_tokens: 10,
                reasoning_tokens: 0,
                cached_tokens: 0,
              total_tokens: 20
              }
            },
            {
              timestamp: '2026-03-29T10:03:00.000Z',
              source: 'legacy-client-name',
              auth_index: 2,
              failed: false,
              tokens: {
                input_tokens: 5,
                output_tokens: 10,
                reasoning_tokens: 0,
                cached_tokens: 0,
                total_tokens: 15
              }
            },
            {
              timestamp: '2026-03-29T10:04:00.000Z',
              auth_index: 9,
              failed: true,
              tokens: {
                input_tokens: 20,
                output_tokens: 50,
                reasoning_tokens: 0,
                cached_tokens: 0,
                total_tokens: 70
              }
            }
          ]
        }
      }
    }
  }
});

const createEndpointKeyUsagePayload = () => ({
  total_requests: 2,
  success_count: 2,
  failure_count: 0,
  total_tokens: 60,
  apis: {
    'sk-XaXi59U1wkXUt9si2': {
      total_requests: 2,
      success_count: 2,
      failure_count: 0,
      total_tokens: 60,
      models: {
        'gpt-5.4': {
          total_requests: 2,
          success_count: 2,
          failure_count: 0,
          total_tokens: 60,
          details: [
            {
              timestamp: '2026-03-29T11:00:00.000Z',
              source: 'legacy-client-name',
              auth_index: 1,
              failed: false,
              tokens: {
                input_tokens: 10,
                output_tokens: 20,
                reasoning_tokens: 0,
                cached_tokens: 0,
                total_tokens: 30
              }
            },
            {
              timestamp: '2026-03-29T11:01:00.000Z',
              auth_index: 1,
              failed: false,
              tokens: {
                input_tokens: 10,
                output_tokens: 20,
                reasoning_tokens: 0,
                cached_tokens: 0,
                total_tokens: 30
              }
            }
          ]
        }
      }
    }
  }
});

const apiKeys = [
  'sk-XaXi59U1wkXUt9si2',
  'sk-client-alpha-1234561111',
  'sk-client-beta-1234562222',
  'yo-client-gamma-1234563333'
];

const findOption = (options: UsageSourceFilterOption[], value: string) =>
  options.find((option) => option.value === value);

describe('buildApiKeyFilterOptions', () => {
  it('builds configured api key options with plaintext labels', () => {
    const options = buildApiKeyFilterOptions(apiKeys);
    const endpointKeyOption = findOption(options, 'api-key:0');
    const alphaOption = findOption(options, 'api-key:1');
    const betaOption = findOption(options, 'api-key:2');
    const gammaOption = findOption(options, 'api-key:3');
    const unknownOption = findOption(options, 'unknown');

    expect(endpointKeyOption).toBeDefined();
    expect(endpointKeyOption?.label).toBe('sk-XaXi59U1wkXUt9si2');
    expect(endpointKeyOption?.sourceIds.length).toBe(2);

    expect(alphaOption).toBeDefined();
    expect(alphaOption?.label).toBe('sk-client-alpha-1234561111');
    expect(alphaOption?.sourceIds.length).toBe(2);

    expect(betaOption).toBeDefined();
    expect(betaOption?.label).toBe('sk-client-beta-1234562222');
    expect(betaOption?.sourceIds.length).toBe(2);

    expect(gammaOption).toBeDefined();
    expect(gammaOption?.label).toBe('yo-client-gamma-1234563333');
    expect(gammaOption?.sourceIds.length).toBe(2);

    expect(unknownOption?.knownSourceIds.length).toBe(8);
  });
});

describe('filterUsageByApiKey', () => {
  it('keeps only the selected configured api key requests', () => {
    const usage = createUsagePayload();
    const options = buildApiKeyFilterOptions(apiKeys);
    const alphaOption = findOption(options, 'api-key:1');

    const filtered = filterUsageByApiKey(usage, alphaOption ?? { value: 'all', label: 'All', type: 'all', sourceIds: [], knownSourceIds: [] });
    const details =
      (((filtered.apis as Record<string, unknown>)['POST /v1/responses'] as Record<string, unknown>)
        .models as Record<string, unknown>)['gpt-5.4'] as Record<string, unknown>;

    expect(filtered.total_requests).toBe(2);
    expect(filtered.success_count).toBe(2);
    expect(filtered.failure_count).toBe(0);
    expect(filtered.total_tokens).toBe(45);
    expect((details.details as unknown[])).toHaveLength(2);
  });

  it('collects unknown requests that do not map to any configured api key', () => {
    const usage = createUsagePayload();
    const options = buildApiKeyFilterOptions(apiKeys);
    const unknownOption = findOption(options, 'unknown');

    const filtered = filterUsageByApiKey(usage, unknownOption ?? { value: 'unknown', label: 'Unknown', type: 'unknown', sourceIds: [], knownSourceIds: [] });
    const details =
      (((filtered.apis as Record<string, unknown>)['POST /v1/responses'] as Record<string, unknown>)
        .models as Record<string, unknown>)['gpt-5.4'] as Record<string, unknown>;

    expect(filtered.total_requests).toBe(2);
    expect(filtered.success_count).toBe(1);
    expect(filtered.failure_count).toBe(1);
    expect(filtered.total_tokens).toBe(85);
    expect((details.details as unknown[])).toHaveLength(2);
  });

  it('falls back to the parent api key name when detail.source does not contain the configured key', () => {
    const usage = createEndpointKeyUsagePayload();
    const options = buildApiKeyFilterOptions(apiKeys);
    const endpointKeyOption = findOption(options, 'api-key:0');

    const filtered = filterUsageByApiKey(usage, endpointKeyOption ?? { value: 'all', label: 'All', type: 'all', sourceIds: [], knownSourceIds: [] });
    const apiEntry = (filtered.apis as Record<string, unknown>)['sk-XaXi59U1wkXUt9si2'] as Record<string, unknown>;
    const details = (apiEntry.models as Record<string, unknown>)['gpt-5.4'] as Record<string, unknown>;

    expect(filtered.total_requests).toBe(2);
    expect(filtered.success_count).toBe(2);
    expect(filtered.failure_count).toBe(0);
    expect(filtered.total_tokens).toBe(60);
    expect((details.details as unknown[])).toHaveLength(2);
  });
});
