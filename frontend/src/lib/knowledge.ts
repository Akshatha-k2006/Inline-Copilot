import { api } from "@/lib/api";
import type { BrandData } from "@/lib/brand-data";

export async function loadBrandData(): Promise<BrandData> {
  const [guidelines, glossary, facts, assets] = await Promise.all([
    api.get<BrandData["guidelines"]>("/api/guidelines"),
    api.get<BrandData["glossary"]>("/api/glossary"),
    api.get<BrandData["facts"]>("/api/facts"),
    api.get<BrandData["assets"]>("/api/assets"),
  ]);
  return { guidelines, glossary, facts, assets };
}
