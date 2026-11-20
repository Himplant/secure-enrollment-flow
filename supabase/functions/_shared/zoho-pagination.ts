// Zoho CRM v6 list APIs only allow `page` up to 2000 records; beyond that a
// page_token is required. This helper always follows next_page_token.
export async function fetchAllZohoRecords<T>(
  baseUrl: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
  maxPages = 1000,
): Promise<T[]> {
  const out: T[] = [];
  let token: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const url = token ? `${baseUrl}&page_token=${encodeURIComponent(token)}` : baseUrl;
    const res = await fetchFn(url, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    if (res.status === 204) break;
    if (!res.ok) {
      const errText = await res.text();
      console.error(`Zoho API error (page ${i + 1}):`, errText);
      throw new Error(`Zoho API error: ${errText}`);
    }
    const data = await res.json();
    if (Array.isArray(data.data)) out.push(...data.data);
    token = data.info?.next_page_token ?? undefined;
    if (!data.info?.more_records || !token) break;
  }
  return out;
}
