import type { MvpTask } from "../lib/mvp-contract";

/** Record changes at the same atomic commit as the task itself. */
export function auditTaskUpdate(before: MvpTask, candidate: MvpTask, at: string, review?: {verdict:"decline";note?:string}): MvpTask {
  const next = structuredClone(candidate);
  // Callers cannot replace historical evidence through ordinary task mutations.
  next.stateEvents = [...(before.stateEvents ?? [])];
  if(before.status !== next.status) next.stateEvents.push({at,from:before.status,to:next.status});
  next.assetEvents = [...(before.assetEvents ?? [])];
  next.adoptionReviews = [...(before.adoptionReviews ?? [])];
  const changed = new Set<string>();
  for (const asset of next.assets) {
    const prior = before.assets.find((item) => item.id === asset.id);
    if (!prior) continue;
    if (prior.initialVerdict) asset.initialVerdict = prior.initialVerdict;
    const fields = ["currentVersion", "verdict", "approvedRisk", "manuallyRejected"] as const;
    if (!fields.some((field) => prior[field] !== asset[field])) continue;
    changed.add(asset.id);
    next.assetEvents.push({ at, assetId: asset.id, kind: asset.currentVersion !== prior.currentVersion && asset.currentVersion === prior.previousVersion ? "restored" : "updated", before: structuredClone(prior), after: structuredClone(asset) });
  }
  for (const asset of before.assets) if (!next.assets.some((a) => a.id === asset.id)) changed.add(asset.id);
  if (next.selectedPlanId) {
    const selected = next.plans.find((plan) => plan.id === next.selectedPlanId);
    if (!selected || [selected.shopSign, ...selected.modules].some((module) => module.assetIds.some((id) => changed.has(id)))) next.selectedPlanId = undefined;
  }
  if (next.selectedPlanId && next.selectedPlanId !== before.selectedPlanId) {
    const selected = next.plans.find((p) => p.id === next.selectedPlanId)!;
    const ids = new Set([selected.shopSign, ...selected.modules].flatMap((m) => m.assetIds));
    next.adoptionReviews.push({ at, verdict: "adopt", planId: next.selectedPlanId, versions: Object.fromEntries(next.assets.filter((a) => ids.has(a.id)).map((a) => [a.id, a.currentVersion])) });
  }
  if (review) { next.selectedPlanId = undefined; next.adoptionReviews.push({at,verdict:"decline",note:review.note,versions:Object.fromEntries(next.assets.map(a=>[a.id,a.currentVersion]))}); }
  // Historical timing is immutable. Old records remain unknown until a new run ends.
  next.firstCompletedAt = before.firstCompletedAt ?? (next.completedAt && next.completedAt !== before.completedAt ? next.completedAt : undefined);
  return next;
}
