import { describe, it, expect } from "vitest";
import { fetchAllZohoRecords } from "../../supabase/functions/_shared/zoho-pagination";

describe("fetchAllZohoRecords", () => {
  it("follows next_page_token past 2000 records and never uses page numbers", async () => {
    const urls: string[] = [];
    const pages = [
      { data: [1, 2], info: { more_records: true, next_page_token: "t1" } },
      { data: [3], info: { more_records: true, next_page_token: "t2" } },
      { data: [4], info: { more_records: false } },
    ];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(pages[urls.length - 1]), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await fetchAllZohoRecords<number>("https://x/Deals?fields=a&per_page=200", "tok", fakeFetch);
    expect(out).toEqual([1, 2, 3, 4]);
    expect(urls[1]).toContain("page_token=t1");
    expect(urls[2]).toContain("page_token=t2");
    expect(urls.some((u) => /[?&]page=/.test(u))).toBe(false);
  });
});
