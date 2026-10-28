import { api } from "@/lib/api";
import type { BrandData } from "@/lib/brand-data";

interface LoadOptions {
  signal?: AbortSignal;
}

export async function loadBrandData(
  options: LoadOptions = {},
): Promise<BrandData> {
  const [guidelines, glossary, facts, assets] = await Promise.all([
    api.listGuidelines(options),
    api.listGlossary(options),
    api.listFacts(options),
    api.listAssets(options),
  ]);
  return {
    guidelines: guidelines.map(({ id, title, description }) => ({
      id: String(id),
      title,
      description,
    })),
    glossary: glossary.map(({ id, term, definition, preferredTerm }) => ({
      id: String(id),
      term,
      definition,
      preferredTerm: preferredTerm ?? "",
    })),
    facts: facts.map(({ id, claim, owner, reviewDate, outdated }) => ({
      id: String(id),
      claim,
      owner,
      reviewDate,
      outdated,
    })),
    assets: assets.map(({ id, name, description, url }) => ({
      id: String(id),
      name,
      description,
      url: url ?? "",
    })),
  };
}
