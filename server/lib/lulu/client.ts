import type {
  LuluPrintJobRequest,
  LuluPrintJob,
  CostCalculationRequest,
  CostCalculationResult,
} from './types';

const ENVIRONMENTS = {
  sandbox: {
    api: 'https://api.sandbox.lulu.com',
    token: 'https://api.sandbox.lulu.com/auth/realms/glasstree/protocol/openid-connect/token',
  },
  production: {
    api: 'https://api.lulu.com',
    token: 'https://api.lulu.com/auth/realms/glasstree/protocol/openid-connect/token',
  },
} as const;

type Environment = keyof typeof ENVIRONMENTS;

let cachedToken: string | null = null;
let tokenExpiry = 0;

function getEnvConfig() {
  const env = (process.env.LULU_ENVIRONMENT || 'sandbox') as Environment;
  return ENVIRONMENTS[env];
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) {
    return cachedToken;
  }

  const config = getEnvConfig();
  const clientId = process.env.LULU_CLIENT_ID;
  const clientSecret = process.env.LULU_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('LULU_CLIENT_ID and LULU_CLIENT_SECRET must be set');
  }

  const response = await fetch(config.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`Lulu auth failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken!;
}

async function luluFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const config = getEnvConfig();
  const token = await getAccessToken();

  const response = await fetch(`${config.api}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Lulu API error ${response.status}: ${body}`);
  }

  return response.json();
}

// --- Public API ---

export async function calculateCost(
  request: CostCalculationRequest
): Promise<CostCalculationResult> {
  return luluFetch<CostCalculationResult>('/print-job-cost-calculations/', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function createPrintJob(
  request: LuluPrintJobRequest
): Promise<LuluPrintJob> {
  return luluFetch<LuluPrintJob>('/print-jobs/', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function getPrintJob(id: number): Promise<LuluPrintJob> {
  return luluFetch<LuluPrintJob>(`/print-jobs/${id}/`);
}

export async function validateInterior(
  interiorUrl: string,
  podPackageId: string
): Promise<{ id: string; status: string; messages?: string[] }> {
  return luluFetch('/interior-file-validations/', {
    method: 'POST',
    body: JSON.stringify({
      file_url: interiorUrl,
      pod_package_id: podPackageId,
    }),
  });
}

export async function validateCover(
  coverUrl: string,
  podPackageId: string,
  pageCount: number
): Promise<{ id: string; status: string; messages?: string[] }> {
  return luluFetch('/cover-file-validations/', {
    method: 'POST',
    body: JSON.stringify({
      file_url: coverUrl,
      pod_package_id: podPackageId,
      page_count: pageCount,
    }),
  });
}

export async function getCoverDimensions(
  podPackageId: string,
  pageCount: number
): Promise<{ width: number; height: number; spine_width: number }> {
  return luluFetch('/cover-dimensions/', {
    method: 'POST',
    body: JSON.stringify({
      pod_package_id: podPackageId,
      page_count: pageCount,
    }),
  });
}
