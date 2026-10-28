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
    guidelines: guidelines.map(({ id, title, description, category }) => ({
      id: String(id),
      title,
      description,
      category,
    })),
    glossary: glossary.map(
      ({ id, term, definition, preferredTerm, status, guidelineId }) => ({
      id: String(id),
      term,
      definition,
      preferredTerm: preferredTerm ?? "",
      status,
      guidelineId: guidelineId === null ? "" : String(guidelineId),
      }),
    ),
    facts: facts.map(
      ({ id, claim, owner, reviewDate, source, lastReviewed, outdated }) => ({
      id: String(id),
      claim,
      owner,
      reviewDate: reviewDate ?? "",
      source,
      lastReviewed: lastReviewed ?? "",
      outdated,
      }),
    ),
    assets: assets.map(({ id, name, description, url, assetType }) => ({
      id: String(id),
      name,
      description,
      url: url ?? "",
      kind: assetType,
    })),
  };
}
